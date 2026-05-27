"use strict";

// --- Game State Management ---
function updateState(newState) {
  const nextState = { ...newState };

  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  if (has(nextState, 'rounds') && nextState.rounds !== state.rounds) {
    roundsVersion += 1;
  }

  if (has(nextState, 'usPlayers')) {
    nextState.usPlayers = ensurePlayersArray(nextState.usPlayers);
    if (!has(nextState, 'usTeamName')) {
      nextState.usTeamName = deriveTeamDisplay(nextState.usPlayers);
    }
  } else if (has(nextState, 'usTeamName')) {
    const parsed = parseLegacyTeamName(nextState.usTeamName);
    nextState.usPlayers = ensurePlayersArray(parsed);
    nextState.usTeamName = deriveTeamDisplay(parsed, nextState.usTeamName);
  }

  if (has(nextState, 'demPlayers')) {
    nextState.demPlayers = ensurePlayersArray(nextState.demPlayers);
    if (!has(nextState, 'demTeamName')) {
      nextState.demTeamName = deriveTeamDisplay(nextState.demPlayers);
    }
  } else if (has(nextState, 'demTeamName')) {
    const parsed = parseLegacyTeamName(nextState.demTeamName);
    nextState.demPlayers = ensurePlayersArray(parsed);
    nextState.demTeamName = deriveTeamDisplay(parsed, nextState.demTeamName);
  }

  if (has(nextState, 'startingTotals')) {
    nextState.startingTotals = sanitizeTotals(nextState.startingTotals);
  }

  state = { ...state, ...nextState };
  scheduleRender();
}
function resetGame() {
  const isProMode = JSON.parse(localStorage.getItem(PRO_MODE_KEY) || "false");
  updateState({
    ...DEFAULT_STATE,
    usTeamName : "",      // blank ⇒ UI falls back to "Us"
    demTeamName: "",      // blank ⇒ UI falls back to "Dem"
    showWinProbability: isProMode,
    pendingPenalty : null
  });
  confettiTriggered = false;
  ephemeralCustomBid = "";
  ephemeralPoints = "";
  localStorage.removeItem(ACTIVE_GAME_KEY);
  // Attempt to also clear from Firebase if user is signed in
  if (window.syncToFirestore && window.firebaseReady && window.firebaseAuth?.currentUser) {
      window.syncToFirestore(ACTIVE_GAME_KEY, null); // Sync deletion of active game
  }
}
function loadCurrentGameState() {
  let loadedState = null; // Initialize to null
  try {
    const storedStateString = localStorage.getItem(ACTIVE_GAME_KEY);
    if (storedStateString) {
loadedState = JSON.parse(storedStateString);
    }
  } catch (e) {
    console.error("Error parsing activeGameState from localStorage. Will reset to default state.", e);
    localStorage.removeItem(ACTIVE_GAME_KEY); // Critical: remove the corrupted state
    // loadedState remains null, so it will fall through to using DEFAULT_STATE
  }

  if (loadedState && typeof loadedState === 'object' && loadedState !== null) {
    // Ensure all DEFAULT_STATE keys are present, preferring loaded values
    const completeLoadedState = { ...DEFAULT_STATE, ...loadedState };
    completeLoadedState.rounds = Array.isArray(loadedState.rounds) ? loadedState.rounds : [];
    completeLoadedState.undoneRounds = Array.isArray(loadedState.undoneRounds) ? loadedState.undoneRounds : [];
    // Transient flag must never persist across loads; a stuck `true` (from an
    // older build) would freeze every submit. Always start fresh.
    completeLoadedState.isSubmittingRound = false;
    const now = Date.now();
    const hasRounds = Array.isArray(completeLoadedState.rounds) && completeLoadedState.rounds.length > 0;
    const startTimeValid = isStartTimestampActive(completeLoadedState.startTime);
    const timerWasRunning = startTimeValid && !completeLoadedState.gameOver && hasRounds;
    const sanitizedAccumulated = clampDurationMs(completeLoadedState.accumulatedTime);

    if (timerWasRunning) {
      if (typeof completeLoadedState.timerLastSavedAt !== 'number') {
        // Legacy snapshots did not pre-accumulate time; cap what we add just in case.
        completeLoadedState.accumulatedTime = calculateSafeTimeAccumulation(sanitizedAccumulated, completeLoadedState.startTime, now);
      } else {
        completeLoadedState.accumulatedTime = sanitizedAccumulated;
      }
      completeLoadedState.startTime = now; // Resume timer from now so offline time is not double-counted.
    } else {
      completeLoadedState.accumulatedTime = sanitizedAccumulated;
      completeLoadedState.startTime = null;
    }

    completeLoadedState.timerLastSavedAt = now;
    // Ensure showWinProbability is correctly set from localStorage PRO_MODE_KEY
    completeLoadedState.showWinProbability = JSON.parse(localStorage.getItem(PRO_MODE_KEY) || "false"); // Add try-catch for this too
    completeLoadedState.startingTotals = sanitizeTotals(completeLoadedState.startingTotals);
    updateState(completeLoadedState);
  } else {
    if (loadedState) {
      localStorage.removeItem(ACTIVE_GAME_KEY); // Remove invalid structure
    }
    // Fallback to default state
    updateState({
...DEFAULT_STATE,
usTeamName: "", // Or load from a separate team name storage if you have one
demTeamName: "",
showWinProbability: JSON.parse(localStorage.getItem(PRO_MODE_KEY) || "false"), // Add try-catch here as well
startTime: null,
timerLastSavedAt: null
    });
  }
}
function saveCurrentGameState() {
  if (state.gameOver) {
    localStorage.removeItem(ACTIVE_GAME_KEY);
    if (window.syncToFirestore && window.firebaseReady && window.firebaseAuth?.currentUser) {
      window.syncToFirestore(ACTIVE_GAME_KEY, null);
    }
  } else {
    const now = Date.now();
    const timerRunning = isStartTimestampActive(state.startTime);
    const baseAccumulated = clampDurationMs(state.accumulatedTime);
    const finalAccumulated = timerRunning
      ? calculateSafeTimeAccumulation(baseAccumulated, state.startTime, now)
      : baseAccumulated;
    const snapshot = {
      ...state,
      accumulatedTime: finalAccumulated,
      startTime: timerRunning ? now : null,
      timerLastSavedAt: now,
      startingTotals: sanitizeTotals(state.startingTotals),
    };
    state.timerLastSavedAt = now;
    setLocalStorage(ACTIVE_GAME_KEY, snapshot); // This now handles Firestore sync too
    showSaveIndicator();
  }
}

