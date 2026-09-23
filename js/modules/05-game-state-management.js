"use strict";

// --- Game State Management ---
// The game clock is wall time with breaks removed. Players are "seen" when they
// touch the app, press a key, or open or put away the app. Any stretch longer
// than CURRENT_GAME_TIMER_BREAK_MS without being seen is a break and is left out
// entirely; the clock resumes from where it was when players were last seen.
// Shorter stretches, like a hand played with the phone locked, count in full.
// Time is derived from timestamps, so saves and reloads never change it.
const CURRENT_GAME_TIMER_BREAK_MS = 30 * 60 * 1000;
const CURRENT_GAME_TIMER_TICK_MS = 1000;
const CURRENT_GAME_TIMER_CHECKPOINT_MS = 15 * 1000;
const CURRENT_GAME_TIMER_VERSION = 3;
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

function shouldRunCurrentGameTimer(gameState = state) {
  return hasStartedCurrentGameTimer(gameState) && !gameState?.gameOver;
}

// The open segment runs from startTime (counted up to there in accumulatedTime)
// to the last moment players were seen (timerLastActivityAt).
function getCurrentGameTimerSegment(gameState = state) {
  if (!shouldRunCurrentGameTimer(gameState) || !isStartTimestampActive(gameState?.startTime)) return null;
  const startAt = Number(gameState.startTime);
  const seenAt = isStartTimestampActive(gameState?.timerLastActivityAt)
    ? Math.max(startAt, Number(gameState.timerLastActivityAt))
    : startAt;
  return { startAt, seenAt };
}

function isCurrentGameTimerOnBreak(gameState = state, nowTs = Date.now()) {
  const segment = getCurrentGameTimerSegment(gameState);
  return segment !== null && nowTs - segment.seenAt > CURRENT_GAME_TIMER_BREAK_MS;
}

function getCurrentGameTime(gameState = state, nowTs = Date.now()) {
  const base = clampDurationMs(gameState?.accumulatedTime);
  const segment = getCurrentGameTimerSegment(gameState);
  if (!segment) return base;
  const countUntil = isCurrentGameTimerOnBreak(gameState, nowTs) ? segment.seenAt : nowTs;
  return calculateSafeTimeAccumulation(base, segment.startAt, countUntil);
}

function getCurrentGameSkippedTime(gameState = state, nowTs = Date.now()) {
  const base = clampDurationMs(gameState?.timerSkippedMs);
  if (!isCurrentGameTimerOnBreak(gameState, nowTs)) return base;
  return calculateSafeTimeAccumulation(base, getCurrentGameTimerSegment(gameState).seenAt, nowTs);
}

// Normalizes timer fields for storage without counting anything, so saving is
// safe at any time, including from the background.
function buildCurrentGameTimerCheckpoint(gameState = state, nowTs = Date.now()) {
  const parsedNow = Number(nowTs);
  const now = Number.isFinite(parsedNow) && parsedNow > 0 ? parsedNow : Date.now();
  const segment = getCurrentGameTimerSegment(gameState);
  const checkpoint = {
    ...gameState,
    timerVersion: CURRENT_GAME_TIMER_VERSION,
    timerStarted: hasStartedCurrentGameTimer(gameState),
    timerPaused: false,
    accumulatedTime: clampDurationMs(gameState?.accumulatedTime),
    timerSkippedMs: clampDurationMs(gameState?.timerSkippedMs),
    startTime: segment ? segment.startAt : null,
    timerLastActivityAt: segment ? segment.seenAt : null,
    timerLastSavedAt: now,
  };
  // The device clock moved backwards. Keep the time already observed and
  // restart the segment on the new clock rather than counting the jump.
  if (segment && segment.seenAt > now) {
    checkpoint.accumulatedTime = calculateSafeTimeAccumulation(checkpoint.accumulatedTime, segment.startAt, segment.seenAt);
    checkpoint.startTime = now;
    checkpoint.timerLastActivityAt = now;
  }
  return checkpoint;
}

// Players are here at `now`: close out any break and restart the segment.
function settleCurrentGameTimer(gameState = state, nowTs = Date.now()) {
  const checkpoint = buildCurrentGameTimerCheckpoint(gameState, nowTs);
  if (!shouldRunCurrentGameTimer(checkpoint)) return checkpoint;
  const now = checkpoint.timerLastSavedAt;
  return {
    ...checkpoint,
    accumulatedTime: getCurrentGameTime(checkpoint, now),
    timerSkippedMs: getCurrentGameSkippedTime(checkpoint, now),
    startTime: now,
    timerLastActivityAt: now,
  };
}

function normalizeLoadedGameTimerState(gameState, nowTs = Date.now()) {
  // Retired manual-pause snapshots resume from now without counting the break.
  if (gameState?.timerPaused) {
    return buildCurrentGameTimerCheckpoint({
      ...gameState, timerPaused: false, startTime: nowTs, timerLastActivityAt: nowTs,
    }, nowTs);
  }
  // Older builds folded counted time into accumulatedTime at every save, so the
  // latest of their start and save timestamps is where their clock stands.
  if (gameState?.timerVersion !== CURRENT_GAME_TIMER_VERSION && shouldRunCurrentGameTimer(gameState)) {
    const anchors = [gameState?.startTime, gameState?.timerLastSavedAt]
      .filter(isStartTimestampActive).map(Number);
    const anchor = anchors.length ? Math.max(...anchors) : null;
    return buildCurrentGameTimerCheckpoint({
      ...gameState, startTime: anchor, timerLastActivityAt: anchor,
    }, nowTs);
  }
  return buildCurrentGameTimerCheckpoint(gameState, nowTs);
}

function buildCurrentGameTimerActivity(gameState = state, nowTs = Date.now()) {
  if (gameState?.gameOver) return buildCurrentGameTimerCheckpoint(gameState, nowTs);
  return settleCurrentGameTimer({ ...gameState, timerStarted: true }, nowTs);
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

// Marks players as present. Returns true when a break was closed out.
function noteCurrentGameTimerPresence(nowTs = Date.now()) {
  if (!shouldRunCurrentGameTimer(state)) return false;
  const segment = getCurrentGameTimerSegment(state);
  if (segment && segment.seenAt <= nowTs && !isCurrentGameTimerOnBreak(state, nowTs)) {
    state.timerLastActivityAt = nowTs;
    return false;
  }
  Object.assign(state, settleCurrentGameTimer(state, nowTs));
  updateCurrentGameTimerDisplay(nowTs);
  return true;
}

function updateCurrentGameTimerDisplay(nowTs = Date.now()) {
  const timerValue = document.getElementById("currentGameTimerValue");
  if (!timerValue) return;
  const displayTime = formatLiveGameDuration(getCurrentGameTime(state, nowTs));
  if (timerValue.textContent !== displayTime) timerValue.textContent = displayTime;
}

function checkpointCurrentGameTimer(nowTs = Date.now()) {
  if (!shouldRunCurrentGameTimer(state)) return false;
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
    // Persist the latest sighting so a killed app still knows when players left.
    if (shouldRunCurrentGameTimer(state)
        && Number(state.timerLastActivityAt) > currentGameTimerLastCheckpointAt
        && now - currentGameTimerLastCheckpointAt >= CURRENT_GAME_TIMER_CHECKPOINT_MS) {
      saveCurrentGameState({ sync: false, showIndicator: false, now });
    }
  }, CURRENT_GAME_TIMER_TICK_MS);
}

function initializeCurrentGameTimer() {
  if (currentGameTimerLifecycleInitialized) return;
  currentGameTimerLifecycleInitialized = true;
  currentGameTimerLastCheckpointAt = Date.now();

  // Opening, leaving, and touching the app all mean players are here.
  const onLifecycle = () => {
    noteCurrentGameTimerPresence();
    checkpointCurrentGameTimer();
    syncCurrentGameTimerInterval();
  };
  const onInput = () => {
    if (noteCurrentGameTimerPresence()) checkpointCurrentGameTimer();
  };
  document.addEventListener("visibilitychange", onLifecycle);
  window.addEventListener("pagehide", () => {
    currentGameTimerPageHidden = true;
    onLifecycle();
  });
  window.addEventListener("pageshow", () => {
    currentGameTimerPageHidden = false;
    onLifecycle();
  });
  document.addEventListener("pointerdown", onInput, { capture: true, passive: true });
  document.addEventListener("keydown", onInput, { capture: true, passive: true });
  if (!document.hidden) onLifecycle();
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
    state.timerVersion = snapshot.timerVersion;
    currentGameTimerLastCheckpointAt = snapshot.timerLastSavedAt;
    setLocalStorage(ACTIVE_GAME_KEY, snapshot, { sync });
    if (showIndicator) showSaveIndicator();
  }
}
