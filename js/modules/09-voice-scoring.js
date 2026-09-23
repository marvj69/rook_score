"use strict";

// --- Voice Actions ---
const VOICE_SCORE_STATUS_TIMEOUT_MS = 4500;
const VOICE_SCORE_STATUS_MAX_TIMEOUT_MS = 12000;
const VOICE_SCORE_PERMISSION_NOTICE_DELAY_MS = 300;
const VOICE_SCORE_RECORDING_MAX_MS = 6500;
const VOICE_SCORE_STREAM_IDLE_TIMEOUT_MS = 60000;
// The server gives the planner 12 seconds; leave room for the upload on top.
const VOICE_SCORE_REQUEST_TIMEOUT_MS = 16000;
const VOICE_SCORE_WARM_INTERVAL_MS = 60000;
const VOICE_SCORE_AUDIO_BITS_PER_SECOND = 32000;
const VOICE_SCORE_CONVERSATION_MAX_MESSAGES = 6;
const VOICE_SCORE_LIBRARY_CONTEXT_LIMIT = 10;
const VOICE_SCORE_STATISTICS_CONTEXT_LIMIT = 100;
const VOICE_SCORE_SPEECH_KEY = `${LOCAL_ONLY_STORAGE_PREFIX}voiceSpokenReplies`;
const VOICE_SCORE_HOST_ID = "voiceScoreHost";
const SAME_ORIGIN_VOICE_SCORE_COMMAND_URL = "/api/voice-score-command";
const VERCEL_VOICE_SCORE_COMMAND_URL = "https://rook-score.vercel.app/api/voice-score-command";
const VOICE_SCORE_GITHUB_PAGES_HOSTNAMES = new Set(["marvj69.github.io"]);
const VOICE_SCORE_ACTION_TYPES = new Set(Object.keys(VOICE_TOOLS.actions));
const VOICE_SCORE_PLAN_STATUSES = new Set(VOICE_TOOLS.statuses);
const VOICE_SCORE_TIMER_KEYS = [
  "startTime", "timerStarted", "accumulatedTime", "timerLastSavedAt",
  "timerLastActivityAt", "timerPaused", "timerSkippedMs",
];
let voiceScoreRecorder = null;
let voiceScoreRecorderStream = null;
let voiceScoreListening = false;
let voiceScoreMode = "";
let voiceScoreStatus = "";
let voiceScoreStatusTone = "info";
let voiceScoreStatusTimer = null;
let voiceScorePermissionNoticeTimer = null;
let voiceScoreRecordingTimer = null;
let voiceScoreStreamIdleTimer = null;
let voiceScoreConversation = [];
let voiceScoreOperationId = 0;
let voiceScoreRequestController = null;
let voiceScoreHeldPointerId = null;
let voiceScoreHeldKey = "";
let voiceScoreControlListenersInitialized = false;
let voiceScorePreparedContext = null;
let voiceScoreLastWarmAt = 0;
let voiceScoreSpeechPrimed = false;
let voiceScoreRenderedHost = null;
let voiceScoreRenderedMarkup = "";

function getVoiceScoreTeamLabel(team) {
  return team === "us" ? state.usTeamName || "Us" : state.demTeamName || "Dem";
}

function toVoiceScoreBoolean(value) {
  return value === true || /^(?:true|on|yes|1)$/i.test(String(value ?? "").trim());
}

// --- Spoken replies ---
function isVoiceScoreSpeechSupported() {
  return typeof window !== "undefined"
    && Boolean(window.speechSynthesis)
    && typeof window.SpeechSynthesisUtterance === "function";
}

function isVoiceScoreSpeechEnabled() {
  return getLocalStorage(VOICE_SCORE_SPEECH_KEY, true) !== false;
}

function syncVoiceScoreSpeechToggle() {
  const toggle = document.getElementById("voiceSpokenRepliesToggle");
  if (toggle) toggle.checked = isVoiceScoreSpeechEnabled();
}

function setVoiceScoreSpeechEnabled(enabled) {
  const isEnabled = Boolean(enabled);
  setLocalStorage(VOICE_SCORE_SPEECH_KEY, isEnabled);
  syncVoiceScoreSpeechToggle();
  if (!isEnabled) stopVoiceScoreSpeech();
  return isEnabled;
}

function stopVoiceScoreSpeech() {
  if (isVoiceScoreSpeechSupported()) window.speechSynthesis.cancel();
}

// iOS only lets a page speak once speechSynthesis has been used inside a user
// gesture, so the first mic release speaks a silent utterance.
function primeVoiceScoreSpeech() {
  if (voiceScoreSpeechPrimed || !isVoiceScoreSpeechSupported() || !isVoiceScoreSpeechEnabled()) return false;
  voiceScoreSpeechPrimed = true;
  const utterance = new window.SpeechSynthesisUtterance(" ");
  utterance.volume = 0;
  window.speechSynthesis.speak(utterance);
  return true;
}

function speakVoiceScoreReply(text) {
  const message = String(text || "").trim();
  if (!message || !isVoiceScoreSpeechSupported() || !isVoiceScoreSpeechEnabled()) return false;
  // An open (even muted) microphone can route iOS audio to the quiet earpiece,
  // so release the idle stream before speaking. The next press reopens it.
  if (!voiceScoreRecorder) stopVoiceScoreRecorderStream();
  const utterance = new window.SpeechSynthesisUtterance(message.slice(0, 300));
  utterance.rate = 1.05;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return true;
}

// --- Status and controls ---
function getVoiceScoreHost() {
  if (typeof document === "undefined" || !document.body) return null;
  let host = document.getElementById(VOICE_SCORE_HOST_ID);
  if (!host && typeof document.createElement === "function") {
    // The mic lives outside #app so it stays usable while panels and dialogs
    // blur the app behind them.
    host = document.createElement("div");
    host.id = VOICE_SCORE_HOST_ID;
    document.body.appendChild(host);
  }
  return host;
}

function refreshVoiceScoreControls() {
  const host = getVoiceScoreHost();
  if (!host) return;
  const markup = renderVoiceScoreControls();
  if (host === voiceScoreRenderedHost && markup === voiceScoreRenderedMarkup) return;
  host.innerHTML = markup;
  voiceScoreRenderedHost = host;
  voiceScoreRenderedMarkup = markup;
}

// autoClear: true uses the default delay, a number sets the delay in ms, and
// false keeps the message until the next status.
function setVoiceScoreStatus(message, tone = "info", autoClear = true) {
  voiceScoreStatus = message || "";
  voiceScoreStatusTone = tone;
  if (voiceScoreStatusTimer) {
    clearTimeout(voiceScoreStatusTimer);
    voiceScoreStatusTimer = null;
  }
  if (voiceScoreStatus && autoClear) {
    const messageSnapshot = voiceScoreStatus;
    voiceScoreStatusTimer = setTimeout(() => {
      if (voiceScoreStatus === messageSnapshot) {
        voiceScoreStatus = "";
        voiceScoreStatusTone = "info";
        refreshVoiceScoreControls();
      }
    }, typeof autoClear === "number" ? autoClear : VOICE_SCORE_STATUS_TIMEOUT_MS);
  }
  refreshVoiceScoreControls();
}

// Shows a final reply long enough to read and speaks it when replies are on.
function reportVoiceScoreOutcome(message, tone = "info") {
  const text = String(message || "").trim();
  const readingMs = Math.min(VOICE_SCORE_STATUS_MAX_TIMEOUT_MS, Math.max(VOICE_SCORE_STATUS_TIMEOUT_MS, text.length * 70));
  setVoiceScoreStatus(text, tone, readingMs);
  speakVoiceScoreReply(text);
}

// --- Endpoint and recording ---
function shouldPreferRecordedVoiceScoreEntry({
  hasGetUserMedia = typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices)
    && typeof navigator.mediaDevices.getUserMedia === "function",
  hasMediaRecorder = typeof window !== "undefined" && typeof window.MediaRecorder === "function",
} = {}) {
  return Boolean(hasGetUserMedia && hasMediaRecorder);
}

function getVoiceScoreCommandUrl() {
  if (typeof window === "undefined" || !window.location) return SAME_ORIGIN_VOICE_SCORE_COMMAND_URL;
  return VOICE_SCORE_GITHUB_PAGES_HOSTNAMES.has(window.location.hostname)
    ? VERCEL_VOICE_SCORE_COMMAND_URL
    : SAME_ORIGIN_VOICE_SCORE_COMMAND_URL;
}

// Wakes the planner function and opens its connection while the user is still
// speaking, so the upload doesn't pay for a cold start.
function warmVoiceScoreEndpoint(now = Date.now()) {
  if (typeof fetch !== "function" || now - voiceScoreLastWarmAt < VOICE_SCORE_WARM_INTERVAL_MS) return false;
  voiceScoreLastWarmAt = now;
  fetch(getVoiceScoreCommandUrl(), { method: "GET", cache: "no-store" }).catch(() => {});
  return true;
}

function getVoiceScoreRecordingMimeType() {
  if (typeof window === "undefined" || typeof window.MediaRecorder !== "function") return "";
  const candidates = [
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/webm;codecs=opus",
    "audio/webm",
  ];
  if (typeof window.MediaRecorder.isTypeSupported !== "function") return "";
  return candidates.find(type => window.MediaRecorder.isTypeSupported(type)) || "";
}

function getVoiceScoreAudioConstraints() {
  return {
    audio: {
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 16000 },
    },
  };
}

async function requestVoiceScoreMicrophonePermission() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    throw new Error("Microphone access is not supported in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia(getVoiceScoreAudioConstraints());
  stopVoiceScoreRecorderStream(stream);
  return true;
}

function getVoiceScoreRecorderOptions(mimeType = "") {
  return {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: VOICE_SCORE_AUDIO_BITS_PER_SECOND,
  };
}

function createVoiceScoreMediaRecorder(stream, mimeType = "") {
  try {
    return new window.MediaRecorder(stream, getVoiceScoreRecorderOptions(mimeType));
  } catch {
    const compatibilityOptions = mimeType ? { mimeType } : undefined;
    return new window.MediaRecorder(stream, compatibilityOptions);
  }
}

// --- Planner context ---
function getVoiceScoreCurrentDealer() {
  if (!Array.isArray(state.dealers) || !state.dealers.length) return "";
  const totalDeals = (Array.isArray(state.rounds) ? state.rounds.length : 0) + (state.misdealCount || 0);
  return state.dealers[totalDeals % state.dealers.length] || "";
}

function getVoiceScoreLibraryContext(storageKey) {
  const games = getLocalStorage(storageKey, []);
  const entries = Array.isArray(games)
    ? games.map((game, index) => ({ game, index })).filter(entry => entry.game && typeof entry.game === "object")
    : [];
  const selectedSort = document.getElementById("gameSortSelect")?.value;
  const sortedEntries = sortGamesBy(entries, ["newest", "oldest", "highest", "lowest"].includes(selectedSort) ? selectedSort : "newest");

  return sortedEntries.slice(0, VOICE_SCORE_LIBRARY_CONTEXT_LIMIT).map(({ game, index }, positionIndex) => {
    const lastRound = Array.isArray(game.rounds) ? game.rounds[game.rounds.length - 1] : null;
    const entry = {
      position: positionIndex + 1,
      index,
      us: getGameTeamDisplay(game, "us"),
      dem: getGameTeamDisplay(game, "dem"),
      score: sanitizeTotals(game.finalScore || lastRound?.runningTotals || game.startingTotals),
    };
    if (typeof game.timestamp === "string" && game.timestamp) entry.date = game.timestamp.slice(0, 10);
    const name = typeof game.name === "string" ? game.name.trim().slice(0, 80) : "";
    if (name) entry.name = name;
    return entry;
  });
}

// Players are sent as names and teams as [name, name] ({players, name} for a
// custom team name); the planner copies these into entityKey.
function getVoiceScoreStatisticsContext() {
  const statistics = getStatistics();
  return {
    players: statistics.playersData
      .slice(0, VOICE_SCORE_STATISTICS_CONTEXT_LIMIT)
      .map(entity => entity.name)
      .filter(Boolean),
    teams: statistics.teamsData.slice(0, VOICE_SCORE_STATISTICS_CONTEXT_LIMIT).map(entity => {
      const players = ensurePlayersArray(entity.players).filter(Boolean);
      return entity.name && entity.name !== formatTeamDisplay(players)
        ? { players, name: entity.name }
        : players;
    }),
  };
}

function getVoiceScoreOpenPanels() {
  return Array.from(document.querySelectorAll(".modal:not(.hidden)"))
    .map(panel => panel.id)
    .filter(Boolean);
}

function getVoiceScoreWinProbability() {
  if (!Array.isArray(state.rounds) || !state.rounds.length || state.gameOver) return null;
  try {
    const probability = getWinProbability(state, getLocalStorage("savedGames", []));
    return { us: Math.round(probability.us), dem: Math.round(probability.dem) };
  } catch {
    return null;
  }
}

function getVoiceScoreAppContext() {
  const totals = getCurrentTotals();
  const recentRounds = Array.isArray(state.rounds)
    ? state.rounds.slice(-5).map(round => ({
        roundIndex: round.roundIndex,
        biddingTeam: round.biddingTeam,
        bidAmount: round.bidAmount,
        usPoints: round.usPoints,
        demPoints: round.demPoints,
        runningTotals: round.runningTotals,
      }))
    : [];

  return {
    teams: {
      us: { label: state.usTeamName || "Us", players: ensurePlayersArray(state.usPlayers) },
      dem: { label: state.demTeamName || "Dem", players: ensurePlayersArray(state.demPlayers) },
    },
    totals,
    roundNumber: (Array.isArray(state.rounds) ? state.rounds.length : 0) + 1,
    gameOver: Boolean(state.gameOver),
    winner: state.winner || null,
    victoryMethod: state.victoryMethod || null,
    biddingTeam: state.biddingTeam || "",
    bidAmount: state.bidAmount || "",
    enterBidderPoints: Boolean(state.enterBidderPoints),
    dealers: Array.isArray(state.dealers) ? state.dealers : [],
    currentDealer: getVoiceScoreCurrentDealer(),
    misdealCount: state.misdealCount || 0,
    undoneRoundsCount: Array.isArray(state.undoneRounds) ? state.undoneRounds.length : 0,
    recentRounds,
    winProbability: getVoiceScoreWinProbability(),
    bidPresets: presetBids.filter(bid => Number.isFinite(Number(bid))).map(Number),
    library: {
      completed: getVoiceScoreLibraryContext("savedGames"),
      freezer: getVoiceScoreLibraryContext("freezerGames"),
    },
    statistics: getVoiceScoreStatisticsContext(),
    ui: {
      menuOpen: Boolean(document.getElementById("menu")?.classList.contains("show")),
      openPanels: getVoiceScoreOpenPanels(),
    },
    settings: {
      mustWinByBid: Boolean(getLocalStorage(MUST_WIN_BY_BID_KEY, false)),
      misdealHandling: Boolean(getLocalStorage(MISDEAL_HANDLING_KEY, false)),
      proMode: Boolean(getLocalStorage(PRO_MODE_KEY, false)),
      experimentalFeatures: isExperimentalFeaturesEnabled(),
      spokenReplies: isVoiceScoreSpeechEnabled(),
      tableTalkPenaltyType: getLocalStorage(TABLE_TALK_PENALTY_TYPE_KEY, "setPoints"),
      tableTalkPenaltyPoints: Number(getLocalStorage(TABLE_TALK_PENALTY_POINTS_KEY, "180")) || 180,
    },
  };
}

function normalizeVoiceScorePlan(plan) {
  const candidate = plan && typeof plan === "object" ? plan : {};
  let actions = Array.isArray(candidate.actions)
    ? candidate.actions.filter(action => action && VOICE_SCORE_ACTION_TYPES.has(action.type)).slice(0, 5)
    : [];
  let status = VOICE_SCORE_PLAN_STATUSES.has(candidate.status)
    ? candidate.status
    : actions.length
      ? "execute"
      : "clarify";
  // Mirrors the server: answers never act, and "act" needs a runnable action.
  if (status === "answer") actions = [];
  if ((status === "execute" || status === "confirm") && !actions.length) status = "clarify";

  return {
    status,
    summary: typeof candidate.summary === "string" ? candidate.summary : "",
    message: typeof candidate.message === "string" ? candidate.message : "",
    requiresConfirmation: actions.length > 0 && Boolean(candidate.requiresConfirmation || status === "confirm"),
    heardText: String(candidate.heardText || "").trim().slice(0, 1000),
    actions,
    ...(typeof candidate.plannerModel === "string"
      ? { plannerModel: candidate.plannerModel.slice(0, 120) }
      : {}),
    ...(typeof candidate.plannerRevision === "string"
      ? { plannerRevision: candidate.plannerRevision.slice(0, 80) }
      : {}),
  };
}

// Fills the aliases models commonly use (team for biddingTeam and back) and the
// default enterBidderPoints, for execution and training samples alike.
function normalizeVoiceScoreActionAliases(action) {
  const fields = VOICE_TOOLS.actions[action?.type] || [];
  const normalized = { ...action };
  if (fields.includes("biddingTeam") && !normalized.biddingTeam) normalized.biddingTeam = action.team;
  if (fields.includes("team") && !normalized.team) normalized.team = action.biddingTeam;
  if (fields.includes("enterBidderPoints")) normalized.enterBidderPoints = action.enterBidderPoints !== false;
  return normalized;
}

// --- Voice improvement samples ---
function getVoiceScoreStatisticsTeamPlayers(team) {
  return Array.isArray(team) ? team : Array.isArray(team?.players) ? team.players : [];
}

function buildVoiceImprovementIdentityMap(context = getVoiceScoreAppContext(), actions = []) {
  const playerTokensByName = new Map();
  const playerNamesByToken = new Map();
  const teamReplacements = [];
  const addPlayer = (value) => {
    const cleanValue = sanitizePlayerName(value);
    const normalized = cleanValue.toLowerCase();
    if (!cleanValue || playerTokensByName.has(normalized)) {
      return playerTokensByName.get(normalized) || "";
    }
    const token = `Player ${playerTokensByName.size + 1}`;
    playerTokensByName.set(normalized, token);
    playerNamesByToken.set(token, cleanValue);
    return token;
  };

  [
    ...(context.teams?.us?.players || []),
    ...(context.teams?.dem?.players || []),
  ].forEach(addPlayer);
  (context.statistics?.players || []).forEach(player => addPlayer(typeof player === "string" ? player : player?.name));

  const teamEntityKeys = new Map();
  const statisticsTeams = [];
  (context.statistics?.teams || []).slice(0, VOICE_SCORE_STATISTICS_CONTEXT_LIMIT).forEach((team, index) => {
    const names = getVoiceScoreStatisticsTeamPlayers(team);
    const players = names.map(addPlayer).filter(Boolean).slice(0, 2);
    const safeKey = `team-${index + 1}`;
    if (names.length) {
      teamEntityKeys.set(buildTeamKey(names), safeKey);
      teamEntityKeys.set(names.map(name => sanitizePlayerName(name).toLowerCase()).join(TEAM_KEY_SEPARATOR), safeKey);
    }
    statisticsTeams.push({ key: safeKey, players });
  });

  actions.forEach(action => {
    [
      ...(Array.isArray(action?.dealers) ? action.dealers : []),
      ...(Array.isArray(action?.usPlayers) ? action.usPlayers : []),
      ...(Array.isArray(action?.demPlayers) ? action.demPlayers : []),
      action?.firstDealer,
    ].forEach(addPlayer);
  });

  [
    { value: context.teams?.us?.label, replacement: "Us team" },
    { value: context.teams?.dem?.label, replacement: "Dem team" },
  ].forEach(({ value, replacement }) => {
    const cleanValue = sanitizePlayerName(value);
    if (cleanValue && !/^(us|dem)$/i.test(cleanValue)) {
      teamReplacements.push({ value: cleanValue, replacement });
    }
  });

  const replacements = [
    ...teamReplacements,
    ...Array.from(playerTokensByName.entries()).map(([normalized, replacement]) => ({
      value: playerNamesByToken.get(replacement) || normalized,
      replacement,
    })),
  ].sort((left, right) => right.value.length - left.value.length);

  return {
    replacements,
    playerTokensByName,
    teamEntityKeys,
    knownPlayers: Array.from(playerNamesByToken.keys()).slice(0, 100),
    statisticsTeams,
  };
}

function redactVoiceImprovementText(text, identityMap) {
  let redacted = String(text || "")
    .trim()
    .slice(0, 1000)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g, "[phone]");

  identityMap.replacements.forEach(({ value, replacement }) => {
    redacted = redacted.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), replacement);
  });
  return redacted.trim().slice(0, 1000);
}

function redactVoiceImprovementPrompt(prompt) {
  return redactVoiceImprovementText(
    prompt,
    buildVoiceImprovementIdentityMap(getVoiceScoreAppContext()),
  );
}

function getVoiceImprovementPlayerToken(value, identityMap) {
  const normalized = sanitizePlayerName(value).toLowerCase();
  return identityMap.playerTokensByName.get(normalized) || "";
}

function sanitizeVoiceImprovementNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeVoiceImprovementEntityKey(action, identityMap) {
  const rawKey = String(action.entityKey || "").trim().toLowerCase();
  if (!rawKey) return undefined;
  if (action.entityMode === "teams" || action.statsView === "teams" || rawKey.includes(TEAM_KEY_SEPARATOR)) {
    return identityMap.teamEntityKeys.get(rawKey)
      || identityMap.teamEntityKeys.get(buildTeamKey(rawKey.split(TEAM_KEY_SEPARATOR)));
  }
  const token = identityMap.playerTokensByName.get(rawKey);
  return token ? `player-${token.replace("Player ", "")}` : undefined;
}

// Copies one registry field into a training sample, replacing names with
// placeholders and dropping anything that doesn't fit the field's kind.
function sanitizeVoiceImprovementField(name, action, identityMap) {
  const field = VOICE_TOOLS.fields[name];
  const value = action[name];
  if (field.kind === "enum") return field.schema.enum.includes(value) ? value : undefined;
  if (field.kind === "number") return sanitizeVoiceImprovementNumber(value) ?? undefined;
  if (field.kind === "boolean") return typeof value === "boolean" ? value : undefined;
  if (field.kind === "color") return /^#[0-9a-f]{6}$/i.test(value || "") ? value.toLowerCase() : undefined;
  if (field.kind === "player") return getVoiceImprovementPlayerToken(value, identityMap) || undefined;
  if (field.kind === "text") {
    return typeof value === "string" ? redactVoiceImprovementText(value, identityMap).slice(0, 100) : undefined;
  }
  if (field.kind === "entityKey") return sanitizeVoiceImprovementEntityKey(action, identityMap);
  if (field.kind === "settingValue") {
    if (typeof value === "boolean") return value;
    if (sanitizeVoiceImprovementNumber(value) !== null) return Number(value);
    return value === "loseBid" || value === "setPoints" ? value : undefined;
  }
  const list = (Array.isArray(value) ? value : []).slice(0, field.schema.maxItems);
  const safeList = field.kind === "players"
    ? list.map(item => getVoiceImprovementPlayerToken(item, identityMap)).filter(Boolean)
    : list.map(Number).filter(Number.isFinite);
  return safeList.length ? safeList : undefined;
}

function sanitizeVoiceImprovementAction(action, identityMap) {
  if (!action || !VOICE_SCORE_ACTION_TYPES.has(action.type)) return null;
  const source = normalizeVoiceScoreActionAliases(action);
  const safe = { type: action.type };
  VOICE_TOOLS.actions[action.type].forEach(name => {
    const value = sanitizeVoiceImprovementField(name, source, identityMap);
    if (value !== undefined) safe[name] = value;
  });
  return safe;
}

function sanitizeVoiceImprovementRound(round) {
  const safe = {};
  ["roundIndex", "bidAmount", "usPoints", "demPoints"].forEach(key => {
    const number = sanitizeVoiceImprovementNumber(round?.[key]);
    if (number !== null) safe[key] = number;
  });
  if (round?.biddingTeam === "us" || round?.biddingTeam === "dem") {
    safe.biddingTeam = round.biddingTeam;
  }
  safe.runningTotals = sanitizeTotals(round?.runningTotals);
  return safe;
}

function sanitizeVoiceImprovementContext(context, identityMap) {
  const biddingTeam = context.biddingTeam === "us" || context.biddingTeam === "dem"
    ? context.biddingTeam
    : "";
  const bidAmount = sanitizeVoiceImprovementNumber(context.bidAmount);
  const currentDealer = getVoiceImprovementPlayerToken(context.currentDealer, identityMap);
  const openPanels = (Array.isArray(context.ui?.openPanels) ? context.ui.openPanels : [])
    .filter(value => typeof value === "string" && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(value))
    .slice(0, 20);
  const sanitizeLibraryIndexes = (entries) => (Array.isArray(entries) ? entries : [])
    .map(entry => Number(entry?.index))
    .filter(value => Number.isInteger(value) && value >= 0)
    .slice(0, 20);
  const teamPlayerTokens = players => (players || [])
    .map(value => getVoiceImprovementPlayerToken(value, identityMap))
    .filter(Boolean)
    .slice(0, 2);

  return {
    teams: {
      us: { label: "Us team", players: teamPlayerTokens(context.teams?.us?.players) },
      dem: { label: "Dem team", players: teamPlayerTokens(context.teams?.dem?.players) },
    },
    knownPlayers: identityMap.knownPlayers,
    totals: sanitizeTotals(context.totals),
    roundNumber: Math.max(1, Math.trunc(Number(context.roundNumber) || 1)),
    gameOver: Boolean(context.gameOver),
    winner: context.winner === "us" || context.winner === "dem" ? context.winner : "",
    biddingTeam,
    hasActiveBid: Boolean(biddingTeam && bidAmount !== null && bidAmount !== 0),
    bidAmount: bidAmount === null ? 0 : bidAmount,
    enterBidderPoints: Boolean(context.enterBidderPoints),
    dealers: (Array.isArray(context.dealers) ? context.dealers : [])
      .map(value => getVoiceImprovementPlayerToken(value, identityMap))
      .filter(Boolean)
      .slice(0, 4),
    currentDealer,
    misdealCount: Math.max(0, Math.trunc(Number(context.misdealCount) || 0)),
    undoneRoundsCount: Math.max(0, Math.trunc(Number(context.undoneRoundsCount) || 0)),
    recentRounds: (Array.isArray(context.recentRounds) ? context.recentRounds : [])
      .slice(-5)
      .map(sanitizeVoiceImprovementRound),
    bidPresets: (Array.isArray(context.bidPresets) ? context.bidPresets : [])
      .map(Number)
      .filter(Number.isFinite)
      .slice(0, 12),
    library: {
      completedIndexes: sanitizeLibraryIndexes(context.library?.completed),
      freezerIndexes: sanitizeLibraryIndexes(context.library?.freezer),
    },
    statistics: {
      playerTokens: (context.statistics?.players || [])
        .map(player => getVoiceImprovementPlayerToken(typeof player === "string" ? player : player?.name, identityMap))
        .filter(Boolean)
        .slice(0, 100),
      teams: identityMap.statisticsTeams,
    },
    ui: {
      menuOpen: Boolean(context.ui?.menuOpen),
      openPanels,
    },
    settings: {
      mustWinByBid: Boolean(context.settings?.mustWinByBid),
      misdealHandling: Boolean(context.settings?.misdealHandling),
      proMode: Boolean(context.settings?.proMode),
      experimentalFeatures: Boolean(context.settings?.experimentalFeatures),
      tableTalkPenaltyType: context.settings?.tableTalkPenaltyType === "loseBid"
        ? "loseBid"
        : "setPoints",
      tableTalkPenaltyPoints: Number(context.settings?.tableTalkPenaltyPoints) || 180,
    },
  };
}

function createVoiceImprovementSnapshot(plan, context = getVoiceScoreAppContext()) {
  const normalizedPlan = normalizeVoiceScorePlan(plan);
  const identityMap = buildVoiceImprovementIdentityMap(context, normalizedPlan.actions);
  return {
    normalizedPlan,
    identityMap,
    context: sanitizeVoiceImprovementContext(context, identityMap),
  };
}

function buildVoiceImprovementSample(plan, outcome, snapshot = null) {
  const prepared = snapshot || createVoiceImprovementSnapshot(plan);
  const { normalizedPlan, identityMap } = prepared;
  const prompt = redactVoiceImprovementText(normalizedPlan.heardText, identityMap);
  if (!prompt) return null;

  return {
    prompt,
    context: prepared.context,
    target: {
      status: normalizedPlan.status,
      requiresConfirmation: Boolean(normalizedPlan.requiresConfirmation),
      actions: normalizedPlan.actions
        .map(action => sanitizeVoiceImprovementAction(action, identityMap))
        .filter(Boolean)
        .slice(0, 5),
    },
    outcome: String(outcome || "failed").slice(0, 40),
    model: String(normalizedPlan.plannerModel || "unknown").slice(0, 120),
    revision: String(normalizedPlan.plannerRevision || "unknown").slice(0, 80),
    appVersion: String(APP_VERSION || "").slice(0, 40),
  };
}

function recordVoiceImprovementSample(plan, outcome, snapshot = null) {
  if (!isExperimentalFeaturesEnabled()
      || !isVoiceImprovementOptedIn()
      || typeof window.logVoiceImprovementSample !== "function") {
    return false;
  }
  const sample = buildVoiceImprovementSample(plan, outcome, snapshot);
  if (!sample) return false;

  Promise.resolve(window.logVoiceImprovementSample(sample))
    .catch(error => console.warn("Voice improvement sample was not saved.", error));
  return true;
}

// --- Conversation memory ---
function getVoiceScoreConversation() {
  return voiceScoreConversation.map(message => ({ ...message }));
}

function clearVoiceScoreConversation() {
  voiceScoreConversation = [];
}

// Keeps clarification questions and answers so a short follow-up ("Carol",
// "and theirs?") can finish the same request. Any action clears the memory.
function updateVoiceScoreConversation(plan, transcript) {
  const normalizedPlan = normalizeVoiceScorePlan(plan);
  if (normalizedPlan.status !== "clarify" && normalizedPlan.status !== "answer") {
    clearVoiceScoreConversation();
    return getVoiceScoreConversation();
  }

  const cleanTranscript = String(transcript || "").trim().slice(0, 1000);
  const reply = String(normalizedPlan.message || normalizedPlan.summary || "Say that another way.")
    .trim()
    .slice(0, 1000);
  if (!cleanTranscript || !reply) return getVoiceScoreConversation();

  voiceScoreConversation = [
    ...voiceScoreConversation,
    { role: "user", content: cleanTranscript },
    { role: "assistant", content: reply },
  ].slice(-VOICE_SCORE_CONVERSATION_MAX_MESSAGES);
  return getVoiceScoreConversation();
}

function getVoiceScoreAudioFilename(mimeType) {
  const normalizedMimeType = String(mimeType || "").split(";")[0].trim().toLowerCase();
  const extension = {
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/aac": "aac",
  }[normalizedMimeType] || "webm";
  return `rook-voice-score.${extension}`;
}

// input is recorded audio ({ audioBlob }) or, for testing, a text transcript.
async function requestVoiceScoreActionPlan(input, options = {}) {
  const { context = getVoiceScoreAppContext(), signal } = options || {};
  const conversation = getVoiceScoreConversation();
  const transcript = (typeof input === "string" ? input : String(input?.transcript || "")).trim();
  const audioBlob = typeof input?.audioBlob?.size === "number" ? input.audioBlob : null;
  const headers = { Accept: "application/json" };
  let body;

  if (audioBlob && typeof FormData === "function") {
    body = new FormData();
    body.append("context", JSON.stringify(context));
    body.append("conversation", JSON.stringify(conversation));
    if (transcript) body.append("transcript", transcript);
    body.append(
      "audio",
      audioBlob,
      getVoiceScoreAudioFilename(audioBlob.type || input.mimeType || "audio/webm"),
    );
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ context, conversation, ...(transcript ? { transcript } : {}) });
  }

  const response = await fetch(getVoiceScoreCommandUrl(), {
    method: "POST",
    headers,
    body,
    ...(signal ? { signal } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Voice command planning failed with HTTP ${response.status}.`);
  }
  return normalizeVoiceScorePlan(payload.plan);
}

// --- Action handlers ---
function getVoiceScoreModalHandlers(target) {
  return {
    savedGames: { open: openSavedGamesModal, close: closeSavedGamesModal },
    settings: { open: openSettingsModal, close: closeSettingsModal },
    about: { open: openAboutModal, close: closeAboutModal },
    statistics: { open: openStatisticsModal, close: closeStatisticsModal },
    dealerOrder: { open: openDealerOrderModal, close: closeDealerOrderModal },
    teamSelection: { open: openTeamSelectionModal, close: closeTeamSelectionModal },
    resumeGame: { open: openResumeGameModal, close: closeResumeGameModal },
    theme: { open: () => openThemeModal(null), close: () => closeThemeModal(null) },
    presets: { open: openPresetEditorModal, close: closePresetEditorModal },
    probability: { open: openProbabilityModal, close: closeProbabilityModal },
    version: { open: showVersionNum, close: closeVersionInfoModal },
    bugReport: { open: openBugReportModal, close: closeBugReportModal },
    confirmation: { open: () => {}, close: closeConfirmationModal },
  }[target] || null;
}

function isVoiceScorePanelOpen(id) {
  const panel = document.getElementById(id);
  return Boolean(panel) && !panel.classList.contains("hidden");
}

function closeVoiceScoreModalTarget(target) {
  if (!target || target === "all") {
    // Closing Theme or Bid Presets reopens Settings, so close children first
    // and only touch those panels (and Settings, which saves) when open.
    [
      ["themeModal", () => closeThemeModal(null)],
      ["presetEditorModal", closePresetEditorModal],
      ["settingsModal", closeSettingsModal],
    ].forEach(([id, closeHandler]) => {
      try {
        if (isVoiceScorePanelOpen(id)) closeHandler();
      } catch {}
    });
    [
      () => closeModal("viewSavedGameModal"),
      closeEntityStatisticsModal,
      closeSavedGamesModal,
      closeAboutModal,
      closeStatisticsModal,
      closeDealerOrderModal,
      closeTeamSelectionModal,
      closeResumeGameModal,
      closeProbabilityModal,
      closeVersionInfoModal,
      closeBugReportModal,
      closeConfirmationModal,
      closeNoticeModal,
      closeTableTalkModal,
      closeDealerPairSelectionModal,
      () => closeRematchDealerModal(false),
      () => closeModal("zeroPointsModal"),
    ].forEach(closeHandler => {
      try {
        closeHandler();
      } catch {}
    });
    return true;
  }

  const handlers = getVoiceScoreModalHandlers(target);
  if (!handlers || typeof handlers.close !== "function") throw new Error("That app panel cannot be closed by voice.");
  handlers.close();
  return true;
}

function sanitizeVoiceScoreDealers(dealers) {
  const cleaned = Array.isArray(dealers)
    ? dealers.map(sanitizePlayerName).filter(Boolean)
    : [];
  if (cleaned.length !== 4) throw new Error("Say four dealer names.");
  if (hasDuplicateDealerNames(cleaned)) throw new Error("Each dealer needs a different name.");
  return cleaned;
}

function normalizeVoiceScoreActionTeam(team) {
  if (team === "us" || team === "dem") return team;
  throw new Error("Say either Us or Dem.");
}

function submitVoiceScoreHand(action) {
  const submitted = submitStructuredRound({
    biddingTeam: normalizeVoiceScoreActionTeam(action.biddingTeam),
    bidAmount: Number(action.bidAmount),
    points: Number(action.points),
    enterBidderPoints: action.enterBidderPoints !== false,
    source: "voice_llm",
  });
  if (!submitted) throw new Error(state.error || "The score could not be recorded.");
}

function applyVoiceScoreRound(action) {
  if (state.gameOver) throw new Error("This game is over. Start a rematch or a new game first.");
  submitVoiceScoreHand(action);
  showSaveIndicator("Voice score recorded");
  return "Voice score recorded.";
}

// Replaces the most recent hand: undo it, record the corrected hand, and put
// the original back if the correction is rejected.
function applyVoiceScoreReplaceLastRound(action) {
  if (!state.rounds.length) throw new Error("There is no hand to correct yet.");
  normalizeVoiceScoreActionTeam(action.biddingTeam);
  const validationError = validateBid(String(Number(action.bidAmount))) || validatePoints(String(Number(action.points)));
  if (validationError) throw new Error(validationError);

  // Undoing the only hand resets the game timer, so keep the running clock.
  const timerSnapshot = state.rounds.length === 1
    ? Object.fromEntries(VOICE_SCORE_TIMER_KEYS.map(key => [key, state[key]]))
    : null;
  handleUndo();
  try {
    submitVoiceScoreHand(action);
  } catch (error) {
    updateState({ error: "" });
    handleRedo();
    throw error;
  }
  if (timerSnapshot) {
    updateState(timerSnapshot);
    saveCurrentGameState();
  }
  showSaveIndicator("Last hand corrected");
  return "Last hand corrected.";
}

function applyVoiceScoreSelectBid(action) {
  const biddingTeam = normalizeVoiceScoreActionTeam(action.biddingTeam);
  const bidAmount = Number(action.bidAmount);
  const bidError = validateBid(String(bidAmount));
  if (bidError) throw new Error(bidError);
  updateState({
    biddingTeam,
    bidAmount: String(bidAmount),
    showCustomBid: !presetBids.includes(bidAmount),
    customBidValue: presetBids.includes(bidAmount) ? "" : String(bidAmount),
    enterBidderPoints: true,
    error: "",
    lastBidAmount: String(bidAmount),
    lastBidTeam: biddingTeam,
  });
  saveCurrentGameState();
  return `${getVoiceScoreTeamLabel(biddingTeam)} bid ${bidAmount}.`;
}

function applyVoiceScoreSetting(action) {
  const key = action.key;
  const value = action.value;
  if (key === "mustWinByBid" || key === "misdealHandling") {
    const isEnabled = toVoiceScoreBoolean(value);
    setLocalStorage(key === "mustWinByBid" ? MUST_WIN_BY_BID_KEY : MISDEAL_HANDLING_KEY, isEnabled);
    showSaveIndicator("Settings Saved");
    const label = key === "mustWinByBid" ? "Must win by bid" : "Misdeal handling";
    return `${label} is ${isEnabled ? "on" : "off"}.`;
  }
  if (key === "proMode") {
    const isPro = toVoiceScoreBoolean(value);
    setLocalStorage(PRO_MODE_KEY, isPro);
    updateProModeUI(isPro);
    saveCurrentGameState();
    showSaveIndicator("Settings Saved");
    return isPro ? "Pro mode is on." : "Pro mode is off.";
  }
  if (key === "experimentalFeatures") {
    const isEnabled = toVoiceScoreBoolean(value);
    toggleExperimentalFeatures({ checked: isEnabled });
    return isEnabled ? "Experimental features are on." : "Experimental features are off.";
  }
  if (key === "spokenReplies") {
    return setVoiceScoreSpeechEnabled(toVoiceScoreBoolean(value))
      ? "Spoken replies are on."
      : "Spoken replies are off.";
  }
  if (key === "tableTalkPenaltyType") {
    const penaltyType = value === "loseBid" ? "loseBid" : "setPoints";
    setLocalStorage(TABLE_TALK_PENALTY_TYPE_KEY, penaltyType);
    return penaltyType === "loseBid" ? "Table talk penalty uses lost bid." : "Table talk penalty uses set points.";
  }
  if (key === "tableTalkPenaltyPoints") {
    let points = Number(value);
    if (!Number.isFinite(points)) points = 180;
    points = Math.max(5, Math.min(500, Math.round(points / 5) * 5));
    setLocalStorage(TABLE_TALK_PENALTY_POINTS_KEY, String(points));
    return `Table talk penalty is ${points} points.`;
  }
  throw new Error("That setting is not available.");
}

function applyVoiceScoreStartPaperGame(action) {
  const usScore = Number(action.usScore);
  const demScore = Number(action.demScore);
  if (!Number.isFinite(usScore) || !Number.isFinite(demScore)) throw new Error("Say both starting scores.");
  if (Math.abs(usScore) > 1000 || Math.abs(demScore) > 1000) throw new Error("Scores should stay between -1000 and 1000.");
  if (Math.abs(usScore % 5) >= 1e-9 || Math.abs(demScore % 5) >= 1e-9) throw new Error("Scores must be in increments of 5.");

  const updates = {
    ...DEFAULT_STATE,
    startingTotals: sanitizeTotals({ us: usScore, dem: demScore }),
    showWinProbability: Boolean(getLocalStorage(PRO_MODE_KEY, false)),
    usPlayers: ensurePlayersArray(action.usPlayers || state.usPlayers),
    demPlayers: ensurePlayersArray(action.demPlayers || state.demPlayers),
    dealers: Array.isArray(state.dealers) ? state.dealers : [],
    misdealCount: state.misdealCount || 0,
  };
  updates.usTeamName = deriveTeamDisplay(updates.usPlayers, state.usTeamName || "Us");
  updates.demTeamName = deriveTeamDisplay(updates.demPlayers, state.demTeamName || "Dem");

  resetRenderAnimationState();
  updateState(updates);
  confettiTriggered = false;
  saveCurrentGameState();
  showSaveIndicator("Starting scores set!");
  return `Started paper game at ${usScore} to ${demScore}.`;
}

function applyVoiceScoreSetTeams(action) {
  const usPlayers = ensurePlayersArray(action.usPlayers || state.usPlayers);
  const demPlayers = ensurePlayersArray(action.demPlayers || state.demPlayers);
  if (usPlayers.some(player => !player) || demPlayers.some(player => !player)) {
    throw new Error("Say two players for each team.");
  }
  const allPlayers = [...usPlayers, ...demPlayers];
  if (new Set(allPlayers.map(player => player.toLowerCase())).size !== 4) {
    throw new Error("Each player needs a different name.");
  }
  if (buildTeamKey(usPlayers) === buildTeamKey(demPlayers)) {
    throw new Error("Choose two different teams.");
  }
  const usTeamName = deriveTeamDisplay(usPlayers, "Us");
  const demTeamName = deriveTeamDisplay(demPlayers, "Dem");
  updateState({
    usPlayers,
    demPlayers,
    usTeamName,
    demTeamName,
  });
  addTeamIfNotExists(usPlayers, usTeamName);
  addTeamIfNotExists(demPlayers, demTeamName);
  saveCurrentGameState();
  closeTeamSelectionModal();
  return "Teams updated.";
}

function applyVoiceScoreEditRound(action) {
  const roundNumber = Math.trunc(Number(action.roundNumber));
  const rounds = Array.isArray(state.rounds) ? state.rounds : [];
  if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > rounds.length) {
    throw new Error(`Choose a round from 1 to ${rounds.length || 1}.`);
  }

  const edits = [];
  if (action.bidAmount !== undefined) edits.push(["bid", Number(action.bidAmount)]);
  if (action.usTotal !== undefined) edits.push(["us", Number(action.usTotal)]);
  if (action.demTotal !== undefined) edits.push(["dem", Number(action.demTotal)]);
  if (!edits.length || edits.some(([, value]) => !Number.isFinite(value))) {
    throw new Error("Say the bid or cumulative team total to change.");
  }

  updateState({ error: "" });
  for (const [field, value] of edits) {
    commitHistoryEdit(roundNumber - 1, field, value);
    if (state.error) throw new Error(state.error);
  }
  showSaveIndicator(`Round ${roundNumber} updated`);
  return `Round ${roundNumber} updated.`;
}

function applyVoiceScoreToggleMenu(action) {
  const menu = document.getElementById("menu");
  const shouldOpen = action.open === undefined ? !menu?.classList.contains("show") : Boolean(action.open);
  if (shouldOpen !== Boolean(menu?.classList.contains("show"))) {
    toggleMenu(null);
  }
  return shouldOpen ? "Menu opened." : "Menu closed.";
}

async function applyVoiceScoreAuthAction(action) {
  const authAction = action.authAction || "toggle";
  const signedIn = Boolean(window.firebaseAuth?.currentUser && !window.firebaseAuth.currentUser.isAnonymous);
  if (authAction === "signOut" || (authAction === "toggle" && signedIn)) {
    if (typeof window.signOutUser !== "function") throw new Error("Sign out is not available right now.");
    await window.signOutUser();
    return "Signing out.";
  }
  if (typeof window.signInWithGoogle !== "function") throw new Error("Sign in is not available right now.");
  await window.signInWithGoogle();
  return "Opening sign in.";
}

function applyVoiceScoreConfirmationAction(action) {
  const choice = action.confirmationChoice === "cancel" ? "cancel" : "confirm";
  const modal = document.getElementById("confirmationModal");
  if (!modal || modal.classList.contains("hidden")) throw new Error("There is no confirmation open.");
  const buttonId = choice === "confirm" ? "confirmModalButton" : "noModalButton";
  document.getElementById(buttonId)?.click();
  return choice === "confirm" ? "Confirmed." : "Canceled.";
}

function ensureVoiceScoreGameLibraryOpen(gameType) {
  const modal = document.getElementById("savedGamesModal");
  if (!modal || modal.classList.contains("hidden")) openSavedGamesModal();
  if (gameType === "freezer") switchGamesTab("freezer");
  if (gameType === "completed") switchGamesTab("completed");
}

function applyVoiceScoreGameLibraryAction(action) {
  const gameAction = action.gameAction || "switchTab";
  const gameType = action.gameType === "freezer" || action.tab === "freezer" ? "freezer" : "completed";
  ensureVoiceScoreGameLibraryOpen(gameType);

  if (gameAction === "switchTab") {
    switchGamesTab(gameType);
    return gameType === "freezer" ? "Showing frozen games." : "Showing completed games.";
  }

  if (gameAction === "search") {
    const input = document.getElementById("gameSearchInput");
    if (!input) throw new Error("Game search is not available.");
    input.value = String(action.query || "").slice(0, 100);
    renderGamesWithFilter();
    return input.value ? `Searching games for ${input.value}.` : "Cleared game search.";
  }

  if (gameAction === "sort") {
    const select = document.getElementById("gameSortSelect");
    if (!select) throw new Error("Game sorting is not available.");
    const sort = ["newest", "oldest", "highest", "lowest"].includes(action.sort) ? action.sort : "newest";
    select.value = sort;
    sortGames();
    return "Sorted games.";
  }

  const index = Number(action.index);
  if (!Number.isInteger(index) || index < 0) throw new Error("Say which game number to use.");
  if (gameAction === "view") {
    if (gameType !== "completed") throw new Error("Only completed games can be viewed.");
    viewSavedGame(index);
    return "Opening saved game.";
  }
  if (gameAction === "delete") {
    if (gameType === "freezer") deleteFreezerGame(index);
    else deleteSavedGame(index);
    return "Confirm deleting that game.";
  }
  if (gameAction === "resume") {
    if (gameType !== "freezer") throw new Error("Only frozen games can be resumed.");
    loadFreezerGame(index);
    return "Confirm loading that frozen game.";
  }
  throw new Error("That game-library action is not available.");
}

function applyVoiceScoreThemeColors(action) {
  const usColor = sanitizeHexColor(action.usColor || "");
  const demColor = sanitizeHexColor(action.demColor || "");
  if (!usColor && !demColor) throw new Error("Say a valid hex color.");
  openThemeModal(null);
  const usPicker = document.getElementById("usColorPicker");
  const demPicker = document.getElementById("demColorPicker");
  if (usColor && usPicker) usPicker.value = usColor;
  if (demColor && demPicker) demPicker.value = demColor;
  updatePreview();
  applyCustomThemeColors();
  return "Theme colors updated.";
}

function applyVoiceScoreThemeAction(action) {
  const themeAction = action.themeAction;
  openThemeModal(null);
  if (themeAction === "randomize") {
    randomizeThemeColors();
    applyCustomThemeColors();
    return "Theme colors randomized.";
  }
  if (themeAction === "reset") {
    resetThemeColors();
    applyCustomThemeColors();
    return "Theme colors reset.";
  }
  if (themeAction === "apply") {
    applyCustomThemeColors();
    return "Theme colors applied.";
  }
  throw new Error("That theme action is not available.");
}

function applyVoiceScoreBidPresets(action) {
  const presets = Array.isArray(action.presets)
    ? action.presets.map(Number).filter(Number.isFinite)
    : [];
  if (!presets.length) throw new Error("Say at least one bid preset.");
  setPresetBidsFromValues(presets);
  return "Bid presets updated.";
}

function normalizeVoiceScoreStatisticsLookup(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\|\|/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(?:and|team|players?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveVoiceScoreStatisticsSelection(action = {}) {
  const requestedKey = typeof action.entityKey === "string" ? action.entityKey.trim() : "";
  if (!requestedKey) return null;

  const statistics = getStatistics();
  const requestedMode = action.entityMode === "teams" || action.entityMode === "players"
    ? action.entityMode
    : action.statsView === "teams" || action.statsView === "players"
      ? action.statsView
      : null;
  const modeOrder = requestedMode
    ? [requestedMode, requestedMode === "teams" ? "players" : "teams"]
    : requestedKey.includes("||")
      ? ["teams", "players"]
      : ["players", "teams"];
  const normalizedRequest = normalizeVoiceScoreStatisticsLookup(requestedKey);
  const requestedTeamKey = requestedKey.includes(TEAM_KEY_SEPARATOR)
    ? buildTeamKey(requestedKey.split(TEAM_KEY_SEPARATOR).map(name => name.trim()))
    : "";

  for (const mode of modeOrder) {
    const collection = mode === "teams" ? statistics.teamsData : statistics.playersData;
    const entity = collection.find(candidate => (
      String(candidate.key || "").toLowerCase() === requestedKey.toLowerCase()
      || (mode === "teams" && requestedTeamKey && candidate.key === requestedTeamKey)
      || normalizeVoiceScoreStatisticsLookup(candidate.name) === normalizedRequest
      || (mode === "teams"
        && normalizeVoiceScoreStatisticsLookup(ensurePlayersArray(candidate.players).join(" and ")) === normalizedRequest)
    ));
    if (entity) {
      return {
        mode,
        key: entity.key,
        name: entity.name,
      };
    }
  }

  return null;
}

function applyVoiceScoreStatsControls(action) {
  const metricAliases = {
    bidSuccessPct: "bidMakePct",
    "360s": "perfect360s",
  };
  const entitySelection = resolveVoiceScoreStatisticsSelection(action);
  if (action.entityKey && !entitySelection) {
    throw new Error(`No saved statistics were found for ${action.entityKey}.`);
  }
  openStatisticsModal();
  setStatisticsControls({
    view: entitySelection?.mode || action.statsView,
    metric: metricAliases[action.statsMetric] || action.statsMetric,
    sort: action.statsSort,
    entityMode: entitySelection?.mode,
    entityKey: entitySelection?.key,
  });
  return entitySelection ? `Showing statistics for ${entitySelection.name}.` : "Statistics updated.";
}

function applyVoiceScoreRematch(action) {
  if (action.firstDealer) {
    if (!startRematchWithFirstDealer(action.firstDealer)) {
      throw new Error("Choose one of the current players to deal first.");
    }
    return "Started rematch.";
  }
  openRematchDealerModal();
  return "Choose the first dealer for the rematch.";
}

// Every registry action needs a handler here; a test keeps the two in step.
const VOICE_SCORE_ACTION_HANDLERS = {
  scoreRound: applyVoiceScoreRound,
  replaceLastRound: applyVoiceScoreReplaceLastRound,
  editRound: applyVoiceScoreEditRound,
  undo() {
    if (!state.rounds.length) throw new Error("No hand to undo.");
    handleUndo();
    showSaveIndicator("Last hand undone");
    return "Undid last hand.";
  },
  redo() {
    if (!state.undoneRounds.length) throw new Error("No hand to redo.");
    handleRedo();
    showSaveIndicator("Hand redone");
    return "Redid last hand.";
  },
  misdeal() {
    if (!Array.isArray(state.dealers) || state.dealers.length === 0) throw new Error("Enter a dealing order before using misdeal.");
    handleMisdeal();
    return "Moved to next dealer.";
  },
  newGame(_action, { confirmed }) {
    if (confirmed) {
      resetGame();
      showSaveIndicator("New game started");
      return "New game started.";
    }
    handleNewGame();
    return "Confirm the new game.";
  },
  async freezeGame(_action, { confirmed }) {
    if (confirmed && state.rounds.length && state.usTeamName && state.demTeamName) {
      await freezeCurrentGame();
      return "Game frozen.";
    }
    handleFreezerGame();
    return "Confirm freezing this game.";
  },
  async saveGame() {
    if (state.gameOver && state.rounds.length) {
      await handleManualSaveGame();
      return "Game saved.";
    }
    saveCurrentGameState();
    showSaveIndicator("Game Saved");
    return "Current game saved.";
  },
  rematch: applyVoiceScoreRematch,
  openModal(action) {
    const handlers = getVoiceScoreModalHandlers(action.target);
    if (!handlers || typeof handlers.open !== "function") throw new Error("That app panel cannot be opened by voice.");
    handlers.open();
    return "Opened.";
  },
  closeModal(action) {
    closeVoiceScoreModalTarget(action.target);
    return "Closed.";
  },
  setDealerOrder(action) {
    const dealers = sanitizeVoiceScoreDealers(action.dealers);
    updateState({ dealers, misdealCount: 0, misdealDealers: [] });
    saveCurrentGameState();
    showSaveIndicator("Dealer order saved");
    return `Dealer order set: ${dealers.join(", ")}.`;
  },
  startPaperGame: applyVoiceScoreStartPaperGame,
  setTeams: applyVoiceScoreSetTeams,
  selectDealerPair(action) {
    if (action.pair !== "13" && action.pair !== "24") throw new Error("Say pair one-three or pair two-four.");
    if (!Array.isArray(state.dealers) || state.dealers.length !== 4) throw new Error("Enter a dealing order first.");
    handleDealerPairSelection(action.pair);
    return "Dealer pair selected.";
  },
  selectBid: applyVoiceScoreSelectBid,
  setSetting: applyVoiceScoreSetting,
  tableTalkPenalty(action) {
    const flaggedTeam = normalizeVoiceScoreActionTeam(action.team);
    if (!state.biddingTeam || !state.bidAmount) throw new Error("Select a bidding team and bid before applying a table-talk penalty.");
    applyTableTalkPenalty(flaggedTeam);
    return "Confirm the table-talk penalty.";
  },
  toggleMenu: applyVoiceScoreToggleMenu,
  authAction: applyVoiceScoreAuthAction,
  confirmationAction: applyVoiceScoreConfirmationAction,
  gameLibraryAction: applyVoiceScoreGameLibraryAction,
  setThemeColors: applyVoiceScoreThemeColors,
  themeAction: applyVoiceScoreThemeAction,
  setBidPresets: applyVoiceScoreBidPresets,
  setStatsControls: applyVoiceScoreStatsControls,
  exportData() {
    if (!exportGameData()) throw new Error("Game data export failed.");
    return "Game data exported.";
  },
  noop: () => "",
};

async function executeVoiceScoreAction(action, options = {}) {
  const handler = action && VOICE_SCORE_ACTION_TYPES.has(action.type)
    ? VOICE_SCORE_ACTION_HANDLERS[action.type]
    : null;
  if (typeof handler !== "function") throw new Error("That voice action is not supported.");
  return handler(normalizeVoiceScoreActionAliases(action), { confirmed: Boolean(options.confirmed) });
}

function getVoiceScoreActionTypes() {
  return [...VOICE_SCORE_ACTION_TYPES];
}

function getVoiceScoreActionHandlerTypes() {
  return Object.keys(VOICE_SCORE_ACTION_HANDLERS);
}

async function executeVoiceScorePlanActions(plan, options = {}) {
  const messages = [];
  for (const action of plan.actions) {
    const message = await executeVoiceScoreAction(action, options);
    if (message) messages.push(message);
  }
  return messages;
}

// --- Recording lifecycle ---
function stopVoiceScoreRecorderStream(stream = voiceScoreRecorderStream) {
  if (stream === voiceScoreRecorderStream && voiceScoreStreamIdleTimer) {
    clearTimeout(voiceScoreStreamIdleTimer);
    voiceScoreStreamIdleTimer = null;
  }
  if (stream && typeof stream.getTracks === "function") {
    stream.getTracks().forEach(track => track.stop());
  }
  if (stream === voiceScoreRecorderStream) voiceScoreRecorderStream = null;
}

function getVoiceScoreRecorderStreamTracks(stream) {
  if (!stream) return [];
  if (typeof stream.getAudioTracks === "function") return stream.getAudioTracks();
  if (typeof stream.getTracks === "function") return stream.getTracks();
  return [];
}

function isVoiceScoreRecorderStreamUsable(stream = voiceScoreRecorderStream) {
  const tracks = getVoiceScoreRecorderStreamTracks(stream);
  return tracks.length > 0 && tracks.some(track => track.readyState !== "ended");
}

function setVoiceScoreRecorderStreamEnabled(stream, enabled) {
  getVoiceScoreRecorderStreamTracks(stream).forEach(track => {
    track.enabled = Boolean(enabled);
  });
}

function reuseVoiceScoreRecorderStream() {
  if (!isVoiceScoreRecorderStreamUsable()) {
    stopVoiceScoreRecorderStream();
    return null;
  }
  if (voiceScoreStreamIdleTimer) {
    clearTimeout(voiceScoreStreamIdleTimer);
    voiceScoreStreamIdleTimer = null;
  }
  setVoiceScoreRecorderStreamEnabled(voiceScoreRecorderStream, true);
  return voiceScoreRecorderStream;
}

function keepVoiceScoreRecorderStreamReady(stream) {
  if ((typeof document !== "undefined" && document.hidden)
      || stream !== voiceScoreRecorderStream
      || !isVoiceScoreRecorderStreamUsable(stream)) {
    stopVoiceScoreRecorderStream(stream);
    return;
  }
  setVoiceScoreRecorderStreamEnabled(stream, false);
  if (voiceScoreStreamIdleTimer) clearTimeout(voiceScoreStreamIdleTimer);
  voiceScoreStreamIdleTimer = setTimeout(() => {
    voiceScoreStreamIdleTimer = null;
    if (stream === voiceScoreRecorderStream && !voiceScoreRecorder) {
      stopVoiceScoreRecorderStream(stream);
    }
  }, VOICE_SCORE_STREAM_IDLE_TIMEOUT_MS);
}

function clearVoiceScoreRecordingTimer() {
  if (voiceScoreRecordingTimer) {
    clearTimeout(voiceScoreRecordingTimer);
    voiceScoreRecordingTimer = null;
  }
}

function clearVoiceScorePermissionNoticeTimer() {
  if (voiceScorePermissionNoticeTimer) {
    clearTimeout(voiceScorePermissionNoticeTimer);
    voiceScorePermissionNoticeTimer = null;
  }
}

function scheduleVoiceScorePermissionNotice(operationId) {
  clearVoiceScorePermissionNoticeTimer();
  voiceScorePermissionNoticeTimer = setTimeout(() => {
    voiceScorePermissionNoticeTimer = null;
    if (operationId === voiceScoreOperationId && voiceScoreMode === "starting") {
      setVoiceScoreStatus("Requesting microphone permission...", "info", false);
    }
  }, VOICE_SCORE_PERMISSION_NOTICE_DELAY_MS);
}

function cancelVoiceScoreEntry() {
  voiceScoreOperationId += 1;
  voiceScoreHeldPointerId = null;
  voiceScoreHeldKey = "";
  voiceScorePreparedContext = null;
  clearVoiceScorePermissionNoticeTimer();
  clearVoiceScoreRecordingTimer();
  if (voiceScoreStatusTimer) {
    clearTimeout(voiceScoreStatusTimer);
    voiceScoreStatusTimer = null;
  }
  if (voiceScoreRequestController) {
    voiceScoreRequestController.abort();
    voiceScoreRequestController = null;
  }

  if (voiceScoreRecorder) {
    const recorder = voiceScoreRecorder;
    recorder.ondataavailable = null;
    recorder.onerror = null;
    recorder.onstop = null;
    try {
      if (recorder.state === "recording") recorder.stop();
    } catch {}
    voiceScoreRecorder = null;
  }

  stopVoiceScoreRecorderStream();
  voiceScoreListening = false;
  voiceScoreMode = "";
  voiceScoreStatus = "";
  voiceScoreStatusTone = "info";
  refreshVoiceScoreControls();
}

async function processVoiceScoreAudioBlob(audioBlob, operationId = voiceScoreOperationId, context = null) {
  if (!audioBlob || !audioBlob.size) {
    if (operationId === voiceScoreOperationId) {
      setVoiceScoreStatus("No voice audio was captured.", "error");
    }
    return false;
  }

  setVoiceScoreStatus("Processing voice...", "info", false);
  const requestController = typeof AbortController === "function" ? new AbortController() : null;
  if (operationId === voiceScoreOperationId) voiceScoreRequestController = requestController;
  let timedOut = false;
  const requestTimer = requestController
    ? setTimeout(() => {
        timedOut = true;
        requestController.abort();
      }, VOICE_SCORE_REQUEST_TIMEOUT_MS)
    : null;
  try {
    const planContext = context || getVoiceScoreAppContext();
    const plan = await requestVoiceScoreActionPlan({
      audioBlob,
      mimeType: audioBlob.type || "audio/webm",
    }, { context: planContext, signal: requestController?.signal });
    if (operationId !== voiceScoreOperationId) return false;
    return await applyVoiceScorePlan(plan, planContext);
  } catch (error) {
    if (operationId !== voiceScoreOperationId || (error?.name === "AbortError" && !timedOut)) return false;
    reportVoiceScoreOutcome(
      timedOut ? "That took too long. Please try again." : error.message || "Voice command planning is unavailable.",
      "error",
    );
    return false;
  } finally {
    clearTimeout(requestTimer);
    if (voiceScoreRequestController === requestController) {
      voiceScoreRequestController = null;
    }
  }
}

async function startRecordedVoiceScoreEntry(fallbackMessage = "Voice recording is not supported in this browser.") {
  if (typeof window === "undefined" || typeof navigator === "undefined"
      || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function"
      || typeof window.MediaRecorder !== "function") {
    setVoiceScoreStatus(fallbackMessage, "error");
    return false;
  }

  if (voiceScoreMode) return false;
  const operationId = voiceScoreOperationId + 1;
  voiceScoreOperationId = operationId;
  voiceScoreMode = "starting";
  voiceScoreListening = true;
  let requestedStream = null;

  try {
    setVoiceScoreStatus("", "info", false);
    scheduleVoiceScorePermissionNotice(operationId);
    const stream = reuseVoiceScoreRecorderStream()
      || await navigator.mediaDevices.getUserMedia(getVoiceScoreAudioConstraints());
    requestedStream = stream;
    clearVoiceScorePermissionNoticeTimer();
    if (operationId !== voiceScoreOperationId || !isExperimentalFeaturesEnabled()) {
      stopVoiceScoreRecorderStream(stream);
      return false;
    }

    const mimeType = getVoiceScoreRecordingMimeType();
    const recorder = createVoiceScoreMediaRecorder(stream, mimeType);
    const audioChunks = [];

    voiceScoreRecorder = recorder;
    voiceScoreRecorderStream = stream;
    voiceScoreMode = "recording";
    voiceScoreListening = true;
    setVoiceScoreStatus("Listening... release to send.", "info", false);

    recorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) audioChunks.push(event.data);
    };
    recorder.onerror = () => {
      if (operationId !== voiceScoreOperationId) {
        stopVoiceScoreRecorderStream(stream);
        return;
      }
      clearVoiceScoreRecordingTimer();
      stopVoiceScoreRecorderStream(stream);
      if (voiceScoreRecorder === recorder) voiceScoreRecorder = null;
      voiceScoreListening = false;
      voiceScoreMode = "";
      setVoiceScoreStatus("Voice recording failed.", "error");
    };
    recorder.onstop = () => {
      if (operationId !== voiceScoreOperationId) {
        stopVoiceScoreRecorderStream(stream);
        return;
      }
      clearVoiceScoreRecordingTimer();
      keepVoiceScoreRecorderStreamReady(stream);
      if (voiceScoreRecorder === recorder) voiceScoreRecorder = null;
      voiceScoreListening = false;
      voiceScoreMode = "processing";
      const audioBlob = new Blob(audioChunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      const preparedContext = voiceScorePreparedContext;
      voiceScorePreparedContext = null;
      refreshVoiceScoreControls();
      processVoiceScoreAudioBlob(audioBlob, operationId, preparedContext).finally(() => {
        if (operationId !== voiceScoreOperationId) return;
        voiceScoreMode = "";
        refreshVoiceScoreControls();
      });
    };

    recorder.start();
    voiceScoreRecordingTimer = setTimeout(() => {
      if (voiceScoreRecorder && voiceScoreRecorder.state === "recording") {
        voiceScoreRecorder.stop();
      }
    }, VOICE_SCORE_RECORDING_MAX_MS);
    // Gather the app context while the user is still talking instead of after
    // release, where it would delay the upload.
    voiceScorePreparedContext = null;
    setTimeout(() => {
      if (operationId !== voiceScoreOperationId || voiceScoreRecorder !== recorder) return;
      try {
        voiceScorePreparedContext = getVoiceScoreAppContext();
      } catch {}
    }, 0);
    refreshVoiceScoreControls();
    return true;
  } catch (error) {
    clearVoiceScorePermissionNoticeTimer();
    if (operationId !== voiceScoreOperationId) {
      stopVoiceScoreRecorderStream(requestedStream);
      return false;
    }
    stopVoiceScoreRecorderStream(requestedStream);
    voiceScoreRecorder = null;
    voiceScoreListening = false;
    voiceScoreMode = "";
    const permissionError = error && (error.name === "NotAllowedError" || error.name === "SecurityError");
    setVoiceScoreStatus(permissionError ? "Voice entry needs microphone permission." : fallbackMessage, "error");
    return false;
  }
}

function stopVoiceScoreEntry() {
  if (voiceScoreMode === "starting") {
    cancelVoiceScoreEntry();
    return true;
  }

  if (!voiceScoreRecorder || voiceScoreRecorder.state !== "recording") return false;
  clearVoiceScoreRecordingTimer();
  voiceScoreRecorder.stop();
  return true;
}

function beginVoiceScoreHold(inputType, inputId = null) {
  if (voiceScoreHeldPointerId !== null || voiceScoreHeldKey || voiceScoreMode) return false;

  if (inputType === "pointer") {
    voiceScoreHeldPointerId = inputId;
  } else if (inputType === "keyboard") {
    voiceScoreHeldKey = String(inputId || "");
  } else {
    return false;
  }

  // Don't record the previous reply, and warm the planner while the user talks.
  stopVoiceScoreSpeech();
  warmVoiceScoreEndpoint();
  const startResult = startVoiceScoreEntry();
  if (!startResult) {
    voiceScoreHeldPointerId = null;
    voiceScoreHeldKey = "";
  }
  return startResult;
}

function releaseVoiceScoreHold() {
  const wasHolding = voiceScoreHeldPointerId !== null || Boolean(voiceScoreHeldKey);
  if (!wasHolding) return false;
  voiceScoreHeldPointerId = null;
  voiceScoreHeldKey = "";
  return stopVoiceScoreEntry();
}

function endVoiceScoreHold(inputType, inputId = null) {
  if (inputType === "pointer" && voiceScoreHeldPointerId !== inputId) return false;
  if (inputType === "keyboard" && voiceScoreHeldKey !== String(inputId || "")) return false;
  const released = releaseVoiceScoreHold();
  // The release is a user gesture, and the recorder has already stopped.
  primeVoiceScoreSpeech();
  return released;
}

function renderVoiceScoreControls() {
  if (!isExperimentalFeaturesEnabled()) return "";
  const toneClass = voiceScoreStatusTone === "error"
    ? "text-red-200"
    : voiceScoreStatusTone === "success"
      ? "text-green-200"
      : "text-blue-100";
  const activeClass = voiceScoreListening
    ? " voice-score-button--active"
    : "";
  const busyClass = voiceScoreMode === "processing"
    ? " voice-score-button--busy"
    : "";
  const isBusy = voiceScoreMode === "starting" || voiceScoreMode === "processing";
  const isProcessing = voiceScoreMode === "processing";
  const buttonLabel = voiceScoreMode === "processing"
    ? "Processing voice command"
    : voiceScoreMode === "starting"
      ? "Starting voice recording; release to cancel"
      : voiceScoreListening
        ? "Recording voice command; release to send"
        : "Hold microphone to record voice command";
  return `
    <div class="voice-score-control">
      <button type="button"
        data-voice-score-entry="true"
        class="voice-score-button${activeClass}${busyClass}"
        aria-pressed="${voiceScoreListening}"
        aria-busy="${isBusy}"
        aria-label="${buttonLabel}"${isProcessing ? " disabled" : ""}>
        ${Icons.Mic}
      </button>
      ${voiceScoreStatus ? `<p class="voice-score-status ${toneClass}" aria-live="polite">${escapeHtmlValue(voiceScoreStatus)}</p>` : ""}
    </div>`;
}

function initializeVoiceScoreControls() {
  // Re-enabling Experimental Features calls this again; show the mic either way.
  refreshVoiceScoreControls();
  syncVoiceScoreSpeechToggle();
  if (voiceScoreControlListenersInitialized) return false;
  voiceScoreControlListenersInitialized = true;

  document.getElementById("voiceSpokenRepliesToggle")?.addEventListener("change", event => {
    const isEnabled = setVoiceScoreSpeechEnabled(event.target.checked);
    showSaveIndicator(isEnabled ? "Spoken replies on" : "Spoken replies off");
  });

  const getVoiceScoreButton = event => (
    event.target && typeof event.target.closest === "function"
      ? event.target.closest("[data-voice-score-entry]")
      : null
  );

  document.addEventListener("pointerdown", event => {
    const target = getVoiceScoreButton(event);
    if (!target || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {}
    beginVoiceScoreHold("pointer", event.pointerId);
  });

  document.addEventListener("pointerup", event => {
    if (voiceScoreHeldPointerId !== event.pointerId) return;
    event.preventDefault();
    endVoiceScoreHold("pointer", event.pointerId);
  });

  document.addEventListener("pointercancel", event => {
    if (voiceScoreHeldPointerId !== event.pointerId) return;
    releaseVoiceScoreHold();
  });

  document.addEventListener("keydown", event => {
    const target = getVoiceScoreButton(event);
    if (!target || event.repeat || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    beginVoiceScoreHold("keyboard", event.key);
  });

  document.addEventListener("keyup", event => {
    if (voiceScoreHeldKey !== event.key) return;
    event.preventDefault();
    endVoiceScoreHold("keyboard", event.key);
  });

  document.addEventListener("click", event => {
    const target = event.target && typeof event.target.closest === "function"
      ? event.target.closest("[data-voice-score-entry]")
      : null;
    if (!target) return;
    event.preventDefault();
  });

  window.addEventListener("blur", releaseVoiceScoreHold);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    releaseVoiceScoreHold();
    if (!voiceScoreRecorder) stopVoiceScoreRecorderStream();
  });

  return true;
}

async function applyVoiceScorePlan(plan, context = null) {
  const normalizedPlan = normalizeVoiceScorePlan(plan);
  const improvementSnapshot = createVoiceImprovementSnapshot(normalizedPlan, context || undefined);
  updateVoiceScoreConversation(normalizedPlan, normalizedPlan.heardText);
  const reply = normalizedPlan.message || normalizedPlan.summary;

  if (normalizedPlan.status === "answer" && reply) {
    reportVoiceScoreOutcome(reply, "info");
    recordVoiceImprovementSample(normalizedPlan, "answered", improvementSnapshot);
    return true;
  }

  if (!normalizedPlan.actions.length) {
    reportVoiceScoreOutcome(reply || "Sorry, I didn't catch that. Please try again.", "error");
    const outcome = normalizedPlan.status === "clarify" || normalizedPlan.status === "unsupported"
      ? normalizedPlan.status
      : "failed";
    recordVoiceImprovementSample(normalizedPlan, outcome, improvementSnapshot);
    return false;
  }

  const executePlan = async (confirmed = false) => {
    try {
      const messages = await executeVoiceScorePlanActions(normalizedPlan, { confirmed });
      // After a confirmation the plan's message is the question, so fall back
      // to the summary.
      const successMessage = (confirmed ? "" : normalizedPlan.message)
        || normalizedPlan.summary
        || messages.find(Boolean)
        || "Done.";
      reportVoiceScoreOutcome(successMessage, "success");
      emitRookEvent("voice_score_command", getRookGameEventParams(state, { source: "voice_llm" }));
      recordVoiceImprovementSample(normalizedPlan, "success", improvementSnapshot);
      return true;
    } catch (error) {
      reportVoiceScoreOutcome(error.message || "Voice action failed.", "error");
      recordVoiceImprovementSample(normalizedPlan, "failed", improvementSnapshot);
      return false;
    }
  };

  if (normalizedPlan.requiresConfirmation) {
    const message = normalizedPlan.message || normalizedPlan.summary || "Confirm this voice action?";
    openConfirmationModal(
      message,
      () => {
        closeConfirmationModal();
        executePlan(true);
      },
      () => {
        closeConfirmationModal();
        setVoiceScoreStatus("Canceled.", "info");
        recordVoiceImprovementSample(normalizedPlan, "cancelled", improvementSnapshot);
      },
      { title: "Confirm voice command", confirmLabel: "Apply", icon: "mic" }
    );
    setVoiceScoreStatus("Say yes or no, or tap a button.", "info", false);
    speakVoiceScoreReply(message);
    return true;
  }

  return executePlan(false);
}

function startVoiceScoreEntry() {
  if (!isExperimentalFeaturesEnabled()) return false;
  if (voiceScoreMode) return false;
  return startRecordedVoiceScoreEntry();
}

if (typeof window !== "undefined") {
  const voiceScoreRuntime = Object.freeze({
    initializeVoiceScoreControls,
    refreshVoiceScoreControls,
    startVoiceScoreEntry,
    stopVoiceScoreEntry,
    requestVoiceScoreActionPlan,
    requestVoiceScoreMicrophonePermission,
    cancelVoiceScoreEntry,
    renderVoiceScoreControls,
  });

  window.__rookVoiceScoreRuntime = voiceScoreRuntime;
  Object.assign(window, voiceScoreRuntime);
}
