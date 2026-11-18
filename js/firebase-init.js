const SAME_ORIGIN_FIREBASE_CONFIG_URL = "/api/firebase-config";
const VERCEL_FIREBASE_CONFIG_URL = "https://rook-score.vercel.app/api/firebase-config";
const FIREBASE_APP_MODULE_URL = "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
const FIREBASE_AUTH_MODULE_URL = "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
const FIREBASE_FIRESTORE_MODULE_URL = "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
const FIREBASE_CONFIG_TIMEOUT_MS = 6000;
const LOCAL_ONLY_STORAGE_PREFIX = "localOnly:";
const GITHUB_PAGES_HOSTNAMES = new Set(["marvj69.github.io"]);
const REQUIRED_FIREBASE_CONFIG_KEYS = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];
let app = null;
let auth = null;
let db = null;
let googleProvider = null;
let firebaseLibraryPromise = null;
let initializeApp = null;
let getAuth = null;
let onAuthStateChanged = null;
let GoogleAuthProvider = null;
let signInWithPopup = null;
let signOut = null;
let signInAnonymously = null;
let getFirestore = null;
let doc = null;
let setDoc = null;
let runTransaction = null;
let getDoc = null;
const reportedSyncFailures = new Set();
const firebaseMergePromises = new Map();
let lastMergedAuthUid = null;

window.firebaseReady = false;
window.firebaseConfigLoaded = false;
window.firebaseInitError = null;
window.firebaseApp = null;
window.firebaseAuth = null;
window.firestoreDB = null;
window.firestoreDoc = null;
window.firestoreSetDoc = null;
window.firestoreGetDoc = null;
window.googleProvider = null;
window.logVoiceImprovementSample = null;

function getAnalyticsSyncKeyLabel(key) {
  switch (key) {
    case "activeGameState":
      return "active_game";
    case "savedGames":
      return "saved_games";
    case "freezerGames":
      return "freezer_games";
    case "customPresetBids":
      return "preset_bids";
    case "proModeEnabled":
      return "pro_mode";
    case "auth":
    case "firebase_config":
      return key;
    default:
      return "other";
  }
}

function trackFirebaseEvent(eventName, params = {}) {
  if (typeof window.trackRookEvent === "function") {
    window.trackRookEvent(eventName, params);
  }
}

function trackSyncFailure(key, reason) {
  const syncKey = getAnalyticsSyncKeyLabel(key);
  const failureKey = `${syncKey}:${reason}`;
  if (reportedSyncFailures.has(failureKey)) return;
  reportedSyncFailures.add(failureKey);
  trackFirebaseEvent("sync_failed", { sync_key: syncKey, reason });
}

function shouldAttemptJsonParse(raw) {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const first = trimmed[0];
  if ((first >= '0' && first <= '9') || first === '-') return true;
  return first === '{' || first === '[' || first === '"' || first === 't' || first === 'f' || first === 'n';
}

function deserializeLocalStorageValue(key, raw) {
  if (raw === null || raw === undefined) return undefined;
  if (!shouldAttemptJsonParse(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`Could not parse localStorage key ${key}:`, error);
    return raw;
  }
}

function serializeForLocalStorage(value) {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// Mirrors ROOK_APP_STORAGE_KEYS in js/modules/03-storage-icons-presets.js (a
// test keeps the two lists identical). The app bundle normally publishes its
// own check on window; this copy covers the moment before it has loaded.
const ROOK_APP_STORAGE_KEYS = new Set([
  "activeGameState",
  "savedGames",
  "freezerGames",
  "teams",
  "customPresetBids",
  "proModeEnabled",
  "rookSelectedTheme",
  "customUsColor",
  "customDemColor",
  "rookMustWinByBid",
  "misdealHandlingEnabled",
  "tableTalkPenaltyType",
  "tableTalkPenaltyPoints",
  "experimentalFeaturesEnabled",
  "voiceImprovementOptIn",
  "probabilityPersonalizationV1",
  "darkModeEnabled",
  "removedGames",
]);

function isCloudSyncStorageKey(key) {
  if (typeof window.isCloudSyncStorageKey === "function") return window.isCloudSyncStorageKey(key);
  return typeof key === "string"
    && key !== "timestamp"
    && !key.startsWith(LOCAL_ONLY_STORAGE_PREFIX)
    && !key.toLowerCase().startsWith("firebase")
    && ROOK_APP_STORAGE_KEYS.has(key);
}

function captureCloudSyncStorageSnapshot() {
  if (typeof window.captureCloudSyncStorageSnapshot === "function") {
    return window.captureCloudSyncStorageSnapshot(localStorage);
  }

  const snapshot = new Map();
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (isCloudSyncStorageKey(key)) {
      snapshot.set(key, localStorage.getItem(key));
    }
  }
  return snapshot;
}

// "Delete All Game Data" bookkeeping. The cloud document carries the time of
// the latest delete (GAME_DATA_RESET_FIELD). Each device remembers, per account,
// the delete time it last agreed on with the cloud. Whichever side has not seen
// a newer delete drops its game data from before it, so a stale device or a
// stale cloud copy cannot bring deleted games back. Mirrors GAME_DATA_KEYS and
// the localOnly key names in js/modules/03-storage-icons-presets.js.
const GAME_DATA_RESET_FIELD = "gameDataResetAt";
const GAME_DATA_RESET_DEVICE_KEY = `${LOCAL_ONLY_STORAGE_PREFIX}gameDataResetAt`;
const GAME_DATA_RESET_MARKERS_KEY = `${LOCAL_ONLY_STORAGE_PREFIX}gameDataResetMarkers`;
const GAME_DATA_KEYS = [
  "activeGameState",
  "savedGames",
  "freezerGames",
  "teams",
  "probabilityPersonalizationV1",
];

function parseGameDataResetTime(marker) {
  const time = typeof marker === "string" && marker ? Date.parse(marker) : NaN;
  return Number.isFinite(time) ? time : 0;
}

function laterGameDataResetMarker(left, right) {
  const safeLeft = typeof left === "string" ? left : "";
  const safeRight = typeof right === "string" ? right : "";
  return parseGameDataResetTime(safeRight) > parseGameDataResetTime(safeLeft) ? safeRight : safeLeft;
}

// { agreed: { [uid]: marker }, lastUid } — the delete time this device last
// agreed on with each account, and the account it last synced with.
function readGameDataResetMarkers() {
  const markers = deserializeLocalStorageValue(
    GAME_DATA_RESET_MARKERS_KEY,
    localStorage.getItem(GAME_DATA_RESET_MARKERS_KEY),
  );
  if (!markers || typeof markers !== "object" || Array.isArray(markers)) return null;
  const agreed = markers.agreed && typeof markers.agreed === "object" && !Array.isArray(markers.agreed)
    ? markers.agreed
    : {};
  return { agreed, lastUid: typeof markers.lastUid === "string" ? markers.lastUid : "" };
}

// The delete time this device last agreed on with an account's cloud copy, or
// null when this device has never synced with that account (its games were
// never part of the account, so an older delete there says nothing about them).
// Installs that synced before deletes existed have no markers yet; they count
// as having synced with whichever account they sync with first.
function getAgreedGameDataResetMarker(userId) {
  const markers = readGameDataResetMarkers();
  if (!markers) return "";
  if (!Object.prototype.hasOwnProperty.call(markers.agreed, userId)) return null;
  return typeof markers.agreed[userId] === "string" ? markers.agreed[userId] : "";
}

// The latest delete made on this device: { at, uid }. uid is the account that
// was signed in at the time, or null when cloud sync had not loaded.
function readDeviceGameDataReset() {
  const reset = deserializeLocalStorageValue(
    GAME_DATA_RESET_DEVICE_KEY,
    localStorage.getItem(GAME_DATA_RESET_DEVICE_KEY),
  );
  if (!reset || reset.localOnly || typeof reset !== "object" || typeof reset.at !== "string") return null;
  return { at: reset.at, uid: typeof reset.uid === "string" && reset.uid ? reset.uid : null };
}

// Adds a delete made on this device that the account has not heard about yet.
// A delete belongs only to the account it was made in (or, offline, the one
// this device last synced with), so signing in elsewhere never spreads it.
function getLocalGameDataResetMarker(userId) {
  const agreed = getAgreedGameDataResetMarker(userId);
  const deviceReset = readDeviceGameDataReset();
  if (!deviceReset) return agreed;
  const deleteAccount = deviceReset.uid || readGameDataResetMarkers()?.lastUid;
  return deleteAccount === userId ? laterGameDataResetMarker(agreed, deviceReset.at) : agreed;
}

function rememberGameDataResetMarker(userId, marker) {
  const markers = readGameDataResetMarkers() || { agreed: {}, lastUid: "" };
  const previousUid = markers.lastUid;
  markers.agreed[userId] = typeof marker === "string" ? marker : "";
  markers.lastUid = userId;
  try {
    // Bind old offline records before changing the remembered account.
    const reset = readDeviceGameDataReset();
    if (reset && !reset.uid) {
      localStorage.setItem(GAME_DATA_RESET_DEVICE_KEY, JSON.stringify({ ...reset, uid: previousUid || null, localOnly: !previousUid }));
    }
    localStorage.setItem(GAME_DATA_RESET_MARKERS_KEY, JSON.stringify(markers));
  } catch (error) {
    console.warn("Could not record the cloud delete marker on this device.", error);
  }
}

// Restored games carry restoredAt, so they count as newer than any delete made
// before they were restored.
function getGameDataTime(value) {
  if (!value || typeof value !== "object") return 0;
  return [value.timestamp, value.frozenAt, value.timerLastActivityAt, value.timerLastSavedAt, value.startTime, value.restoredAt]
    .map(time => (typeof time === "number" ? time : Date.parse(time || "")))
    .filter(Number.isFinite)
    .reduce((latest, time) => Math.max(latest, time), 0);
}

// Keeps only the game data created after a delete this side had not seen.
// Teams and learned probabilities are totals that cannot be split by date, so
// they go entirely; they rebuild from the games that remain.
function dropGameDataBefore(data, marker) {
  const resetTime = parseGameDataResetTime(marker);
  const kept = { ...data };
  const droppedKeys = [];
  GAME_DATA_KEYS.forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(kept, key)) return;
    const value = kept[key];
    if ((key === "savedGames" || key === "freezerGames") && Array.isArray(value)) {
      kept[key] = value.filter(game => getGameDataTime(game) > resetTime);
      return;
    }
    if (key === "activeGameState" && getGameDataTime(value) > resetTime) return;
    delete kept[key];
    droppedKeys.push(key);
  });
  return { kept, droppedKeys };
}

// Single-game removals. The saved and frozen lists of both sides are joined, so
// a game deleted on one device (or a frozen game resumed there) would come back
// from any copy that still holds it. Each removal is recorded as
// { list, key, at }, the records of both sides are joined too, and a listed
// game is dropped unless it was stamped after its record (a restored game).
// Mirrors REMOVED_GAMES_KEY and its limits in js/modules/03-storage-icons-presets.js.
const REMOVED_GAMES_KEY = "removedGames";
const REMOVED_GAMES_MAX = 500;
const REMOVED_GAMES_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const REMOVABLE_GAME_LISTS = ["savedGames", "freezerGames"];

function mergeRemovedGames(left, right, now = Date.now()) {
  const latest = new Map();
  [left, right].forEach(entries => {
    (Array.isArray(entries) ? entries : []).forEach(entry => {
      if (!entry || typeof entry !== "object") return;
      const { list, key, at } = entry;
      if (!REMOVABLE_GAME_LISTS.includes(list)) return;
      if (typeof key !== "string" || !key || key.length > 200) return;
      if (typeof at !== "number" || !Number.isFinite(at)) return;
      const id = `${list}\n${key}`;
      if (!latest.has(id) || latest.get(id).at < at) latest.set(id, { list, key, at });
    });
  });
  return [...latest.values()]
    .filter(entry => entry.at >= now - REMOVED_GAMES_MAX_AGE_MS)
    .sort((a, b) => b.at - a.at || a.list.localeCompare(b.list) || a.key.localeCompare(b.key))
    .slice(0, REMOVED_GAMES_MAX);
}

function dropRemovedGames(listKey, games, removedGames) {
  const removedAt = new Map();
  removedGames.forEach(entry => {
    if (entry.list === listKey) removedAt.set(entry.key, entry.at);
  });
  if (!removedAt.size) return games;
  return games.filter(game => {
    const key = game && typeof game === "object" ? game.id || game.timestamp : "";
    if (typeof key !== "string" && typeof key !== "number") return true;
    const at = removedAt.get(String(key));
    return at === undefined || getGameDataTime(game) > at;
  });
}

// Joins two lists of saved or frozen games into one, each game once. When both
// lists hold the same game, the first list's copy stays unless the second
// carries a later timestamp.
function joinGameLists(first, second) {
  const uniqueMap = new Map();
  [...first, ...second].forEach(item => {
    // Prefer item.id or item.timestamp for uniqueness
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const uniqueKey = item.id || item.timestamp || JSON.stringify(item); // Fallback to stringify
    if (!uniqueMap.has(uniqueKey)) {
      uniqueMap.set(uniqueKey, item);
      return;
    }
    const existingItem = uniqueMap.get(uniqueKey);
    if (getGameDataTime(item) > getGameDataTime(existingItem)) {
      uniqueMap.set(uniqueKey, item);
    }
  });
  return Array.from(uniqueMap.values());
}

// Everything that syncs lives in one Firestore document, and a document tops
// out at 1 MiB. The finished-games list is nearly all of it (2-3 KB a game), so
// an account reached the limit somewhere past 370 games and every later write
// failed. The list is uploaded gzipped in SAVED_GAMES_PACKED_FIELD instead,
// about an eighth of the size, as a list of strings:
//   ["gzip-json-v1;<delete marker the pack was written under>", "<base64>", "<base64>", ...]
// The base64 is cut into short pieces because Firestore indexes every value,
// and an indexed value is limited to 1,500 bytes.
// The plain "savedGames" field stays readable. App versions from before this
// (and browsers without CompressionStream) still write it; the merge joins
// those games into the pack and empties the field.
const SAVED_GAMES_KEY = "savedGames";
const SAVED_GAMES_PACKED_FIELD = "savedGamesPacked";
const SAVED_GAMES_PACK_PREFIX = "gzip-json-v1";
const SAVED_GAMES_PACK_PIECE_LENGTH = 1000;

// Set when Firestore refuses, as invalid, a write that carried the pack. The
// rest of the session then syncs the plain list, exactly as before packing.
let savedGamesPackingRefused = false;

function canPackSavedGames() {
  return !savedGamesPackingRefused
    && typeof CompressionStream === "function"
    && typeof DecompressionStream === "function"
    && typeof Blob === "function"
    && typeof Response === "function"
    && typeof btoa === "function"
    && typeof atob === "function";
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function packSavedGames(games, resetMarker) {
  const stream = new Blob([JSON.stringify(games)]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const marker = typeof resetMarker === "string" ? resetMarker : "";
  const base64 = bytesToBase64(bytes);
  const pack = [`${SAVED_GAMES_PACK_PREFIX};${marker}`];
  for (let start = 0; start < base64.length; start += SAVED_GAMES_PACK_PIECE_LENGTH) {
    pack.push(base64.slice(start, start + SAVED_GAMES_PACK_PIECE_LENGTH));
  }
  return pack;
}

// { present, games, resetAt }. A pack this version cannot read throws, which
// fails the merge: nothing is uploaded over games that could not be read.
async function unpackSavedGames(packed) {
  if (packed === null || packed === undefined) return { present: false, games: [], resetAt: "" };
  const pieces = Array.isArray(packed) && packed.every(piece => typeof piece === "string") ? packed : [];
  const header = (pieces[0] || "").split(";");
  if (pieces.length < 2 || header.length !== 2 || header[0] !== SAVED_GAMES_PACK_PREFIX) {
    throw new Error("The cloud copy of the saved games is in a format this version cannot read.");
  }
  const bytes = base64ToBytes(pieces.slice(1).join(""));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const games = JSON.parse(await new Response(stream).text());
  if (!Array.isArray(games)) throw new Error("The cloud copy of the saved games is damaged.");
  return { present: true, games, resetAt: header[1] };
}

// Turns the fields of a write into what the cloud document stores. The plain
// field is left as it is: only the merge, which has just joined its games in,
// empties it.
async function toCloudFields(fields, resetMarker) {
  if (!Object.prototype.hasOwnProperty.call(fields, SAVED_GAMES_KEY)) return fields;
  const games = fields[SAVED_GAMES_KEY];
  // A cleared list is cleared in both places.
  if (games === null) return { ...fields, [SAVED_GAMES_PACKED_FIELD]: null };
  if (!Array.isArray(games) || !canPackSavedGames()) return fields;
  const { [SAVED_GAMES_KEY]: plainGames, ...otherFields } = fields;
  return { ...otherFields, [SAVED_GAMES_PACKED_FIELD]: await packSavedGames(games, resetMarker) };
}

// Every write of the cloud document goes through here. A refused write that
// carried the pack switches packing off, and the caller tries once more with
// the plain list. A list too large even when packed fails that retry as well.
async function transactGameData(userId, prepare) {
  let writingPack = false;
  const docRef = doc(db, "rookData", userId);
  try {
    return await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(docRef);
      if (auth?.currentUser?.uid !== userId) return null;
      const result = await prepare(snapshot.exists() ? snapshot.data() : {});
      if (!result || auth?.currentUser?.uid !== userId) return null;
      const { fields } = result;
      if (Object.keys(fields).length) {
        writingPack = Array.isArray(fields[SAVED_GAMES_PACKED_FIELD]);
        transaction.set(docRef, { ...fields, timestamp: new Date().toISOString() }, { merge: true });
      }
      return result;
    });
  } catch (error) {
    if (error?.code === "invalid-argument" && writingPack) savedGamesPackingRefused = true;
    throw error;
  }
}

async function readCloudLibrary(snapshot) {
  const data = { ...snapshot };
  const pack = canPackSavedGames() ? await unpackSavedGames(data[SAVED_GAMES_PACKED_FIELD]) : null;
  delete data[SAVED_GAMES_PACKED_FIELD];
  if (pack?.present) {
    const reset = parseGameDataResetTime(data[GAME_DATA_RESET_FIELD]);
    const packedGames = parseGameDataResetTime(pack.resetAt) < reset
      ? pack.games.filter(game => getGameDataTime(game) > reset) : pack.games;
    data.savedGames = joinGameLists(packedGames, Array.isArray(data.savedGames) ? data.savedGames : []);
  }
  return { data, pack };
}

// Reconcile at commit time. Another tab or device can add or remove games
// after this session's startup merge. Firestore retries when the document changes.
async function writeGameFields(userId, fields, resetMarker, { reset = false, replace = new Set() } = {}) {
  const hasLibraryChanges = [...REMOVABLE_GAME_LISTS, REMOVED_GAMES_KEY].some(key => Object.hasOwn(fields, key));
  const withMarker = { ...fields, [GAME_DATA_RESET_FIELD]: resetMarker };
  if (reset || !hasLibraryChanges) {
    if (auth?.currentUser?.uid !== userId) return false;
    const payload = reset ? await toCloudFields(withMarker, resetMarker) : withMarker;
    if (reset && Array.isArray(payload[SAVED_GAMES_PACKED_FIELD])) payload.savedGames = null;
    if (reset && Array.isArray(payload.savedGames)) payload[SAVED_GAMES_PACKED_FIELD] = null;
    if (auth?.currentUser?.uid !== userId) return false;
    await setDoc(doc(db, "rookData", userId), { ...payload, timestamp: new Date().toISOString() }, { merge: true });
    return true;
  }
  const committed = await transactGameData(userId, async snapshot => {
    if (parseGameDataResetTime(snapshot[GAME_DATA_RESET_FIELD]) > parseGameDataResetTime(resetMarker)) {
      throw Object.assign(new Error("A newer game reset requires a fresh merge."), { code: "permission-denied" });
    }
    const { data } = await readCloudLibrary(snapshot);
    const result = { ...withMarker };
    const removals = replace.has(REMOVED_GAMES_KEY) ? fields[REMOVED_GAMES_KEY] || []
      : mergeRemovedGames(fields[REMOVED_GAMES_KEY], data[REMOVED_GAMES_KEY]);
    if (Object.hasOwn(fields, REMOVED_GAMES_KEY) && !replace.has(REMOVED_GAMES_KEY)) result[REMOVED_GAMES_KEY] = removals;
    for (const key of REMOVABLE_GAME_LISTS) {
      if (Array.isArray(fields[key]) && !replace.has(key)) {
        result[key] = dropRemovedGames(key, joinGameLists(fields[key], Array.isArray(data[key]) ? data[key] : []), removals);
      } else if (!Object.hasOwn(fields, key) && fields[REMOVED_GAMES_KEY] && Array.isArray(data[key])) {
        const kept = dropRemovedGames(key, data[key], removals);
        if (kept.length < data[key].length) result[key] = kept;
      }
    }
    const encoded = await toCloudFields(result, resetMarker);
    if (Array.isArray(encoded[SAVED_GAMES_PACKED_FIELD]) && snapshot.savedGames?.length) encoded.savedGames = null;
    if (replace.has(SAVED_GAMES_KEY) && Array.isArray(encoded.savedGames)) encoded[SAVED_GAMES_PACKED_FIELD] = null;
    return { fields: encoded };
  });
  return Boolean(committed);
}

function isCloudDocumentFullError(error) {
  return error?.code === "invalid-argument"
    && /\bbytes\b|maximum (allowed )?size|too large|longer than|exceeds/i.test(String(error?.message || ""));
}

// Said once per session, and only to someone who signed in: an anonymous
// session never chose cloud sync. The games themselves are safe on the device.
let cloudDocumentFullReported = false;
function reportCloudDocumentFull() {
  trackSyncFailure("other", "document_too_large");
  if (cloudDocumentFullReported || !auth?.currentUser || auth.currentUser.isAnonymous) return;
  cloudDocumentFullReported = true;
  window.showWarningToast?.("Cloud sync is full. New games stay on this device.");
}

// Rule settings follow the account the first time a device joins it. A device
// holds a value for these as soon as Settings has been used once (older
// versions stored the defaults on every launch), so "local wins" would put a
// new device's defaults over the rules already saved on the account. After that
// first merge the device's own changes win as before.
const ACCOUNT_FIRST_SETTING_KEYS = [
  "rookMustWinByBid",
  "misdealHandlingEnabled",
  "tableTalkPenaltyType",
  "tableTalkPenaltyPoints",
];

function getCloudSyncStorageChanges(snapshot) {
  if (typeof window.getCloudSyncStorageChanges === "function") {
    return window.getCloudSyncStorageChanges(snapshot, localStorage);
  }

  const current = captureCloudSyncStorageSnapshot();
  const keys = new Set([...snapshot.keys(), ...current.keys()]);
  const changes = new Map();
  keys.forEach(key => {
    const previousRaw = snapshot.has(key) ? snapshot.get(key) : null;
    const currentRaw = current.has(key) ? current.get(key) : null;
    if (previousRaw !== currentRaw) changes.set(key, currentRaw);
  });
  return changes;
}

function getSafeProfileImageUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return "";
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function updateAuthUI(user) {
  const authLabel = document.getElementById("authLabel");
  if (!authLabel) return;
  authLabel.textContent = "Sign in with Google";
  authLabel.style.display = '';
  authLabel.style.alignItems = '';

  if (user && !user.isAnonymous) {
    authLabel.textContent = "Sign Out";
    authLabel.style.display = 'inline-flex';
    authLabel.style.alignItems = 'center';
    const photoUrl = getSafeProfileImageUrl(user.photoURL);
    if (photoUrl) {
      const img = document.createElement("img");
      img.src = photoUrl;
      img.alt = "Profile";
      img.referrerPolicy = "no-referrer";
      img.style.display = "inline-block";
      img.style.width = "24px";
      img.style.height = "24px";
      img.style.borderRadius = "50%";
      img.style.verticalAlign = "middle";
      img.style.marginLeft = "8px";
      authLabel.appendChild(img);
    }
  }
}

// Reloading state from storage would discard a bid the user is typing, so the
// fallbacks only refresh the screen while the app is still untouched.
function hasUserInteracted() {
  return Number(window.getRookAppInteractionRevision?.() || 0) > 0;
}

function renderLocalAppFallback() {
  updateAuthUI(null);
  if (hasUserInteracted()) return;
  if (window.loadCurrentGameState) window.loadCurrentGameState();
  if (window.renderApp) window.renderApp();
}

function disableFirebase(error) {
  window.firebaseReady = false;
  window.firebaseInitError = error;
  console.warn("Firebase cloud sync is unavailable. The app will continue with local storage only.", error);
  trackSyncFailure("firebase_config", "init_failed");

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderLocalAppFallback, { once: true });
  } else {
    renderLocalAppFallback();
  }
}

function fetchWithTimeout(url, options = {}, timeoutMs = FIREBASE_CONFIG_TIMEOUT_MS) {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error(`Firebase config request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const fetchPromise = fetch(url, controller ? { ...options, signal: controller.signal } : options);
  fetchPromise.catch(() => undefined);

  return Promise.race([fetchPromise, timeoutPromise])
    .finally(() => clearTimeout(timeoutId));
}

async function loadFirebaseConfig() {
  const configUrl = GITHUB_PAGES_HOSTNAMES.has(window.location.hostname)
    ? VERCEL_FIREBASE_CONFIG_URL
    : SAME_ORIGIN_FIREBASE_CONFIG_URL;

  // The endpoint sends a short public max-age, so repeat launches reuse the
  // browser's copy instead of waking a serverless function every time.
  const response = await fetchWithTimeout(configUrl, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Firebase config endpoint returned HTTP ${response.status}`);
  }

  const config = await response.json();
  const missingKeys = REQUIRED_FIREBASE_CONFIG_KEYS.filter(key => !config[key]);
  if (missingKeys.length > 0) {
    throw new Error(`Firebase config is missing: ${missingKeys.join(", ")}`);
  }

  return config;
}

const FIREBASE_MODULE_URLS = [FIREBASE_APP_MODULE_URL, FIREBASE_AUTH_MODULE_URL, FIREBASE_FIRESTORE_MODULE_URL];

// Plain fetches fill the HTTP cache without touching the module map, so an
// offline launch leaves a later import() free to retry (a failed module fetch
// stays cached in the module map in shipping browsers).
function warmFirebaseModuleCache() {
  if (typeof fetch !== "function") return Promise.resolve();
  return Promise.allSettled(FIREBASE_MODULE_URLS.map(url => fetch(url, { mode: "cors" }).catch(() => undefined)));
}

async function loadFirebaseLibraries() {
  if (firebaseLibraryPromise) return firebaseLibraryPromise;

  firebaseLibraryPromise = Promise.all([
    import(FIREBASE_APP_MODULE_URL),
    import(FIREBASE_AUTH_MODULE_URL),
    import(FIREBASE_FIRESTORE_MODULE_URL),
  ]).then(([appModule, authModule, firestoreModule]) => {
    initializeApp = appModule.initializeApp;
    getAuth = authModule.getAuth;
    onAuthStateChanged = authModule.onAuthStateChanged;
    GoogleAuthProvider = authModule.GoogleAuthProvider;
    signInWithPopup = authModule.signInWithPopup;
    signOut = authModule.signOut;
    signInAnonymously = authModule.signInAnonymously;
    getFirestore = firestoreModule.getFirestore;
    doc = firestoreModule.doc;
    setDoc = firestoreModule.setDoc;
    runTransaction = firestoreModule.runTransaction;
    getDoc = firestoreModule.getDoc;

    window.firestoreDoc = doc;
    window.firestoreSetDoc = setDoc;
    window.firestoreGetDoc = getDoc;
  }).catch(error => {
    firebaseLibraryPromise = null;
    throw error;
  });

  return firebaseLibraryPromise;
}

async function prepareStartupMerge(cloudSnapshot, userId) {
  const { data, pack: cloudPack } = await readCloudLibrary(cloudSnapshot);
  let firestoreData = data;
  const localRawSnapshot = captureCloudSyncStorageSnapshot();
  let localData = {};

  localRawSnapshot.forEach((rawValue, key) => {
    localData[key] = deserializeLocalStorageValue(key, rawValue);
  });

  // A previous account's cleared scoreboard cannot erase the new account's active game.
  const priorOwner = readGameDataResetMarkers()?.lastUid;
  if (priorOwner && priorOwner !== userId && localData.activeGameState === null) delete localData.activeGameState;

  // A side that missed a "Delete All Game Data" loses its game data from before it.
  const cloudResetMarker = typeof firestoreData[GAME_DATA_RESET_FIELD] === "string"
    ? firestoreData[GAME_DATA_RESET_FIELD]
    : "";
  const localResetMarker = getLocalGameDataResetMarker(userId);
  // null: this device has never synced with this account.
  const firstMergeWithAccount = localResetMarker === null;
  const resetMarker = laterGameDataResetMarker(localResetMarker ?? "", cloudResetMarker);
  const localResetTime = parseGameDataResetTime(localResetMarker);
  const cloudResetTime = parseGameDataResetTime(cloudResetMarker);
  let staleKeys = [];
  const localWasStale = localResetMarker !== null && cloudResetTime > localResetTime;
  if (localWasStale) {
    const { kept, droppedKeys } = dropGameDataBefore(localData, cloudResetMarker);
    localData = kept;
    staleKeys = droppedKeys;
  } else if (localResetMarker !== null && localResetTime > cloudResetTime) {
    const { kept, droppedKeys } = dropGameDataBefore(firestoreData, localResetMarker);
    firestoreData = kept;
    staleKeys = droppedKeys;
  }

  const mergedData = {};
  const allKeys = new Set([...Object.keys(localData), ...Object.keys(firestoreData)]);

  allKeys.forEach(key => {
    if (!isCloudSyncStorageKey(key)) return;
    if (key === REMOVED_GAMES_KEY) return; // Joined below, once the lists are.

    const localValue = localData[key];
    const firestoreValue = firestoreData[key];

    // Prioritize local data for active game to avoid overwriting unsaved changes
    // For other items like savedGames, attempt a merge or use the most recent
    if (key === "activeGameState") { // ACTIVE_GAME_KEY from main script
      // Local wins so unsaved progress is never overwritten; a device with no
      // game does not persist an empty one.
      if (Object.prototype.hasOwnProperty.call(localData, key)) mergedData[key] = localValue;
      else if (firestoreValue !== undefined) mergedData[key] = firestoreValue;
    } else if (Array.isArray(localValue) && Array.isArray(firestoreValue) && (key === "savedGames" || key === "freezerGames")) {
      // Merge arrays of games, ensuring uniqueness by timestamp or a unique ID if available
      mergedData[key] = joinGameLists(localValue, firestoreValue);
    } else if (Array.isArray(localValue) || Array.isArray(firestoreValue)) {
      // Lists such as custom bid presets are replaced whole; spreading them into
      // an object would turn [120, 125] into {0: 120, 1: 125}.
      mergedData[key] = Array.isArray(localValue) ? localValue : firestoreValue;
    } else if (typeof localValue === 'object' && localValue !== null && typeof firestoreValue === 'object' && firestoreValue !== null) {
      // Simple object merge, local overrides remote for simple key-value settings
      mergedData[key] = { ...firestoreValue, ...localValue };
    } else if (firstMergeWithAccount && ACCOUNT_FIRST_SETTING_KEYS.includes(key)
        && firestoreValue !== undefined && firestoreValue !== null) {
      mergedData[key] = firestoreValue;
    } else {
      // Default to local if present, else remote, else undefined
      mergedData[key] = localValue !== undefined ? localValue : firestoreValue;
    }
  });

  // A game one side removed on its own leaves the joined lists on both sides.
  const removedGamesSynced = isCloudSyncStorageKey(REMOVED_GAMES_KEY);
  if (removedGamesSynced && (allKeys.has(REMOVED_GAMES_KEY))) {
    const removedGames = mergeRemovedGames(localData[REMOVED_GAMES_KEY], firestoreData[REMOVED_GAMES_KEY]);
    mergedData[REMOVED_GAMES_KEY] = removedGames;
    REMOVABLE_GAME_LISTS.forEach(listKey => {
      if (Array.isArray(mergedData[listKey])) {
        mergedData[listKey] = dropRemovedGames(listKey, mergedData[listKey], removedGames);
      }
    });
  }

  // Stale game data with no newer copy on the other side is cleared everywhere.
  staleKeys.forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(mergedData, key)) mergedData[key] = null;
  });

  // Only send what differs from the cloud copy: an unchanged startup merge
  // costs no document write. The original cloud values are compared so data
  // dropped for predating a delete is cleared there as well.
  const payload = {};
  const mergedSavedGames = mergedData[SAVED_GAMES_KEY];
  const packMergedSavedGames = Boolean(cloudPack) && Array.isArray(mergedSavedGames);
  Object.entries(mergedData).forEach(([key, value]) => {
    if (packMergedSavedGames && key === SAVED_GAMES_KEY) return; // Packed below.
    if (JSON.stringify(value) !== JSON.stringify(cloudSnapshot[key])) payload[key] = value;
  });
  if (packMergedSavedGames) {
    if (!cloudPack.present || JSON.stringify(mergedSavedGames) !== JSON.stringify(cloudPack.games)) {
      payload[SAVED_GAMES_PACKED_FIELD] = await packSavedGames(mergedSavedGames, resetMarker);
    }
    // Games an older app version uploaded to the plain field are in the pack now.
    if (Array.isArray(cloudSnapshot[SAVED_GAMES_KEY]) && cloudSnapshot[SAVED_GAMES_KEY].length) {
      payload[SAVED_GAMES_KEY] = null;
    }
  }
  if (resetMarker !== cloudResetMarker) payload[GAME_DATA_RESET_FIELD] = resetMarker;
  if (Object.keys(payload).length) payload[GAME_DATA_RESET_FIELD] = resetMarker;
  return { fields: payload, localRawSnapshot, mergedData, resetMarker, localWasStale, cloudResetMarker, removedGamesSynced };
}

window.mergeLocalStorageWithFirestore = async function(user) {
  if (!db) {
    trackSyncFailure("other", "firebase_unavailable");
    return false;
  }

  const userId = typeof user?.uid === "string" ? user.uid : "";
  if (!userId) return false;
  const interactionRevisionAtStart = Number(
    window.getRookAppInteractionRevision?.() || 0,
  );
  const result = await transactGameData(userId, snapshot => prepareStartupMerge(snapshot, userId));
  if (!result || auth?.currentUser?.uid !== userId) return false;
  const { localRawSnapshot, mergedData, resetMarker, localWasStale, cloudResetMarker, removedGamesSynced } = result;
  rememberGameDataResetMarker(userId, resetMarker);
  const localChangesDuringMerge = getCloudSyncStorageChanges(localRawSnapshot);

  // Update localStorage with merged data
  let localStorageUpdatedByMerge = false;
  Object.entries(mergedData).forEach(([key, value]) => {
    if (key !== "timestamp" && !key.startsWith(LOCAL_ONLY_STORAGE_PREFIX)) {
      if (localChangesDuringMerge.has(key)) return;
      // Preserve the active-game tombstone so a later/offline startup cannot
      // resurrect a cloud snapshot that predates a save, freeze, or reset.
      const serialized = key === "activeGameState" && value === null
        ? "null"
        : serializeForLocalStorage(value);
      if (serialized === null) {
        if (localStorage.getItem(key) !== null) {
          localStorage.removeItem(key);
          localStorageUpdatedByMerge = true;
        }
      } else if (localStorage.getItem(key) !== serialized) {
        localStorage.setItem(key, serialized);
        localStorageUpdatedByMerge = true;
      }
    }
  });

  if (localChangesDuringMerge.size > 0) {
    const latestLocalData = {
      [GAME_DATA_RESET_FIELD]: resetMarker,
      timestamp: new Date().toISOString(),
    };
    let changedLocalData = {};
    localChangesDuringMerge.forEach((rawValue, key) => {
      changedLocalData[key] = rawValue === null
        ? null
        : deserializeLocalStorageValue(key, rawValue);
    });
    // A save made mid-merge still carries this device's pre-delete games.
    if (localWasStale) {
      const { kept, droppedKeys } = dropGameDataBefore(changedLocalData, cloudResetMarker);
      droppedKeys.forEach(key => { kept[key] = null; });
      GAME_DATA_KEYS.forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(kept, key)) return;
        if (JSON.stringify(kept[key]) === JSON.stringify(changedLocalData[key])) return;
        const serialized = key === "activeGameState" && kept[key] === null
          ? "null"
          : serializeForLocalStorage(kept[key]);
        if (serialized === null) localStorage.removeItem(key);
        else localStorage.setItem(key, serialized);
        localStorageUpdatedByMerge = true;
      });
      changedLocalData = kept;
    }
    // A removal recorded mid-merge is added to the joined records, not swapped for them.
    if (removedGamesSynced && Array.isArray(changedLocalData[REMOVED_GAMES_KEY])) {
      const removedGames = mergeRemovedGames(changedLocalData[REMOVED_GAMES_KEY], mergedData[REMOVED_GAMES_KEY]);
      changedLocalData[REMOVED_GAMES_KEY] = removedGames;
      const serialized = JSON.stringify(removedGames);
      if (localStorage.getItem(REMOVED_GAMES_KEY) !== serialized) localStorage.setItem(REMOVED_GAMES_KEY, serialized);
    }
    // A save, delete, freeze or resume made mid-merge stored this device's own
    // list, without the games the merge had just brought in from the cloud.
    // It is joined with the merged list (and its removals applied) here and in
    // the cloud; uploading it as it stands would erase those games from both.
    // A list that was cleared outright (Delete All Game Data) stays cleared.
    const removedGamesAfterMerge = removedGamesSynced
      ? changedLocalData[REMOVED_GAMES_KEY] || mergedData[REMOVED_GAMES_KEY] || []
      : [];
    REMOVABLE_GAME_LISTS.forEach(listKey => {
      if (!Array.isArray(changedLocalData[listKey])) return;
      const mergedList = Array.isArray(mergedData[listKey]) ? mergedData[listKey] : [];
      const joined = dropRemovedGames(
        listKey,
        joinGameLists(changedLocalData[listKey], mergedList),
        removedGamesAfterMerge,
      );
      changedLocalData[listKey] = joined;
      const serialized = JSON.stringify(joined);
      if (localStorage.getItem(listKey) !== serialized) {
        localStorage.setItem(listKey, serialized);
        localStorageUpdatedByMerge = true;
      }
    });
    Object.assign(latestLocalData, changedLocalData);
    if (!await writeGameFields(userId, latestLocalData, resetMarker)) return false;
    if (auth?.currentUser?.uid !== userId) return false;
  }

  if (!localStorageUpdatedByMerge) return true;

  const userInteractedDuringMerge = Number(
    window.getRookAppInteractionRevision?.() || 0,
  ) !== interactionRevisionAtStart;
  if (userInteractedDuringMerge) {
    console.info("Cloud sync completed without refreshing the active screen because the app is in use.");
    return true;
  }

  // Re-initialize state from potentially merged localStorage
  if (typeof performTeamPlayerMigration === 'function') performTeamPlayerMigration({ force: true });
  if (window.initializeTheme) window.initializeTheme();
  if (window.initializeCustomThemeColors) window.initializeCustomThemeColors();
  if (window.loadCurrentGameState) window.loadCurrentGameState();
  if (window.loadSettings) window.loadSettings();
  if (window.updateProModeUI) window.updateProModeUI(window.getLocalStorage?.('proModeEnabled', false));
  if (window.renderApp) window.renderApp();
  return true;
}

async function mergeUserDataForCurrentUser(user) {
  const userId = typeof user?.uid === "string" ? user.uid : "";
  if (!userId) return false;
  if (lastMergedAuthUid === userId) return true;
  if (firebaseMergePromises.has(userId)) return firebaseMergePromises.get(userId);

  const mergePromise = (async () => {
    try {
      for (let attempt = 1; ; attempt += 1) {
        const packedThisAttempt = canPackSavedGames();
        try {
          const merged = await window.mergeLocalStorageWithFirestore(user);
          if (merged && auth?.currentUser?.uid === userId) lastMergedAuthUid = userId;
          return merged;
        } catch (error) {
          // Another device deleted all game data between this merge's read and
          // write; one fresh merge picks up that delete. A merge whose packed
          // write was refused runs once more with the plain list.
          const packingJustRefused = packedThisAttempt && !canPackSavedGames();
          if ((!isStaleGameDataWrite(error) && !packingJustRefused) || attempt >= 2) throw error;
        }
      }
    } catch (error) {
      console.error("Firestore merge error:", error);
      trackSyncFailure("other", "merge_failed");
      if (isCloudDocumentFullError(error)) reportCloudDocumentFull();
      return false;
    } finally {
      firebaseMergePromises.delete(userId);
    }
  })();

  firebaseMergePromises.set(userId, mergePromise);
  return mergePromise;
}

window.signInWithGoogle = async function() {
  if ((!auth || !googleProvider) && typeof window.startFirebaseInitialization === "function") {
    await window.startFirebaseInitialization({ retry: Boolean(window.firebaseInitError) });
  }

  if (!auth || !googleProvider) {
    console.warn("Google sign-in is unavailable because Firebase is not configured.");
    trackSyncFailure("auth", "firebase_unavailable");
    window.showWarningToast?.("Sign-in isn't available right now.");
    return null;
  }

  try {
    const result = await signInWithPopup(auth, googleProvider);
    const googleUser = result.user;
    window.firebaseReady = true;
    updateAuthUI(googleUser);
    trackFirebaseEvent("auth_signed_in", { method: "google" });
    return googleUser;
  } catch (error) {
    console.error("Google sign-in failed:", error);
    trackSyncFailure("auth", "google_sign_in_failed");
    // Closing the popup is a choice, not a failure; anything else deserves a word.
    const closedByUser = error?.code === "auth/popup-closed-by-user" || error?.code === "auth/cancelled-popup-request";
    if (!closedByUser) window.showWarningToast?.("Couldn't sign in. Check your connection and try again.");
    if (window.renderApp) window.renderApp();
    return null;
  }
};

window.signOutUser = async function() {
  if (!auth) return;

  try {
    await signOut(auth);
    window.firebaseReady = false;
    // The onAuthStateChanged listener will trigger anonymous sign-in
  } catch (error) {
    console.error("Sign-out failed:", error);
  }
};

async function ensureUserSession() {
  if (!auth) return null;
  if (auth.currentUser) return auth.currentUser;

  try {
    const credential = await signInAnonymously(auth);
    return credential.user;
  } catch (error) {
    console.error("Failed to establish anonymous session for Firestore sync:", error);
    trackSyncFailure("auth", "anonymous_sign_in_failed");
    return null;
  }
}

// Writes that land within a short window are merged into one Firestore update,
// so saving settings or finishing a game costs one document write instead of
// one per storage key.
const SYNC_FLUSH_DELAY_MS = 250;
let pendingSync = null;
const syncByOwner = new Map();

async function flushPendingSync(batch) {
  const { values, owner, replace } = batch;
  const keys = [...values.keys()];

  if (!auth || !db) {
    console.warn("Firebase not initialized for sync.");
    keys.forEach(key => trackSyncFailure(key, "firebase_unavailable"));
    return false;
  }

  const user = auth.currentUser;
  if (!owner || user?.uid !== owner) return false;

  // Each write replaces a whole value. Until this session has merged with the
  // cloud copy, the local game lists may be missing games another device saved,
  // so writing them would erase those games from the cloud. The merge goes
  // first (again, if the one at startup failed); while it cannot run, nothing
  // is written and the next save tries again. "Delete All Game Data" is the
  // exception: it clears the lists on purpose and carries its own marker.
  if (lastMergedAuthUid !== user.uid && !values.has(GAME_DATA_RESET_FIELD) && !replace.size) {
    const merged = await mergeUserDataForCurrentUser(user);
    if (!merged || auth?.currentUser?.uid !== user.uid) {
      console.warn("Cloud sync is waiting for a first merge with the cloud copy; nothing was uploaded.");
      return false;
    }
    // The merge may have widened what is stored here; send the stored value.
    [...values.keys()].forEach(key => {
      const raw = localStorage.getItem(key);
      if (raw !== null) values.set(key, deserializeLocalStorageValue(key, raw));
    });
  }

  // The stored game lists are what gets uploaded. A merge that finished after
  // this write was queued may have joined cloud games into them, and the queued
  // copy would take those games back out of the cloud.
  if (!values.has(GAME_DATA_RESET_FIELD)) {
    [...REMOVABLE_GAME_LISTS, REMOVED_GAMES_KEY].forEach(key => {
      if (!values.has(key) || replace.has(key)) return;
      const raw = localStorage.getItem(key);
      if (raw !== null) values.set(key, deserializeLocalStorageValue(key, raw));
    });
  }

  // Every write names the delete it knows about. The security rules refuse a
  // write that predates the cloud's latest delete, so a device that missed the
  // delete cannot quietly upload the deleted games again.
  const agreedResetMarker = getAgreedGameDataResetMarker(user.uid);
  const resetMarker = values.has(GAME_DATA_RESET_FIELD)
    ? values.get(GAME_DATA_RESET_FIELD)
    : agreedResetMarker ?? "";
  const reset = values.delete(GAME_DATA_RESET_FIELD);
  try {
    const write = () => writeGameFields(owner, Object.fromEntries(values), resetMarker, { reset, replace });
    const packedThisWrite = canPackSavedGames();
    try {
      if (!await write()) return false;
    } catch (error) {
      if (!packedThisWrite || canPackSavedGames()) throw error;
      if (!await write()) return false;
    }
    if (auth?.currentUser?.uid !== owner) return false;
    const nextAgreedResetMarker = laterGameDataResetMarker(agreedResetMarker ?? "", resetMarker);
    if (nextAgreedResetMarker !== agreedResetMarker
        || readGameDataResetMarkers()?.lastUid !== user.uid) {
      rememberGameDataResetMarker(user.uid, nextAgreedResetMarker);
    }
    console.log(`Successfully synced ${keys.join(", ")} to Firestore.`);
    return true;
  } catch (error) {
    console.error("Firestore sync error:", error);
    keys.forEach(key => trackSyncFailure(key, "write_failed"));
    if (isCloudDocumentFullError(error)) reportCloudDocumentFull();
    // The local copy still holds these values; a fresh merge applies the newer
    // delete to them and uploads whatever survives it.
    if (isStaleGameDataWrite(error) && auth?.currentUser?.uid === user.uid) {
      if (lastMergedAuthUid === user.uid) lastMergedAuthUid = null;
      mergeUserDataForCurrentUser(user);
    }
    return false;
  }
}

function isStaleGameDataWrite(error) {
  return error?.code === "permission-denied";
}

function getPendingSyncBatch(owner) {
  if (pendingSync && pendingSync.owner === owner) return pendingSync;
  const batch = { owner, values: new Map(), replace: new Set() };
  batch.promise = new Promise(resolve => {
    setTimeout(() => {
      if (pendingSync === batch) pendingSync = null;
      // Finish older writes before newer saves, even when compression is slow.
      const previous = syncByOwner.get(owner) || Promise.resolve();
      const current = previous.catch(() => false).then(() => flushPendingSync(batch)).finally(() => {
        if (syncByOwner.get(owner) === current) syncByOwner.delete(owner);
      });
      syncByOwner.set(owner, current);
      resolve(current);
    }, SYNC_FLUSH_DELAY_MS);
  });
  pendingSync = batch;
  return batch;
}

window.syncGameDataReset = function(resetMarker, owner = auth?.currentUser?.uid) {
  if (!owner || auth?.currentUser?.uid !== owner || !parseGameDataResetTime(resetMarker)) return Promise.resolve(false);
  const batch = getPendingSyncBatch(owner);
  GAME_DATA_KEYS.forEach(key => batch.values.set(key, null));
  batch.values.set(GAME_DATA_RESET_FIELD, laterGameDataResetMarker(batch.values.get(GAME_DATA_RESET_FIELD), resetMarker));
  return batch.promise;
};

window.syncToFirestore = function(key, value, { replace = false } = {}) {
  const owner = auth?.currentUser?.uid;
  if (!owner || !isCloudSyncStorageKey(key)) return Promise.resolve(false);
  const batch = getPendingSyncBatch(owner);
  batch.values.set(key, value);
  if (replace) batch.replace.add(key);
  return batch.promise;
};

function isVoiceImprovementConsentEnabled() {
  if (typeof window.getLocalStorage === "function") {
    return window.getLocalStorage("experimentalFeaturesEnabled", false) === true
      && window.getLocalStorage("voiceImprovementOptIn", false) === true;
  }
  try {
    return JSON.parse(localStorage.getItem("experimentalFeaturesEnabled") || "false") === true
      && JSON.parse(localStorage.getItem("voiceImprovementOptIn") || "false") === true;
  } catch {
    return false;
  }
}

function sanitizeVoiceImprovementPlayerToken(value) {
  const token = String(value || "").trim();
  return /^Player (?:[1-9]\d{0,2})$/.test(token) ? token : "";
}

function sanitizeVoiceImprovementFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sanitizeVoiceImprovementStringList(values, sanitizer, maximum) {
  return (Array.isArray(values) ? values : [])
    .map(sanitizer)
    .filter(Boolean)
    .slice(0, maximum);
}

// The lazy voice bundle publishes the action catalog (js/modules/09-voice-tools.js).
// Samples only come from that bundle, so without it nothing is logged.
function getVoiceImprovementTools() {
  const tools = window.ROOK_VOICE_TOOLS;
  return tools && tools.actions && tools.fields ? tools : null;
}

function sanitizeVoiceImprovementAction(action, tools) {
  const allowedFields = action && typeof action === "object" ? tools.actions[action.type] : null;
  if (!Array.isArray(allowedFields)) return null;
  const safe = { type: action.type };

  allowedFields.forEach(key => {
    const field = tools.fields[key];
    const value = action[key];
    if (!field) return;
    if (field.kind === "enum") {
      if (field.schema.enum.includes(value)) safe[key] = value;
    } else if (field.kind === "number") {
      if (Number.isFinite(Number(value))) safe[key] = Number(value);
    } else if (field.kind === "boolean") {
      if (typeof value === "boolean") safe[key] = value;
    } else if (field.kind === "settingValue") {
      if (typeof value === "boolean" || Number.isFinite(value)) safe.value = value;
      else if (value === "loseBid" || value === "setPoints") safe.value = value;
    } else if (field.kind === "players") {
      safe[key] = sanitizeVoiceImprovementStringList(
        value,
        sanitizeVoiceImprovementPlayerToken,
        field.schema.maxItems,
      );
    } else if (field.kind === "player") {
      const token = sanitizeVoiceImprovementPlayerToken(value);
      if (token) safe[key] = token;
    } else if (field.kind === "text") {
      safe[key] = String(value || "")
        .trim()
        .slice(0, 100)
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
        .replace(/\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g, "[phone]");
    } else if (field.kind === "color") {
      if (/^#[0-9a-f]{6}$/i.test(value || "")) safe[key] = value.toLowerCase();
    } else if (field.kind === "numbers") {
      safe[key] = (Array.isArray(value) ? value : [])
        .map(Number)
        .filter(Number.isFinite)
        .slice(0, 12);
    } else if (field.kind === "entityKey" && /^(?:player|team)-(?:[1-9]\d{0,2})$/.test(value || "")) {
      safe[key] = value;
    }
  });

  return safe;
}

function sanitizeVoiceImprovementRound(round) {
  const candidate = round && typeof round === "object" ? round : {};
  return {
    roundIndex: sanitizeVoiceImprovementFiniteNumber(candidate.roundIndex),
    biddingTeam: candidate.biddingTeam === "us" || candidate.biddingTeam === "dem"
      ? candidate.biddingTeam
      : "",
    bidAmount: sanitizeVoiceImprovementFiniteNumber(candidate.bidAmount),
    usPoints: sanitizeVoiceImprovementFiniteNumber(candidate.usPoints),
    demPoints: sanitizeVoiceImprovementFiniteNumber(candidate.demPoints),
    runningTotals: {
      us: sanitizeVoiceImprovementFiniteNumber(candidate.runningTotals?.us),
      dem: sanitizeVoiceImprovementFiniteNumber(candidate.runningTotals?.dem),
    },
  };
}

function sanitizeVoiceImprovementContext(context) {
  const candidate = context && typeof context === "object" ? context : {};
  const sanitizeTeam = (team, label) => ({
    label,
    players: sanitizeVoiceImprovementStringList(
      team?.players,
      sanitizeVoiceImprovementPlayerToken,
      2,
    ),
  });
  const sanitizeIndexes = values => (Array.isArray(values) ? values : [])
    .map(Number)
    .filter(value => Number.isInteger(value) && value >= 0)
    .slice(0, 20);
  const statisticsTeams = (Array.isArray(candidate.statistics?.teams)
    ? candidate.statistics.teams
    : [])
    .slice(0, 100)
    .map((team, index) => ({
      key: `team-${index + 1}`,
      players: sanitizeVoiceImprovementStringList(
        team?.players,
        sanitizeVoiceImprovementPlayerToken,
        2,
      ),
    }));

  return {
    teams: {
      us: sanitizeTeam(candidate.teams?.us, "Us team"),
      dem: sanitizeTeam(candidate.teams?.dem, "Dem team"),
    },
    knownPlayers: sanitizeVoiceImprovementStringList(
      candidate.knownPlayers,
      sanitizeVoiceImprovementPlayerToken,
      100,
    ),
    totals: {
      us: sanitizeVoiceImprovementFiniteNumber(candidate.totals?.us),
      dem: sanitizeVoiceImprovementFiniteNumber(candidate.totals?.dem),
    },
    roundNumber: Math.max(1, Math.trunc(sanitizeVoiceImprovementFiniteNumber(candidate.roundNumber, 1))),
    gameOver: Boolean(candidate.gameOver),
    winner: candidate.winner === "us" || candidate.winner === "dem" ? candidate.winner : "",
    biddingTeam: candidate.biddingTeam === "us" || candidate.biddingTeam === "dem"
      ? candidate.biddingTeam
      : "",
    hasActiveBid: Boolean(candidate.hasActiveBid),
    bidAmount: sanitizeVoiceImprovementFiniteNumber(candidate.bidAmount),
    enterBidderPoints: Boolean(candidate.enterBidderPoints),
    dealers: sanitizeVoiceImprovementStringList(
      candidate.dealers,
      sanitizeVoiceImprovementPlayerToken,
      4,
    ),
    currentDealer: sanitizeVoiceImprovementPlayerToken(candidate.currentDealer),
    misdealCount: Math.max(0, Math.trunc(sanitizeVoiceImprovementFiniteNumber(candidate.misdealCount))),
    undoneRoundsCount: Math.max(0, Math.trunc(sanitizeVoiceImprovementFiniteNumber(candidate.undoneRoundsCount))),
    recentRounds: (Array.isArray(candidate.recentRounds) ? candidate.recentRounds : [])
      .slice(-5)
      .map(sanitizeVoiceImprovementRound),
    bidPresets: (Array.isArray(candidate.bidPresets) ? candidate.bidPresets : [])
      .map(Number)
      .filter(Number.isFinite)
      .slice(0, 12),
    library: {
      completedIndexes: sanitizeIndexes(candidate.library?.completedIndexes),
      freezerIndexes: sanitizeIndexes(candidate.library?.freezerIndexes),
    },
    statistics: {
      playerTokens: sanitizeVoiceImprovementStringList(
        candidate.statistics?.playerTokens,
        sanitizeVoiceImprovementPlayerToken,
        100,
      ),
      teams: statisticsTeams,
    },
    ui: {
      menuOpen: Boolean(candidate.ui?.menuOpen),
      openPanels: sanitizeVoiceImprovementStringList(
        candidate.ui?.openPanels,
        value => {
          const panel = String(value || "");
          return /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(panel) ? panel : "";
        },
        20,
      ),
    },
    settings: {
      mustWinByBid: Boolean(candidate.settings?.mustWinByBid),
      misdealHandling: Boolean(candidate.settings?.misdealHandling),
      proMode: Boolean(candidate.settings?.proMode),
      experimentalFeatures: Boolean(candidate.settings?.experimentalFeatures),
      tableTalkPenaltyType: candidate.settings?.tableTalkPenaltyType === "loseBid"
        ? "loseBid"
        : "setPoints",
      tableTalkPenaltyPoints: sanitizeVoiceImprovementFiniteNumber(
        candidate.settings?.tableTalkPenaltyPoints,
        180,
      ),
    },
  };
}

function sanitizeVoiceImprovementSample(sample) {
  const tools = getVoiceImprovementTools();
  if (!tools || !sample || typeof sample !== "object") return null;
  const prompt = String(sample.prompt || "").trim().slice(0, 1000);
  const status = String(sample.target?.status || "");
  const outcome = String(sample.outcome || "");
  if (!prompt
      || !tools.statuses.includes(status)
      || !tools.outcomes.includes(outcome)) {
    return null;
  }

  const actions = Array.isArray(sample.target?.actions)
    ? sample.target.actions
        .map(action => sanitizeVoiceImprovementAction(action, tools))
        .filter(Boolean)
        .slice(0, 5)
    : [];

  return {
    schemaVersion: 2,
    prompt,
    context: sanitizeVoiceImprovementContext(sample.context),
    target: {
      status,
      requiresConfirmation: Boolean(sample.target?.requiresConfirmation),
      actions,
    },
    outcome,
    model: String(sample.model || "unknown").slice(0, 120),
    revision: String(sample.revision || "unknown").slice(0, 80),
    appVersion: String(sample.appVersion || "").slice(0, 40),
    createdAt: new Date().toISOString(),
  };
}

function createVoiceImprovementSampleId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== "function") {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`;
  }
  const randomValues = new Uint32Array(4);
  cryptoApi.getRandomValues(randomValues);
  return `${Date.now().toString(36)}-${Array.from(randomValues, value => value.toString(36)).join("")}`;
}

window.logVoiceImprovementSample = async function(sample) {
  if (!isVoiceImprovementConsentEnabled()) return false;
  const sanitizedSample = sanitizeVoiceImprovementSample(sample);
  if (!sanitizedSample) return false;

  if ((!auth || !db) && typeof window.startFirebaseInitialization === "function") {
    await window.startFirebaseInitialization({ retry: Boolean(window.firebaseInitError) });
  }
  if (!auth || !db) return false;

  const user = await ensureUserSession();
  if (!user || !isVoiceImprovementConsentEnabled()) return false;

  try {
    await setDoc(
      doc(db, "voiceImprovement", user.uid, "samples", createVoiceImprovementSampleId()),
      sanitizedSample,
    );
    return true;
  } catch (error) {
    console.warn("Voice improvement sample could not be saved.", {
      code: error?.code || "VOICE_IMPROVEMENT_WRITE_FAILED",
    });
    return false;
  }
};

function watchAuthState() {
  let authTimeoutId = setTimeout(() => {
    console.log("Firebase auth timed out - likely offline or blocked.");
    window.firebaseReady = false;
    updateAuthUI(null);
    if (hasUserInteracted()) return;
    if (window.loadCurrentGameState) window.loadCurrentGameState();
    if (window.renderApp) window.renderApp();
  }, 5000);

  onAuthStateChanged(auth, (user) => {
    clearTimeout(authTimeoutId);
    if (user) {
      window.firebaseReady = true;
      updateAuthUI(user);
      mergeUserDataForCurrentUser(user);
    } else {
      lastMergedAuthUid = null;
      signInAnonymously(auth)
        .then((anonUserCredential) => {
          window.firebaseReady = true;
          updateAuthUI(anonUserCredential.user);
        })
        .catch((error) => {
          console.error("Anonymous sign-in failed:", error);
          trackSyncFailure("auth", "anonymous_sign_in_failed");
          window.firebaseReady = false;
          updateAuthUI(null);
          if (window.loadCurrentGameState) window.loadCurrentGameState();
          if (window.renderApp) window.renderApp();
        });
    }
  });
}

async function initializeFirebaseFromVercelEnv() {
  // Overlap the SDK download with the config request, but only import() once
  // the config has proven the network is reachable.
  const warmup = warmFirebaseModuleCache();
  const firebaseConfig = await loadFirebaseConfig();
  await warmup;
  await loadFirebaseLibraries();
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: 'select_account' });

  window.firebaseApp = app;
  window.firebaseAuth = auth;
  window.firestoreDB = db;
  window.googleProvider = googleProvider;
  window.firebaseConfigLoaded = true;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchAuthState, { once: true });
  } else {
    watchAuthState();
  }
}

function startFirebaseInitialization(options = {}) {
  const shouldRetry = Boolean(options.retry);
  if (shouldRetry && !auth) {
    window.firebaseInitPromise = null;
    window.firebaseInitError = null;
    window.firebaseConfigLoaded = false;
    firebaseLibraryPromise = null;
  }

  if (!window.firebaseInitPromise) {
    window.firebaseInitPromise = initializeFirebaseFromVercelEnv().catch(disableFirebase);
  }
  return window.firebaseInitPromise;
}

function scheduleFirebaseInitialization() {
  const startAfterAppLoad = () => {
    setTimeout(startFirebaseInitialization, 0);
  };

  if (document.readyState === "complete") {
    startAfterAppLoad();
    return;
  }

  window.addEventListener("load", startAfterAppLoad, { once: true });
}

window.firebaseInitPromise = null;
window.startFirebaseInitialization = startFirebaseInitialization;
// An app opened offline recovers cloud sync as soon as the network returns.
if (typeof window.addEventListener === "function") {
  window.addEventListener("online", () => {
    if (window.firebaseInitError && !auth) {
      startFirebaseInitialization({ retry: true });
    } else if (auth?.currentUser && lastMergedAuthUid !== auth.currentUser.uid) {
      // The merge at startup failed (no connection); uploads wait for it.
      mergeUserDataForCurrentUser(auth.currentUser);
    }
  });
}
scheduleFirebaseInitialization();
