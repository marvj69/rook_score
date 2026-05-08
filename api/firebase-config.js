const REQUIRED_ENV = {
  apiKey: "FIREBASE_API_KEY",
  authDomain: "FIREBASE_AUTH_DOMAIN",
  projectId: "FIREBASE_PROJECT_ID",
  storageBucket: "FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID",
  appId: "FIREBASE_APP_ID",
};

const DEFAULT_ALLOWED_ORIGINS = [
  "https://marvj69.github.io",
  "https://rook-score.vercel.app",
  "https://rook-score-marvj69s-projects.vercel.app",
  "https://rook-score-marvj69-marvj69s-projects.vercel.app",
];

function getAllowedOrigins() {
  const configuredOrigins = (process.env.FIREBASE_CONFIG_ALLOWED_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);
}

function setCorsHeaders(request, response) {
  const origin = request.headers?.origin;
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");

  if (origin && getAllowedOrigins().has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }
}

module.exports = function handler(request, response) {
  setCorsHeaders(request, response);
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method === "OPTIONS") {
    return response.status(204).end();
  }

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET, OPTIONS");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const missing = Object.values(REQUIRED_ENV).filter(envName => !process.env[envName]);
  if (missing.length > 0) {
    return response.status(500).json({
      error: "Firebase config is not configured.",
      missing,
    });
  }

  return response.status(200).json(
    Object.fromEntries(
      Object.entries(REQUIRED_ENV).map(([configKey, envName]) => [configKey, process.env[envName]])
    )
  );
};
