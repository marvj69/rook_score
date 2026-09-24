"use strict";

// Shared request guards for the Vercel API functions: browser-origin
// enforcement and a best-effort per-instance rate limiter. Both stop casual
// cross-site abuse of the paid LLM and email providers; hard quotas still live
// with those providers.
const { createHash } = require("node:crypto");

const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "https://marvj69.github.io",
  "https://rook-score.vercel.app",
  "https://rook-score-marvj69s-projects.vercel.app",
  "https://rook-score-marvj69-marvj69s-projects.vercel.app",
]);

function createHttpError(statusCode, message, code = "INVALID_REQUEST") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function getHeader(request, name) {
  const headers = request?.headers || {};
  const value = headers[name.toLowerCase()] ?? headers[name] ?? "";
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function parseOriginList(value) {
  return String(value || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
}

// The first configured environment variable wins, matching the historical
// per-endpoint fallbacks (e.g. VOICE_SCORE_ALLOWED_ORIGINS, then the Firebase list).
function getAllowedOrigins(envNames = []) {
  const configured = envNames
    .map(name => parseOriginList(process.env[name]))
    .find(list => list.length) || [];
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function isLocalDevelopmentOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function isSameDeploymentOrigin(origin, request) {
  const host = getHeader(request, "x-forwarded-host") || getHeader(request, "host");
  if (!host) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.host === host;
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin, request, envNames) {
  if (!origin) return false;
  if (getAllowedOrigins(envNames).has(origin)) return true;
  // Preview deployments talk to their own /api routes.
  if (isSameDeploymentOrigin(origin, request)) return true;
  if (process.env.VERCEL_ENV === "production") return false;
  return isLocalDevelopmentOrigin(origin);
}

function setCorsHeaders(request, response, { methods, envNames }) {
  const origin = getHeader(request, "origin");
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", methods);
  response.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");
  if (origin && isAllowedOrigin(origin, request, envNames)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }
}

// Browsers always send Origin on cross-origin and same-origin POST requests, so
// a foreign Origin never comes from the app and a missing one is rejected for
// every method that does work (preflights and warm-up GETs carry no body).
function assertBrowserOrigin(request, envNames, message = "This site is not allowed to use this endpoint.") {
  const origin = getHeader(request, "origin");
  const method = String(request?.method || "GET").toUpperCase();
  const originRequired = method !== "OPTIONS" && method !== "GET" && method !== "HEAD";
  if (!origin && !originRequired) return;
  if (!isAllowedOrigin(origin, request, envNames)) {
    throw createHttpError(403, message, "ORIGIN_NOT_ALLOWED");
  }
}

function getClientAddressHash(request) {
  const forwardedFor = getHeader(request, "x-forwarded-for").split(",")[0].trim();
  const clientAddress = forwardedFor || getHeader(request, "x-real-ip") || "unknown";
  return createHash("sha256").update(clientAddress).digest("hex");
}

function createRateLimiter({ windowMs, max, message = "Too many requests. Please try again later." }) {
  const buckets = new Map();

  function enforce(request, response, now = Date.now()) {
    const key = getClientAddressHash(request);
    const existing = buckets.get(key);
    const bucket = !existing || now - existing.startedAt >= windowMs
      ? { startedAt: now, count: 0 }
      : existing;
    bucket.count += 1;
    buckets.set(key, bucket);

    for (const [bucketKey, value] of buckets) {
      if (now - value.startedAt >= windowMs) buckets.delete(bucketKey);
    }

    if (bucket.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - bucket.startedAt)) / 1000));
      response.setHeader("Retry-After", String(retryAfterSeconds));
      throw createHttpError(429, message, "RATE_LIMITED");
    }
  }

  return { enforce, reset: () => buckets.clear() };
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  assertBrowserOrigin,
  createHttpError,
  createRateLimiter,
  getAllowedOrigins,
  getHeader,
  isAllowedOrigin,
  setCorsHeaders,
};
