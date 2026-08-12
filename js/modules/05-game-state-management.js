"use strict";

// --- Game State Management ---
const MAX_LEGACY_TIMER_RECOVERY_MS = 2 * 60 * 60 * 1000;
const CURRENT_GAME_TIMER_TICK_MS = 1000;
const CURRENT_GAME_TIMER_CHECKPOINT_MS = 15 * 1000;
let currentGameTimerLifecycleInitialized = false;
let currentGameTimerLastCheckpointAt = 0;

function clampDurationMs(value, cap = Number.MAX_SAFE_INTEGER) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(num, cap);
}

function isStartTimestampActive(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
}

function calculateSafeTimeAccumulation(currentAccumulated, startTime, nowTs = Date.now()) {
  const base = clampDurationMs(currentAccumulated);
  const startMs = Number(startTime);
  const nowMs = Number(nowTs);
  if (!Number.isFinite(startMs) || startMs <= 0 || !Number.isFinite(nowMs)) return base;

  const elapsedMs = nowMs - startMs;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return base;
  return clampDurationMs(base + elapsedMs);
}

function hasStartedCurrentGameTimer(gameState = state) {
  const hasRounds = Array.isArray(gameState?.rounds) && gameState.rounds.length > 0;
  return Boolean(gameState?.timerStarted) || hasRounds || isStartTimestampActive(gameState?.startTime);
}

function shouldRunCurrentGameTimer(gameState = state) {
  return hasStartedCurrentGameTimer(gameState) && !gameState?.gameOver;
}

function getCurrentGameTime(gameState = state, nowTs = Date.now()) {
  const base = clampDurationMs(gameState?.accumulatedTime);
  if (!shouldRunCurrentGameTimer(gameState) || !isStartTimestampActive(gameState?.startTime)) {
    return base;
  }
  return calculateSafeTimeAccumulation(base, gameState.startTime, nowTs);
}

function buildCurrentGameTimerCheckpoint(gameState = state, nowTs = Date.now()) {
  const parsedNow = Number(nowTs);
  const now = Number.isFinite(parsedNow) && parsedNow > 0 ? parsedNow : Date.now();
  const timerStarted = hasStartedCurrentGameTimer(gameState);
  const accumulatedTime = getCurrentGameTime(gameState, now);
  const keepRunning = timerStarted && !gameState?.gameOver;

  return {
    ...gameState,
    timerStarted,
    accumulatedTime,
    startTime: keepRunning ? now : null,
    timerLastSavedAt: now,
  };
}

function normalizeLoadedGameTimerState(gameState, nowTs = Date.now()) {
  const parsedNow = Number(nowTs);
  const now = Number.isFinite(parsedNow) && parsedNow > 0 ? parsedNow : Date.now();
  const hasRounds = Array.isArray(gameState?.rounds) && gameState.rounds.length > 0;
  const timerStarted = Boolean(gameState?.timerStarted)
    || hasRounds
    || isStartTimestampActive(gameState?.startTime);
  let accumulatedTime = clampDurationMs(gameState?.accumulatedTime);
  const startTime = Number(gameState?.startTime);
  const timerLastSavedAt = Number(gameState?.timerLastSavedAt);
  const hasModernTimerSnapshot = isStartTimestampActive(timerLastSavedAt);

  if (timerStarted && !gameState?.gameOver) {
    if (hasModernTimerSnapshot) {
      // Modern snapshots checkpoint the accumulated time and keep an active
      // segment anchor. Older builds sometimes cleared startTime while the app
      // was hidden, so timerLastSavedAt is also a valid recovery anchor.
      const resumeAnchors = [startTime, timerLastSavedAt]
        .filter(anchor => isStartTimestampActive(anchor) && anchor <= now);
      const resumeAnchor = resumeAnchors.length ? Math.max(...resumeAnchors) : null;
      accumulatedTime = calculateSafeTimeAccumulation(accumulatedTime, resumeAnchor, now);
    } else if (isStartTimestampActive(startTime)) {
      const legacyElapsed = Math.max(0, now - startTime);
      accumulatedTime = clampDurationMs(
        accumulatedTime + Math.min(legacyElapsed, MAX_LEGACY_TIMER_RECOVERY_MS),
      );
    }
  }

  return {
    ...gameState,
    timerStarted,
    accumulatedTime,
    startTime: timerStarted && !gameState?.gameOver ? now : null,
    timerLastSavedAt: now,
  };
}

function ensureCurrentGameTimerStarted(nowTs = Date.now()) {
  if (state.gameOver) return false;
  const parsedNow = Number(nowTs);
  const now = Number.isFinite(parsedNow) && parsedNow > 0 ? parsedNow : Date.now();
  if (state.timerStarted && isStartTimestampActive(state.startTime)) return false;

  state.timerStarted = true;
  state.startTime = now;
  state.timerLastSavedAt = now;
  currentGameTimerLastCheckpointAt = now;
  updateCurrentGameTimerDisplay(now);
  return true;
}

function updateCurrentGameTimerDisplay(nowTs = Date.now()) {
  const timerValue = document.getElementById("currentGameTimerValue");
  if (!timerValue) return;
  timerValue.textContent = formatLiveGameDuration(getCurrentGameTime(state, nowTs));
}

function checkpointCurrentGameTimer(nowTs = Date.now()) {
  if (!shouldRunCurrentGameTimer(state) || !isStartTimestampActive(state.startTime)) return false;
  saveCurrentGameState({
    sync: false,
    showIndicator: false,
    now: nowTs,
  });
  updateCurrentGameTimerDisplay(nowTs);
  return true;
}

function initializeCurrentGameTimer() {
  if (currentGameTimerLifecycleInitialized) return;
  currentGameTimerLifecycleInitialized = true;
  currentGameTimerLastCheckpointAt = Date.now();

  document.addEventListener("visibilitychange", () => {
    checkpointCurrentGameTimer();
  });
  window.addEventListener("pagehide", () => checkpointCurrentGameTimer());
  window.addEventListener("pageshow", () => checkpointCurrentGameTimer());

  setInterval(() => {
    if (document.hidden) return;
    const now = Date.now();
    updateCurrentGameTimerDisplay(now);
    if (shouldRunCurrentGameTimer(state)
        && now - currentGameTimerLastCheckpointAt >= CURRENT_GAME_TIMER_CHECKPOINT_MS) {
      saveCurrentGameState({ sync: false, showIndicator: false, now });
      currentGameTimerLastCheckpointAt = now;
    }
  }, CURRENT_GAME_TIMER_TICK_MS);
}

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

  if (has(nextState, 'misdealDealers')) {
    nextState.misdealDealers = normalizeMisdealDealers(nextState.misdealDealers);
  }

  state = { ...state, ...nextState };
  scheduleRender();
}
function resetGame() {
  const isProMode = JSON.parse(localStorage.getItem(PRO_MODE_KEY) || "false");
  resetRenderAnimationState();
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
  activeScoreKeypadTarget = "";
  scoreKeypadShouldAnimate = false;
  if (scoreKeypadCloseTimer) clearTimeout(scoreKeypadCloseTimer);
  scoreKeypadCloseTimer = null;
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
    Object.assign(completeLoadedState, normalizeLoadedGameTimerState(completeLoadedState));
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
function saveCurrentGameState({
  sync = true,
  showIndicator = true,
  now = Date.now(),
} = {}) {
  if (state.gameOver) {
    localStorage.removeItem(ACTIVE_GAME_KEY);
    LOCAL_STORAGE_CACHE.delete(ACTIVE_GAME_KEY);
    if (sync && window.syncToFirestore && window.firebaseReady && window.firebaseAuth?.currentUser) {
      window.syncToFirestore(ACTIVE_GAME_KEY, null);
    }
  } else {
    const snapshot = buildCurrentGameTimerCheckpoint(state, now);
    snapshot.startingTotals = sanitizeTotals(state.startingTotals);
    state.timerStarted = snapshot.timerStarted;
    state.accumulatedTime = snapshot.accumulatedTime;
    state.startTime = snapshot.startTime;
    state.timerLastSavedAt = snapshot.timerLastSavedAt;
    currentGameTimerLastCheckpointAt = snapshot.timerLastSavedAt;
    setLocalStorage(ACTIVE_GAME_KEY, snapshot, { sync });
    if (showIndicator) showSaveIndicator();
  }
}
