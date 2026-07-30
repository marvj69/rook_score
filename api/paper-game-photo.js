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
const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const PAPER_GAME_PHOTO_REVISION = "bottom-score-row-v1";

function getAllowedOrigins() {
  const configuredOrigins = (
    process.env.PAPER_GAME_PHOTO_ALLOWED_ORIGINS
    || process.env.VOICE_SCORE_ALLOWED_ORIGINS
    || process.env.FIREBASE_CONFIG_ALLOWED_ORIGINS
    || ""
  )
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
    let finished = false;

    request.on("data", chunk => {
      if (finished) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        finished = true;
        const error = new Error("Photo upload is too large.");
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      if (finished) return;
      finished = true;
      resolve(Buffer.concat(chunks));
    });
    request.on("error", error => {
      if (finished) return;
      finished = true;
      reject(error);
    });
  });
}

function detectImageMimeType(imageBuffer) {
  if (
    imageBuffer.length >= 3
    && imageBuffer[0] === 0xff
    && imageBuffer[1] === 0xd8
    && imageBuffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    imageBuffer.length >= 8
    && imageBuffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }

  if (
    imageBuffer.length >= 12
    && imageBuffer.subarray(0, 4).toString("ascii") === "RIFF"
    && imageBuffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return "";
}

function parseMultipartPhoto(bodyBuffer, contentType) {
  const boundaryMatch = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = (boundaryMatch?.[1] || boundaryMatch?.[2] || "").trim();
  if (!boundary || boundary.length > 200) {
    const error = new Error("Photo upload boundary is missing or invalid.");
    error.statusCode = 400;
    throw error;
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
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
      const error = new Error("Photo upload contains an invalid part.");
      error.statusCode = 400;
      throw error;
    }

    const headerText = bodyBuffer.subarray(partStart, headerEnd).toString("utf8");
    const nameMatch = headerText.match(/content-disposition:[^\r\n]*\bname="([^"]+)"/i);
    if (nameMatch?.[1] === "photo") {
      const imageBuffer = Buffer.from(bodyBuffer.subarray(headerEnd + headerSeparator.length, partEnd));
      if (!imageBuffer.length) {
        const error = new Error("Photo is empty.");
        error.statusCode = 400;
        throw error;
      }
      if (imageBuffer.length > MAX_IMAGE_BYTES) {
        const error = new Error("Photo is too large. Try a closer crop.");
        error.statusCode = 413;
        throw error;
      }

      const mimeType = detectImageMimeType(imageBuffer);
      if (!mimeType) {
        const error = new Error("Photo must be a JPEG, PNG, or WebP image.");
        error.statusCode = 400;
        throw error;
      }

      return { imageBuffer, mimeType };
    }

    boundaryIndex = nextBoundaryIndex;
  }

  const error = new Error("Choose a score-sheet photo first.");
  error.statusCode = 400;
  throw error;
}

function parseRequestPhoto(bodyBuffer, contentType) {
  if (!/^multipart\/form-data\b/i.test(String(contentType || ""))) {
    const error = new Error("Photo must be uploaded as multipart form data.");
    error.statusCode = 415;
    throw error;
  }
  return parseMultipartPhoto(bodyBuffer, contentType);
}

function buildSystemPrompt() {
  return [
    "You read a handwritten Rook card-game score sheet from one photo.",
    "The expected table is three columns arranged left-to-right as: Us | Bid | Dem |.",
    "Rows underneath are chronological from the top of the page toward the bottom.",
    "Find the physically bottommost completed numeric row in those three columns.",
    "Bottommost means the row lowest on the page, never the numerically smallest values.",
    "The Us value in that row is the current Us score and the Dem value is the current Dem score.",
    "The middle Bid value is supporting context only and must never be substituted for either team score.",
    "Scores can be negative, are between -1000 and 1000, and should be multiples of 5.",
    "Do not infer missing digits or swap columns. If headers, column alignment, or the bottom completed row are unclear, return status unclear.",
    "Ignore crossed-out rows when a clearly rewritten row appears below them.",
    "Return only a JSON object with this exact shape:",
    '{"status":"success|unclear","usScore":number|null,"demScore":number|null,"bid":number|null,"confidence":"high|medium|low","rowCount":number,"message":"short explanation"}',
  ].join("\n");
}

function buildOpenRouterMessages({ imageBuffer, mimeType }) {
  const imageDataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
  return [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Read this Rook score sheet and return the current Us and Dem scores from the physically lowest completed numeric row.",
        },
        {
          type: "image_url",
          image_url: { url: imageDataUrl },
        },
      ],
    },
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

function normalizeScore(value) {
  const score = Number(value);
  if (
    !Number.isFinite(score)
    || !Number.isInteger(score)
    || Math.abs(score) > 1000
    || Math.abs(score % 5) > 1e-9
  ) {
    return null;
  }
  return score;
}

function normalizeScanResult(result) {
  const candidate = result && typeof result === "object" ? result : {};
  const usScore = normalizeScore(candidate.usScore);
  const demScore = normalizeScore(candidate.demScore);
  const confidence = ["high", "medium", "low"].includes(candidate.confidence)
    ? candidate.confidence
    : "low";

  if (candidate.status !== "success" || usScore === null || demScore === null) {
    const error = new Error(
      typeof candidate.message === "string" && candidate.message.trim()
        ? candidate.message.trim().slice(0, 180)
        : "I could not clearly find the bottom Us and Dem score row. Try a closer, straighter photo.",
    );
    error.statusCode = 422;
    throw error;
  }

  const hasBid = candidate.bid !== null && candidate.bid !== undefined && candidate.bid !== "";
  const rawBid = Number(candidate.bid);
  const bid = hasBid && Number.isInteger(rawBid) && rawBid >= 0 && rawBid <= 360 && rawBid % 5 === 0
    ? rawBid
    : null;
  const rowCount = Number.isInteger(Number(candidate.rowCount))
    ? Math.max(1, Math.min(100, Number(candidate.rowCount)))
    : null;

  return {
    usScore,
    demScore,
    bid,
    confidence,
    rowCount,
    warning: confidence === "high"
      ? ""
      : "The handwriting was not completely clear. Double-check both scores before starting.",
  };
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

function getOpenRouterMaxAttempts() {
  const configuredAttempts = Number(process.env.OPENROUTER_MAX_ATTEMPTS);
  if (!Number.isFinite(configuredAttempts)) return DEFAULT_OPENROUTER_MAX_ATTEMPTS;
  return Math.max(1, Math.min(4, Math.round(configuredAttempts)));
}

function shouldRetryOpenRouterError(error, attempt, maxAttempts) {
  if (attempt >= maxAttempts) return false;
  const statusCode = Number(error?.statusCode) || 0;
  return statusCode === 408
    || statusCode === 429
    || statusCode >= 500
    || /provider returned error/i.test(String(error?.message || ""));
}

async function fetchOpenRouterScan(photo, apiKey) {
  const primaryModel = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  const fallbackModels = getOpenRouterFallbackModels(primaryModel);
  let openRouterResponse;

  try {
    openRouterResponse = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
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
        messages: buildOpenRouterMessages(photo),
        temperature: 0,
        max_tokens: 400,
        reasoning: { effort: DEFAULT_OPENROUTER_REASONING_EFFORT },
        response_format: { type: "json_object" },
        provider: { require_parameters: true },
      }),
    });
  } catch (error) {
    error.statusCode = Number(error.statusCode) || 503;
    error.isOpenRouterFailure = true;
    throw error;
  }

  const responseText = await openRouterResponse.text();
  let responseJson = {};
  try {
    responseJson = responseText ? JSON.parse(responseText) : {};
  } catch {}

  if (!openRouterResponse.ok || responseJson?.error) {
    const error = new Error(
      responseJson?.error?.message
      || `OpenRouter failed with HTTP ${openRouterResponse.status}.`,
    );
    error.statusCode = openRouterResponse.status || Number(responseJson?.error?.code) || 502;
    error.isOpenRouterFailure = true;
    throw error;
  }

  const content = responseJson?.choices?.[0]?.message?.content;
  const parsed = typeof content === "object" && content !== null
    ? content
    : extractJsonObject(content);
  if (!parsed) {
    const error = new Error("OpenRouter returned an invalid score-sheet result.");
    error.statusCode = 502;
    error.isOpenRouterFailure = true;
    throw error;
  }

  return {
    scan: normalizeScanResult(parsed),
    model: primaryModel.slice(0, 120),
    revision: PAPER_GAME_PHOTO_REVISION,
  };
}

async function requestOpenRouterScan(photo) {
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
      return await fetchOpenRouterScan(photo, apiKey);
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
  response.setHeader("X-Paper-Game-Photo-Revision", PAPER_GAME_PHOTO_REVISION);

  if (request.method === "OPTIONS") {
    return response.status(204).end();
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST, OPTIONS");
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const bodyBuffer = await readRequestBody(request);
    const photo = parseRequestPhoto(bodyBuffer, request.headers?.["content-type"]);
    const result = await requestOpenRouterScan(photo);
    return response.status(200).json(result);
  } catch (error) {
    const statusCode = error.isOpenRouterFailure ? 502 : Number(error.statusCode) || 500;
    console.error("paper-game-photo failed", {
      code: error.code || "PAPER_GAME_PHOTO_FAILED",
      statusCode,
      providerFailure: Boolean(error.isOpenRouterFailure),
      message: String(error.message || "Unknown paper game photo failure.").slice(0, 240),
    });
    const safeMessage = statusCode >= 500
      ? "Score-sheet reading is temporarily unavailable. Enter the scores manually or try again."
      : error.message;
    return response.status(statusCode).json({ error: safeMessage });
  }
};

module.exports.buildOpenRouterMessages = buildOpenRouterMessages;
module.exports.detectImageMimeType = detectImageMimeType;
module.exports.normalizeScanResult = normalizeScanResult;
