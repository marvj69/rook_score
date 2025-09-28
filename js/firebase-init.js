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
    try {
        localData[key] = JSON.parse(localStorage.getItem(key));
    } catch (e) {
        console.warn(`Could not parse localStorage key ${key}:`, e);
        localData[key] = localStorage.getItem(key); // Store as raw string if parse fails
    }
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
    localStorage.setItem(key, JSON.stringify(value));
}
  });

  // Re-initialize state from potentially merged localStorage
  if (typeof performTeamPlayerMigration === 'function') performTeamPlayerMigration();
  if (window.loadCurrentGameState) window.loadCurrentGameState(); 
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

window.syncToFirestore = async function(key, value) {
  if (!window.firebaseAuth || !window.firestoreDB) {
    console.warn("Firebase not initialized for sync.");
    return false;
  }
  if (!window.firebaseAuth.currentUser) {
    console.log("User not authenticated. Not syncing to Firestore.");
    return false;
  }
  try {
    const userId = window.firebaseAuth.currentUser.uid;
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
    if (!user.isAnonymous) {
        window.mergeLocalStorageWithFirestore(user); // Use global one
    } else {
        // For anonymous users, just load local state. Sync up happens if they sign in.
        if (window.loadCurrentGameState) window.loadCurrentGameState();
        if (window.renderApp) window.renderApp();
    }
} else {
    signInAnonymously(auth)
        .then((anonUserCredential) => {
            window.firebaseReady = true; // Firebase is working for anon
            updateAuthUI(anonUserCredential.user);
            if (window.loadCurrentGameState) window.loadCurrentGameState();
            if (window.renderApp) window.renderApp();
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
