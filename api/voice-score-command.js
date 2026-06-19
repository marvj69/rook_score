const DEFAULT_ALLOWED_ORIGINS = [
  "https://marvj69.github.io",
  "https://rook-score.vercel.app",
  "https://rook-score-marvj69s-projects.vercel.app",
  "https://rook-score-marvj69-marvj69s-projects.vercel.app",
];

const DEFAULT_OPENROUTER_MODEL = "cohere/north-mini-code:free";
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
    `Deterministic parser JSON: ${JSON.stringify(localIntent)}`,
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

async function requestOpenRouterPlan(payload) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const error = new Error("OpenRouter is not configured.");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
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
    throw error;
  }

  const content = responseJson?.choices?.[0]?.message?.content;
  const parsedPlan = typeof content === "object" && content !== null
    ? content
    : extractJsonObject(content);

  if (!parsedPlan) {
    const error = new Error("OpenRouter returned an invalid action plan.");
    error.statusCode = 502;
    throw error;
  }

  return normalizePlan(parsedPlan);
}

module.exports = async function handler(request, response) {
  setCorsHeaders(request, response);
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method === "OPTIONS") {
    return response.status(204).end();
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const bodyText = await readRequestBody(request);
    const payload = parsePayload(bodyText);
    const plan = await requestOpenRouterPlan(payload);
    return response.status(200).json({ plan });
  } catch (error) {
    const statusCode = Number(error.statusCode) || 500;
    const safeMessage = statusCode >= 500
      ? "Voice command planning is unavailable."
      : error.message;
    return response.status(statusCode).json({ error: safeMessage });
  }
};
