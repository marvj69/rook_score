"use strict";

// --- Settings Loading ---
function loadSettings() {
  console.log("Loading settings from localStorage...");

  // Load misdeal handling setting
  const misdealToggle = document.getElementById("misdealHandlingToggle");
  if (misdealToggle) {
    misdealToggle.checked = !!getLocalStorage(MISDEAL_HANDLING_KEY, false);
  }

  // Load table talk penalty settings
  const penaltySelect = document.getElementById("tableTalkPenaltySelect");
  if (penaltySelect) {
    const savedPenaltyType = getLocalStorage(TABLE_TALK_PENALTY_TYPE_KEY, "setPoints");
    console.log("Loading Table Talk Penalty Type:", savedPenaltyType);
    penaltySelect.value = savedPenaltyType;
  } else {
    console.warn("tableTalkPenaltySelect element not found");
  }

  const penaltyPointsInput = document.getElementById("penaltyPointsInput");
  if (penaltyPointsInput) {
    const savedPenaltyPoints = getLocalStorage(TABLE_TALK_PENALTY_POINTS_KEY, "180");
    console.log("Loading Table Talk Penalty Points:", savedPenaltyPoints);
    penaltyPointsInput.value = savedPenaltyPoints;
  } else {
    console.warn("penaltyPointsInput element not found");
  }

  // Show/hide custom points input based on penalty type
  handleTableTalkPenaltyChange();

  console.log("Settings loading completed");
}

function migrateTeamsCollection() {
  const raw = getLocalStorage("teams") || {};
  const { data, changed } = normalizeTeamsStorage(raw);
  if (changed || raw.__storageVersion !== TEAM_STORAGE_VERSION) {
    setTeamsObject(data);
  }
}

function migrateSavedGamesTeamData() {
  const savedGames = getLocalStorage("savedGames", []);
  if (!Array.isArray(savedGames) || !savedGames.length) return;
  let changed = false;
  const migrated = savedGames.map(game => {
    if (!game || typeof game !== 'object') return game;
    const usPlayers = canonicalizePlayers(game.usPlayers || parseLegacyTeamName(game.usTeamName || game.usName));
    const demPlayers = canonicalizePlayers(game.demPlayers || parseLegacyTeamName(game.demTeamName || game.demName));
    const usDisplay = deriveTeamDisplay(usPlayers, game.usTeamName || game.usName || 'Us') || 'Us';
    const demDisplay = deriveTeamDisplay(demPlayers, game.demTeamName || game.demName || 'Dem') || 'Dem';
    const usTeamKey = buildTeamKey(usPlayers) || null;
    const demTeamKey = buildTeamKey(demPlayers) || null;

    if (!playersEqual(game.usPlayers, usPlayers) || !playersEqual(game.demPlayers, demPlayers) ||
        (game.usTeamName || '') !== usDisplay || (game.demTeamName || '') !== demDisplay ||
        (game.usTeamKey || null) !== usTeamKey || (game.demTeamKey || null) !== demTeamKey) {
      changed = true;
    }

    return {
      ...game,
      usPlayers,
      demPlayers,
      usTeamName: usDisplay,
      demTeamName: demDisplay,
      usTeamKey,
      demTeamKey,
    };
  });
  if (changed) setLocalStorage("savedGames", migrated);
}

function migrateFreezerGamesTeamData() {
  const freezerGames = getLocalStorage("freezerGames", []);
  if (!Array.isArray(freezerGames) || !freezerGames.length) return;
  let changed = false;
  const migrated = freezerGames.map(game => {
    if (!game || typeof game !== 'object') return game;
    const usPlayers = canonicalizePlayers(game.usPlayers || parseLegacyTeamName(game.usName));
    const demPlayers = canonicalizePlayers(game.demPlayers || parseLegacyTeamName(game.demName));
    const usDisplay = deriveTeamDisplay(usPlayers, game.usName || 'Us') || 'Us';
    const demDisplay = deriveTeamDisplay(demPlayers, game.demName || 'Dem') || 'Dem';
    const usTeamKey = buildTeamKey(usPlayers) || null;
    const demTeamKey = buildTeamKey(demPlayers) || null;

    if (!playersEqual(game.usPlayers, usPlayers) || !playersEqual(game.demPlayers, demPlayers) ||
        (game.usName || '') !== usDisplay || (game.demName || '') !== demDisplay ||
        (game.usTeamKey || null) !== usTeamKey || (game.demTeamKey || null) !== demTeamKey) {
      changed = true;
    }

    return {
      ...game,
      usPlayers,
      demPlayers,
      usName: usDisplay,
      demName: demDisplay,
      usTeamKey,
      demTeamKey,
    };
  });
  if (changed) setLocalStorage("freezerGames", migrated);
}

function migrateActiveGameStateTeams() {
  let rawState = null;
  try {
    const stored = localStorage.getItem(ACTIVE_GAME_KEY);
    if (stored) rawState = JSON.parse(stored);
  } catch (err) {
    console.warn('Active game state migration skipped due to parse error.', err);
    return;
  }
  if (!rawState || typeof rawState !== 'object') return;

  const usPlayers = canonicalizePlayers(rawState.usPlayers || parseLegacyTeamName(rawState.usTeamName));
  const demPlayers = canonicalizePlayers(rawState.demPlayers || parseLegacyTeamName(rawState.demTeamName));
  const usDisplay = deriveTeamDisplay(usPlayers, rawState.usTeamName || 'Us') || 'Us';
  const demDisplay = deriveTeamDisplay(demPlayers, rawState.demTeamName || 'Dem') || 'Dem';

  if (playersEqual(rawState.usPlayers, usPlayers) && playersEqual(rawState.demPlayers, demPlayers) &&
      (rawState.usTeamName || 'Us') === usDisplay && (rawState.demTeamName || 'Dem') === demDisplay) {
    return;
  }

  const updatedState = {
    ...rawState,
    usPlayers,
    demPlayers,
    usTeamName: usDisplay,
    demTeamName: demDisplay,
  };
  setLocalStorage(ACTIVE_GAME_KEY, updatedState);
}

function performTeamPlayerMigration() {
  try {
    migrateTeamsCollection();
    migrateSavedGamesTeamData();
    migrateFreezerGamesTeamData();
    migrateActiveGameStateTeams();
  } catch (err) {
    console.error('Team/player migration encountered an issue:', err);
  }
}

