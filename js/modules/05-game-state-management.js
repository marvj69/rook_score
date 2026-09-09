"use strict";

// --- Game State Management ---
const CURRENT_GAME_TIMER_IDLE_MS = 20 * 60 * 1000;
const CURRENT_GAME_TIMER_TICK_MS = 1000;
const CURRENT_GAME_TIMER_CHECKPOINT_MS = 15 * 1000;
let currentGameTimerLifecycleInitialized = false;
let currentGameTimerLastCheckpointAt = 0;
let currentGameTimerInterval = null;
let currentGameTimerPageHidden = false;

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

// Activity is explicit game input, never a tick, render, sync, or page event.
function getCurrentGameTimerActivityAt(gameState = state) {
  return [gameState?.timerLastActivityAt, gameState?.timerLastSavedAt, gameState?.startTime]
    .find(isStartTimestampActive) || null;
}

function shouldRunCurrentGameTimer(gameState = state) {
  return hasStartedCurrentGameTimer(gameState) && !gameState?.gameOver && !gameState?.timerPaused;
}

function isCurrentGameTimerIdle(gameState = state, nowTs = Date.now()) {
  const activityAt = getCurrentGameTimerActivityAt(gameState);
  return shouldRunCurrentGameTimer(gameState) && activityAt !== null
    && nowTs >= Number(activityAt) + CURRENT_GAME_TIMER_IDLE_MS;
}

function getCurrentGameTime(gameState = state, nowTs = Date.now()) {
  const base = clampDurationMs(gameState?.accumulatedTime);
  if (!shouldRunCurrentGameTimer(gameState) || !isStartTimestampActive(gameState?.startTime)) return base;
  const activityAt = getCurrentGameTimerActivityAt(gameState);
  const stopAt = Number(activityAt) + CURRENT_GAME_TIMER_IDLE_MS;
  return calculateSafeTimeAccumulation(base, gameState.startTime, Math.min(nowTs, stopAt));
}

function getCurrentGameSkippedTime(gameState = state, nowTs = Date.now()) {
  const base = clampDurationMs(gameState?.timerSkippedMs);
  if (!shouldRunCurrentGameTimer(gameState) || !isStartTimestampActive(gameState?.startTime)) return base;
  const stopAt = Number(getCurrentGameTimerActivityAt(gameState)) + CURRENT_GAME_TIMER_IDLE_MS;
  return calculateSafeTimeAccumulation(base, Math.max(Number(gameState.startTime), stopAt), nowTs);
}

function buildCurrentGameTimerCheckpoint(gameState = state, nowTs = Date.now()) {
  const parsedNow = Number(nowTs);
  const now = Number.isFinite(parsedNow) && parsedNow > 0 ? parsedNow : Date.now();
  // Rebase future timestamps after a backwards clock change. Do not count that
  // discontinuity or move a segment backwards and count it twice on the next save.
  const clockMovedBack = Number(gameState?.startTime) > now
    || Number(getCurrentGameTimerActivityAt(gameState)) > now;
  return {
    ...gameState,
    timerStarted: hasStartedCurrentGameTimer(gameState),
    timerLastActivityAt: clockMovedBack ? now : getCurrentGameTimerActivityAt(gameState),
    timerPaused: Boolean(gameState?.timerPaused),
    accumulatedTime: getCurrentGameTime(gameState, now),
    timerSkippedMs: getCurrentGameSkippedTime(gameState, now),
    startTime: shouldRunCurrentGameTimer(gameState) ? now : null,
    timerLastSavedAt: now,
  };
}

function normalizeLoadedGameTimerState(gameState, nowTs = Date.now()) {
  // Old hidden snapshots had no startTime. Recover from their checkpoint, with
  // the same idle bound; historical accumulated totals are never guessed away.
  const resumeAnchors = [gameState?.startTime, gameState?.timerLastSavedAt]
    .filter(isStartTimestampActive).map(Number);
  const resumeAnchor = resumeAnchors.length ? Math.max(...resumeAnchors) : null;
  return buildCurrentGameTimerCheckpoint({
    ...gameState,
    startTime: shouldRunCurrentGameTimer(gameState)
      ? resumeAnchor
      : null,
  }, nowTs);
}

function buildCurrentGameTimerActivity(gameState = state, nowTs = Date.now()) {
  const checkpoint = buildCurrentGameTimerCheckpoint(gameState, nowTs);
  if (gameState?.gameOver) return checkpoint;
  return {
    ...checkpoint,
    timerStarted: true,
    timerPaused: false,
    timerLastActivityAt: checkpoint.timerLastSavedAt,
    startTime: checkpoint.timerLastSavedAt,
  };
}

function ensureCurrentGameTimerStarted(nowTs = Date.now()) {
  if (state.gameOver) return false;
  Object.assign(state, buildCurrentGameTimerActivity(state, nowTs));
  updateCurrentGameTimerDisplay(nowTs);
  syncCurrentGameTimerInterval();
  return true;
}

function recordCurrentGameTimerActivity() {
  if (!hasStartedCurrentGameTimer(state) || state.gameOver) return;
  ensureCurrentGameTimerStarted();
  saveCurrentGameState({ sync: false, showIndicator: false });
}

function toggleCurrentGameTimer() {
  if (state.gameOver || !hasStartedCurrentGameTimer(state)) return;
  const now = Date.now();
  if (state.timerPaused || isCurrentGameTimerIdle(state, now)) {
    ensureCurrentGameTimerStarted(now);
  } else {
    Object.assign(state, buildCurrentGameTimerCheckpoint(state, now), { timerPaused: true, startTime: null });
  }
  saveCurrentGameState({ showIndicator: false, now });
  syncCurrentGameTimerInterval();
  scheduleRender();
}

function includeCurrentGameSkippedTime() {
  const now = Date.now();
  const checkpoint = buildCurrentGameTimerActivity(state, now);
  checkpoint.accumulatedTime = clampDurationMs(checkpoint.accumulatedTime + checkpoint.timerSkippedMs);
  checkpoint.timerSkippedMs = 0;
  Object.assign(state, checkpoint);
  saveCurrentGameState({ showIndicator: false, now });
  syncCurrentGameTimerInterval();
  scheduleRender();
}

function updateCurrentGameTimerDisplay(nowTs = Date.now()) {
  const timerValue = document.getElementById("currentGameTimerValue");
  if (!timerValue) return;
  const displayTime = formatLiveGameDuration(getCurrentGameTime(state, nowTs));
  if (timerValue.textContent !== displayTime) timerValue.textContent = displayTime;
  const control = document.getElementById("currentGameTimerToggle");
  const paused = state.timerPaused || isCurrentGameTimerIdle(state, nowTs);
  if (control) control.textContent = paused ? "Resume timer" : "Pause timer";
  const notice = document.getElementById("currentGameTimerNotice");
  if (notice) {
    const message = state.gameOver ? "Final game time."
      : !hasStartedCurrentGameTimer(state) ? "Starts with your first bid."
      : state.timerPaused ? "Timer paused. Scoring resumes it."
      : isCurrentGameTimerIdle(state, nowTs) ? "Auto-paused after 20 minutes without scoring."
      : "Auto-pauses after 20 minutes without scoring.";
    if (notice.textContent !== message) notice.textContent = message;
  }
  const skipped = getCurrentGameSkippedTime(state, nowTs);
  const review = document.getElementById("currentGameTimerReview");
  if (review) review.hidden = skipped < 1000;
  const skippedValue = document.getElementById("currentGameTimerSkippedValue");
  if (skippedValue) skippedValue.textContent = formatLiveGameDuration(skipped);
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

function syncCurrentGameTimerInterval() {
  const needsTicks = currentGameTimerLifecycleInitialized
    && !document.hidden && !currentGameTimerPageHidden && shouldRunCurrentGameTimer(state);
  if (!needsTicks) {
    if (currentGameTimerInterval !== null) clearInterval(currentGameTimerInterval);
    currentGameTimerInterval = null;
    return;
  }
  if (currentGameTimerInterval !== null) return;
  currentGameTimerInterval = setInterval(() => {
    const now = Date.now();
    updateCurrentGameTimerDisplay(now);
    if (shouldRunCurrentGameTimer(state)
        && now - currentGameTimerLastCheckpointAt >= CURRENT_GAME_TIMER_CHECKPOINT_MS) {
      saveCurrentGameState({ sync: false, showIndicator: false, now });
      currentGameTimerLastCheckpointAt = now;
    }
  }, CURRENT_GAME_TIMER_TICK_MS);
}

function initializeCurrentGameTimer() {
  if (currentGameTimerLifecycleInitialized) return;
  currentGameTimerLifecycleInitialized = true;
  currentGameTimerLastCheckpointAt = Date.now();

  // Hidden pages need no ticks. Recovery uses the same activity deadline.
  document.addEventListener("visibilitychange", () => {
    checkpointCurrentGameTimer();
    syncCurrentGameTimerInterval();
  });
  window.addEventListener("pagehide", () => {
    currentGameTimerPageHidden = true;
    checkpointCurrentGameTimer();
    syncCurrentGameTimerInterval();
  });
  window.addEventListener("pageshow", () => {
    currentGameTimerPageHidden = false;
    checkpointCurrentGameTimer();
    syncCurrentGameTimerInterval();
  });
  syncCurrentGameTimerInterval();
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
  syncCurrentGameTimerInterval();
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
    state.timerLastActivityAt = snapshot.timerLastActivityAt;
    state.timerSkippedMs = snapshot.timerSkippedMs;
    state.timerPaused = snapshot.timerPaused;
    currentGameTimerLastCheckpointAt = snapshot.timerLastSavedAt;
    setLocalStorage(ACTIVE_GAME_KEY, snapshot, { sync });
    if (showIndicator) showSaveIndicator();
  }
}
