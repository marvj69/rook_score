import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const SAME_ORIGIN_FIREBASE_CONFIG_URL = "/api/firebase-config";
const VERCEL_FIREBASE_CONFIG_URL = "https://rook-score.vercel.app/api/firebase-config";
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

window.firebaseReady = false;
window.firebaseConfigLoaded = false;
window.firebaseInitError = null;
window.firebaseApp = null;
window.firebaseAuth = null;
window.firestoreDB = null;
window.firestoreDoc = doc;
window.firestoreSetDoc = setDoc;
window.firestoreGetDoc = getDoc;
window.googleProvider = null;

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

function updateAuthUI(user) {
  const authLabel = document.getElementById("authLabel");
  if (!authLabel) return;
  authLabel.textContent = "Sign in with Google";
  authLabel.style.display = '';
  authLabel.style.alignItems = '';

  if (user && !user.isAnonymous) {
    const photoUrl = user.photoURL ? `<img src="${user.photoURL}" alt="Profile" style="display:inline-block;width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-left:8px;">` : '';
    authLabel.innerHTML = `Sign Out ${photoUrl}`.trim();
    authLabel.style.display = 'inline-flex';
    authLabel.style.alignItems = 'center';
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderLocalAppFallback, { once: true });
  } else {
    renderLocalAppFallback();
  }
}

async function loadFirebaseConfig() {
  const configUrl = GITHUB_PAGES_HOSTNAMES.has(window.location.hostname)
    ? VERCEL_FIREBASE_CONFIG_URL
    : SAME_ORIGIN_FIREBASE_CONFIG_URL;

  const response = await fetch(configUrl, {
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

window.mergeLocalStorageWithFirestore = async function(user) {
  if (!db) return false;

  const docRef = doc(db, "rookData", user.uid);
  const docSnap = await getDoc(docRef);
  let firestoreData = docSnap.exists() ? docSnap.data() : {};
  const localData = {};

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key.startsWith('firebase')) {
      const rawValue = localStorage.getItem(key);
      localData[key] = deserializeLocalStorageValue(key, rawValue);
    }
  }

  const mergedData = {};
  const allKeys = new Set([...Object.keys(localData), ...Object.keys(firestoreData)]);

  allKeys.forEach(key => {
    if (key === "timestamp") return;

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
  await setDoc(docRef, mergedData, { merge: true });

  // Update localStorage with merged data
  Object.entries(mergedData).forEach(([key, value]) => {
    if (key !== "timestamp") {
      const serialized = serializeForLocalStorage(value);
      if (serialized === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, serialized);
      }
    }
  });

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

window.signInWithGoogle = async function() {
  if (!auth || !googleProvider) {
    console.warn("Google sign-in is unavailable because Firebase is not configured.");
    return null;
  }

  try {
    const result = await signInWithPopup(auth, googleProvider);
    const googleUser = result.user;
    window.firebaseReady = true;
    updateAuthUI(googleUser);
    await window.mergeLocalStorageWithFirestore(googleUser);
    return googleUser;
  } catch (error) {
    console.error("Google sign-in failed:", error);
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
    return null;
  }
}

window.syncToFirestore = async function(key, value) {
  if (!auth || !db) {
    console.warn("Firebase not initialized for sync.");
    return false;
  }

  const user = await ensureUserSession();
  if (!user) {
    console.log("Unable to establish user session. Not syncing to Firestore.");
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
      window.mergeLocalStorageWithFirestore(user);
    } else {
      signInAnonymously(auth)
        .then((anonUserCredential) => {
          window.firebaseReady = true;
          updateAuthUI(anonUserCredential.user);
          window.mergeLocalStorageWithFirestore(anonUserCredential.user);
        })
        .catch((error) => {
          console.error("Anonymous sign-in failed:", error);
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

window.firebaseInitPromise = initializeFirebaseFromVercelEnv().catch(disableFirebase);
