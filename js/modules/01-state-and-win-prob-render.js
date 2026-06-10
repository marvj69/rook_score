"use strict";

// --- Global State ---
let state = { ...DEFAULT_STATE };
let confettiTriggered = false;
let ephemeralCustomBid = ""; // For temporarily holding input value before state update
let ephemeralPoints = "";    // Same for points
let confirmationCallback = null;
let noCallback = null;
let pendingGameAction = null; // For actions requiring team name input first
let statsViewMode = 'teams';
let statsMetricKey = 'games';
let statsSortKey = 'recent';
let roundsVersion = 0;
let renderScheduled = false;
let renderHandle = null;
const scheduleFrame = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb) => setTimeout(cb, 0);
const cancelFrame = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  renderHandle = scheduleFrame(() => {
    renderScheduled = false;
    renderHandle = null;
    renderApp();
  });
}

function flushRender() {
  if (renderScheduled && renderHandle !== null) {
    cancelFrame(renderHandle);
    renderScheduled = false;
    renderHandle = null;
  }
  renderApp();
}

function getBaseTotals() {
  return sanitizeTotals(state.startingTotals);
}

function getCurrentTotals() {
  const base = getBaseTotals();
  if (!state.rounds.length) return base;
  const lastRound = state.rounds[state.rounds.length - 1];
  if (lastRound && lastRound.runningTotals && typeof lastRound.runningTotals === 'object') {
    const lastTotals = sanitizeTotals(lastRound.runningTotals);
    if (Number.isFinite(Number(lastRound.runningTotals.us)) || Number.isFinite(Number(lastRound.runningTotals.dem))) {
      return lastTotals;
    }
  }
  return state.rounds.reduce((acc, round) => {
    const usPoints = Number(round.usPoints);
    const demPoints = Number(round.demPoints);
    return {
      us: acc.us + (Number.isFinite(usPoints) ? usPoints : 0),
      dem: acc.dem + (Number.isFinite(demPoints) ? demPoints : 0),
    };
  }, { ...base });
}

function getLastRunningTotals() {
  if (state.rounds.length) {
    return sanitizeTotals(state.rounds[state.rounds.length - 1].runningTotals);
  }
  return getBaseTotals();
}

let presetBids;
  try {
    const raw = localStorage.getItem(PRESET_BIDS_KEY);
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      const numericPresets = parsed
        .filter(value => typeof value === 'number' && Number.isFinite(value))
        .filter(value => value > 0 && value % 5 === 0)
        .filter(value => (value <= 180 || value === 360) && value <= 360);
      const uniqueSorted = Array.from(new Set(numericPresets)).sort((a, b) => a - b);
      presetBids = uniqueSorted.length ? [...uniqueSorted, "other"] : null;
    } else {
      presetBids = null;
    }
   } catch (_) { presetBids = null; }
  if (!presetBids) presetBids = [120,125,130,135,140,145,"other"];

let scoreCardAnimationIdentity = "";
let historyCardAnimationRoundCount = 0;
const renderedCardPopAnimationKeys = new Set();
const HISTORY_RENDER_CACHE = { key: null, html: "" };

function resetRenderAnimationState() {
  scoreCardAnimationIdentity = "";
  historyCardAnimationRoundCount = 0;
  renderedCardPopAnimationKeys.clear();
  HISTORY_RENDER_CACHE.key = null;
  HISTORY_RENDER_CACHE.html = "";
}

function getCardPopAnimation(options = {}) {
  const {
    duration = "0.5s",
    delay = "0s",
    easing = "cubic-bezier(0.34, 1.56, 0.64, 1)",
  } = options;

  return {
    className: " animate-card-pop",
    attrs: ` style="--card-pop-duration: ${duration}; --card-pop-delay: ${delay}; --card-pop-easing: ${easing};"`,
  };
}

function getOneShotCardPopAnimation(key, options = {}) {
  if (!key || renderedCardPopAnimationKeys.has(key)) return { className: "", attrs: "" };
  renderedCardPopAnimationKeys.add(key);
  return getCardPopAnimation(options);
}

function getScoreCardAnimation(biddingTeam, options = {}) {
  const identity = biddingTeam || "";
  if (!identity) {
    scoreCardAnimationIdentity = "";
    return { className: "", attrs: "" };
  }
  if (scoreCardAnimationIdentity === identity) return { className: "", attrs: "" };
  scoreCardAnimationIdentity = identity;
  return getCardPopAnimation(options);
}

function getHistoryCardAnimation(roundCount, options = {}) {
  if (!roundCount) {
    historyCardAnimationRoundCount = 0;
    return { className: "", attrs: "" };
  }
  if (historyCardAnimationRoundCount === roundCount) return { className: "", attrs: "" };
  historyCardAnimationRoundCount = roundCount;
  return getCardPopAnimation(options);
}

function renderWinProbability() {
  // Only show if enabled
  if (!state.showWinProbability) return "";

  const { rounds, usTeamName, demTeamName, gameOver } = state;
  if (rounds.length === 0 || gameOver) return "";
  const historicalGames = getLocalStorage("savedGames");
  const winProb = getWinProbability(state, historicalGames);
  const labelUs = usTeamName || "Us";
  const labelDem = demTeamName || "Dem";

  // Get current game state for context
  const lastRound = rounds[rounds.length - 1];
  const currentScores = lastRound.runningTotals || { us: 0, dem: 0 };
  const scoreDiff = currentScores.us - currentScores.dem;
  const leader = scoreDiff > 0 ? labelUs : scoreDiff < 0 ? labelDem : "Tied";
  const margin = Math.abs(scoreDiff);

  // Determine win probability context
  let contextText = "";
  if (scoreDiff === 0) {
    contextText = "Even game";
  } else if (margin <= 30) {
    contextText = `${leader} slightly ahead`;
  } else if (margin <= 60) {
    contextText = `${leader} leading`;
  } else {
    contextText = `${leader} strongly ahead`;
  }

  return `
    <div id="winProbabilityDisplay" class="text-center text-sm text-gray-600 dark:text-gray-300 border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
<div class="flex items-center justify-center gap-4 mb-2">
  <div class="flex items-center gap-2">
    <div class="w-2 h-2 rounded-full bg-primary"></div>
    <span class="font-medium">${labelUs}: ${winProb.us.toFixed(1)}%</span>
  </div>
  <div class="flex items-center gap-2">
    <div class="w-2 h-2 rounded-full bg-accent"></div>
    <span class="font-medium">${labelDem}: ${winProb.dem.toFixed(1)}%</span>
  </div>
</div>
<div class="text-xs text-gray-500 dark:text-gray-400">
  ${contextText} • ${historicalGames.length} games analyzed
</div>
    </div>
  `;
}
