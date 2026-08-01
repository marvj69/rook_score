"use strict";

// --- Lazy Voice Score Runtime ---
const VOICE_SCORE_BUNDLE_PATH = "js/voice-score.bundle.js";
const VOICE_SCORE_RUNTIME_PROPERTY = "__rookVoiceScoreRuntime";
let voiceScoreModuleLoadPromise = null;

function getVoiceScoreRuntime() {
  if (typeof window === "undefined") return null;
  const runtime = window[VOICE_SCORE_RUNTIME_PROPERTY];
  return runtime && typeof runtime === "object" ? runtime : null;
}

function validateVoiceScoreRuntime(runtime = getVoiceScoreRuntime()) {
  if (!runtime || typeof runtime.initializeVoiceScoreControls !== "function") return null;
  return runtime;
}

function getVoiceScoreBundleUrl() {
  if (typeof document === "undefined" || !document.baseURI) return VOICE_SCORE_BUNDLE_PATH;
  return new URL(VOICE_SCORE_BUNDLE_PATH, document.baseURI).href;
}

function loadVoiceScoreModule() {
  const loadedRuntime = validateVoiceScoreRuntime();
  if (loadedRuntime) return Promise.resolve(loadedRuntime);
  if (voiceScoreModuleLoadPromise) return voiceScoreModuleLoadPromise;

  if (typeof document === "undefined" || !document.head || typeof document.createElement !== "function") {
    return Promise.reject(new Error("Voice scoring cannot load outside a browser document."));
  }

  voiceScoreModuleLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = getVoiceScoreBundleUrl();
    script.async = true;
    script.dataset.rookVoiceScoreBundle = "true";

    script.addEventListener("load", () => {
      const runtime = validateVoiceScoreRuntime();
      if (!runtime) {
        voiceScoreModuleLoadPromise = null;
        script.remove();
        reject(new Error("Voice scoring loaded without registering its runtime."));
        return;
      }
      resolve(runtime);
    }, { once: true });

    script.addEventListener("error", () => {
      voiceScoreModuleLoadPromise = null;
      script.remove();
      reject(new Error("Voice scoring could not be loaded. Check your connection and try again."));
    }, { once: true });

    document.head.appendChild(script);
  });

  return voiceScoreModuleLoadPromise;
}

function initializeVoiceScoreModuleWhenEnabled() {
  if (typeof isExperimentalFeaturesEnabled !== "function"
      || !isExperimentalFeaturesEnabled()
      || (typeof isVoiceExperimentalOnboardingComplete === "function"
        && !isVoiceExperimentalOnboardingComplete())) {
    return Promise.resolve(null);
  }

  return loadVoiceScoreModule()
    .then(runtime => {
      runtime.initializeVoiceScoreControls();
      if (typeof scheduleRender === "function") scheduleRender();
      return runtime;
    })
    .catch(error => {
      console.warn("Unable to initialize voice scoring.", error);
      return null;
    });
}

function renderLazyVoiceScoreControls() {
  const runtime = getVoiceScoreRuntime();
  if (!runtime || typeof runtime.renderVoiceScoreControls !== "function") return "";
  return runtime.renderVoiceScoreControls();
}

function cancelLoadedVoiceScoreEntry() {
  const runtime = getVoiceScoreRuntime();
  if (!runtime || typeof runtime.cancelVoiceScoreEntry !== "function") return false;
  return runtime.cancelVoiceScoreEntry();
}

async function invokeLazyVoiceScoreRuntime(methodName, ...args) {
  const runtime = await loadVoiceScoreModule();
  const method = runtime?.[methodName];
  if (typeof method !== "function") {
    throw new Error(`Voice scoring method is unavailable: ${methodName}`);
  }
  return method(...args);
}

function startLazyVoiceScoreEntry(...args) {
  return invokeLazyVoiceScoreRuntime("startVoiceScoreEntry", ...args);
}

function stopLoadedVoiceScoreEntry(...args) {
  const runtime = getVoiceScoreRuntime();
  return typeof runtime?.stopVoiceScoreEntry === "function"
    ? runtime.stopVoiceScoreEntry(...args)
    : false;
}

function processLazyVoiceScoreTranscript(...args) {
  return invokeLazyVoiceScoreRuntime("processVoiceScoreTranscript", ...args);
}

function parseLazyVoiceScoreCommand(...args) {
  return invokeLazyVoiceScoreRuntime("parseVoiceScoreCommand", ...args);
}

function requestLazyVoiceScoreActionPlan(...args) {
  return invokeLazyVoiceScoreRuntime("requestVoiceScoreActionPlan", ...args);
}

function requestLazyVoiceScoreMicrophonePermission(...args) {
  return invokeLazyVoiceScoreRuntime("requestVoiceScoreMicrophonePermission", ...args);
}
