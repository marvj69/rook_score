"use strict";

// --- Configuration & Constants ---
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
  timerLastSavedAt: null,
  startingTotals: { us: 0, dem: 0 },
  dealers: [],
  misdealCount: 0,
};

function sanitizePlayerName(name) {
  return (typeof name === "string" ? name : "").trim().replace(/\s+/g, " ");
}

function escapeHtml(text) {
  if (typeof text !== "string") return "";
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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

