import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

function onDomReady(callback) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback, { once: true });
    return;
  }
  callback();
}

function setAuthUiState({ enabled, label }) {
  onDomReady(() => {
    const authLabel = document.getElementById("authLabel");
    if (authLabel && typeof label === 'string') authLabel.textContent = label;

    const authBtn = document.getElementById("googleAuthBtn");
    if (authBtn) {
      authBtn.disabled = !enabled;
      if (enabled) authBtn.removeAttribute('aria-disabled');
      else authBtn.setAttribute('aria-disabled', 'true');
    }
  });
}

let app = null;
let auth = null;
let db = null;
let googleProvider = null;

window.firebaseReady = false;
window.firebaseConfigured = false;

async function loadFirebaseConfig() {
  if (typeof window !== 'undefined' && window.__FIREBASE_CONFIG__ && typeof window.__FIREBASE_CONFIG__ === 'object') {
    return window.__FIREBASE_CONFIG__;
  }

  try {
    const response = await fetch('js/firebase-config.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const parsed = await response.json();
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    return null;
  }
}

async function initializeFirebase() {
  try {
    const firebaseConfig = await loadFirebaseConfig();
    if (!firebaseConfig) {
      console.warn(
        "Firebase config not found. Cloud sync is disabled. Create `js/firebase-config.json` from `js/firebase-config.example.json`."
      );
      setAuthUiState({ enabled: false, label: "Cloud Sync Not Configured" });
      return;
    }

    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: 'select_account' });

    window.firebaseConfigured = true;
    setAuthUiState({ enabled: true, label: "Sign in with Google" });

    window.firebaseApp = app;
    window.firebaseAuth = auth;
    window.firestoreDB = db;
    window.firestoreDoc = doc; // Make Firestore 'doc' function globally available
    window.firestoreSetDoc = setDoc; // Make Firestore 'setDoc' function globally available
    window.firestoreGetDoc = getDoc;
    window.googleProvider = googleProvider;

    if (auth) startAuthStateListener();
  } catch (error) {
    console.error("Firebase initialization failed. Cloud sync is disabled.", error);
    window.firebaseReady = false;
    window.firebaseConfigured = false;
    setAuthUiState({ enabled: false, label: "Cloud Sync Unavailable" });
  }
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

function updateAuthUI(user) {
  if (!window.firebaseConfigured) {
    setAuthUiState({ enabled: false, label: "Cloud Sync Not Configured" });
    return;
  }
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

window.mergeLocalStorageWithFirestore = async function(user) {
  if (!db) return;
  const docRef = doc(db, "rookData", user.uid);
  const docSnap = await getDoc(docRef);
  let firestoreData = docSnap.exists() ? docSnap.data() : {};
  const localData = {};

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key.startsWith('firebase')) { // Avoid Firebase's own keys
      const rawValue = localStorage.getItem(key);
      localData[key] = deserializeLocalStorageValue(key, rawValue);
    }
  }

  if (window.getIndexedDbSnapshot) {
    try {
      const indexedDbData = await window.getIndexedDbSnapshot();
      if (indexedDbData && typeof indexedDbData === 'object') {
        Object.entries(indexedDbData).forEach(([key, value]) => {
          if (value !== undefined) localData[key] = value;
        });
      }
    } catch (error) {
      console.warn("Unable to read IndexedDB snapshot for merge:", error);
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

  // Update localStorage/IndexedDB with merged data
  for (const [key, value] of Object.entries(mergedData)) {
    if (key === "timestamp") continue;
    if (window.isIndexedDbKey?.(key)) {
      if (value === null || value === undefined) {
        if (window.removeIndexedDbValue) await window.removeIndexedDbValue(key);
      } else if (window.setIndexedDbValue) {
        await window.setIndexedDbValue(key, value);
      }
      continue;
    }
    const serialized = serializeForLocalStorage(value);
    if (serialized === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, serialized);
    }
  }

  // Re-initialize state from potentially merged localStorage
  if (typeof performTeamPlayerMigration === 'function') performTeamPlayerMigration();
  if (window.initializeTheme) window.initializeTheme();
  if (window.initializeCustomThemeColors) window.initializeCustomThemeColors();
  if (window.loadCurrentGameState) window.loadCurrentGameState();
  if (window.loadSettings) window.loadSettings();
  if (window.updateProModeUI) window.updateProModeUI(window.getLocalStorage?.('proModeEnabled', false));
  if (window.renderApp) window.renderApp();
}


window.signInWithGoogle = async function() {
  if (!auth || !googleProvider) {
    console.warn("Firebase not configured; Google sign-in is disabled.");
    return;
  }
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const googleUser = result.user;
    window.firebaseReady = true;
    updateAuthUI(googleUser);
    await window.mergeLocalStorageWithFirestore(googleUser); // Use the global one
  } catch (error) {
    console.error("Google sign-in failed:", error);
    if (window.renderApp) window.renderApp(); // Still render the app
  }
};

window.signOutUser = async function() {
  if (!auth) return;
  try {
    await signOut(auth);
    window.firebaseReady = false; // Or handle as anonymous
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
    await window.firestoreSetDoc( // Use global setDoc
      window.firestoreDoc(db, "rookData", userId), // Use global doc
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

function startAuthStateListener() {
  if (!auth) return;
  document.addEventListener('DOMContentLoaded', () => {
    let authTimeoutId = setTimeout(() => {
      console.log("Firebase auth timed out - likely offline or blocked.");
      window.firebaseReady = false;
      updateAuthUI(null);
      if (window.loadCurrentGameState) window.loadCurrentGameState();
      if (window.renderApp) window.renderApp();
    }, 5000); // 5 second timeout

    onAuthStateChanged(auth, (user) => {
      clearTimeout(authTimeoutId);
      if (user) {
        window.firebaseReady = true;
        updateAuthUI(user);
        window.mergeLocalStorageWithFirestore(user); // Use global one for all users
      } else {
        signInAnonymously(auth)
          .then((anonUserCredential) => {
            window.firebaseReady = true; // Firebase is working for anon
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
  }, { once: true });
}

initializeFirebase();
