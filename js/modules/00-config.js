"use strict";

// --- Configuration & Constants ---
const APP_VERSION = "2.1";
const APP_RELEASE_SUMMARY = "Version 2.1 adds the cartoony glass theme, refreshed 3-D cards, buttons, modals, and statistics styling, brighter app colors, bouncy motion polish, and a new default visual treatment.";
const MUST_WIN_BY_BID_KEY = "rookMustWinByBid";
const TABLE_TALK_PENALTY_TYPE_KEY = "tableTalkPenaltyType";
const TABLE_TALK_PENALTY_POINTS_KEY = "tableTalkPenaltyPoints";
const ACTIVE_GAME_KEY = "activeGameState";
const PRO_MODE_KEY = "proModeEnabled";
const THEME_KEY = "rookSelectedTheme";
const PRESET_BIDS_KEY = 'customPresetBids';
const MISDEAL_HANDLING_KEY = "misdealHandlingEnabled";
const PROB_CACHE = new Map();   // memoise across calls
const LOCAL_STORAGE_CACHE = new Map();
const WIN_PROB_CACHE = { key: null, value: null };
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
  historyEdit: null,
  usTeamName: "", demTeamName: "",
  usPlayers: ["", ""], demPlayers: ["", ""],
  startTime: null,
  accumulatedTime: 0, showWinProbability: false, pendingPenalty: null,
  isSubmittingRound: false,
  timerLastSavedAt: null,
  startingTotals: { us: 0, dem: 0 },
  dealers: [],
  misdealCount: 0,
};

function sanitizePlayerName(name) {
  return (typeof name === "string" ? name : "").trim().replace(/\s+/g, " ");
}

const HTML_ESCAPE_CHARS = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text) {
  if (typeof text !== "string") return "";
  return text.replace(/[&<>"']/g, char => HTML_ESCAPE_CHARS[char]);
}

function escapeHtmlValue(value) {
  if (value === null || value === undefined) return "";
  return escapeHtml(String(value));
}

function escapeAttribute(value) {
  return escapeHtmlValue(value);
}

function getRookRoundCount(game = {}) {
  return Array.isArray(game.rounds) ? game.rounds.length : 0;
}

function getRookDurationBucket(durationMs) {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value < 0) return "unknown";
  const minutes = Math.floor(value / 60000);
  if (minutes < 15) return "under_15m";
  if (minutes < 30) return "15_29m";
  if (minutes < 45) return "30_44m";
  if (minutes < 60) return "45_59m";
  if (minutes < 90) return "60_89m";
  if (minutes < 120) return "90_119m";
  return "120m_plus";
}

function getRookVictoryMethodLabel(victoryMethod) {
  const value = String(victoryMethod || "").toLowerCase();
  if (value.includes("spread")) return "point_spread";
  if (value.includes("set")) return "set_other_team";
  if (value.includes("bid")) return "won_on_bid";
  return "unknown";
}

function getRookGameEventParams(game = state, overrides = {}) {
  const durationMs = Object.prototype.hasOwnProperty.call(overrides, "durationMs")
    ? overrides.durationMs
    : game.accumulatedTime;
  const params = {
    round_count: getRookRoundCount(game),
    duration_bucket: getRookDurationBucket(durationMs),
    pro_mode: Boolean(
      Object.prototype.hasOwnProperty.call(overrides, "pro_mode")
        ? overrides.pro_mode
        : game.showWinProbability || getLocalStorage(PRO_MODE_KEY, false)
    ),
  };

  if (Object.prototype.hasOwnProperty.call(overrides, "source")) {
    params.source = overrides.source;
  }
  if (Object.prototype.hasOwnProperty.call(overrides, "victory_method")) {
    params.victory_method = getRookVictoryMethodLabel(overrides.victory_method);
  } else if (game.victoryMethod) {
    params.victory_method = getRookVictoryMethodLabel(game.victoryMethod);
  }
  if (Object.prototype.hasOwnProperty.call(overrides, "game_state")) {
    params.game_state = overrides.game_state;
  }

  return params;
}

// Internal dispatcher to the analytics layer (window.trackRookEvent, defined in
// js/analytics.js). This MUST NOT be named `trackRookEvent`: the bundle is a
// classic script, so a top-level `function trackRookEvent` would become
// window.trackRookEvent, clobbering the real implementation and making this
// call itself recursively (stack overflow → frozen tab on every submit).
function emitRookEvent(eventName, params = {}) {
  if (typeof window === "undefined" || typeof window.trackRookEvent !== "function") return false;
  if (window.trackRookEvent === emitRookEvent) return false; // belt-and-suspenders: never self-recurse
  return window.trackRookEvent(eventName, params);
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

function formatTimestamp(ms, fallback = "Unknown") {
  if (ms === null || ms === undefined) return fallback;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function isSideLabelTeamName(name, side) {
  const normalized = sanitizePlayerName(name).toLowerCase();
  return !normalized || normalized === side;
}

function getDealerPairPlayers(sourceState = {}, side = "us") {
  const dealers = Array.isArray(sourceState?.dealers)
    ? sourceState.dealers.map(sanitizePlayerName).filter(Boolean)
    : [];
  const uniqueDealers = new Set(dealers.map(dealer => dealer.toLowerCase()));
  if (dealers.length !== 4 || uniqueDealers.size !== 4) return ["", ""];
  return side === "us" ? [dealers[0], dealers[2]] : [dealers[1], dealers[3]];
}

function getTeamSnapshotForSide(sourceState = {}, side = "us") {
  const fallback = side === "us" ? "Us" : "Dem";
  const playersField = side === "us" ? sourceState?.usPlayers : sourceState?.demPlayers;
  const nameField = side === "us" ? sourceState?.usTeamName || sourceState?.usName : sourceState?.demTeamName || sourceState?.demName;
  const players = ensurePlayersArray(playersField);

  if (players.filter(Boolean).length === 2) {
    return {
      players,
      display: deriveTeamDisplay(players, isSideLabelTeamName(nameField, side) ? fallback : sanitizePlayerName(nameField)) || fallback,
    };
  }

  const parsedNamePlayers = ensurePlayersArray(parseLegacyTeamName(nameField || ""));
  if (parsedNamePlayers.filter(Boolean).length === 2) {
    return {
      players: parsedNamePlayers,
      display: deriveTeamDisplay(parsedNamePlayers, sanitizePlayerName(nameField)) || fallback,
    };
  }

  const dealerPlayers = isSideLabelTeamName(nameField, side) ? getDealerPairPlayers(sourceState, side) : ["", ""];
  const resolvedPlayers = dealerPlayers.filter(Boolean).length === 2 ? dealerPlayers : players;
  const displayFallback = isSideLabelTeamName(nameField, side) ? fallback : sanitizePlayerName(nameField);

  return {
    players: resolvedPlayers,
    display: deriveTeamDisplay(resolvedPlayers, displayFallback) || fallback,
  };
}

function getGameTeamDisplay(game, side) {
  const fallback = side === 'us' ? 'Us' : 'Dem';
  if (!game || (side !== 'us' && side !== 'dem')) return fallback;
  const playersField = side === 'us' ? game.usPlayers || game.usTeamPlayers || game.usTeam : game.demPlayers || game.demTeamPlayers || game.demTeam;
  const canonicalPlayers = canonicalizePlayers(playersField);
  const nameField = side === 'us' ? (game.usTeamName || game.usName) : (game.demTeamName || game.demName);
  const displayFallback = isSideLabelTeamName(nameField, side) ? fallback : nameField;
  return deriveTeamDisplay(canonicalPlayers, displayFallback || fallback) || fallback;
}

function playersEqual(a, b) {
  const [a1, a2] = canonicalizePlayers(a);
  const [b1, b2] = canonicalizePlayers(b);
  return a1 === b1 && a2 === b2;
}
