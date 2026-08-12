"use strict";

// --- Voice Score Entry ---
const VOICE_SCORE_STATUS_TIMEOUT_MS = 4500;
const VOICE_SCORE_PERMISSION_NOTICE_DELAY_MS = 300;
const VOICE_SCORE_RECORDING_MAX_MS = 6500;
const VOICE_SCORE_STREAM_IDLE_TIMEOUT_MS = 60000;
const VOICE_SCORE_AUDIO_BITS_PER_SECOND = 32000;
const VOICE_SCORE_CONVERSATION_MAX_MESSAGES = 6;
const SAME_ORIGIN_VOICE_SCORE_COMMAND_URL = "/api/voice-score-command";
const VERCEL_VOICE_SCORE_COMMAND_URL = "https://rook-score.vercel.app/api/voice-score-command";
const VOICE_SCORE_GITHUB_PAGES_HOSTNAMES = new Set(["marvj69.github.io"]);
const VOICE_SCORE_ACTION_TYPES = new Set([
  "scoreRound",
  "editRound",
  "undo",
  "redo",
  "misdeal",
  "newGame",
  "freezeGame",
  "saveGame",
  "openModal",
  "closeModal",
  "setDealerOrder",
  "startPaperGame",
  "setTeams",
  "selectDealerPair",
  "selectBid",
  "setSetting",
  "tableTalkPenalty",
  "rematch",
  "toggleMenu",
  "authAction",
  "confirmationAction",
  "gameLibraryAction",
  "setThemeColors",
  "themeAction",
  "setBidPresets",
  "setStatsControls",
  "noop",
]);
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

const VOICE_SCORE_UNITS = {
  zero: 0,
  oh: 0,
  one: 1,
  won: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const VOICE_SCORE_TENS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function normalizeVoiceScoreBaseText(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/didn['\u2019]?t/g, "didnt")
    .replace(/can['\u2019]?t/g, "cant")
    .replace(/couldn['\u2019]?t/g, "couldnt")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\bmiss\s+deal\b/g, "misdeal")
    .replace(/\bmis\s+deal\b/g, "misdeal")
    .replace(/\s+/g, " ")
    .trim();
}

function isVoiceScoreNumberToken(token) {
  return Object.prototype.hasOwnProperty.call(VOICE_SCORE_UNITS, token)
    || Object.prototype.hasOwnProperty.call(VOICE_SCORE_TENS, token)
    || token === "hundred"
    || token === "and"
    || token === "a";
}

function parseVoiceScoreTwoDigit(tokens) {
  if (!tokens.length) return null;
  if (tokens.length === 1) {
    const token = tokens[0];
    if (Object.prototype.hasOwnProperty.call(VOICE_SCORE_TENS, token)) return VOICE_SCORE_TENS[token];
    if (Object.prototype.hasOwnProperty.call(VOICE_SCORE_UNITS, token)) return VOICE_SCORE_UNITS[token];
    return null;
  }
  if (tokens.length === 2
      && Object.prototype.hasOwnProperty.call(VOICE_SCORE_TENS, tokens[0])
      && Object.prototype.hasOwnProperty.call(VOICE_SCORE_UNITS, tokens[1])
      && VOICE_SCORE_UNITS[tokens[1]] < 10) {
    return VOICE_SCORE_TENS[tokens[0]] + VOICE_SCORE_UNITS[tokens[1]];
  }
  return null;
}

function parseVoiceScoreNumberTokens(tokens) {
  const cleaned = tokens.filter(token => token !== "and");
  if (!cleaned.length) return null;
  if (cleaned[0] === "a") cleaned[0] = "one";

  const hundredIndex = cleaned.indexOf("hundred");
  if (hundredIndex !== -1) {
    const beforeHundred = cleaned.slice(0, hundredIndex);
    const afterHundred = cleaned.slice(hundredIndex + 1);
    const hundreds = beforeHundred.length ? parseVoiceScoreTwoDigit(beforeHundred) : 1;
    const remainder = afterHundred.length ? parseVoiceScoreTwoDigit(afterHundred) : 0;
    if (hundreds === null || remainder === null) return null;
    return (hundreds * 100) + remainder;
  }

  if (cleaned.length >= 2
      && Object.prototype.hasOwnProperty.call(VOICE_SCORE_UNITS, cleaned[0])
      && VOICE_SCORE_UNITS[cleaned[0]] >= 1
      && VOICE_SCORE_UNITS[cleaned[0]] <= 3) {
    const remainder = parseVoiceScoreTwoDigit(cleaned.slice(1));
    if (remainder !== null && remainder >= 20) {
      return (VOICE_SCORE_UNITS[cleaned[0]] * 100) + remainder;
    }
  }

  return parseVoiceScoreTwoDigit(cleaned);
}

function substituteVoiceScoreNumberWords(text) {
  const tokens = normalizeVoiceScoreBaseText(text).split(" ").filter(Boolean);
  const output = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!isVoiceScoreNumberToken(token)) {
      output.push(token);
      continue;
    }

    let end = index;
    while (end < tokens.length && isVoiceScoreNumberToken(tokens[end])) end += 1;

    let parsed = null;
    let length = 0;
    for (let candidateEnd = end; candidateEnd > index; candidateEnd -= 1) {
      if (tokens[candidateEnd - 1] === "and") continue;
      const candidate = tokens.slice(index, candidateEnd);
      parsed = parseVoiceScoreNumberTokens(candidate);
      if (parsed !== null) {
        length = candidate.length;
        break;
      }
    }

    if (parsed === null || length === 0 || (token === "won" && length === 1)) {
      output.push(token);
      continue;
    }

    output.push(String(parsed));
    index += length - 1;
  }
  return output.join(" ").replace(/\s+/g, " ").trim();
}

function normalizeVoiceScoreTranscript(input) {
  return substituteVoiceScoreNumberWords(input);
}

function escapeVoiceScoreRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeVoiceScoreAlias(phrase) {
  return normalizeVoiceScoreBaseText(phrase);
}

function buildVoiceScoreTeamAliases(context = {}) {
  const aliases = [
    { team: "us", phrase: "us", weight: 1 },
    { team: "us", phrase: "we", weight: 1 },
    { team: "us", phrase: "our team", weight: 2 },
    { team: "us", phrase: "ours", weight: 1 },
    { team: "dem", phrase: "dem", weight: 1 },
    { team: "dem", phrase: "them", weight: 1 },
    { team: "dem", phrase: "they", weight: 1 },
    { team: "dem", phrase: "their team", weight: 2 },
    { team: "dem", phrase: "other team", weight: 2 },
    { team: "dem", phrase: "opponent", weight: 1 },
    { team: "dem", phrase: "opponents", weight: 1 },
  ];

  const addAlias = (team, phrase, weight = 3) => {
    const normalized = normalizeVoiceScoreAlias(phrase);
    if (!normalized || normalized.length < 2) return;
    aliases.push({ team, phrase: normalized, weight });
  };

  addAlias("us", context.usTeamName || "");
  addAlias("dem", context.demTeamName || "");
  ensurePlayersArray(context.usPlayers).forEach(player => addAlias("us", player, 2));
  ensurePlayersArray(context.demPlayers).forEach(player => addAlias("dem", player, 2));

  const seen = new Set();
  return aliases
    .map(alias => ({ ...alias, phrase: normalizeVoiceScoreAlias(alias.phrase) }))
    .filter(alias => alias.phrase && !seen.has(`${alias.team}:${alias.phrase}`) && seen.add(`${alias.team}:${alias.phrase}`))
    .sort((a, b) => b.phrase.length - a.phrase.length || b.weight - a.weight);
}

function findVoiceScoreTeamMention(text, context = {}) {
  const normalized = normalizeVoiceScoreBaseText(text);
  const matches = [];
  for (const alias of buildVoiceScoreTeamAliases(context)) {
    const pattern = new RegExp(`(^|\\s)${escapeVoiceScoreRegExp(alias.phrase)}(?=\\s|$)`);
    const match = normalized.match(pattern);
    if (match) {
      matches.push({ team: alias.team, phrase: alias.phrase, index: match.index + match[1].length, weight: alias.weight });
    }
  }

  const teams = Array.from(new Set(matches.map(match => match.team)));
  if (teams.length === 1) return { team: teams[0], ambiguous: false, matches };
  if (teams.length > 1) {
    const topWeight = Math.max(...matches.map(match => match.weight));
    const strongest = matches.filter(match => match.weight === topWeight);
    const strongestTeams = Array.from(new Set(strongest.map(match => match.team)));
    if (strongestTeams.length === 1) return { team: strongestTeams[0], ambiguous: false, matches };
    return { team: null, ambiguous: true, matches };
  }
  return { team: null, ambiguous: false, matches: [] };
}

function getVoiceScoreTeamLabel(team, context = {}) {
  if (team === "us") return context.usTeamName || "Us";
  if (team === "dem") return context.demTeamName || "Dem";
  return "Team";
}

function getVoiceScoreOpposingTeam(team) {
  return team === "us" ? "dem" : "us";
}

function extractVoiceScoreBid(text) {
  const bidPatterns = [
    /\bbid(?:ding)?(?:\s+(?:was|is|for|of))?\s+(\d{1,3})\b/,
    /\b(\d{1,3})\s+(?:bid|bidding)\b/,
  ];

  for (const pattern of bidPatterns) {
    const match = text.match(pattern);
    if (match) return { value: Number(match[1]), index: match.index };
  }
  return { value: null, index: -1 };
}

function extractVoiceScoreNumberTokens(text) {
  const matches = [];
  const pattern = /\b\d{1,3}\b/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    matches.push({ value: Number(match[0]), index: match.index });
  }
  return matches;
}

function hasVoiceScoreSetStatus(text) {
  return /\b(?:got\s+set|went\s+set|set|failed|missed\s+(?:the\s+)?bid|lost\s+(?:the\s+)?bid|didnt\s+make|did\s+not\s+make|cant\s+make|couldnt\s+make)\b/.test(text);
}

function hasVoiceScoreMadeStatus(text) {
  return /\b(?:made|make|makes|making|took|take|takes|got|gets|scored|scores|score)\b/.test(text);
}

function findVoiceScoreLocalTeamBefore(text, index, context) {
  const before = normalizeVoiceScoreBaseText(text.slice(Math.max(0, index - 45), index));
  let nearest = null;
  for (const alias of buildVoiceScoreTeamAliases(context)) {
    const pattern = new RegExp(`(^|\\s)${escapeVoiceScoreRegExp(alias.phrase)}(?=\\s|$)`, "g");
    let match;
    while ((match = pattern.exec(before)) !== null) {
      const start = match.index + match[1].length;
      if (!nearest || start > nearest.index || (start === nearest.index && alias.weight > nearest.weight)) {
        nearest = { team: alias.team, index: start, weight: alias.weight };
      }
    }
  }
  return nearest ? nearest.team : null;
}

function extractVoiceScorePoints(text, bidAmount, biddingTeam, context = {}) {
  const pointPatterns = [
    /\b(?:made|make|makes|making|took|take|takes|got|gets|scored|scores|score|for|with)\s+(\d{1,3})\b/g,
    /\b(\d{1,3})\s+(?:points|point)\b/g,
  ];
  const candidates = [];

  for (const pattern of pointPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      candidates.push({
        points: Number(match[1]),
        index: match.index,
        enterBidderPoints: findVoiceScoreLocalTeamBefore(text, match.index, context) === getVoiceScoreOpposingTeam(biddingTeam)
          ? false
          : true,
      });
    }
  }

  const exactCandidate = candidates.find(candidate => candidate.points !== bidAmount || candidates.length === 1);
  if (exactCandidate) return exactCandidate;

  const numericTokens = extractVoiceScoreNumberTokens(text);
  const fallback = numericTokens.find(token => token.value !== bidAmount);
  if (fallback) {
    return { points: fallback.value, index: fallback.index, enterBidderPoints: true };
  }

  if (numericTokens.length >= 2) {
    return { points: numericTokens[1].value, index: numericTokens[1].index, enterBidderPoints: true };
  }

  return { points: null, index: -1, enterBidderPoints: true };
}

function parseVoiceScoreCommand(rawTranscript, context = {}) {
  const transcript = normalizeVoiceScoreTranscript(rawTranscript);
  if (!transcript) {
    return { type: "clarification", transcript, message: "I did not hear a command." };
  }

  if (/\b(?:undo|take\s+back|go\s+back)\b/.test(transcript)) {
    return {
      type: "undo",
      transcript,
      summary: "Undo last hand",
      requiresConfirmation: false,
    };
  }

  if (/\bmisdeal\b/.test(transcript) || /\b(?:next|move|skip)\s+dealer\b/.test(transcript)) {
    return {
      type: "misdeal",
      transcript,
      summary: "Misdeal, next dealer",
      requiresConfirmation: false,
    };
  }

  const bid = extractVoiceScoreBid(transcript);
  if (!bid.value) {
    return {
      type: "clarification",
      transcript,
      message: "Say the bid amount.",
    };
  }

  const teamScopeEnd = bid.index > 0 ? Math.min(transcript.length, bid.index + 12) : transcript.length;
  let teamResult = findVoiceScoreTeamMention(transcript.slice(0, teamScopeEnd), context);
  if (!teamResult.team && !teamResult.ambiguous) {
    teamResult = findVoiceScoreTeamMention(transcript, context);
  }
  if (teamResult.ambiguous) {
    return {
      type: "clarification",
      transcript,
      message: "I heard both teams. Say either Us or Dem with the bid.",
    };
  }
  if (!teamResult.team) {
    return {
      type: "clarification",
      transcript,
      message: "Say which team bid: Us or Dem.",
    };
  }

  const bidError = validateBid(String(bid.value));
  if (bidError) {
    return {
      type: "clarification",
      transcript,
      message: bidError,
    };
  }

  const setStatus = hasVoiceScoreSetStatus(transcript);
  const madeStatus = hasVoiceScoreMadeStatus(transcript);
  const points = extractVoiceScorePoints(transcript, bid.value, teamResult.team, context);
  let resolvedPoints = points.points;
  let enterBidderPoints = points.enterBidderPoints;
  let requiresConfirmation = false;
  let ambiguity = "";

  if (resolvedPoints === null && setStatus) {
    resolvedPoints = 180;
    enterBidderPoints = false;
    requiresConfirmation = true;
    ambiguity = `No set score was heard, so ${getVoiceScoreTeamLabel(getVoiceScoreOpposingTeam(teamResult.team), context)} will receive 180.`;
  } else if (resolvedPoints === null) {
    return {
      type: "clarification",
      transcript,
      message: madeStatus ? "Say the points scored." : "Say whether the bidder made it or got set, plus the points.",
    };
  }

  const pointsError = validatePoints(String(resolvedPoints));
  if (pointsError) {
    return {
      type: "clarification",
      transcript,
      message: pointsError,
    };
  }

  const bidderScore = enterBidderPoints ? resolvedPoints : 180 - resolvedPoints;
  const inferredSet = setStatus || bidderScore < bid.value;
  const summary = formatVoiceScoreIntentSummary({
    type: "scoreRound",
    biddingTeam: teamResult.team,
    bidAmount: bid.value,
    points: resolvedPoints,
    enterBidderPoints,
    setStatus: inferredSet,
  }, context);

  return {
    type: "scoreRound",
    transcript,
    biddingTeam: teamResult.team,
    bidAmount: bid.value,
    points: resolvedPoints,
    enterBidderPoints,
    setStatus: inferredSet,
    requiresConfirmation,
    ambiguity,
    summary,
  };
}

function formatVoiceScoreIntentSummary(intent, context = {}) {
  if (!intent || intent.type !== "scoreRound") return "";
  const biddingTeamName = getVoiceScoreTeamLabel(intent.biddingTeam, context);
  const otherTeamName = getVoiceScoreTeamLabel(getVoiceScoreOpposingTeam(intent.biddingTeam), context);
  const bidderPoints = intent.enterBidderPoints ? intent.points : 180 - intent.points;
  if (intent.setStatus || bidderPoints < intent.bidAmount) {
    if (intent.enterBidderPoints) {
      return `${biddingTeamName} bid ${intent.bidAmount} and got set with ${intent.points}.`;
    }
    return `${biddingTeamName} bid ${intent.bidAmount} and got set; ${otherTeamName} scores ${intent.points}.`;
  }
  return `${biddingTeamName} bid ${intent.bidAmount} and made ${intent.points}.`;
}

function refreshVoiceScoreControls() {
  const control = typeof document !== "undefined" && typeof document.querySelector === "function"
    ? document.querySelector(".voice-score-control")
    : null;
  if (control) {
    control.outerHTML = renderVoiceScoreControls();
    return;
  }
  scheduleRender();
}

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
    }, VOICE_SCORE_STATUS_TIMEOUT_MS);
  }
  refreshVoiceScoreControls();
}

function getVoiceScoreContext() {
  return {
    usTeamName: state.usTeamName || "Us",
    demTeamName: state.demTeamName || "Dem",
    usPlayers: state.usPlayers,
    demPlayers: state.demPlayers,
  };
}

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

  return sortedEntries.slice(0, 20).map(({ game, index }, positionIndex) => {
    const lastRound = Array.isArray(game.rounds) ? game.rounds[game.rounds.length - 1] : null;
    return {
      position: positionIndex + 1,
      index,
      us: getGameTeamDisplay(game, "us"),
      dem: getGameTeamDisplay(game, "dem"),
      score: sanitizeTotals(game.finalScore || lastRound?.runningTotals || game.startingTotals),
      timestamp: typeof game.timestamp === "string" ? game.timestamp : null,
      name: typeof game.name === "string" ? game.name.slice(0, 80) : "",
    };
  });
}

function getVoiceScoreStatisticsContext() {
  const statistics = getStatistics();
  const compactEntity = (entity, mode) => ({
    key: entity.key,
    name: entity.name,
    ...(mode === "teams" ? { players: ensurePlayersArray(entity.players) } : {}),
  });
  return {
    teams: statistics.teamsData.slice(0, 100).map(entity => compactEntity(entity, "teams")),
    players: statistics.playersData.slice(0, 100).map(entity => compactEntity(entity, "players")),
  };
}

function getVoiceScoreOpenPanels() {
  return Array.from(document.querySelectorAll(".modal:not(.hidden)"))
    .map(panel => panel.id)
    .filter(Boolean);
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
      tableTalkPenaltyType: getLocalStorage(TABLE_TALK_PENALTY_TYPE_KEY, "setPoints"),
      tableTalkPenaltyPoints: Number(getLocalStorage(TABLE_TALK_PENALTY_POINTS_KEY, "180")) || 180,
    },
  };
}

function normalizeVoiceScorePlan(plan) {
  const candidate = plan && typeof plan === "object" ? plan : {};
  const actions = Array.isArray(candidate.actions)
    ? candidate.actions.filter(action => action && VOICE_SCORE_ACTION_TYPES.has(action.type)).slice(0, 5)
    : [];
  const status = ["execute", "confirm", "clarify", "unsupported"].includes(candidate.status)
    ? candidate.status
    : actions.length
      ? "execute"
      : "clarify";

  return {
    status,
    summary: typeof candidate.summary === "string" ? candidate.summary : "",
    message: typeof candidate.message === "string" ? candidate.message : "",
    requiresConfirmation: Boolean(candidate.requiresConfirmation || status === "confirm"),
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
  (context.statistics?.players || []).forEach(player => addPlayer(player?.name));
  (context.statistics?.teams || []).forEach(team => {
    (Array.isArray(team?.players) ? team.players : []).forEach(addPlayer);
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

  const playerEntityKeys = new Map();
  (context.statistics?.players || []).forEach(player => {
    const rawKey = String(player?.key || "").trim();
    const token = addPlayer(player?.name);
    if (rawKey && token) {
      playerEntityKeys.set(rawKey.toLowerCase(), `player-${Number(token.replace("Player ", ""))}`);
    }
  });

  const teamEntityKeys = new Map();
  const statisticsTeams = [];
  (context.statistics?.teams || []).slice(0, 100).forEach((team, index) => {
    const rawKey = String(team?.key || "").trim();
    const players = (Array.isArray(team?.players) ? team.players : [])
      .map(addPlayer)
      .filter(Boolean)
      .slice(0, 2);
    const safeKey = `team-${index + 1}`;
    if (rawKey) teamEntityKeys.set(rawKey.toLowerCase(), safeKey);
    statisticsTeams.push({ key: safeKey, players });
  });

  return {
    replacements,
    playerTokensByName,
    playerEntityKeys,
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
    redacted = redacted.replace(new RegExp(escapeVoiceScoreRegExp(value), "gi"), replacement);
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

function sanitizeVoiceImprovementAction(action, identityMap) {
  if (!action || !VOICE_SCORE_ACTION_TYPES.has(action.type)) return null;
  const safe = { type: action.type };
  const copyNumber = (key) => {
    const number = sanitizeVoiceImprovementNumber(action[key]);
    if (number !== null) safe[key] = number;
  };
  const copyEnum = (key, allowed) => {
    if (allowed.includes(action[key])) safe[key] = action[key];
  };
  const copyPlayers = (key, maximum = 4) => {
    const players = (Array.isArray(action[key]) ? action[key] : [])
      .map(value => getVoiceImprovementPlayerToken(value, identityMap))
      .filter(Boolean)
      .slice(0, maximum);
    if (players.length) safe[key] = players;
  };

  if (action.type === "scoreRound") {
    const biddingTeam = action.biddingTeam || action.team;
    if (biddingTeam === "us" || biddingTeam === "dem") safe.biddingTeam = biddingTeam;
    copyNumber("bidAmount");
    copyNumber("points");
    safe.enterBidderPoints = action.enterBidderPoints !== false;
  } else if (action.type === "editRound") {
    copyNumber("roundNumber");
    copyNumber("bidAmount");
    copyNumber("usTotal");
    copyNumber("demTotal");
  } else if (action.type === "openModal" || action.type === "closeModal") {
    copyEnum("target", [
      "savedGames", "settings", "about", "statistics", "dealerOrder",
      "teamSelection", "resumeGame", "theme", "presets", "probability",
      "version", "confirmation", "all",
    ]);
  } else if (action.type === "setDealerOrder") {
    copyPlayers("dealers");
  } else if (action.type === "startPaperGame") {
    copyNumber("usScore");
    copyNumber("demScore");
    copyPlayers("usPlayers", 2);
    copyPlayers("demPlayers", 2);
  } else if (action.type === "setTeams") {
    copyPlayers("usPlayers", 2);
    copyPlayers("demPlayers", 2);
  } else if (action.type === "selectDealerPair") {
    copyEnum("pair", ["13", "24"]);
  } else if (action.type === "selectBid") {
    const biddingTeam = action.biddingTeam || action.team;
    if (biddingTeam === "us" || biddingTeam === "dem") safe.biddingTeam = biddingTeam;
    copyNumber("bidAmount");
  } else if (action.type === "setSetting") {
    copyEnum("key", [
      "mustWinByBid", "misdealHandling", "proMode", "experimentalFeatures",
      "tableTalkPenaltyType", "tableTalkPenaltyPoints",
    ]);
    if (typeof action.value === "boolean") safe.value = action.value;
    else if (sanitizeVoiceImprovementNumber(action.value) !== null) safe.value = Number(action.value);
    else if (action.value === "loseBid" || action.value === "setPoints") safe.value = action.value;
  } else if (action.type === "tableTalkPenalty") {
    const team = action.team || action.biddingTeam;
    if (team === "us" || team === "dem") safe.team = team;
  } else if (action.type === "rematch") {
    const firstDealer = getVoiceImprovementPlayerToken(action.firstDealer, identityMap);
    if (firstDealer) safe.firstDealer = firstDealer;
  } else if (action.type === "toggleMenu") {
    if (typeof action.open === "boolean") safe.open = action.open;
  } else if (action.type === "authAction") {
    copyEnum("authAction", ["toggle", "signIn", "signOut"]);
  } else if (action.type === "confirmationAction") {
    copyEnum("confirmationChoice", ["confirm", "cancel"]);
  } else if (action.type === "gameLibraryAction") {
    copyEnum("gameAction", ["switchTab", "search", "sort", "view", "delete", "resume"]);
    copyEnum("gameType", ["completed", "freezer"]);
    copyEnum("tab", ["completed", "freezer"]);
    copyEnum("sort", ["newest", "oldest", "highest", "lowest"]);
    copyNumber("index");
    if (typeof action.query === "string") {
      safe.query = redactVoiceImprovementText(action.query, identityMap).slice(0, 100);
    }
  } else if (action.type === "setThemeColors") {
    if (/^#[0-9a-f]{6}$/i.test(action.usColor || "")) safe.usColor = action.usColor.toLowerCase();
    if (/^#[0-9a-f]{6}$/i.test(action.demColor || "")) safe.demColor = action.demColor.toLowerCase();
  } else if (action.type === "themeAction") {
    copyEnum("themeAction", ["randomize", "reset", "apply"]);
  } else if (action.type === "setBidPresets") {
    const presets = (Array.isArray(action.presets) ? action.presets : [])
      .map(Number)
      .filter(Number.isFinite)
      .slice(0, 12);
    if (presets.length) safe.presets = presets;
  } else if (action.type === "setStatsControls") {
    copyEnum("statsView", ["teams", "players"]);
    copyEnum("statsMetric", [
      "netPerGame", "bidMakePct", "setsForced", "comebacks",
      "closeWins", "perfect360s", "misdeals", "games",
    ]);
    copyEnum("statsSort", ["recent", "most", "least"]);
    copyEnum("entityMode", ["teams", "players"]);
    const rawKey = String(action.entityKey || "").trim().toLowerCase();
    const keyMap = action.entityMode === "teams" || action.statsView === "teams"
      ? identityMap.teamEntityKeys
      : identityMap.playerEntityKeys;
    let safeEntityKey = keyMap.get(rawKey);
    if (!safeEntityKey && keyMap === identityMap.playerEntityKeys) {
      const playerToken = identityMap.playerTokensByName.get(rawKey);
      if (playerToken) safeEntityKey = `player-${Number(playerToken.replace("Player ", ""))}`;
    }
    if (safeEntityKey) safe.entityKey = safeEntityKey;
  }

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

  return {
    teams: {
      us: {
        label: "Us team",
        players: (context.teams?.us?.players || [])
          .map(value => getVoiceImprovementPlayerToken(value, identityMap))
          .filter(Boolean)
          .slice(0, 2),
      },
      dem: {
        label: "Dem team",
        players: (context.teams?.dem?.players || [])
          .map(value => getVoiceImprovementPlayerToken(value, identityMap))
          .filter(Boolean)
          .slice(0, 2),
      },
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
        .map(player => getVoiceImprovementPlayerToken(player?.name, identityMap))
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

function createVoiceImprovementSnapshot(plan) {
  const normalizedPlan = normalizeVoiceScorePlan(plan);
  const context = getVoiceScoreAppContext();
  const identityMap = buildVoiceImprovementIdentityMap(context, normalizedPlan.actions);
  return {
    normalizedPlan,
    identityMap,
    context: sanitizeVoiceImprovementContext(context, identityMap),
  };
}

function buildVoiceImprovementSample(plan, outcome, snapshot = null) {
  const prepared = snapshot || createVoiceImprovementSnapshot(plan);
  const normalizedPlan = prepared.normalizedPlan || normalizeVoiceScorePlan(plan);
  const identityMap = prepared.identityMap
    || buildVoiceImprovementIdentityMap(getVoiceScoreAppContext(), normalizedPlan.actions);
  const prompt = redactVoiceImprovementText(normalizedPlan.heardText, identityMap);
  if (!prompt) return null;

  return {
    prompt,
    context: prepared.context || sanitizeVoiceImprovementContext(getVoiceScoreAppContext(), identityMap),
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

function getVoiceScoreConversation() {
  return voiceScoreConversation.map(message => ({ ...message }));
}

function clearVoiceScoreConversation() {
  voiceScoreConversation = [];
}

function updateVoiceScoreConversation(plan, transcript) {
  const normalizedPlan = normalizeVoiceScorePlan(plan);
  if (normalizedPlan.status !== "clarify") {
    clearVoiceScoreConversation();
    return getVoiceScoreConversation();
  }

  const cleanTranscript = String(transcript || "").trim().slice(0, 1000);
  const clarification = String(normalizedPlan.message || normalizedPlan.summary || "Say that another way.")
    .trim()
    .slice(0, 1000);
  if (!cleanTranscript || !clarification) return getVoiceScoreConversation();

  voiceScoreConversation = [
    ...voiceScoreConversation,
    { role: "user", content: cleanTranscript },
    { role: "assistant", content: clarification },
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

async function requestVoiceScoreActionPlan(input, localIntent, options = {}) {
  setVoiceScoreStatus("Thinking...", "info", false);
  const requestBody = {
    context: getVoiceScoreAppContext(),
    localIntent: localIntent || null,
    conversation: getVoiceScoreConversation(),
  };

  if (input && typeof input === "object" && !Array.isArray(input)) {
    if (typeof input.transcript === "string" && input.transcript.trim()) {
      requestBody.transcript = input.transcript.trim();
    }
    if (typeof input.audioBase64 === "string" && input.audioBase64) {
      requestBody.audioBase64 = input.audioBase64;
      requestBody.mimeType = input.mimeType || "audio/webm";
    }
  } else if (typeof input === "string" && input.trim()) {
    requestBody.transcript = input.trim();
  }

  const audioBlob = input && typeof input === "object" && input.audioBlob
    && typeof input.audioBlob.size === "number"
    ? input.audioBlob
    : null;
  const canUseMultipartAudio = audioBlob && typeof FormData === "function";
  let body;
  const headers = { Accept: "application/json" };

  if (canUseMultipartAudio) {
    body = new FormData();
    body.append("context", JSON.stringify(requestBody.context));
    body.append("conversation", JSON.stringify(requestBody.conversation));
    if (requestBody.localIntent) body.append("localIntent", JSON.stringify(requestBody.localIntent));
    if (requestBody.transcript) body.append("transcript", requestBody.transcript);
    body.append(
      "audio",
      audioBlob,
      getVoiceScoreAudioFilename(audioBlob.type || input.mimeType || "audio/webm"),
    );
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(requestBody);
  }

  const response = await fetch(getVoiceScoreCommandUrl(), {
    method: "POST",
    headers,
    body,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Voice command planning failed with HTTP ${response.status}.`);
  }
  return normalizeVoiceScorePlan(payload.plan);
}

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
    confirmation: { open: () => {}, close: closeConfirmationModal },
  }[target] || null;
}

function closeVoiceScoreModalTarget(target) {
  if (!target || target === "all") {
    [
      closeSavedGamesModal,
      closeSettingsModal,
      closeAboutModal,
      closeStatisticsModal,
      closeDealerOrderModal,
      closeTeamSelectionModal,
      closeResumeGameModal,
      () => closeThemeModal(null),
      closePresetEditorModal,
      closeProbabilityModal,
      closeVersionInfoModal,
      closeConfirmationModal,
      closeTableTalkModal,
      closeEntityStatisticsModal,
      closeDealerPairSelectionModal,
      () => closeRematchDealerModal(false),
      () => closeModal("viewSavedGameModal"),
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

function applyVoiceScoreSelectBid(action) {
  const biddingTeam = normalizeVoiceScoreActionTeam(action.biddingTeam || action.team);
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
  return `${getVoiceScoreTeamLabel(biddingTeam, getVoiceScoreContext())} bid ${bidAmount}.`;
}

function applyVoiceScoreSetting(action) {
  const key = action.key;
  const value = action.value;
  if (key === "mustWinByBid") {
    setLocalStorage(MUST_WIN_BY_BID_KEY, Boolean(value));
    showSaveIndicator("Settings Saved");
    return Boolean(value) ? "Must win by bid is on." : "Must win by bid is off.";
  }
  if (key === "misdealHandling") {
    setLocalStorage(MISDEAL_HANDLING_KEY, Boolean(value));
    showSaveIndicator("Settings Saved");
    return Boolean(value) ? "Misdeal handling is on." : "Misdeal handling is off.";
  }
  if (key === "proMode") {
    const isPro = Boolean(value);
    setLocalStorage(PRO_MODE_KEY, isPro);
    updateProModeUI(isPro);
    saveCurrentGameState();
    showSaveIndicator("Settings Saved");
    return isPro ? "Pro mode is on." : "Pro mode is off.";
  }
  if (key === "experimentalFeatures") {
    const isEnabled = Boolean(value);
    toggleExperimentalFeatures({ checked: isEnabled });
    return isEnabled ? "Experimental features are on." : "Experimental features are off.";
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
  return normalizeVoiceScoreBaseText(String(value || "").replace(/\|\|/g, " and "))
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

  for (const mode of modeOrder) {
    const collection = mode === "teams" ? statistics.teamsData : statistics.playersData;
    const entity = collection.find(candidate => (
      String(candidate.key || "").toLowerCase() === requestedKey.toLowerCase()
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

async function executeVoiceScoreAction(action, options = {}) {
  if (!action || !VOICE_SCORE_ACTION_TYPES.has(action.type)) throw new Error("That voice action is not supported.");
  const confirmed = Boolean(options.confirmed);

  if (action.type === "noop") return "";

  if (action.type === "scoreRound") {
    const biddingTeam = normalizeVoiceScoreActionTeam(action.biddingTeam || action.team);
    const submitted = submitStructuredRound({
      biddingTeam,
      bidAmount: Number(action.bidAmount),
      points: Number(action.points),
      enterBidderPoints: action.enterBidderPoints !== false,
      source: "voice_llm",
    });
    if (!submitted) throw new Error(state.error || "The score could not be recorded.");
    showSaveIndicator("Voice score recorded");
    return "Voice score recorded.";
  }

  if (action.type === "editRound") return applyVoiceScoreEditRound(action);

  if (action.type === "undo") {
    if (!state.rounds.length) throw new Error("No hand to undo.");
    handleUndo();
    showSaveIndicator("Last hand undone");
    return "Undid last hand.";
  }

  if (action.type === "redo") {
    if (!state.undoneRounds.length) throw new Error("No hand to redo.");
    handleRedo();
    showSaveIndicator("Hand redone");
    return "Redid last hand.";
  }

  if (action.type === "misdeal") {
    if (!Array.isArray(state.dealers) || state.dealers.length === 0) throw new Error("Enter a dealing order before using misdeal.");
    handleMisdeal();
    return "Moved to next dealer.";
  }

  if (action.type === "newGame") {
    if (confirmed) {
      resetGame();
      showSaveIndicator("New game started");
      return "New game started.";
    }
    handleNewGame();
    return "Confirm the new game.";
  }

  if (action.type === "freezeGame") {
    if (confirmed && state.rounds.length && state.usTeamName && state.demTeamName) {
      await freezeCurrentGame();
      return "Game frozen.";
    }
    handleFreezerGame();
    return "Confirm freezing this game.";
  }

  if (action.type === "saveGame") {
    if (state.gameOver && state.rounds.length) {
      await handleManualSaveGame();
      return "Game saved.";
    }
    saveCurrentGameState();
    showSaveIndicator("Game Saved");
    return "Current game saved.";
  }

  if (action.type === "openModal") {
    const handlers = getVoiceScoreModalHandlers(action.target);
    if (!handlers || typeof handlers.open !== "function") throw new Error("That app panel cannot be opened by voice.");
    handlers.open();
    return "Opened.";
  }

  if (action.type === "closeModal") {
    closeVoiceScoreModalTarget(action.target);
    return "Closed.";
  }

  if (action.type === "setDealerOrder") {
    const dealers = sanitizeVoiceScoreDealers(action.dealers);
    updateState({ dealers, misdealCount: 0, misdealDealers: [] });
    saveCurrentGameState();
    showSaveIndicator("Dealer order saved");
    return `Dealer order set: ${dealers.join(", ")}.`;
  }

  if (action.type === "startPaperGame") return applyVoiceScoreStartPaperGame(action);

  if (action.type === "setTeams") return applyVoiceScoreSetTeams(action);

  if (action.type === "selectDealerPair") {
    if (action.pair !== "13" && action.pair !== "24") throw new Error("Say pair one-three or pair two-four.");
    if (!Array.isArray(state.dealers) || state.dealers.length !== 4) throw new Error("Enter a dealing order first.");
    handleDealerPairSelection(action.pair);
    return "Dealer pair selected.";
  }

  if (action.type === "selectBid") return applyVoiceScoreSelectBid(action);

  if (action.type === "setSetting") return applyVoiceScoreSetting(action);

  if (action.type === "tableTalkPenalty") {
    const flaggedTeam = normalizeVoiceScoreActionTeam(action.team || action.biddingTeam);
    if (!state.biddingTeam || !state.bidAmount) throw new Error("Select a bidding team and bid before applying a table-talk penalty.");
    applyTableTalkPenalty(flaggedTeam);
    return "Confirm the table-talk penalty.";
  }

  if (action.type === "rematch") {
    if (action.firstDealer) {
      const started = startRematchWithFirstDealer(action.firstDealer);
      if (!started) throw new Error("Choose one of the current players to deal first.");
      return "Started rematch.";
    }
    openRematchDealerModal();
    return "Choose the first dealer for the rematch.";
  }

  if (action.type === "toggleMenu") return applyVoiceScoreToggleMenu(action);

  if (action.type === "authAction") return applyVoiceScoreAuthAction(action);

  if (action.type === "confirmationAction") return applyVoiceScoreConfirmationAction(action);

  if (action.type === "gameLibraryAction") return applyVoiceScoreGameLibraryAction(action);

  if (action.type === "setThemeColors") return applyVoiceScoreThemeColors(action);

  if (action.type === "themeAction") return applyVoiceScoreThemeAction(action);

  if (action.type === "setBidPresets") return applyVoiceScoreBidPresets(action);

  if (action.type === "setStatsControls") return applyVoiceScoreStatsControls(action);

  throw new Error("That voice action is not supported.");
}

function getVoiceScoreActionTypes() {
  return [...VOICE_SCORE_ACTION_TYPES];
}

async function executeVoiceScorePlanActions(plan, options = {}) {
  const messages = [];
  for (const action of plan.actions) {
    const message = await executeVoiceScoreAction(action, options);
    if (message) messages.push(message);
  }
  return messages;
}

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

async function processVoiceScoreAudioBlob(audioBlob, operationId = voiceScoreOperationId) {
  if (!audioBlob || !audioBlob.size) {
    if (operationId === voiceScoreOperationId) {
      setVoiceScoreStatus("No voice audio was captured.", "error");
    }
    return false;
  }

  setVoiceScoreStatus("Processing voice...", "info", false);
  const requestController = typeof AbortController === "function" ? new AbortController() : null;
  if (operationId === voiceScoreOperationId) voiceScoreRequestController = requestController;
  try {
    const plan = await requestVoiceScoreActionPlan({
      audioBlob,
      mimeType: audioBlob.type || "audio/webm",
    }, null, { signal: requestController?.signal });
    if (operationId !== voiceScoreOperationId) return false;
    return applyVoiceScorePlan(plan, plan.heardText || plan.summary || "voice command", null);
  } catch (error) {
    if (operationId !== voiceScoreOperationId || error?.name === "AbortError") return false;
    setVoiceScoreStatus(error.message || "Voice command planning is unavailable.", "error");
    return false;
  } finally {
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
      refreshVoiceScoreControls();
      processVoiceScoreAudioBlob(audioBlob, operationId).finally(() => {
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
  return releaseVoiceScoreHold();
}

function renderVoiceScoreControls() {
  if (state.gameOver || !isExperimentalFeaturesEnabled()) return "";
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
  if (voiceScoreControlListenersInitialized) return false;
  voiceScoreControlListenersInitialized = true;

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
    endVoiceScoreHold("pointer", event.pointerId);
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

function processLocalVoiceScoreIntent(intent) {
  if (intent.type === "clarification") {
    setVoiceScoreStatus(intent.message, "error");
    return false;
  }

  if (intent.requiresConfirmation) {
    const message = intent.ambiguity
      ? `${intent.summary} ${intent.ambiguity}`
      : intent.summary;
    openConfirmationModal(
      message,
      () => {
        closeConfirmationModal();
        applyVoiceScoreIntent(intent);
      },
      closeConfirmationModal
    );
    return true;
  }

  return applyVoiceScoreIntent(intent);
}

async function applyVoiceScorePlan(plan, transcript, localIntent) {
  const normalizedPlan = normalizeVoiceScorePlan(plan);
  const heardText = normalizedPlan.heardText || String(transcript || "").trim();
  if (!normalizedPlan.heardText && heardText) normalizedPlan.heardText = heardText.slice(0, 1000);
  const improvementSnapshot = createVoiceImprovementSnapshot(normalizedPlan);
  updateVoiceScoreConversation(normalizedPlan, heardText);
  if (normalizedPlan.status === "clarify" || normalizedPlan.status === "unsupported") {
    setVoiceScoreStatus(normalizedPlan.message || normalizedPlan.summary || "Say that another way.", "error");
    recordVoiceImprovementSample(normalizedPlan, normalizedPlan.status, improvementSnapshot);
    return false;
  }

  if (!normalizedPlan.actions.length) {
    recordVoiceImprovementSample(normalizedPlan, "failed", improvementSnapshot);
    return processLocalVoiceScoreIntent(localIntent);
  }

  const executeConfirmedPlan = async (confirmed = false) => {
    try {
      const messages = await executeVoiceScorePlanActions(normalizedPlan, { confirmed });
      const successMessage = normalizedPlan.summary || messages.find(Boolean) || `Heard: ${transcript}`;
      setVoiceScoreStatus(successMessage, "success");
      emitRookEvent("voice_score_command", getRookGameEventParams(state, { source: "voice_llm" }));
      recordVoiceImprovementSample(normalizedPlan, "success", improvementSnapshot);
      return true;
    } catch (error) {
      setVoiceScoreStatus(error.message || "Voice action failed.", "error");
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
        executeConfirmedPlan(true);
      },
      () => {
        closeConfirmationModal();
        recordVoiceImprovementSample(normalizedPlan, "cancelled", improvementSnapshot);
      }
    );
    return true;
  }

  return executeConfirmedPlan(false);
}

async function processVoiceScoreTranscript(transcript) {
  const cleanTranscript = String(transcript || "").trim();
  const localIntent = parseVoiceScoreCommand(cleanTranscript, getVoiceScoreContext());
  if (!cleanTranscript) return processLocalVoiceScoreIntent(localIntent);

  try {
    const plan = await requestVoiceScoreActionPlan({ transcript: cleanTranscript }, localIntent);
    return applyVoiceScorePlan(plan, plan.heardText || cleanTranscript, localIntent);
  } catch (error) {
    if (localIntent.type !== "clarification") {
      return processLocalVoiceScoreIntent(localIntent);
    }
    setVoiceScoreStatus(error.message || "Voice command planning is unavailable.", "error");
    return false;
  }
}

function applyVoiceScoreIntent(intent) {
  if (!intent) return false;
  if (intent.type === "undo") {
    if (!state.rounds.length) {
      setVoiceScoreStatus("No hand to undo.", "error");
      return false;
    }
    handleUndo();
    showSaveIndicator("Last hand undone");
    setVoiceScoreStatus("Undid last hand.", "success");
    emitRookEvent("voice_score_command", getRookGameEventParams(state, { source: "voice_undo" }));
    return true;
  }

  if (intent.type === "misdeal") {
    if (!Array.isArray(state.dealers) || state.dealers.length === 0) {
      setVoiceScoreStatus("Enter a dealing order before using misdeal.", "error");
      return false;
    }
    handleMisdeal();
    setVoiceScoreStatus("Moved to next dealer.", "success");
    emitRookEvent("voice_score_command", getRookGameEventParams(state, { source: "voice_misdeal" }));
    return true;
  }

  if (intent.type === "scoreRound") {
    if (state.gameOver) {
      setVoiceScoreStatus("Start a new game before scoring.", "error");
      return false;
    }
    const submitted = submitStructuredRound({
      biddingTeam: intent.biddingTeam,
      bidAmount: intent.bidAmount,
      points: intent.points,
      enterBidderPoints: intent.enterBidderPoints,
      source: "voice_score",
    });
    if (submitted) {
      showSaveIndicator("Voice score recorded");
      setVoiceScoreStatus(intent.summary, "success");
    }
    return submitted;
  }

  return false;
}

function startVoiceScoreEntry() {
  if (!isExperimentalFeaturesEnabled()) return false;

  if (voiceScoreMode) return false;

  if (state.gameOver) {
    setVoiceScoreStatus("Start a new game before scoring.", "error");
    return;
  }

  return startRecordedVoiceScoreEntry();
}

if (typeof window !== "undefined") {
  const voiceScoreRuntime = Object.freeze({
    initializeVoiceScoreControls,
    startVoiceScoreEntry,
    stopVoiceScoreEntry,
    processVoiceScoreTranscript,
    parseVoiceScoreCommand,
    requestVoiceScoreActionPlan,
    requestVoiceScoreMicrophonePermission,
    cancelVoiceScoreEntry,
    renderVoiceScoreControls,
  });

  window.__rookVoiceScoreRuntime = voiceScoreRuntime;
  Object.assign(window, voiceScoreRuntime);
}
