"use strict";

// --- Configuration & Constants ---
const MUST_WIN_BY_BID_KEY = "rookMustWinByBid";
const TABLE_TALK_PENALTY_TYPE_KEY = "tableTalkPenaltyType";
const TABLE_TALK_PENALTY_POINTS_KEY = "tableTalkPenaltyPoints";
const WIN_PROB_CALC_METHOD_KEY = "winProbCalcMethod";
const ACTIVE_GAME_KEY = "activeGameState";
const PRO_MODE_KEY = "proModeEnabled";
const THEME_KEY = "rookSelectedTheme";
const PRESET_BIDS_KEY = 'customPresetBids';
const PROB_CACHE = new Map();   // memoise across calls
const TEAM_STORAGE_VERSION = 2;
const TEAM_KEY_SEPARATOR = "||";
function sanitizeTotals(input) {
  if (!input || typeof input !== 'object') return { us: 0, dem: 0 };
  const parse = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };
  return { us: parse(input.us), dem: parse(input.dem) };
}
const DEFAULT_STATE = {
  rounds: [], undoneRounds: [], biddingTeam: "", bidAmount: "",
  customBidValue: "", showCustomBid: false, enterBidderPoints: false,
  error: "", gameOver: false, winner: null, victoryMethod: null,
  savedScoreInputStates: { us: null, dem: null }, lastBidAmount: null,
  lastBidTeam: null,
  usTeamName: "", demTeamName: "",
  usPlayers: ["", ""], demPlayers: ["", ""],
  startTime: null,
  accumulatedTime: 0, showWinProbability: false, pendingPenalty: null,
  timerLastSavedAt: null,
  startingTotals: { us: 0, dem: 0 },
};

function sanitizePlayerName(name) {
  return (typeof name === "string" ? name : "").trim().replace(/\s+/g, " ");
}

function ensurePlayersArray(input) {
  const arr = Array.isArray(input) ? input : [];
  return [sanitizePlayerName(arr[0] ?? ""), sanitizePlayerName(arr[1] ?? "")];
}

function canonicalizePlayers(players) {
  const arr = ensurePlayersArray(players);
  const nonEmpty = arr.filter(Boolean);
  if (!nonEmpty.length) return arr;
  const sorted = [...nonEmpty].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return [sorted[0] || '', sorted[1] || ''];
}

function formatTeamDisplay(players) {
  const cleaned = ensurePlayersArray(players).filter(Boolean);
  return cleaned.join(" & ");
}

function buildTeamKey(players) {
  const cleaned = ensurePlayersArray(players)
    .filter(Boolean)
    .map(name => name.toLowerCase());
  return cleaned.sort().join(TEAM_KEY_SEPARATOR);
}

function parseLegacyTeamName(teamName) {
  const raw = sanitizePlayerName(teamName);
  if (!raw) return ["", ""];
  const separators = [/\s*&\s*/i, /\s+and\s+/i, /\s*\+\s*/i, /\s*\/\s*/, /\s*,\s*/];
  for (const sep of separators) {
    if (sep.test(raw)) {
      const parts = raw.split(sep).map(sanitizePlayerName).filter(Boolean);
      if (parts.length >= 2) return [parts[0], parts[1]];
    }
  }
  return [raw, ""];
}

function deriveTeamDisplay(players, fallback = "") {
  const display = formatTeamDisplay(players);
  return display || fallback;
}

function getGameTeamDisplay(game, side) {
  const fallback = side === 'us' ? 'Us' : 'Dem';
  if (!game || (side !== 'us' && side !== 'dem')) return fallback;
  const playersField = side === 'us' ? game.usPlayers || game.usTeamPlayers || game.usTeam : game.demPlayers || game.demTeamPlayers || game.demTeam;
  const canonicalPlayers = canonicalizePlayers(playersField);
  const nameField = side === 'us' ? (game.usTeamName || game.usName) : (game.demTeamName || game.demName);
  return deriveTeamDisplay(canonicalPlayers, nameField || fallback) || fallback;
}

function playersEqual(a, b) {
  const [a1, a2] = canonicalizePlayers(a);
  const [b1, b2] = canonicalizePlayers(b);
  return a1 === b1 && a2 === b2;
}

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

function getBaseTotals() {
  return sanitizeTotals(state.startingTotals);
}

function getCurrentTotals() {
  const base = getBaseTotals();
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
    presetBids   = Array.isArray(parsed) && parsed.length ? parsed : null;
   } catch (_) { presetBids = null; }
  if (!presetBids) presetBids = [120,125,130,135,140,145,"other"]; 

let scoreCardHasAnimated  = false;
let historyCardHasAnimated = false;

function renderWinProbability() {
  // Only show if enabled
  if (!state.showWinProbability) return "";

  const { rounds, usTeamName, demTeamName, gameOver } = state;
  if (rounds.length === 0 || gameOver) return "";
  const historicalGames = getLocalStorage("savedGames");
  const winProb = calculateWinProbability(state, historicalGames);
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

// --- Win‑probability engine -------------------------------------------

function bucketScore(diff) {
  const sign = diff < 0 ? -1 : 1;
  const abs  = Math.min(Math.abs(diff), 180);   // ≥180 ⇒ final bucket
  const band = Math.floor(abs / 20) * 20;       // 0‑19,20‑39,…160‑179
  return sign * band;                           // e.g.  -40  or  120
}

function buildProbabilityIndex(historicalGames) {
  const table = {};

  const add = (k, winner, weight) => {
    if (!table[k]) table[k] = { us: 1, dem: 1 };      // Laplace prior (1 | 1)
    table[k][winner] += weight;
  };

  historicalGames.forEach(g => {
    if (!g.rounds?.length || !g.finalScore) return;

    const winner = g.finalScore.us > g.finalScore.dem ? 'us' : 'dem';
    const ageDays = (Date.now() - new Date(g.timestamp)) / 86_400_000;
    const w       = Math.pow(0.8, ageDays / 14);             // recency weight

    g.rounds.forEach((r, idx) => {
if (!r.runningTotals) return;
const diff = r.runningTotals.us - r.runningTotals.dem;
const key  = `${idx}|${bucketScore(diff)}`;
add(key, winner, w);
    });
  });
  return table;
}

function calculateWinProbabilitySimple(currentGame, historicalGames) {
  const { rounds } = currentGame;

  if (!rounds || rounds.length === 0) {
    console.log("Win Probabilities: US=50%, DEM=50%");
    console.log("Factors: None - No rounds played");
    return { us: 50, dem: 50, factors: [] };
  }

  // Get current scores
  const lastRound = rounds[rounds.length - 1];
  const currentScores = lastRound.runningTotals || { us: 0, dem: 0 };
  const scoreDiff = currentScores.us - currentScores.dem;
  const roundsPlayed = rounds.length;

  // Base probability calculation from score difference
  let baseProb = 50 + (scoreDiff / 15);  // Each 12 points is worth 1% advantage

  // Adjust for tendency to come back from behind
  let comebackFactor = 0;

  // Find similar historical games based on completion status and rounds
  const relevantGames = historicalGames.filter(game => {
    return game.rounds && 
     game.rounds.length > 0 && 
     game.rounds.length >= roundsPlayed && 
     game.finalScore && 
     (game.finalScore.us !== undefined || game.finalScore.dem !== undefined);
  });

  // Analyze comebacks in historical games
  if (relevantGames.length > 0) {
    let comebackCount = 0;
    let totalSimilarSituations = 0;

    relevantGames.forEach(game => {
if (!game.rounds || game.rounds.length <= roundsPlayed) return;

const historicalRound = game.rounds[roundsPlayed - 1];
const finalScores = game.finalScore;

if (!historicalRound || !finalScores) return;

const historicalScores = historicalRound.runningTotals;
if (!historicalScores) return;

const historicalLeader = historicalScores.us > historicalScores.dem ? "us" : "dem";
const finalWinner = finalScores.us > finalScores.dem ? "us" : "dem";

if (historicalLeader !== finalWinner) {
  comebackCount++;
}

totalSimilarSituations++;
    });

    if (totalSimilarSituations > 0) {
const comebackRate = comebackCount / totalSimilarSituations;
comebackFactor = Math.round(comebackRate * 10); // Max 10% adjustment
    }
  }

  // Momentum factor based on recent rounds
  let momentumFactor = 0;
  if (rounds.length >= 3) {
    let recentUsPoints = 0;
    let recentDemPoints = 0;

    for (let i = rounds.length - 3; i < rounds.length; i++) {
if (i >= 0) {
  recentUsPoints += rounds[i].usPoints || 0;
  recentDemPoints += rounds[i].demPoints || 0;
}
    }

    if (recentUsPoints > recentDemPoints) {
momentumFactor = 2;
    } else if (recentDemPoints > recentUsPoints) {
momentumFactor = -2;
    }
  }

  // Bid strength factor
  let bidStrengthFactor = 0;
  const usHighBids = rounds.filter(r => r.biddingTeam === "us" && r.bidAmount >= 140).length;
  const demHighBids = rounds.filter(r => r.biddingTeam === "dem" && r.bidAmount >= 140).length;

  if (usHighBids > demHighBids) {
    bidStrengthFactor = 2;
  } else if (demHighBids > usHighBids) {
    bidStrengthFactor = -2;
  }

  // Calculate final probability
  const adjustedProb = Math.min(Math.max(baseProb + momentumFactor + comebackFactor + bidStrengthFactor, 1), 99);

  // Factors for explanation
  const factors = [
    { name: "Score Difference", value: Math.round((scoreDiff / 20)), description: `${Math.abs(scoreDiff)} point difference` },
    { name: "Momentum", value: momentumFactor, description: momentumFactor !== 0 ? `Recent rounds trend` : "No clear momentum" },
    { name: "Comeback Tendency", value: comebackFactor, description: `Based on ${relevantGames.length} completed games` },
    { name: "Bid Strength", value: bidStrengthFactor, description: `High bids: us (${usHighBids}), dem (${demHighBids})` }
  ];

  return {
    us: adjustedProb,
    dem: 100 - adjustedProb,
    factors: factors
  };
}
// --- Calibrated logistic (trained 2025-06-20 on 44 games) -------------
const L_INTERCEPT   =  0.2084586876141831;
const L_COEFF_DIFF  =  0.00421107;
const L_COEFF_ROUND = -0.09520921;
const L_COEFF_MOM   =  0.00149416;

function logisticProb(diff, roundIdx, mom) {
  const z = L_INTERCEPT +
      L_COEFF_DIFF  * diff +
      L_COEFF_ROUND * roundIdx +
      L_COEFF_MOM   * mom;
  return 1 / (1 + Math.exp(-z));           // probability "us" eventually wins
}

/**
 * SHARPENED: Calculates win probability by blending historical empirical data
 * with a logistic regression model for a more robust and accurate prediction.
 */
function calculateWinProbabilityComplex(state, historicalGames) {
  // ---------------- Guards & Setup ----------------
  const { rounds } = state;
  if (!rounds?.length) return { us: 50, dem: 50 }; // No rounds played yet, 50/50 chance.

  const lastRound = rounds[rounds.length - 1];
  const roundIndex = rounds.length - 1;
  const currentDiff = lastRound.runningTotals.us - lastRound.runningTotals.dem;

  // ---------------- 1. Empirical Probability (from Historical Data) ----------------
  // Get the pre-computed index of historical game outcomes.
  // We use memoization (PROB_CACHE) to avoid rebuilding this on every single call.
  const cacheKey = historicalGames.length;
  if (!PROB_CACHE.has(cacheKey)) {
    PROB_CACHE.set(cacheKey, buildProbabilityIndex(historicalGames));
  }
  const table = PROB_CACHE.get(cacheKey);

  // Find the result for the current game situation (round index + bucketed score difference).
  const key = `${roundIndex}|${bucketScore(currentDiff)}`;
  const counts = table[key] || { us: 1, dem: 1 }; // Use Laplace prior (1,1) if no data.
  const empiricalProbUs = counts.us / (counts.us + counts.dem);

  // Count how many actual past games fall into this bucket (before our +1 prior).
  const observationsInBucket = (counts.us - 1) + (counts.dem - 1);

  // ---------------- 2. Model-Based Probability (Logistic Regression) ----------------
  // Calculate momentum (change in score difference from the previous round).
  const prevRound = rounds.length > 1 ? rounds[rounds.length - 2] : { runningTotals: { us: 0, dem: 0 } };
  const prevDiff = prevRound.runningTotals.us - prevRound.runningTotals.dem;
  const momentum = currentDiff - prevDiff;

  // Get the "smoothed" probability from your trained logistic model.
  const modelProbUs = logisticProb(currentDiff, roundIndex, momentum);

  // ---------------- 3. Blending with Credibility Weighting (The Core Improvement) ----------------
  // Create a weight 'beta' that determines how much we trust the empirical data.
  // The more data we have for a situation (observationsInBucket), the higher the weight.
  // If we have no data, the weight is 0, and we rely 100% on the logistic model.

  // K is the number of observations at which we are 'fully confident' in the empirical data.
  // A value of 30 means after 30 similar past situations, we heavily trust the historical record.
  const K_CONFIDENCE_THRESHOLD = 30; 
  const beta = Math.min(1, Math.log(observationsInBucket + 1) / Math.log(K_CONFIDENCE_THRESHOLD + 1));

  // The final probability is a weighted average of the two approaches.
  const blendedProbUs = (beta * empiricalProbUs) + ((1 - beta) * modelProbUs);

  return {
    us: +(blendedProbUs * 100).toFixed(1),
    dem: +((1 - blendedProbUs) * 100).toFixed(1)
  };
}

function calculateWinProbability(state, historicalGames) {
  // Get the user's preference for calculation method
  // Change default from 'complex' to 'simple'
  const method = getLocalStorage(WIN_PROB_CALC_METHOD_KEY, "simple");

  if (method === "simple") {
    return calculateWinProbabilitySimple(state, historicalGames);
  } else {
    return calculateWinProbabilityComplex(state, historicalGames);
  }
}


// --- Local Storage & Sync ---
function setLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
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

function getLocalStorage(key, defaultValue = null) {
  const raw = localStorage.getItem(key);
  if (raw === null) {
    if (defaultValue !== null) return defaultValue;
    if (key === "savedGames" || key === "freezerGames") return [];
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    return raw;
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
  const modalHtml = `
      <div id="presetEditorModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 modal" role="dialog" aria-modal="true" aria-labelledby="presetEditorTitle">
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
  document.body.classList.add('modal-open');
}
function closePresetEditorModal() {
  const modal = document.getElementById('presetEditorModal');
  if (modal) { modal.remove(); document.body.classList.remove('modal-open'); }
}

function validatePresetInput(inputEl) {
  const val = Number(inputEl.value);
  const errDiv = inputEl.nextElementSibling;
  let msg = "";
  if (isNaN(val)) msg = "Must be a number.";
  else if (val <= 0) msg = "Must be > 0.";
  else if (val % 5 !== 0) msg = "Must be div by 5.";
  else if (val > 360) msg = "Cannot exceed 360.";
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
function sortPresets() {
  const inputs = Array.from(document.querySelectorAll('#presetInputs input'));
  const errorMsgEl = document.getElementById('presetErrorMsg');
  if (inputs.some(input => !validatePresetInput(input))) {
      errorMsgEl.textContent = 'Fix errors before sorting.';
      errorMsgEl.classList.remove('hidden');
      setTimeout(() => errorMsgEl.classList.add('hidden'), 3000);
      return;
  }
  const sortedValues = inputs.map(input => Number(input.value)).sort((a, b) => a - b);
  inputs.forEach((input, i) => input.value = sortedValues[i]);
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
  renderApp();
  showSaveIndicator("Bid presets updated");
}

// --- Theme & UI Helpers ---
function enforceDarkMode() {
  const root = document.documentElement;
  if (!root.classList.contains("dark")) {
    root.classList.add("dark");
  }
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", "#111827");
  // Remove legacy flag so we're not tempted to read it elsewhere.
  localStorage.removeItem("darkModeEnabled");
}
function initializeTheme() {
  const body = document.getElementById("bodyRoot") || document.body;

  // Classes that must ALWAYS be present, no matter which theme is selected
  const BASE_BODY_CLASSES = [
    "bg-gray-900",
    "text-white",
    "min-h-screen",
    "transition-colors", "duration-300",
    "liquid-glass"
  ];
  const baseClassString = BASE_BODY_CLASSES.join(" ");

  const ensureBaseClasses = (themeString) => {
    const tokens = new Set((themeString || "").split(/\s+/).filter(Boolean));
    let mutated = false;
    const deprecated = ["bg-white", "text-gray-800", "dark:bg-gray-900", "dark:text-white"];
    for (const cls of deprecated) {
      if (tokens.delete(cls)) mutated = true;
    }
    for (const cls of BASE_BODY_CLASSES) {
      if (!tokens.has(cls)) {
        tokens.add(cls);
        mutated = true;
      }
    }
    return { normalized: Array.from(tokens).join(" "), mutated };
  };

  // ------------------------------------------------------------------
  //  One-time migration for themes stored by older app versions
  // ------------------------------------------------------------------
  let savedTheme = localStorage.getItem("rookSelectedTheme");

  if (savedTheme) {
    const { normalized, mutated } = ensureBaseClasses(savedTheme);
    if (mutated && normalized !== savedTheme) {
      localStorage.setItem("rookSelectedTheme", normalized);
    }
    body.className = normalized;
    return;
  }

  // ------------------------------------------------------------------
  //  Apply the theme (or fall back to default)
  // ------------------------------------------------------------------
  // First launch / user has never customised a theme
  body.className = `${baseClassString} theme-blue-red`.trim();
}
function isValidHexColor(colorString) {
  if (!colorString || typeof colorString !== 'string') return false;
  // Basic hex color validation (e.g., #RRGGBB or #RGB)
  return /^#([0-9A-F]{3}){1,2}$/i.test(colorString);
}

function sanitizeHexColor(colorString) {
  if (typeof colorString !== 'string') return '';
  const trimmed = colorString.trim();
  if (!trimmed) return '';
  const withoutQuotes = trimmed.replace(/^['"]+|['"]+$/g, '');
  if (!withoutQuotes) return '';
  const candidate = withoutQuotes.startsWith('#') ? withoutQuotes : `#${withoutQuotes}`;
  return isValidHexColor(candidate) ? candidate : '';
}

function initializeCustomThemeColors() {
  const rootStyles = getComputedStyle(document.documentElement);
  const defaultUsColor = rootStyles.getPropertyValue('--primary-color').trim() || "#3b82f6";
  const defaultDemColor = rootStyles.getPropertyValue('--accent-color').trim() || "#ef4444";

  const storedUsColor = localStorage.getItem('customUsColor');
  const storedDemColor = localStorage.getItem('customDemColor');

  const body = document.getElementById('bodyRoot');
  const usPicker = document.getElementById('usColorPicker');
  const demPicker = document.getElementById('demColorPicker');

  const usColor = sanitizeHexColor(storedUsColor);
  if (usColor) {
    if (storedUsColor !== usColor) localStorage.setItem('customUsColor', usColor);
    if (body) body.style.setProperty('--primary-color', usColor);
    if (usPicker) usPicker.value = usColor;
  } else {
    if (storedUsColor !== null) { // Warn only when a value existed
      console.warn(`Invalid customUsColor ("${storedUsColor}") in localStorage. Using default.`);
      localStorage.removeItem('customUsColor');
    }
    if (body) body.style.setProperty('--primary-color', defaultUsColor);
    if (usPicker) usPicker.value = defaultUsColor;
  }

  const demColor = sanitizeHexColor(storedDemColor);
  if (demColor) {
    if (storedDemColor !== demColor) localStorage.setItem('customDemColor', demColor);
    if (body) body.style.setProperty('--accent-color', demColor);
    if (demPicker) demPicker.value = demColor;
  } else {
    if (storedDemColor !== null) {
      console.warn(`Invalid customDemColor ("${storedDemColor}") in localStorage. Using default.`);
      localStorage.removeItem('customDemColor');
    }
    if (body) body.style.setProperty('--accent-color', defaultDemColor);
    if (demPicker) demPicker.value = defaultDemColor;
  }
  updatePreview(); // Ensure preview matches
}
function applyCustomThemeColors() {
  const body = document.getElementById('bodyRoot');
  const usPicker = document.getElementById('usColorPicker');
  const demPicker = document.getElementById('demColorPicker');

  const usColor = sanitizeHexColor(usPicker ? usPicker.value : '');
  const demColor = sanitizeHexColor(demPicker ? demPicker.value : '');

  if (usColor) {
    if (body) body.style.setProperty('--primary-color', usColor);
    localStorage.setItem('customUsColor', usColor);
  } else {
    localStorage.removeItem('customUsColor');
  }

  if (demColor) {
    if (body) body.style.setProperty('--accent-color', demColor);
    localStorage.setItem('customDemColor', demColor);
  } else {
    localStorage.removeItem('customDemColor');
  }

  closeThemeModal(null); // Pass null if event is not available or needed
}
function resetThemeColors() {
  const defaultUs = "#3b82f6", defaultDem = "#ef4444";
  document.getElementById('bodyRoot').style.setProperty('--primary-color', defaultUs);
  document.getElementById('bodyRoot').style.setProperty('--accent-color', defaultDem);
  localStorage.removeItem('customUsColor');
  localStorage.removeItem('customDemColor');
  const usPicker = document.getElementById('usColorPicker');
  const demPicker = document.getElementById('demColorPicker');
  if (usPicker) usPicker.value = defaultUs;
  if (demPicker) demPicker.value = defaultDem;
  updatePreview();
}
function hslToHex(h, s, l) { // Helper for random colors
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [0, 8, 4].map(n => Math.round(f(n) * 255).toString(16).padStart(2, '0')).join('');
}
function randomizeThemeColors() {
  const h = Math.floor(Math.random() * 360);
  const s = Math.floor(Math.random() * 51) + 50; // Saturation 50-100%
  const l = Math.floor(Math.random() * 41) + 30; // Lightness 30-70%
  document.getElementById('usColorPicker').value = hslToHex(h, s, l);
  document.getElementById('demColorPicker').value = hslToHex((h + 180) % 360, s, l); // Complementary
  updatePreview();
}
function updatePreview() {
  const usColor = document.getElementById('usColorPicker')?.value;
  const demColor = document.getElementById('demColorPicker')?.value;
  const previewUs = document.getElementById('previewUs');
  const previewDem = document.getElementById('previewDem');
  if (previewUs && usColor) previewUs.style.backgroundColor = usColor;
  if (previewDem && demColor) previewDem.style.backgroundColor = demColor;
}
 function openThemeModal(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  document.getElementById("settingsModal")?.classList.add("hidden");
  const themeModalEl = document.getElementById("themeModal");
  if (themeModalEl) {
      themeModalEl.classList.remove("hidden");
      const content = themeModalEl.querySelector(".bg-white, .dark\\:bg-gray-800");
      if (content) content.onclick = e => e.stopPropagation(); // Prevent closing on content click
      initializeCustomThemeColors(); // Ensure pickers and preview are up-to-date
  }
}
function closeThemeModal(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  document.getElementById("themeModal")?.classList.add("hidden");
  document.getElementById("settingsModal")?.classList.remove("hidden"); // Show settings modal again
}
function showSaveIndicator(message = "Saved") {
  const el = document.getElementById("saveIndicator");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden", "bg-red-600"); // Remove error class if present
  el.classList.add("show");
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.classList.add("hidden"), 150); }, 1000);
}

// --- Game State Management ---
function updateState(newState) {
  const nextState = { ...newState };

  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

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
  renderApp();
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
    const now = Date.now();
    const hasRounds = Array.isArray(completeLoadedState.rounds) && completeLoadedState.rounds.length > 0;
    const timerWasRunning = typeof completeLoadedState.startTime === 'number' && !completeLoadedState.gameOver && hasRounds;
    const storedAccumulated = Number(completeLoadedState.accumulatedTime);
    const sanitizedAccumulated = Number.isFinite(storedAccumulated) && storedAccumulated >= 0 ? storedAccumulated : 0;

    if (timerWasRunning) {
if (typeof completeLoadedState.timerLastSavedAt !== 'number') {
  // Legacy snapshots did not pre-accumulate time; cap what we add just in case.
  completeLoadedState.accumulatedTime = calculateSafeTimeAccumulation(sanitizedAccumulated, completeLoadedState.startTime);
} else {
  completeLoadedState.accumulatedTime = Math.min(sanitizedAccumulated, MAX_GAME_TIME_MS);
}
completeLoadedState.startTime = now; // Resume timer from now so offline time is not double-counted.
    } else {
completeLoadedState.accumulatedTime = Math.min(sanitizedAccumulated, MAX_GAME_TIME_MS);
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
    const timerRunning = state.startTime !== null;
    const now = Date.now();
    const finalAccumulated = timerRunning
      ? calculateSafeTimeAccumulation(state.accumulatedTime, state.startTime)
      : Math.min(Number(state.accumulatedTime) || 0, MAX_GAME_TIME_MS);
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

// --- Team Stats Helpers ---
function normalizeTeamsStorage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { data: {}, changed: Boolean(raw && raw !== null) };
  }

  const working = { ...raw };
  delete working.__storageVersion;

  const entries = Object.entries(working);
  if (!entries.length) {
    return { data: {}, changed: raw.__storageVersion !== TEAM_STORAGE_VERSION };
  }

  const isAlreadyNew = entries.every(([, value]) => value && typeof value === 'object' && Array.isArray(value.players));
  if (raw.__storageVersion === TEAM_STORAGE_VERSION && isAlreadyNew) {
    const cleaned = {};
    entries.forEach(([key, value]) => {
      cleaned[key] = {
        players: ensurePlayersArray(value.players),
        displayName: deriveTeamDisplay(value.players, value.displayName || ''),
        wins: Number(value.wins) || 0,
        losses: Number(value.losses) || 0,
        gamesPlayed: Number(value.gamesPlayed) || 0,
      };
    });
    return { data: cleaned, changed: false };
  }

  const converted = {};
  entries.forEach(([legacyName, payload]) => {
    let players = [];
    let stats = { wins: 0, losses: 0, gamesPlayed: 0 };

    if (payload && typeof payload === 'object' && !Array.isArray(payload) && Array.isArray(payload.players)) {
      players = canonicalizePlayers(payload.players);
      stats = {
        wins: Number(payload.wins) || 0,
        losses: Number(payload.losses) || 0,
        gamesPlayed: Number(payload.gamesPlayed) || 0,
      };
    } else {
      players = canonicalizePlayers(parseLegacyTeamName(legacyName));
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        stats = {
          wins: Number(payload.wins) || 0,
          losses: Number(payload.losses) || 0,
          gamesPlayed: Number(payload.gamesPlayed) || 0,
        };
      }
    }

    const key = buildTeamKey(players);
    const displayName = deriveTeamDisplay(players, legacyName);
    if (!converted[key]) {
      converted[key] = { players: canonicalizePlayers(players), displayName, wins: 0, losses: 0, gamesPlayed: 0 };
    }
    converted[key].wins += stats.wins;
    converted[key].losses += stats.losses;
    converted[key].gamesPlayed += stats.gamesPlayed;
    if (!converted[key].displayName) converted[key].displayName = displayName;
  });

  return { data: converted, changed: true };
}

function getTeamsObject() {
  const raw = getLocalStorage("teams") || {};
  const { data, changed } = normalizeTeamsStorage(raw);
  if (changed) setTeamsObject(data);
  return data;
}

function setTeamsObject(obj) {
  const entries = {};
  Object.entries(obj || {}).forEach(([key, value]) => {
    if (!key || !value) return;
    entries[key] = {
      players: canonicalizePlayers(value.players),
      displayName: deriveTeamDisplay(canonicalizePlayers(value.players), value.displayName || ''),
      wins: Number(value.wins) || 0,
      losses: Number(value.losses) || 0,
      gamesPlayed: Number(value.gamesPlayed) || 0,
    };
  });
  setLocalStorage("teams", { __storageVersion: TEAM_STORAGE_VERSION, ...entries });
}

function ensureTeamEntry(teamsObj, players, fallbackDisplay = '') {
  const normalizedPlayers = canonicalizePlayers(players);
  const key = buildTeamKey(normalizedPlayers);
  if (!key) return { teams: teamsObj, key: null };
  if (!teamsObj[key]) {
    teamsObj[key] = {
      players: normalizedPlayers,
      displayName: deriveTeamDisplay(normalizedPlayers, fallbackDisplay || 'Unnamed Team'),
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
    };
  } else {
    teamsObj[key].players = ensurePlayersArray(teamsObj[key].players);
    if (!teamsObj[key].displayName) {
      teamsObj[key].displayName = deriveTeamDisplay(normalizedPlayers, fallbackDisplay || 'Unnamed Team');
    }
  }
  return { teams: teamsObj, key };
}

function applyTeamResultDelta(teamsObj, { usPlayers, demPlayers, usDisplay, demDisplay, winner }, direction = 1) {
  if (!direction) return false;

  const normalizedUs = canonicalizePlayers(usPlayers);
  const normalizedDem = canonicalizePlayers(demPlayers);
  const usName = deriveTeamDisplay(normalizedUs, usDisplay || 'Us') || 'Us';
  const demName = deriveTeamDisplay(normalizedDem, demDisplay || 'Dem') || 'Dem';
  const usKey = buildTeamKey(normalizedUs);
  const demKey = buildTeamKey(normalizedDem);
  if (!usKey || !demKey) return false;

  if (direction > 0) {
    ensureTeamEntry(teamsObj, normalizedUs, usName);
    ensureTeamEntry(teamsObj, normalizedDem, demName);
  }

  const usEntry = teamsObj[usKey];
  const demEntry = teamsObj[demKey];
  if (!usEntry || !demEntry) return false;

  const clamp = (value) => Math.max(0, Number.isFinite(value) ? value : 0);

  usEntry.players = canonicalizePlayers(usEntry.players);
  demEntry.players = canonicalizePlayers(demEntry.players);
  if (!usEntry.displayName) usEntry.displayName = usName;
  if (!demEntry.displayName) demEntry.displayName = demName;

  usEntry.gamesPlayed = clamp((Number(usEntry.gamesPlayed) || 0) + direction);
  demEntry.gamesPlayed = clamp((Number(demEntry.gamesPlayed) || 0) + direction);

  if (winner === 'us') {
    usEntry.wins = clamp((Number(usEntry.wins) || 0) + direction);
    demEntry.losses = clamp((Number(demEntry.losses) || 0) + direction);
  } else if (winner === 'dem') {
    demEntry.wins = clamp((Number(demEntry.wins) || 0) + direction);
    usEntry.losses = clamp((Number(usEntry.losses) || 0) + direction);
  }

  return true;
}

function updateTeamsStatsOnGameEnd(winner) {
  const teams = getTeamsObject();
  const updated = applyTeamResultDelta(teams, {
    usPlayers: state.usPlayers,
    demPlayers: state.demPlayers,
    usDisplay: state.usTeamName,
    demDisplay: state.demTeamName,
    winner,
  }, 1);
  if (updated) setTeamsObject(teams);
}
function recalcTeamsStats() {
  const teams = getTeamsObject();
  Object.values(teams).forEach(entry => {
    if (!entry) return;
    entry.gamesPlayed = 0;
    entry.wins = 0;
    entry.losses = 0;
  });

  const accumulateFromGame = (game) => {
    if (!game) return;
    const usPlayers = canonicalizePlayers(game.usPlayers || parseLegacyTeamName(game.usTeamName || game.usName));
    const demPlayers = canonicalizePlayers(game.demPlayers || parseLegacyTeamName(game.demTeamName || game.demName));
    const usDisplay = deriveTeamDisplay(usPlayers, game.usTeamName || game.usName || 'Us');
    const demDisplay = deriveTeamDisplay(demPlayers, game.demTeamName || game.demName || 'Dem');
    const winner = game.winner === 'us' || game.winner === 'dem' ? game.winner : null;
    applyTeamResultDelta(teams, { usPlayers, demPlayers, usDisplay, demDisplay, winner }, 1);
  };

  const savedGames = getLocalStorage('savedGames', []);
  savedGames.forEach(accumulateFromGame);

  if (state.gameOver && Array.isArray(state.rounds) && state.rounds.length) {
    accumulateFromGame({
      usPlayers: ensurePlayersArray(state.usPlayers),
      demPlayers: ensurePlayersArray(state.demPlayers),
      usTeamName: state.usTeamName,
      demTeamName: state.demTeamName,
      winner: state.winner,
    });
  }

  setTeamsObject(teams);
}
function addTeamIfNotExists(players, display = '') {
  const teams = getTeamsObject();
  const { key } = ensureTeamEntry(teams, players, display);
  if (key) setTeamsObject(teams);
}

// --- Menu & Modal Toggling ---
function toggleMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById("menu");
  const icon = document.getElementById("hamburgerIcon");
  const overlay = document.getElementById("menuOverlay");
  const isOpen = menu.classList.toggle("show");
  icon.classList.toggle("open", isOpen);
  overlay.classList.toggle("show", isOpen);
  document.body.classList.toggle("overflow-hidden", isOpen);
}
function closeMenuOverlay() { toggleMenu(null); } // Simplified close

function openModal(modalId) {
  document.getElementById(modalId)?.classList.remove("hidden");
  document.body.classList.add("modal-open");
  document.getElementById("app")?.classList.add("modal-active");
  document.getElementById(modalId)?.focus(); // For accessibility
}
function closeModal(modalId) {
  document.getElementById(modalId)?.classList.add("hidden");
  document.body.classList.remove("modal-open");
  document.getElementById("app")?.classList.remove("modal-active");
}
function openSavedGamesModal() {
  updateGamesCount();
  switchGamesTab('completed'); // Default to completed games
  renderGamesWithFilter(); // Render based on default filter/sort
  openModal("savedGamesModal");
}
function closeSavedGamesModal() { closeModal("savedGamesModal"); }
function openConfirmationModal(message, yesCb, noCb) {
  document.getElementById("confirmationModalMessage").textContent = message;
  confirmationCallback = yesCb; noCallback = noCb;
  openModal("confirmationModal");
  // Re-bind buttons to avoid multiple listeners if not careful
  const yesBtn = document.getElementById("confirmModalButton");
  const noBtn = document.getElementById("noModalButton");
  const newYes = yesBtn.cloneNode(true); yesBtn.parentNode.replaceChild(newYes, yesBtn);
  const newNo = noBtn.cloneNode(true); noBtn.parentNode.replaceChild(newNo, noBtn);
  newYes.addEventListener("click", (e) => { e.stopPropagation(); if (confirmationCallback) confirmationCallback(); });
  newNo.addEventListener("click", (e) => { e.stopPropagation(); if (noCallback) noCallback(); });
}
function closeConfirmationModal() { closeModal("confirmationModal"); confirmationCallback = null; noCallback = null; }
function openTeamSelectionModal() { populateTeamSelects(); openModal("teamSelectionModal"); }
function closeTeamSelectionModal() { closeModal("teamSelectionModal"); }
function openResumeGameModal() {
  const form = document.getElementById("resumeGameForm");
  const errorEl = document.getElementById("resumeGameError");
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }
  if (form) form.reset();

  const totals = getCurrentTotals();
  const baseNames = {
    us: state.usTeamName || "",
    dem: state.demTeamName || "",
  };

  const usNameInput = document.getElementById("resumeUsName");
  const demNameInput = document.getElementById("resumeDemName");
  const usScoreInput = document.getElementById("resumeUsScore");
  const demScoreInput = document.getElementById("resumeDemScore");

  if (usNameInput) usNameInput.value = baseNames.us;
  if (demNameInput) demNameInput.value = baseNames.dem;
  if (usScoreInput) usScoreInput.value = totals.us;
  if (demScoreInput) demScoreInput.value = totals.dem;

  openModal("resumeGameModal");
}
function closeResumeGameModal() {
  const errorEl = document.getElementById("resumeGameError");
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }
  closeModal("resumeGameModal");
}
function handleResumeGameSubmit(event) {
  event.preventDefault();
  const errorEl = document.getElementById("resumeGameError");
  const showError = (message) => {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove("hidden");
    } else {
      alert(message);
    }
  };

  const usScoreInput = document.getElementById("resumeUsScore");
  const demScoreInput = document.getElementById("resumeDemScore");

  if (!usScoreInput || !demScoreInput) {
    closeResumeGameModal();
    return;
  }

  const usScore = Number(usScoreInput.value);
  const demScore = Number(demScoreInput.value);

  const scoresAreNumbers = Number.isFinite(usScore) && Number.isFinite(demScore);
  if (!scoresAreNumbers) {
    showError("Scores must be numbers.");
    return;
  }

  const withinBounds = Math.abs(usScore) <= 1000 && Math.abs(demScore) <= 1000;
  if (!withinBounds) {
    showError("Scores should stay between -1000 and 1000.");
    return;
  }

  const isMultipleOfFive = (value) => Math.abs(value % 5) < 1e-9;
  if (!isMultipleOfFive(usScore) || !isMultipleOfFive(demScore)) {
    showError("Scores must be in increments of 5.");
    return;
  }

  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }

  const usName = (document.getElementById("resumeUsName")?.value || "").trim();
  const demName = (document.getElementById("resumeDemName")?.value || "").trim();

  const startingTotals = sanitizeTotals({ us: usScore, dem: demScore });
  const updates = {
    rounds: [],
    undoneRounds: [],
    startingTotals,
    gameOver: false,
    winner: null,
    victoryMethod: null,
    lastBidAmount: null,
    lastBidTeam: null,
    biddingTeam: "",
    bidAmount: "",
    showCustomBid: false,
    customBidValue: "",
    enterBidderPoints: false,
    error: "",
    startTime: null,
    accumulatedTime: 0,
    timerLastSavedAt: null,
    pendingPenalty: null,
    savedScoreInputStates: { us: null, dem: null },
  };

  if (usName) updates.usTeamName = usName;
  if (demName) updates.demTeamName = demName;

  updateState(updates);
  confettiTriggered = false;
  pendingGameAction = null;
  closeResumeGameModal();
  saveCurrentGameState();
  showSaveIndicator("Starting scores set!");
}

// Ensure resume modal helpers are available to inline handlers
if (typeof window !== "undefined") {
  window.openResumeGameModal = openResumeGameModal;
  window.closeResumeGameModal = closeResumeGameModal;
  window.handleResumeGameSubmit = handleResumeGameSubmit;
}
function saveWinProbMethod() {
  const select = document.getElementById("winProbMethodSelect");
  if (select) {
    setLocalStorage(WIN_PROB_CALC_METHOD_KEY, select.value);
    // Refresh the display if win probability is currently shown
    if (state.showWinProbability) {
      renderApp();
    }
  }
}

function openSettingsModal() {
  const mustWinToggle = document.getElementById("mustWinByBidToggle");
  if (mustWinToggle) mustWinToggle.checked = JSON.parse(localStorage.getItem(MUST_WIN_BY_BID_KEY) || "false");
  const proToggleModal = document.getElementById("proModeToggleModal");
  if (proToggleModal) proToggleModal.checked = JSON.parse(localStorage.getItem(PRO_MODE_KEY) || "false");
  document.getElementById('editPresetsContainerModal')?.classList.remove('hidden'); // Always show

  // Load all settings using the common function
  loadSettings();

  openModal("settingsModal");
}
function closeSettingsModal() { 
  saveSettings(); 
  closeModal("settingsModal"); 
}
function openAboutModal() { openModal("aboutModal"); }
function closeAboutModal() { closeModal("aboutModal"); }
function openStatisticsModal() { renderStatisticsContent(); openModal("statisticsModal"); }
function closeStatisticsModal() { closeModal("statisticsModal"); document.getElementById("statisticsModalContent").innerHTML = "";}
function openViewSavedGameModal() { openModal("viewSavedGameModal"); }
function closeViewSavedGameModal() { closeModal("viewSavedGameModal"); openModal("savedGamesModal"); } // Reopen parent

function openZeroPointsModal(callback) {
  let zeroPointsCallback = callback;

  // Open the modal
  openModal("zeroPointsModal");

  // Add event listeners to the buttons
  const btn180 = document.getElementById("zeroPts180Btn");
  const btn360 = document.getElementById("zeroPts360Btn");
  const btnCancel = document.getElementById("zeroPtsCancelBtn");

  // Remove existing listeners by cloning nodes
  const newBtn180 = btn180.cloneNode(true);
  const newBtn360 = btn360.cloneNode(true);
  const newBtnCancel = btnCancel.cloneNode(true);

  btn180.parentNode.replaceChild(newBtn180, btn180);
  btn360.parentNode.replaceChild(newBtn360, btn360);
  btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

  // Add new event listeners
  newBtn180.addEventListener("click", (e) => {
    e.stopPropagation();
    closeModal("zeroPointsModal");
    if (zeroPointsCallback) zeroPointsCallback(180);
  });

  newBtn360.addEventListener("click", (e) => {
    e.stopPropagation();
    closeModal("zeroPointsModal");
    if (zeroPointsCallback) zeroPointsCallback(360);
  });

  newBtnCancel.addEventListener("click", (e) => {
    e.stopPropagation();
    closeModal("zeroPointsModal");
    // No callback on cancel
  });
}

function closeZeroPointsModal() {
  closeModal("zeroPointsModal");
}

// --- Game Actions & Logic ---
function handleCheatFlag() {
  if (!state.biddingTeam) return;  // Can't apply penalty without an active bidding team

  // Open team selection modal for table talk penalty
  openTableTalkModal();
}

function openTableTalkModal() {
  const usTeamName = state.usTeamName || "Us";
  const demTeamName = state.demTeamName || "Dem";

  const modalHtml = `
    <div class="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center p-4 z-50" id="tableTalkModal">
      <div class="bg-white dark:bg-gray-800 w-full max-w-md rounded-xl shadow-lg">
        <div class="p-6">
          <h2 class="text-xl font-bold mb-4 text-gray-800 dark:text-white text-center">Table Talk Penalty</h2>
          <p class="text-gray-600 dark:text-gray-300 mb-6 text-center">Which team engaged in table talk during this round?</p>
          <div class="space-y-3">
            <button 
              onclick="applyTableTalkPenalty('us')" 
              class="w-full text-white px-4 py-3 rounded-xl font-medium focus:outline-none hover:opacity-90 transition threed" 
              style="background-color: var(--primary-color);">
              ${usTeamName}
            </button>
            <button 
              onclick="applyTableTalkPenalty('dem')" 
              class="w-full text-white px-4 py-3 rounded-xl font-medium focus:outline-none hover:opacity-90 transition threed" 
              style="background-color: var(--accent-color);">
              ${demTeamName}
            </button>
          </div>
          <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
            <button 
              onclick="closeTableTalkModal()" 
              class="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white transition threed">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  document.body.classList.add('modal-open');
}

function closeTableTalkModal() {
  const modal = document.getElementById('tableTalkModal');
  if (modal) {
    modal.remove();
    document.body.classList.remove('modal-open');
  }
}

function applyTableTalkPenalty(flaggedTeam) {
  const teamName = flaggedTeam === "us" 
    ? (state.usTeamName || "Us") 
    : (state.demTeamName || "Dem");

  closeTableTalkModal();

  // Get penalty type and create appropriate confirmation message
  const penaltyType = getLocalStorage(TABLE_TALK_PENALTY_TYPE_KEY, "setPoints");
  let confirmationMessage;

  console.log("Table Talk Penalty Type:", penaltyType);

  if (penaltyType === "setPoints") {
    const penaltyPoints = getLocalStorage(TABLE_TALK_PENALTY_POINTS_KEY, "180");
    console.log("Using setPoints penalty:", penaltyPoints);
    confirmationMessage = `Flag ${teamName} for table-talk? They will lose ${penaltyPoints} points.`;
  } else {
    // penaltyType === "loseBid" - they lose the bid amount in points
    const bidAmount = state.bidAmount || "0";
    console.log("Using loseBid penalty:", bidAmount);
    confirmationMessage = `Flag ${teamName} for table-talk? They will lose ${bidAmount} points (the bid amount).`;
  }

  // Show confirmation before applying penalty
  openConfirmationModal(
    confirmationMessage,
    () => { // YES
      applyCheatPenaltyRound(flaggedTeam);
      closeConfirmationModal();
      showSaveIndicator(`Penalty applied to ${teamName}`);
    },
    closeConfirmationModal // NO
  );
}

function applyCheatPenaltyRound(flaggedTeam) {
  // Get current state values
  const { biddingTeam, bidAmount, rounds, usTeamName, demTeamName } = state;
  if (!biddingTeam || !bidAmount) return;
  const numericBid = Number(bidAmount);
  const lastTotals = getLastRunningTotals();

  // Get penalty type and calculate penalty amount
  const penaltyType = getLocalStorage(TABLE_TALK_PENALTY_TYPE_KEY, "setPoints");
  let penaltyAmount;

  if (penaltyType === "setPoints") {
    penaltyAmount = parseInt(getLocalStorage(TABLE_TALK_PENALTY_POINTS_KEY, "180"));
  } else {
    penaltyAmount = numericBid; // Traditional penalty - lose the bid amount
  }

  let usEarned = 0, demEarned = 0;
  if (flaggedTeam === "us") {
    usEarned = -penaltyAmount;
    demEarned = 0;
  } else {
    usEarned = 0;
    demEarned = -penaltyAmount;
  }
  const newTotals = { us: lastTotals.us + usEarned, dem: lastTotals.dem + demEarned };
  const newRound = {
    biddingTeam,
    bidAmount: numericBid,
    usPoints: usEarned,
    demPoints: demEarned,
    runningTotals: newTotals,
    usTeamNameOnRound: usTeamName || "Us",
    demTeamNameOnRound: demTeamName || "Dem",
    penalty: "cheat",
    penaltyType: penaltyType,
    penaltyAmount: penaltyAmount
  };
  const updatedRounds = [...rounds, newRound];

  // Check for game over
  const mustWinByBid = getLocalStorage(MUST_WIN_BY_BID_KEY, false);
  let gameFinished = false, theWinner = null, victoryMethod = "Penalty: Lost Bid";
  if (Math.abs(newTotals.us - newTotals.dem) >= 1000) {
    gameFinished = true; theWinner = newTotals.us > newTotals.dem ? "us" : "dem"; victoryMethod = "1000 Point Spread";
  } else if ((biddingTeam === "us" && usEarned < 0 && newTotals.dem >= 500) || (biddingTeam === "dem" && demEarned < 0 && newTotals.us >= 500)) {
    if (!mustWinByBid) { gameFinished = true; theWinner = biddingTeam === "us" ? "dem" : "us"; victoryMethod = "Set Other Team"; }
  } else if (
// bidder wins by making their bid and crossing 500
(biddingTeam === "us" && newTotals.us >= 500 && usEarned >= numericBid) ||
(biddingTeam === "dem" && newTotals.dem >= 500 && demEarned >= numericBid)
    ) {
gameFinished   = true;
theWinner      = biddingTeam;
victoryMethod  = "Won on Bid";
    } else if (
// non-bidding team wins by setting the bidder and crossing 500
(biddingTeam === "us" && usEarned < 0 && newTotals.dem >= 500) ||
(biddingTeam === "dem" && demEarned < 0 && newTotals.us >= 500)
    ) {
gameFinished   = true;
theWinner      = biddingTeam === "us" ? "dem" : "us";
victoryMethod  = "Set Other Team";
    }
    // no "auto-win at 500+" fallback any more

  let finalAccumulated = state.accumulatedTime;
  if (state.startTime !== null && !gameFinished) { /* Time continues */ }
  else if (state.startTime !== null && gameFinished) { 
    finalAccumulated = calculateSafeTimeAccumulation(state.accumulatedTime, state.startTime);
  }

  updateState({
    rounds: updatedRounds,
    undoneRounds: [],
    gameOver: gameFinished,
    winner: theWinner,
    victoryMethod,
    biddingTeam: "",
    bidAmount: "",
    showCustomBid: false,
    customBidValue: "",
    enterBidderPoints: false,
    error: "",
    accumulatedTime: finalAccumulated,
    startTime: gameFinished ? null : state.startTime,
    pendingPenalty: null
  });
  if (gameFinished && theWinner) updateTeamsStatsOnGameEnd(theWinner);
  saveCurrentGameState();
}

function handleTeamClick(team) {
  if (state.gameOver) return;
  if (state.biddingTeam === team) { // Click active team to deselect
    state.savedScoreInputStates[team] = { bidAmount: state.bidAmount, customBidValue: state.customBidValue, showCustomBid: state.showCustomBid, enterBidderPoints: state.enterBidderPoints, error: state.error };
    updateState({ biddingTeam: "", bidAmount: "", showCustomBid: false, customBidValue: "", enterBidderPoints: false, error: ""});
  } else { // Select a new team
    state.savedScoreInputStates[team === "us" ? "dem" : "us"] = null; // Clear other team's saved input
    let newTeamState = { biddingTeam: team, bidAmount: "", showCustomBid: false, customBidValue: "", enterBidderPoints: false, error: "" };
    if (state.savedScoreInputStates[team]) { // Restore if previously selected
      newTeamState = { ...newTeamState, ...state.savedScoreInputStates[team] };
    }
    updateState(newTeamState);
  }
  ephemeralCustomBid = ""; ephemeralPoints = ""; // Clear ephemeral inputs on team switch
}
function handleBidSelect(bid) {
  if (bid === "other") {
    updateState({ showCustomBid: true, bidAmount: "", customBidValue: ephemeralCustomBid }); // Keep current custom bid if switching back
  } else {
    updateState({ showCustomBid: false, bidAmount: String(bid), customBidValue: "" });
  }
  // Update last bid info only if a numeric bid is made or custom bid is valid
  const bidVal = (bid === "other" && validateBid(state.customBidValue)==="") ? state.customBidValue : (bid !== "other" ? String(bid) : null);
  if (bidVal) updateState({ lastBidAmount: bidVal, lastBidTeam: state.biddingTeam });
  else updateState({ lastBidAmount: null, lastBidTeam: null}); // Clear if "other" is selected with no valid custom bid yet

  // Save current bid selection to localStorage
  saveCurrentGameState();
}
// numbers that are technically "valid JSON" but we *don't* want to trigger a re-render for
const BLOCKED_BIDS = new Set([5, 10, 15]);

function handleCustomBidChange(e) {
  const valStr = e.target.value.trim();   // what the user just typed
  ephemeralCustomBid = valStr;            // persist while they're editing

  /* 1 ▸ don't redraw yet if…
  – the bid isn't valid JSON-wise  OR
  – it's one of the blocked small bids                       */
  if (validateBid(valStr) !== "" || BLOCKED_BIDS.has(+valStr)) return;

  /* 2 ▸ number is good and allowed → commit to state
  (this will re-render exactly once, keeping focus alive)    */
  updateState({
    customBidValue : valStr,
    bidAmount      : valStr,
    lastBidAmount  : valStr,
    lastBidTeam    : state.biddingTeam
  });
}

function handleBiddingPointsToggle(isBiddingTeamPoints) {
  ephemeralPoints = ""; // Clear ephemeral points input
  updateState({ enterBidderPoints: isBiddingTeamPoints });
}
function handleFormSubmit(e, skipZeroCheck = false) {
  e.preventDefault();
  const { biddingTeam, bidAmount, rounds, enterBidderPoints, usTeamName, demTeamName } = state;
  const pointsInputEl = document.getElementById("pointsInput");
  if (!pointsInputEl) { updateState({ error: "Points input not found." }); return; }
  const pointsVal = pointsInputEl.value;

  if (!biddingTeam || !bidAmount) { updateState({ error: "Please select bid amount." }); return; }
  const bidError = validateBid(bidAmount);
  const pointsError = validatePoints(pointsVal);
  if (bidError || pointsError) { updateState({ error: bidError || pointsError }); return; }

  const numericBid = Number(bidAmount);
  const numericPoints = Number(pointsVal);

  if (!skipZeroCheck && numericPoints === 0) {
  const enteredForNonBidder = !state.enterBidderPoints;   // true ⇢ '0' belonged to non-bid team

  openZeroPointsModal(chosen => {
    /* commit() will run once the DOM is ready */
    const commit = () => {
  const freshInput = document.getElementById("pointsInput");
  if (freshInput) freshInput.value = String(chosen);

  /* second arg ›› skipZeroCheck = true */
  handleFormSubmit(new Event("submit"), /* skipZeroCheck */ true);
};

    /* if the '0' was for the non-bidding team we must flip the toggle first,
 which triggers a re-render → wait one tick before commit()            */
 if (enteredForNonBidder && chosen !== 0 && state.enterBidderPoints === false) {
  handleBiddingPointsToggle(true);     // causes one re-render
  setTimeout(commit, 0);               // run after new DOM appears
    } else {
  commit();                            // no toggle needed
    }
  });

  return;                                 // pause main handler until modal choice
}

  if (rounds.length === 0 && state.startTime === null) updateState({ startTime: Date.now() });

  let usEarned = 0, demEarned = 0;
  const nonBiddingTeamTotal = 180; // Standard total points in a hand excluding Rook

  if (numericPoints === 360) { // Special 360 case (usually means all points + Rook)
      if (enterBidderPoints) { // Bidding team claims 360
          biddingTeam === "us" ? (usEarned = 360, demEarned = 0) : (demEarned = 360, usEarned = 0);
      } else { // Non-bidding team claims 360
          biddingTeam === "us" ? (usEarned = -numericBid, demEarned = 360) : (demEarned = -numericBid, usEarned = 360);
      }
  } else { // Standard point distribution
      if (enterBidderPoints) { // Points entered for bidding team
          biddingTeam === "us" ? (usEarned = numericPoints, demEarned = nonBiddingTeamTotal - numericPoints) : (demEarned = numericPoints, usEarned = nonBiddingTeamTotal - numericPoints);
      } else { // Points entered for non-bidding team
          biddingTeam === "us" ? (demEarned = numericPoints, usEarned = nonBiddingTeamTotal - numericPoints) : (usEarned = numericPoints, demEarned = nonBiddingTeamTotal - numericPoints);
      }
      // Apply penalty if bid not met
      if (state.pendingPenalty && state.pendingPenalty.type === "cheat") {
    if (state.pendingPenalty.team === "us")   usEarned  = -numericBid;
    else                                      demEarned = -numericBid;
}
      if (biddingTeam === "us" && usEarned < numericBid) usEarned = -numericBid;
      else if (biddingTeam === "dem" && demEarned < numericBid) demEarned = -numericBid;
  }

  const lastTotals = getLastRunningTotals();
  const newTotals = { us: lastTotals.us + usEarned, dem: lastTotals.dem + demEarned };
  const newRound = { biddingTeam, bidAmount: numericBid, usPoints: usEarned, demPoints: demEarned, runningTotals: newTotals, usTeamNameOnRound: usTeamName || "Us", demTeamNameOnRound: demTeamName || "Dem" };
  const updatedRounds = [...rounds, newRound];

  const mustWinByBid = getLocalStorage(MUST_WIN_BY_BID_KEY, false);
  let gameFinished = false, theWinner = null, victoryMethod = "Won on Bid";

  if (Math.abs(newTotals.us - newTotals.dem) >= 1000) {
      gameFinished = true; theWinner = newTotals.us > newTotals.dem ? "us" : "dem"; victoryMethod = "1000 Point Spread";
  } else if ((biddingTeam === "us" && usEarned < 0 && newTotals.dem >= 500) || (biddingTeam === "dem" && demEarned < 0 && newTotals.us >= 500)) {
      if (!mustWinByBid) { gameFinished = true; theWinner = biddingTeam === "us" ? "dem" : "us"; victoryMethod = "Set Other Team"; }
    } else if (
// bidder wins by making their bid and crossing 500
(biddingTeam === "us" && newTotals.us >= 500 && usEarned >= numericBid) ||
(biddingTeam === "dem" && newTotals.dem >= 500 && demEarned >= numericBid)
    ) {
gameFinished   = true;
theWinner      = biddingTeam;
victoryMethod  = "Won on Bid";
    } else if (
// non-bidding team wins by setting the bidder and crossing 500
(biddingTeam === "us" && usEarned < 0 && newTotals.dem >= 500) ||
(biddingTeam === "dem" && demEarned < 0 && newTotals.us >= 500)
    ) {
gameFinished   = true;
theWinner      = biddingTeam === "us" ? "dem" : "us";
victoryMethod  = "Set Other Team";
    }

  ephemeralCustomBid = ""; ephemeralPoints = "";
  let finalAccumulated = state.accumulatedTime;
  if (state.startTime !== null && !gameFinished) { /* Time continues */ }
  else if (state.startTime !== null && gameFinished) { 
    finalAccumulated = calculateSafeTimeAccumulation(state.accumulatedTime, state.startTime);
  }

  updateState({
      rounds: updatedRounds, undoneRounds: [], gameOver: gameFinished, winner: theWinner, victoryMethod,
      biddingTeam: "", bidAmount: "", showCustomBid: false, customBidValue: "", enterBidderPoints: false, error: "",
      accumulatedTime: finalAccumulated, startTime: gameFinished ? null : state.startTime, pendingPenalty: null 
  });
  if (gameFinished && theWinner) updateTeamsStatsOnGameEnd(theWinner);
  saveCurrentGameState();
}
function handleUndo() {
  if (!state.rounds.length) return;
  const wasGameOver = state.gameOver;
  const priorWinner = state.winner;
  const teamSnapshot = {
    usPlayers: state.usPlayers,
    demPlayers: state.demPlayers,
    usDisplay: state.usTeamName,
    demDisplay: state.demTeamName,
  };
  const lastRound = state.rounds[state.rounds.length - 1];
  const newRounds = state.rounds.slice(0, -1);
  const newUndoneRounds = [...state.undoneRounds, lastRound];
  let newLastBid = null, newLastBidTeam = null;
  if (newRounds.length > 0) {
      newLastBid = String(newRounds[newRounds.length-1].bidAmount);
      newLastBidTeam = newRounds[newRounds.length-1].biddingTeam;
  }
  const nextState = { rounds: newRounds, undoneRounds: newUndoneRounds, gameOver: false, winner: null, victoryMethod: null, lastBidAmount: newLastBid, lastBidTeam: newLastBidTeam };
  if (!newRounds.length) {
      nextState.startTime = null;
      nextState.accumulatedTime = 0;
      nextState.timerLastSavedAt = null;
  }
  if (wasGameOver && priorWinner) {
    const teams = getTeamsObject();
    const reverted = applyTeamResultDelta(teams, { ...teamSnapshot, winner: priorWinner }, -1);
    if (reverted) setTeamsObject(teams);
  }
  updateState(nextState);
  saveCurrentGameState();
}
function handleRedo() {
  if (!state.undoneRounds.length) return;
  const redoRound = state.undoneRounds[state.undoneRounds.length - 1];
  const newRounds = [...state.rounds, redoRound];
  const newUndoneRounds = state.undoneRounds.slice(0, -1);

  // Re-check game over condition based on the new last round
  const lastTotals = newRounds[newRounds.length - 1].runningTotals;
  let gameOver = false, winner = null, victoryMethod = null;
  const mustWinByBid = getLocalStorage(MUST_WIN_BY_BID_KEY, false);

  if (Math.abs(lastTotals.us - lastTotals.dem) >= 1000) {
      gameOver = true; winner = lastTotals.us > lastTotals.dem ? "us" : "dem"; victoryMethod = "1000 Point Spread";
  } else if ((redoRound.biddingTeam === "us" && redoRound.usPoints < 0 && lastTotals.dem >= 500) || 
             (redoRound.biddingTeam === "dem" && redoRound.demPoints < 0 && lastTotals.us >= 500)) {
      if (!mustWinByBid) { gameOver = true; winner = redoRound.biddingTeam === "us" ? "dem" : "us"; victoryMethod = "Set Other Team"; }
  } else if (lastTotals.us >= 500 || lastTotals.dem >= 500) {
      if (mustWinByBid) {
          if ((redoRound.biddingTeam === "us" && lastTotals.us >= 500 && redoRound.usPoints >= redoRound.bidAmount) ||
              (redoRound.biddingTeam === "dem" && lastTotals.dem >= 500 && redoRound.demPoints >= redoRound.bidAmount)) {
              gameOver = true; winner = redoRound.biddingTeam; victoryMethod = "Won on Bid";
          }
      } else {
          gameOver = true; winner = lastTotals.us >= lastTotals.dem ? "us" : (lastTotals.dem > lastTotals.us ? "dem" : null);
          if (winner === null && lastTotals.us === lastTotals.dem) victoryMethod = "Tie at 500+";
          else if(winner) victoryMethod = "Reached 500+";
      }
  }

  updateState({ rounds: newRounds, undoneRounds: newUndoneRounds, gameOver, winner, victoryMethod, lastBidAmount: String(redoRound.bidAmount), lastBidTeam: redoRound.biddingTeam });
  if (gameOver && winner) updateTeamsStatsOnGameEnd(winner);
  saveCurrentGameState();
}
function handleNewGame() {
  openConfirmationModal(
    "Start a new game? Unsaved progress will be lost.",
    () => {
closeTeamSelectionModal();
resetGame();
closeConfirmationModal();
    },
    closeConfirmationModal
  );
}
function hideGameOverOverlay() {
  const overlay = document.querySelector('[data-overlay="gameover"]');
  if (overlay) overlay.classList.add('hidden');
}

function handleGameOverSaveClick(e) {
  if (e) e.preventDefault();
  hideGameOverOverlay();
  pendingGameAction = "save";
  openTeamSelectionModal();
}

function handleManualSaveGame() { // Called after team names confirmed or if already set
  if (!state.usTeamName || !state.demTeamName) {
    pendingGameAction = "save"; openTeamSelectionModal(); return;
  }
  if (!state.rounds.length) return;

  let finalAccumulated = calculateSafeTimeAccumulation(state.accumulatedTime, state.startTime);

  const lastRoundTotals = getCurrentTotals();
  const usPlayers = ensurePlayersArray(state.usPlayers);
  const demPlayers = ensurePlayersArray(state.demPlayers);
  const usDisplay = deriveTeamDisplay(usPlayers, state.usTeamName || "Us") || "Us";
  const demDisplay = deriveTeamDisplay(demPlayers, state.demTeamName || "Dem") || "Dem";
  const usTeamKey = buildTeamKey(usPlayers) || null;
  const demTeamKey = buildTeamKey(demPlayers) || null;
  const gameObj = {
      usTeamName: usDisplay,
      demTeamName: demDisplay,
      usPlayers,
      demPlayers,
      usTeamKey,
      demTeamKey,
      rounds: state.rounds,
      finalScore: lastRoundTotals,
      startingTotals: sanitizeTotals(state.startingTotals),
      winner: state.winner, victoryMethod: state.victoryMethod,
      timestamp: new Date().toISOString(), durationMs: finalAccumulated,
      // Simplified playerStats, more complex stats are in general statistics
      playerStats: { 
          [usDisplay]: { totalPoints: lastRoundTotals.us, wins: state.winner === "us" ? 1 : 0 },
          [demDisplay]: { totalPoints: lastRoundTotals.dem, wins: state.winner === "dem" ? 1 : 0 }
      }
  };
  const savedGames = getLocalStorage("savedGames", []);
  savedGames.push(gameObj);
  setLocalStorage("savedGames", savedGames);
  showSaveIndicator("Game Saved!");
  resetGame(); // Resets state and clears active game from storage
  confettiTriggered = false;
  pendingGameAction = null;
}
function handleFreezerGame() {
  if (state.gameOver || !state.rounds.length) {
    alert("No active game to freeze."); return;
  }
  if (!state.usTeamName || !state.demTeamName) {
    pendingGameAction = "freeze"; openTeamSelectionModal(); return;
  }
  confirmFreeze(); // Ask for confirmation
}
function confirmFreeze() {
   openConfirmationModal(
      "Freeze this game? It will be moved to Freezer Games and current game will reset.",
      () => { freezeCurrentGame(); closeConfirmationModal(); closeMenuOverlay(); },
      closeConfirmationModal
  );
}
function freezeCurrentGame() {
  let finalAccumulated = calculateSafeTimeAccumulation(state.accumulatedTime, state.startTime);
  const finalScore = getCurrentTotals();
  const lastRound = state.rounds.length ? state.rounds[state.rounds.length-1] : {};
  const usPlayers = ensurePlayersArray(state.usPlayers);
  const demPlayers = ensurePlayersArray(state.demPlayers);
  const usDisplay = deriveTeamDisplay(usPlayers, state.usTeamName || "Us") || "Us";
  const demDisplay = deriveTeamDisplay(demPlayers, state.demTeamName || "Dem") || "Dem";
  const usTeamKey = buildTeamKey(usPlayers) || null;
  const demTeamKey = buildTeamKey(demPlayers) || null;

  const frozenGame = {
      name: `FROZEN-${new Date().toLocaleTimeString()}`, // More readable name
      usName: usDisplay,
      demName: demDisplay,
      usPlayers,
      demPlayers,
      usTeamKey,
      demTeamKey,
      finalScore, // Current scores when frozen
      lastBid: lastRound.bidAmount ? `${lastRound.bidAmount} (${lastRound.biddingTeam === "us" ? usDisplay : demDisplay})` : "N/A",
      winner: null, victoryMethod: null, // Game is not over
      rounds: state.rounds,
      startingTotals: sanitizeTotals(state.startingTotals),
      timestamp: new Date().toISOString(),
      accumulatedTime: finalAccumulated,
      // Store necessary state to resume
      biddingTeam: state.biddingTeam, bidAmount: state.bidAmount,
      customBidValue: state.customBidValue, showCustomBid: state.showCustomBid,
      enterBidderPoints: state.enterBidderPoints, lastBidAmount: state.lastBidAmount, lastBidTeam: state.lastBidTeam
  };
  const freezerGames = getLocalStorage("freezerGames");
  freezerGames.unshift(frozenGame); // Add to beginning
  setLocalStorage("freezerGames", freezerGames);
  showSaveIndicator("Game Frozen!");
  resetGame(); // Resets state and clears active game
  pendingGameAction = null;
}
function loadFreezerGame(index) {
  const freezerGames = getLocalStorage("freezerGames");
  const chosen = freezerGames[index];
  if (!chosen) return;
  openConfirmationModal(
    `Load frozen game "${chosen.name || 'Untitled'}"? Current game will be overwritten.`,
    () => {
      closeConfirmationModal();
      const chosenUsPlayers = ensurePlayersArray(chosen.usPlayers || parseLegacyTeamName(chosen.usName));
      const chosenDemPlayers = ensurePlayersArray(chosen.demPlayers || parseLegacyTeamName(chosen.demName));
      const chosenUsName = deriveTeamDisplay(chosenUsPlayers, chosen.usName || "Us") || "Us";
      const chosenDemName = deriveTeamDisplay(chosenDemPlayers, chosen.demName || "Dem") || "Dem";
      // Restore all relevant game state aspects
      updateState({
          rounds: chosen.rounds || [],
          startingTotals: sanitizeTotals(chosen.startingTotals),
          gameOver: false, // Frozen games are not over
          winner: null, victoryMethod: null,
          biddingTeam: chosen.biddingTeam || "",
          bidAmount: chosen.bidAmount || "",
          showCustomBid: chosen.showCustomBid || false,
          customBidValue: chosen.customBidValue || "",
          enterBidderPoints: chosen.enterBidderPoints || false,
          error: "", // Clear any previous error
          lastBidAmount: chosen.lastBidAmount || null,
          lastBidTeam: chosen.lastBidTeam || null,
          usPlayers: chosenUsPlayers,
          demPlayers: chosenDemPlayers,
          usTeamName: chosenUsName,
          demTeamName: chosenDemName,
          accumulatedTime: Math.min(chosen.accumulatedTime || 0, MAX_GAME_TIME_MS), // Cap accumulated time
          startTime: Date.now(), // Restart timer
          showWinProbability: JSON.parse(localStorage.getItem(PRO_MODE_KEY)) || false,
          undoneRounds: [] // Clear any undone rounds from previous state
      });
      freezerGames.splice(index, 1); // Remove from freezer
      setLocalStorage("freezerGames", freezerGames);
      closeSavedGamesModal();
      saveCurrentGameState(); // Save the now active game
      confettiTriggered = false;
    },
    closeConfirmationModal
  );
}
function viewSavedGame(originalIndex) { // originalIndex is from the full savedGames list
  const savedGames = getLocalStorage("savedGames"); // Get the full list
  // Find the actual game object by its original index if filtering/sorting was applied
  // This requires the renderSavedGames to pass the original index or unique ID.
  // For simplicity, assuming originalIndex is correct for the current display of `savedGames`.
  // A robust solution would involve passing a game ID if the list is dynamically filtered/sorted.
  // Let's assume `renderSavedGames` provides an index that's valid for `getLocalStorage("savedGames")[index]`
  const chosen = savedGames[originalIndex];

  if (!chosen) return;
  document.getElementById("viewSavedGameDetails").innerHTML = renderReadOnlyGameDetails(chosen);
  openViewSavedGameModal();
}
function deleteGame(storageKey, index, descriptor) {
  const items = getLocalStorage(storageKey);
  openConfirmationModal(`Delete this ${descriptor}?`, () => {
    items.splice(index, 1);
    setLocalStorage(storageKey, items);
    if (storageKey === "savedGames") recalcTeamsStats(); // Only if deleting a completed game
    closeConfirmationModal();
    // Re-render the list in the modal
    if (document.getElementById("savedGamesModal") && !document.getElementById("savedGamesModal").classList.contains("hidden")) {
      updateGamesCount();
      renderGamesWithFilter();
    }
  }, closeConfirmationModal);
}
function deleteSavedGame(index) { deleteGame("savedGames", index, "completed game"); }
function deleteFreezerGame(index) { deleteGame("freezerGames", index, "frozen game"); }

// --- Settings & Pro Mode ---
function saveSettings() {
  const mustWinToggle = document.getElementById("mustWinByBidToggle");
  if (mustWinToggle) localStorage.setItem(MUST_WIN_BY_BID_KEY, mustWinToggle.checked);

  const penaltySelect = document.getElementById("tableTalkPenaltySelect");
  if (penaltySelect) setLocalStorage(TABLE_TALK_PENALTY_TYPE_KEY, penaltySelect.value);

  const penaltyPointsInput = document.getElementById("penaltyPointsInput");
  if (penaltyPointsInput) {
    let points = parseInt(penaltyPointsInput.value) || 180;

    // Validate and round to nearest multiple of 5
    if (points < 5) points = 5;
    if (points > 500) points = 500;
    if (points % 5 !== 0) {
      points = Math.round(points / 5) * 5;
      penaltyPointsInput.value = points; // Update the input to show corrected value
    }

    setLocalStorage(TABLE_TALK_PENALTY_POINTS_KEY, points);
  }

  // Save win probability calculation method
  const winProbMethodSelect = document.getElementById("winProbMethodSelect");
  if (winProbMethodSelect) {
    setLocalStorage(WIN_PROB_CALC_METHOD_KEY, winProbMethodSelect.value);
    // Refresh the display if win probability is currently shown
    if (state.showWinProbability) {
      renderApp();
    }
  }

  showSaveIndicator("Settings Saved");
}
function updateProModeUI(isProMode) {
  document.getElementById('editPresetsContainerModal')?.classList.remove('hidden'); // Always show
  const proToggleModal = document.getElementById("proModeToggleModal");
  if (proToggleModal) proToggleModal.checked = isProMode;
  updateState({ showWinProbability: isProMode }); // Update live state
}
function toggleProMode(checkbox) {
  const isPro = checkbox.checked;
  localStorage.setItem(PRO_MODE_KEY, isPro);
  updateProModeUI(isPro);
  saveCurrentGameState(); // Save state with new pro mode setting
}

function handleTableTalkPenaltyChange() {
  const penaltySelect = document.getElementById("tableTalkPenaltySelect");
  const customPointsDiv = document.getElementById("customPenaltyPoints");

  if (penaltySelect && customPointsDiv) {
    if (penaltySelect.value === "setPoints") {
      customPointsDiv.classList.remove("hidden");
    } else {
      customPointsDiv.classList.add("hidden");
    }

    // Save the penalty type setting
    console.log("Saving Table Talk Penalty Type:", penaltySelect.value);
    setLocalStorage(TABLE_TALK_PENALTY_TYPE_KEY, penaltySelect.value);
  }
}

function handleWinProbMethodChange() {
  const winProbMethodSelect = document.getElementById("winProbMethodSelect");
  if (winProbMethodSelect) {
    // Save the win probability method setting
    console.log("Saving Win Prob Method:", winProbMethodSelect.value);
    setLocalStorage(WIN_PROB_CALC_METHOD_KEY, winProbMethodSelect.value);

    // Update any currently displayed probability calculations
    if (state.showWinProbability && state.rounds && state.rounds.length > 0) {
      renderApp(); // Re-render to update probability display
    }
  }
}

function handlePenaltyPointsChange() {
  const penaltyPointsInput = document.getElementById("penaltyPointsInput");
  if (penaltyPointsInput) {
    let points = parseInt(penaltyPointsInput.value);

    // Validate the points
    if (isNaN(points) || points < 5 || points > 500) {
      points = 180; // Default value
      penaltyPointsInput.value = points;
    }

    // Ensure it's a multiple of 5
    if (points % 5 !== 0) {
      points = Math.round(points / 5) * 5;
      penaltyPointsInput.value = points;
    }

    // Save the penalty points setting
    console.log("Saving Table Talk Penalty Points:", points);
    setLocalStorage(TABLE_TALK_PENALTY_POINTS_KEY, points.toString());
  }
}

// --- Validation ---
function validateBid(bidStr) {
  const bidNum = Number(bidStr);
  if (isNaN(bidNum)) return "Bid must be a number.";
  if (bidNum <= 0) return "Bid must be > 0.";
  if (bidNum % 5 !== 0) return "Bid must be multiple of 5.";
  if (bidNum > 360) return "Bid max 360.";
  if (bidNum > 180 && bidNum < 360) return "Bids between 180 and 360 are not allowed.";
  return "";
}
function validatePoints(pointsStr) {
  const pointsNum = Number(pointsStr);
  if (isNaN(pointsNum)) return "Points must be a number.";
  if (pointsNum % 5 !== 0) return "Points must be multiple of 5.";
  if (pointsNum !== 360 && (pointsNum < 0 || pointsNum > 180)) return "Points 0-180 or 360.";
  return "";
}

// --- Misc UI & Utility ---
function showVersionNum() {
  alert("Version 1.4.6 adds an option to select: 'must win game by taking bid', a 'redo' button, improved 0-point handling, new cheating penalty and sandbag detection features, enhanced win probability calculations and visual polish, and various bug fixes.");
}
// Time protection constants
const MAX_GAME_TIME_MS = 10 * 60 * 60 * 1000; // 10 hours maximum
const MAX_ROUND_TIME_MS = 2 * 60 * 60 * 1000; // 2 hours maximum per round

function calculateSafeTimeAccumulation(currentAccumulated, startTime) {
  if (!startTime) return currentAccumulated;

  const elapsed = Date.now() - startTime;
  const cappedElapsed = Math.min(elapsed, MAX_ROUND_TIME_MS);
  const totalTime = currentAccumulated + cappedElapsed;

  // Cap the total game time as well
  return Math.min(totalTime, MAX_GAME_TIME_MS);
}

function getCurrentGameTime() {
  if (!state.startTime) return state.accumulatedTime;
  const elapsed = Date.now() - state.startTime;
  return state.accumulatedTime + elapsed;
}

function renderTimeWarning() {
  if (!state.startTime || state.gameOver) return "";

  const currentTime = getCurrentGameTime();
  const roundTime = Date.now() - state.startTime;

           // Warning thresholds
   const ROUND_WARNING_TIME = 90 * 60 * 1000; // 90 minutes
   const GAME_WARNING_TIME = 8 * 60 * 60 * 1000; // 8 hours

  let warningMessage = "";
  let warningLevel = "";

  if (roundTime > ROUND_WARNING_TIME || currentTime > GAME_WARNING_TIME) {
    if (roundTime > MAX_ROUND_TIME_MS * 0.9) {
      warningMessage = "⚠️ Round time is very high! Consider starting a new game.";
      warningLevel = "danger";
    } else if (currentTime > MAX_GAME_TIME_MS * 0.9) {
      warningMessage = "⚠️ Game time is very high! Consider starting a new game.";
      warningLevel = "danger";
    } else if (roundTime > ROUND_WARNING_TIME) {
      warningMessage = "⏰ Round has been active for " + formatDuration(roundTime);
      warningLevel = "warning";
    } else if (currentTime > GAME_WARNING_TIME) {
      warningMessage = "⏰ Game has been active for " + formatDuration(currentTime);
      warningLevel = "warning";
    }
  }

  if (!warningMessage) return "";

  const bgColor = warningLevel === "danger" ? "bg-red-100 border-red-300 text-red-800 dark:bg-red-900 dark:border-red-700 dark:text-red-300" : "bg-yellow-100 border-yellow-300 text-yellow-800 dark:bg-yellow-900 dark:border-yellow-700 dark:text-yellow-300";

  return `
    <div class="mx-4 mb-4 p-3 rounded-lg border ${bgColor} text-sm text-center">
      ${warningMessage}
    </div>
  `;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "0:00";
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const s = secs % 60;
  const m = mins % 60;
  return `${hrs > 0 ? hrs + ':' : ''}${hrs > 0 && m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

// --- Probability Breakdown Functions ---
function openProbabilityModal() {
  const modalHtml = `
    <div id="probabilityModal" class="probability-modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 modal" role="dialog" aria-modal="true" aria-labelledby="probabilityModalTitle">
      <div class="probability-modal-content bg-white dark:bg-gray-800 w-full max-w-lg rounded-xl shadow-lg transform transition-all">
        <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 id="probabilityModalTitle" class="text-xl font-bold text-gray-800 dark:text-white">Win Probability Breakdown</h2>
          <button type="button" onclick="closeProbabilityModal()" class="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full p-1">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="p-4">
          ${generateProbabilityBreakdown()}
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  document.body.classList.add('modal-open');
}

function closeProbabilityModal() {
  const modal = document.getElementById('probabilityModal');
  if (modal) {
    modal.remove();
    document.body.classList.remove('modal-open');
  }
}

function generateProbabilityBreakdown() {
  if (!state.showWinProbability || !state.rounds || state.rounds.length === 0 || state.gameOver) {
    return "";
  }

  const historicalGames = getLocalStorage("savedGames");
  const winProb = calculateWinProbability(state, historicalGames);

  // Get current game state
  const lastRound = state.rounds[state.rounds.length - 1];
  const currentScores = lastRound.runningTotals || { us: 0, dem: 0 };
  const scoreDiff = currentScores.us - currentScores.dem;
  const roundsPlayed = state.rounds.length;
  const labelUs = state.usTeamName || "Us";
  const labelDem = state.demTeamName || "Dem";

  // Detect which calculation method is being used
  const method = getLocalStorage(WIN_PROB_CALC_METHOD_KEY, "simple");
  const isComplex = method === "complex";

  if (isComplex) {
    return generateComplexProbabilityBreakdown(scoreDiff, roundsPlayed, labelUs, labelDem, winProb, historicalGames, currentScores);
  } else {
    return generateSimpleProbabilityBreakdown(scoreDiff, roundsPlayed, labelUs, labelDem, winProb, historicalGames, currentScores);
  }
}

function generateSimpleProbabilityBreakdown(scoreDiff, roundsPlayed, labelUs, labelDem, winProb, historicalGames, currentScores) {
  // Score Analysis
  const scoreAnalysis = (() => {
    const margin = Math.abs(scoreDiff);
    const leader = scoreDiff > 0 ? labelUs : scoreDiff < 0 ? labelDem : "Neither";
    let impact = "";
    let explanation = "";

    if (margin === 0) {
      impact = "Minimal impact (+0%)";
      explanation = "Tied games have equal probability to start";
    } else if (margin <= 130) {
      impact = `Close game advantage (${Math.round(margin / 15)}%)`;
      explanation = "Close game - either team can still win";
    } else if (margin <= 180) {
      impact = `Large lead advantage (${Math.round(margin / 15)}%)`;
      explanation = "Significant lead, but comeback still possible";
    } else {
      impact = `Dominant position (${Math.round(margin / 15)}%)`;
      explanation = "Very large lead, comeback highly unlikely";
    }

    return { margin, leader, impact, explanation };
  })();

  // Momentum analysis with more detail
  const momentumAnalysis = (() => {
    if (state.rounds.length < 3) {
      return {
        text: "Not enough rounds",
        impact: "No momentum factor",
        explanation: "Need at least 3 rounds to analyze momentum"
      };
    }

    let recentUsPoints = 0;
    let recentDemPoints = 0;

    for (let i = state.rounds.length - 3; i < state.rounds.length; i++) {
      if (i >= 0) {
        recentUsPoints += state.rounds[i].usPoints || 0;
        recentDemPoints += state.rounds[i].demPoints || 0;
      }
    }

    const diff = recentUsPoints - recentDemPoints;
    let text, impact, explanation;

    if (Math.abs(diff) <= 10) {
      text = "Balanced recent performance";
      impact = "Neutral (0%)";
      explanation = "Both teams scoring similarly in recent rounds";
    } else if (diff > 10) {
      text = `${labelUs} gaining momentum`;
      impact = "Slight boost (+2%)";
      explanation = `${labelUs} outscored ${labelDem} ${recentUsPoints} to ${recentDemPoints} in last 3 rounds`;
    } else {
      text = `${labelDem} gaining momentum`;
      impact = "Slight disadvantage (-2%)";
      explanation = `${labelDem} outscored ${labelUs} ${recentDemPoints} to ${recentUsPoints} in last 3 rounds`;
    }

    return { text, impact, explanation };
  })();

  // Bid strength analysis with detailed explanation
  const bidAnalysis = (() => {
    const usHighBids = state.rounds.filter(r => r.biddingTeam === "us" && r.bidAmount >= 140).length;
    const demHighBids = state.rounds.filter(r => r.biddingTeam === "dem" && r.bidAmount >= 140).length;
    const usBids = state.rounds.filter(r => r.biddingTeam === "us").length;
    const demBids = state.rounds.filter(r => r.biddingTeam === "dem").length;

    let text, impact, explanation;

    if (usHighBids === demHighBids) {
      text = "Equal aggressive bidding";
      impact = "Neutral (0%)";
      explanation = `Both teams made ${usHighBids} high bids (140+)`;
    } else if (usHighBids > demHighBids) {
      text = `${labelUs} more aggressive`;
      impact = "Confidence boost (+2%)";
      explanation = `${labelUs} made ${usHighBids} high bids vs ${labelDem}'s ${demHighBids}. Aggressive bidding often indicates confidence and card strength.`;
    } else {
      text = `${labelDem} more aggressive`;
      impact = "Confidence disadvantage (-2%)";
      explanation = `${labelDem} made ${demHighBids} high bids vs ${labelUs}'s ${usHighBids}. Aggressive bidding often indicates confidence and card strength.`;
    }

    return { text, impact, explanation, usHighBids, demHighBids, usBids, demBids };
  })();

  // Historical context analysis
  const historicalAnalysis = (() => {
    const relevantGames = historicalGames.filter(game => {
      return game.rounds && game.rounds.length > 0 && game.finalScore;
    });

    if (relevantGames.length === 0) {
      return {
        text: "No historical data",
        explanation: "Predictions based on general scoring patterns only"
      };
    }

    // Find similar game states
    const similarSituations = relevantGames.filter(game => {
      if (game.rounds.length < roundsPlayed) return false;
      const historicalRound = game.rounds[roundsPlayed - 1];
      if (!historicalRound?.runningTotals) return false;

      const historicalDiff = historicalRound.runningTotals.us - historicalRound.runningTotals.dem;
      const diffSimilarity = Math.abs(historicalDiff - scoreDiff);
      return diffSimilarity <= 30; // Within 30 points
    });

    let explanation = `Drawing from ${relevantGames.length} completed games`;
    if (similarSituations.length > 0) {
      explanation += `. Found ${similarSituations.length} games with similar score positions at this stage.`;
    }

    return {
      text: `${relevantGames.length} games analyzed`,
      explanation,
      totalGames: relevantGames.length,
      similarSituations: similarSituations.length
    };
  })();

  // Calculate confidence level
  const confidenceLevel = (() => {
    const dataPoints = historicalAnalysis.totalGames;
    if (dataPoints === 0) return "Low";
    if (dataPoints < 5) return "Low";
    if (dataPoints < 15) return "Medium";
    if (dataPoints < 30) return "High";
    return "Very High";
  })();

  return `
    <div class="space-y-4">
      <!-- Header -->
      <div class="text-center border-b border-gray-200 dark:border-gray-700 pb-3">
        <div class="text-xl font-bold text-gray-800 dark:text-white mb-1">
          Win Probability Analysis
        </div>
        <div class="flex items-center justify-center gap-6 text-lg">
          <div class="flex items-center gap-2">
            <div class="w-3 h-3 rounded-full bg-primary"></div>
            <span class="font-semibold">${labelUs}: ${winProb.us.toFixed(1)}%</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-3 h-3 rounded-full bg-accent"></div>
            <span class="font-semibold">${labelDem}: ${winProb.dem.toFixed(1)}%</span>
          </div>
        </div>
        <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Method: Simple Analysis • Confidence: ${confidenceLevel}
        </div>
      </div>

      <!-- Current Game State -->
      <div class="space-y-3">
        <h3 class="font-semibold text-gray-800 dark:text-white">Current Game State</h3>

        <div class="bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Score Impact</div>
            <div class="text-sm text-blue-700 dark:text-blue-300 font-medium">${scoreAnalysis.impact}</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            <strong>Current:</strong> ${currentScores.us} - ${currentScores.dem} 
            ${scoreAnalysis.margin > 0 ? `(${scoreAnalysis.leader} ahead by ${scoreAnalysis.margin})` : '(Tied)'}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ${scoreAnalysis.explanation}
          </div>
        </div>

        <div class="bg-gradient-to-r from-green-50 to-green-100 dark:from-green-900/30 dark:to-green-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Momentum Factor</div>
            <div class="text-sm text-green-700 dark:text-green-300 font-medium">${momentumAnalysis.impact}</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            <strong>Recent Trend:</strong> ${momentumAnalysis.text}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ${momentumAnalysis.explanation}
          </div>
        </div>

        <div class="bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/30 dark:to-purple-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Bidding Confidence</div>
            <div class="text-sm text-purple-700 dark:text-purple-300 font-medium">${bidAnalysis.impact}</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            <strong>Pattern:</strong> ${bidAnalysis.text}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ${bidAnalysis.explanation}
          </div>
        </div>
      </div>

      <!-- Historical Context -->
      <div class="space-y-3">
        <h3 class="font-semibold text-gray-800 dark:text-white">Historical Context</h3>

        <div class="bg-gradient-to-r from-yellow-50 to-yellow-100 dark:from-yellow-900/30 dark:to-yellow-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Data Foundation</div>
            <div class="text-sm text-yellow-700 dark:text-yellow-300 font-medium">${historicalAnalysis.text}</div>
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            ${historicalAnalysis.explanation}
          </div>
        </div>
      </div>

      <!-- How It Works -->
      <div class="border-t border-gray-200 dark:border-gray-700 pt-3">
        <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <h4 class="font-medium text-gray-800 dark:text-white mb-2">How This Calculation Works (Simple Method)</h4>
          <div class="text-xs text-gray-600 dark:text-gray-400 space-y-1">
            <p>• <strong>Score Difference:</strong> Each 15-point lead adds roughly 1% win probability</p>
            <p>• <strong>Momentum:</strong> Recent performance trends can add ±2% adjustment</p>
            <p>• <strong>Bidding Patterns:</strong> Aggressive bidding (140+ bids) suggests confidence and strong cards</p>
            <p>• <strong>Historical Data:</strong> Past games with similar situations inform the baseline probability</p>
            <p>• <strong>Comeback Factor:</strong> Analysis of how often trailing teams recover in similar situations</p>
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">
            Remember: Rook is a game of skill and luck. These probabilities are educated estimates based on patterns, not guarantees!
          </div>
        </div>
      </div>
    </div>
  `;
}

function generateComplexProbabilityBreakdown(scoreDiff, roundsPlayed, labelUs, labelDem, winProb, historicalGames, currentScores) {
  // Get the probability table for complex analysis
  const cacheKey = historicalGames.length;
  if (!PROB_CACHE.has(cacheKey)) {
    PROB_CACHE.set(cacheKey, buildProbabilityIndex(historicalGames));
  }
  const table = PROB_CACHE.get(cacheKey);

  // Calculate the bucketed score and key for this situation
  const bucketedScore = bucketScore(scoreDiff);
  const key = `${roundsPlayed - 1}|${bucketedScore}`;
  const counts = table[key] || { us: 1, dem: 1 };
  const empirical = counts.us / (counts.us + counts.dem);
  const totalObs = counts.us + counts.dem - 2; // Remove Laplace prior
  const beta = Math.min(1, Math.log(totalObs + 1) / 4);
  const prior = 1 / (1 + Math.exp(-0.015 * scoreDiff));

  // Score bucketing analysis
  const bucketAnalysis = (() => {
    const bucketRange = getBucketRange(bucketedScore);
    const bucketSize = Math.abs(bucketedScore);
    let bucketDescription = "";

    if (bucketSize === 0) {
      bucketDescription = "Tied games (0 points)";
    } else if (bucketSize <= 130) {
      bucketDescription = `Close games (${bucketRange})`;
    } else if (bucketSize <= 180) {
      bucketDescription = `Large leads (${bucketRange})`;
    } else {
      bucketDescription = `Dominant positions (${bucketRange})`;
    }

    return {
      bucketedScore,
      bucketDescription,
      bucketRange
    };
  })();

  // Historical pattern analysis
  const historicalAnalysis = (() => {
    const relevantGames = historicalGames.filter(game => {
      return game.rounds && game.rounds.length > 0 && game.finalScore;
    });

    if (relevantGames.length === 0) {
      return {
        text: "No historical data",
        explanation: "Using mathematical model only",
        empiricalRate: 0,
        totalObservations: 0
      };
    }

    // Count games from this bucket
    let bucketGames = 0;
    let bucketWins = 0;

    Object.keys(table).forEach(tableKey => {
      if (tableKey.includes(`|${bucketedScore}`)) {
        const keyRound = parseInt(tableKey.split('|')[0]);
        if (Math.abs(keyRound - (roundsPlayed - 1)) <= 1) { // Similar round
          bucketGames += table[tableKey].us + table[tableKey].dem - 2;
          bucketWins += table[tableKey].us - 1;
        }
      }
    });

    return {
      text: `${relevantGames.length} games analyzed`,
      explanation: `Found ${bucketGames} similar situations in historical data`,
      empiricalRate: bucketGames > 0 ? (bucketWins / bucketGames) : 0,
      totalObservations: bucketGames,
      bucketWins,
      bucketGames
    };
  })();

  // Blending analysis
  const blendingAnalysis = (() => {
    const empiricalWeight = Math.round(beta * 100);
    const priorWeight = Math.round((1 - beta) * 100);
    const empiricalPercent = Math.round(empirical * 100);
    const priorPercent = Math.round(prior * 100);

    let confidence = "Low";
    if (totalObs >= 50) confidence = "Very High";
    else if (totalObs >= 20) confidence = "High";
    else if (totalObs >= 10) confidence = "Medium";
    else if (totalObs >= 5) confidence = "Low-Medium";

    return {
      empiricalWeight,
      priorWeight,
      empiricalPercent,
      priorPercent,
      confidence,
      totalObservations: totalObs
    };
  })();

  // Recency weighting analysis
  const recencyAnalysis = (() => {
    const recentGames = historicalGames.filter(game => {
      if (!game.timestamp) return false;
      const ageDays = (Date.now() - new Date(game.timestamp)) / 86_400_000;
      return ageDays <= 30; // Games within 30 days
    });

    const olderGames = historicalGames.length - recentGames.length;

    return {
      recentGames: recentGames.length,
      olderGames,
      explanation: `Recent games (≤30 days) weighted more heavily than older games`
    };
  })();

  return `
    <div class="space-y-4">
      <!-- Header -->
      <div class="text-center border-b border-gray-200 dark:border-gray-700 pb-3">
        <div class="text-xl font-bold text-gray-800 dark:text-white mb-1">
          Logistic Regression Win Probability Analysis
        </div>
        <div class="flex items-center justify-center gap-6 text-lg">
          <div class="flex items-center gap-2">
            <div class="w-3 h-3 rounded-full bg-primary"></div>
            <span class="font-semibold">${labelUs}: ${winProb.us.toFixed(1)}%</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-3 h-3 rounded-full bg-accent"></div>
            <span class="font-semibold">${labelDem}: ${winProb.dem.toFixed(1)}%</span>
          </div>
        </div>
        <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Method: Logistic Regression • Confidence: ${blendingAnalysis.confidence}
        </div>
      </div>

      <!-- Current Situation -->
      <div class="space-y-3">
        <h3 class="font-semibold text-gray-800 dark:text-white">Current Situation</h3>

        <div class="bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Score Classification</div>
            <div class="text-sm text-blue-700 dark:text-blue-300 font-medium">${bucketAnalysis.bucketDescription}</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            <strong>Current:</strong> ${currentScores.us} - ${currentScores.dem} 
            ${Math.abs(scoreDiff) > 0 ? `(${Math.abs(scoreDiff)} point ${scoreDiff > 0 ? labelUs : labelDem} lead)` : '(Tied)'}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Bucketed as: ${bucketAnalysis.bucketRange} • Round ${roundsPlayed}
          </div>
        </div>
      </div>

      <!-- Statistical Analysis -->
      <div class="space-y-3">
        <h3 class="font-semibold text-gray-800 dark:text-white">Statistical Analysis</h3>

        <div class="bg-gradient-to-r from-green-50 to-green-100 dark:from-green-900/30 dark:to-green-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Historical Pattern</div>
            <div class="text-sm text-green-700 dark:text-green-300 font-medium">${historicalAnalysis.empiricalRate > 0 ? `${Math.round(historicalAnalysis.empiricalRate * 100)}% historical win rate` : 'No similar data'}</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            <strong>Data:</strong> ${historicalAnalysis.totalObservations} similar situations found
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ${historicalAnalysis.explanation}
          </div>
        </div>

        <div class="bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/30 dark:to-purple-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Probability Blending</div>
            <div class="text-sm text-purple-700 dark:text-purple-300 font-medium">${blendingAnalysis.empiricalWeight}% Historical + ${blendingAnalysis.priorWeight}% Mathematical</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            <strong>Components:</strong> ${blendingAnalysis.empiricalPercent}% (data) + ${blendingAnalysis.priorPercent}% (model) = ${winProb.us.toFixed(1)}%
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Based on ${blendingAnalysis.totalObservations} observations. More data = higher historical weight.
          </div>
        </div>

        <div class="bg-gradient-to-r from-orange-50 to-orange-100 dark:from-orange-900/30 dark:to-orange-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Recency Weighting</div>
            <div class="text-sm text-orange-700 dark:text-orange-300 font-medium">${recencyAnalysis.recentGames} recent, ${recencyAnalysis.olderGames} older</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            <strong>Impact:</strong> Recent games matter more than older ones
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ${recencyAnalysis.explanation}
          </div>
        </div>
      </div>

      <!-- How It Works -->
      <div class="border-t border-gray-200 dark:border-gray-700 pt-3">
        <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <h4 class="font-medium text-gray-800 dark:text-white mb-2">How This Calculation Works (Logistic Regression Method)</h4>
          <div class="text-xs text-gray-600 dark:text-gray-400 space-y-1">
            <p>• <strong>Feature Extraction:</strong> Each round generates features: score difference, round number, and momentum (change in score diff)</p>
            <p>• <strong>Logistic Regression Model:</strong> Trained on historical game data to predict win probability using these three key features</p>
            <p>• <strong>Momentum Analysis:</strong> Captures recent performance trends by tracking how the score difference changes between rounds</p>
            <p>• <strong>Stage-Aware Modeling:</strong> Round number helps the model understand that early vs. late game situations matter differently</p>
            <p>• <strong>Continuous Learning:</strong> Model can be retrained as more game data becomes available for improved accuracy</p>
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">
            This machine learning approach uses logistic regression to learn patterns from actual game outcomes, providing data-driven win probability estimates that improve with more training data.
          </div>
        </div>
      </div>
    </div>
  `;
}

function getBucketRange(bucketedScore) {
  const abs = Math.abs(bucketedScore);
  if (abs === 0) return "0";
  if (abs === 20) return "0-19";
  if (abs === 40) return "20-39";
  if (abs === 60) return "40-59";
  if (abs === 80) return "60-79";
  if (abs === 100) return "80-99";
  if (abs === 120) return "100-119";
  if (abs === 140) return "120-139";
  if (abs === 160) return "140-159";
  if (abs === 180) return "160+";
  return `${abs}`;
}
function populateTeamSelects() {
  const teamsObj = getTeamsObject();
  const entrySortFn = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  const teamEntries = Object.entries(teamsObj).map(([key, value]) => ({
    key,
    players: ensurePlayersArray(value.players),
    displayName: deriveTeamDisplay(value.players, value.displayName || ''),
  })).filter(entry => entry.displayName).sort((a, b) => entrySortFn(a.displayName, b.displayName));

  const configureTeamSection = (selectId, inputIds, currentPlayers) => {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">-- Select saved pairing --</option>';
    teamEntries.forEach(entry => {
      const option = new Option(entry.displayName, entry.key);
      selectEl.add(option);
    });

    const currentKey = buildTeamKey(currentPlayers);
    if (currentKey && teamsObj[currentKey]) {
      selectEl.value = currentKey;
    } else {
      selectEl.value = "";
    }

    selectEl.onchange = () => {
      const chosen = teamsObj[selectEl.value];
      if (!chosen) return;
      const chosenPlayers = ensurePlayersArray(chosen.players);
      inputIds.forEach((id, idx) => {
        const inputEl = document.getElementById(id);
        if (inputEl) inputEl.value = chosenPlayers[idx] || "";
      });
    };

    inputIds.forEach((id, idx) => {
      const inputEl = document.getElementById(id);
      if (inputEl) inputEl.value = sanitizePlayerName(currentPlayers[idx] || "");
    });
  };

  configureTeamSection("selectUsTeam", ["usPlayerOne", "usPlayerTwo"], ensurePlayersArray(state.usPlayers));
  configureTeamSection("selectDemTeam", ["demPlayerOne", "demPlayerTwo"], ensurePlayersArray(state.demPlayers));

  const playerSuggestions = new Set();
  teamEntries.forEach(entry => entry.players.forEach(name => { if (name) playerSuggestions.add(name); }));
  ensurePlayersArray(state.usPlayers).forEach(name => { if (name) playerSuggestions.add(name); });
  ensurePlayersArray(state.demPlayers).forEach(name => { if (name) playerSuggestions.add(name); });
  const datalist = document.getElementById("playerNameSuggestions");
  if (datalist) {
    datalist.innerHTML = Array.from(playerSuggestions)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map(name => `<option value="${name.replace(/"/g, '&quot;')}"></option>`)
      .join("\n");
  }
}
function handleTeamSelectionSubmit(e) {
  e.preventDefault();

  const usPlayers = ensurePlayersArray([
    document.getElementById("usPlayerOne")?.value,
    document.getElementById("usPlayerTwo")?.value,
  ]);
  const demPlayers = ensurePlayersArray([
    document.getElementById("demPlayerOne")?.value,
    document.getElementById("demPlayerTwo")?.value,
  ]);

  if (!usPlayers[0] || !usPlayers[1]) {
    alert("Please enter both player names for Team 'Us'.");
    return;
  }
  if (!demPlayers[0] || !demPlayers[1]) {
    alert("Please enter both player names for Team 'Dem'.");
    return;
  }
  if (usPlayers[0].toLowerCase() === usPlayers[1].toLowerCase()) {
    alert("Team 'Us' needs two different players.");
    return;
  }
  if (demPlayers[0].toLowerCase() === demPlayers[1].toLowerCase()) {
    alert("Team 'Dem' needs two different players.");
    return;
  }

  const usKey = buildTeamKey(usPlayers);
  const demKey = buildTeamKey(demPlayers);
  if (!usKey || !demKey) {
    alert("Problem building team combinations. Please check the names and try again.");
    return;
  }
  if (usKey === demKey) {
    alert("Both teams cannot have the same two players.");
    return;
  }

  addTeamIfNotExists(usPlayers, formatTeamDisplay(usPlayers));
  addTeamIfNotExists(demPlayers, formatTeamDisplay(demPlayers));
  updateState({ usPlayers, demPlayers });
  saveCurrentGameState();
  closeTeamSelectionModal();
  if (pendingGameAction === "freeze") { confirmFreeze(); }
  else if (pendingGameAction === "save") { handleManualSaveGame(); }
  pendingGameAction = null;
}
function getDeviceDetails() {
  let appVersion = "N/A";
  try {
      const verEl = document.querySelector('.absolute.top-0.right-0 p');
      if (verEl && verEl.textContent.includes('version')) appVersion = verEl.textContent.trim();
  } catch (e) { console.warn("Could not get app version:", e); }

  let fbStatus = "N/A", fbUserId = "N/A", fbIsAnon = "N/A";
  if (window.firebaseAuth) {
      fbStatus = window.firebaseReady ? "Ready" : "Not Ready/Offline";
      if (window.firebaseAuth.currentUser) {
          fbUserId = window.firebaseAuth.currentUser.uid;
          fbIsAnon = String(window.firebaseAuth.currentUser.isAnonymous);
      }
  }
  return `User Agent: ${navigator.userAgent}\nScreen: ${window.innerWidth}x${window.innerHeight} (DPR: ${window.devicePixelRatio})\nApp Version: ${appVersion}\nDark Mode: ${document.documentElement.classList.contains('dark')}\nPro Mode: ${localStorage.getItem(PRO_MODE_KEY) === 'true'}\nFirebase: ${fbStatus} (User: ${fbUserId}, Anon: ${fbIsAnon})\nTimestamp: ${new Date().toISOString()}`;
}
function handleBugReportClick() {
    const recipient = "heinonenmh@gmail.com";
    const subject = "Rook Score App - Bug Report";
    const deviceDetails = getDeviceDetails();
    let appStateString = "Could not retrieve app state.";
    try {
      appStateString = [
        `Teams: ${state.usTeamName || "Us"} vs ${state.demTeamName || "Dem"}`,
        `Scores: Us ${state.rounds?.[state.rounds.length-1]?.runningTotals?.us ?? 0} - Dem ${state.rounds?.[state.rounds.length-1]?.runningTotals?.dem ?? 0}`,
        `Rounds played: ${state.rounds?.length ?? 0}`,
        `Game Over: ${state.gameOver ? "Yes" : "No"}`,
        `Winner: ${state.winner || "N/A"}`,
        `Victory Method: ${state.victoryMethod || "N/A"}`
      ].join('\n');
    } catch (e) {
      appStateString = `Error summarizing state: ${e.message}`;
    }
    const body = `Please describe the bug:\n[ ** Enter Description Here ** ]\n\n--- Device & App Info ---\n${deviceDetails}\n\n--- App State ---\n${appStateString}\n\n(Review before sending)`;
    const mailtoLink = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (mailtoLink.length > 2000) {
        alert("Bug report details are very long. Please copy the following details manually into your email client if the body is incomplete.");
        console.log("--- COPY BUG REPORT DETAILS BELOW ---");
        console.log(body); // Log to console as fallback
    }
    window.location.href = mailtoLink;
}

// --- Rendering Functions ---
// (renderApp, renderTeamCard, renderRoundCard, renderErrorAlert, renderScoreInputCard, renderPointsInput, renderHistoryCard, renderGameOverOverlay, renderReadOnlyGameDetails, renderSavedGames, renderFreezerGames, renderStatisticsContent, renderTeamStatsTable)
// These are substantial and involve generating HTML. They are defined below.
function renderApp() {
  const { error, rounds, bidAmount, showCustomBid, biddingTeam, customBidValue, gameOver, lastBidAmount, lastBidTeam } = state;
  const totals = getCurrentTotals();
  const roundNumber = rounds.length + 1;

  const shouldShowWinProbability = state.showWinProbability && !gameOver && rounds.length > 0;
  const historicalGames = shouldShowWinProbability ? getLocalStorage("savedGames") : null;
  const winProb = shouldShowWinProbability ? calculateWinProbability(state, historicalGames) : null;

  let lastBidDisplayHtml = "";
  // Show "Current Bid" if a bid is being selected
  if (biddingTeam && (bidAmount || (showCustomBid && customBidValue))) {
      const currentBidDisplayAmount = bidAmount || customBidValue;
      const currentBiddingTeamName = biddingTeam === "us" ? (state.usTeamName || "Us") : (state.demTeamName || "Dem");
      const arrow = biddingTeam === "us" ? "←" : "→";
      const teamColor = biddingTeam === "us" ? 'var(--primary-color)' : 'var(--accent-color)';
      if (validateBid(currentBidDisplayAmount) === "") { // Only display if valid
          lastBidDisplayHtml = `<div class=\"mt-1 text-xs text-white\">Current Bid: <span class=\"font-semibold\" style=\"color: ${teamColor};\">${currentBiddingTeamName}</span><br><span class=\"inline-block mt-0.5 font-bold\">${currentBidDisplayAmount} <span>${arrow}</span></span></div>`;
      }
  }
  // If not, show "Last Bid" from the last completed round
  else if (state.rounds.length > 0) {
      const lastRound = state.rounds[state.rounds.length - 1];
      const lastBidAmount = lastRound.bidAmount;
      const lastBidTeam = lastRound.biddingTeam;
      const teamName = lastBidTeam === "us" ? (state.usTeamName || "Us") : (state.demTeamName || "Dem");
      const arrow = lastBidTeam === "us" ? "←" : "→";
      const teamColor = lastBidTeam === "us" ? 'var(--primary-color)' : 'var(--accent-color)';
      lastBidDisplayHtml = `<div class=\"mt-1 text-xs text-white\">Last Bid: <span class=\"font-semibold\" style=\"color: ${teamColor};\">${teamName}</span><br><span class=\"inline-block mt-0.5 font-bold\">${lastBidAmount} <span>${arrow}</span></span></div>`;
  }


  document.getElementById("app").innerHTML = `
    <div class="text-center space-y-2">
      <h1 class="font-extrabold text-5xl sm:text-6xl text-gray-800 dark:text-white">Rook!</h1>
      <p class="text-md sm:text-lg text-gray-600 dark:text-white">Tap a team to start a bid!</p>
    </div>
    ${renderTimeWarning()}
    <div class="flex flex-row gap-3 flex-wrap justify-center items-stretch">
      ${renderTeamCard("us", totals.us, winProb)}
      ${renderRoundCard(roundNumber, lastBidDisplayHtml)}
      ${renderTeamCard("dem", totals.dem, winProb)}
    </div>
    ${error ? `<div>${renderErrorAlert(error)}</div>` : ""}
    ${renderScoreInputCard()}
    ${renderHistoryCard()}
    ${renderGameOverOverlay()}
  `;
  if (gameOver && !confettiTriggered) {
    confettiTriggered = true;
    if (typeof confetti === 'function') confetti({ particleCount: 200, spread: 70, origin: { y: 0.6 } });
  }
}
function renderTeamCard(teamKey, score, winProb) {
  const isSelected = state.biddingTeam === teamKey;
  const teamLabel = teamKey === "us" ? (state.usTeamName || "Us") : (state.demTeamName || "Dem");
  const colorClass = teamKey === "us" ? "bg-primary" : "bg-accent";
  const selectedEffect = isSelected ? "sunken-selected" : "";
  let winProbDisplay = "";
  if (winProb) {
    const prob = teamKey === "us" ? winProb.us : winProb.dem;
    const teamColorVar = teamKey === "us" ? "var(--primary-color)" : "var(--accent-color)";
    const brightness = isSelected ? "brightness(0.7)" : "brightness(0.85)"; // Darken more when selected
    // Inner div for probability text to ensure z-index works with sunken-selected's ::after
    winProbDisplay = `
      <div class="mt-1 text-xs rounded-full px-2 py-1 relative" style="background-color: ${teamColorVar}; filter: ${brightness};">
        <span class="relative font-medium" style="color: #FFF; z-index: 1;">Win: ${prob.toFixed(1)}%</span>
      </div>`;
  }
  return `
    <button type="button"
    class="${colorClass} ${selectedEffect} threed text-white cursor-pointer transition-all rounded-xl shadow-md flex flex-col items-center justify-center flex-1 min-w-[calc(33%-1rem)] sm:min-w-0 w-auto h-32 p-2"
    onclick="handleTeamClick('${teamKey}')"
    aria-pressed="${isSelected}" aria-label="Select ${teamLabel}">
    <div class="text-center">
<h2 class="text-base sm:text-xl font-semibold truncate max-w-[100px] sm:max-w-[120px]">${teamLabel}</h2>
<p class="text-2xl font-bold">${score}</p>
${winProbDisplay}
    </div>
  </button>`;
}
function renderRoundCard(roundNumber, lastBidDisplayHtml) {
  return `
    <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow threed flex flex-col items-center justify-center p-3 flex-1 min-w-[calc(33%-1rem)] sm:min-w-0 w-auto h-32">
      <div class="text-center space-y-1">
        <h2 class="text-xl font-bold text-gray-700 dark:text-white">Round</h2>
        <p class="text-2xl font-extrabold text-gray-900 dark:text-white">${roundNumber}</p>
        ${lastBidDisplayHtml}
      </div>
    </div>`;
}
function renderErrorAlert(errorMessage) {
  return `<div role="alert" class="flex items-center border border-red-400 rounded-xl p-4 bg-red-50 text-red-700 space-x-3 dark:bg-red-900/50 dark:border-red-600 dark:text-red-300">${Icons.AlertCircle}<div class="flex-1">${errorMessage}</div></div>`;
}
function renderScoreInputCard() {
  const { biddingTeam, bidAmount, showCustomBid, customBidValue, rounds, gameOver, undoneRounds, pendingPenalty } = state;
  if (gameOver || !biddingTeam) { scoreCardHasAnimated = false; return ""; }
  const fadeClass = scoreCardHasAnimated ? "" : "animate-fadeIn";
  scoreCardHasAnimated = true;
  const hasBid = bidAmount || (showCustomBid && validateBid(customBidValue) === "");
  const biddingTeamDisplayName = biddingTeam === "us" ? (state.usTeamName || "Us") : (state.demTeamName || "Dem");
  const focusRingColor = biddingTeam === "us" ? "focus:ring-blue-500 dark:focus:ring-blue-400" : "focus:ring-red-500 dark:focus:ring-red-400";
  const penaltyActive = pendingPenalty && pendingPenalty.team === biddingTeam && pendingPenalty.type === "cheat";
  const penaltyBtnClass = penaltyActive
    ? "flex items-center border border-orange-400 rounded px-2 py-1 text-sm text-orange-700 bg-orange-100 hover:bg-orange-200 transition focus:outline-none focus:ring-2 focus:ring-orange-500 dark:bg-orange-900/60 dark:text-orange-300 threed disabled:opacity-50 disabled:cursor-not-allowed"
    : "flex items-center border border-gray-400 rounded px-2 py-1 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 transition focus:outline-none focus:ring-2 focus:ring-gray-500 dark:bg-gray-800/50 dark:text-gray-300 threed disabled:opacity-50 disabled:cursor-not-allowed";
  const penaltyBtnOnClick = penaltyActive ? 'undoPenaltyFlag()' : 'handleCheatFlag()';
  return `
    <div class="${fadeClass} bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow">
      <div class="border-b border-gray-200 p-3 flex justify-between items-center dark:border-gray-700">
        <h2 class="text-lg font-bold text-gray-800 dark:text-white">Enter Bid for ${biddingTeamDisplayName}</h2>
        <div class="flex space-x-2">
          <button type="button" class="flex items-center border border-gray-300 rounded px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 transition disabled:opacity-50 focus:outline-none focus:ring-2 ${focusRingColor} dark:border-gray-600 dark:text-white dark:hover:bg-gray-700 threed" onclick="handleUndo(event)" ${!rounds.length ? "disabled" : ""} title="Undo">${Icons.Undo}Undo</button>
          <button type="button" class="flex items-center border border-gray-300 rounded px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 transition disabled:opacity-50 focus:outline-none focus:ring-2 ${focusRingColor} dark:border-gray-600 dark:text-white dark:hover:bg-gray-700 threed" onclick="handleRedo(event)" ${!undoneRounds.length ? "disabled" : ""} title="Redo">${Icons.Redo}Redo</button>
          <button type="button"
    class="${penaltyBtnClass}"
    onclick="${penaltyBtnOnClick}"
    ${!hasBid ? "disabled" : ""}
    title="Flag Table Talk - Choose Team">
<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10v4a1 1 0 0 0 1 1h2l5 3V6L6 9H4a1 1 0 0 0-1 1zm13-1.5v5a2.5 2.5 0 0 0 0-5z" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16 12a4 4 0 0 0 4-4" stroke="currentColor" stroke-width="2" fill="none"/></svg>
  </button>
        </div>
      </div>
      <div class="p-4 score-input-container show">
        <form onsubmit="handleFormSubmit(event)" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1.5 text-gray-700 dark:text-white">Bid Amount</label>
            <div class="flex flex-wrap gap-2">
              ${presetBids.map(b => {
                const isActive = b === "other" ? showCustomBid : (state.bidAmount === String(b) && !showCustomBid);
                const btnBase = `px-3 py-1.5 text-sm font-medium threed rounded-lg transition focus:outline-none focus:ring-2 ${focusRingColor}`;
                const btnActive = `${biddingTeam === "us" ? "bg-primary" : "bg-accent"} text-white shadow hover:brightness-95`;
                const btnInactive = `bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-500 dark:text-white dark:hover:bg-gray-600`;
                return `<button type="button" class="${btnBase} ${isActive ? btnActive : btnInactive}" onclick="handleBidSelect('${b}')" aria-pressed="${isActive}">${b === "other" ? "Other" : b}</button>`;
              }).join("")}
            </div>
            ${showCustomBid ? `<div class="mt-2"><input type="number" inputmode="numeric" pattern="[0-9]*" step="5" value="${customBidValue}" oninput="handleCustomBidChange(event)" placeholder="Enter custom bid" class="w-full sm:w-1/2 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ${focusRingColor} transition dark:bg-gray-700 dark:border-gray-500 dark:text-white" /></div>` : ""}
          </div>
          ${(bidAmount || (showCustomBid && customBidValue && validateBid(customBidValue)==="")) ? renderPointsInput() : ""}
        </form>
      </div>
    </div>`;
}
function renderPointsInput() {
  const { biddingTeam, enterBidderPoints, usTeamName, demTeamName } = state;
  const biddingTeamName = biddingTeam === "us" ? (usTeamName || "Us") : (demTeamName || "Dem");
  const nonBiddingTeamName = biddingTeam === "us" ? (demTeamName || "Dem") : (usTeamName || "Us");
  const labelText = enterBidderPoints ? `${biddingTeamName} Points (Bidding)` : `${nonBiddingTeamName} Points (Non-Bidding)`;

  // Determine active button based on whose points are being entered
  const biddingTeamButtonActive = enterBidderPoints;
  const nonBiddingTeamButtonActive = !enterBidderPoints;

  // Team-specific colors for active buttons
  const biddingTeamColorClass = biddingTeam === "us" ? "bg-primary" : "bg-accent";
  const nonBiddingTeamColorClass = biddingTeam === "us" ? "bg-accent" : "bg-primary";

  const focusRingColor = biddingTeam === "us" ? "focus:ring-blue-500 dark:focus:ring-blue-400" : "focus:ring-red-500 dark:focus:ring-red-400";

  return `
    <div class="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
      <div>
        <label class="block text-sm font-medium mb-1.5 text-gray-700 dark:text-white">Enter Points For</label>
        <div class="flex gap-3">
          <button type="button" class="flex-1 rounded-full px-3 py-1.5 text-sm font-medium threed transition focus:outline-none focus:ring-2 focus:ring-opacity-50 ${biddingTeamButtonActive ? `${biddingTeamColorClass} text-white shadow hover:brightness-95` : `bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-500 dark:text-white dark:hover:bg-gray-600`} ${focusRingColor}" onclick="handleBiddingPointsToggle(true)" aria-pressed="${biddingTeamButtonActive}">${biddingTeamName}</button>
          <button type="button" class="flex-1 rounded-full px-3 py-1.5 text-sm font-medium threed transition focus:outline-none focus:ring-2 focus:ring-opacity-50 ${nonBiddingTeamButtonActive ? `${nonBiddingTeamColorClass} text-white shadow hover:brightness-95` : `bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-500 dark:text-white dark:hover:bg-gray-600`} ${focusRingColor}" onclick="handleBiddingPointsToggle(false)" aria-pressed="${nonBiddingTeamButtonActive}">${nonBiddingTeamName}</button>
        </div>
      </div>
      <div>
        <label for="pointsInput" class="block text-sm font-medium mb-1.5 text-gray-700 dark:text-white">${labelText}</label>
        <div class="flex flex-col sm:flex-row sm:items-center sm:gap-5">
          <input id="pointsInput" type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="360" step="5" value="${ephemeralPoints}" oninput="ephemeralPoints = this.value" placeholder="Enter points" class="w-full sm:flex-grow border border-gray-300 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ${focusRingColor} transition dark:bg-gray-700 dark:border-gray-500 dark:text-white" />
          <button type="submit" class="mt-2 sm:mt-0 bg-blue-600 text-white px-4 py-1.5 text-sm rounded-xl shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-blue-400 threed">Submit</button>
        </div>
      </div>
    </div>`;
}
function renderHistoryCard() {
  const { rounds, usTeamName, demTeamName } = state;
  const labelUs = usTeamName || "Us";
  const labelDem = demTeamName || "Dem";
  if (!rounds.length) return ""; // Don't render if no history

  // Check if we should show the probability dropdown button
  const showProbabilityButton = state.showWinProbability && !state.gameOver && rounds.length > 0;

  return `
    <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow">
      <div class="border-b border-gray-200 p-4 dark:border-gray-700">
        <h2 class="text-lg font-bold text-gray-800 dark:text-white">History</h2>
        <div class="grid grid-cols-3 gap-2 pt-3 font-medium text-gray-600 dark:text-white text-sm sm:text-base">
          <div class="text-left truncate">${labelUs}</div>
          <div class="text-center">Bid</div>
          <div class="text-right truncate">${labelDem}</div>
        </div>
      </div>
      <div class="p-4 max-h-60 overflow-y-auto no-scrollbar">
        <div class="space-y-2">
          ${rounds.map((round, idx) => {
            const biddingTeamLabel = round.biddingTeam === "us" ? (round.usTeamNameOnRound || labelUs) : (round.demTeamNameOnRound || labelDem);
            const arrow = round.biddingTeam === "us" ? `<span class="text-gray-800 dark:text-white">←</span><span class="ml-1 text-black dark:text-white">${round.bidAmount}</span>` : `<span class="mr-1 text-black dark:text-white">${round.bidAmount}</span><span class="text-gray-800 dark:text-white">→</span>`;
            const bidDetails = `${biddingTeamLabel} bid ${round.bidAmount}`;
            return `
              <div key="${idx}" class="grid grid-cols-3 gap-2 p-2 bg-gray-50 rounded-xl dark:bg-gray-700 text-sm">
                <div class="text-left text-gray-800 dark:text-white font-semibold">${round.runningTotals.us}</div>
                <div class="text-center text-gray-600 dark:text-gray-400">${arrow}</div>
                <div class="text-right text-gray-800 dark:text-white font-semibold">${round.runningTotals.dem}</div>
              </div>`;
          }).join("")}
        </div>
      </div>
      ${showProbabilityButton ? `
        <div class="border-t border-gray-200 dark:border-gray-700">
          <button onclick="openProbabilityModal()" 
                  class="w-full p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-b-xl">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-gray-700 dark:text-gray-300">How was this probability reached?</span>
              <svg class="w-4 h-4 text-gray-400 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            </div>
          </button>
        </div>
      ` : ''}
    </div>`;
}
function renderGameOverOverlay() {
  if (!state.gameOver) return "";
  const winnerLabel = state.winner === "us" ? (state.usTeamName || "Us") : (state.winner === "dem" ? (state.demTeamName || "Dem") : "It's a Tie");
  return `
<div data-overlay="gameover"
     class="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-md flex items-center justify-center p-4"
     style="z-index:49;"
     role="alertdialog" aria-labelledby="gameOverTitle" aria-modal="true">
      <div class="bg-white dark:bg-gray-800 w-full max-w-md rounded-xl shadow-lg text-center">
        <div class="p-6">
          <h2 id="gameOverTitle" class="text-3xl font-bold mb-2 animate-fadeIn text-gray-800 dark:text-white">Game Over!</h2>
          <p class="text-xl mb-1 animate-fadeIn text-gray-700 dark:text-white">${winnerLabel} Wins!</p>
          <p class="text-sm mb-6 animate-fadeIn text-gray-500 dark:text-gray-400">(${state.victoryMethod || 'Game Ended'})</p>
          <div class="flex space-x-4 justify-center">
            <button onclick="handleGameOverSaveClick(event)" class="bg-green-600 text-white px-6 py-3 rounded-xl shadow hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 transition dark:bg-green-500 dark:hover:bg-green-600 dark:focus:ring-green-400 threed" type="button">Save Game</button>
            <button onclick="handleNewGame()" class="bg-blue-600 text-white px-6 py-3 rounded-xl shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-blue-400 threed" type="button">New Game</button>
          </div>
        </div>
      </div>
    </div>`;
}
// (renderReadOnlyGameDetails, renderSavedGames, renderFreezerGames, renderStatisticsContent, renderTeamStatsTable - these remain substantial and are called by modal openers)
function renderReadOnlyGameDetails(game) {
  const { rounds, timestamp, usTeamName, demTeamName, durationMs, winner, finalScore, victoryMethod } = game;
  const usDisp = usTeamName || "Us", demDisp = demTeamName || "Dem";
  const usScore = finalScore?.us || 0, demScore = finalScore?.dem || 0;
  const usWinner = winner === "us", demWinner = winner === "dem";
  const dateStr = new Date(timestamp).toLocaleString([], { year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });

  // Determine sandbag for winner
  let sandbagResult = "N/A";
  if (winner === "us" || winner === "dem") {
    const winnerPlayers = winner === "us"
      ? canonicalizePlayers(game.usPlayers || parseLegacyTeamName(game.usTeamName || game.usName))
      : canonicalizePlayers(game.demPlayers || parseLegacyTeamName(game.demTeamName || game.demName));
    sandbagResult = isGameSandbagForTeamKey(game, winnerPlayers) ? "Yes" : "No";
  }

  const roundHtml = (rounds || []).map((r, idx) => {
      const bidTeam = r.biddingTeam === "us" ? (r.usTeamNameOnRound || usDisp) : (r.demTeamNameOnRound || demDisp);
      const arrow = r.biddingTeam === "us" ? "←" : "→";
      const bidDisplay = `${r.bidAmount} ${arrow}`;
      return `
      <div class="grid grid-cols-5 gap-1 p-2 bg-gray-50 rounded-xl dark:bg-gray-700 text-sm sm:text-base mb-2">
        <div class="text-left font-medium col-span-1 ${r.biddingTeam === "us" && r.usPoints < r.bidAmount ? 'text-red-500' : 'text-gray-800 dark:text-white'}">${r.runningTotals.us}</div>
        <div class="text-center text-gray-600 dark:text-gray-300 text-xs sm:text-sm col-span-3">
          <span class="bg-gray-200 dark:bg-gray-600 px-2 py-0.5 rounded-full">${bidTeam} bid ${bidDisplay}</span>
        </div>
        <div class="text-right font-medium col-span-1 ${r.biddingTeam === "dem" && r.demPoints < r.bidAmount ? 'text-red-500' : 'text-gray-800 dark:text-white'}">${r.runningTotals.dem}</div>
      </div>`;
  }).join("");

  return `
    <div class="space-y-4"> <!-- Reduced vertical spacing -->
      <div class="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 shadow-sm"> <!-- Reduced padding -->
        <div class="flex flex-col sm:flex-row justify-between items-center mb-2"> <!-- Reduced margin -->
          <h4 class="text-xl font-bold text-gray-800 dark:text-white text-center sm:text-left">${usDisp} vs ${demDisp}</h4>
          <span class="bg-blue-100 text-blue-800 text-xs font-medium px-3 py-1 rounded-full dark:bg-blue-900 dark:text-blue-300">${dateStr}</span>
        </div>
        <div class="flex justify-around items-center text-center">
          <div class="${usWinner ? 'text-green-500 dark:text-green-400' : 'text-gray-800 dark:text-white'}">
            <div class="text-sm">${usDisp}</div><div class="text-2xl font-bold">${usScore}</div>
            ${usWinner ? '<div class="text-xs font-medium">WINNER</div>' : ''}
          </div>
          <div class="text-gray-400 dark:text-gray-500 text-lg">vs</div>
          <div class="${demWinner ? 'text-green-500 dark:text-green-400' : 'text-gray-800 dark:text-white'}">
            <div class="text-sm">${demDisp}</div><div class="text-2xl font-bold">${demScore}</div>
            ${demWinner ? '<div class="text-xs font-medium">WINNER</div>' : ''}
          </div>
        </div>
        ${victoryMethod ? `<p class="text-center text-xs text-gray-500 dark:text-gray-400 mt-1">(${victoryMethod})</p>` : ''}
      </div>
      <div class="flex flex-row gap-2 sm:gap-4 mb-1"> <!-- Side by side, tighter gap -->
        <div class="flex-1 bg-white dark:bg-gray-800 rounded-xl p-2 shadow-sm flex flex-col items-start"> <!-- Tighter padding -->
          <span class="text-xs font-semibold text-gray-800 dark:text-white">Sandbag?</span>
          <span class="text-sm text-gray-700 dark:text-gray-300">${sandbagResult}</span>
        </div>
        <div class="flex-1 bg-white dark:bg-gray-800 rounded-xl p-2 shadow-sm flex flex-col items-end"> <!-- Tighter padding -->
          <span class="text-xs font-semibold text-gray-800 dark:text-white">Duration</span>
          <span class="text-sm text-gray-700 dark:text-gray-300">${durationMs ? formatDuration(durationMs) : "N/A"}</span>
        </div>
      </div>
      <div class="bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm"> <!-- Reduced padding -->
        <p class="font-semibold text-gray-800 dark:text-white mb-1">Round History</p>
        <div class="space-y-2 max-h-60 overflow-y-auto rounded-xl pr-1 no-scrollbar">${roundHtml || '<p class="text-gray-500">No rounds.</p>'}</div>
      </div>
      <div class="flex justify-center"><button type="button" onclick="closeViewSavedGameModal()" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white transition-colors threed">Close</button></div>
    </div>`;
}
// --- Saved Games Modal (New Functions) ---
function switchGamesTab(tabType) {
  const completedTab = document.getElementById('completedGamesTab');
  const freezerTab = document.getElementById('freezerGamesTab');
  const completedSection = document.getElementById('completedGamesSection');
  const freezerSection = document.getElementById('freezerGamesSection');

  const activeClasses = ['border-blue-600', 'text-blue-600', 'dark:text-blue-400', 'dark:border-blue-400'];
  const inactiveClasses = ['border-transparent', 'text-gray-500', 'hover:text-gray-700', 'dark:text-gray-400', 'dark:hover:text-gray-300'];

  if (tabType === 'completed') {
      completedTab.classList.add(...activeClasses); completedTab.classList.remove(...inactiveClasses);
      freezerTab.classList.add(...inactiveClasses); freezerTab.classList.remove(...activeClasses);
      completedSection.classList.remove('hidden'); freezerSection.classList.add('hidden');
  } else {
      freezerTab.classList.add(...activeClasses); freezerTab.classList.remove(...inactiveClasses);
      completedTab.classList.add(...inactiveClasses); completedTab.classList.remove(...activeClasses);
      freezerSection.classList.remove('hidden'); completedSection.classList.add('hidden');
  }
  document.getElementById('gameSearchInput').value = '';
  document.getElementById('gameSortSelect').value = 'newest';
  renderGamesWithFilter();
}
function updateGamesCount() {
  const savedGames = getLocalStorage("savedGames", []);
  const freezerGames = getLocalStorage("freezerGames", []);
  document.getElementById('completedGamesCount').textContent = savedGames.length;
  document.getElementById('freezerGamesCount').textContent = freezerGames.length;
  document.getElementById('noCompletedGamesMessage').classList.toggle('hidden', savedGames.length > 0);
  document.getElementById('noFreezerGamesMessage').classList.toggle('hidden', freezerGames.length > 0);
}
function filterGames() { renderGamesWithFilter(); }
function sortGames() { renderGamesWithFilter(); }
function renderGamesWithFilter() {
  const rawSearchValue = document.getElementById('gameSearchInput').value || '';
  const searchTerm = rawSearchValue.trim().toLowerCase();
  const displaySearch = rawSearchValue.trim();
  const sortOption = document.getElementById('gameSortSelect').value;
  const completedTabActive = !document.getElementById('completedGamesSection').classList.contains('hidden');

  if (completedTabActive) {
    renderGamesList({
      storageKey: 'savedGames',
      containerId: 'savedGamesList',
      emptyMessageId: 'noCompletedGamesMessage',
      emptySearchMessage: 'No completed games match',
      searchTerm,
      displaySearch,
      sortOption,
      buildCard: buildSavedGameCard,
    });
  } else {
    renderGamesList({
      storageKey: 'freezerGames',
      containerId: 'freezerGamesList',
      emptyMessageId: 'noFreezerGamesMessage',
      emptySearchMessage: 'No frozen games match',
      searchTerm,
      displaySearch,
      sortOption,
      buildCard: buildFreezerGameCard,
    });
  }
}

function renderGamesList({ storageKey, containerId, emptyMessageId, emptySearchMessage, searchTerm, displaySearch, sortOption, buildCard }) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const entries = getLocalStorage(storageKey, []).map((game, index) => ({ game, index }));
  const normalizedTerm = searchTerm || '';

  const filteredEntries = normalizedTerm
    ? entries.filter(({ game }) => {
        const us = getGameTeamDisplay(game, 'us').toLowerCase();
        const dem = getGameTeamDisplay(game, 'dem').toLowerCase();
        const timestamp = game.timestamp ? new Date(game.timestamp).toLocaleString().toLowerCase() : '';
        return us.includes(normalizedTerm) || dem.includes(normalizedTerm) || timestamp.includes(normalizedTerm);
      })
    : entries;

  const sortedEntries = sortGamesBy(filteredEntries, sortOption);
  const listHtml = sortedEntries.map(({ game, index }) => buildCard(game, index)).join('');

  const emptyMessageEl = document.getElementById(emptyMessageId);
  if (emptyMessageEl) emptyMessageEl.classList.toggle('hidden', sortedEntries.length > 0);

  container.innerHTML = listHtml || (!normalizedTerm ? '' : `<p class="text-gray-500 col-span-full text-center">${emptySearchMessage} "${displaySearch}".</p>`);
}

function buildSavedGameCard(game, originalIndex) {
  const usDisplay = getGameTeamDisplay(game, 'us');
  const demDisplay = getGameTeamDisplay(game, 'dem');
  const usScore = game.finalScore?.us ?? 0;
  const demScore = game.finalScore?.dem ?? 0;
  const usWon = game.winner === 'us';
  const demWon = game.winner === 'dem';
  const timestamp = game.timestamp ? new Date(game.timestamp).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown date';

  return `
    <div class="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-lg transition-shadow dark:bg-gray-800 dark:border-gray-700 cursor-pointer relative" onclick="viewSavedGame(${originalIndex})">
      ${usWon ? `<div class="absolute top-0 right-2 bg-green-100 text-green-800 text-xs font-semibold px-2 py-0.5 rounded-full dark:bg-green-900 dark:text-green-300">Winner: ${usDisplay}</div>` : ''}
      ${demWon ? `<div class="absolute top-0 right-2 bg-green-100 text-green-800 text-xs font-semibold px-2 py-0.5 rounded-full dark:bg-green-900 dark:text-green-300">Winner: ${demDisplay}</div>` : ''}
      <div class="p-5">
        <div class="flex justify-between items-start mb-2">
          <div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">${usDisplay} vs ${demDisplay}</h3>
            <div class="text-sm text-gray-500 dark:text-gray-400">${timestamp}</div>
          </div>
          <div class="flex space-x-1">
            <button onclick="viewSavedGame(${originalIndex}); event.stopPropagation();" class="p-1.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-300" aria-label="View"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg></button>
            <button onclick="deleteSavedGame(${originalIndex}); event.stopPropagation();" class="p-1.5 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 rounded-full focus:outline-none focus:ring-2 focus:ring-red-300" aria-label="Delete">${Icons.Trash}</button>
          </div>
        </div>
        <div class="text-sm">
          <span class="${usWon ? 'text-green-600 font-bold' : 'text-gray-700 dark:text-gray-300'}">${usDisplay}: ${usScore}</span> |
          <span class="${demWon ? 'text-green-600 font-bold' : 'text-gray-700 dark:text-gray-300'}">${demDisplay}: ${demScore}</span>
        </div>
        <div class="mt-2 flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
          ${game.victoryMethod ? `<span class="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full dark:bg-purple-900 dark:text-purple-300">${game.victoryMethod}</span>` : ''}
          ${game.durationMs ? `<span>${formatDuration(game.durationMs)}</span>` : ''}
        </div>
      </div>
    </div>`;
}

function buildFreezerGameCard(game, originalIndex) {
  const usDisplay = getGameTeamDisplay(game, 'us');
  const demDisplay = getGameTeamDisplay(game, 'dem');
  const usScore = game.finalScore?.us ?? 0;
  const demScore = game.finalScore?.dem ?? 0;
  const timestamp = game.timestamp ? new Date(game.timestamp).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown date';
  const leadInfo = usScore > demScore
    ? `${usDisplay} leads by ${usScore - demScore}`
    : demScore > usScore
      ? `${demDisplay} leads by ${demScore - usScore}`
      : 'Tied';

  return `
    <div class="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-lg transition-shadow dark:bg-gray-800 dark:border-gray-700 cursor-pointer relative" onclick="loadFreezerGame(${originalIndex})">
      <div class="absolute top-0 right-2 bg-yellow-100 text-yellow-800 text-xs font-semibold px-2 py-0.5 rounded-full dark:bg-yellow-900 dark:text-yellow-300">${leadInfo}</div>
      <div class="p-5">
        <div class="flex justify-between items-start mb-2">
          <div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">${usDisplay} vs ${demDisplay}</h3>
            <div class="text-sm text-gray-500 dark:text-gray-400">Frozen: ${timestamp}</div>
          </div>
          <div class="flex space-x-1">
            <button onclick="loadFreezerGame(${originalIndex}); event.stopPropagation();" class="p-1.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-300" aria-label="Load">${Icons.Load}</button>
            <button onclick="deleteFreezerGame(${originalIndex}); event.stopPropagation();" class="p-1.5 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 rounded-full focus:outline-none focus:ring-2 focus:ring-red-300" aria-label="Delete">${Icons.Trash}</button>
          </div>
        </div>
        <div class="text-sm text-gray-700 dark:text-gray-300">
          <span>${usDisplay}: ${usScore}</span> | <span>${demDisplay}: ${demScore}</span>
        </div>
        <div class="mt-2 flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
          ${game.lastBid ? `<span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full dark:bg-indigo-900 dark:text-indigo-300">Last Bid: ${game.lastBid}</span>` : ''}
          ${game.accumulatedTime ? `<span>Played: ${formatDuration(game.accumulatedTime)}</span>` : ''}
        </div>
      </div>
    </div>`;
}

function sortGamesBy(entries, sortOption = 'newest') {
  const sorted = [...entries];
  const getTimestamp = ({ game }) => {
    const parsed = game.timestamp ? Date.parse(game.timestamp) : NaN;
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  const getHighScore = ({ game }) => {
    const finalScore = game.finalScore || {};
    const usScore = Number(finalScore.us) || 0;
    const demScore = Number(finalScore.dem) || 0;
    return Math.max(usScore, demScore);
  };

  switch (sortOption) {
    case 'oldest':
      sorted.sort((a, b) => getTimestamp(a) - getTimestamp(b));
      break;
    case 'highest':
      sorted.sort((a, b) => getHighScore(b) - getHighScore(a));
      break;
    case 'lowest':
      sorted.sort((a, b) => getHighScore(a) - getHighScore(b));
      break;
    case 'newest':
    default:
      sorted.sort((a, b) => getTimestamp(b) - getTimestamp(a));
      break;
  }
  return sorted;
}
function detectSandbag(rounds, winner, threshold = 2) { /* Placeholder */ return "N/A"; }
// --- Statistics Modal Rendering ---
function renderStatisticsContent() {
  const stats = getStatistics();
  let content = "";
  if (!stats.totalGames && !stats.teamsData.length) {
      content = `<div class="py-8 text-center"><svg xmlns="http://www.w3.org/2000/svg" class="h-14 w-14 mx-auto text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg><p class="mt-4 text-gray-600 dark:text-gray-400 text-lg">No stats yet. Play some games!</p><button onclick="handleNewGame(); closeMenuOverlay(); closeStatisticsModal();" class="mt-6 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm">Start New Game</button></div>`;
  } else {
      const statCard = (title, value, iconSvg, color) => `
          <div class="bg-gradient-to-br from-${color}-50 to-${color}-100 dark:from-gray-700 dark:to-gray-800 rounded-lg p-2.5 shadow-sm">
            <div class="flex items-center"><div class="p-1.5 bg-${color}-500 rounded-lg text-white">${iconSvg}</div>
              <div class="ml-2"><p class="text-xs uppercase font-semibold text-gray-500 dark:text-gray-400">${title}</p><p class="text-lg font-bold text-gray-900 dark:text-white">${value}</p></div>
            </div></div>`;

      const icons = {
          avgBid: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>',
          timePlayed: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
          gamesPlayed: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>'
      };
      let statCardsHtml = stats.totalGames > 0 ? `<div class="grid grid-cols-3 gap-2 mb-4">
          ${statCard("Avg Bid", stats.overallAverageBid, icons.avgBid, "blue")}
          ${statCard("Time Played", formatDuration(stats.totalTimePlayedMs), icons.timePlayed, "purple")}
          ${statCard("Games Played", stats.totalGames, icons.gamesPlayed, "green")}
      </div>` : "";
      const viewSelector = `<div class="mt-6 mb-4"><label for="statsViewModeSelect" class="block text-sm font-medium text-gray-700 dark:text-white mb-2">Show statistics for</label><div class="relative"><select id="statsViewModeSelect" class="appearance-none block w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg py-2.5 px-3 text-gray-700 dark:text-white leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:focus:ring-blue-400"><option value="teams"${statsViewMode === 'teams' ? ' selected' : ''}>Teams</option><option value="players"${statsViewMode === 'players' ? ' selected' : ''}>Individuals</option></select><div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 dark:text-gray-300"><svg class="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg></div></div></div>`;

      const metricOptions = ['games', 'avgBid', 'bidSuccessPct', 'sandbagger', '360s']
        .map(opt => `<option value="${opt}"${statsMetricKey === opt ? ' selected' : ''}>${opt === 'games' ? 'Games Played' : opt === 'avgBid' ? 'Avg Bid' : opt === 'bidSuccessPct' ? 'Bid Success %' : opt === 'sandbagger' ? 'Sandbagger?' : '360s'}</option>`)
        .join('');
      const metricLabel = statsViewMode === 'teams' ? 'Team statistic' : 'Individual statistic';
      const statSelector = `<div class="mb-4"><label for="additionalStatSelector" class="block text-sm font-medium text-gray-700 dark:text-white mb-2">${metricLabel}</label><div class="relative"><select id="additionalStatSelector" class="appearance-none block w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg py-2.5 px-3 text-gray-700 dark:text-white leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:focus:ring-blue-400">${metricOptions}</select><div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 dark:text-gray-300"><svg class="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg></div></div></div>`;

      const statsDataForMode = statsViewMode === 'teams' ? stats.teamsData : stats.playersData;
      const statsTableHtml = renderStatsTable(statsViewMode, statsDataForMode, statsMetricKey);
      content = `${statCardsHtml}${viewSelector}${statSelector}<div id="teamStatsTableWrapper">${statsTableHtml}</div>`;
  }
  document.getElementById("statisticsModalContent").innerHTML = content;
  const viewModeSelect = document.getElementById('statsViewModeSelect');
  if (viewModeSelect) {
    viewModeSelect.value = statsViewMode;
    viewModeSelect.addEventListener('change', e => {
      statsViewMode = e.target.value === 'players' ? 'players' : 'teams';
      renderStatisticsContent();
    });
  }
  const selector = document.getElementById("additionalStatSelector");
  if (selector) {
      selector.value = statsMetricKey;
      selector.addEventListener("change", function () {
          statsMetricKey = this.value;
          const latestStats = getStatistics();
          const data = statsViewMode === 'players' ? latestStats.playersData : latestStats.teamsData;
          document.getElementById("teamStatsTableWrapper").innerHTML = renderStatsTable(statsViewMode, data, statsMetricKey);
      });
  }
}
function getStatistics() {
  const savedGames = getLocalStorage("savedGames", []).filter(g => g && Array.isArray(g.rounds) && g.rounds.length > 0);

  const teamStatsMap = new Map();
  const playerStatsMap = new Map();
  let totalBids = 0;
  let sumOfBids = 0;
  let totalGameDuration = 0;

  const ensureTeamRecord = (key, players, displayName, timestampMs) => {
    if (!key) return null;
    if (!teamStatsMap.has(key)) {
      teamStatsMap.set(key, {
        key,
        name: displayName,
        players,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        totalBidAmount: 0,
        bidsMade: 0,
        bidsSucceeded: 0,
        handsPlayed: 0,
        handsWon: 0,
        sandbagGames: 0,
        perfect360s: 0,
        lastPlayed: 0,
        totalTimeMs: 0,
      });
    }
    const record = teamStatsMap.get(key);
    if (timestampMs && timestampMs > record.lastPlayed) record.lastPlayed = timestampMs;
    if (!record.name) record.name = displayName;
    record.players = canonicalizePlayers(record.players.length ? record.players : players);
    return record;
  };

  const ensurePlayerRecord = (name, timestampMs) => {
    const cleanName = sanitizePlayerName(name);
    if (!cleanName) return null;
    const key = cleanName.toLowerCase();
    if (!playerStatsMap.has(key)) {
      playerStatsMap.set(key, {
        key,
        name: cleanName,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        totalBidAmount: 0,
        bidsMade: 0,
        bidsSucceeded: 0,
        handsPlayed: 0,
        handsWon: 0,
        sandbagGames: 0,
        perfect360s: 0,
        lastPlayed: 0,
        totalTimeMs: 0,
      });
    }
    const record = playerStatsMap.get(key);
    if (timestampMs && timestampMs > record.lastPlayed) record.lastPlayed = timestampMs;
    return record;
  };

  savedGames.forEach(game => {
    const gameDuration = Number(game.durationMs) || 0;
    totalGameDuration += gameDuration;
    const timestampMs = new Date(game.timestamp || Date.now()).getTime();

    const usPlayers = canonicalizePlayers(game.usPlayers || parseLegacyTeamName(game.usTeamName || game.usName));
    const demPlayers = canonicalizePlayers(game.demPlayers || parseLegacyTeamName(game.demTeamName || game.demName));
    const usKey = buildTeamKey(usPlayers);
    const demKey = buildTeamKey(demPlayers);
    const usDisplay = deriveTeamDisplay(usPlayers, game.usTeamName || game.usName || 'Us') || 'Us';
    const demDisplay = deriveTeamDisplay(demPlayers, game.demTeamName || game.demName || 'Dem') || 'Dem';

    const usTeam = ensureTeamRecord(usKey, usPlayers, usDisplay, timestampMs);
    const demTeam = ensureTeamRecord(demKey, demPlayers, demDisplay, timestampMs);

    const usPlayerRecords = usPlayers.filter(Boolean).map(name => ensurePlayerRecord(name, timestampMs)).filter(Boolean);
    const demPlayerRecords = demPlayers.filter(Boolean).map(name => ensurePlayerRecord(name, timestampMs)).filter(Boolean);

    if (usTeam) {
      usTeam.gamesPlayed++;
      usTeam.totalTimeMs += gameDuration;
    }
    if (demTeam) {
      demTeam.gamesPlayed++;
      demTeam.totalTimeMs += gameDuration;
    }
    usPlayerRecords.forEach(rec => {
      rec.gamesPlayed++;
      rec.totalTimeMs += gameDuration;
    });
    demPlayerRecords.forEach(rec => {
      rec.gamesPlayed++;
      rec.totalTimeMs += gameDuration;
    });

    if (game.winner === 'us') {
      if (usTeam) usTeam.wins++;
      if (demTeam) demTeam.losses++;
      usPlayerRecords.forEach(rec => rec.wins++);
      demPlayerRecords.forEach(rec => rec.losses++);
    } else if (game.winner === 'dem') {
      if (demTeam) demTeam.wins++;
      if (usTeam) usTeam.losses++;
      demPlayerRecords.forEach(rec => rec.wins++);
      usPlayerRecords.forEach(rec => rec.losses++);
    }

    game.rounds.forEach(round => {
      const bidAmount = Number(round.bidAmount) || 0;
      if (bidAmount) {
        sumOfBids += bidAmount;
        totalBids++;
      }

      const usPoints = Number(round.usPoints) || 0;
      const demPoints = Number(round.demPoints) || 0;

      if (usTeam) usTeam.handsPlayed++;
      if (demTeam) demTeam.handsPlayed++;
      usPlayerRecords.forEach(rec => rec.handsPlayed++);
      demPlayerRecords.forEach(rec => rec.handsPlayed++);

      if (usPoints > demPoints) {
        if (usTeam) usTeam.handsWon++;
        usPlayerRecords.forEach(rec => rec.handsWon++);
      } else if (demPoints > usPoints) {
        if (demTeam) demTeam.handsWon++;
        demPlayerRecords.forEach(rec => rec.handsWon++);
      }

      if (usPoints === 360) {
        if (usTeam) usTeam.perfect360s++;
        usPlayerRecords.forEach(rec => rec.perfect360s++);
      }
      if (demPoints === 360) {
        if (demTeam) demTeam.perfect360s++;
        demPlayerRecords.forEach(rec => rec.perfect360s++);
      }

      if (round.biddingTeam === 'us') {
        if (usTeam) {
          usTeam.bidsMade++;
          usTeam.totalBidAmount += bidAmount;
          if (usPoints >= bidAmount) usTeam.bidsSucceeded++;
        }
        usPlayerRecords.forEach(rec => {
          rec.bidsMade++;
          rec.totalBidAmount += bidAmount;
          if (usPoints >= bidAmount) rec.bidsSucceeded++;
        });
      } else if (round.biddingTeam === 'dem') {
        if (demTeam) {
          demTeam.bidsMade++;
          demTeam.totalBidAmount += bidAmount;
          if (demPoints >= bidAmount) demTeam.bidsSucceeded++;
        }
        demPlayerRecords.forEach(rec => {
          rec.bidsMade++;
          rec.totalBidAmount += bidAmount;
          if (demPoints >= bidAmount) rec.bidsSucceeded++;
        });
      }
    });

    const sandbagUs = isGameSandbagForTeamKey(game, usPlayers);
    const sandbagDem = isGameSandbagForTeamKey(game, demPlayers);
    if (sandbagUs) {
      if (usTeam) usTeam.sandbagGames++;
      usPlayerRecords.forEach(rec => rec.sandbagGames++);
    }
    if (sandbagDem) {
      if (demTeam) demTeam.sandbagGames++;
      demPlayerRecords.forEach(rec => rec.sandbagGames++);
    }
  });

  const teamsData = Array.from(teamStatsMap.values()).map(team => {
    const winPercent = team.gamesPlayed ? ((team.wins / team.gamesPlayed) * 100).toFixed(1) : '0.0';
    const avgBid = team.bidsMade ? (team.totalBidAmount / team.bidsMade).toFixed(0) : 'N/A';
    const bidSuccessPct = team.bidsMade ? ((team.bidsSucceeded / team.bidsMade) * 100).toFixed(1) : 'N/A';
    const sandbagger = team.gamesPlayed && (team.sandbagGames / team.gamesPlayed > 0.5) ? 'Yes' : 'No';
    return {
      ...team,
      winPercent,
      avgBid,
      bidSuccessPct,
      sandbagger,
      count360: team.perfect360s,
    };
  }).sort((a, b) => b.lastPlayed - a.lastPlayed);

  const playersData = Array.from(playerStatsMap.values()).map(player => {
    const winPercent = player.gamesPlayed ? ((player.wins / player.gamesPlayed) * 100).toFixed(1) : '0.0';
    const avgBid = player.bidsMade ? (player.totalBidAmount / player.bidsMade).toFixed(0) : 'N/A';
    const bidSuccessPct = player.bidsMade ? ((player.bidsSucceeded / player.bidsMade) * 100).toFixed(1) : 'N/A';
    const sandbagger = player.gamesPlayed && (player.sandbagGames / player.gamesPlayed > 0.5) ? 'Yes' : 'No';
    return {
      ...player,
      winPercent,
      avgBid,
      bidSuccessPct,
      sandbagger,
      count360: player.perfect360s,
    };
  }).sort((a, b) => b.lastPlayed - a.lastPlayed);

  return {
    totalGames: savedGames.length,
    overallAverageBid: totalBids > 0 ? (sumOfBids / totalBids).toFixed(0) : 'N/A',
    teamsData,
    playersData,
    totalTimePlayedMs: totalGameDuration,
  };
}

function isGameSandbagForTeamKey(game, teamPlayers, threshold = 2) {
  const teamKey = buildTeamKey(teamPlayers);
  if (!teamKey) return false;

  const gameUsKey = buildTeamKey(canonicalizePlayers(game.usPlayers || parseLegacyTeamName(game.usTeamName || game.usName)));
  const gameDemKey = buildTeamKey(canonicalizePlayers(game.demPlayers || parseLegacyTeamName(game.demTeamName || game.demName)));

  let target = null;
  let opponent = null;
  if (teamKey === gameUsKey) {
    target = 'us';
    opponent = 'dem';
  } else if (teamKey === gameDemKey) {
    target = 'dem';
    opponent = 'us';
  } else {
    return false;
  }

  let sandbagOpportunities = 0;
  (game.rounds || []).forEach(round => {
    if (round.biddingTeam === opponent && Number(round[`${opponent}Points`]) < 0) {
      const targetPoints = Number(round[`${target}Points`]) || 0;
      const bidAmount = Number(round.bidAmount) || 0;
      if (targetPoints >= 80 || targetPoints >= bidAmount) sandbagOpportunities++;
    }
  });
  return sandbagOpportunities >= threshold;
}
function renderStatsTable(mode, statsData, additionalStatKey) {
  const headers = { games: "Games", avgBid: "Avg Bid", bidSuccessPct: "Bid Success %", sandbagger: "Sandbagger?", "360s": "360s" };
  const nameHeader = mode === 'teams' ? 'Team' : 'Player';
  if (!statsData || !statsData.length) {
    const emptyLabel = mode === 'teams' ? 'No team stats yet.' : 'No individual stats yet.';
    return `<p class="text-center text-gray-500 dark:text-gray-400 mt-4">${emptyLabel}</p>`;
  }

  let tableHTML = `<div id="teamStatsTableContainer" class="mt-4"><div class="overflow-x-auto -mx-4 sm:mx-0"><div class="inline-block min-w-full align-middle"><table class="min-w-full divide-y divide-gray-200 dark:divide-gray-600"><thead><tr>
      <th scope="col" class="py-3 pl-4 pr-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 sticky left-0 z-10">${nameHeader}</th>
      <th scope="col" class="px-3 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700">Win %</th>
      <th scope="col" class="px-3 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700">${headers[additionalStatKey] || 'Stat'}</th>`;
  if (mode === 'teams') {
    tableHTML += `<th scope="col" class="pl-3 pr-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700">Del</th>`;
  }
  tableHTML += `</tr></thead><tbody class="divide-y divide-gray-200 dark:divide-gray-600 bg-white dark:bg-gray-800">`;

  statsData.forEach((item, index) => {
    const rowClass = index % 2 === 0 ? "bg-white dark:bg-gray-800" : "bg-gray-50 dark:bg-gray-700";
    const lookup = {
      games: item.gamesPlayed,
      '360s': item.count360,
      avgBid: item.avgBid,
      bidSuccessPct: item.bidSuccessPct,
      sandbagger: item.sandbagger,
    };
    let statVal = lookup[additionalStatKey] ?? '0';
    if (additionalStatKey.includes('Pct') && typeof statVal === 'string' && !statVal.includes('%') && statVal !== 'N/A') statVal += '%';

    const displayName = mode === 'teams' ? item.name : item.name;
    tableHTML += `<tr class="${rowClass}">
      <td class="whitespace-nowrap py-3.5 pl-4 pr-3 text-sm font-medium text-gray-900 dark:text-white sticky left-0 z-10 ${rowClass}">${displayName}</td>
      <td class="whitespace-nowrap px-3 py-3.5 text-sm text-center text-gray-700 dark:text-gray-300">${item.winPercent}%</td>
      <td class="whitespace-nowrap px-3 py-3.5 text-sm text-center text-gray-700 dark:text-gray-300">${statVal}</td>`;
    if (mode === 'teams') {
      const escapedName = displayName.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      tableHTML += `<td class="whitespace-nowrap pl-3 pr-4 py-3.5 text-sm text-center"><button onclick="handleDeleteTeam('${item.key}', '${escapedName}'); event.stopPropagation();" class="text-red-600 hover:text-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 rounded-full p-1.5 dark:text-red-400 dark:hover:text-red-300" aria-label="Delete Team">${Icons.Trash}</button></td>`;
    }
    tableHTML += `</tr>`;
  });

  tableHTML += `</tbody></table></div></div></div>`;
  return tableHTML;
}
function handleDeleteTeam(teamKey, displayName = '') {
  const fallbackLabel = displayName || 'this team';
  openConfirmationModal(`Delete team "${fallbackLabel}" and all related game data? This is irreversible.`, () => {
      const teams = getTeamsObject();
      let keyToDelete = teamKey && teams[teamKey] ? teamKey : null;
      if (!keyToDelete && displayName) {
        Object.entries(teams).forEach(([key, value]) => {
          const display = deriveTeamDisplay(value.players, value.displayName || '');
          if (!keyToDelete && display === displayName) keyToDelete = key;
        });
      }
      if (keyToDelete) {
        delete teams[keyToDelete];
        setTeamsObject(teams);
      }

      let savedGames = getLocalStorage("savedGames");
      savedGames = savedGames.filter(g => {
        const sameKey = (g.usTeamKey && g.usTeamKey === keyToDelete) || (g.demTeamKey && g.demTeamKey === keyToDelete);
        if (sameKey) return false;
        if (!displayName) return true;
        const usDisplay = getGameTeamDisplay(g, 'us');
        const demDisplay = getGameTeamDisplay(g, 'dem');
        return usDisplay !== displayName && demDisplay !== displayName;
      });
      setLocalStorage("savedGames", savedGames);

      let freezerGames = getLocalStorage("freezerGames");
      freezerGames = freezerGames.filter(g => {
        const sameKey = (g.usTeamKey && g.usTeamKey === keyToDelete) || (g.demTeamKey && g.demTeamKey === keyToDelete);
        if (sameKey) return false;
        if (!displayName) return true;
        const usDisplay = getGameTeamDisplay(g, 'us');
        const demDisplay = getGameTeamDisplay(g, 'dem');
        return usDisplay !== displayName && demDisplay !== displayName;
      });
      setLocalStorage("freezerGames", freezerGames);

      recalcTeamsStats();

      closeConfirmationModal();
      renderStatisticsContent(); // Refresh stats modal
  }, closeConfirmationModal);
}

// --- Settings Loading ---
function loadSettings() {
  console.log("Loading settings from localStorage...");

  // Load win probability method setting
  const winProbMethodSelect = document.getElementById("winProbMethodSelect");
  if (winProbMethodSelect) {
    const savedMethod = getLocalStorage(WIN_PROB_CALC_METHOD_KEY, "simple");
    console.log("Loading Win Prob Method:", savedMethod);
    winProbMethodSelect.value = savedMethod;
  } else {
    console.warn("winProbMethodSelect element not found");
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

// --- Initialization ---
document.addEventListener("DOMContentLoaded", () => {
  performTeamPlayerMigration();
  document.body.classList.remove('modal-open');
  document.getElementById('app')?.classList.remove('modal-active');
  document.querySelectorAll('.modal').forEach(modal => modal.classList.add('hidden'));
  enforceDarkMode();
  initializeTheme(); // Predefined themes
  initializeCustomThemeColors(); // Custom primary/accent
  loadCurrentGameState(); // Load after theme
  loadSettings(); // Load settings after game state

  // Pro mode toggle (in settings modal, not main nav)
  const proModeToggleModal = document.getElementById("proModeToggleModal");
  if (proModeToggleModal) {
      proModeToggleModal.checked = getLocalStorage(PRO_MODE_KEY, false);
      proModeToggleModal.addEventListener("change", (e) => toggleProMode(e.target));
  }
  updateProModeUI(getLocalStorage(PRO_MODE_KEY, false)); // Initial UI update

  document.getElementById("closeViewSavedGameModalBtn")?.addEventListener("click", (e) => { e.stopPropagation(); closeViewSavedGameModal(); });
  document.getElementById("closeSavedGamesModalBtn")?.addEventListener("click", (e) => { e.stopPropagation(); closeSavedGamesModal(); });
  document.getElementById("teamSelectionForm")?.addEventListener("submit", handleTeamSelectionSubmit);
  const resumePaperGameButton = document.getElementById("resumePaperGameButton");
  if (resumePaperGameButton) {
    resumePaperGameButton.addEventListener("click", (event) => {
      event.preventDefault();
      openResumeGameModal();
      toggleMenu(event);
    });
  }

  // Close modals on outside click (simplified)
  const modalCloseHandlers = {
    savedGamesModal: closeSavedGamesModal,
    viewSavedGameModal: closeViewSavedGameModal,
    aboutModal: closeAboutModal,
    statisticsModal: closeStatisticsModal,
    teamSelectionModal: closeTeamSelectionModal,
    resumeGameModal: closeResumeGameModal,
    settingsModal: closeSettingsModal,
    themeModal: () => closeThemeModal(null),
    confirmationModal: closeConfirmationModal,
    presetEditorModal: closePresetEditorModal,
  };

  document.addEventListener("click", (e) => {
    Object.entries(modalCloseHandlers).forEach(([id, handler]) => {
      const modalEl = document.getElementById(id);
      if (modalEl && !modalEl.classList.contains("hidden") && e.target === modalEl) {
        handler();
      }
    });
  });
  document.body.addEventListener('touchend', e => {
      const touchEndX = e.changedTouches[0].clientX;
      const menu = document.getElementById("menu");
      if (!menu) return;
      const menuOpen = menu.classList.contains("show");
      if (touchStartX < 50 && touchEndX > touchStartX + 50 && !menuOpen) {
        toggleMenu(e);
      } else if (menuOpen && touchEndX < touchStartX - 50) {
        toggleMenu(e);
      }
  }, { passive: true });
});

if ('serviceWorker' in navigator) {
  let refreshing;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    window.location.reload();
    refreshing = true;
  });
  window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js') // Assuming sw is in root
          .then(registration => {
              registration.onupdatefound = () => {
                  const installingWorker = registration.installing;
                  if (installingWorker == null) return;
                  installingWorker.onstatechange = () => {
                      if (installingWorker.state === 'installed') {
                          if (navigator.serviceWorker.controller) {
                              // New update available
                              if (confirm('New version available! Reload to update?')) {
                                  installingWorker.postMessage({ type: 'SKIP_WAITING' });
                              }
                          }
                      }
                  };
              };
          }).catch(error => console.error('Service Worker registration failed:', error));
  });
}

function undoPenaltyFlag() {
  updateState({ pendingPenalty: null });
  showSaveIndicator("Penalty removed");
}

function handleTeamSelectionCancel() {
  if (state.gameOver) {
    openConfirmationModal(
      'The game is completed. Canceling will erase this game. Are you sure?',
      () => { closeTeamSelectionModal(); resetGame(); closeConfirmationModal(); },
      closeConfirmationModal
    );
  } else {
    closeTeamSelectionModal();
  }
}

// Swipe-and-drag gesture for menu open/close
(function() {
    const menu = document.getElementById("menu");
    const overlay = document.getElementById("menuOverlay");
    const icon = document.getElementById("hamburgerIcon");
    let startX = 0;
    let currentX = 0;
    let isDragging = false;
    let isOpening = false;
    const menuWidth = menu.offsetWidth;

    function onTouchStart(e) {
        startX = e.touches[0].clientX;
        currentX = startX;
        const menuOpen = menu.classList.contains("show");
        if (!menuOpen && startX <= 20) {
            isDragging = true;
            isOpening = true;
            menu.style.transition = "none";
            overlay.classList.add("show");
            overlay.style.opacity = "0";
            document.body.classList.add("overflow-hidden");
        } else if (menuOpen) {
            isDragging = true;
            isOpening = false;
            menu.style.transition = "none";
            overlay.classList.add("show");
        }
    }

    function onTouchMove(e) {
        if (!isDragging) return;
        currentX = e.touches[0].clientX;
        let deltaX = currentX - startX;
        if (isOpening) {
            const left = Math.min(0, -menuWidth + currentX);
            menu.style.left = left + "px";
            overlay.style.opacity = (menuWidth + left) / menuWidth;
        } else {
            const left = Math.min(0, deltaX);
            menu.style.left = left + "px";
            overlay.style.opacity = (menuWidth + left) / menuWidth;
        }
    }

    function onTouchEnd() {
        if (!isDragging) return;
        isDragging = false;
        const deltaX = currentX - startX;
        const threshold = menuWidth / 3;
        let shouldOpen;
        if (isOpening) {
            shouldOpen = deltaX > threshold;
        } else {
            shouldOpen = deltaX > -threshold;
        }
        menu.style.transition = "";
        if (shouldOpen) {
            menu.classList.add("show");
            icon.classList.add("open");
            overlay.classList.add("show");
            document.body.classList.add("overflow-hidden");
        } else {
            menu.classList.remove("show");
            icon.classList.remove("open");
            overlay.classList.remove("show");
            document.body.classList.remove("overflow-hidden");
        }
        menu.style.left = "";
        overlay.style.opacity = "";
    }

    document.addEventListener("touchstart", onTouchStart, { passive: false });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
})();

// Expose selected helpers when running in a Node/CommonJS environment (e.g. tests)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sanitizePlayerName,
    ensurePlayersArray,
    canonicalizePlayers,
    formatTeamDisplay,
    buildTeamKey,
    parseLegacyTeamName,
    deriveTeamDisplay,
    getGameTeamDisplay,
    playersEqual,
    bucketScore,
    buildProbabilityIndex,
    calculateWinProbabilitySimple,
    calculateWinProbabilityComplex,
    calculateWinProbability,
  };
}
