"use strict";

// --- Initialization ---
document.addEventListener("DOMContentLoaded", () => {
  performTeamPlayerMigration();
  document.body.classList.remove('modal-open');
  document.getElementById('app')?.classList.remove('modal-active');
  document.querySelectorAll('.modal').forEach(modal => modal.classList.add('hidden'));
  enforceDarkMode();
  initializeTheme(); // Predefined themes
  initializeCustomThemeColors(); // Custom primary/accent
  loadCurrentGameState(); // Load after theme
  loadSettings(); // Load settings after game state
  scheduleProbabilityPersonalizationRefresh(getLocalStorage("savedGames", []));
  loadRuntimeModel().then(() => {
    scheduleProbabilityPersonalizationRefresh(getLocalStorage("savedGames", []), { force: true });
    scheduleRender();
  });

  // Pro mode toggle (in settings modal, not main nav)
  const proModeToggleModal = document.getElementById("proModeToggleModal");
  if (proModeToggleModal) {
      proModeToggleModal.checked = getLocalStorage(PRO_MODE_KEY, false);
      proModeToggleModal.addEventListener("change", (e) => toggleProMode(e.target));
  }
  updateProModeUI(getLocalStorage(PRO_MODE_KEY, false)); // Initial UI update

  document.getElementById("closeViewSavedGameModalBtn")?.addEventListener("click", (e) => { e.stopPropagation(); closeViewSavedGameModal(); });
  document.getElementById("closeSavedGamesModalBtn")?.addEventListener("click", (e) => { e.stopPropagation(); closeSavedGamesModal(); });
  document.getElementById("teamSelectionForm")?.addEventListener("submit", handleTeamSelectionSubmit);
  document.getElementById("dealerOrderForm")?.addEventListener("submit", handleDealerOrderSubmit);
  const resumePaperGameButton = document.getElementById("resumePaperGameButton");
  if (resumePaperGameButton) {
    resumePaperGameButton.addEventListener("click", (event) => {
      event.preventDefault();
      openResumeGameModal();
      toggleMenu(event);
    });
  }

  // Close modals on outside click (simplified)
  const modalCloseHandlers = {
    savedGamesModal: closeSavedGamesModal,
    viewSavedGameModal: closeViewSavedGameModal,
    aboutModal: closeAboutModal,
    versionInfoModal: closeVersionInfoModal,
    statisticsModal: closeStatisticsModal,
    entityStatisticsModal: closeEntityStatisticsModal,
    teamSelectionModal: closeTeamSelectionModal,
    resumeGameModal: closeResumeGameModal,
	    settingsModal: closeSettingsModal,
	    themeModal: () => closeThemeModal(null),
	    confirmationModal: closeConfirmationModal,
	    presetEditorModal: closePresetEditorModal,
	    tableTalkModal: closeTableTalkModal,
	    probabilityModal: closeProbabilityModal,
	    dealerOrderModal: closeDealerOrderModal,
	  };

  document.addEventListener("click", (e) => {
    Object.entries(modalCloseHandlers).forEach(([id, handler]) => {
      const modalEl = document.getElementById(id);
      if (modalEl && !modalEl.classList.contains("hidden") && e.target === modalEl) {
        handler();
      }
    });
  });
});

if ('serviceWorker' in navigator) {
  let refreshing = false;
  const reloadOnControllerChange = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !reloadOnControllerChange) return;
    refreshing = true;
    window.location.reload();
  });

  const activateUpdatedWorker = (worker) => {
    if (!worker || !navigator.serviceWorker.controller) return;

    if (worker.state === 'installed') {
      worker.postMessage({ type: 'SKIP_WAITING' });
      return;
    }

    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') {
        worker.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  };

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./service-worker.js', { updateViaCache: 'none' })
      .then(registration => {
        activateUpdatedWorker(registration.waiting);
        registration.addEventListener('updatefound', () => {
          activateUpdatedWorker(registration.installing);
        });
        registration.update().catch(error => console.error('Service Worker update check failed:', error));
      })
      .catch(error => console.error('Service Worker registration failed:', error));
  });
}

function undoPenaltyFlag() {
  updateState({ pendingPenalty: null });
  showSaveIndicator("Penalty removed");
}

function handleTeamSelectionCancel() {
  if (state.gameOver) {
    openConfirmationModal(
      'The game is completed. Canceling will erase this game. Are you sure?',
      () => { closeTeamSelectionModal(); resetGame(); closeConfirmationModal(); },
      closeConfirmationModal
    );
  } else {
    closeTeamSelectionModal();
  }
}

// Swipe-and-drag gesture for menu open/close
(function() {
    const menu = document.getElementById("menu");
    const overlay = document.getElementById("menuOverlay");
    const icon = document.getElementById("hamburgerIcon");
    let startX = 0;
    let currentX = 0;
    let isDragging = false;
    let isOpening = false;
    const menuWidth = menu.offsetWidth;

    function onTouchStart(e) {
        startX = e.touches[0].clientX;
        currentX = startX;
        const menuOpen = menu.classList.contains("show");
        if (!menuOpen && startX <= 20) {
            isDragging = true;
            isOpening = true;
            menu.style.transition = "none";
            overlay.classList.add("show");
            overlay.style.opacity = "0";
            document.body.classList.add("overflow-hidden");
        } else if (menuOpen) {
            isDragging = true;
            isOpening = false;
            menu.style.transition = "none";
            overlay.classList.add("show");
        }
    }

    function onTouchMove(e) {
        if (!isDragging) return;
        currentX = e.touches[0].clientX;
        let deltaX = currentX - startX;
        if (isOpening) {
            const left = Math.min(0, -menuWidth + currentX);
            menu.style.left = left + "px";
            overlay.style.opacity = (menuWidth + left) / menuWidth;
        } else {
            const left = Math.min(0, deltaX);
            menu.style.left = left + "px";
            overlay.style.opacity = (menuWidth + left) / menuWidth;
        }
    }

    function onTouchEnd() {
        if (!isDragging) return;
        isDragging = false;
        const deltaX = currentX - startX;
        const threshold = menuWidth / 3;
        let shouldOpen;
        if (isOpening) {
            shouldOpen = deltaX > threshold;
        } else {
            shouldOpen = deltaX > -threshold;
        }
        menu.style.transition = "";
        if (shouldOpen) {
            menu.classList.add("show");
            icon.classList.add("open");
            overlay.classList.add("show");
            document.body.classList.add("overflow-hidden");
        } else {
            menu.classList.remove("show");
            icon.classList.remove("open");
            overlay.classList.remove("show");
            document.body.classList.remove("overflow-hidden");
        }
        menu.style.left = "";
        overlay.style.opacity = "";
    }

    document.addEventListener("touchstart", onTouchStart, { passive: false });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
})();

// Expose integration hooks used by firebase-init.js, which runs as an ES module.
if (typeof window !== 'undefined') {
  Object.assign(window, {
    DEFAULT_STATE,
    getLocalStorage,
    loadCurrentGameState,
    renderApp,
    initializeTheme,
    initializeCustomThemeColors,
    loadSettings,
    updateProModeUI,
  });
}

// Expose selected helpers when running in a Node/CommonJS environment (e.g. tests)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sanitizePlayerName,
    escapeHtml,
    escapeHtmlValue,
    escapeAttribute,
    setLocalStorage,
    getLocalStorage,
    shouldAttemptJsonParse,
    ensurePlayersArray,
    canonicalizePlayers,
    formatTeamDisplay,
    buildTeamKey,
    parseLegacyTeamName,
    deriveTeamDisplay,
    getGameTeamDisplay,
    formatGameLocationParts,
    getStoredLocationDisplay,
    getGameLocationDisplay,
    captureGameLocation,
    normalizeTeamsStorage,
    applyTeamResultDelta,
    getRematchDealerCandidates,
    buildDealerOrderStartingWith,
    buildRematchSetupState,
    playersEqual,
    renderReadOnlyGameDetails,
    buildSavedGameCard,
    buildFreezerGameCard,
    bucketScore,
    getBucketRange,
    buildProbabilityIndex,
    MODEL_FEATURE_SET,
    FALLBACK_RUNTIME_MODEL,
    PROBABILITY_PERSONALIZATION_KEY,
    getActiveRuntimeModel,
    normalizeRuntimeModelArtifact,
    loadRuntimeModel,
    buildModelFeatureVector,
    extractModelFeaturesFromRoundContext,
    computeRawModelProbabilityFromFeatures,
    predictBaseModelProbabilityFromFeatures,
    applyPlattCalibration,
    fitPersonalizationCalibration,
    ensureProbabilityPersonalizationForGames,
    refreshProbabilityPersonalizationFromSavedGames,
    scheduleProbabilityPersonalizationRefresh,
    getProbabilityContext,
    getModelProbabilitySnapshotForState,
    buildWinProbabilityCacheKey,
    getWinProbability,
    calculateWinProbabilityComplex,
    calculateWinProbability,
    validateBid,
    validatePoints,
    calculateSafeTimeAccumulation,
    formatDuration,
    recalcRunningTotals,
    computeGameOutcomeFromRounds,
    getOrderedPlayerSuggestions,
    getFilteredPlayerSuggestions,
  };
}
