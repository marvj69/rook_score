"use strict";

const { createHash, randomUUID } = require("node:crypto");

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REPORTS = 5;
const DEFAULT_ALLOWED_ORIGINS = [
  "https://marvj69.github.io",
  "https://rook-score.vercel.app",
  "https://rook-score-marvj69s-projects.vercel.app",
  "https://rook-score-marvj69-marvj69s-projects.vercel.app",
];
const ALLOWED_CATEGORIES = new Set(["bug", "scoring", "performance", "suggestion", "other"]);
const CATEGORY_LABELS = {
  bug: "Bug",
  scoring: "Scoring Problem",
  performance: "Performance Problem",
  suggestion: "Suggestion",
  other: "Other",
};
const rateLimitBuckets = new Map();

function createHttpError(statusCode, message, code = "INVALID_REQUEST") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function getHeader(request, name) {
  const headers = request.headers || {};
  return headers[name.toLowerCase()] ?? headers[name] ?? "";
}

function getAllowedOrigins() {
  const configuredOrigins = (process.env.BUG_REPORT_ALLOWED_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);
}

function isAllowedOrigin(origin) {
  if (getAllowedOrigins().has(origin)) return true;
  if (process.env.VERCEL_ENV === "production") return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:"
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

function setCorsHeaders(request, response) {
  const origin = getHeader(request, "origin");
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");
  if (origin && isAllowedOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }
}

function assertAllowedOrigin(request) {
  const origin = getHeader(request, "origin");
  if (origin && !isAllowedOrigin(origin)) {
    throw createHttpError(403, "This site is not allowed to submit bug reports.", "ORIGIN_NOT_ALLOWED");
  }
}

function readRequestBody(request) {
  if (request.body !== undefined && request.body !== null) {
    if (Buffer.isBuffer(request.body)) return Promise.resolve(request.body);
    if (typeof request.body === "string") return Promise.resolve(Buffer.from(request.body));
    return Promise.resolve(Buffer.from(JSON.stringify(request.body)));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    request.on("data", chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(createHttpError(413, "Bug report is too large.", "BODY_TOO_LARGE"));
        request.destroy?.();
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readJsonPayload(request) {
  const contentType = String(getHeader(request, "content-type")).toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw createHttpError(415, "Content-Type must be application/json.", "UNSUPPORTED_MEDIA_TYPE");
  }

  const contentLength = Number(getHeader(request, "content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw createHttpError(413, "Bug report is too large.", "BODY_TOO_LARGE");
  }

  const body = await readRequestBody(request);
  if (body.length > MAX_BODY_BYTES) {
    throw createHttpError(413, "Bug report is too large.", "BODY_TOO_LARGE");
  }
  if (!body.length) {
    throw createHttpError(400, "Bug report is empty.", "EMPTY_BODY");
  }

  try {
    const payload = JSON.parse(body.toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Payload must be an object.");
    }
    return payload;
  } catch {
    throw createHttpError(400, "Bug report contains invalid JSON.", "INVALID_JSON");
  }
}

function cleanSingleLine(value, fieldName, maxLength, { required = false } = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") {
    throw createHttpError(400, `${fieldName} must be text.`);
  }
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (required && !cleaned) {
    throw createHttpError(400, `${fieldName} is required.`);
  }
  if (cleaned.length > maxLength) {
    throw createHttpError(400, `${fieldName} is too long.`);
  }
  return cleaned;
}

function cleanMultiline(value, fieldName, maxLength, { required = false, minLength = 0 } = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") {
    throw createHttpError(400, `${fieldName} must be text.`);
  }
  const cleaned = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (required && !cleaned) {
    throw createHttpError(400, `${fieldName} is required.`);
  }
  if (cleaned.length < minLength) {
    throw createHttpError(400, `${fieldName} must be at least ${minLength} characters.`);
  }
  if (cleaned.length > maxLength) {
    throw createHttpError(400, `${fieldName} is too long.`);
  }
  return cleaned;
}

function cleanContactEmail(value) {
  const email = cleanSingleLine(value, "Contact email", 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createHttpError(400, "Contact email is not valid.");
  }
  return email;
}

function cleanReportId(value) {
  const reportId = cleanSingleLine(value, "Report ID", 128);
  return /^[A-Za-z0-9_-]{8,128}$/.test(reportId) ? reportId : randomUUID();
}

function cleanBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function cleanNumber(value, fallback = 0, min = -100000, max = 100000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function sanitizeDiagnostics(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const firebase = input.firebase && typeof input.firebase === "object" ? input.firebase : {};
  const game = input.game && typeof input.game === "object" ? input.game : {};
  const scores = game.scores && typeof game.scores === "object" ? game.scores : {};
  const winner = game.winner === "us" || game.winner === "dem" ? game.winner : null;
  const anonymous = typeof firebase.anonymous === "boolean" ? firebase.anonymous : null;

  return {
    capturedAt: cleanSingleLine(input.capturedAt, "Diagnostic timestamp", 40),
    appVersion: cleanSingleLine(input.appVersion, "App version", 30),
    page: cleanSingleLine(input.page, "Page", 300),
    userAgent: cleanSingleLine(input.userAgent, "User agent", 500),
    viewport: cleanSingleLine(input.viewport, "Viewport", 30),
    devicePixelRatio: cleanNumber(input.devicePixelRatio, 1, 0.1, 10),
    displayMode: input.displayMode === "standalone" ? "standalone" : "browser",
    online: cleanBoolean(input.online, true),
    theme: input.theme === "light" ? "light" : "dark",
    proMode: cleanBoolean(input.proMode),
    firebase: {
      status: firebase.status === "ready" ? "ready" : "not-ready-or-offline",
      signedIn: cleanBoolean(firebase.signedIn),
      anonymous,
    },
    game: {
      roundsPlayed: Math.trunc(cleanNumber(game.roundsPlayed, 0, 0, 10000)),
      scores: {
        us: cleanNumber(scores.us),
        dem: cleanNumber(scores.dem),
      },
      gameOver: cleanBoolean(game.gameOver),
      winner,
      victoryMethod: cleanSingleLine(game.victoryMethod, "Victory method", 80),
    },
  };
}

function validateBugReportPayload(payload) {
  const category = cleanSingleLine(payload.category, "Category", 30, { required: true });
  if (!ALLOWED_CATEGORIES.has(category)) {
    throw createHttpError(400, "Category is not valid.");
  }

  return {
    reportId: cleanReportId(payload.reportId),
    category,
    summary: cleanSingleLine(payload.summary, "Summary", 120, { required: true }),
    description: cleanMultiline(payload.description, "Description", 4000, {
      required: true,
      minLength: 10,
    }),
    steps: cleanMultiline(payload.steps, "Steps", 3000),
    contactEmail: cleanContactEmail(payload.contactEmail),
    diagnostics: sanitizeDiagnostics(payload.diagnostics),
  };
}

function formatBugReportEmail(report) {
  const diagnostics = report.diagnostics;
  const diagnosticLines = diagnostics
    ? [
        `Captured: ${diagnostics.capturedAt || "N/A"}`,
        `App version: ${diagnostics.appVersion || "N/A"}`,
        `Page: ${diagnostics.page || "N/A"}`,
        `Browser/device: ${diagnostics.userAgent || "N/A"}`,
        `Viewport: ${diagnostics.viewport || "N/A"} at ${diagnostics.devicePixelRatio}x DPR`,
        `Display mode: ${diagnostics.displayMode}`,
        `Online: ${diagnostics.online ? "Yes" : "No"}`,
        `Theme: ${diagnostics.theme}`,
        `Pro mode: ${diagnostics.proMode ? "On" : "Off"}`,
        `Firebase: ${diagnostics.firebase.status}; signed in: ${diagnostics.firebase.signedIn ? "Yes" : "No"}; anonymous: ${diagnostics.firebase.anonymous === null ? "N/A" : diagnostics.firebase.anonymous ? "Yes" : "No"}`,
        `Game: ${diagnostics.game.roundsPlayed} rounds; Us ${diagnostics.game.scores.us} - Dem ${diagnostics.game.scores.dem}; game over: ${diagnostics.game.gameOver ? "Yes" : "No"}; winner: ${diagnostics.game.winner || "N/A"}; victory: ${diagnostics.game.victoryMethod || "N/A"}`,
      ]
    : ["The reporter chose not to include diagnostics."];

  return [
    "A new issue was submitted from Rook Score.",
    "",
    `Report ID: ${report.reportId}`,
    `Category: ${CATEGORY_LABELS[report.category]}`,
    `Summary: ${report.summary}`,
    `Contact email: ${report.contactEmail || "Not provided"}`,
    "",
    "WHAT HAPPENED",
    report.description,
    "",
    "STEPS TO REPRODUCE",
    report.steps || "Not provided",
    "",
    "APP DIAGNOSTICS",
    ...diagnosticLines,
  ].join("\n");
}

function getClientRateLimitKey(request) {
  const forwardedFor = String(getHeader(request, "x-forwarded-for") || "").split(",")[0].trim();
  const clientAddress = forwardedFor || String(getHeader(request, "x-real-ip") || "unknown");
  return createHash("sha256").update(clientAddress).digest("hex");
}

function enforceRateLimit(request, response, now = Date.now()) {
  const key = getClientRateLimitKey(request);
  const existing = rateLimitBuckets.get(key);
  const bucket = !existing || now - existing.startedAt >= RATE_LIMIT_WINDOW_MS
    ? { startedAt: now, count: 0 }
    : existing;
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  for (const [bucketKey, value] of rateLimitBuckets.entries()) {
    if (now - value.startedAt >= RATE_LIMIT_WINDOW_MS) rateLimitBuckets.delete(bucketKey);
  }

  if (bucket.count > RATE_LIMIT_MAX_REPORTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - bucket.startedAt)) / 1000));
    response.setHeader("Retry-After", String(retryAfterSeconds));
    throw createHttpError(429, "Too many reports were submitted. Please try again later.", "RATE_LIMITED");
  }
}

async function sendBugReportEmail(report) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw createHttpError(503, "Bug reports are temporarily unavailable.", "RESEND_MISSING_KEY");
  }

  const recipients = (process.env.BUG_REPORT_TO_EMAIL || "heinonenmh@gmail.com")
    .split(",")
    .map(email => email.trim())
    .filter(Boolean);
  const from = process.env.BUG_REPORT_FROM_EMAIL || "Rook Score <onboarding@resend.dev>";
  const emailPayload = {
    from,
    to: recipients,
    subject: `[Rook Score ${CATEGORY_LABELS[report.category]}] ${report.summary}`,
    text: formatBugReportEmail(report),
  };
  if (report.contactEmail) emailPayload.reply_to = report.contactEmail;

  let providerResponse;
  try {
    providerResponse = await fetch(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `bug-report/${report.reportId}`,
      },
      body: JSON.stringify(emailPayload),
    });
  } catch {
    throw createHttpError(502, "Bug report delivery failed.", "RESEND_UNREACHABLE");
  }

  const providerBody = await providerResponse.text();
  if (!providerResponse.ok) {
    let providerType = "unknown";
    try {
      providerType = JSON.parse(providerBody)?.name || "unknown";
    } catch {
      // Keep provider response details out of logs and browser responses.
    }
    console.error("bug-report email delivery failed", {
      status: providerResponse.status,
      providerType: String(providerType).slice(0, 80),
    });
    throw createHttpError(502, "Bug report delivery failed.", "RESEND_REJECTED");
  }
}

async function handler(request, response) {
  setCorsHeaders(request, response);
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");

  try {
    assertAllowedOrigin(request);

    if (request.method === "OPTIONS") {
      return response.status(204).end();
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS");
      return response.status(405).json({ error: "Method not allowed" });
    }

    const payload = await readJsonPayload(request);
    const reportId = cleanReportId(payload.reportId);
    if (typeof payload.website === "string" && payload.website.trim()) {
      return response.status(200).json({ ok: true, reportId });
    }

    const report = validateBugReportPayload({ ...payload, reportId });
    enforceRateLimit(request, response);
    await sendBugReportEmail(report);
    return response.status(200).json({ ok: true, reportId: report.reportId });
  } catch (error) {
    const statusCode = Number(error.statusCode) || 500;
    if (statusCode >= 500 && error.code !== "RESEND_REJECTED") {
      console.error("bug-report failed", {
        code: error.code || "BUG_REPORT_FAILED",
        statusCode,
        message: String(error.message || "Unknown bug report failure.").slice(0, 160),
      });
    }
    const safeMessage = statusCode >= 500
      ? "Bug reports are temporarily unavailable. Please try again."
      : error.message;
    return response.status(statusCode).json({ error: safeMessage });
  }
}

module.exports = handler;
module.exports.formatBugReportEmail = formatBugReportEmail;
module.exports.sanitizeDiagnostics = sanitizeDiagnostics;
module.exports.validateBugReportPayload = validateBugReportPayload;
module.exports.resetRateLimitsForTests = () => rateLimitBuckets.clear();
