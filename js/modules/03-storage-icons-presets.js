"use strict";

// --- Local Storage & Sync ---
function setLocalStorage(key, value) {
  try {
    const serialized = JSON.stringify(value);
    localStorage.setItem(key, serialized);
    LOCAL_STORAGE_CACHE.set(key, { raw: serialized, parsed: value });
    if (key === "savedGames") {
      if (typeof invalidateProbabilityCachesForGames === "function") invalidateProbabilityCachesForGames(value);
      if (typeof clearStatisticsCache === "function") clearStatisticsCache();
    }
    if (window.syncToFirestore && window.firebaseReady && window.firebaseAuth?.currentUser) {
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
    if (window.syncToFirestore && window.firebaseReady && window.firebaseAuth?.currentUser) {
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


// --- Icons ---
const Icons = { // SVG strings for icons to avoid multiple DOM elements
  AlertCircle: '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4m0 4h.01"></path></svg>',
  Undo: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v6h6M21 17a9 9 0 0 0-9-9c-2.5 0-4.75.9-6.5 2.4L3 11"/></svg>',
  Redo: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 7v6h-6M3 17a9 9 0 0 1 9-9c2.5 0 4.75.9 6.5 2.4L21 11"/></svg>',
  Trash: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>',
  Load: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>',
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
                  <button type="button" onclick="closePresetEditorModal()" class="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full p-1">
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
                          <button type="button" onclick="removePreset(${index})" class="bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-red-600 hover:text-red-700 dark:text-red-400 p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors">${Icons.Trash}</button>
                      </div>`).join('')}
              </div>
              <div class="flex gap-2 flex-wrap mb-6">
                  <button type="button" onclick="addPreset()" class="flex items-center bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-800/40 text-blue-600 dark:text-blue-400 px-4 py-2 rounded-lg font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors threed"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>Add Preset</button>
              </div>
              <div id="presetErrorMsg" class="text-red-500 text-sm mb-4 hidden"></div>
              <div class="flex justify-end gap-3">
                  <button type="button" onclick="closePresetEditorModal()" class="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors threed">Cancel</button>
                  <button type="button" onclick="savePresets()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors threed">Save Changes</button>
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
          <button type="button" onclick="removePreset(${newIdx})" class="bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-red-600 hover:text-red-700 dark:text-red-400 p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors">${Icons.Trash}</button>
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
