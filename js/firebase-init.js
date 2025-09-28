const configuredBaseUrl = (window.APP_CONFIG?.apiBaseUrl || '').trim().replace(/\/$/, '');
const API_BASE_URL = configuredBaseUrl || (window.location.protocol === 'file:' ? 'http://localhost:4000' : '');
const SESSION_TOKEN_KEY = "cloudAuthToken";
const SESSION_USER_KEY = "cloudAuthUser";

const firebaseAuth = { currentUser: null };
window.firebaseAuth = firebaseAuth;
window.firebaseReady = false;

let authToken = null;
let googleClientId = null;
let googleLibraryPromise = null;
let googleInitialised = false;
let initialAuthResolved = false;

function buildApiUrl(path) {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}${path}`;
}

async function fetchJson(path, options = {}) {
  const response = await fetch(buildApiUrl(path), options);
  if (!response.ok) {
    const message = await safeReadError(response);
    throw new Error(message || `Request to ${path} failed with ${response.status}`);
  }
  return response.json();
}

async function authRequest(path, options = {}) {
  if (!authToken) {
    throw new Error('Not authenticated');
  }

  const headers = new Headers(options.headers || {});
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(buildApiUrl(path), { ...options, headers });
  if (response.status === 401) {
    await handleUnauthorized();
    throw new Error('Unauthorized');
  }
  if (!response.ok) {
    const message = await safeReadError(response);
    throw new Error(message || `Request to ${path} failed with ${response.status}`);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function safeReadError(response) {
  try {
    const data = await response.json();
    return data?.error || '';
  } catch (_) {
    try {
      return await response.text();
    } catch (err) {
      return err?.message || '';
    }
  }
}

function updateAuthUI(user) {
  const authLabel = document.getElementById('authLabel');
  if (!authLabel) return;

  authLabel.textContent = 'Sign in with Google';
  authLabel.style.display = '';
  authLabel.style.alignItems = '';

  if (user && !user.isAnonymous) {
    const photoUrl = user.photoURL ? `<img src="${user.photoURL}" alt="Profile" style="display:inline-block;width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-left:8px;">` : '';
    authLabel.innerHTML = `Sign Out ${photoUrl}`.trim();
    authLabel.style.display = 'inline-flex';
    authLabel.style.alignItems = 'center';
  }
}

function setCurrentUser(details) {
  if (details) {
    firebaseAuth.currentUser = {
      uid: details.uid,
      email: details.email || '',
      displayName: details.displayName || '',
      photoURL: details.photoURL || '',
      isAnonymous: false,
    };
  } else {
    firebaseAuth.currentUser = null;
  }
}

function storeSession(token, user) {
  authToken = token;
  if (token) {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  }

  if (user) {
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(SESSION_USER_KEY);
  }
}

async function waitForGoogleLibrary() {
  if (window.google?.accounts?.id) {
    return;
  }
  if (!googleLibraryPromise) {
    googleLibraryPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="gsi/client"]');
      const target = existing || document.createElement('script');
      if (!existing) {
        target.src = 'https://accounts.google.com/gsi/client';
        target.async = true;
        target.defer = true;
        document.head.appendChild(target);
      }
      target.addEventListener('load', () => resolve());
      target.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services library')));
    });
  }
  await googleLibraryPromise;
}

async function ensureGoogleInitialised() {
  if (googleInitialised) return;
  if (!googleClientId) {
    const config = await fetchJson('/config').catch((error) => {
      console.error('Failed to load backend config:', error);
      throw error;
    });
    googleClientId = config?.googleClientId;
  }
  if (!googleClientId) {
    throw new Error('Google client ID missing from backend config');
  }
  await waitForGoogleLibrary();
  window.google.accounts.id.initialize({
    client_id: googleClientId,
    callback: handleGoogleCredential,
    auto_select: false,
    cancel_on_tap_outside: true,
  });
  googleInitialised = true;
}

async function handleGoogleCredential(response) {
  const credential = response?.credential;
  if (!credential) {
    console.warn('Google sign-in returned no credential');
    updateAuthUI(firebaseAuth.currentUser);
    window.firebaseReady = true;
    return;
  }

  try {
    const { token, user } = await fetchJson('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });

    const sessionUser = {
      uid: user.id,
      email: user.email || '',
      displayName: user.name || '',
      photoURL: user.picture || '',
      isAnonymous: false,
    };

    storeSession(token, sessionUser);
    setCurrentUser(sessionUser);
    window.firebaseReady = true;
    updateAuthUI(sessionUser);
    initialAuthResolved = true;

    await window.mergeLocalStorageWithFirestore(sessionUser);
  } catch (error) {
    console.error('Google sign-in failed:', error);
    await handleUnauthorized();
  } finally {
    if (typeof window.renderApp === 'function') window.renderApp();
  }
}

async function handleUnauthorized() {
  storeSession(null, null);
  setCurrentUser(null);
  window.firebaseReady = true;
  updateAuthUI(null);
}

window.signInWithGoogle = async function signInWithGoogle() {
  try {
    await ensureGoogleInitialised();
    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        console.warn('Google sign-in prompt was not displayed:', notification.getNotDisplayedReason(), notification.getSkippedReason());
        window.firebaseReady = true;
        updateAuthUI(firebaseAuth.currentUser);
      }
    });
  } catch (error) {
    console.error('Failed to initiate Google sign-in:', error);
    window.firebaseReady = true;
    updateAuthUI(firebaseAuth.currentUser);
  }
};

window.signOutUser = async function signOutUser() {
  if (authToken) {
    try {
      await authRequest('/auth/signout', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    } catch (_) {
      // Ignore sign-out errors; we'll clear locally below
    }
  }
  await handleUnauthorized();
  initialAuthResolved = true;
  if (typeof window.loadCurrentGameState === 'function') window.loadCurrentGameState();
  if (typeof window.renderApp === 'function') window.renderApp();
};

function collectLocalStorage() {
  const ignored = new Set([SESSION_TOKEN_KEY, SESSION_USER_KEY]);
  const localData = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || ignored.has(key) || key.startsWith('cloudAuth') || key.startsWith('firebase')) {
      continue;
    }
    const value = localStorage.getItem(key);
    try {
      localData[key] = JSON.parse(value);
    } catch (_) {
      localData[key] = value;
    }
  }
  return localData;
}

function mergeData(localData, remoteData) {
  const mergedData = {};
  const allKeys = new Set([...Object.keys(localData), ...Object.keys(remoteData || {})]);

  allKeys.forEach((key) => {
    if (key === 'timestamp') return;
    const localValue = localData[key];
    const remoteValue = remoteData?.[key];

    if (key === 'activeGameState') {
      mergedData[key] = localValue || remoteValue || {};
      return;
    }

    if (Array.isArray(localValue) && Array.isArray(remoteValue) && (key === 'savedGames' || key === 'freezerGames')) {
      const combined = [...localValue, ...remoteValue];
      const uniqueMap = new Map();
      combined.forEach((item) => {
        if (!item) return;
        const uniqueKey = item.id || item.timestamp || JSON.stringify(item);
        if (!uniqueMap.has(uniqueKey)) {
          uniqueMap.set(uniqueKey, item);
        } else {
          const existing = uniqueMap.get(uniqueKey);
          if (item?.timestamp && existing?.timestamp && new Date(item.timestamp) > new Date(existing.timestamp)) {
            uniqueMap.set(uniqueKey, item);
          }
        }
      });
      mergedData[key] = Array.from(uniqueMap.values());
      return;
    }

    if (isPlainObject(localValue) && isPlainObject(remoteValue)) {
      mergedData[key] = { ...remoteValue, ...localValue };
      return;
    }

    mergedData[key] = localValue !== undefined ? localValue : remoteValue;
  });

  return mergedData;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function applyMergedData(mergedData) {
  const entries = Object.entries(mergedData || {});
  entries.forEach(([key, value]) => {
    if (key === 'timestamp') return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn(`Failed to persist merged value for ${key}:`, error);
    }
  });
}

window.mergeLocalStorageWithFirestore = async function mergeLocalStorageWithFirestore(user) {
  if (!authToken || !user || user.isAnonymous) return;
  try {
    const remoteResponse = await authRequest('/api/data', { method: 'GET' });
    const remoteData = remoteResponse?.data || {};
    const localData = collectLocalStorage();
    const mergedData = mergeData(localData, remoteData);

    mergedData.timestamp = new Date().toISOString();

    await authRequest('/api/data', {
      method: 'PUT',
      body: JSON.stringify({ data: mergedData }),
    });

    applyMergedData(mergedData);

    if (typeof window.performTeamPlayerMigration === 'function') window.performTeamPlayerMigration();
    if (typeof window.loadCurrentGameState === 'function') window.loadCurrentGameState();
    if (typeof window.renderApp === 'function') window.renderApp();
  } catch (error) {
    console.error('Failed to merge with cloud storage:', error);
  }
};

window.syncToFirestore = async function syncToFirestore(key, value) {
  if (!authToken || !firebaseAuth.currentUser) {
    return false;
  }
  try {
    await authRequest('/api/data', {
      method: 'PATCH',
      body: JSON.stringify({ key, value }),
    });
    return true;
  } catch (error) {
    console.error('Cloud sync error:', error);
    return false;
  }
};

async function restoreSession() {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  const storedUserRaw = localStorage.getItem(SESSION_USER_KEY);
  if (!token || !storedUserRaw) {
    return false;
  }

  try {
    const storedUser = JSON.parse(storedUserRaw);
    storeSession(token, storedUser);
    setCurrentUser(storedUser);
    await window.mergeLocalStorageWithFirestore(storedUser);
    updateAuthUI(storedUser);
    window.firebaseReady = true;
    initialAuthResolved = true;
    return true;
  } catch (error) {
    console.warn('Failed to restore previous session:', error);
    await handleUnauthorized();
    return false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const fallbackTimer = setTimeout(() => {
    if (initialAuthResolved) return;
    window.firebaseReady = true;
    updateAuthUI(firebaseAuth.currentUser);
    initialAuthResolved = true;
    if (typeof window.loadCurrentGameState === 'function') window.loadCurrentGameState();
    if (typeof window.renderApp === 'function') window.renderApp();
  }, 4000);

  restoreSession()
    .catch(() => false)
    .finally(() => {
      clearTimeout(fallbackTimer);
      if (!initialAuthResolved) {
        window.firebaseReady = true;
        initialAuthResolved = true;
        updateAuthUI(firebaseAuth.currentUser);
        if (typeof window.loadCurrentGameState === 'function') window.loadCurrentGameState();
        if (typeof window.renderApp === 'function') window.renderApp();
      }
    });
});
