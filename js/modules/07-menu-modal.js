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
    .map((name, index) => `<button type="button" id="${container.id}Option${index}" role="option" class="dealer-suggestion-option block w-full px-4 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-blue-50 focus:bg-blue-50 focus:outline-none dark:text-white dark:hover:bg-gray-600 dark:focus:bg-gray-600" data-suggested-name="${escapeAttribute(name)}">${escapeHtml(name)}</button>`)
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
  const handleInput = () => updateSuggestions();
  const handleKeydown = (event) => {
    if (event.key === "Escape") {
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
    update: updateSuggestions,
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
  icon.classList.toggle("open", isOpen);
  overlay.classList.toggle("show", isOpen);
  document.body.classList.toggle("overflow-hidden", isOpen);
}
function closeMenuOverlay() {
  document.getElementById("menu")?.classList.remove("show");
  document.getElementById("hamburgerIcon")?.classList.remove("open");
  document.getElementById("menuOverlay")?.classList.remove("show");
  document.body.classList.remove("overflow-hidden");
}

function activateModalEnvironment() {
  document.body.classList.add("modal-open");
  document.getElementById("app")?.classList.add("modal-active");
}

function deactivateModalEnvironment() {
  const anyOpenModal = Array.from(document.querySelectorAll(".modal"))
    .some(modal => !modal.classList.contains("hidden"));
  if (!anyOpenModal) {
    document.body.classList.remove("modal-open");
    document.getElementById("app")?.classList.remove("modal-active");
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
function openSavedGamesModal() {
  updateGamesCount();
  switchGamesTab('completed'); // Default to completed games
  renderGamesWithFilter(); // Render based on default filter/sort
  openModal("savedGamesModal");
}
function closeSavedGamesModal() { closeModal("savedGamesModal"); }
function openConfirmationModal(message, yesCb, noCb) {
  document.getElementById("confirmationModalMessage").textContent = message;
  confirmationCallback = yesCb; noCallback = noCb;
  openModal("confirmationModal");
  // Re-bind buttons to avoid multiple listeners if not careful
  const yesBtn = document.getElementById("confirmModalButton");
  const noBtn = document.getElementById("noModalButton");
  const newYes = yesBtn.cloneNode(true); yesBtn.parentNode.replaceChild(newYes, yesBtn);
  const newNo = noBtn.cloneNode(true); noBtn.parentNode.replaceChild(newNo, noBtn);
  newYes.addEventListener("click", (e) => { e.stopPropagation(); if (confirmationCallback) confirmationCallback(); });
  newNo.addEventListener("click", (e) => { e.stopPropagation(); if (noCallback) noCallback(); });
}
function closeConfirmationModal() { closeModal("confirmationModal"); confirmationCallback = null; noCallback = null; }
function openTeamSelectionModal() { populateTeamSelects(); openModal("teamSelectionModal"); }
function closeTeamSelectionModal() { closeModal("teamSelectionModal"); }
function openDealerOrderModal() {
  const form = document.getElementById("dealerOrderForm");
  if (form) form.reset();
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
function closeDealerPairSelectionModal() { closeModal("dealerPairSelectionModal"); }
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
  const dealer1 = sanitizePlayerName(document.getElementById("dealer1")?.value || "");
  const dealer2 = sanitizePlayerName(document.getElementById("dealer2")?.value || "");
  const dealer3 = sanitizePlayerName(document.getElementById("dealer3")?.value || "");
  const dealer4 = sanitizePlayerName(document.getElementById("dealer4")?.value || "");
  
  // Validate that all 4 dealers are entered
  if (!dealer1 || !dealer2 || !dealer3 || !dealer4) {
    alert("Please enter all 4 dealer names to continue.");
    return;
  }
  
  const dealers = [dealer1, dealer2, dealer3, dealer4];
  if (hasDuplicateDealerNames(dealers)) {
    alert("Each dealer needs a different name.");
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

  openModal("resumeGameModal");
}
function closeResumeGameModal() {
  const errorEl = document.getElementById("resumeGameError");
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }
  closeModal("resumeGameModal");
}
function handleResumeGameSubmit(event) {
  event.preventDefault();
  const errorEl = document.getElementById("resumeGameError");
  const showError = (message) => {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove("hidden");
    } else {
      alert(message);
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
    accumulatedTime: 0,
    timerLastSavedAt: null,
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

// Ensure resume modal helpers are available to inline handlers
if (typeof window !== "undefined") {
  window.openResumeGameModal = openResumeGameModal;
  window.closeResumeGameModal = closeResumeGameModal;
  window.handleResumeGameSubmit = handleResumeGameSubmit;
}
function openSettingsModal() {
  const mustWinToggle = document.getElementById("mustWinByBidToggle");
  if (mustWinToggle) mustWinToggle.checked = !!getLocalStorage(MUST_WIN_BY_BID_KEY, false);
  const proToggleModal = document.getElementById("proModeToggleModal");
  if (proToggleModal) proToggleModal.checked = !!getLocalStorage(PRO_MODE_KEY, false);
  document.getElementById('editPresetsContainerModal')?.classList.remove('hidden'); // Always show

  // Load all settings using the common function
  loadSettings();

  openModal("settingsModal");
}
function closeSettingsModal() { 
  saveSettings(); 
  closeModal("settingsModal"); 
}
function openAboutModal() { openModal("aboutModal"); }
function closeAboutModal() { closeModal("aboutModal"); }
function openStatisticsModal() { renderStatisticsContent(); openModal("statisticsModal"); }
function closeStatisticsModal() {
  closeModal("statisticsModal");
  document.getElementById("statisticsModalContent").innerHTML = "";
  const footer = document.getElementById("statisticsModalFooter");
  if (footer) {
    footer.innerHTML = "";
    footer.classList.add("hidden");
  }
  closeEntityStatisticsModal();
}
function openViewSavedGameModal() { openModal("viewSavedGameModal"); }
function closeViewSavedGameModal() { closeModal("viewSavedGameModal"); openModal("savedGamesModal"); } // Reopen parent

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
