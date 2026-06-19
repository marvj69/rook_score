const DEFAULT_ALLOWED_ORIGINS = [
  "https://marvj69.github.io",
  "https://rook-score.vercel.app",
  "https://rook-score-marvj69s-projects.vercel.app",
  "https://rook-score-marvj69-marvj69s-projects.vercel.app",
];

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
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

async function transcribeAudio({ audioBuffer, mimeType }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error("OpenAI transcription is not configured.");
    error.statusCode = 500;
    throw error;
  }

  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: mimeType }), getAudioFilename(mimeType));
  formData.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL);
  formData.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
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
    throw error;
  }

  return String(responseJson.text || "").trim();
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
    const statusCode = Number(error.statusCode) || 500;
    const safeMessage = statusCode >= 500
      ? "Voice transcription is unavailable."
      : error.message;
    return response.status(statusCode).json({ error: safeMessage });
  }
};
