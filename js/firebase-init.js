import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB_DmalmDfoluZ4HSerI9f8vA70XMGvksY", // This key is public and safe to expose client-side
  authDomain: "rookscore-dadfd.firebaseapp.com",
  projectId: "rookscore-dadfd",
  storageBucket: "rookscore-dadfd.firebasestorage.app",
  messagingSenderId: "395153935926",
  appId: "1:395153935926:web:d76dbb239473f861159297",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

window.firebaseApp = app;
window.firebaseAuth = auth;
window.firestoreDB = db;
window.firestoreDoc = doc; // Make Firestore 'doc' function globally available
window.firestoreSetDoc = setDoc; // Make Firestore 'setDoc' function globally available
window.firestoreGetDoc = getDoc;
window.googleProvider = googleProvider;

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

window.mergeLocalStorageWithFirestore = async function(user) {
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
}


window.signInWithGoogle = async function() {
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
  try {
    await signOut(auth);
    window.firebaseReady = false; // Or handle as anonymous
    // The onAuthStateChanged listener will trigger anonymous sign-in
  } catch (error) {
    console.error("Sign-out failed:", error);
  }
};

async function ensureUserSession() {
  if (!window.firebaseAuth) return null;
  if (window.firebaseAuth.currentUser) return window.firebaseAuth.currentUser;

  try {
    const credential = await signInAnonymously(window.firebaseAuth);
    return credential.user;
  } catch (error) {
    console.error("Failed to establish anonymous session for Firestore sync:", error);
    return null;
  }
}

window.syncToFirestore = async function(key, value) {
  if (!window.firebaseAuth || !window.firestoreDB) {
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
      window.firestoreDoc(window.firestoreDB, "rookData", userId), // Use global doc
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

// Initial Auth State Handling
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
});
