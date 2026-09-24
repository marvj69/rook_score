const { getHeader, setCorsHeaders } = require("../lib/api-guards.js");

const REQUIRED_ENV = {
  apiKey: "FIREBASE_API_KEY",
  authDomain: "FIREBASE_AUTH_DOMAIN",
  projectId: "FIREBASE_PROJECT_ID",
  storageBucket: "FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID",
  appId: "FIREBASE_APP_ID",
};
const ALLOWED_ORIGIN_ENV_NAMES = ["FIREBASE_CONFIG_ALLOWED_ORIGINS"];
// The web config is public by design and changes rarely, so browsers and the
// CDN may reuse it instead of invoking the function on every app launch.
const CACHE_CONTROL = "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";

module.exports = function handler(request, response) {
  setCorsHeaders(request, response, { methods: "GET, OPTIONS", envNames: ALLOWED_ORIGIN_ENV_NAMES });

  if (request.method === "OPTIONS") {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    return response.status(204).end();
  }

  if (request.method !== "GET") {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("Allow", "GET, OPTIONS");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const missing = Object.values(REQUIRED_ENV).filter(envName => !process.env[envName]);
  if (missing.length > 0) {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    console.error("firebase-config is missing environment variables", { missing });
    return response.status(500).json({ error: "Firebase config is not configured." });
  }

  response.setHeader("Cache-Control", CACHE_CONTROL);
  response.setHeader("X-Content-Type-Options", "nosniff");
  return response.status(200).json(
    Object.fromEntries(
      Object.entries(REQUIRED_ENV).map(([configKey, envName]) => [configKey, process.env[envName]])
    )
  );
};

module.exports.getRequestOrigin = request => getHeader(request, "origin");
