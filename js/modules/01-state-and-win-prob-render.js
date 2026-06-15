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
const scheduleFrame = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb) => setTimeout(cb, 0);

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  scheduleFrame(() => {
    renderScheduled = false;
    renderApp();
  });
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
