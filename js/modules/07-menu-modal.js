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

// The one place that opens or closes the drawer, so its classes, the dim overlay, what Tab can
// reach, and what a screen reader announces always agree (the swipe gesture uses it too).
function setMenuOpenState(isOpen) {
  const menu = document.getElementById("menu");
  if (!menu) return false;
  const icon = document.getElementById("hamburgerIcon");
  menu.classList.toggle("show", isOpen);
  if ("inert" in menu) menu.inert = !isOpen;
  if (icon) {
    icon.classList.toggle("open", isOpen);
    icon.setAttribute("aria-expanded", String(isOpen));
    icon.setAttribute("aria-label", isOpen ? "Close Menu" : "Open Menu");
  }
  document.getElementById("menuOverlay")?.classList.toggle("show", isOpen);
  document.body.classList.toggle("overflow-hidden", isOpen);
  // With the drawer open nothing behind it may take Tab; it goes back to normal when the drawer
  // closes unless a sheet or Home is covering the page anyway.
  const behindStaysInert = isOpen || document.body.classList.contains("modal-open") || isHomeScreenOpen();
  ["app", "versionBadge"].forEach(id => {
    const behind = document.getElementById(id);
    if (behind && "inert" in behind) behind.inert = behindStaysInert;
  });
  return isOpen;
}
function toggleMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById("menu");
  setMenuOpenState(!menu.classList.contains("show"));
}
function closeMenuOverlay() {
  setMenuOpenState(false);
}

// --- Modal stack: what is interactive, where focus goes back to, and stray taps ---
// A dialog's "Confirm" (or a panel's opener) is often tapped twice. The second tap must not land on
// the panel that has just opened (a switch inside it, or its backdrop) nor on the page a closed
// dialog was covering, so for a moment after a panel opens or closes real taps are held back.
const MODAL_TAP_SHIELD_MS = 320;
let lastModalClosedAt = 0;
let lastModalOpenedAt = 0;
const modalReturnFocus = new Map();

// Remember what had focus before a modal opened (call before the page behind is made inert).
// Opening a panel that is already open (focus is on the page body, or inside that panel) keeps the
// opener remembered earlier rather than forgetting it.
function rememberModalFocus(modalId) {
  const active = document.activeElement;
  const modal = document.getElementById(modalId);
  if (!active || active === document.body || active === document.documentElement) return;
  if (modal && typeof modal.contains === "function" && modal.contains(active)) return;
  modalReturnFocus.set(modalId, active);
}

// When the control that opened a panel is gone (hidden by what the panel did, or re-rendered) or sits
// under another panel, put focus on something live. Left on the page body, the next Tab would walk out of the app.
function focusAfterPanelClosed() {
  const live = Array.from(document.querySelectorAll(".modal")).filter(modal => !modal.classList.contains("hidden") && !modal.inert);
  const fallback = live[live.length - 1] || document.getElementById(isHomeScreenOpen() ? "homeNewGameBtn" : "hamburgerIcon");
  if (fallback && typeof fallback.focus === "function") fallback.focus({ preventScroll: true });
}

// Give focus back when the modal closes, so keyboard and screen-reader users are not dropped on the page.
function restoreModalFocus(modalId) {
  const target = modalReturnFocus.get(modalId);
  modalReturnFocus.delete(modalId);
  if (!target) return;
  const reachable = target.isConnected && typeof target.focus === "function"
    && !(typeof target.closest === "function" && target.closest("[inert]"));
  if (reachable) {
    target.focus({ preventScroll: true });
    if (document.activeElement === target) return;
  }
  focusAfterPanelClosed();
}

// A backwards step of the clock (it is the user's to set) must not leave a shield up for good.
function msSince(timestamp) {
  const elapsed = Date.now() - timestamp;
  return elapsed >= 0 ? elapsed : Infinity;
}

function isModalJustOpened(modal) {
  const openedAt = Number(modal?.dataset?.openedAt || 0);
  return openedAt > 0 && msSince(openedAt) < MODAL_TAP_SHIELD_MS;
}

// A sheet that slides away only hides 240ms after the tap that closed it, but the tap shield belongs to
// that tap: counted from the end of the slide it swallowed real taps for most of another half second.
function backdateModalCloseShield(requestedAt) {
  if (Number.isFinite(requestedAt) && requestedAt < lastModalClosedAt) lastModalClosedAt = requestedAt;
}

// With two panels open (a profile over Statistics, a confirmation over the Library) only the top one
// may be reached by Tab or a screen reader.
function syncModalStackInertness() {
  const open = Array.from(document.querySelectorAll(".modal")).filter(modal => !modal.classList.contains("hidden"));
  if (!open.length) return;
  const layer = el => (typeof getComputedStyle === "function" ? Number(getComputedStyle(el).zIndex) || 0 : 0);
  // Equal z-index: the later one in the page is painted on top.
  const top = open.reduce((best, el) => (layer(el) >= layer(best) ? el : best), open[0]);
  open.forEach(modal => { if ("inert" in modal) modal.inert = modal !== top; });
}

// A tap that arrives right after a panel opened or closed belongs to that panel's own gesture, not to
// what happens to be under the finger now: the page or sheet a dialog uncovered, or a switch inside
// the sheet that just slid in. Nobody means a second action within a third of a second.
function swallowLeakedModalTap(event) {
  if (!event.isTrusted) return;
  if (msSince(Math.max(lastModalClosedAt, lastModalOpenedAt)) > MODAL_TAP_SHIELD_MS) return;
  const target = event.target;
  if (target && typeof target.closest === "function" && target.closest("#voiceScoreHost, #onboarding")) return;
  event.stopPropagation();
  event.preventDefault();
}
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("click", swallowLeakedModalTap, true);
}

function activateModalEnvironment() {
  lastModalOpenedAt = Date.now();
  document.body.classList.add("modal-open");
  const app = document.getElementById("app");
  app?.classList.add("modal-active");
  // Keep the blurred page out of the tab and screen-reader order while a sheet is open.
  if (app && "inert" in app) app.inert = true;
  const home = document.getElementById("homeScreen");
  if (home && "inert" in home) home.inert = true;
  // The menu button and version badge sit outside #app; their buttons would still take Tab
  // (the badge is invisible, yet Enter on it opened Version Info over the open sheet).
  ["hamburgerIcon", "versionBadge", "menu"].forEach(id => {
    const chrome = document.getElementById(id);
    if (chrome && "inert" in chrome) chrome.inert = true;
  });
  // Panels built on the fly (confirmations of table talk, rematch, probability) have no openModal call.
  document.querySelectorAll(".modal").forEach(modal => {
    if (!modal.classList.contains("hidden") && modal.dataset && !modal.dataset.openedAt) modal.dataset.openedAt = String(Date.now());
  });
  syncModalStackInertness();
}

function deactivateModalEnvironment() {
  lastModalClosedAt = Date.now();
  const anyOpenModal = Array.from(document.querySelectorAll(".modal"))
    .some(modal => !modal.classList.contains("hidden"));
  if (!anyOpenModal) {
    document.body.classList.remove("modal-open");
    const app = document.getElementById("app");
    app?.classList.remove("modal-active");
    // Home, when showing, stays the only interactive screen; the scoreboard behind it stays inert.
    // So does the page behind a drawer that is still open (the mic can open a panel over it).
    const homeOpen = isHomeScreenOpen();
    const menu = document.getElementById("menu");
    const drawerOpen = Boolean(menu?.classList.contains("show"));
    if (app && "inert" in app) app.inert = homeOpen || drawerOpen;
    const home = document.getElementById("homeScreen");
    if (home && "inert" in home) home.inert = !homeOpen || document.body.classList.contains("onboarding-open");
    const hamburger = document.getElementById("hamburgerIcon");
    if (hamburger && "inert" in hamburger) hamburger.inert = homeOpen;
    const badge = document.getElementById("versionBadge");
    if (badge && "inert" in badge) badge.inert = homeOpen || drawerOpen;
    if (menu && "inert" in menu) menu.inert = !drawerOpen;
  } else {
    syncModalStackInertness(); // The panel underneath becomes the live one again
  }
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  rememberModalFocus(modalId);
  modal?.classList.remove("hidden");
  if (modal?.dataset) modal.dataset.openedAt = String(Date.now());
  activateModalEnvironment();
  modal?.focus(); // For accessibility
}
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  modal?.classList.add("hidden");
  if (modal && "inert" in modal) modal.inert = false;
  deactivateModalEnvironment();
  restoreModalFocus(modalId);
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
  const requestedAt = Date.now();
  modal.classList.add("is-closing");
  modal.sheetCloseTimer = setTimeout(() => {
    cancelSheetClose(modalId);
    closeModal(modalId);
    backdateModalCloseShield(requestedAt);
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
  // Open first: the list's scroll position can only be reset while the sheet is displayed.
  openModal("savedGamesModal");
  updateGamesCount();
  switchGamesTab('completed'); // Default to completed games
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
// Dismissing the question (Cancel, Escape, a tap beside it) abandons whatever asked it, like the team prompt does.
function cancelDealerPairSelection() {
  pendingGameAction = null;
  closeDealerPairSelectionModal();
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

  const startPaperGame = () => {
  // Taken only now: cancelling the confirmation below must leave a scanned history available.
  const importedRounds = typeof takePaperGameImportedRounds === "function"
    ? takePaperGameImportedRounds(usScore, demScore, {
      usTeamName: deriveTeamDisplay(usPlayers) || "Us",
      demTeamName: deriveTeamDisplay(demPlayers) || "Dem",
    })
    : null;
  const startingTotals = importedRounds
    ? sanitizeTotals({ us: 0, dem: 0 })
    : sanitizeTotals({ us: usScore, dem: demScore });
  const updates = {
    rounds: importedRounds || [],
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
  closeHomeScreen();
  saveCurrentGameState();
  };

  // Starting from paper scores begins a fresh game: whatever hands are on the scoreboard go with it.
  const handsOnScoreboard = Array.isArray(state.rounds) ? state.rounds.length : 0;
  if (handsOnScoreboard > 0) {
    openConfirmationModal(
      `This replaces the game on the scoreboard, including its ${handsOnScoreboard} ${handsOnScoreboard === 1 ? "hand" : "hands"} of history. Freeze or save it first to keep it.`,
      () => { closeConfirmationModal(); startPaperGame(); },
      closeConfirmationModal,
      { title: "Replace the current game?", confirmLabel: "Replace game", tone: "warning", icon: "refresh" }
    );
    return;
  }
  startPaperGame();
}

function openSettingsModal() {
  const mustWinToggle = document.getElementById("mustWinByBidToggle");
  if (mustWinToggle) mustWinToggle.checked = !!getLocalStorage(MUST_WIN_BY_BID_KEY, false);
  const proToggleModal = document.getElementById("proModeToggleModal");
  if (proToggleModal) proToggleModal.checked = !!getLocalStorage(PRO_MODE_KEY, false);

  // Load all settings using the common function
  loadSettings();
  renderGameDataControls();
  setGameDataTransferStatus(""); // The last export/import result belongs to that visit, not this one

  openSheetModal("settingsModal", closeSettingsModal);
}
function closeSettingsModal() {
  saveSettings();
  closeSheetModal("settingsModal");
}
function openAboutModal() { openSheetModal("aboutModal", closeAboutModal); }
function closeAboutModal() { closeSheetModal("aboutModal"); }
// --- Statistics ---
// The screens ship as their own script and stylesheet (precached by the service
// worker) so launch never pays for them. Styles are best-effort: the screens
// still read, just plainly, if the stylesheet fails.
let statisticsScriptPromise = null;
let statisticsStylesPromise = null;
let statisticsSkeletonHtml = "";

function loadStatisticsScript() {
  if (typeof renderStatisticsApp === "function") return Promise.resolve();
  if (statisticsScriptPromise) return statisticsScriptPromise;
  statisticsScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("js/stats.bundle.js", document.baseURI).href;
    script.async = true;
    const fail = () => {
      statisticsScriptPromise = null;
      script.remove();
      reject(new Error("Statistics could not load."));
    };
    script.addEventListener("error", fail, { once: true });
    script.addEventListener("load", () => {
      if (typeof renderStatisticsApp === "function") resolve();
      else fail();
    }, { once: true });
    document.head.appendChild(script);
  });
  return statisticsScriptPromise;
}

function loadStatisticsStyles() {
  if (statisticsStylesPromise) return statisticsStylesPromise;
  statisticsStylesPromise = new Promise(resolve => {
    try {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = new URL("css/stats.css", document.baseURI).href;
      link.addEventListener("load", resolve, { once: true });
      link.addEventListener("error", () => {
        statisticsStylesPromise = null;
        link.remove();
        resolve();
      }, { once: true });
      document.head.appendChild(link);
    } catch {
      resolve(); // best-effort: the screens still read without it
    }
  });
  return statisticsStylesPromise;
}

function loadStatistics() {
  return Promise.all([loadStatisticsScript(), loadStatisticsStyles()]);
}

// `controls` ({ view, metric, sort, entityMode, entityKey }) lets voice commands
// land on a specific screen; it resolves once the screens are drawn.
async function openStatisticsModal(controls) {
  cancelSheetClose("statisticsModal");
  // Open first: a hidden sheet cannot restore its scroll position.
  openSheetModal("statisticsModal", closeStatisticsModal);
  if (typeof renderStatisticsApp === "function") {
    loadStatisticsStyles(); // already in: a no-op; one that failed earlier gets another try
    renderStatisticsApp(controls);
    return true;
  }
  // A retry after a failed load starts from the loading placeholder again, not the old error.
  const waiting = document.getElementById("statisticsModalContent");
  if (waiting) {
    if (waiting.hasAttribute("aria-busy")) statisticsSkeletonHtml = statisticsSkeletonHtml || waiting.innerHTML;
    else if (statisticsSkeletonHtml) {
      waiting.innerHTML = statisticsSkeletonHtml;
      waiting.setAttribute("aria-busy", "true");
    }
  }
  try {
    await loadStatistics();
  } catch {
    const content = document.getElementById("statisticsModalContent");
    if (content) {
      content.removeAttribute("aria-busy");
      content.innerHTML = `<div class="stats-empty"><h3 class="stats-empty__title">Statistics didn't load</h3><p class="stats-empty__body">Check your connection and try again.</p><button type="button" class="st-retry" onclick="openStatisticsModal()">Try again</button></div>`;
    }
    return false;
  }
  // The sheet may have been dismissed while the screens were on their way.
  if (document.getElementById("statisticsModal")?.classList.contains("hidden")) return false;
  renderStatisticsApp(controls);
  return true;
}
function closeStatisticsModal() {
  closeEntityStatisticsModal();
  closeSheetModal("statisticsModal");
}
async function openEntityStatisticsModal(mode, entityKey) {
  try {
    await loadStatistics();
  } catch {
    return false;
  }
  return showStatisticsProfile(mode, entityKey);
}
function closeEntityStatisticsModal() {
  if (typeof statsResetProfile === "function") statsResetProfile();
  closeSheetModal("entityStatisticsModal");
}
function openViewSavedGameModal({ returnToLibrary = true } = {}) {
  cancelSheetClose("viewSavedGameModal");
  const modal = document.getElementById("viewSavedGameModal");
  if (modal) modal.dataset.returnToLibrary = String(returnToLibrary);
  openModal("viewSavedGameModal");
  ensureStatsSheetGesture("viewSavedGameModal", closeViewSavedGameModal);
}
function closeViewSavedGameModal() {
  const libraryModal = document.getElementById("savedGamesModal");
  const returnToLibrary = document.getElementById("viewSavedGameModal")?.dataset.returnToLibrary !== "false";
  if (returnToLibrary && libraryModal?.classList.contains("hidden")) openModal("savedGamesModal"); // Reopen parent
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
