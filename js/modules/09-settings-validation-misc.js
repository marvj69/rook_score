"use strict";

// --- Settings & Pro Mode ---
function saveSettings() {
  const mustWinToggle = document.getElementById("mustWinByBidToggle");
  if (mustWinToggle) setLocalStorage(MUST_WIN_BY_BID_KEY, mustWinToggle.checked);

  const misdealToggle = document.getElementById("misdealHandlingToggle");
  if (misdealToggle) setLocalStorage(MISDEAL_HANDLING_KEY, misdealToggle.checked);

  const penaltySelect = document.getElementById("tableTalkPenaltySelect");
  if (penaltySelect) setLocalStorage(TABLE_TALK_PENALTY_TYPE_KEY, penaltySelect.value);

  const penaltyPointsInput = document.getElementById("penaltyPointsInput");
  if (penaltyPointsInput) {
    let points = parseInt(penaltyPointsInput.value) || 180;

    // Validate and round to nearest multiple of 5
    if (points < 5) points = 5;
    if (points > 500) points = 500;
    if (points % 5 !== 0) {
      points = Math.round(points / 5) * 5;
      penaltyPointsInput.value = points; // Update the input to show corrected value
    }

    setLocalStorage(TABLE_TALK_PENALTY_POINTS_KEY, points);
  }

  renderApp();
  showSaveIndicator("Settings Saved");
}
function updateProModeUI(isProMode) {
  document.getElementById('editPresetsContainerModal')?.classList.remove('hidden'); // Always show
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
    console.log("Saving Table Talk Penalty Type:", penaltySelect.value);
    setLocalStorage(TABLE_TALK_PENALTY_TYPE_KEY, penaltySelect.value);
  }
}

function handlePenaltyPointsChange() {
  const penaltyPointsInput = document.getElementById("penaltyPointsInput");
  if (penaltyPointsInput) {
    let points = parseInt(penaltyPointsInput.value);

    // Validate the points
    if (isNaN(points) || points < 5 || points > 500) {
      points = 180; // Default value
      penaltyPointsInput.value = points;
    }

    // Ensure it's a multiple of 5
    if (points % 5 !== 0) {
      points = Math.round(points / 5) * 5;
      penaltyPointsInput.value = points;
    }

    // Save the penalty points setting
    console.log("Saving Table Talk Penalty Points:", points);
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
// Time protection constants
const MAX_GAME_TIME_MS = 10 * 60 * 60 * 1000; // 10 hours maximum
const MAX_ROUND_TIME_MS = 2 * 60 * 60 * 1000; // 2 hours maximum per round

function clampDurationMs(value, cap = MAX_GAME_TIME_MS) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(num, cap);
}

function isStartTimestampActive(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
}

function calculateSafeTimeAccumulation(currentAccumulated, startTime, nowTs = Date.now()) {
  const base = clampDurationMs(currentAccumulated);
  const startMs = Number(startTime);
  if (!Number.isFinite(startMs) || startMs <= 0) return base;

  const elapsedRaw = nowTs - startMs;
  if (!Number.isFinite(elapsedRaw) || elapsedRaw <= 0) return base; // Guard against clock skew/invalid timestamps

  const cappedElapsed = Math.min(elapsedRaw, MAX_ROUND_TIME_MS);
  const totalTime = base + cappedElapsed;

  // Cap the total game time as well
  return Math.min(totalTime, MAX_GAME_TIME_MS);
}

function getCurrentGameTime() {
  const base = clampDurationMs(state.accumulatedTime);
  if (!isStartTimestampActive(state.startTime)) return base;
  return calculateSafeTimeAccumulation(base, state.startTime);
}

function renderTimeWarning() {
  return "";
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
