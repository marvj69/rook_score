const VOICE_TOOLS = require("../js/modules/09-voice-tools.js");
const { assertBrowserOrigin, createRateLimiter, setCorsHeaders } = require("../lib/api-guards.js");

const ALLOWED_ORIGIN_ENV_NAMES = ["VOICE_SCORE_ALLOWED_ORIGINS", "FIREBASE_CONFIG_ALLOWED_ORIGINS"];
// Each planner call costs real money, so one client address gets a generous
// but bounded budget per window (a hand takes minutes, not seconds).
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const rateLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_REQUESTS,
  message: "Too many voice requests. Please wait a few minutes and try again.",
});

const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.7-flash";
const DEFAULT_OPENROUTER_FALLBACK_MODELS = ["google/gemini-3.1-flash-lite"];
const DEFAULT_OPENROUTER_REASONING_EFFORT = "minimal";
const OPENROUTER_REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high"]);
const DEFAULT_OPENROUTER_MAX_ATTEMPTS = 2;
// One provider call may take this long before it is abandoned, and the whole
// request (including a retry) must finish inside the planning budget, so a
// hung provider can never leave the phone waiting for minutes.
const OPENROUTER_ATTEMPT_TIMEOUT_MS = 8000;
const VOICE_PLAN_TIME_BUDGET_MS = 12000;
const MIN_RETRY_TIME_MS = 3000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_CONTEXT_JSON_LENGTH = 60000;
const MAX_CONVERSATION_MESSAGES = 6;
const MAX_CONVERSATION_CONTENT_LENGTH = 1000;
const MAX_HEARD_TEXT_LENGTH = 1000;
const MAX_MESSAGE_LENGTH = 300;
const VOICE_COMMAND_REVISION = "voice-tools-v7";
const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const MIME_AUDIO_FORMAT_MAP = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "audio/aiff": "aiff",
  "audio/x-aiff": "aiff",
};

// Prompt text for each registry action. A test keeps this in step with VOICE_TOOLS.
const VOICE_TOOL_DESCRIPTIONS = {
  scoreRound: "Record a new hand. enterBidderPoints=true when points are the bidding team's, false when they are the other team's.",
  replaceLastRound: "Fix the most recent hand (\"that should have been 140\", \"that was Dem's bid\"). Give the whole corrected hand, copying unchanged values from the last recentRounds entry.",
  editRound: "Change an older round, or any round when the user states cumulative totals. roundNumber is one-based; usTotal/demTotal are totals after that round. Include only the fields the user changed.",
  undo: "Undo the last hand.",
  redo: "Redo the last undone hand.",
  misdeal: "Record a misdeal (\"next dealer\") and move to the next dealer.",
  newGame: "Start a new game, clearing the current one.",
  freezeGame: "Freeze the current game to finish later.",
  saveGame: "Save the current game; a finished game is added to the library.",
  rematch: "Start a rematch with the same teams. firstDealer must be a current player; without one the user picks.",
  openModal: "Open an app panel.",
  closeModal: "Close an app panel, or every panel with target=all.",
  setDealerOrder: "Set the dealing order.",
  startPaperGame: "Continue a paper game from starting scores, optionally naming the players.",
  setTeams: "Set both teams' players.",
  selectDealerPair: "Choose which seat pair deals first.",
  selectBid: "Select the bidding team and bid before the hand is scored.",
  setSetting: "Change a setting. mustWinByBid, misdealHandling, proMode, experimentalFeatures, and spokenReplies take true/false; tableTalkPenaltyType takes loseBid or setPoints; tableTalkPenaltyPoints takes a multiple of 5.",
  tableTalkPenalty: "Penalize a team for table talk. The app asks to confirm, so don't add another confirmation.",
  toggleMenu: "Open (open=true) or close (open=false) the side menu.",
  authAction: "Sign in, sign out, or toggle.",
  confirmationAction: "Answer the confirmation dialog that is open now.",
  gameLibraryAction: "Saved (completed) and frozen (freezer) games: switchTab, search by query, sort, view, delete, or resume. Use the entry's index from App context library. delete and resume open the app's own confirmation, so don't add another.",
  setThemeColors: "Set team colors.",
  themeAction: "Randomize, reset, or apply the theme colors.",
  setBidPresets: "Replace the quick bid buttons.",
  setStatsControls: "Show statistics: change the view, metric, or sort, or open one player's or team's details with entityMode and entityKey.",
  exportData: "Download a backup file of all app data.",
  noop: "Do nothing.",
};

const ACTION_TYPES = new Set(Object.keys(VOICE_TOOLS.actions));
const PLAN_STATUSES = new Set(VOICE_TOOLS.statuses);

const ACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: VOICE_TOOLS.statuses },
    summary: { type: "string" },
    message: { type: "string" },
    requiresConfirmation: { type: "boolean" },
    heardText: { type: "string" },
    actions: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: Object.keys(VOICE_TOOLS.actions) },
          ...Object.fromEntries(
            Object.entries(VOICE_TOOLS.fields).map(([name, field]) => [name, field.schema]),
          ),
        },
        required: ["type"],
      },
    },
  },
  required: ["status", "summary", "message", "requiresConfirmation", "heardText", "actions"],
};

function readRequestBody(request, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on("data", chunk => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        const error = new Error("Request body is too large.");
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function resolveAudioFormat(mimeType) {
  const normalizedMime = String(mimeType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return MIME_AUDIO_FORMAT_MAP[normalizedMime] || "";
}

function buildAudioPayload(audioBuffer, mimeTypeInput) {
  const mimeType = typeof mimeTypeInput === "string" && mimeTypeInput
    ? mimeTypeInput.split(";")[0].trim().toLowerCase()
    : "audio/webm";
  const format = resolveAudioFormat(mimeType);
  if (!format) {
    const error = new Error("Unsupported audio format.");
    error.statusCode = 400;
    throw error;
  }

  if (!audioBuffer.length) {
    const error = new Error("Audio payload is empty.");
    error.statusCode = 400;
    throw error;
  }
  if (audioBuffer.length > MAX_AUDIO_BYTES) {
    const error = new Error("Audio payload is too large.");
    error.statusCode = 413;
    throw error;
  }

  return {
    data: audioBuffer.toString("base64"),
    format,
    mimeType,
  };
}

function parseAudioPayload(payload) {
  if (Buffer.isBuffer(payload.audioBuffer)) {
    return buildAudioPayload(payload.audioBuffer, payload.mimeType);
  }

  const rawAudio = typeof payload.audioBase64 === "string" ? payload.audioBase64 : "";
  if (!rawAudio) return null;

  const base64Audio = rawAudio.includes(",") ? rawAudio.split(",").pop() : rawAudio;
  return buildAudioPayload(Buffer.from(base64Audio, "base64"), payload.mimeType);
}

function parsePayloadObject(payload) {
  const candidate = payload && typeof payload === "object" ? payload : {};

  const transcript = typeof candidate.transcript === "string" ? candidate.transcript.trim() : "";
  if (transcript.length > 1000) {
    const error = new Error("Transcript is too long.");
    error.statusCode = 413;
    throw error;
  }

  const audio = parseAudioPayload(candidate);
  if (!transcript && !audio) {
    const error = new Error("Missing voice audio or transcript.");
    error.statusCode = 400;
    throw error;
  }

  const context = candidate.context && typeof candidate.context === "object" ? candidate.context : {};
  if (JSON.stringify(context).length > MAX_CONTEXT_JSON_LENGTH) {
    const error = new Error("App context is too large.");
    error.statusCode = 413;
    throw error;
  }
  const conversation = sanitizeConversation(candidate.conversation);

  return { transcript, audio, context, conversation };
}

function parseJsonPayload(bodyBuffer) {
  let payload;
  try {
    payload = JSON.parse(bodyBuffer.toString("utf8") || "{}");
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
  return parsePayloadObject(payload);
}

function parseMultipartJsonField(fields, fieldName, fallback) {
  const rawValue = fields[fieldName];
  if (typeof rawValue !== "string" || !rawValue.trim()) return fallback;
  try {
    return JSON.parse(rawValue);
  } catch {
    const error = new Error(`Multipart field ${fieldName} must contain valid JSON.`);
    error.statusCode = 400;
    throw error;
  }
}

function parseMultipartPayload(bodyBuffer, contentType) {
  const boundaryMatch = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = (boundaryMatch?.[1] || boundaryMatch?.[2] || "").trim();
  if (!boundary || boundary.length > 200) {
    const error = new Error("Multipart boundary is missing or invalid.");
    error.statusCode = 400;
    throw error;
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  const fields = {};
  let audioBuffer = null;
  let audioMimeType = "";
  let boundaryIndex = bodyBuffer.indexOf(delimiter);

  while (boundaryIndex !== -1) {
    let partStart = boundaryIndex + delimiter.length;
    if (bodyBuffer.subarray(partStart, partStart + 2).toString("ascii") === "--") break;
    if (bodyBuffer.subarray(partStart, partStart + 2).toString("ascii") === "\r\n") partStart += 2;

    const nextBoundaryIndex = bodyBuffer.indexOf(delimiter, partStart);
    if (nextBoundaryIndex === -1) break;

    let partEnd = nextBoundaryIndex;
    if (bodyBuffer.subarray(partEnd - 2, partEnd).toString("ascii") === "\r\n") partEnd -= 2;
    const headerEnd = bodyBuffer.indexOf(headerSeparator, partStart);
    if (headerEnd === -1 || headerEnd >= partEnd) {
      const error = new Error("Multipart body contains an invalid part.");
      error.statusCode = 400;
      throw error;
    }

    const headerText = bodyBuffer.subarray(partStart, headerEnd).toString("utf8");
    const nameMatch = headerText.match(/content-disposition:[^\r\n]*\bname="([^"]+)"/i);
    const fieldName = nameMatch?.[1] || "";
    const partBody = bodyBuffer.subarray(headerEnd + headerSeparator.length, partEnd);
    if (fieldName === "audio") {
      const mimeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);
      audioBuffer = Buffer.from(partBody);
      audioMimeType = mimeMatch?.[1]?.trim() || "audio/webm";
    } else if (fieldName) {
      fields[fieldName] = partBody.toString("utf8");
    }

    boundaryIndex = nextBoundaryIndex;
  }

  return parsePayloadObject({
    transcript: fields.transcript || "",
    context: parseMultipartJsonField(fields, "context", {}),
    conversation: parseMultipartJsonField(fields, "conversation", []),
    audioBuffer,
    mimeType: audioMimeType,
  });
}

function parseRequestPayload(bodyBuffer, contentType) {
  if (/^multipart\/form-data\b/i.test(String(contentType || ""))) {
    return parseMultipartPayload(bodyBuffer, contentType);
  }
  return parseJsonPayload(bodyBuffer);
}

function sanitizeConversation(conversation) {
  if (!Array.isArray(conversation)) return [];

  return conversation
    .filter(message => message && (message.role === "user" || message.role === "assistant"))
    .map(message => ({
      role: message.role,
      content: typeof message.content === "string"
        ? message.content.trim().slice(0, MAX_CONVERSATION_CONTENT_LENGTH)
        : "",
    }))
    .filter(message => message.content)
    .slice(-MAX_CONVERSATION_MESSAGES);
}

function describeVoiceToolField({ kind, schema }) {
  if (kind === "enum") return schema.enum.join("|");
  if (kind === "players") return `${schema.maxItems} player names`;
  if (kind === "player") return "a current player's name";
  if (kind === "numbers") return "list of numbers";
  if (kind === "boolean") return "true|false";
  if (kind === "color") return "#RRGGBB";
  if (kind === "text") return "text";
  if (kind === "settingValue") return "see setSetting";
  if (kind === "entityKey") return "see Statistics";
  return schema.type === "integer" ? "integer" : "number";
}

function buildToolPromptLines() {
  const toolLines = Object.entries(VOICE_TOOLS.actions).map(([type, fields]) => (
    `- ${type}${fields.length ? `(${fields.join(", ")})` : ""}: ${VOICE_TOOL_DESCRIPTIONS[type]}`
  ));
  // Group fields that share a domain so each value list appears once.
  const fieldsByDomain = new Map();
  Object.entries(VOICE_TOOLS.fields).forEach(([name, field]) => {
    const domain = describeVoiceToolField(field);
    fieldsByDomain.set(domain, [...(fieldsByDomain.get(domain) || []), name]);
  });
  const fieldLines = [...fieldsByDomain].map(([domain, names]) => `- ${names.join(", ")}: ${domain}`);
  return ["Tools (action objects are {\"type\": tool, ...fields}):", ...toolLines, "Field values:", ...fieldLines];
}

function buildSystemPrompt() {
  return [
    "You are the voice assistant inside Rook Score, a scorekeeping app for the card game Rook. Reply with one JSON object only, no commentary.",
    "Shape: {\"status\":\"execute|confirm|clarify|answer|unsupported\",\"summary\":\"...\",\"message\":\"...\",\"requiresConfirmation\":false,\"heardText\":\"...\",\"actions\":[]}",
    "heardText: a transcription of only the current spoken request, never earlier turns or app context. summary: a few words on what will happen. message: one short, friendly sentence for the user; it may be read aloud.",
    "Statuses:",
    "- execute: a clear request. List the actions.",
    "- confirm: destructive actions or assumptions (new game, freeze game, saving a finished game, rematch without a first dealer, a set hand with no spoken score). Set requiresConfirmation=true and ask the question in message.",
    "- answer: a question about the current game or app. actions=[]; answer in message using only App context (scores, who leads, points to win, dealer, recent hands, current bid, winProbability, settings). One or two short sentences, using the team labels. For saved statistics about a player or team, use setStatsControls to show them instead of answering.",
    "- clarify: a required detail is missing or ambiguous. Ask one short question in message.",
    "- unsupported: the request is outside this app.",
    "Rules:",
    "- When audio is attached it is the request. Never ask the user to type.",
    "- Earlier turns, when present, are the user's recent requests and your replies. Use them to finish a short follow-up (\"Carol\", \"yes\", \"and theirs?\"). Handle a clearly new request on its own.",
    "- Actions run in order. Use the fewest high-level actions, at most five, and skip setup steps a later action already does.",
    "- Never invent card play, hidden state, names, keys, or scores. Use only App context.",
    "- A team wins by reaching 500 on a hand it bid and made, or by leading by 1000. If gameOver is true, don't score hands; offer rematch, newGame, or saveGame.",
    "- If ui.openPanels includes confirmationModal, yes/confirm/do it means confirmationAction confirm and no/cancel means confirmationAction cancel.",
    "Scoring:",
    "- \"Dem bid 125 and made 145\": scoreRound biddingTeam dem, bidAmount 125, points 145, enterBidderPoints true.",
    "- \"got set\" with no score: scoreRound points 180, enterBidderPoints false, status confirm.",
    "Statistics:",
    "- statistics.players lists saved player names. statistics.teams lists saved teams as [name, name], or {players, name} when the team has its own name.",
    "- For one player's or team's statistics, set statsView and entityMode to players or teams, and entityKey to the player's name exactly as listed, or the team's two player names joined by || (for example Alice||Bob). Two named players who form a saved team mean that team.",
    "Library: library.completed and library.freezer entries show position (the number the user sees) and index (use this in gameLibraryAction).",
    ...buildToolPromptLines(),
    "Examples:",
    "\"open settings\" => {\"status\":\"execute\",\"summary\":\"Open settings\",\"message\":\"Opening settings.\",\"requiresConfirmation\":false,\"heardText\":\"open settings\",\"actions\":[{\"type\":\"openModal\",\"target\":\"settings\"}]}",
    "\"that last hand was 140\" when the last recentRounds entry is us bidding 130 => actions [{\"type\":\"replaceLastRound\",\"biddingTeam\":\"us\",\"bidAmount\":130,\"points\":140,\"enterBidderPoints\":true}]",
    "\"what's the score?\" => {\"status\":\"answer\",\"summary\":\"Current score\",\"message\":\"Us has 320 and Dem has 275, so Us leads by 45.\",\"requiresConfirmation\":false,\"heardText\":\"what's the score?\",\"actions\":[]}",
    "\"show Alice's stats\" when statistics.players includes Alice => actions [{\"type\":\"setStatsControls\",\"statsView\":\"players\",\"entityMode\":\"players\",\"entityKey\":\"Alice\"}]",
    "\"search saved games for Alice\" => actions [{\"type\":\"gameLibraryAction\",\"gameAction\":\"search\",\"gameType\":\"completed\",\"query\":\"Alice\"}]",
    "\"make our color blue\" => actions [{\"type\":\"setThemeColors\",\"usColor\":\"#3b82f6\"}]",
  ].join("\n");
}

const SYSTEM_PROMPT = buildSystemPrompt();

function buildUserTextContent({ transcript, context, hasAudio }) {
  return [
    hasAudio
      ? "The current voice request is in the attached audio."
      : `Current voice transcript: ${transcript}`,
    transcript && hasAudio ? `Optional text transcript hint: ${transcript}` : "",
    `App context JSON: ${JSON.stringify(context)}`,
    "Return the JSON now.",
  ].filter(Boolean).join("\n");
}

function buildOpenRouterMessages(payload) {
  const conversation = sanitizeConversation(payload.conversation).map(message => ({
    role: message.role,
    content: message.role === "user"
      ? `Earlier voice request: ${message.content}`
      : `Your earlier reply: ${message.content}`,
  }));

  const textContent = buildUserTextContent({
    transcript: payload.transcript,
    context: payload.context,
    hasAudio: Boolean(payload.audio),
  });

  const userContent = payload.audio
    ? [
        { type: "text", text: textContent },
        {
          type: "input_audio",
          input_audio: {
            data: payload.audio.data,
            format: payload.audio.format,
          },
        },
      ]
    : textContent;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversation,
    { role: "user", content: userContent },
  ];
}

function extractJsonObject(text) {
  const content = String(text || "").trim();
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {}

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(content.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function normalizePlan(plan, fallbackHeardText = "") {
  const normalized = plan && typeof plan === "object" ? plan : {};
  let actions = Array.isArray(normalized.actions)
    ? normalized.actions
        .filter(action => action && typeof action === "object" && ACTION_TYPES.has(action.type))
        .slice(0, 5)
    : [];
  let status = PLAN_STATUSES.has(normalized.status)
    ? normalized.status
    : actions.length
      ? "execute"
      : "clarify";
  let message = typeof normalized.message === "string" ? normalized.message.slice(0, MAX_MESSAGE_LENGTH) : "";

  // Answers are read-only, and a plan that says to act must name an action the
  // app can run; otherwise the user is asked to try again instead.
  if (status === "answer") actions = [];
  if ((status === "execute" || status === "confirm") && !actions.length) {
    status = "clarify";
    message = message || "I didn't catch an action. Please try again.";
  }
  const canAct = status === "execute" || status === "confirm";

  return {
    status,
    summary: typeof normalized.summary === "string" ? normalized.summary.slice(0, 200) : "",
    message,
    requiresConfirmation: canAct && Boolean(normalized.requiresConfirmation || status === "confirm"),
    heardText: String(normalized.heardText || fallbackHeardText || "").trim().slice(0, MAX_HEARD_TEXT_LENGTH),
    actions,
    ...(typeof normalized.plannerModel === "string"
      ? { plannerModel: normalized.plannerModel.slice(0, 120) }
      : {}),
    ...(typeof normalized.plannerRevision === "string"
      ? { plannerRevision: normalized.plannerRevision.slice(0, 80) }
      : {}),
  };
}

// --- Statistics grounding ---
// The model sometimes opens the statistics panel without choosing the named
// player or team. When the heard request names exactly one saved entity, pin
// the action to it so the right details open.
function normalizeCommandText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getContextStatisticsEntries(context, mode) {
  const entries = Array.isArray(context?.statistics?.[mode]) ? context.statistics[mode] : [];
  return entries
    .map(entry => {
      if (mode === "players") {
        // Current clients send names; older cached clients send {key, name}.
        const name = String((typeof entry === "string" ? entry : entry?.name) || "").trim();
        const key = String((typeof entry === "string" ? entry : entry?.key || entry?.name) || "").trim();
        return { key, name, players: [] };
      }
      const players = (Array.isArray(entry)
        ? entry
        : Array.isArray(entry?.players) ? entry.players : String(entry?.key || "").split("||"))
        .map(name => String(name || "").trim())
        .filter(Boolean);
      const key = String((!Array.isArray(entry) && entry?.key) || players.join("||")).trim();
      const name = String((!Array.isArray(entry) && entry?.name) || players.join(" & ")).trim();
      return { key, name, players };
    })
    .filter(entry => entry.key && entry.name);
}

function commandTextIncludesPhrase(commandText, phrase) {
  const normalizedPhrase = normalizeCommandText(phrase);
  return Boolean(normalizedPhrase)
    && ` ${commandText} `.includes(` ${normalizedPhrase} `);
}

function uniqueStatisticsEntries(entries) {
  const seen = new Set();
  return entries.filter(entry => {
    const id = `${entry.mode}:${entry.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function resolveContextStatisticsEntity(transcript, context = {}) {
  const text = normalizeCommandText(transcript);
  if (!text || !/\bstats?\b|\bstatistics?\b/.test(text)) return null;

  const players = getContextStatisticsEntries(context, "players")
    .map(entry => ({ ...entry, mode: "players" }));
  const teams = getContextStatisticsEntries(context, "teams")
    .map(entry => ({ ...entry, mode: "teams" }));
  const playerMatches = players.filter(entry => commandTextIncludesPhrase(text, entry.name));
  const teamNameMatches = teams.filter(entry => commandTextIncludesPhrase(text, entry.name));
  const teamMemberMatches = teams.filter(entry => (
    entry.players.length > 1
    && entry.players.every(name => commandTextIncludesPhrase(text, name))
  ));
  const teamMatches = uniqueStatisticsEntries([...teamNameMatches, ...teamMemberMatches]);
  const wantsTeam = /\b(?:teams?|pairs?|duos?|partners?)\b/.test(text);
  const wantsPlayer = /\b(?:players?|individuals?|persons?)\b/.test(text);

  if (wantsTeam && !wantsPlayer) {
    if (teamMatches.length === 1) return teamMatches[0];
    if (playerMatches.length === 1) {
      const matchedPlayerName = normalizeCommandText(playerMatches[0].name);
      const teamsWithPlayer = teams.filter(team => team.players.some(
        name => normalizeCommandText(name) === matchedPlayerName,
      ));
      if (teamsWithPlayer.length === 1) return teamsWithPlayer[0];
    }
    return null;
  }

  if (wantsPlayer && !wantsTeam) {
    return playerMatches.length === 1 ? playerMatches[0] : null;
  }

  if (teamMatches.length === 1 && (teamNameMatches.length === 1 || playerMatches.length > 1)) {
    return teamMatches[0];
  }
  if (playerMatches.length === 1) return playerMatches[0];
  return teamMatches.length === 1 ? teamMatches[0] : null;
}

function buildStatisticsControl(transcript, context = {}) {
  const text = normalizeCommandText(transcript);
  if (!/\bstats?\b|\bstatistics?\b/.test(text)) return null;

  const action = { type: "setStatsControls" };
  if (/\bplayers?|individuals?\b/.test(text)) action.statsView = "players";
  if (/\bteams?\b/.test(text)) action.statsView = "teams";
  if (/\bnet(?: per game)?|margin|point differential\b/.test(text)) action.statsMetric = "netPerGame";
  if (/\bbid (?:make|win|success)|success percentage|win percentage\b/.test(text)) action.statsMetric = "bidMakePct";
  if (/\bsets? forced|forced sets?\b/.test(text)) action.statsMetric = "setsForced";
  if (/\bcomebacks?\b/.test(text)) action.statsMetric = "comebacks";
  if (/\bclose wins?\b/.test(text)) action.statsMetric = "closeWins";
  if (/\b360s?|perfect 360s?\b/.test(text)) action.statsMetric = "perfect360s";
  if (/\bmisdeals?\b/.test(text)) action.statsMetric = "misdeals";
  if (/\bgames? played\b/.test(text)) action.statsMetric = "games";
  if (/\bleast|lowest\b/.test(text)) action.statsSort = "least";
  if (/\bmost|highest\b/.test(text)) action.statsSort = "most";
  if (/\brecent|newest\b/.test(text)) action.statsSort = "recent";

  const entity = resolveContextStatisticsEntity(transcript, context);
  if (entity) {
    action.statsView = entity.mode;
    action.entityMode = entity.mode;
    action.entityKey = entity.key;
  }

  return Object.keys(action).length > 1 ? { action, entity } : null;
}

function groundStatisticsEntityPlan(plan, payload) {
  const normalizedPlan = normalizePlan(plan);
  // Audio requests carry no transcript, so ground on what the planner heard.
  const statisticsControl = buildStatisticsControl(
    payload?.transcript || normalizedPlan.heardText,
    payload?.context,
  );
  if (!statisticsControl?.entity) return normalizedPlan;

  const groundedAction = statisticsControl.action;
  const entityFields = {
    statsView: statisticsControl.entity.mode,
    entityMode: statisticsControl.entity.mode,
    entityKey: statisticsControl.entity.key,
  };
  const actions = [...normalizedPlan.actions];
  const statsActionIndex = actions.findIndex(action => action.type === "setStatsControls");
  const statisticsModalIndex = actions.findIndex(
    action => action.type === "openModal" && action.target === "statistics",
  );

  if (statsActionIndex >= 0) {
    actions[statsActionIndex] = { ...groundedAction, ...actions[statsActionIndex], ...entityFields };
  } else if (statisticsModalIndex >= 0) {
    actions[statisticsModalIndex] = groundedAction;
  } else if (actions.length && actions.length < 5) {
    actions.push(groundedAction);
  } else if (!actions.length) {
    const name = statisticsControl.entity.name;
    return {
      ...normalizedPlan,
      status: "execute",
      summary: `Show statistics for ${name}`,
      message: `Showing statistics for ${name}.`,
      requiresConfirmation: false,
      actions: [groundedAction],
    };
  }

  return {
    ...normalizedPlan,
    status: normalizedPlan.requiresConfirmation ? "confirm" : "execute",
    actions,
  };
}

function getOpenRouterMaxAttempts() {
  const configuredAttempts = Number(process.env.OPENROUTER_MAX_ATTEMPTS);
  if (!Number.isFinite(configuredAttempts)) return DEFAULT_OPENROUTER_MAX_ATTEMPTS;
  return Math.max(1, Math.min(4, Math.round(configuredAttempts)));
}

function getOpenRouterReasoningEffort() {
  const configured = String(process.env.OPENROUTER_REASONING_EFFORT || "").trim().toLowerCase();
  return OPENROUTER_REASONING_EFFORTS.has(configured) ? configured : DEFAULT_OPENROUTER_REASONING_EFFORT;
}

function getOpenRouterFallbackModels(primaryModel) {
  const configuredModels = String(process.env.OPENROUTER_FALLBACK_MODELS || "")
    .split(",")
    .map(model => model.trim())
    .filter(Boolean);
  return [...new Set([
    ...(configuredModels.length ? configuredModels : DEFAULT_OPENROUTER_FALLBACK_MODELS),
  ])]
    .filter(model => model !== primaryModel)
    .slice(0, 3);
}

function shouldRetryOpenRouterError(error, attempt, maxAttempts) {
  if (attempt >= maxAttempts) return false;
  const statusCode = Number(error?.statusCode) || 0;
  return statusCode === 408
    || statusCode === 429
    || statusCode >= 500
    || /provider returned error/i.test(String(error?.message || ""));
}

function createOpenRouterError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.isOpenRouterFailure = true;
  return error;
}

async function fetchOpenRouterPlan(payload, apiKey, timeoutMs = OPENROUTER_ATTEMPT_TIMEOUT_MS) {
  const primaryModel = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  const fallbackModels = getOpenRouterFallbackModels(primaryModel);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let responseText;
  try {
    response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://rook-score.vercel.app",
        "X-OpenRouter-Title": process.env.OPENROUTER_APP_TITLE || "Rook Score",
      },
      body: JSON.stringify({
        model: primaryModel,
        ...(fallbackModels.length ? { models: fallbackModels } : {}),
        messages: buildOpenRouterMessages(payload),
        temperature: 0,
        max_tokens: 700,
        reasoning: { effort: getOpenRouterReasoningEffort() },
        // Gemini rejects the complete action schema as too complex for constrained
        // decoding. JSON object mode still guarantees parseable JSON, while
        // normalizePlan enforces the server-owned action allowlist below.
        response_format: { type: "json_object" },
        provider: { require_parameters: true },
      }),
      signal: controller.signal,
    });
    responseText = await response.text();
  } catch (error) {
    if (controller.signal.aborted) {
      throw createOpenRouterError(`OpenRouter did not answer within ${timeoutMs} ms.`, 504);
    }
    error.statusCode = Number(error.statusCode) || 503;
    error.isOpenRouterFailure = true;
    throw error;
  } finally {
    clearTimeout(timer);
  }

  let responseJson = {};
  try {
    responseJson = responseText ? JSON.parse(responseText) : {};
  } catch {
    responseJson = {};
  }

  if (!response.ok) {
    throw createOpenRouterError(
      responseJson?.error?.message || `OpenRouter failed with HTTP ${response.status}.`,
      response.status,
    );
  }

  if (responseJson?.error) {
    throw createOpenRouterError(
      responseJson.error.message || "OpenRouter returned an in-band provider error.",
      Number(responseJson.error.code) || 502,
    );
  }

  const content = responseJson?.choices?.[0]?.message?.content;
  const parsedPlan = typeof content === "object" && content !== null
    ? content
    : extractJsonObject(content);

  if (!parsedPlan) {
    throw createOpenRouterError("OpenRouter returned an invalid action plan.", 502);
  }

  return {
    ...normalizePlan(parsedPlan, payload.transcript),
    plannerModel: String(responseJson.model || primaryModel).slice(0, 120),
    plannerRevision: VOICE_COMMAND_REVISION,
  };
}

async function requestOpenRouterPlan(payload) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const error = new Error("OpenRouter is not configured.");
    error.statusCode = 500;
    error.code = "OPENROUTER_MISSING_KEY";
    throw error;
  }

  const maxAttempts = getOpenRouterMaxAttempts();
  const deadline = Date.now() + VOICE_PLAN_TIME_BUDGET_MS;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remainingMs = deadline - Date.now();
    try {
      return await fetchOpenRouterPlan(payload, apiKey, Math.min(OPENROUTER_ATTEMPT_TIMEOUT_MS, remainingMs));
    } catch (error) {
      lastError = error;
      if (!shouldRetryOpenRouterError(error, attempt, maxAttempts)
          || deadline - Date.now() < MIN_RETRY_TIME_MS) {
        break;
      }
    }
  }
  throw lastError;
}

module.exports = async function handler(request, response) {
  setCorsHeaders(request, response, { methods: "GET, POST, OPTIONS", envNames: ALLOWED_ORIGIN_ENV_NAMES });
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Voice-Command-Revision", VOICE_COMMAND_REVISION);

  try {
    assertBrowserOrigin(request, ALLOWED_ORIGIN_ENV_NAMES, "This site is not allowed to use voice actions.");

    if (request.method === "OPTIONS") {
      return response.status(204).end();
    }

    // The app sends a bodiless GET while the mic is held so the connection and
    // function instance are warm by the time the recording is uploaded.
    if (request.method === "GET" || request.method === "HEAD") {
      return response.status(204).end();
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST, OPTIONS");
      return response.status(405).json({ error: "Method not allowed" });
    }

    rateLimiter.enforce(request, response);
    const bodyBuffer = await readRequestBody(request);
    const payload = parseRequestPayload(bodyBuffer, request.headers?.["content-type"]);
    const plan = groundStatisticsEntityPlan(await requestOpenRouterPlan(payload), payload);
    return response.status(200).json({ plan });
  } catch (error) {
    const statusCode = error.isOpenRouterFailure
      ? (error.statusCode === 504 ? 504 : 502)
      : Number(error.statusCode) || 500;
    console.error("voice-score-command failed", {
      code: error.code || "VOICE_COMMAND_FAILED",
      statusCode,
      providerFailure: Boolean(error.isOpenRouterFailure),
      message: String(error.message || "Unknown voice command failure.").slice(0, 240),
    });
    const safeMessage = statusCode === 504
      ? "Voice planning took too long. Please try again."
      : statusCode >= 500
        ? "Voice command planning is temporarily unavailable. Please try again."
        : error.message;
    return response.status(statusCode).json({ error: safeMessage });
  }
};

module.exports.ACTION_SCHEMA = ACTION_SCHEMA;
module.exports.VOICE_TOOL_DESCRIPTIONS = VOICE_TOOL_DESCRIPTIONS;
module.exports.buildSystemPrompt = buildSystemPrompt;
module.exports.normalizePlan = normalizePlan;
module.exports.resetRateLimitsForTests = () => rateLimiter.reset();
