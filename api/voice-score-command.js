const DEFAULT_ALLOWED_ORIGINS = [
  "https://marvj69.github.io",
  "https://rook-score.vercel.app",
  "https://rook-score-marvj69s-projects.vercel.app",
  "https://rook-score-marvj69-marvj69s-projects.vercel.app",
];

const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";
const DEFAULT_OPENROUTER_MAX_ATTEMPTS = 2;
const MAX_BODY_BYTES = 64 * 1024;
const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

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
              "confirmation",
              "all",
            ],
          },
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
        },
        required: ["type"],
      },
    },
  },
  required: ["status", "summary", "message", "requiresConfirmation", "actions"],
};

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
  if (!transcript) {
    const error = new Error("Missing transcript.");
    error.statusCode = 400;
    throw error;
  }
  if (transcript.length > 1000) {
    const error = new Error("Transcript is too long.");
    error.statusCode = 413;
    throw error;
  }

  const context = payload.context && typeof payload.context === "object" ? payload.context : {};
  const localIntent = payload.localIntent && typeof payload.localIntent === "object" ? payload.localIntent : null;

  return { transcript, context, localIntent };
}

function buildSystemPrompt() {
  return [
    "You are an action planner for a Rook scorekeeping web app.",
    "Return only JSON matching the provided schema. Do not include commentary.",
    "Always choose the most likely app action for short voice transcripts.",
    "Prefer concrete app actions over explanation when the user's intent is clear.",
    "Use status=clarify when required values are missing or ambiguous.",
    "Use requiresConfirmation/status=confirm for destructive actions such as new game, freeze game, save completed game, rematch without a dealer, or ambiguous score assumptions.",
    "Never invent card play, strategy, or hidden game state. Use only the provided context.",
    "If deterministicParserIntent.type is scoreRound, undo, or misdeal, convert it directly to the matching action unless the transcript contradicts it.",
    "If deterministicParserIntent.type is clarification, treat it only as a failed score-parser result. Do not repeat that clarification when the transcript clearly asks for a non-scoring app action.",
    "Scoring rules: scoreRound requires biddingTeam, bidAmount, points, enterBidderPoints. enterBidderPoints=true means points belong to the bidder; false means points belong to the non-bidding team.",
    "For 'got set' without a score, plan scoreRound with points=180, enterBidderPoints=false, requiresConfirmation=true.",
    "For 'misdeal' or 'next dealer', use misdeal. For 'undo', use undo. For 'redo', use redo.",
    "Examples:",
    "Transcript 'open settings' => status execute, action {type:'openModal', target:'settings'}.",
    "Transcript 'show saved games' => status execute, action {type:'openModal', target:'savedGames'}.",
    "Transcript 'Dem bid 125 and made 145' => status execute, action {type:'scoreRound', biddingTeam:'dem', bidAmount:125, points:145, enterBidderPoints:true}.",
    "Transcript 'Us bid 130 and got set' => status confirm, requiresConfirmation true, action {type:'scoreRound', biddingTeam:'us', bidAmount:130, points:180, enterBidderPoints:false}.",
    "Transcript 'set dealers Alice Bob Carol Dan' => status execute, action {type:'setDealerOrder', dealers:['Alice','Bob','Carol','Dan']}.",
    "Transcript 'turn on pro mode' => status execute, action {type:'setSetting', key:'proMode', value:true}.",
    "Modal target names: savedGames, settings, about, statistics, dealerOrder, teamSelection, resumeGame, theme, presets, probability, confirmation, all.",
    "Settings keys: mustWinByBid, misdealHandling, proMode, tableTalkPenaltyType, tableTalkPenaltyPoints.",
    "Output shape: {\"status\":\"execute|confirm|clarify|unsupported\",\"summary\":\"...\",\"message\":\"...\",\"requiresConfirmation\":false,\"actions\":[{\"type\":\"openModal\",\"target\":\"settings\"}]}",
  ].join("\n");
}

function buildUserContent({ transcript, context, localIntent }) {
  return [
    `Transcript: ${transcript}`,
    `App context JSON: ${JSON.stringify(context)}`,
    `Deterministic score-parser JSON: ${JSON.stringify(localIntent)}`,
    "The deterministic score parser only recognizes scoring, undo, and misdeal commands. If it returned clarification, still plan clear non-scoring app actions from the transcript.",
    "Return the action plan JSON now.",
  ].join("\n");
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
  const actions = Array.isArray(normalized.actions) ? normalized.actions.slice(0, 5) : [];
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

function shouldRetryOpenRouterError(error, attempt, maxAttempts) {
  if (attempt >= maxAttempts) return false;
  const statusCode = Number(error?.statusCode) || 0;
  return statusCode === 429 || statusCode >= 500;
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
  { target: "about", label: "about", patterns: [/\babout\b/, /\bversion\b/, /\binfo\b/] },
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

function buildLocalActionPlanFromTranscript(transcript) {
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

  if (/\brematch\b/.test(text)) {
    return createLocalPlan(
      "confirm",
      "Start a rematch",
      "Confirm starting a rematch.",
      [{ type: "rematch" }],
      true,
    );
  }

  const modalPlan = buildLocalModalPlan(transcript);
  if (modalPlan) return modalPlan;

  const dealerPlan = buildLocalDealerPlan(transcript);
  if (dealerPlan) return dealerPlan;

  const paperGamePlan = buildLocalPaperGamePlan(transcript);
  if (paperGamePlan) return paperGamePlan;

  const settingPlan = buildLocalSettingPlan(transcript);
  if (settingPlan) return settingPlan;

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
    || buildLocalActionPlanFromTranscript(payload.transcript);
}

function shouldReplaceProviderPlanWithLocalFallback(plan) {
  const normalizedPlan = normalizePlan(plan);
  return normalizedPlan.status === "clarify"
    || normalizedPlan.status === "unsupported"
    || normalizedPlan.actions.length === 0;
}

async function fetchOpenRouterPlan(payload, apiKey) {
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
        model: process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserContent(payload) },
        ],
        temperature: 0,
        max_tokens: 700,
        response_format: { type: "json_object" },
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
  response.setHeader("X-Voice-Command-Revision", "local-fallback-v1");

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
    const plan = await requestOpenRouterPlan(payload);
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

    const statusCode = Number(error.statusCode) || 500;
    const safeMessage = statusCode >= 500
      ? "Voice command planning is unavailable."
      : error.message;
    return response.status(statusCode).json({ error: safeMessage });
  }
};
