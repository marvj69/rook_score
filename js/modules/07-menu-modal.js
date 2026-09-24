"use strict";

// --- Menu & Modal Toggling ---

const DEALER_INPUT_IDS = ["dealer1", "dealer2", "dealer3", "dealer4"];
const DEALER_SUGGESTION_LIMIT = 6;
const dealerSuggestionControllers = [];

function destroyDealerSuggestionControllers() {
  while (dealerSuggestionControllers.length) {
    const controller = dealerSuggestionControllers.pop();
    controller?.destroy?.();
  }
}

function getDealerInput(inputId) {
  return document.getElementById(inputId);
}

function getDealerInputName(inputId) {
  return sanitizePlayerName(getDealerInput(inputId)?.value || "");
}

function getDealerExcludedNames(activeInputId) {
  return DEALER_INPUT_IDS
    .filter(inputId => inputId !== activeInputId)
    .map(getDealerInputName)
    .filter(Boolean);
}

function hasDuplicateDealerNames(dealers) {
  const seen = new Set();
  return dealers.some((dealer) => {
    const key = sanitizePlayerName(dealer).toLowerCase();
    if (!key) return false;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

function shouldUseMobileDealerLayout() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(max-width: 640px), (pointer: coarse)").matches;
}

function shouldAutoFocusDealerInput() {
  return !(typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches);
}

function scrollDealerElementIntoView(element) {
  if (!element || !shouldUseMobileDealerLayout()) return;
  window.setTimeout(() => {
    element.scrollIntoView?.({ block: "center", inline: "nearest" });
  }, 80);
}

function focusNextDealerField(currentInputId) {
  const currentIndex = DEALER_INPUT_IDS.indexOf(currentInputId);
  const followingIds = currentIndex >= 0 ? DEALER_INPUT_IDS.slice(currentIndex + 1) : [];
  const nextInputId = followingIds.find(inputId => !getDealerInputName(inputId)) || followingIds[0];
  const nextInput = nextInputId ? getDealerInput(nextInputId) : null;

  if (nextInput) {
    window.setTimeout(() => {
      nextInput.focus();
      scrollDealerElementIntoView(nextInput);
    }, 0);
    return;
  }

  const submitButton = document.getElementById("dealerOrderSubmitBtn")
    || document.querySelector("#dealerOrderForm button[type='submit']");
  window.setTimeout(() => submitButton?.focus(), 0);
}

// Shows an inline error under the seats and outlines the seats that caused it.
function setDealerOrderError(message = "", invalidInputIds = []) {
  const errorEl = document.getElementById("dealerOrderError");
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.toggle("hidden", !message);
  }
  DEALER_INPUT_IDS.forEach((inputId) => {
    const input = getDealerInput(inputId);
    const isInvalid = invalidInputIds.includes(inputId);
    input?.closest?.(".dealer-seat")?.classList.toggle("is-invalid", isInvalid);
    input?.setAttribute?.("aria-invalid", isInvalid ? "true" : "false");
  });
}

function hideDealerSuggestionsExcept(activeInputId = "") {
  DEALER_INPUT_IDS.forEach((inputId) => {
    if (inputId === activeInputId) return;
    setDealerSuggestionsVisibility(document.getElementById(`${inputId}Suggestions`), false);
  });
}

function setDealerSuggestionsVisibility(container, visible) {
  if (!container) return;
  container.classList.toggle("hidden", !visible);
  const inputId = container.id?.replace(/Suggestions$/, "");
  if (inputId) {
    document.getElementById(inputId)?.setAttribute("aria-expanded", visible ? "true" : "false");
  }
}

function renderDealerSuggestionItems(container, suggestions, onSelect) {
  if (!container) return;
  if (!suggestions.length) {
    container.innerHTML = "";
    setDealerSuggestionsVisibility(container, false);
    return;
  }

  container.innerHTML = suggestions
    .map((name, index) => `<button type="button" id="${container.id}Option${index}" role="option" class="dealer-suggestion-option" data-suggested-name="${escapeAttribute(name)}">${escapeHtml(name)}</button>`)
    .join("");
  setDealerSuggestionsVisibility(container, true);

  Array.from(container.querySelectorAll("button[data-suggested-name]")).forEach((button) => {
    let selected = false;
    const handleSelect = (event) => {
      event?.preventDefault?.();
      if (selected) return;
      selected = true;
      onSelect(button.dataset.suggestedName || "");
    };
    if (typeof window !== "undefined" && "PointerEvent" in window) {
      button.addEventListener("pointerdown", handleSelect);
      button.addEventListener("click", handleSelect);
    } else {
      button.addEventListener("mousedown", handleSelect);
      button.addEventListener("touchstart", handleSelect, { passive: false });
      button.addEventListener("click", handleSelect);
    }
  });
}

function createDealerSuggestionController(inputId) {
  const input = getDealerInput(inputId);
  const container = document.getElementById(`${inputId}Suggestions`);
  if (!input || !container) return null;

  let blurTimeoutId = null;

  const updateSuggestions = () => {
    clearTimeout(blurTimeoutId);
    hideDealerSuggestionsExcept(inputId);
    const orderedSuggestions = refreshPlayerSuggestions();
    const currentName = sanitizePlayerName(input.value).toLowerCase();
    const filteredSuggestions = getFilteredPlayerSuggestions(
      orderedSuggestions,
      input.value,
      DEALER_SUGGESTION_LIMIT,
      getDealerExcludedNames(inputId)
    ).filter(name => name.toLowerCase() !== currentName);

    renderDealerSuggestionItems(container, filteredSuggestions, (selectedName) => {
      input.value = selectedName;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      setDealerSuggestionsVisibility(container, false);
      focusNextDealerField(inputId);
    });
  };

  const handleFocus = () => {
    updateSuggestions();
    scrollDealerElementIntoView(input);
  };
  const handleInput = () => {
    setDealerOrderError("");
    updateSuggestions();
  };
  const handleKeydown = (event) => {
    if (event.key === "Escape") {
      // The first Escape only dismisses the suggestion list; the sheet stays open.
      if (container && !container.classList.contains("hidden")) {
        event.preventDefault();
        event.stopPropagation();
      }
      setDealerSuggestionsVisibility(container, false);
      return;
    }
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    setDealerSuggestionsVisibility(container, false);
    if (getDealerInputName(inputId)) focusNextDealerField(inputId);
  };
  const handleBlur = () => {
    clearTimeout(blurTimeoutId);
    blurTimeoutId = window.setTimeout(() => setDealerSuggestionsVisibility(container, false), 180);
  };

  input.addEventListener("focus", handleFocus);
  input.addEventListener("input", handleInput);
  input.addEventListener("keydown", handleKeydown);
  input.addEventListener("blur", handleBlur);

  return {
    destroy() {
      clearTimeout(blurTimeoutId);
      input.removeEventListener("focus", handleFocus);
      input.removeEventListener("input", handleInput);
      input.removeEventListener("keydown", handleKeydown);
      input.removeEventListener("blur", handleBlur);
      container.innerHTML = "";
      setDealerSuggestionsVisibility(container, false);
    },
  };
}

function setupDealerNameSuggestions() {
  destroyDealerSuggestionControllers();
  DEALER_INPUT_IDS.forEach((inputId) => {
    const controller = createDealerSuggestionController(inputId);
    if (controller) {
      dealerSuggestionControllers.push(controller);
    }
  });
}

function toggleMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById("menu");
  const icon = document.getElementById("hamburgerIcon");
  const overlay = document.getElementById("menuOverlay");
  const isOpen = menu.classList.toggle("show");
  if ("inert" in menu) menu.inert = !isOpen;
  icon.classList.toggle("open", isOpen);
  overlay.classList.toggle("show", isOpen);
  document.body.classList.toggle("overflow-hidden", isOpen);
}
function closeMenuOverlay() {
  const menu = document.getElementById("menu");
  menu?.classList.remove("show");
  if (menu && "inert" in menu) menu.inert = true;
  document.getElementById("hamburgerIcon")?.classList.remove("open");
  document.getElementById("menuOverlay")?.classList.remove("show");
  document.body.classList.remove("overflow-hidden");
}

function activateModalEnvironment() {
  document.body.classList.add("modal-open");
  const app = document.getElementById("app");
  app?.classList.add("modal-active");
  // Keep the blurred page out of the tab and screen-reader order while a sheet is open.
  if (app && "inert" in app) app.inert = true;
}

function deactivateModalEnvironment() {
  const anyOpenModal = Array.from(document.querySelectorAll(".modal"))
    .some(modal => !modal.classList.contains("hidden"));
  if (!anyOpenModal) {
    document.body.classList.remove("modal-open");
    const app = document.getElementById("app");
    app?.classList.remove("modal-active");
    if (app && "inert" in app) app.inert = false;
  }
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  modal?.classList.remove("hidden");
  activateModalEnvironment();
  modal?.focus(); // For accessibility
}
function closeModal(modalId) {
  document.getElementById(modalId)?.classList.add("hidden");
  deactivateModalEnvironment();
}
// Bottom sheets slide down on phones before hiding; everywhere else they close immediately.
function closeSheetModal(modalId) {
  const modal = document.getElementById(modalId);
  const shell = modal?.querySelector(".stats-modal__shell");
  const matches = (query) => typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const canAnimate = modal && shell && !modal.classList.contains("hidden")
    && modal.dataset.sheetDismissed !== "true"
    && matches("(max-width: 640px)") && !matches("(prefers-reduced-motion: reduce)");
  if (!canAnimate) {
    cancelSheetClose(modalId);
    closeModal(modalId);
    return;
  }
  if (modal.sheetCloseTimer) return;
  modal.classList.add("is-closing");
  modal.sheetCloseTimer = setTimeout(() => {
    cancelSheetClose(modalId);
    closeModal(modalId);
  }, 240);
}
function cancelSheetClose(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  clearTimeout(modal.sheetCloseTimer);
  modal.sheetCloseTimer = null;
  modal.classList.remove("is-closing");
}
function openSheetModal(modalId, closeFn) {
  cancelSheetClose(modalId);
  openModal(modalId);
  ensureStatsSheetGesture(modalId, closeFn);
}
function openSavedGamesModal() {
  cancelSheetClose("savedGamesModal");
  updateGamesCount();
  switchGamesTab('completed'); // Default to completed games
  openModal("savedGamesModal");
  ensureStatsSheetGesture("savedGamesModal", closeSavedGamesModal);
}
function closeSavedGamesModal() { closeSheetModal("savedGamesModal"); }
const DIALOG_TONES = ["info", "warning", "danger", "success", "frost", "gold"];
// Icons live in the #dialog-icon-* SVG sprite in index.html.
function getDialogIconSvg(name) {
  return `<svg aria-hidden="true"><use href="#dialog-icon-${name}"/></svg>`;
}

function setDialogTone(card, tone) {
  if (!card?.classList) return;
  DIALOG_TONES.forEach(name => card.classList.toggle(`dialog-card--${name}`, name === tone));
}

// Fills a dialog's title, message, icon, and tone. Returns false when the markup is missing.
function fillDialog(prefix, message, { title, tone = "info", icon } = {}) {
  const messageEl = document.getElementById(`${prefix}Message`);
  if (!messageEl) return false;
  messageEl.textContent = message;
  const titleEl = document.getElementById(`${prefix}Title`);
  if (titleEl && title) titleEl.textContent = title;
  const iconEl = document.getElementById(`${prefix}Icon`);
  if (iconEl) iconEl.innerHTML = getDialogIconSvg(icon || { danger: "trash", success: "check", frost: "snowflake" }[tone] || tone);
  setDialogTone(document.getElementById(`${prefix}Card`), tone);
  return true;
}

// options: { title, confirmLabel, cancelLabel, tone: "info" | "warning" | "danger" | "frost", icon }
function openConfirmationModal(message, yesCb, noCb, options = {}) {
  const { confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "info", icon } = options;
  fillDialog("confirmationModal", message, { title: options.title || "Are you sure?", tone, icon });
  confirmationCallback = yesCb; noCallback = noCb;
  openModal("confirmationModal");
  // Re-bind buttons to avoid multiple listeners if not careful
  const yesBtn = document.getElementById("confirmModalButton");
  const noBtn = document.getElementById("noModalButton");
  const newYes = yesBtn.cloneNode(true); yesBtn.parentNode.replaceChild(newYes, yesBtn);
  const newNo = noBtn.cloneNode(true); noBtn.parentNode.replaceChild(newNo, noBtn);
  newYes.textContent = confirmLabel;
  newNo.textContent = cancelLabel;
  newYes.addEventListener("click", (e) => { e.stopPropagation(); if (confirmationCallback) confirmationCallback(); });
  newNo.addEventListener("click", (e) => { e.stopPropagation(); if (noCallback) noCallback(); });
  // Destructive prompts land on Cancel so a stray Enter can't delete anything.
  (tone === "danger" ? newNo : newYes).focus?.();
}
function closeConfirmationModal() { closeModal("confirmationModal"); confirmationCallback = null; noCallback = null; }
// Backdrop tap / Escape: behave like Cancel so callers can react to the dismissal.
function dismissConfirmationModal() {
  if (typeof noCallback === "function") noCallback();
  else closeConfirmationModal();
}

// In-app replacement for window.alert(). options: { title, tone, icon, buttonLabel }
function showNoticeModal(message, options = {}) {
  const { tone = "warning", icon, buttonLabel = "Got it" } = options;
  if (!fillDialog("noticeModal", message, { title: options.title || "Heads up", tone, icon })) {
    window.alert?.(message);
    return;
  }
  const button = document.getElementById("noticeModalButton");
  if (button) button.textContent = buttonLabel;
  openModal("noticeModal");
  button?.focus?.();
}
function closeNoticeModal() { closeModal("noticeModal"); }

function openTeamSelectionModal() { populateTeamSelects(); openModal("teamSelectionModal"); }
function closeTeamSelectionModal() {
  closeModal("teamSelectionModal");
  // Save Game hides the game-over overlay before asking for names; bring it
  // back if the prompt is dismissed so Save, Rematch, and New Game stay reachable.
  if (state.gameOver) scheduleRender();
}
function openDealerOrderModal() {
  const form = document.getElementById("dealerOrderForm");
  if (form) form.reset();
  setDealerOrderError("");
  refreshPlayerSuggestions();
  setupDealerNameSuggestions();
  openModal("dealerOrderModal");
  const firstDealerInput = getDealerInput("dealer1");
  if (shouldAutoFocusDealerInput()) {
    firstDealerInput?.focus();
  } else {
    scrollDealerElementIntoView(firstDealerInput);
  }
}
function closeDealerOrderModal() {
  destroyDealerSuggestionControllers();
  closeModal("dealerOrderModal");
}
function openDealerPairSelectionModal() {
  // Populate the button text with dealer names
  if (state.dealers && state.dealers.length === 4) {
    const pair13Text = `${state.dealers[0]} & ${state.dealers[2]}`;
    const pair24Text = `${state.dealers[1]} & ${state.dealers[3]}`;
    document.getElementById("pair13Text").textContent = pair13Text;
    document.getElementById("pair24Text").textContent = pair24Text;
  }
  openModal("dealerPairSelectionModal");
}
function closeDealerPairSelectionModal() {
  closeModal("dealerPairSelectionModal");
  if (state.gameOver) scheduleRender();
}
function handleDealerPairSelection(pair) {
  closeDealerPairSelectionModal();
  
  // Set up the team players based on selection
  if (pair === '13') {
    // Dealers 1 & 3 are "Us", Dealers 2 & 4 are "Dem"
    window.prePopulatedTeamData = {
      usPlayers: [state.dealers[0], state.dealers[2]],
      demPlayers: [state.dealers[1], state.dealers[3]]
    };
  } else if (pair === '24') {
    // Dealers 2 & 4 are "Us", Dealers 1 & 3 are "Dem"
    window.prePopulatedTeamData = {
      usPlayers: [state.dealers[1], state.dealers[3]],
      demPlayers: [state.dealers[0], state.dealers[2]]
    };
  }
  
  // Open team selection modal with pre-populated data
  openTeamSelectionModal();
}
function handleDealerOrderSubmit(event) {
  event.preventDefault();
  const dealers = DEALER_INPUT_IDS.map(getDealerInputName);

  const emptyIds = DEALER_INPUT_IDS.filter((inputId, index) => !dealers[index]);
  if (emptyIds.length) {
    setDealerOrderError(
      emptyIds.length === 1
        ? `Enter a name for seat ${DEALER_INPUT_IDS.indexOf(emptyIds[0]) + 1}.`
        : `Enter names for all four seats (${emptyIds.length} empty).`,
      emptyIds
    );
    getDealerInput(emptyIds[0])?.focus();
    return;
  }

  const keys = dealers.map(name => name.toLowerCase());
  const duplicateIds = DEALER_INPUT_IDS.filter((inputId, index) => keys.indexOf(keys[index]) !== keys.lastIndexOf(keys[index]));
  if (duplicateIds.length) {
    setDealerOrderError("Each dealer needs a different name.", duplicateIds);
    getDealerInput(duplicateIds[duplicateIds.length - 1])?.focus();
    return;
  }

  updateState({ dealers });
  saveCurrentGameState();
  closeDealerOrderModal();
}
function openResumeGameModal() {
  const form = document.getElementById("resumeGameForm");
  const errorEl = document.getElementById("resumeGameError");
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }
  if (form) form.reset();
  if (typeof resetPaperGamePhotoUI === "function") resetPaperGamePhotoUI();
  refreshPlayerSuggestions();

  const totals = getCurrentTotals();
  const basePlayers = {
    us: (() => {
      const players = ensurePlayersArray(state.usPlayers);
      if (players.some(Boolean)) return players;
      return ensurePlayersArray(parseLegacyTeamName(state.usTeamName || ""));
    })(),
    dem: (() => {
      const players = ensurePlayersArray(state.demPlayers);
      if (players.some(Boolean)) return players;
      return ensurePlayersArray(parseLegacyTeamName(state.demTeamName || ""));
    })(),
  };

  const usPlayerOneInput = document.getElementById("resumeUsPlayerOne");
  const usPlayerTwoInput = document.getElementById("resumeUsPlayerTwo");
  const demPlayerOneInput = document.getElementById("resumeDemPlayerOne");
  const demPlayerTwoInput = document.getElementById("resumeDemPlayerTwo");
  const usScoreInput = document.getElementById("resumeUsScore");
  const demScoreInput = document.getElementById("resumeDemScore");

  if (usPlayerOneInput) usPlayerOneInput.value = basePlayers.us[0] || "";
  if (usPlayerTwoInput) usPlayerTwoInput.value = basePlayers.us[1] || "";
  if (demPlayerOneInput) demPlayerOneInput.value = basePlayers.dem[0] || "";
  if (demPlayerTwoInput) demPlayerTwoInput.value = basePlayers.dem[1] || "";
  if (usScoreInput) usScoreInput.value = totals.us;
  if (demScoreInput) demScoreInput.value = totals.dem;

  openSheetModal("resumeGameModal", closeResumeGameModal);
}
function closeResumeGameModal() {
  if (typeof cancelPaperGamePhotoScan === "function") cancelPaperGamePhotoScan();
  const errorEl = document.getElementById("resumeGameError");
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }
  closeSheetModal("resumeGameModal");
}
function handleResumeGameSubmit(event) {
  event.preventDefault();
  const errorEl = document.getElementById("resumeGameError");
  const showError = (message) => {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove("hidden");
    } else {
      showNoticeModal(message, { title: "Check the score" });
    }
  };

  const usScoreInput = document.getElementById("resumeUsScore");
  const demScoreInput = document.getElementById("resumeDemScore");

  if (!usScoreInput || !demScoreInput) {
    closeResumeGameModal();
    return;
  }

  const usScore = Number(usScoreInput.value);
  const demScore = Number(demScoreInput.value);

  const scoresAreNumbers = Number.isFinite(usScore) && Number.isFinite(demScore);
  if (!scoresAreNumbers) {
    showError("Scores must be numbers.");
    return;
  }

  const withinBounds = Math.abs(usScore) <= 1000 && Math.abs(demScore) <= 1000;
  if (!withinBounds) {
    showError("Scores should stay between -1000 and 1000.");
    return;
  }

  const isMultipleOfFive = (value) => Math.abs(value % 5) < 1e-9;
  if (!isMultipleOfFive(usScore) || !isMultipleOfFive(demScore)) {
    showError("Scores must be in increments of 5.");
    return;
  }

  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }

  const usPlayers = ensurePlayersArray([
    sanitizePlayerName(document.getElementById("resumeUsPlayerOne")?.value || ""),
    sanitizePlayerName(document.getElementById("resumeUsPlayerTwo")?.value || ""),
  ]);
  const demPlayers = ensurePlayersArray([
    sanitizePlayerName(document.getElementById("resumeDemPlayerOne")?.value || ""),
    sanitizePlayerName(document.getElementById("resumeDemPlayerTwo")?.value || ""),
  ]);

  const startingTotals = sanitizeTotals({ us: usScore, dem: demScore });
  const updates = {
    rounds: [],
    undoneRounds: [],
    startingTotals,
    gameOver: false,
    winner: null,
    victoryMethod: null,
    lastBidAmount: null,
    lastBidTeam: null,
    biddingTeam: "",
    bidAmount: "",
    showCustomBid: false,
    customBidValue: "",
    enterBidderPoints: false,
    error: "",
    startTime: null,
    timerStarted: false,
    accumulatedTime: 0,
    timerLastSavedAt: null,
    timerLastActivityAt: null,
    timerPaused: false,
    timerSkippedMs: 0,
    pendingPenalty: null,
    savedScoreInputStates: { us: null, dem: null },
  };

  updates.usPlayers = usPlayers;
  updates.demPlayers = demPlayers;

  updateState(updates);
  confettiTriggered = false;
  pendingGameAction = null;
  closeResumeGameModal();
  saveCurrentGameState();
  showSaveIndicator("Starting scores set!");
}

function openSettingsModal() {
  const mustWinToggle = document.getElementById("mustWinByBidToggle");
  if (mustWinToggle) mustWinToggle.checked = !!getLocalStorage(MUST_WIN_BY_BID_KEY, false);
  const proToggleModal = document.getElementById("proModeToggleModal");
  if (proToggleModal) proToggleModal.checked = !!getLocalStorage(PRO_MODE_KEY, false);

  // Load all settings using the common function
  loadSettings();

  openSheetModal("settingsModal", closeSettingsModal);
}
function closeSettingsModal() {
  saveSettings();
  closeSheetModal("settingsModal");
}
function openAboutModal() { openSheetModal("aboutModal", closeAboutModal); }
function closeAboutModal() { closeSheetModal("aboutModal"); }
function openStatisticsModal() { renderStatisticsContent(); openModal("statisticsModal"); }
function closeStatisticsModal() {
  closeModal("statisticsModal");
  document.getElementById("statisticsModalContent").innerHTML = "";
  closeEntityStatisticsModal();
}
function openViewSavedGameModal() {
  cancelSheetClose("viewSavedGameModal");
  openModal("viewSavedGameModal");
  ensureStatsSheetGesture("viewSavedGameModal", closeViewSavedGameModal);
}
function closeViewSavedGameModal() {
  const libraryModal = document.getElementById("savedGamesModal");
  if (libraryModal?.classList.contains("hidden")) openModal("savedGamesModal"); // Reopen parent
  closeSheetModal("viewSavedGameModal");
}

function openZeroPointsModal(callback) {
  let zeroPointsCallback = callback;

  // Open the modal
  openModal("zeroPointsModal");

  // Add event listeners to the buttons
  const btn180 = document.getElementById("zeroPts180Btn");
  const btn360 = document.getElementById("zeroPts360Btn");
  const btnCancel = document.getElementById("zeroPtsCancelBtn");

  // Remove existing listeners by cloning nodes
  const newBtn180 = btn180.cloneNode(true);
  const newBtn360 = btn360.cloneNode(true);
  const newBtnCancel = btnCancel.cloneNode(true);

  btn180.parentNode.replaceChild(newBtn180, btn180);
  btn360.parentNode.replaceChild(newBtn360, btn360);
  btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

  // Add new event listeners
  newBtn180.addEventListener("click", (e) => {
    e.stopPropagation();
    closeModal("zeroPointsModal");
    if (zeroPointsCallback) zeroPointsCallback(180);
  });

  newBtn360.addEventListener("click", (e) => {
    e.stopPropagation();
    closeModal("zeroPointsModal");
    if (zeroPointsCallback) zeroPointsCallback(360);
  });

  newBtnCancel.addEventListener("click", (e) => {
    e.stopPropagation();
    closeModal("zeroPointsModal");
    // No callback on cancel
  });
}
