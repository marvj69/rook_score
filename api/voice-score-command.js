const DEFAULT_ALLOWED_ORIGINS = [
  "https://marvj69.github.io",
  "https://rook-score.vercel.app",
  "https://rook-score-marvj69s-projects.vercel.app",
  "https://rook-score-marvj69-marvj69s-projects.vercel.app",
];

const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.1-flash-lite";
const DEFAULT_OPENROUTER_FALLBACK_MODELS = ["google/gemini-2.5-flash"];
const DEFAULT_OPENROUTER_REASONING_EFFORT = "low";
const DEFAULT_OPENROUTER_MAX_ATTEMPTS = 2;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_CONVERSATION_MESSAGES = 6;
const MAX_CONVERSATION_CONTENT_LENGTH = 1000;
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

const ACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["execute", "confirm", "clarify", "unsupported"],
      description: "Use execute for clear commands, confirm for destructive or ambiguous actions, clarify when required details are missing, and unsupported when the request is outside this app.",
    },
    summary: {
      type: "string",
      description: "Short user-facing summary of what will happen.",
    },
    message: {
      type: "string",
      description: "Clarification, confirmation, or success message for the user.",
    },
    requiresConfirmation: {
      type: "boolean",
      description: "True when the app should ask before executing.",
    },
    actions: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: [
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
            ],
          },
          biddingTeam: { type: "string", enum: ["us", "dem"] },
          bidAmount: { type: "number" },
          points: { type: "number" },
          enterBidderPoints: { type: "boolean" },
          team: { type: "string", enum: ["us", "dem"] },
          target: {
            type: "string",
            enum: [
              "savedGames",
              "settings",
              "about",
              "statistics",
              "dealerOrder",
              "teamSelection",
              "resumeGame",
              "theme",
              "presets",
              "probability",
              "version",
              "confirmation",
              "all",
            ],
          },
          roundNumber: { type: "integer", minimum: 1 },
          usTotal: { type: "number" },
          demTotal: { type: "number" },
          dealers: {
            type: "array",
            minItems: 4,
            maxItems: 4,
            items: { type: "string" },
          },
          usPlayers: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: { type: "string" },
          },
          demPlayers: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: { type: "string" },
          },
          usScore: { type: "number" },
          demScore: { type: "number" },
          pair: { type: "string", enum: ["13", "24"] },
          key: {
            type: "string",
            enum: [
              "mustWinByBid",
              "misdealHandling",
              "proMode",
              "experimentalFeatures",
              "tableTalkPenaltyType",
              "tableTalkPenaltyPoints",
            ],
          },
          value: {
            anyOf: [
              { type: "string" },
              { type: "number" },
              { type: "boolean" },
            ],
          },
          firstDealer: { type: "string" },
          open: { type: "boolean" },
          authAction: { type: "string", enum: ["toggle", "signIn", "signOut"] },
          confirmationChoice: { type: "string", enum: ["confirm", "cancel"] },
          gameAction: { type: "string", enum: ["switchTab", "search", "sort", "view", "delete", "resume"] },
          gameType: { type: "string", enum: ["completed", "freezer"] },
          tab: { type: "string", enum: ["completed", "freezer"] },
          query: { type: "string" },
          sort: { type: "string", enum: ["newest", "oldest", "highest", "lowest"] },
          index: { type: "number" },
          usColor: { type: "string" },
          demColor: { type: "string" },
          themeAction: { type: "string", enum: ["randomize", "reset", "apply"] },
          presets: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: { type: "number" },
          },
          statsView: { type: "string", enum: ["teams", "players"] },
          statsMetric: {
            type: "string",
            enum: ["netPerGame", "bidMakePct", "setsForced", "comebacks", "closeWins", "perfect360s", "misdeals", "games"],
          },
          statsSort: { type: "string", enum: ["recent", "most", "least"] },
          entityMode: {
            type: "string",
            enum: ["teams", "players"],
            description: "Use with entityKey to open one saved team's or player's detailed statistics.",
          },
          entityKey: {
            type: "string",
            description: "Exact key from App context statistics.teams or statistics.players. Never invent a key.",
          },
        },
        required: ["type"],
      },
    },
  },
  required: ["status", "summary", "message", "requiresConfirmation", "actions"],
};

const ACTION_TYPES = new Set(ACTION_SCHEMA.properties.actions.items.properties.type.enum);

function getAllowedOrigins() {
  const configuredOrigins = (process.env.VOICE_SCORE_ALLOWED_ORIGINS || process.env.FIREBASE_CONFIG_ALLOWED_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);
}

function setCorsHeaders(request, response) {
  const origin = request.headers?.origin;
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");

  if (origin && getAllowedOrigins().has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }
}

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

    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
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

function parseAudioPayload(payload) {
  const rawAudio = typeof payload.audioBase64 === "string" ? payload.audioBase64 : "";
  if (!rawAudio) return null;

  const base64Audio = rawAudio.includes(",") ? rawAudio.split(",").pop() : rawAudio;
  const mimeType = typeof payload.mimeType === "string" && payload.mimeType
    ? payload.mimeType.split(";")[0].trim().toLowerCase()
    : "audio/webm";
  const format = resolveAudioFormat(mimeType);
  if (!format) {
    const error = new Error("Unsupported audio format.");
    error.statusCode = 400;
    throw error;
  }

  let audioBuffer;
  try {
    audioBuffer = Buffer.from(base64Audio, "base64");
  } catch {
    const error = new Error("Audio payload is invalid.");
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

function parsePayload(bodyText) {
  let payload;
  try {
    payload = JSON.parse(bodyText || "{}");
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }

  const transcript = typeof payload.transcript === "string" ? payload.transcript.trim() : "";
  if (transcript.length > 1000) {
    const error = new Error("Transcript is too long.");
    error.statusCode = 413;
    throw error;
  }

  const audio = parseAudioPayload(payload);
  if (!transcript && !audio) {
    const error = new Error("Missing voice audio or transcript.");
    error.statusCode = 400;
    throw error;
  }

  const context = payload.context && typeof payload.context === "object" ? payload.context : {};
  const localIntent = payload.localIntent && typeof payload.localIntent === "object" ? payload.localIntent : null;
  const conversation = sanitizeConversation(payload.conversation);

  return { transcript, audio, context, localIntent, conversation };
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

function buildSystemPrompt() {
  return [
    "You are an action planner for a Rook scorekeeping web app.",
    "Return only JSON matching the provided schema. Do not include commentary.",
    "Always choose the most likely app action for short spoken voice commands.",
    "When voice audio is attached, listen to it and treat the spoken words as the user request. Do not ask the user to type a transcript.",
    "Prefer concrete app actions over explanation when the user's intent is clear.",
    "Use status=clarify when required values are missing or ambiguous.",
    "Recent conversation messages, when present, contain earlier voice commands and your clarification questions. Use them to interpret a short follow-up answer and complete the original request.",
    "If the latest command is clearly a new standalone request instead of an answer, handle it as a new request.",
    "Use requiresConfirmation/status=confirm for destructive actions such as new game, freeze game, save completed game, rematch without a dealer, or ambiguous score assumptions. Game-library delete/resume actions already open the app's own confirmation, so do not add a second planner confirmation for them.",
    "Never invent card play, strategy, or hidden game state. Use only the provided context.",
    "If deterministicParserIntent.type is scoreRound, undo, or misdeal, convert it directly to the matching action unless the spoken command contradicts it.",
    "If deterministicParserIntent.type is clarification, treat it only as a failed score-parser result. Do not repeat that clarification when the command clearly asks for a non-scoring app action.",
    "Scoring rules: scoreRound requires biddingTeam, bidAmount, points, enterBidderPoints. enterBidderPoints=true means points belong to the bidder; false means points belong to the non-bidding team.",
    "Use editRound to correct saved round history. roundNumber is one-based; usTotal and demTotal are the cumulative scores shown after that round. Include only fields the user asked to change.",
    "For 'got set' without a score, plan scoreRound with points=180, enterBidderPoints=false, requiresConfirmation=true.",
    "For 'misdeal' or 'next dealer', use misdeal. For 'undo', use undo. For 'redo', use redo.",
    "Available tool actions: scoreRound, editRound, undo, redo, misdeal, newGame, freezeGame, saveGame, openModal, closeModal, setDealerOrder, startPaperGame, setTeams, selectDealerPair, selectBid, setSetting, tableTalkPenalty, rematch, toggleMenu, authAction, confirmationAction, gameLibraryAction, setThemeColors, themeAction, setBidPresets, setStatsControls, noop.",
    "Actions execute sequentially. For compound requests, return the smallest ordered set of high-level actions, up to five. Do not emit redundant setup actions before a high-level action that already performs the outcome.",
    "Use toggleMenu with open=true or open=false for the hamburger menu.",
    "Use authAction with authAction='signIn', 'signOut', or 'toggle' for account controls.",
    "Use confirmationAction with confirmationChoice='confirm' or 'cancel' to answer the current confirmation dialog.",
    "Use gameLibraryAction for saved/frozen games: switchTab/search/sort/view/delete/resume. Use gameType completed/freezer and the exact zero-based storage index supplied in App context library entries. The position field is the user-facing game number.",
    "Use setThemeColors with usColor and/or demColor as #RRGGBB. Use themeAction randomize/reset/apply for theme modal controls.",
    "Use setBidPresets with presets array for quick bid buttons.",
    "Use setStatsControls with statsView, statsMetric, statsSort, or entityMode/entityKey to control the statistics modal. Current metrics: netPerGame, bidMakePct, setsForced, comebacks, closeWins, perfect360s, misdeals, games.",
    "For statistics about a specific player or team, find the matching entry in App context statistics.players or statistics.teams. Set statsView and entityMode to that collection and copy its exact key into entityKey. Never use a display name as entityKey and never invent a key.",
    "If a request names two players who appear together in one statistics.teams entry, treat it as that team. If one player is named without asking for their team, use that player's statistics.players entry.",
    "Examples:",
    "Voice 'open settings' => status execute, action {type:'openModal', target:'settings'}.",
    "Voice 'show saved games' => status execute, action {type:'openModal', target:'savedGames'}.",
    "Voice 'Dem bid 125 and made 145' => status execute, action {type:'scoreRound', biddingTeam:'dem', bidAmount:125, points:145, enterBidderPoints:true}.",
    "Voice 'Us bid 130 and got set' => status confirm, requiresConfirmation true, action {type:'scoreRound', biddingTeam:'us', bidAmount:130, points:180, enterBidderPoints:false}.",
    "Voice 'change round 2 Us total to 305' => status execute, action {type:'editRound', roundNumber:2, usTotal:305}.",
    "Voice 'set dealers Alice Bob Carol Dan' => status execute, action {type:'setDealerOrder', dealers:['Alice','Bob','Carol','Dan']}.",
    "Voice 'turn on pro mode' => status execute, action {type:'setSetting', key:'proMode', value:true}.",
    "Voice 'search saved games for Alice' => status execute, action {type:'gameLibraryAction', gameAction:'search', gameType:'completed', query:'Alice'}.",
    "Voice 'show frozen games' => status execute, action {type:'gameLibraryAction', gameAction:'switchTab', tab:'freezer'}.",
    "Voice 'make our color blue' => status execute, action {type:'setThemeColors', usColor:'#3b82f6'}.",
    "Voice 'set bid presets to 120 125 130 135' => status execute, action {type:'setBidPresets', presets:[120,125,130,135]}.",
    "Voice 'show player stats by bid win percentage' => status execute, action {type:'setStatsControls', statsView:'players', statsMetric:'bidMakePct'}.",
    "Voice 'show Alice's stats', when statistics.players contains {key:'alice',name:'Alice'}, => status execute, action {type:'setStatsControls', statsView:'players', entityMode:'players', entityKey:'alice'}.",
    "Voice 'show Alice and Bob's team stats', when statistics.teams contains {key:'alice||bob',players:['Alice','Bob']}, => status execute, action {type:'setStatsControls', statsView:'teams', entityMode:'teams', entityKey:'alice||bob'}.",
    "Modal target names: savedGames, settings, about, statistics, dealerOrder, teamSelection, resumeGame, theme, presets, probability, version, confirmation, all.",
    "Settings keys: mustWinByBid, misdealHandling, proMode, experimentalFeatures, tableTalkPenaltyType, tableTalkPenaltyPoints.",
    "Output shape: {\"status\":\"execute|confirm|clarify|unsupported\",\"summary\":\"...\",\"message\":\"...\",\"requiresConfirmation\":false,\"actions\":[{\"type\":\"openModal\",\"target\":\"settings\"}]}",
  ].join("\n");
}

function buildUserTextContent({ transcript, context, localIntent, hasAudio }) {
  return [
    hasAudio
      ? "Current voice audio is attached. Interpret the spoken command from the audio."
      : `Current voice transcript: ${transcript}`,
    transcript && hasAudio ? `Optional text transcript hint: ${transcript}` : "",
    `App context JSON: ${JSON.stringify(context)}`,
    `Deterministic score-parser JSON: ${JSON.stringify(localIntent)}`,
    "The deterministic score parser only recognizes scoring, undo, and misdeal commands. If it returned clarification or null, still plan clear non-scoring app actions from the spoken request.",
    "Return the action plan JSON now.",
  ].filter(Boolean).join("\n");
}

function buildOpenRouterMessages(payload) {
  const conversation = sanitizeConversation(payload.conversation).map(message => ({
    role: message.role,
    content: message.role === "user"
      ? `Earlier voice command: ${message.content}`
      : `Clarification question: ${message.content}`,
  }));

  const textContent = buildUserTextContent({
    transcript: payload.transcript,
    context: payload.context,
    localIntent: payload.localIntent,
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
    { role: "system", content: buildSystemPrompt() },
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

function normalizePlan(plan) {
  const normalized = plan && typeof plan === "object" ? plan : {};
  const actions = Array.isArray(normalized.actions)
    ? normalized.actions
        .filter(action => action && typeof action === "object" && ACTION_TYPES.has(action.type))
        .slice(0, 5)
    : [];
  const status = ["execute", "confirm", "clarify", "unsupported"].includes(normalized.status)
    ? normalized.status
    : actions.length
      ? "execute"
      : "clarify";

  return {
    status,
    summary: typeof normalized.summary === "string" ? normalized.summary.slice(0, 200) : "",
    message: typeof normalized.message === "string" ? normalized.message.slice(0, 240) : "",
    requiresConfirmation: Boolean(normalized.requiresConfirmation || status === "confirm"),
    actions,
  };
}

function isTruthyEnvValue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function getOpenRouterMaxAttempts() {
  const configuredAttempts = Number(process.env.OPENROUTER_MAX_ATTEMPTS);
  if (!Number.isFinite(configuredAttempts)) return DEFAULT_OPENROUTER_MAX_ATTEMPTS;
  return Math.max(1, Math.min(4, Math.round(configuredAttempts)));
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

function shouldUseLocalCommandFallback() {
  const configuredFallback = process.env.VOICE_SCORE_COMMAND_LOCAL_FALLBACK;
  if (configuredFallback !== undefined) {
    return isTruthyEnvValue(configuredFallback);
  }

  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "development") return false;
  return process.env.NODE_ENV !== "production";
}

function createLocalPlan(status, summary, message, actions, requiresConfirmation = status === "confirm") {
  return normalizePlan({
    status,
    summary,
    message,
    requiresConfirmation,
    actions,
  });
}

function normalizeCommandText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function extractFirstNumber(text) {
  const match = String(text || "").match(/\b\d{1,4}\b/);
  return match ? Number(match[0]) : null;
}

function resolveLocalTeam(text) {
  if (/\b(?:us|we|our|ours)\b/.test(text)) return "us";
  if (/\b(?:dem|them|they|their|theirs)\b/.test(text)) return "dem";
  return null;
}

function getLocalToggleValue(text) {
  if (/\b(?:enable|enabled|on|activate|activated)\b/.test(text)) return true;
  if (/\b(?:disable|disabled|off|deactivate|deactivated)\b/.test(text)) return false;
  return null;
}

const LOCAL_MODAL_TARGETS = [
  { target: "savedGames", label: "saved games", patterns: [/\bsaved games?\b/, /\bgame library\b/, /\blibrary\b/] },
  { target: "settings", label: "settings", patterns: [/\bsettings?\b/, /\bpreferences?\b/] },
  { target: "version", label: "version information", patterns: [/\bversion\b/, /\brelease notes?\b/] },
  { target: "about", label: "about", patterns: [/\babout\b/, /\bapp info\b/] },
  { target: "statistics", label: "statistics", patterns: [/\bstatistics?\b/, /\bstats\b/] },
  { target: "dealerOrder", label: "dealer order", patterns: [/\bdealer order\b/, /\bdealers?\b/] },
  { target: "teamSelection", label: "team selection", patterns: [/\bteam selection\b/, /\bteams?\b/, /\bplayers?\b/] },
  { target: "resumeGame", label: "resume game", patterns: [/\bresume\b/, /\brestore game\b/] },
  { target: "theme", label: "theme", patterns: [/\btheme\b/, /\bcolors?\b/] },
  { target: "presets", label: "bid presets", patterns: [/\bpresets?\b/, /\bbid presets?\b/] },
  { target: "probability", label: "probability", patterns: [/\bprobability\b/, /\bwin chance\b/, /\bwin odds\b/] },
  { target: "confirmation", label: "confirmation", patterns: [/\bconfirmation\b/] },
];

function findLocalModalTarget(text) {
  if (/\b(?:all|everything|modal|panel|popup)\b/.test(text)) {
    return { target: "all", label: "all panels" };
  }
  return LOCAL_MODAL_TARGETS.find(({ patterns }) => patterns.some(pattern => pattern.test(text))) || null;
}

function buildLocalModalPlan(transcript) {
  const text = normalizeCommandText(transcript);
  const isOpen = /\b(?:open|show|view|display|go to)\b/.test(text);
  const isClose = /\b(?:close|dismiss|hide|exit)\b/.test(text);
  if (!isOpen && !isClose) return null;

  const modal = findLocalModalTarget(text);
  if (!modal) return null;

  const action = isClose
    ? { type: "closeModal", target: modal.target }
    : { type: "openModal", target: modal.target };
  const verb = isClose ? "Close" : "Open";
  return createLocalPlan("execute", `${verb} ${modal.label}`, `${verb}ing ${modal.label}.`, [action]);
}

function buildLocalDealerPlan(transcript) {
  const match = String(transcript || "").match(/\b(?:set\s+(?:the\s+)?dealers?|dealer\s+order(?:\s+is)?|dealers?\s+are)\s+(.+)$/i);
  if (!match) return null;

  const dealers = match[1]
    .replace(/\b(?:to|as)\b/gi, " ")
    .split(/\s*(?:,|\band\b)\s*|\s+/i)
    .map(titleCaseName)
    .filter(Boolean);

  if (dealers.length !== 4 || new Set(dealers.map(name => name.toLowerCase())).size !== 4) return null;

  return createLocalPlan(
    "execute",
    `Set dealer order to ${dealers.join(", ")}`,
    `Dealer order set to ${dealers.join(", ")}.`,
    [{ type: "setDealerOrder", dealers }],
  );
}

function buildLocalPaperGamePlan(transcript) {
  const text = normalizeCommandText(transcript);
  if (!/\b(?:paper game|starting scores?|start from)\b/.test(text)) return null;

  const scores = text.match(/-?\d{1,4}/g)?.map(Number) || [];
  if (scores.length < 2) return null;

  return createLocalPlan(
    "execute",
    `Start paper game at ${scores[0]} to ${scores[1]}`,
    `Starting scores will be ${scores[0]} to ${scores[1]}.`,
    [{ type: "startPaperGame", usScore: scores[0], demScore: scores[1] }],
  );
}

function buildLocalSettingPlan(transcript) {
  const text = normalizeCommandText(transcript);
  const toggleValue = getLocalToggleValue(text);

  if (/\bpro mode\b/.test(text) && toggleValue !== null) {
    return createLocalPlan(
      "execute",
      toggleValue ? "Turn on pro mode" : "Turn off pro mode",
      toggleValue ? "Pro mode will be turned on." : "Pro mode will be turned off.",
      [{ type: "setSetting", key: "proMode", value: toggleValue }],
    );
  }

  if (/\bexperimental features?\b/.test(text) && toggleValue !== null) {
    return createLocalPlan(
      "execute",
      toggleValue ? "Turn on experimental features" : "Turn off experimental features",
      toggleValue ? "Experimental features will be turned on." : "Experimental features will be turned off.",
      [{ type: "setSetting", key: "experimentalFeatures", value: toggleValue }],
    );
  }

  if (/\bmust win by bid\b/.test(text) && toggleValue !== null) {
    return createLocalPlan(
      "execute",
      toggleValue ? "Turn on must win by bid" : "Turn off must win by bid",
      toggleValue ? "Must win by bid will be turned on." : "Must win by bid will be turned off.",
      [{ type: "setSetting", key: "mustWinByBid", value: toggleValue }],
    );
  }

  if (/\bmisdeal handling\b/.test(text) && toggleValue !== null) {
    return createLocalPlan(
      "execute",
      toggleValue ? "Turn on misdeal handling" : "Turn off misdeal handling",
      toggleValue ? "Misdeal handling will be turned on." : "Misdeal handling will be turned off.",
      [{ type: "setSetting", key: "misdealHandling", value: toggleValue }],
    );
  }

  if (/\btable talk\b/.test(text) && /\b(?:lost bid|lose bid)\b/.test(text)) {
    return createLocalPlan(
      "execute",
      "Set table-talk penalty to lost bid",
      "Table-talk penalty will use the lost bid.",
      [{ type: "setSetting", key: "tableTalkPenaltyType", value: "loseBid" }],
    );
  }

  if (/\btable talk\b/.test(text) && /\b(?:set points|fixed points)\b/.test(text)) {
    return createLocalPlan(
      "execute",
      "Set table-talk penalty to set points",
      "Table-talk penalty will use set points.",
      [{ type: "setSetting", key: "tableTalkPenaltyType", value: "setPoints" }],
    );
  }

  if (/\btable talk\b/.test(text) && /\bpoints?\b/.test(text)) {
    const points = extractFirstNumber(text);
    if (points !== null) {
      return createLocalPlan(
        "execute",
        `Set table-talk penalty to ${points} points`,
        `Table-talk penalty points will be ${points}.`,
        [{ type: "setSetting", key: "tableTalkPenaltyPoints", value: points }],
      );
    }
  }

  return null;
}

function extractNumberList(text) {
  return (String(text || "").match(/\b\d{1,4}\b/g) || []).map(Number);
}

const LOCAL_GAME_ORDINALS = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

function parseLocalGamePosition(value) {
  const normalized = String(value || "").toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LOCAL_GAME_ORDINALS, normalized)) {
    return LOCAL_GAME_ORDINALS[normalized];
  }
  const numericMatch = normalized.match(/^(\d+)(?:st|nd|rd|th)?$/);
  const numeric = numericMatch ? Number(numericMatch[1]) : NaN;
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function resolveContextGameIndex(context, gameType, position) {
  const contextKey = gameType === "freezer" ? "freezer" : "completed";
  const entries = Array.isArray(context?.library?.[contextKey]) ? context.library[contextKey] : [];
  const entry = entries.find(candidate => Number(candidate?.position) === position) || entries[position - 1];
  const contextIndex = Number(entry?.index);
  return Number.isInteger(contextIndex) && contextIndex >= 0 ? contextIndex : position - 1;
}

function getContextStatisticsEntries(context, mode) {
  const entries = Array.isArray(context?.statistics?.[mode]) ? context.statistics[mode] : [];
  return entries
    .filter(entry => entry && typeof entry === "object" && typeof entry.key === "string" && entry.key.trim())
    .map(entry => ({
      key: entry.key.trim(),
      name: typeof entry.name === "string" ? entry.name.trim() : "",
      players: mode === "teams"
        ? (Array.isArray(entry.players) ? entry.players : entry.key.split("||"))
            .map(name => String(name || "").trim())
            .filter(Boolean)
        : [],
    }));
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

function buildLocalExpandedControlPlan(transcript, context = {}) {
  const text = normalizeCommandText(transcript);

  if (/\b(?:open|show)\s+(?:the\s+)?menu\b/.test(text)) {
    return createLocalPlan("execute", "Open menu", "Opening the menu.", [{ type: "toggleMenu", open: true }]);
  }

  if (/\b(?:close|hide)\s+(?:the\s+)?menu\b/.test(text)) {
    return createLocalPlan("execute", "Close menu", "Closing the menu.", [{ type: "toggleMenu", open: false }]);
  }

  if (/\b(?:confirm|yes|okay|ok|do it|proceed)\b/.test(text) && /\b(?:action|that|confirm)\b/.test(text)) {
    return createLocalPlan("execute", "Confirm action", "Confirming the current action.", [{ type: "confirmationAction", confirmationChoice: "confirm" }]);
  }

  if (/\b(?:cancel|no|never mind|dismiss)\b/.test(text) && /\b(?:action|that|confirmation|dialog)\b/.test(text)) {
    return createLocalPlan("execute", "Cancel action", "Canceling the current action.", [{ type: "confirmationAction", confirmationChoice: "cancel" }]);
  }

  if (/\b(?:sign in|log in|login)\b/.test(text)) {
    return createLocalPlan("execute", "Sign in", "Opening sign in.", [{ type: "authAction", authAction: "signIn" }]);
  }

  if (/\b(?:sign out|log out|logout)\b/.test(text)) {
    return createLocalPlan("execute", "Sign out", "Signing out.", [{ type: "authAction", authAction: "signOut" }]);
  }

  if (/\b(?:frozen|freezer)\s+games?\b/.test(text)) {
    return createLocalPlan("execute", "Show frozen games", "Showing frozen games.", [{ type: "gameLibraryAction", gameAction: "switchTab", tab: "freezer" }]);
  }

  if (/\b(?:completed|saved)\s+games?\b/.test(text) && /\b(?:tab|show|view)\b/.test(text)) {
    return createLocalPlan("execute", "Show completed games", "Showing completed games.", [{ type: "gameLibraryAction", gameAction: "switchTab", tab: "completed" }]);
  }

  const searchMatch = String(transcript || "").match(/\bsearch\s+(?:saved\s+games?|games?|library)\s+(?:for\s+)?(.+)$/i);
  if (searchMatch && searchMatch[1]?.trim()) {
    return createLocalPlan(
      "execute",
      `Search games for ${searchMatch[1].trim()}`,
      "Searching the game library.",
      [{ type: "gameLibraryAction", gameAction: "search", query: searchMatch[1].trim() }],
    );
  }

  if (/\bsort\b/.test(text) && /\bgames?\b/.test(text)) {
    const sort = /\boldest\b/.test(text) ? "oldest"
      : /\bhighest\b/.test(text) ? "highest"
        : /\blowest\b/.test(text) ? "lowest"
          : "newest";
    return createLocalPlan("execute", "Sort games", "Sorting games.", [{ type: "gameLibraryAction", gameAction: "sort", sort }]);
  }

  const libraryItemMatch = String(transcript || "").match(
    /\b(view|open|delete|remove|resume|load)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)?)\s+(?:(completed|saved|frozen|freezer)\s+)?game\b/i,
  );
  if (libraryItemMatch) {
    const verb = libraryItemMatch[1].toLowerCase();
    const position = parseLocalGamePosition(libraryItemMatch[2]);
    const typeHint = String(libraryItemMatch[3] || "").toLowerCase();
    const gameType = /frozen|freezer/.test(typeHint) || /resume|load/.test(verb) ? "freezer" : "completed";
    const gameAction = /delete|remove/.test(verb) ? "delete"
      : /resume|load/.test(verb) ? "resume"
        : "view";
    const index = resolveContextGameIndex(context, gameType, position);
    return createLocalPlan(
      "execute",
      `${gameAction === "delete" ? "Delete" : gameAction === "resume" ? "Resume" : "View"} ${gameType} game ${position}`,
      `${gameAction === "delete" ? "Opening delete confirmation for" : gameAction === "resume" ? "Opening resume confirmation for" : "Opening"} game ${position}.`,
      [{ type: "gameLibraryAction", gameAction, gameType, index }],
    );
  }

  const presets = /\bpresets?\b/.test(text) ? extractNumberList(text) : [];
  if (presets.length) {
    return createLocalPlan(
      "execute",
      `Set bid presets to ${presets.join(", ")}`,
      "Updating bid presets.",
      [{ type: "setBidPresets", presets }],
    );
  }

  if (/\brandom(?:ize)?\b/.test(text) && /\b(?:theme|colors?)\b/.test(text)) {
    return createLocalPlan("execute", "Randomize theme colors", "Randomizing theme colors.", [{ type: "themeAction", themeAction: "randomize" }]);
  }

  if (/\breset\b/.test(text) && /\b(?:theme|colors?)\b/.test(text)) {
    return createLocalPlan("execute", "Reset theme colors", "Resetting theme colors.", [{ type: "themeAction", themeAction: "reset" }]);
  }

  const statisticsControl = buildStatisticsControl(transcript, context);
  if (statisticsControl) {
    const entityName = statisticsControl.entity?.name;
    return createLocalPlan(
      "execute",
      entityName ? `Show statistics for ${entityName}` : "Update statistics view",
      entityName ? `Showing statistics for ${entityName}.` : "Updating statistics.",
      [statisticsControl.action],
    );
  }

  return null;
}

function buildLocalActionPlanFromIntent(localIntent) {
  if (!localIntent || typeof localIntent !== "object") return null;

  if (localIntent.type === "scoreRound") {
    const action = {
      type: "scoreRound",
      biddingTeam: localIntent.biddingTeam,
      bidAmount: Number(localIntent.bidAmount),
      points: Number(localIntent.points),
      enterBidderPoints: localIntent.enterBidderPoints !== false,
    };
    const requiresConfirmation = Boolean(localIntent.requiresConfirmation);
    return createLocalPlan(
      requiresConfirmation ? "confirm" : "execute",
      localIntent.summary || "Score round",
      localIntent.ambiguity || localIntent.summary || "Record this score.",
      [action],
      requiresConfirmation,
    );
  }

  if (localIntent.type === "undo") {
    return createLocalPlan("execute", "Undo last hand", "Undoing the last hand.", [{ type: "undo" }]);
  }

  if (localIntent.type === "misdeal") {
    return createLocalPlan("execute", "Misdeal, next dealer", "Moving to the next dealer.", [{ type: "misdeal" }]);
  }

  return null;
}

function buildLocalActionPlanFromTranscript(transcript, context = {}) {
  const text = normalizeCommandText(transcript);
  if (!text) return null;

  if (/\b(?:never mind|cancel that|do nothing)\b/.test(text)) {
    return createLocalPlan("execute", "No action", "No action taken.", [{ type: "noop" }]);
  }

  if (/\bredo\b/.test(text)) {
    return createLocalPlan("execute", "Redo hand", "Redoing the last undone hand.", [{ type: "redo" }]);
  }

  if (/\b(?:undo|take back|go back)\b/.test(text)) {
    return createLocalPlan("execute", "Undo last hand", "Undoing the last hand.", [{ type: "undo" }]);
  }

  if (/\bmisdeal\b/.test(text) || /\b(?:next|move|skip)\s+dealer\b/.test(text)) {
    return createLocalPlan("execute", "Misdeal, next dealer", "Moving to the next dealer.", [{ type: "misdeal" }]);
  }

  if (/\b(?:new game|start over|reset game)\b/.test(text)) {
    return createLocalPlan(
      "confirm",
      "Start a new game",
      "Starting a new game will clear the current game. Confirm to proceed.",
      [{ type: "newGame" }],
      true,
    );
  }

  if (/\bfreeze\b/.test(text) && /\bgame\b/.test(text)) {
    return createLocalPlan(
      "confirm",
      "Freeze current game",
      "Confirm freezing the current game.",
      [{ type: "freezeGame" }],
      true,
    );
  }

  if (/\bsave\b/.test(text) && /\bgame\b/.test(text)) {
    return createLocalPlan("execute", "Save current game", "Saving the current game.", [{ type: "saveGame" }]);
  }

  const rematchDealerMatch = String(transcript || "").match(/\brematch\b.*?\b(?:with\s+)?(.+?)\s+(?:dealing|dealer)(?:\s+first)?\b/i);
  if (rematchDealerMatch?.[1]?.trim()) {
    const firstDealer = titleCaseName(rematchDealerMatch[1]);
    return createLocalPlan(
      "execute",
      `Start a rematch with ${firstDealer} dealing first`,
      `Starting a rematch with ${firstDealer} dealing first.`,
      [{ type: "rematch", firstDealer }],
    );
  }

  if (/\brematch\b/.test(text)) {
    return createLocalPlan(
      "confirm",
      "Start a rematch",
      "Confirm starting a rematch.",
      [{ type: "rematch" }],
      true,
    );
  }

  const teamsMatch = String(transcript || "").match(/\bset\s+(?:the\s+)?teams?\s+(.+?)\s+(?:vs\.?|versus|against)\s+(.+)$/i);
  if (teamsMatch) {
    const parseTeam = value => String(value || "")
      .split(/\s+and\s+/i)
      .map(titleCaseName)
      .filter(Boolean);
    const usPlayers = parseTeam(teamsMatch[1]);
    const demPlayers = parseTeam(teamsMatch[2]);
    if (usPlayers.length === 2 && demPlayers.length === 2) {
      return createLocalPlan(
        "execute",
        `Set teams to ${usPlayers.join(" and ")} versus ${demPlayers.join(" and ")}`,
        "Updating both teams.",
        [{ type: "setTeams", usPlayers, demPlayers }],
      );
    }
  }

  const settingPlan = buildLocalSettingPlan(transcript);
  if (settingPlan) return settingPlan;

  const expandedControlPlan = buildLocalExpandedControlPlan(transcript, context);
  if (expandedControlPlan) return expandedControlPlan;

  const modalPlan = buildLocalModalPlan(transcript);
  if (modalPlan) return modalPlan;

  const dealerPlan = buildLocalDealerPlan(transcript);
  if (dealerPlan) return dealerPlan;

  const paperGamePlan = buildLocalPaperGamePlan(transcript);
  if (paperGamePlan) return paperGamePlan;

  const editRoundMatch = String(transcript || "").match(/\b(?:edit|change|fix|set)\s+round\s+(\d+)\b/i);
  if (editRoundMatch) {
    const action = { type: "editRound", roundNumber: Number(editRoundMatch[1]) };
    const bidMatch = String(transcript || "").match(/\bbid(?:\s+amount)?\s*(?:to|is|=)?\s*(-?\d+)\b/i);
    const usMatch = String(transcript || "").match(/\b(?:us|our)\s+(?:score|total)\s*(?:to|is|=)?\s*(-?\d+)\b/i);
    const demMatch = String(transcript || "").match(/\b(?:dem|their)\s+(?:score|total)\s*(?:to|is|=)?\s*(-?\d+)\b/i);
    if (bidMatch) action.bidAmount = Number(bidMatch[1]);
    if (usMatch) action.usTotal = Number(usMatch[1]);
    if (demMatch) action.demTotal = Number(demMatch[1]);
    if (bidMatch || usMatch || demMatch) {
      return createLocalPlan(
        "execute",
        `Edit round ${action.roundNumber}`,
        `Updating round ${action.roundNumber}.`,
        [action],
      );
    }
  }

  if (/\b(?:pair one three|pair 1 3|pair 13|one three)\b/.test(text)) {
    return createLocalPlan("execute", "Select dealer pair one-three", "Selecting dealer pair one-three.", [{ type: "selectDealerPair", pair: "13" }]);
  }

  if (/\b(?:pair two four|pair 2 4|pair 24|two four)\b/.test(text)) {
    return createLocalPlan("execute", "Select dealer pair two-four", "Selecting dealer pair two-four.", [{ type: "selectDealerPair", pair: "24" }]);
  }

  if (/\btable talk\b/.test(text) && /\bpenalty\b/.test(text)) {
    const team = resolveLocalTeam(text);
    if (team) {
      return createLocalPlan("execute", "Apply table-talk penalty", "Applying the table-talk penalty.", [{ type: "tableTalkPenalty", team }]);
    }
  }

  if (/\bbid\b/.test(text) && !/\b(?:made|got|set|scored|scores|points?)\b/.test(text)) {
    const team = resolveLocalTeam(text);
    const bidAmount = extractFirstNumber(text);
    if (team && bidAmount !== null) {
      return createLocalPlan(
        "execute",
        `${team === "us" ? "Us" : "Dem"} bid ${bidAmount}`,
        `Selecting ${team === "us" ? "Us" : "Dem"} bid ${bidAmount}.`,
        [{ type: "selectBid", biddingTeam: team, bidAmount }],
      );
    }
  }

  return null;
}

function buildLocalActionPlan(payload) {
  return buildLocalActionPlanFromIntent(payload.localIntent)
    || buildLocalActionPlanFromTranscript(payload.transcript, payload.context);
}

function groundStatisticsEntityPlan(plan, payload) {
  const normalizedPlan = normalizePlan(plan);
  const statisticsControl = buildStatisticsControl(payload?.transcript, payload?.context);
  if (!statisticsControl?.entity) return normalizedPlan;

  const groundedAction = statisticsControl.action;
  const statsActionIndex = normalizedPlan.actions.findIndex(action => action.type === "setStatsControls");
  const statisticsModalIndex = normalizedPlan.actions.findIndex(
    action => action.type === "openModal" && action.target === "statistics",
  );
  const actions = [...normalizedPlan.actions];

  if (statsActionIndex >= 0) {
    actions[statsActionIndex] = {
      ...groundedAction,
      ...actions[statsActionIndex],
      statsView: statisticsControl.entity.mode,
      entityMode: statisticsControl.entity.mode,
      entityKey: statisticsControl.entity.key,
    };
  } else if (statisticsModalIndex >= 0) {
    actions[statisticsModalIndex] = groundedAction;
  } else {
    return createLocalPlan(
      "execute",
      `Show statistics for ${statisticsControl.entity.name}`,
      `Showing statistics for ${statisticsControl.entity.name}.`,
      [groundedAction],
    );
  }

  return {
    ...normalizedPlan,
    status: "execute",
    requiresConfirmation: false,
    actions,
  };
}

function shouldReplaceProviderPlanWithLocalFallback(plan) {
  const normalizedPlan = normalizePlan(plan);
  return normalizedPlan.status === "clarify"
    || normalizedPlan.status === "unsupported"
    || normalizedPlan.actions.length === 0;
}

async function fetchOpenRouterPlan(payload, apiKey) {
  const primaryModel = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  const fallbackModels = getOpenRouterFallbackModels(primaryModel);
  let response;
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
        reasoning: { effort: DEFAULT_OPENROUTER_REASONING_EFFORT },
        // Gemini rejects the complete action schema as too complex for constrained
        // decoding. JSON object mode still guarantees parseable JSON, while
        // normalizePlan enforces the server-owned action allowlist below.
        response_format: { type: "json_object" },
        provider: { require_parameters: true },
      }),
    });
  } catch (error) {
    error.statusCode = Number(error.statusCode) || 503;
    error.isOpenRouterFailure = true;
    throw error;
  }

  const responseText = await response.text();
  let responseJson = {};
  try {
    responseJson = responseText ? JSON.parse(responseText) : {};
  } catch {
    responseJson = {};
  }

  if (!response.ok) {
    const message = responseJson?.error?.message || `OpenRouter failed with HTTP ${response.status}.`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.isOpenRouterFailure = true;
    throw error;
  }

  if (responseJson?.error) {
    const error = new Error(responseJson.error.message || "OpenRouter returned an in-band provider error.");
    error.statusCode = Number(responseJson.error.code) || 502;
    error.isOpenRouterFailure = true;
    throw error;
  }

  const content = responseJson?.choices?.[0]?.message?.content;
  const parsedPlan = typeof content === "object" && content !== null
    ? content
    : extractJsonObject(content);

  if (!parsedPlan) {
    const error = new Error("OpenRouter returned an invalid action plan.");
    error.statusCode = 502;
    error.isOpenRouterFailure = true;
    throw error;
  }

  return normalizePlan(parsedPlan);
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
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchOpenRouterPlan(payload, apiKey);
    } catch (error) {
      lastError = error;
      if (!shouldRetryOpenRouterError(error, attempt, maxAttempts)) break;
    }
  }
  throw lastError;
}

module.exports = async function handler(request, response) {
  setCorsHeaders(request, response);
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Voice-Command-Revision", "json-object-v4");

  if (request.method === "OPTIONS") {
    return response.status(204).end();
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    return response.status(405).json({ error: "Method not allowed" });
  }

  let payload = null;
  try {
    const bodyText = await readRequestBody(request);
    payload = parsePayload(bodyText);
    const plan = groundStatisticsEntityPlan(await requestOpenRouterPlan(payload), payload);
    if (shouldUseLocalCommandFallback() && shouldReplaceProviderPlanWithLocalFallback(plan)) {
      const fallbackPlan = buildLocalActionPlan(payload);
      if (fallbackPlan) {
        return response.status(200).json({ plan: fallbackPlan });
      }
    }
    return response.status(200).json({ plan });
  } catch (error) {
    if (payload && shouldUseLocalCommandFallback()) {
      const fallbackPlan = buildLocalActionPlan(payload);
      if (fallbackPlan) {
        return response.status(200).json({ plan: fallbackPlan });
      }
    }

    const statusCode = error.isOpenRouterFailure ? 502 : Number(error.statusCode) || 500;
    console.error("voice-score-command failed", {
      code: error.code || "VOICE_COMMAND_FAILED",
      statusCode,
      providerFailure: Boolean(error.isOpenRouterFailure),
      message: String(error.message || "Unknown voice command failure.").slice(0, 240),
    });
    const safeMessage = statusCode >= 500
      ? "Voice command planning is temporarily unavailable. Please try again."
      : error.message;
    return response.status(statusCode).json({ error: safeMessage });
  }
};

module.exports.ACTION_SCHEMA = ACTION_SCHEMA;
module.exports.buildSystemPrompt = buildSystemPrompt;
module.exports.buildLocalActionPlan = buildLocalActionPlan;
module.exports.buildOpenRouterMessages = buildOpenRouterMessages;
module.exports.resolveContextStatisticsEntity = resolveContextStatisticsEntity;
module.exports.sanitizeConversation = sanitizeConversation;
