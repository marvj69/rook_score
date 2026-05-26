(function () {
  "use strict";

  const GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-MCY1GMM4L5";
  const GOOGLE_ANALYTICS_HOSTNAMES = new Set(["marvj69.github.io"]);
  const ROOK_ANALYTICS_EVENTS = new Set([
    "game_started",
    "round_recorded",
    "game_completed",
    "game_saved",
    "game_frozen",
    "freezer_game_resumed",
    "probability_opened",
    "pro_mode_toggled",
    "auth_signed_in",
    "sync_failed",
  ]);
  const ROOK_ANALYTICS_PARAM_KEYS = new Set([
    "source",
    "round_count",
    "duration_bucket",
    "victory_method",
    "pro_mode",
    "had_location",
    "method",
    "sync_key",
    "reason",
    "game_state",
  ]);
  let analyticsEnabled = false;

  function hasConfiguredMeasurementId(measurementId) {
    return /^(G|GT|AW)-[A-Z0-9-]+$/i.test(measurementId) && !/^G-X+$/i.test(measurementId);
  }

  function sanitizeParamValue(value) {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
    if (typeof value !== "string") return null;

    const normalized = value
      .trim()
      .slice(0, 64)
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_-]/gi, "")
      .toLowerCase();
    return normalized || null;
  }

  function sanitizeEventParams(params) {
    if (!params || typeof params !== "object" || Array.isArray(params)) return {};

    return Object.entries(params).reduce((safeParams, [key, value]) => {
      if (!ROOK_ANALYTICS_PARAM_KEYS.has(key)) return safeParams;
      const safeValue = sanitizeParamValue(value);
      if (safeValue !== null) safeParams[key] = safeValue;
      return safeParams;
    }, {});
  }

  window.trackRookEvent = function trackRookEvent(eventName, params = {}) {
    if (!analyticsEnabled || !ROOK_ANALYTICS_EVENTS.has(eventName) || typeof window.gtag !== "function") {
      return false;
    }

    window.gtag("event", eventName, sanitizeEventParams(params));
    return true;
  };

  const measurementId = GOOGLE_ANALYTICS_MEASUREMENT_ID.trim();

  if (!GOOGLE_ANALYTICS_HOSTNAMES.has(window.location.hostname)) {
    return;
  }

  if (!hasConfiguredMeasurementId(measurementId)) {
    console.info("Google Analytics is not configured. Set GOOGLE_ANALYTICS_MEASUREMENT_ID in js/analytics.js.");
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };

  window.gtag("js", new Date());
  window.gtag("config", measurementId);
  analyticsEnabled = true;

  const gtagScript = document.createElement("script");
  gtagScript.async = true;
  gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(gtagScript);
})();
