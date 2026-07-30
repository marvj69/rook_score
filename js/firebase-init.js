const SAME_ORIGIN_FIREBASE_CONFIG_URL = "/api/firebase-config";
const VERCEL_FIREBASE_CONFIG_URL = "https://rook-score.vercel.app/api/firebase-config";
const FIREBASE_APP_MODULE_URL = "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
const FIREBASE_AUTH_MODULE_URL = "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
const FIREBASE_FIRESTORE_MODULE_URL = "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
const FIREBASE_CONFIG_TIMEOUT_MS = 3500;
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
const VOICE_IMPROVEMENT_ACTION_TYPES = new Set([
  "scoreRound",
  "editRound",
  "undo",
  "redo",
  "misdeal",
  "newGame",
  "freezeGame",
  "saveGame",
  "openModal",
  "closeModal",
  "setDealerOrder",
  "startPaperGame",
  "setTeams",
  "selectDealerPair",
  "selectBid",
  "setSetting",
  "tableTalkPenalty",
  "rematch",
  "toggleMenu",
  "authAction",
  "confirmationAction",
  "gameLibraryAction",
  "setThemeColors",
  "themeAction",
  "setBidPresets",
  "setStatsControls",
  "noop",
]);
const VOICE_IMPROVEMENT_PLAN_STATUSES = new Set(["execute", "confirm", "clarify", "unsupported"]);
const VOICE_IMPROVEMENT_OUTCOMES = new Set(["success", "failed", "cancelled", "clarify", "unsupported"]);
const VOICE_IMPROVEMENT_ACTION_FIELDS = {
  scoreRound: ["biddingTeam", "bidAmount", "points", "enterBidderPoints"],
  editRound: ["roundNumber", "bidAmount", "usTotal", "demTotal"],
  undo: [],
  redo: [],
  misdeal: [],
  newGame: [],
  freezeGame: [],
  saveGame: [],
  openModal: ["target"],
  closeModal: ["target"],
  setDealerOrder: ["dealers"],
  startPaperGame: ["usScore", "demScore", "usPlayers", "demPlayers"],
  setTeams: ["usPlayers", "demPlayers"],
  selectDealerPair: ["pair"],
  selectBid: ["biddingTeam", "bidAmount"],
  setSetting: ["key", "value"],
  tableTalkPenalty: ["team"],
  rematch: ["firstDealer"],
  toggleMenu: ["open"],
  authAction: ["authAction"],
  confirmationAction: ["confirmationChoice"],
  gameLibraryAction: ["gameAction", "gameType", "tab", "query", "sort", "index"],
  setThemeColors: ["usColor", "demColor"],
  themeAction: ["themeAction"],
  setBidPresets: ["presets"],
  setStatsControls: ["statsView", "statsMetric", "statsSort", "entityMode", "entityKey"],
  noop: [],
};

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

function isCloudSyncStorageKey(key) {
  return typeof key === "string"
    && key !== "timestamp"
    && !key.startsWith(LOCAL_ONLY_STORAGE_PREFIX)
    && !key.toLowerCase().startsWith("firebase");
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

function renderLocalAppFallback() {
  updateAuthUI(null);
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

  const response = await fetchWithTimeout(configUrl, {
    cache: "no-store",
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
      mergedData[key] = localValue || firestoreValue || window.DEFAULT_STATE || {}; // Ensure some default
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
    } else if (typeof localValue === 'object' && localValue !== null && typeof firestoreValue === 'object' && firestoreValue !== null) {
      // Simple object merge, local overrides remote for simple key-value settings
      mergedData[key] = { ...firestoreValue, ...localValue };
    } else {
      // Default to local if present, else remote, else undefined
      mergedData[key] = localValue !== undefined ? localValue : firestoreValue;
    }
  });

  mergedData.timestamp = new Date().toISOString();
  if (auth?.currentUser?.uid !== userId) return false;
  await setDoc(docRef, mergedData, { merge: true });
  if (auth?.currentUser?.uid !== userId) return false;
  const localChangesDuringMerge = getCloudSyncStorageChanges(localRawSnapshot);

  // Update localStorage with merged data
  let localStorageUpdatedByMerge = false;
  Object.entries(mergedData).forEach(([key, value]) => {
    if (key !== "timestamp" && !key.startsWith(LOCAL_ONLY_STORAGE_PREFIX)) {
      if (localChangesDuringMerge.has(key)) return;
      const serialized = serializeForLocalStorage(value);
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
  if (typeof performTeamPlayerMigration === 'function') performTeamPlayerMigration();
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

window.syncToFirestore = async function(key, value) {
  if (!auth || !db) {
    console.warn("Firebase not initialized for sync.");
    trackSyncFailure(key, "firebase_unavailable");
    return false;
  }

  const user = await ensureUserSession();
  if (!user) {
    console.log("Unable to establish user session. Not syncing to Firestore.");
    trackSyncFailure(key, "auth_unavailable");
    return false;
  }

  try {
    const userId = user.uid;
    await setDoc(
      doc(db, "rookData", userId),
      { [key]: value, timestamp: new Date().toISOString() },
      { merge: true }
    );
    console.log(`Successfully synced ${key} to Firestore.`);
    return true;
  } catch (error) {
    console.error("Firestore sync error:", error);
    trackSyncFailure(key, "write_failed");
    return false;
  }
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

function sanitizeVoiceImprovementAction(action) {
  if (!action || typeof action !== "object" || !VOICE_IMPROVEMENT_ACTION_TYPES.has(action.type)) {
    return null;
  }
  const allowedFields = VOICE_IMPROVEMENT_ACTION_FIELDS[action.type] || [];
  const safe = { type: action.type };
  const enumValues = {
    biddingTeam: ["us", "dem"],
    team: ["us", "dem"],
    target: [
      "savedGames", "settings", "about", "statistics", "dealerOrder",
      "teamSelection", "resumeGame", "theme", "presets", "probability",
      "version", "confirmation", "all",
    ],
    pair: ["13", "24"],
    key: [
      "mustWinByBid", "misdealHandling", "proMode", "experimentalFeatures",
      "tableTalkPenaltyType", "tableTalkPenaltyPoints",
    ],
    authAction: ["toggle", "signIn", "signOut"],
    confirmationChoice: ["confirm", "cancel"],
    gameAction: ["switchTab", "search", "sort", "view", "delete", "resume"],
    gameType: ["completed", "freezer"],
    tab: ["completed", "freezer"],
    sort: ["newest", "oldest", "highest", "lowest"],
    themeAction: ["randomize", "reset", "apply"],
    statsView: ["teams", "players"],
    statsMetric: [
      "netPerGame", "bidMakePct", "setsForced", "comebacks",
      "closeWins", "perfect360s", "misdeals", "games",
    ],
    statsSort: ["recent", "most", "least"],
    entityMode: ["teams", "players"],
  };
  const numberFields = new Set([
    "bidAmount", "points", "roundNumber", "usTotal", "demTotal",
    "usScore", "demScore", "index",
  ]);

  allowedFields.forEach(key => {
    const value = action[key];
    if (enumValues[key]?.includes(value)) {
      safe[key] = value;
    } else if (numberFields.has(key) && Number.isFinite(Number(value))) {
      safe[key] = Number(value);
    } else if ((key === "enterBidderPoints" || key === "open") && typeof value === "boolean") {
      safe[key] = value;
    } else if (key === "value") {
      if (typeof value === "boolean" || Number.isFinite(value)) safe.value = value;
      else if (value === "loseBid" || value === "setPoints") safe.value = value;
    } else if (key === "dealers" || key === "usPlayers" || key === "demPlayers") {
      safe[key] = sanitizeVoiceImprovementStringList(
        value,
        sanitizeVoiceImprovementPlayerToken,
        key === "dealers" ? 4 : 2,
      );
    } else if (key === "firstDealer") {
      const token = sanitizeVoiceImprovementPlayerToken(value);
      if (token) safe.firstDealer = token;
    } else if (key === "query") {
      safe.query = String(value || "")
        .trim()
        .slice(0, 100)
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
        .replace(/\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g, "[phone]");
    } else if (key === "usColor" || key === "demColor") {
      if (/^#[0-9a-f]{6}$/i.test(value || "")) safe[key] = value.toLowerCase();
    } else if (key === "presets") {
      safe.presets = (Array.isArray(value) ? value : [])
        .map(Number)
        .filter(Number.isFinite)
        .slice(0, 12);
    } else if (key === "entityKey" && /^(?:player|team)-(?:[1-9]\d{0,2})$/.test(value || "")) {
      safe.entityKey = value;
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
  if (!sample || typeof sample !== "object") return null;
  const prompt = String(sample.prompt || "").trim().slice(0, 1000);
  const status = String(sample.target?.status || "");
  const outcome = String(sample.outcome || "");
  if (!prompt
      || !VOICE_IMPROVEMENT_PLAN_STATUSES.has(status)
      || !VOICE_IMPROVEMENT_OUTCOMES.has(outcome)) {
    return null;
  }

  const actions = Array.isArray(sample.target?.actions)
    ? sample.target.actions
        .map(sanitizeVoiceImprovementAction)
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
  const firebaseConfig = await loadFirebaseConfig();
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
scheduleFirebaseInitialization();
