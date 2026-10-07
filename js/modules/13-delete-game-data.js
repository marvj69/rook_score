"use strict";

// --- Delete All Game Data ---
// Settings → Game Data. The dialog lists exactly what will be erased, offers a
// backup first, and only arms once DELETE is typed. Unless the player opts out,
// a recovery copy stays on this device for 30 days so a mistake can be undone.
// Cloud copies are cleared in the same sync write that records the delete (see
// window.syncGameDataReset in js/firebase-init.js), which keeps other devices
// from uploading the deleted games again.
const GAME_DATA_DELETE_PHRASE = "DELETE";
const GAME_DATA_RECOVERY_DAYS = 30;
const GAME_DATA_RECOVERY_MS = GAME_DATA_RECOVERY_DAYS * 24 * 60 * 60 * 1000;
const GAME_DATA_RECOVERY_VERSION = 1;
let gameDataDeleteInProgress = false;
let gameDataDateFormatter = null;

function formatGameDataDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    if (!gameDataDateFormatter) {
      gameDataDateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
    }
    return gameDataDateFormatter.format(date);
  } catch {
    return date.toDateString();
  }
}

function pluralizeGameDataCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function countStoredTeams(teams) {
  if (!teams || typeof teams !== "object" || Array.isArray(teams)) return 0;
  return Object.keys(teams).filter(key => key !== "__storageVersion").length;
}

// What a delete would erase on this device right now.
function getGameDataSummary(gameState = state) {
  return {
    savedGames: getLocalStorage("savedGames", []).length,
    frozenGames: getLocalStorage("freezerGames", []).length,
    activeGame: hasActiveGame(gameState),
    teams: countStoredTeams(getLocalStorage("teams", {})),
  };
}

function describeGameDataSummary(summary) {
  const items = [];
  if (summary?.savedGames) items.push(pluralizeGameDataCount(summary.savedGames, "completed game"));
  if (summary?.frozenGames) items.push(pluralizeGameDataCount(summary.frozenGames, "frozen game"));
  if (summary?.activeGame) items.push("The game in progress");
  if (summary?.teams) items.push(pluralizeGameDataCount(summary.teams, "saved team"));
  return items;
}

function joinGameDataItems(items) {
  const lower = items.map(item => item.replace(/^The /, "the "));
  if (lower.length <= 1) return lower.join("");
  if (lower.length === 2) return `${lower[0]} and ${lower[1]}`;
  return `${lower.slice(0, -1).join(", ")}, and ${lower[lower.length - 1]}`;
}

function isGameDataDeletePhrase(value) {
  return String(value ?? "").trim().toUpperCase() === GAME_DATA_DELETE_PHRASE;
}

// Each delete is strictly later than the last one from this device, even if
// the clock moved backwards, so the cloud always accepts it as the newest.
function nextGameDataResetMarker(now = Date.now()) {
  const previous = Date.parse(getLocalStorage(GAME_DATA_RESET_DEVICE_KEY, {})?.at || "");
  return new Date(Math.max(now, (Number.isFinite(previous) ? previous : 0) + 1)).toISOString();
}

function readGameDataRecovery(now = Date.now()) {
  if (localStorage.getItem(DELETED_GAME_DATA_RECOVERY_KEY) === null) return null;
  const record = getLocalStorage(DELETED_GAME_DATA_RECOVERY_KEY, null);
  if (!record || typeof record !== "object" || Array.isArray(record)
      || !record.entries || typeof record.entries !== "object"
      || !Object.keys(record.entries).length) {
    return null;
  }
  const expiresAt = Date.parse(record.expiresAt || "");
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return record;
}

function pruneExpiredGameDataRecovery(now = Date.now()) {
  if (localStorage.getItem(DELETED_GAME_DATA_RECOVERY_KEY) !== null && !readGameDataRecovery(now)) {
    removeLocalStorageKey(DELETED_GAME_DATA_RECOVERY_KEY);
  }
}

function getGameDataIdentity(game) {
  return game.id || game.timestamp || JSON.stringify(game);
}

// Keeps list order (earlier lists first) and drops repeats of the same game.
function mergeGameDataLists(...lists) {
  const seen = new Set();
  const merged = [];
  lists.forEach(list => {
    (Array.isArray(list) ? list : []).forEach(game => {
      if (!game || typeof game !== "object" || Array.isArray(game)) return;
      const identity = getGameDataIdentity(game);
      if (seen.has(identity)) return;
      seen.add(identity);
      merged.push(game);
    });
  });
  return merged;
}

// Later sets win. Win/loss totals are recounted from the games after a restore
// (recalcTeamsStats), since the same games may arrive twice, e.g. via a backup.
function mergeGameDataTeams(...teamSets) {
  const merged = {};
  teamSets.forEach(teams => Object.assign(merged, normalizeTeamsStorage(teams).data));
  return merged;
}

// Saved games are stored oldest first and the freezer newest first; a recovery
// copy always holds older data than what has been played since the delete.
function mergeGameDataEntries(older = {}, newer = {}) {
  const entries = {};
  const savedGames = mergeGameDataLists(older.savedGames, newer.savedGames);
  if (savedGames.length) entries.savedGames = savedGames;
  const freezerGames = mergeGameDataLists(newer.freezerGames, older.freezerGames);
  if (freezerGames.length) entries.freezerGames = freezerGames;
  const teams = mergeGameDataTeams(older.teams, newer.teams);
  if (Object.keys(teams).length) entries.teams = { __storageVersion: TEAM_STORAGE_VERSION, ...teams };
  const activeGame = newer[ACTIVE_GAME_KEY] || older[ACTIVE_GAME_KEY];
  if (activeGame) entries[ACTIVE_GAME_KEY] = activeGame;
  return entries;
}

function summarizeGameDataEntries(entries = {}) {
  return {
    savedGames: Array.isArray(entries.savedGames) ? entries.savedGames.length : 0,
    frozenGames: Array.isArray(entries.freezerGames) ? entries.freezerGames.length : 0,
    activeGame: Boolean(entries[ACTIVE_GAME_KEY]),
    teams: countStoredTeams(entries.teams),
  };
}

function refreshGameDataCaches() {
  LOCAL_STORAGE_CACHE.clear();
  if (typeof clearLibraryGameCache === "function") clearLibraryGameCache();
  if (typeof invalidateProbabilityCachesForGames === "function") invalidateProbabilityCachesForGames();
  if (typeof clearStatisticsCache === "function") clearStatisticsCache();
}

function restoreRawGameData(previousRaw) {
  previousRaw.forEach((raw, key) => {
    try {
      if (raw === null) localStorage.removeItem(key);
      else localStorage.setItem(key, raw);
    } catch (error) {
      console.error(`Could not put ${key} back after a failed game data change.`, error);
    }
  });
  refreshGameDataCaches();
}

// Erases every game-data key on this device and in the cloud. Settings,
// colors, and presets stay. Throws, with nothing erased, if a requested
// recovery copy cannot be stored.
function deleteAllGameData({ keepRecoveryCopy = true, now = Date.now() } = {}) {
  const summary = getGameDataSummary();
  const deletedAt = nextGameDataResetMarker(now);
  const previousRaw = new Map(GAME_DATA_KEYS.map(key => [key, localStorage.getItem(key)]));
  const previousDeviceReset = localStorage.getItem(GAME_DATA_RESET_DEVICE_KEY);
  const deletedEntries = {};
  ["savedGames", "freezerGames", "teams"].forEach(key => {
    if (previousRaw.get(key) !== null) deletedEntries[key] = getLocalStorage(key);
  });
  if (summary.activeGame) deletedEntries[ACTIVE_GAME_KEY] = getCurrentGameExportSnapshot();

  GAME_DATA_KEYS.forEach(key => removeLocalStorageKey(key, { sync: false }));
  // Recorded with the signed-in account so the delete never spreads to another.
  const deviceReset = { at: deletedAt, uid: window.firebaseAuth?.currentUser?.uid || null };
  if (!setLocalStorage(GAME_DATA_RESET_DEVICE_KEY, deviceReset)) {
    restoreRawGameData(previousRaw);
    throw new Error("This device's storage is full, so nothing was deleted. Free up space and try again.");
  }

  let recovery = null;
  if (keepRecoveryCopy) {
    // A second delete inside the window keeps the first one restorable too.
    const earlier = readGameDataRecovery(now);
    const entries = mergeGameDataEntries(earlier?.entries, deletedEntries);
    if (Object.keys(entries).length) {
      recovery = {
        version: GAME_DATA_RECOVERY_VERSION,
        deletedAt,
        expiresAt: new Date(now + GAME_DATA_RECOVERY_MS).toISOString(),
        entries,
      };
      if (!setLocalStorage(DELETED_GAME_DATA_RECOVERY_KEY, recovery)) {
        previousRaw.set(GAME_DATA_RESET_DEVICE_KEY, previousDeviceReset);
        restoreRawGameData(previousRaw);
        throw new Error("This device is too full to keep a recovery copy, so nothing was deleted. Export a backup, then delete without the recovery copy.");
      }
    }
  }
  // Without a copy of this delete, an earlier copy still in its 30 days stays;
  // Erase Copy in Recently Deleted removes it.

  resetGame(); // Clears the scoreboard and leaves the "no game" marker for sync.
  refreshGameDataCaches();
  if (typeof window.syncGameDataReset === "function") {
    window.syncGameDataReset(deletedAt)
      .catch(error => console.warn("The delete could not reach cloud sync yet; it will on the next sync.", error));
  }
  scheduleProbabilityPersonalizationRefresh([], { force: true });
  return { deletedAt, summary, recovery };
}

// Brings back a recovery copy without touching anything played since. A game
// in progress now stays; the deleted one remains restorable until it ends.
function restoreDeletedGameData({ now = Date.now() } = {}) {
  const record = readGameDataRecovery(now);
  if (!record) throw new Error("The recovery copy has expired or was erased.");
  // restoredAt marks the games as newer than any delete made before now, so a
  // delete this device has not synced yet cannot drop them again.
  const restoredAt = new Date(now).toISOString();
  const stamp = game => ({ ...game, restoredAt });
  const recovered = {
    ...record.entries,
    savedGames: (record.entries.savedGames || []).map(stamp),
    freezerGames: (record.entries.freezerGames || []).map(stamp),
  };
  if (record.entries[ACTIVE_GAME_KEY]) recovered[ACTIVE_GAME_KEY] = stamp(record.entries[ACTIVE_GAME_KEY]);
  const current = {
    savedGames: getLocalStorage("savedGames", []),
    freezerGames: getLocalStorage("freezerGames", []),
    teams: getLocalStorage("teams", {}),
  };
  const merged = mergeGameDataEntries(recovered, current);
  const restoreActiveGame = Boolean(recovered[ACTIVE_GAME_KEY]) && !hasActiveGame(state);
  const writes = [];
  if (recovered.savedGames?.length) writes.push(["savedGames", merged.savedGames]);
  if (recovered.freezerGames?.length) writes.push(["freezerGames", merged.freezerGames]);
  if (countStoredTeams(recovered.teams)) writes.push(["teams", merged.teams]);
  if (restoreActiveGame) writes.push([ACTIVE_GAME_KEY, recovered[ACTIVE_GAME_KEY]]);

  const previousRaw = new Map(writes.map(([key]) => [key, localStorage.getItem(key)]));
  writes.forEach(([key, value]) => {
    if (setLocalStorage(key, value)) return;
    restoreRawGameData(previousRaw);
    throw new Error("This device is too full to restore the deleted game data. Free up space and try again.");
  });

  const activeGameLeftBehind = Boolean(recovered[ACTIVE_GAME_KEY]) && !restoreActiveGame;
  if (activeGameLeftBehind) {
    setLocalStorage(DELETED_GAME_DATA_RECOVERY_KEY, {
      ...record,
      entries: { [ACTIVE_GAME_KEY]: record.entries[ACTIVE_GAME_KEY] },
    });
  } else {
    removeLocalStorageKey(DELETED_GAME_DATA_RECOVERY_KEY);
  }

  refreshGameDataCaches();
  if (restoreActiveGame) loadCurrentGameState();
  if (writes.some(([key]) => key === "savedGames" || key === "teams")) recalcTeamsStats();
  scheduleProbabilityPersonalizationRefresh(getLocalStorage("savedGames", []), { force: true });
  const restored = summarizeGameDataEntries(recovered);
  restored.activeGame = restoreActiveGame;
  return { restored, activeGameLeftBehind };
}

// --- Settings rows ---
function renderGameDataControls(now = Date.now()) {
  pruneExpiredGameDataRecovery(now);
  const summary = getGameDataSummary();
  const items = describeGameDataSummary(summary);
  const deleteDesc = document.getElementById("deleteGameDataDesc");
  if (deleteDesc) {
    deleteDesc.textContent = items.length
      ? `Erase ${joinGameDataItems(items)}.`
      : "No games are stored on this device.";
  }

  const record = readGameDataRecovery(now);
  const restoreRow = document.getElementById("restoreGameDataRow");
  restoreRow?.classList.toggle("hidden", !record);
  const restoreDesc = document.getElementById("restoreGameDataDesc");
  if (record && restoreDesc) {
    const recoveredItems = describeGameDataSummary(summarizeGameDataEntries(record.entries))
      .map(item => item.replace(/^The game in progress$/, "The game that was in progress"));
    restoreDesc.textContent = `${recoveredItems.join(", ")}. Deleted ${formatGameDataDate(record.deletedAt)}; restorable until ${formatGameDataDate(record.expiresAt)}.`;
  }
}

// --- Delete dialog ---
function setDeleteGameDataError(message = "") {
  const error = document.getElementById("deleteGameDataError");
  if (!error) return;
  error.textContent = message;
  error.classList.toggle("hidden", !message);
}

function setDeleteGameDataBackupStatus(message = "", isError = false) {
  const status = document.getElementById("deleteGameDataBackupStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("hidden", !message);
  status.classList.toggle("is-error", Boolean(message) && isError);
}

function syncDeleteGameDataConfirmButton() {
  const input = document.getElementById("deleteGameDataConfirmInput");
  const button = document.getElementById("deleteGameDataConfirmButton");
  const armed = isGameDataDeletePhrase(input?.value) && !gameDataDeleteInProgress;
  if (button) button.disabled = !armed;
  input?.setAttribute("aria-invalid", "false");
  if (armed) setDeleteGameDataError("");
  return armed;
}

function describeGameDataDeleteScope() {
  const user = window.firebaseAuth?.currentUser;
  if (window.firebaseReady && user && !user.isAnonymous) {
    return "It is erased from this device and your cloud backup. Your other signed-in devices erase it the next time they open Rook Score.";
  }
  return "It is erased from this device and its cloud backup.";
}

function openDeleteGameDataModal() {
  const summary = getGameDataSummary();
  const items = describeGameDataSummary(summary);
  const list = document.getElementById("deleteGameDataSummary");
  if (list) {
    list.replaceChildren(...(items.length ? items : ["No games are stored on this device"]).map(text => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }));
    list.classList.toggle("is-empty", !items.length);
  }
  const scope = document.getElementById("deleteGameDataScope");
  if (scope) scope.textContent = describeGameDataDeleteScope();
  const input = document.getElementById("deleteGameDataConfirmInput");
  if (input) input.value = "";
  const keepCopy = document.getElementById("deleteGameDataKeepCopy");
  if (keepCopy) keepCopy.checked = true;
  gameDataDeleteInProgress = false;
  setDeleteGameDataError("");
  setDeleteGameDataBackupStatus("");
  syncDeleteGameDataConfirmButton();
  openModal("deleteGameDataModal");
  // Keyboards cover half a phone screen, so touch devices start on the dialog.
  if (input && typeof shouldAutoFocusDealerInput === "function" && shouldAutoFocusDealerInput()) {
    input.focus();
  }
}

function closeDeleteGameDataModal() {
  if (gameDataDeleteInProgress) return;
  const input = document.getElementById("deleteGameDataConfirmInput");
  if (input) input.value = "";
  closeModal("deleteGameDataModal");
  document.getElementById("deleteGameDataButton")?.focus?.({ preventScroll: true });
}

function exportGameDataBeforeDelete() {
  const payload = exportGameData();
  if (payload) {
    setDeleteGameDataBackupStatus(`Backup saved: rook-score-game-data-${payload.exportedAt.slice(0, 10)}.json`);
  } else {
    setDeleteGameDataBackupStatus("The backup could not be saved. Nothing has been deleted.", true);
  }
}

function handleDeleteGameDataSubmit(event) {
  event?.preventDefault?.();
  if (gameDataDeleteInProgress) return false;
  const input = document.getElementById("deleteGameDataConfirmInput");
  if (!isGameDataDeletePhrase(input?.value)) {
    input?.setAttribute("aria-invalid", "true");
    setDeleteGameDataError(`Type ${GAME_DATA_DELETE_PHRASE} to confirm.`);
    input?.focus();
    return false;
  }

  gameDataDeleteInProgress = true;
  syncDeleteGameDataConfirmButton();
  let result;
  try {
    result = deleteAllGameData({
      keepRecoveryCopy: document.getElementById("deleteGameDataKeepCopy")?.checked !== false,
    });
  } catch (error) {
    console.error("Deleting game data failed.", error);
    gameDataDeleteInProgress = false;
    syncDeleteGameDataConfirmButton();
    setDeleteGameDataError(error?.message || "Game data could not be deleted. Nothing was changed.");
    return false;
  }

  gameDataDeleteInProgress = false;
  if (input) input.value = "";
  closeModal("deleteGameDataModal");
  closeSettingsModal();
  renderApp();
  openHomeScreen();
  showNoticeModal(
    result.recovery
      ? `Changed your mind? Restore it from Settings → Game Data until ${formatGameDataDate(result.recovery.expiresAt)}.`
      : "No copy of this data was kept on this device.",
    { title: "Game data deleted", tone: "success", icon: "check", buttonLabel: "Done" },
  );
  return true;
}

// --- Recovery copy ---
function confirmRestoreDeletedGameData() {
  const record = readGameDataRecovery();
  if (!record) {
    renderGameDataControls();
    showNoticeModal("The recovery copy has expired or was erased.", { title: "Nothing to restore" });
    return;
  }
  const items = describeGameDataSummary(summarizeGameDataEntries(record.entries))
    .map(item => item.replace(/^The game in progress$/, "The game that was in progress"));
  openConfirmationModal(
    `Bring back ${joinGameDataItems(items)}, deleted ${formatGameDataDate(record.deletedAt)}? Games played since then are kept.`,
    () => {
      closeConfirmationModal();
      let result;
      try {
        result = restoreDeletedGameData();
      } catch (error) {
        console.error("Restoring deleted game data failed.", error);
        renderGameDataControls();
        showNoticeModal(error?.message || "The deleted game data could not be restored.", { title: "Restore failed" });
        return;
      }
      renderApp();
      if (isHomeScreenOpen()) renderHomeScreen();
      renderGameDataControls();
      showNoticeModal(
        result.activeGameLeftBehind
          ? "Your games are back. The game that was in progress stays in Recently Deleted until you finish or freeze the current game."
          : "Your deleted games, teams, and statistics are back.",
        { title: "Game data restored", tone: "success", icon: "check", buttonLabel: "Done" },
      );
    },
    closeConfirmationModal,
    { title: "Restore deleted game data?", confirmLabel: "Restore", tone: "info", icon: "refresh" },
  );
}

function confirmEraseGameDataRecovery() {
  openConfirmationModal(
    "The deleted games will be gone from this device for good.",
    () => {
      removeLocalStorageKey(DELETED_GAME_DATA_RECOVERY_KEY);
      closeConfirmationModal();
      renderGameDataControls();
      document.getElementById("deleteGameDataButton")?.focus?.({ preventScroll: true });
    },
    closeConfirmationModal,
    { title: "Erase the recovery copy?", confirmLabel: "Erase copy", tone: "danger" },
  );
}
