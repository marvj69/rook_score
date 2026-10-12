"use strict";

// --- Settings & Pro Mode ---
function saveSettings() {
  const mustWinToggle = document.getElementById("mustWinByBidToggle");
  if (mustWinToggle) setLocalStorage(MUST_WIN_BY_BID_KEY, mustWinToggle.checked);

  const misdealToggle = document.getElementById("misdealHandlingToggle");
  if (misdealToggle) setLocalStorage(MISDEAL_HANDLING_KEY, misdealToggle.checked);

  const voiceImprovementOptInToggle = document.getElementById("voiceImprovementOptInToggle");
  if (voiceImprovementOptInToggle) {
    setLocalStorage(VOICE_IMPROVEMENT_OPT_IN_KEY, voiceImprovementOptInToggle.checked);
  }

  const penaltySelect = document.getElementById("tableTalkPenaltySelect");
  if (penaltySelect) setLocalStorage(TABLE_TALK_PENALTY_TYPE_KEY, penaltySelect.value);

  const penaltyPointsInput = document.getElementById("penaltyPointsInput");
  if (penaltyPointsInput) {
    const points = normalizePenaltyPoints(penaltyPointsInput.value);
    penaltyPointsInput.value = points; // Show the corrected value
    setLocalStorage(TABLE_TALK_PENALTY_POINTS_KEY, points);
  }

  renderApp();
}
function updateProModeUI(isProMode) {
  const proToggleModal = document.getElementById("proModeToggleModal");
  if (proToggleModal) proToggleModal.checked = isProMode;
  updateState({ showWinProbability: isProMode }); // Update live state
}
function toggleProMode(checkbox) {
  const isPro = checkbox.checked;
  setLocalStorage(PRO_MODE_KEY, isPro);
  updateProModeUI(isPro);
  saveCurrentGameState(); // Save state with new pro mode setting
  emitRookEvent("pro_mode_toggled", getRookGameEventParams(state, { pro_mode: isPro }));
}

// fetch() rejects with a bare "Failed to fetch" ("Load failed" in Safari) when the server cannot be
// reached; that is not something to show or read aloud to a player at the table.
function describeRequestFailure(error, fallback) {
  const text = String(error?.message || "");
  if (error?.name === "TypeError" || /failed to fetch|load failed|networkerror|network request failed/i.test(text)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return text || fallback;
}

function isExperimentalFeaturesEnabled() {
  return Boolean(getLocalStorage(EXPERIMENTAL_FEATURES_KEY, false));
}

function isVoiceImprovementOptedIn() {
  return Boolean(getLocalStorage(VOICE_IMPROVEMENT_OPT_IN_KEY, false));
}

function isVoiceExperimentalOnboardingComplete() {
  return Boolean(getLocalStorage(VOICE_EXPERIMENTAL_ONBOARDING_KEY, false));
}

// Whether the voice runtime was last told to run, so it is only started or stopped when that changes.
let experimentalRuntimeEnabled = null;

function updateExperimentalFeaturesUI(isEnabled) {
  const experimentalFeaturesToggle = document.getElementById("experimentalFeaturesToggle");
  if (experimentalFeaturesToggle) experimentalFeaturesToggle.checked = Boolean(isEnabled);
  if (typeof updatePaperGamePhotoExperimentUI === "function") {
    updatePaperGamePhotoExperimentUI(isEnabled);
  }
  updateVoiceImprovementConsentUI();
  // The microphone follows the setting however it changed: the toggle, or a cloud merge that
  // rewrote it (loadSettings lands here). Before, a merged "off" left a dead mic on screen and a
  // merged "on" showed no mic until the next launch. It only runs once the voice walkthrough is
  // done (the runtime refuses to start before), so a setting that was already on at launch must not
  // count as started: finishing the walkthrough is what starts it.
  const runtimeShouldRun = Boolean(isEnabled) && isVoiceExperimentalOnboardingComplete();
  if (experimentalRuntimeEnabled !== runtimeShouldRun) {
    experimentalRuntimeEnabled = runtimeShouldRun;
    if (runtimeShouldRun) initializeVoiceScoreModuleWhenEnabled();
    else cancelLoadedVoiceScoreEntry();
  }
}

function updateVoiceImprovementConsentUI(isEnabled = isVoiceImprovementOptedIn()) {
  const settingsToggle = document.getElementById("voiceImprovementOptInToggle");
  if (settingsToggle) settingsToggle.checked = Boolean(isEnabled);
  const settingsContainer = document.getElementById("voiceImprovementOptInContainer");
  if (settingsContainer) {
    settingsContainer.classList.toggle("hidden", !isExperimentalFeaturesEnabled());
  }
}

function setExperimentalFeaturesEnabled(isEnabled) {
  setLocalStorage(EXPERIMENTAL_FEATURES_KEY, isEnabled);
  updateExperimentalFeaturesUI(isEnabled);
  return isEnabled;
}

// Each request for microphone access gets a number. Cancelling or switching off while the browser's
// permission prompt is still open retires it, so a "yes" that arrives later cannot turn the feature on.
let experimentalPermissionRequestId = 0;

function setVoiceExperimentalOnboardingError(message = "") {
  const errorElement = document.getElementById("voiceExperimentalOnboardingError");
  if (!errorElement) return;
  errorElement.textContent = message;
  errorElement.classList.toggle("hidden", !message);
}

function openVoiceExperimentalOnboarding() {
  const consentCheckbox = document.getElementById("voiceImprovementConsentCheckbox");
  if (consentCheckbox) consentCheckbox.checked = isVoiceImprovementOptedIn();
  setVoiceExperimentalOnboardingError("");
  openModal("voiceExperimentalOnboardingModal");
}

function cancelVoiceExperimentalOnboarding() {
  experimentalPermissionRequestId += 1;
  closeModal("voiceExperimentalOnboardingModal");
  setExperimentalFeaturesEnabled(false);
}

async function continueVoiceExperimentalOnboarding() {
  const requestId = ++experimentalPermissionRequestId;
  const continueButton = document.getElementById("voiceExperimentalOnboardingContinue");
  const consentCheckbox = document.getElementById("voiceImprovementConsentCheckbox");
  if (continueButton) continueButton.disabled = true;
  setVoiceExperimentalOnboardingError("");

  try {
    await requestLazyVoiceScoreMicrophonePermission();
    if (requestId !== experimentalPermissionRequestId) return false; // Cancelled while the browser was asking
    const optedIn = Boolean(consentCheckbox?.checked);
    setLocalStorage(VOICE_IMPROVEMENT_OPT_IN_KEY, optedIn);
    setLocalStorage(VOICE_EXPERIMENTAL_ONBOARDING_KEY, true);
    updateVoiceImprovementConsentUI(optedIn);
    closeModal("voiceExperimentalOnboardingModal");
    setExperimentalFeaturesEnabled(true);
    return true;
  } catch (error) {
    if (requestId !== experimentalPermissionRequestId) return false;
    setExperimentalFeaturesEnabled(false);
    const permissionDenied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
    setVoiceExperimentalOnboardingError(
      permissionDenied
        ? "Microphone permission was not granted. Allow it in your browser settings, then try again."
        : (error?.message || "Microphone access could not be started."),
    );
    return false;
  } finally {
    if (continueButton) continueButton.disabled = false;
  }
}

async function enableExperimentalFeaturesWithMicrophone(checkbox) {
  const requestId = ++experimentalPermissionRequestId;
  if (checkbox) checkbox.disabled = true;
  try {
    await requestLazyVoiceScoreMicrophonePermission();
    if (requestId !== experimentalPermissionRequestId) return false; // Switched off while the browser was asking
    setExperimentalFeaturesEnabled(true);
    return true;
  } catch (error) {
    if (requestId !== experimentalPermissionRequestId) return false;
    setExperimentalFeaturesEnabled(false);
    const message = error?.name === "NotAllowedError" || error?.name === "SecurityError"
      ? "Microphone permission is required for Experimental Features"
      : (error?.message || "Microphone access is unavailable");
    showWarningToast(message);
    return false;
  } finally {
    if (checkbox) checkbox.disabled = false;
  }
}

function toggleExperimentalFeatures(checkbox) {
  const isEnabled = Boolean(checkbox?.checked);
  if (!isEnabled) {
    experimentalPermissionRequestId += 1;
    return setExperimentalFeaturesEnabled(false);
  }

  if (!isVoiceExperimentalOnboardingComplete()) {
    openVoiceExperimentalOnboarding();
    return false;
  }

  enableExperimentalFeaturesWithMicrophone(checkbox);
  return true;
}

function toggleVoiceImprovementConsent(checkbox) {
  const optedIn = Boolean(checkbox?.checked);
  setLocalStorage(VOICE_IMPROVEMENT_OPT_IN_KEY, optedIn);
  updateVoiceImprovementConsentUI(optedIn);
  return optedIn;
}

function maybePromptForVoiceExperimentalOnboarding() {
  if (isExperimentalFeaturesEnabled() && !isVoiceExperimentalOnboardingComplete()) {
    openVoiceExperimentalOnboarding();
    return true;
  }
  return false;
}

function handleTableTalkPenaltyChange() {
  const penaltySelect = document.getElementById("tableTalkPenaltySelect");
  const customPointsDiv = document.getElementById("customPenaltyPoints");

  if (penaltySelect && customPointsDiv) {
    if (penaltySelect.value === "setPoints") {
      customPointsDiv.classList.remove("hidden");
    } else {
      customPointsDiv.classList.add("hidden");
    }

    // Save the penalty type setting
    setLocalStorage(TABLE_TALK_PENALTY_TYPE_KEY, penaltySelect.value);
  }
}

// 5 to 500 in steps of 5; anything else goes back to the standard 180.
function normalizePenaltyPoints(raw) {
  let points = parseInt(raw, 10);
  if (isNaN(points) || points < 5 || points > 500) points = 180;
  if (points % 5 !== 0) points = Math.round(points / 5) * 5;
  return points;
}

function handlePenaltyPointsChange() {
  const penaltyPointsInput = document.getElementById("penaltyPointsInput");
  if (penaltyPointsInput) {
    const points = normalizePenaltyPoints(penaltyPointsInput.value);
    penaltyPointsInput.value = points;
    setLocalStorage(TABLE_TALK_PENALTY_POINTS_KEY, points.toString());
  }
}

// --- Validation ---
function validateBid(bidStr) {
  const bidNum = Number(bidStr);
  if (isNaN(bidNum)) return "Bid must be a number.";
  if (bidNum <= 0) return "Bid must be > 0.";
  if (bidNum % 5 !== 0) return "Bid must be multiple of 5.";
  if (bidNum > 360) return "Bid max 360.";
  if (bidNum > 180 && bidNum < 360) return "Bids between 180 and 360 are not allowed.";
  return "";
}
function validatePoints(pointsStr) {
  const pointsNum = Number(pointsStr);
  if (isNaN(pointsNum)) return "Points must be a number.";
  if (pointsNum % 5 !== 0) return "Points must be multiple of 5.";
  if (pointsNum !== 360 && (pointsNum < 0 || pointsNum > 180)) return "Points 0-180 or 360.";
  return "";
}

// --- Misc UI & Utility ---
function showVersionNum() {
  const modal = document.getElementById("versionInfoModal");
  if (!modal) return;

  const title = document.getElementById("versionInfoModalTitle");
  if (title) title.textContent = `Version ${APP_VERSION}`;

  const message = document.getElementById("versionInfoModalMessage");
  if (message) message.textContent = APP_RELEASE_SUMMARY;

  openModal("versionInfoModal");
}

function closeVersionInfoModal() {
  closeModal("versionInfoModal");
}
function formatDuration(ms) {
  if (!ms || ms < 0) return "0:00";
  const totalMinutes = Math.floor(ms / 60000);
  const hrs = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const minutePart = mins.toString().padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}h ${minutePart}m`;
  }
  return `${mins}m`;
}

function formatLiveGameDuration(ms) {
  const totalSeconds = Math.floor(clampDurationMs(ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const secondsPart = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${secondsPart}`;
  }
  return `${minutes}:${secondsPart}`;
}
