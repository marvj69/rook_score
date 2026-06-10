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
const GAME_LOCATION_TIMEOUT_MS = 6500;
const GAME_LOCATION_REVERSE_GEOCODE_TIMEOUT_MS = 5500;
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
  gameLocation: null,
};

const US_STATE_ABBREVIATIONS = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
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
  if (Object.prototype.hasOwnProperty.call(overrides, "had_location")) {
    params.had_location = Boolean(overrides.had_location);
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

function getGameTeamDisplay(game, side) {
  const fallback = side === 'us' ? 'Us' : 'Dem';
  if (!game || (side !== 'us' && side !== 'dem')) return fallback;
  const playersField = side === 'us' ? game.usPlayers || game.usTeamPlayers || game.usTeam : game.demPlayers || game.demTeamPlayers || game.demTeam;
  const canonicalPlayers = canonicalizePlayers(playersField);
  const nameField = side === 'us' ? (game.usTeamName || game.usName) : (game.demTeamName || game.demName);
  return deriveTeamDisplay(canonicalPlayers, nameField || fallback) || fallback;
}

function cleanLocationPiece(value) {
  return (typeof value === "string" ? value : "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,+$/g, "");
}

function normalizeStateCode(value) {
  const cleaned = cleanLocationPiece(value);
  if (!cleaned) return "";
  const isoMatch = cleaned.match(/^US[-_ ]([A-Z]{2})$/i);
  if (isoMatch) return isoMatch[1].toUpperCase();
  const compact = cleaned.replace(/\./g, "").toUpperCase();
  if (/^[A-Z]{2}$/.test(compact)) return compact;
  return US_STATE_ABBREVIATIONS[cleaned.toLowerCase()] || compact;
}

function formatGameLocationParts(parts = {}) {
  const street = cleanLocationPiece(parts.street);
  const city = cleanLocationPiece(parts.city);
  const stateCode = normalizeStateCode(parts.state || parts.stateCode || parts.stateName);
  if (!city || !stateCode) return "";
  return [street, city, stateCode].filter(Boolean).join(", ");
}

function getStreetFromAddress(address = {}) {
  const houseNumber = cleanLocationPiece(address.house_number);
  const road = cleanLocationPiece(
    address.road ||
    address.pedestrian ||
    address.footway ||
    address.path ||
    address.cycleway ||
    address.neighbourhood ||
    address.suburb ||
    address.name
  );
  if (houseNumber && road) return `${houseNumber} ${road}`;
  return road || houseNumber;
}

function getCityFromAddress(address = {}) {
  return cleanLocationPiece(
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.municipality ||
    address.locality ||
    address.county
  );
}

function createGameLocationRecord({ street = "", city = "", state = "", latitude = null, longitude = null, source = "manual" } = {}) {
  const formatted = formatGameLocationParts({ street, city, state });
  if (!formatted) return null;
  const record = {
    formatted,
    street: cleanLocationPiece(street),
    city: cleanLocationPiece(city),
    state: normalizeStateCode(state),
    capturedAt: new Date().toISOString(),
    source,
  };
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    record.latitude = Number(latitude.toFixed(6));
    record.longitude = Number(longitude.toFixed(6));
  }
  return record;
}

function createManualGameLocationRecord(input) {
  const cleaned = cleanLocationPiece(input);
  if (!cleaned) return null;
  const parts = cleaned.split(",").map(cleanLocationPiece).filter(Boolean);
  if (parts.length >= 3) {
    const state = parts.pop();
    const city = parts.pop();
    const street = parts.join(", ");
    const structured = createGameLocationRecord({ street, city, state, source: "manual" });
    if (structured) return structured;
  }
  return {
    formatted: cleaned,
    street: "",
    city: "",
    state: "",
    capturedAt: new Date().toISOString(),
    source: "manual",
  };
}

function getStoredLocationDisplay(location) {
  if (!location) return "";
  if (typeof location === "string") return cleanLocationPiece(location);
  if (typeof location !== "object") return "";
  if (location.formatted) return cleanLocationPiece(location.formatted);
  return formatGameLocationParts(location);
}

function getGameLocationDisplay(game) {
  if (!game || typeof game !== "object") return "";
  return getStoredLocationDisplay(
    game.location ||
    game.completedLocation ||
    game.gameLocation ||
    game.frozenLocation ||
    game.lastFrozenLocation
  );
}

function requestBrowserCoordinates(timeoutMs = GAME_LOCATION_TIMEOUT_MS) {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (!nav || !nav.geolocation || typeof nav.geolocation.getCurrentPosition !== "function") {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    nav.geolocation.getCurrentPosition(
      position => resolve(position),
      error => {
        console.warn("Game location unavailable.", error);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 }
    );
  });
}

async function reverseGeocodeGameLocation(position) {
  if (!position || !position.coords || typeof fetch !== "function") return null;
  const { latitude, longitude } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    addressdetails: "1",
    zoom: "18",
  });
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), GAME_LOCATION_REVERSE_GEOCODE_TIMEOUT_MS) : null;
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: controller ? controller.signal : undefined,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const address = payload && payload.address ? payload.address : {};
    const state = address["ISO3166-2-lvl4"] || address.state_code || address.state;
    return createGameLocationRecord({
      street: getStreetFromAddress(address),
      city: getCityFromAddress(address),
      state,
      latitude,
      longitude,
      source: "geolocation",
    });
  } catch (error) {
    console.warn("Reverse geocoding game location failed.", error);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function captureGameLocation() {
  const position = await requestBrowserCoordinates();
  const geocoded = await reverseGeocodeGameLocation(position);
  if (geocoded) return geocoded;
  return null;
}

function playersEqual(a, b) {
  const [a1, a2] = canonicalizePlayers(a);
  const [b1, b2] = canonicalizePlayers(b);
  return a1 === b1 && a2 === b2;
}
