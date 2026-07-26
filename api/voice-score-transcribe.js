const DEFAULT_ALLOWED_ORIGINS = [
  "https://marvj69.github.io",
  "https://rook-score.vercel.app",
  "https://rook-score-marvj69s-projects.vercel.app",
  "https://rook-score-marvj69-marvj69s-projects.vercel.app",
];

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL = "openai/gpt-4o-mini-transcribe";
const DEFAULT_OPENROUTER_TRANSCRIPTION_FALLBACK_MODELS = ["openai/whisper-large-v3"];
const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENROUTER_TRANSCRIPTIONS_URL = "https://openrouter.ai/api/v1/audio/transcriptions";
const MIME_EXTENSION_MAP = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
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

function readRequestBody(request, maxBytes = MAX_AUDIO_BYTES * 2) {
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

    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function parseAudioPayload(bodyText) {
  let payload;
  try {
    payload = JSON.parse(bodyText || "{}");
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }

  const rawAudio = typeof payload.audioBase64 === "string" ? payload.audioBase64 : "";
  const base64Audio = rawAudio.includes(",") ? rawAudio.split(",").pop() : rawAudio;
  const mimeType = typeof payload.mimeType === "string" && payload.mimeType
    ? payload.mimeType.split(";")[0].toLowerCase()
    : "audio/webm";

  if (!base64Audio) {
    const error = new Error("Missing audioBase64.");
    error.statusCode = 400;
    throw error;
  }

  const audioBuffer = Buffer.from(base64Audio, "base64");
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

  return { audioBuffer, mimeType };
}

function getAudioFilename(mimeType) {
  const extension = MIME_EXTENSION_MAP[mimeType] || "webm";
  return `rook-voice-score.${extension}`;
}

function createTranscriptionFormData({ audioBuffer, mimeType, model }) {
  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: mimeType }), getAudioFilename(mimeType));
  formData.append("model", model);
  formData.append("response_format", "json");
  return formData;
}

function getOpenRouterTranscriptionModels() {
  const primaryModel = process.env.OPENROUTER_TRANSCRIPTION_MODEL || DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL;
  const configuredFallbacks = String(process.env.OPENROUTER_TRANSCRIPTION_FALLBACK_MODELS || "")
    .split(",")
    .map(model => model.trim())
    .filter(Boolean);
  return [...new Set([
    primaryModel,
    ...(configuredFallbacks.length ? configuredFallbacks : DEFAULT_OPENROUTER_TRANSCRIPTION_FALLBACK_MODELS),
  ])].slice(0, 4);
}

function shouldTryNextTranscriptionModel(error) {
  const statusCode = Number(error?.statusCode) || 0;
  return statusCode === 400 || statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

async function requestTranscription({ audioBuffer, mimeType, apiKey, model, useOpenRouter }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
  };
  if (useOpenRouter) {
    headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL || "https://rook-score.vercel.app";
    headers["X-OpenRouter-Title"] = process.env.OPENROUTER_APP_TITLE || "Rook Score";
  }

  const response = await fetch(useOpenRouter ? OPENROUTER_TRANSCRIPTIONS_URL : OPENAI_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers,
    body: createTranscriptionFormData({ audioBuffer, mimeType, model }),
  });

  const responseText = await response.text();
  let responseJson = {};
  try {
    responseJson = responseText ? JSON.parse(responseText) : {};
  } catch {
    responseJson = {};
  }

  if (!response.ok) {
    const message = responseJson?.error?.message || `Transcription failed with HTTP ${response.status}.`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.isProviderFailure = true;
    throw error;
  }

  return String(responseJson.text || "").trim();
}

async function transcribeAudio({ audioBuffer, mimeType }) {
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (openAiApiKey) {
    return requestTranscription({
      audioBuffer,
      mimeType,
      apiKey: openAiApiKey,
      model: process.env.OPENAI_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL,
      useOpenRouter: false,
    });
  }

  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterApiKey) {
    const error = new Error("Voice transcription is not configured.");
    error.statusCode = 500;
    throw error;
  }

  const models = getOpenRouterTranscriptionModels();
  let lastError = null;
  for (let index = 0; index < models.length; index += 1) {
    try {
      return await requestTranscription({
        audioBuffer,
        mimeType,
        apiKey: openRouterApiKey,
        model: models[index],
        useOpenRouter: true,
      });
    } catch (error) {
      lastError = error;
      if (index === models.length - 1 || !shouldTryNextTranscriptionModel(error)) break;
    }
  }
  throw lastError;
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
    const audioPayload = parseAudioPayload(bodyText);
    const text = await transcribeAudio(audioPayload);
    return response.status(200).json({ text });
  } catch (error) {
    const statusCode = error.isProviderFailure ? 502 : Number(error.statusCode) || 500;
    const safeMessage = statusCode >= 500
      ? "Voice transcription is temporarily unavailable. Please try again."
      : error.message;
    return response.status(statusCode).json({ error: safeMessage });
  }
};
