"use strict";

// --- Voice Score Entry ---
const VOICE_SCORE_STATUS_TIMEOUT_MS = 4500;
const VOICE_SCORE_RECORDING_MAX_MS = 6500;
const SAME_ORIGIN_VOICE_SCORE_TRANSCRIBE_URL = "/api/voice-score-transcribe";
const VERCEL_VOICE_SCORE_TRANSCRIBE_URL = "https://rook-score.vercel.app/api/voice-score-transcribe";
const SAME_ORIGIN_VOICE_SCORE_COMMAND_URL = "/api/voice-score-command";
const VERCEL_VOICE_SCORE_COMMAND_URL = "https://rook-score.vercel.app/api/voice-score-command";
const VOICE_SCORE_GITHUB_PAGES_HOSTNAMES = new Set(["marvj69.github.io"]);
const VOICE_SCORE_ACTION_TYPES = new Set([
  "scoreRound",
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
let voiceScoreRecognition = null;
let voiceScoreRecorder = null;
let voiceScoreRecorderStream = null;
let voiceScoreListening = false;
let voiceScoreMode = "";
let voiceScoreStatus = "";
let voiceScoreStatusTone = "info";
let voiceScoreStatusTimer = null;
let voiceScoreRecordingTimer = null;

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
        scheduleRender();
      }
    }, VOICE_SCORE_STATUS_TIMEOUT_MS);
  }
  scheduleRender();
}

function getVoiceScoreContext() {
  return {
    usTeamName: state.usTeamName || "Us",
    demTeamName: state.demTeamName || "Dem",
    usPlayers: state.usPlayers,
    demPlayers: state.demPlayers,
  };
}

function getVoiceScoreRecognitionConstructor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function getVoiceScoreTranscriptionUrl() {
  if (typeof window === "undefined" || !window.location) return SAME_ORIGIN_VOICE_SCORE_TRANSCRIBE_URL;
  return VOICE_SCORE_GITHUB_PAGES_HOSTNAMES.has(window.location.hostname)
    ? VERCEL_VOICE_SCORE_TRANSCRIBE_URL
    : SAME_ORIGIN_VOICE_SCORE_TRANSCRIBE_URL;
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
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  if (typeof window.MediaRecorder.isTypeSupported !== "function") return "";
  return candidates.find(type => window.MediaRecorder.isTypeSupported(type)) || "";
}

function getVoiceScoreCurrentDealer() {
  if (!Array.isArray(state.dealers) || !state.dealers.length) return "";
  const totalDeals = (Array.isArray(state.rounds) ? state.rounds.length : 0) + (state.misdealCount || 0);
  return state.dealers[totalDeals % state.dealers.length] || "";
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
    settings: {
      mustWinByBid: Boolean(getLocalStorage(MUST_WIN_BY_BID_KEY, false)),
      misdealHandling: Boolean(getLocalStorage(MISDEAL_HANDLING_KEY, false)),
      proMode: Boolean(getLocalStorage(PRO_MODE_KEY, false)),
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
    actions,
  };
}

async function requestVoiceScoreActionPlan(transcript, localIntent) {
  setVoiceScoreStatus("Thinking...", "info", false);
  const response = await fetch(getVoiceScoreCommandUrl(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transcript,
      context: getVoiceScoreAppContext(),
      localIntent,
    }),
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
      closeConfirmationModal,
      closeTableTalkModal,
    ].forEach(closeHandler => {
      try {
        closeHandler();
      } catch (_) {}
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
  updateState({
    usPlayers,
    demPlayers,
    usTeamName: deriveTeamDisplay(usPlayers, state.usTeamName || "Us"),
    demTeamName: deriveTeamDisplay(demPlayers, state.demTeamName || "Dem"),
  });
  saveCurrentGameState();
  return "Teams updated.";
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

function applyVoiceScoreStatsControls(action) {
  openStatisticsModal();
  setStatisticsControls({
    view: action.statsView,
    metric: action.statsMetric,
    sort: action.statsSort,
    entityMode: action.entityMode,
    entityKey: action.entityKey,
  });
  return "Statistics updated.";
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
    updateState({ dealers, misdealCount: 0 });
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

async function executeVoiceScorePlanActions(plan, options = {}) {
  const messages = [];
  for (const action of plan.actions) {
    const message = await executeVoiceScoreAction(action, options);
    if (message) messages.push(message);
  }
  return messages;
}

function stopVoiceScoreRecorderStream() {
  if (voiceScoreRecorderStream && typeof voiceScoreRecorderStream.getTracks === "function") {
    voiceScoreRecorderStream.getTracks().forEach(track => track.stop());
  }
  voiceScoreRecorderStream = null;
}

function clearVoiceScoreRecordingTimer() {
  if (voiceScoreRecordingTimer) {
    clearTimeout(voiceScoreRecordingTimer);
    voiceScoreRecordingTimer = null;
  }
}

function blobToVoiceScoreBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.includes(",") ? result.split(",").pop() : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read voice recording."));
    reader.readAsDataURL(blob);
  });
}

async function transcribeVoiceScoreBlob(audioBlob) {
  if (!audioBlob || !audioBlob.size) {
    setVoiceScoreStatus("No voice audio was captured.", "error");
    return false;
  }

  setVoiceScoreStatus("Transcribing...", "info", false);
  try {
    const audioBase64 = await blobToVoiceScoreBase64(audioBlob);
    const response = await fetch(getVoiceScoreTranscriptionUrl(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audioBase64,
        mimeType: audioBlob.type || "audio/webm",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Voice transcription failed with HTTP ${response.status}.`);
    }
    const transcript = String(payload.text || "").trim();
    if (!transcript) {
      setVoiceScoreStatus("I could not hear a score command.", "error");
      return false;
    }
    return processVoiceScoreTranscript(transcript);
  } catch (error) {
    setVoiceScoreStatus(error.message || "Voice transcription failed.", "error");
    return false;
  }
}

async function startRecordedVoiceScoreEntry(fallbackMessage = "Voice recording is not supported in this browser.") {
  if (typeof window === "undefined" || typeof navigator === "undefined"
      || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function"
      || typeof window.MediaRecorder !== "function") {
    setVoiceScoreStatus(fallbackMessage, "error");
    return false;
  }

  try {
    setVoiceScoreStatus("Requesting microphone permission...", "info", false);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getVoiceScoreRecordingMimeType();
    const options = mimeType ? { mimeType } : undefined;
    const recorder = new window.MediaRecorder(stream, options);
    const audioChunks = [];

    voiceScoreRecorder = recorder;
    voiceScoreRecorderStream = stream;
    voiceScoreMode = "recording";
    voiceScoreListening = true;
    setVoiceScoreStatus("Listening... tap Voice to stop.", "info", false);

    recorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) audioChunks.push(event.data);
    };
    recorder.onerror = () => {
      clearVoiceScoreRecordingTimer();
      stopVoiceScoreRecorderStream();
      voiceScoreRecorder = null;
      voiceScoreListening = false;
      voiceScoreMode = "";
      setVoiceScoreStatus("Voice recording failed.", "error");
    };
    recorder.onstop = () => {
      clearVoiceScoreRecordingTimer();
      stopVoiceScoreRecorderStream();
      voiceScoreRecorder = null;
      voiceScoreListening = false;
      voiceScoreMode = "";
      const audioBlob = new Blob(audioChunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      scheduleRender();
      transcribeVoiceScoreBlob(audioBlob);
    };

    recorder.start();
    voiceScoreRecordingTimer = setTimeout(() => {
      if (voiceScoreRecorder && voiceScoreRecorder.state === "recording") {
        voiceScoreRecorder.stop();
      }
    }, VOICE_SCORE_RECORDING_MAX_MS);
    scheduleRender();
    return true;
  } catch (error) {
    stopVoiceScoreRecorderStream();
    voiceScoreRecorder = null;
    voiceScoreListening = false;
    voiceScoreMode = "";
    const permissionError = error && (error.name === "NotAllowedError" || error.name === "SecurityError");
    setVoiceScoreStatus(permissionError ? "Voice entry needs microphone permission." : fallbackMessage, "error");
    return false;
  }
}

function renderVoiceScoreControls() {
  if (state.gameOver) return "";
  const toneClass = voiceScoreStatusTone === "error"
    ? "text-red-200"
    : voiceScoreStatusTone === "success"
      ? "text-green-200"
      : "text-blue-100";
  const activeClass = voiceScoreListening
    ? "bg-red-600 hover:bg-red-700 focus:ring-red-400"
    : "bg-blue-600 hover:bg-blue-700 focus:ring-blue-400";
  const buttonText = voiceScoreListening ? "Stop" : "Voice";
  const buttonLabel = voiceScoreListening ? "Stop voice score entry" : "Start voice score entry";
  return `
    <div class="mt-2 flex flex-col items-center gap-1">
      <button type="button"
        data-voice-score-entry="true"
        class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white shadow-sm transition focus:outline-none focus:ring-2 ${activeClass} threed"
        aria-pressed="${voiceScoreListening}"
        aria-label="${buttonLabel}"
        title="${buttonLabel}">
        ${Icons.Mic}
        <span>${buttonText}</span>
      </button>
      ${voiceScoreStatus ? `<p class="max-w-xs text-center text-xs font-medium ${toneClass}" aria-live="polite">${escapeHtmlValue(voiceScoreStatus)}</p>` : ""}
    </div>`;
}

function initializeVoiceScoreControls() {
  document.addEventListener("click", event => {
    const target = event.target && typeof event.target.closest === "function"
      ? event.target.closest("[data-voice-score-entry]")
      : null;
    if (!target) return;
    event.preventDefault();
    startVoiceScoreEntry();
  });
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
  if (normalizedPlan.status === "clarify" || normalizedPlan.status === "unsupported") {
    setVoiceScoreStatus(normalizedPlan.message || normalizedPlan.summary || "Say that another way.", "error");
    return false;
  }

  if (!normalizedPlan.actions.length) {
    return processLocalVoiceScoreIntent(localIntent);
  }

  const executeConfirmedPlan = async (confirmed = false) => {
    try {
      const messages = await executeVoiceScorePlanActions(normalizedPlan, { confirmed });
      const successMessage = normalizedPlan.summary || messages.find(Boolean) || `Heard: ${transcript}`;
      setVoiceScoreStatus(successMessage, "success");
      emitRookEvent("voice_score_command", getRookGameEventParams(state, { source: "voice_llm" }));
      return true;
    } catch (error) {
      setVoiceScoreStatus(error.message || "Voice action failed.", "error");
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
      closeConfirmationModal
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
    const plan = await requestVoiceScoreActionPlan(cleanTranscript, localIntent);
    return applyVoiceScorePlan(plan, cleanTranscript, localIntent);
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
  if (voiceScoreListening && voiceScoreRecognition) {
    voiceScoreRecognition.abort();
    return;
  }
  if (voiceScoreListening && voiceScoreRecorder) {
    if (voiceScoreRecorder.state === "recording") voiceScoreRecorder.stop();
    return;
  }

  if (state.gameOver) {
    setVoiceScoreStatus("Start a new game before scoring.", "error");
    return;
  }

  const Recognition = getVoiceScoreRecognitionConstructor();
  if (!Recognition) {
    startRecordedVoiceScoreEntry();
    return;
  }

  const recognition = new Recognition();
  voiceScoreRecognition = recognition;
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    voiceScoreListening = true;
    voiceScoreMode = "speech-recognition";
    setVoiceScoreStatus("Listening...", "info", false);
    clearVoiceScoreRecordingTimer();
    voiceScoreRecordingTimer = setTimeout(() => {
      if (voiceScoreRecognition) {
        try {
          voiceScoreRecognition.stop();
        } catch (_) {}
      }
    }, VOICE_SCORE_RECORDING_MAX_MS);
  };
  recognition.onresult = (event) => {
    const result = event.results?.[event.results.length - 1]?.[0]?.transcript || "";
    if (result) processVoiceScoreTranscript(result);
  };
  recognition.onerror = (event) => {
    const errorName = event?.error || "speech error";
    if (errorName === "not-allowed" || errorName === "service-not-allowed") {
      startRecordedVoiceScoreEntry("Voice entry needs microphone permission.");
      return;
    }
    setVoiceScoreStatus(`Voice entry stopped: ${errorName}.`, "error");
  };
  recognition.onend = () => {
    clearVoiceScoreRecordingTimer();
    if (voiceScoreRecorder || voiceScoreMode === "recording") {
      voiceScoreRecognition = null;
      scheduleRender();
      return;
    }
    voiceScoreListening = false;
    voiceScoreRecognition = null;
    voiceScoreMode = "";
    scheduleRender();
  };

  try {
    setVoiceScoreStatus("Requesting microphone permission...", "info", false);
    recognition.start();
  } catch (error) {
    voiceScoreListening = false;
    voiceScoreRecognition = null;
    setVoiceScoreStatus("Voice entry could not start.", "error");
  }
}
