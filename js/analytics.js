(function () {
  "use strict";

  const GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-MCY1GMM4L5";
  const GOOGLE_ANALYTICS_HOSTNAMES = new Set(["marvj69.github.io"]);

  function hasConfiguredMeasurementId(measurementId) {
    return /^(G|GT|AW)-[A-Z0-9-]+$/i.test(measurementId) && !/^G-X+$/i.test(measurementId);
  }

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

  const gtagScript = document.createElement("script");
  gtagScript.async = true;
  gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(gtagScript);
})();
