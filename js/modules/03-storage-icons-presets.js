"use strict";

// --- Local Storage & Sync ---
function setLocalStorage(key, value, { sync = true } = {}) {
  try {
    const serialized = JSON.stringify(value);
    localStorage.setItem(key, serialized);
    LOCAL_STORAGE_CACHE.set(key, { raw: serialized, parsed: value });
    if (key === "savedGames") {
      if (typeof invalidateProbabilityCachesForGames === "function") invalidateProbabilityCachesForGames(value);
      if (typeof clearStatisticsCache === "function") clearStatisticsCache();
    }
    if (sync && !key.startsWith(LOCAL_ONLY_STORAGE_PREFIX)
        && window.syncToFirestore && window.firebaseReady && window.firebaseAuth?.currentUser) {
      // Non-blocking sync
      setTimeout(() => {
        window.syncToFirestore(key, value).catch(err => console.warn(`Firestore sync failed for ${key}:`, err));
      }, 0);
    }
  } catch (error) {
    console.error(`Error in setLocalStorage for key ${key}:`, error);
  }
}

function removeLocalStorageKey(key) {
  try {
    localStorage.removeItem(key);
    LOCAL_STORAGE_CACHE.delete(key);
    if (key === "savedGames") {
      if (typeof invalidateProbabilityCachesForGames === "function") invalidateProbabilityCachesForGames();
      if (typeof clearStatisticsCache === "function") clearStatisticsCache();
    }
    if (!key.startsWith(LOCAL_ONLY_STORAGE_PREFIX)
        && window.syncToFirestore && window.firebaseReady && window.firebaseAuth?.currentUser) {
      setTimeout(() => {
        window.syncToFirestore(key, null).catch(err => console.warn(`Firestore removal sync failed for ${key}:`, err));
      }, 0);
    }
  } catch (error) {
    console.error(`Error removing localStorage key ${key}:`, error);
  }
}

function shouldAttemptJsonParse(raw) {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const first = trimmed[0];
  if (first === '{' || first === '[' || first === '"') return true;
  if (trimmed === 'true' || trimmed === 'false' || trimmed === 'null') return true;
  return /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed);
}

function getLocalStorage(key, defaultValue = null) {
  const raw = localStorage.getItem(key);
  if (raw === null) {
    LOCAL_STORAGE_CACHE.delete(key);
    if (defaultValue !== null) return defaultValue;
    if (key === "savedGames" || key === "freezerGames") return [];
    return {};
  }
  const cached = LOCAL_STORAGE_CACHE.get(key);
  if (cached && cached.raw === raw) return cached.parsed;
  if (!shouldAttemptJsonParse(raw)) {
    LOCAL_STORAGE_CACHE.set(key, { raw, parsed: raw });
    return raw;
  }
  try {
    const parsed = JSON.parse(raw);
    LOCAL_STORAGE_CACHE.set(key, { raw, parsed });
    return parsed;
  } catch (e) {
    if (defaultValue !== null) return defaultValue;
    if (key === "savedGames" || key === "freezerGames") return [];
    return {};
  }
}

function isFirebaseInternalStorageKey(key) {
  return typeof key === "string" && key.toLowerCase().startsWith("firebase");
}

function isCloudSyncStorageKey(key) {
  return typeof key === "string"
    && key !== "timestamp"
    && !key.startsWith(LOCAL_ONLY_STORAGE_PREFIX)
    && !isFirebaseInternalStorageKey(key);
}

function captureCloudSyncStorageSnapshot(storage = localStorage) {
  const snapshot = new Map();
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (isCloudSyncStorageKey(key)) {
      snapshot.set(key, storage.getItem(key));
    }
  }
  return snapshot;
}

function getCloudSyncStorageChanges(snapshot, storage = localStorage) {
  const before = snapshot instanceof Map ? snapshot : new Map();
  const current = captureCloudSyncStorageSnapshot(storage);
  const keys = new Set([...before.keys(), ...current.keys()]);
  const changes = new Map();

  keys.forEach(key => {
    const previousRaw = before.has(key) ? before.get(key) : null;
    const currentRaw = current.has(key) ? current.get(key) : null;
    if (previousRaw !== currentRaw) changes.set(key, currentRaw);
  });

  return changes;
}

function getAppStorageEntries(storage = localStorage) {
  const entries = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (typeof key !== "string" || isFirebaseInternalStorageKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) entries.push({ key, value });
  }
  return entries.sort((left, right) => left.key.localeCompare(right.key));
}

function buildGameDataExport(storage = localStorage, exportedAt = new Date(), activeGameSnapshot = null) {
  const timestamp = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
  const storageEntries = getAppStorageEntries(storage);
  if (activeGameSnapshot && typeof activeGameSnapshot === "object") {
    const activeGameEntry = {
      key: ACTIVE_GAME_KEY,
      value: JSON.stringify(activeGameSnapshot),
    };
    const existingIndex = storageEntries.findIndex(({ key }) => key === ACTIVE_GAME_KEY);
    if (existingIndex >= 0) storageEntries[existingIndex] = activeGameEntry;
    else storageEntries.push(activeGameEntry);
    storageEntries.sort((left, right) => left.key.localeCompare(right.key));
  }
  return {
    format: GAME_DATA_EXPORT_FORMAT,
    version: GAME_DATA_EXPORT_VERSION,
    appVersion: APP_VERSION,
    exportedAt: timestamp.toISOString(),
    storage: storageEntries,
  };
}

function getCurrentGameExportSnapshot(gameState = state, now = Date.now()) {
  if (!gameState || typeof gameState !== "object") return null;
  const checkpoint = buildCurrentGameTimerCheckpoint(gameState, now);
  return {
    ...checkpoint,
    isSubmittingRound: false,
    startingTotals: sanitizeTotals(gameState.startingTotals),
  };
}

function normalizeImportedStorageEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("This file does not contain Rook Score game data.");
  }
  if (entries.length > 1000) {
    throw new Error("This game data file contains too many storage entries.");
  }

  const seenKeys = new Set();
  let totalCharacters = 0;
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("This game data file contains an invalid storage entry.");
    }
    const { key, value } = entry;
    if (typeof key !== "string" || !key || key.length > 256) {
      throw new Error("This game data file contains an invalid storage key.");
    }
    if (isFirebaseInternalStorageKey(key)) {
      throw new Error("This game data file contains protected sign-in data.");
    }
    if (seenKeys.has(key)) {
      throw new Error(`This game data file contains the key "${key}" more than once.`);
    }
    if (typeof value !== "string") {
      throw new Error(`The saved value for "${key}" is invalid.`);
    }
    seenKeys.add(key);
    totalCharacters += key.length + value.length;
    if (totalCharacters > MAX_GAME_DATA_IMPORT_BYTES) {
      throw new Error("This game data file is too large.");
    }
    return { key, value };
  });
}

function parseGameDataImport(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("The selected file is empty.");
  }
  if (text.length > MAX_GAME_DATA_IMPORT_BYTES) {
    throw new Error("The selected file is too large.");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || parsed.format !== GAME_DATA_EXPORT_FORMAT) {
    throw new Error("The selected file is not a Rook Score game data export.");
  }
  if (parsed.version !== GAME_DATA_EXPORT_VERSION) {
    throw new Error(`This Rook Score game data version is not supported (version ${String(parsed.version)}).`);
  }

  return {
    format: parsed.format,
    version: parsed.version,
    appVersion: typeof parsed.appVersion === "string" ? parsed.appVersion : "",
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : "",
    storage: normalizeImportedStorageEntries(parsed.storage),
  };
}

function replaceAppStorage(entries, storage = localStorage) {
  const nextEntries = normalizeImportedStorageEntries(entries);
  const previousEntries = getAppStorageEntries(storage);

  const removeAppEntries = () => {
    getAppStorageEntries(storage).forEach(({ key }) => storage.removeItem(key));
  };

  try {
    removeAppEntries();
    nextEntries.forEach(({ key, value }) => storage.setItem(key, value));
  } catch (error) {
    try {
      removeAppEntries();
      previousEntries.forEach(({ key, value }) => storage.setItem(key, value));
    } catch (rollbackError) {
      console.error("Could not restore the previous local game data after import failed.", rollbackError);
    }
    throw new Error(`Rook Score could not store the imported game data: ${error?.message || "storage failed"}`);
  }

  if (storage === localStorage) LOCAL_STORAGE_CACHE.clear();
  return { previousEntries, importedEntries: nextEntries };
}

function deserializeGameDataStorageValue(raw) {
  if (!shouldAttemptJsonParse(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function synchronizeImportedGameData(previousEntries, importedEntries) {
  if (typeof window === "undefined" || !window.firebaseReady
      || typeof window.syncToFirestore !== "function") {
    return false;
  }

  const previousKeys = previousEntries.map(({ key }) => key);
  const importedValues = new Map(importedEntries.map(({ key, value }) => [key, value]));
  const keysToSync = [...new Set([...previousKeys, ...importedValues.keys()])]
    .filter(key => !key.startsWith(LOCAL_ONLY_STORAGE_PREFIX) && !isFirebaseInternalStorageKey(key));
  const results = await Promise.allSettled(keysToSync.map((key) => {
    const value = importedValues.has(key)
      ? deserializeGameDataStorageValue(importedValues.get(key))
      : null;
    return window.syncToFirestore(key, value);
  }));
  return results.every(result => result.status === "fulfilled" && result.value !== false);
}

function rehydrateImportedGameData() {
  refreshPresetBidsFromStorage();
  performTeamPlayerMigration();
  initializeTheme();
  initializeCustomThemeColors();
  loadCurrentGameState();

  const mustWinToggle = document.getElementById("mustWinByBidToggle");
  if (mustWinToggle) mustWinToggle.checked = Boolean(getLocalStorage(MUST_WIN_BY_BID_KEY, false));
  const proModeEnabled = Boolean(getLocalStorage(PRO_MODE_KEY, false));
  updateProModeUI(proModeEnabled);
  loadSettings();
  resetRenderAnimationState();
  scheduleProbabilityPersonalizationRefresh(getLocalStorage("savedGames", []), { force: true });
  renderApp();
}

function setGameDataTransferStatus(message, isError = false) {
  const status = document.getElementById("gameDataTransferStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("hidden", !message);
  status.classList.toggle("text-red-600", isError);
  status.classList.toggle("dark:text-red-400", isError);
  status.classList.toggle("text-green-700", !isError && Boolean(message));
  status.classList.toggle("dark:text-green-300", !isError && Boolean(message));
}

function exportGameData() {
  try {
    saveSettings();
    const payload = buildGameDataExport(localStorage, new Date(), getCurrentGameExportSnapshot());
    const contents = `${JSON.stringify(payload, null, 2)}\n`;
    const blob = new Blob([contents], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `rook-score-game-data-${payload.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    setGameDataTransferStatus(`Exported ${payload.storage.length} saved data items.`);
    showSaveIndicator("Game data exported");
    return payload;
  } catch (error) {
    console.error("Game data export failed.", error);
    setGameDataTransferStatus(error?.message || "Game data export failed.", true);
    showSaveIndicator("Export failed");
    return null;
  }
}

function readGameDataFile(file) {
  if (file && typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("The selected file could not be read.")), { once: true });
    reader.readAsText(file);
  });
}

async function importGameData(input) {
  const file = input?.files?.[0];
  if (!file) return false;

  setGameDataTransferStatus("Importing game data...");
  try {
    if (Number(file.size) > MAX_GAME_DATA_IMPORT_BYTES) {
      throw new Error("The selected file is too large.");
    }
    const imported = parseGameDataImport(await readGameDataFile(file));
    const { previousEntries } = replaceAppStorage(imported.storage);
    rehydrateImportedGameData();
    const restoredEntries = getAppStorageEntries();
    setGameDataTransferStatus(`Imported ${restoredEntries.length} saved data items.`);
    showSaveIndicator("Game data imported");
    synchronizeImportedGameData(previousEntries, restoredEntries)
      .catch(error => console.warn("Imported data could not be mirrored to Firebase.", error));
    return true;
  } catch (error) {
    console.error("Game data import failed.", error);
    setGameDataTransferStatus(error?.message || "Game data import failed.", true);
    showSaveIndicator("Import failed");
    return false;
  } finally {
    input.value = "";
  }
}


// --- Icons ---
const Icons = { // SVG strings for icons to avoid multiple DOM elements
  AlertCircle: '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4m0 4h.01"></path></svg>',
  Undo: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v6h6M21 17a9 9 0 0 0-9-9c-2.5 0-4.75.9-6.5 2.4L3 11"/></svg>',
  Redo: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 7v6h-6M3 17a9 9 0 0 1 9-9c2.5 0 4.75.9 6.5 2.4L21 11"/></svg>',
  Trash: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>',
  Load: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>',
  Mic: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"/></svg>',
  Trophy: '<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 inline-block mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h18M7 10V4h10v6M7 10l-1 12h12 l-1-12M7 10h10m-5 12v-6"/></svg>',
};

// --- Bid Preset Logic ---
function savePresetBids() { setLocalStorage(PRESET_BIDS_KEY, presetBids); }
function openPresetEditorModal() {
  // No longer restrict to Pro Mode
  const settingsModal = document.getElementById("settingsModal");
  settingsModal?.classList.add("hidden");

  const existingModal = document.getElementById("presetEditorModal");
  if (existingModal) existingModal.remove();

  const modalHtml = `
      <div id="presetEditorModal" class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 modal" role="dialog" aria-modal="true" aria-labelledby="presetEditorTitle">
          <div class="bg-white w-full max-w-md rounded-xl shadow-lg dark:bg-gray-800 p-6 transform transition-all">
              <div class="flex items-center justify-between mb-4">
                  <h2 id="presetEditorTitle" class="text-2xl font-bold text-gray-800 dark:text-white">Edit Bid Presets</h2>
                  <button type="button" onclick="closePresetEditorModal()" class="text-gray-500 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full p-1">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
              </div>
              <p class="text-sm text-gray-600 dark:text-gray-300 mb-4">Customize quick bid buttons. Values must be multiples of 5.</p>
              <div id="presetInputs" class="space-y-3 max-h-64 overflow-y-auto pr-2 mb-4">
                  ${presetBids.filter(b => b !== "other").map((bid, index) => `
                      <div class="flex items-center space-x-3 preset-input-row">
                          <div class="flex-grow relative">
                              <input type="number" value="${bid}" min="5" max="360" step="5" class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" data-index="${index}" onchange="validatePresetInput(this)">
                              <div class="preset-error text-xs text-red-500 mt-1 hidden"></div>
                          </div>
                          <button type="button" onclick="removePreset(${index})" class="bg-gray-100 dark:bg-gray-700 text-red-600 dark:text-red-400 p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors">${Icons.Trash}</button>
                      </div>`).join('')}
              </div>
              <div class="flex gap-2 flex-wrap mb-6">
                  <button type="button" onclick="addPreset()" class="flex items-center bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-4 py-2 rounded-lg font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors threed"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>Add Preset</button>
              </div>
              <div id="presetErrorMsg" class="text-red-500 text-sm mb-4 hidden"></div>
              <div class="flex justify-end gap-3">
                  <button type="button" onclick="closePresetEditorModal()" class="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 dark:border-gray-600 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors threed">Cancel</button>
                  <button type="button" onclick="savePresets()" class="px-4 py-2 bg-blue-600 text-white rounded-lg dark:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors threed">Save Changes</button>
              </div>
          </div>
      </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const modalEl = document.getElementById("presetEditorModal");
  if (modalEl) {
    modalEl.addEventListener("click", (event) => {
      if (event.target === modalEl) closePresetEditorModal();
    });
    const content = modalEl.querySelector(".bg-white, .dark\\:bg-gray-800");
    if (content) content.addEventListener("click", (event) => event.stopPropagation());
  }
  activateModalEnvironment();
}
function closePresetEditorModal() {
  const modal = document.getElementById('presetEditorModal');
  if (modal) {
    modal.remove();
  }
  const settingsModal = document.getElementById("settingsModal");
  if (settingsModal) settingsModal.classList.remove("hidden");
  deactivateModalEnvironment();
}

function validatePresetInput(inputEl) {
  const val = Number(inputEl.value);
  const errDiv = inputEl.nextElementSibling;
  let msg = "";
  if (isNaN(val)) msg = "Must be a number.";
  else if (val <= 0) msg = "Must be > 0.";
  else if (val % 5 !== 0) msg = "Must be div by 5.";
  else if (val > 360) msg = "Cannot exceed 360.";
  else if (val > 180 && val !== 360) msg = "Only 360 allowed above 180.";
  errDiv.textContent = msg;
  errDiv.classList.toggle("hidden", !msg);
  return !msg;
}
function addPreset() {
  const container = document.getElementById('presetInputs');
  const newIdx = container.querySelectorAll('.preset-input-row').length;
  container.insertAdjacentHTML('beforeend', `
      <div class="flex items-center space-x-3 preset-input-row animate-fadeIn">
          <div class="flex-grow relative">
              <input type="number" value="120" min="5" max="360" step="5" class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" data-index="${newIdx}" onchange="validatePresetInput(this)">
              <div class="preset-error text-xs text-red-500 mt-1 hidden"></div>
          </div>
          <button type="button" onclick="removePreset(${newIdx})" class="bg-gray-100 dark:bg-gray-700 text-red-600 dark:text-red-400 p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors">${Icons.Trash}</button>
      </div>`);
  container.scrollTop = container.scrollHeight;
}
function removePreset(index) {
  const rows = document.querySelectorAll('#presetInputs .preset-input-row');
  const errorMsgEl = document.getElementById('presetErrorMsg');
  if (rows.length <= 1) {
      errorMsgEl.textContent = 'Must have at least one preset.';
      errorMsgEl.classList.remove('hidden');
      setTimeout(() => errorMsgEl.classList.add('hidden'), 3000);
      return;
  }
  const rowToRemove = Array.from(rows).find(r => r.querySelector('input[data-index]')?.dataset.index == index);
  if (rowToRemove) {
      rowToRemove.classList.add('animate-fadeOut');
      setTimeout(() => {
          rowToRemove.remove();
          // Re-index remaining rows
          document.querySelectorAll('#presetInputs .preset-input-row').forEach((r, i) => {
              r.querySelector('input').dataset.index = i;
              r.querySelector('button').setAttribute('onclick', `removePreset(${i})`);
          });
      }, 150);
  }
}
function savePresets() {
  const inputs = Array.from(document.querySelectorAll('#presetInputs input'));
  const errorMsgEl = document.getElementById('presetErrorMsg');
  if (inputs.some(input => !validatePresetInput(input))) {
      errorMsgEl.textContent = 'Fix errors before saving.';
      errorMsgEl.classList.remove('hidden');
      return;
  }
  const newPresetsNum = inputs.map(input => Number(input.value));
  if (new Set(newPresetsNum).size !== newPresetsNum.length) {
      errorMsgEl.textContent = 'Duplicate values not allowed.';
      errorMsgEl.classList.remove('hidden');
      return;
  }
  if (newPresetsNum.length === 0) {
      errorMsgEl.textContent = 'At least one preset required.';
      errorMsgEl.classList.remove('hidden');
      return;
  }
  presetBids = [...newPresetsNum.sort((a, b) => a - b), "other"];
  savePresetBids();
  closePresetEditorModal();
  scheduleRender();
  showSaveIndicator("Bid presets updated");
}

function normalizePresetBidValues(values) {
  const normalized = Array.isArray(values)
    ? values.map(Number).filter(Number.isFinite)
    : [];
  const unique = [...new Set(normalized.map(value => Math.round(value / 5) * 5))]
    .filter(value => value > 0 && value <= 360 && (value <= 180 || value === 360))
    .sort((a, b) => a - b);
  if (!unique.length) throw new Error("At least one valid preset is required.");
  return unique;
}

function setPresetBidsFromValues(values) {
  presetBids = [...normalizePresetBidValues(values), "other"];
  savePresetBids();
  closePresetEditorModal();
  scheduleRender();
  showSaveIndicator("Bid presets updated");
  return presetBids;
}
