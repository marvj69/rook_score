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
  const docRef = doc(db, "rookData", user.uid);
  const docSnap = await getDoc(docRef);
  if (auth?.currentUser?.uid !== userId) return false;
  const firestoreData = docSnap.exists() ? docSnap.data() : {};
  const localRawSnapshot = captureCloudSyncStorageSnapshot();
  const localData = {};

  localRawSnapshot.forEach((rawValue, key) => {
    localData[key] = deserializeLocalStorageValue(key, rawValue);
  });

  const mergedData = {};
  const allKeys = new Set([...Object.keys(localData), ...Object.keys(firestoreData)]);

  allKeys.forEach(key => {
    if (!isCloudSyncStorageKey(key)) return;

    const localValue = localData[key];
    const firestoreValue = firestoreData[key];

    // Prioritize local data for active game to avoid overwriting unsaved changes
    // For other items like savedGames, attempt a merge or use the most recent
    if (key === "activeGameState") { // ACTIVE_GAME_KEY from main script
      // Local wins so unsaved progress is never overwritten; a device with no
      // game does not persist an empty one.
      if (localRawSnapshot.has(key)) mergedData[key] = localValue;
      else if (firestoreValue !== undefined) mergedData[key] = firestoreValue;
    } else if (Array.isArray(localValue) && Array.isArray(firestoreValue) && (key === "savedGames" || key === "freezerGames")) {
      // Merge arrays of games, ensuring uniqueness by timestamp or a unique ID if available
      const combined = [...localValue, ...firestoreValue];
      const uniqueMap = new Map();
      combined.forEach(item => {
        // Prefer item.id or item.timestamp for uniqueness
        const uniqueKey = item.id || item.timestamp || JSON.stringify(item); // Fallback to stringify
        if (!uniqueMap.has(uniqueKey)) {
          uniqueMap.set(uniqueKey, item);
        } else {
          // Basic conflict resolution: take the one with a later timestamp if available
          const existingItem = uniqueMap.get(uniqueKey);
          if (item.timestamp && existingItem.timestamp && new Date(item.timestamp) > new Date(existingItem.timestamp)) {
            uniqueMap.set(uniqueKey, item);
          }
          // More complex merging could be done here if needed
        }
      });
      mergedData[key] = Array.from(uniqueMap.values());
    } else if (Array.isArray(localValue) || Array.isArray(firestoreValue)) {
      // Lists such as custom bid presets are replaced whole; spreading them into
      // an object would turn [120, 125] into {0: 120, 1: 125}.
      mergedData[key] = Array.isArray(localValue) ? localValue : firestoreValue;
    } else if (typeof localValue === 'object' && localValue !== null && typeof firestoreValue === 'object' && firestoreValue !== null) {
      // Simple object merge, local overrides remote for simple key-value settings
      mergedData[key] = { ...firestoreValue, ...localValue };
    } else {
      // Default to local if present, else remote, else undefined
      mergedData[key] = localValue !== undefined ? localValue : firestoreValue;
    }
  });

  // Only send what differs from the cloud copy: an unchanged startup merge
  // costs no document write.
  const payload = {};
  Object.entries(mergedData).forEach(([key, value]) => {
    if (JSON.stringify(value) !== JSON.stringify(firestoreData[key])) payload[key] = value;
  });
  if (auth?.currentUser?.uid !== userId) return false;
  if (Object.keys(payload).length) {
    await setDoc(docRef, { ...payload, timestamp: new Date().toISOString() }, { merge: true });
  }
  if (auth?.currentUser?.uid !== userId) return false;
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
    const latestLocalData = { timestamp: new Date().toISOString() };
    localChangesDuringMerge.forEach((rawValue, key) => {
      latestLocalData[key] = rawValue === null
        ? null
        : deserializeLocalStorageValue(key, rawValue);
    });
    await setDoc(docRef, latestLocalData, { merge: true });
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
      const merged = await window.mergeLocalStorageWithFirestore(user);
      if (merged && auth?.currentUser?.uid === userId) lastMergedAuthUid = userId;
      return merged;
    } catch (error) {
      console.error("Firestore merge error:", error);
      trackSyncFailure("other", "merge_failed");
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
let pendingSyncValues = new Map();
let pendingSyncFlush = null;

async function flushPendingSync() {
  const values = pendingSyncValues;
  pendingSyncValues = new Map();
  pendingSyncFlush = null;
  const keys = [...values.keys()];

  if (!auth || !db) {
    console.warn("Firebase not initialized for sync.");
    keys.forEach(key => trackSyncFailure(key, "firebase_unavailable"));
    return false;
  }

  const user = await ensureUserSession();
  if (!user) {
    console.log("Unable to establish user session. Not syncing to Firestore.");
    keys.forEach(key => trackSyncFailure(key, "auth_unavailable"));
    return false;
  }

  try {
    await setDoc(
      doc(db, "rookData", user.uid),
      { ...Object.fromEntries(values), timestamp: new Date().toISOString() },
      { merge: true }
    );
    console.log(`Successfully synced ${keys.join(", ")} to Firestore.`);
    return true;
  } catch (error) {
    console.error("Firestore sync error:", error);
    keys.forEach(key => trackSyncFailure(key, "write_failed"));
    return false;
  }
}

window.syncToFirestore = function(key, value) {
  if (!isCloudSyncStorageKey(key)) return Promise.resolve(false);
  pendingSyncValues.set(key, value);
  if (!pendingSyncFlush) {
    pendingSyncFlush = new Promise(resolve => {
      setTimeout(() => resolve(flushPendingSync()), SYNC_FLUSH_DELAY_MS);
    });
  }
  return pendingSyncFlush;
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
    if (window.firebaseInitError && !auth) startFirebaseInitialization({ retry: true });
  });
}
scheduleFirebaseInitialization();
