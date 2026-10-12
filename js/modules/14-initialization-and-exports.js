"use strict";

// --- Initialization ---
const ROOK_APP_INTERACTION_EVENTS = ["pointerdown", "keydown", "input", "change", "submit"];
let rookAppInteractionRevision = 0;

function recordRookAppInteraction() {
  rookAppInteractionRevision += 1;
  return rookAppInteractionRevision;
}

function getRookAppInteractionRevision() {
  return rookAppInteractionRevision;
}

function shouldReloadForServiceWorkerUpdate(
  hasExistingController,
  interactionRevisionAtStartup,
  currentInteractionRevision,
) {
  return Boolean(hasExistingController)
    && currentInteractionRevision === interactionRevisionAtStartup;
}

ROOK_APP_INTERACTION_EVENTS.forEach(eventName => {
  document.addEventListener(eventName, recordRookAppInteraction, {
    capture: true,
    passive: eventName === "pointerdown",
  });
});

let rookAppInitialized = false;
let rookAppWaitingForStyles = false;
let rookAppStyleChecks = 0;
const ROOK_APP_STYLE_CHECK_LIMIT = 100; // of 16ms each: a sheet that never applies must not keep the app from starting
let firebaseClientLoadPromise = null;
let firebaseClientLoadRetries = 0;

function loadFirebaseClient() {
  if (typeof window.startFirebaseInitialization === "function") return Promise.resolve();
  if (!firebaseClientLoadPromise) {
    const url = new URL("js/firebase-init.js", document.baseURI);
    if (firebaseClientLoadRetries) url.searchParams.set("retry", String(firebaseClientLoadRetries));
    firebaseClientLoadPromise = import(url.href).catch(error => {
      firebaseClientLoadPromise = null;
      firebaseClientLoadRetries += 1;
      throw error;
    });
  }
  return firebaseClientLoadPromise;
}

// Home, the menu, and voice can request authentication before the async client
// has arrived. Keep the request and return the real handler's result to callers.
function createDeferredFirebaseAuthAction(action) {
  const deferredAction = async (...args) => {
    try {
      await loadFirebaseClient();
      const handler = window[action];
      if (typeof handler !== "function" || handler === deferredAction) return null;
      return await handler(...args);
    } catch (error) {
      console.warn("Unable to load cloud sign-in. Try again when connected.", error);
      return null;
    }
  };
  return deferredAction;
}

if (typeof window.signInWithGoogle !== "function") {
  window.signInWithGoogle = createDeferredFirebaseAuthAction("signInWithGoogle");
}
if (typeof window.signOutUser !== "function") {
  window.signOutUser = createDeferredFirebaseAuthAction("signOutUser");
}

// True once the full stylesheet is actually in effect (app.css sets --rook-styles on <html>). A load
// event is not enough: after the media flip in index.html the browser applies the sheet a few frames
// later, and anything revealed in between flashes unstyled, then transitions into its styles.
function appStylesInEffect() {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue("--rook-styles").trim() === "1";
  } catch {
    return true;
  }
}

function initializeRookApp() {
  if (rookAppInitialized) return;
  const styles = document.getElementById("appStyles");
  if (styles?.tagName === "LINK" && !styles.dataset.loaded) {
    if (!rookAppWaitingForStyles) {
      rookAppWaitingForStyles = true;
      styles.addEventListener("load", initializeRookApp, { once: true });
      styles.addEventListener("error", initializeRookApp, { once: true });
    }
    return;
  }
  if (styles?.tagName === "LINK" && styles.dataset.loaded === "true"
      && !appStylesInEffect() && rookAppStyleChecks++ < ROOK_APP_STYLE_CHECK_LIMIT) {
    setTimeout(initializeRookApp, 16); // not requestAnimationFrame: a background tab never gets frames
    return;
  }
  rookAppInitialized = true;
  performTeamPlayerMigration();
  document.body.classList.remove('modal-open');
  document.getElementById('app')?.classList.remove('modal-active');
  document.querySelectorAll('.modal').forEach(modal => modal.classList.add('hidden'));
  enforceDarkMode();
  initializeTheme(); // Predefined themes
  initializeCustomThemeColors(); // Custom primary/accent
  document.getElementById("rookBootColors")?.remove(); // The boot script's first-frame copy
  loadCurrentGameState(); // Load after theme
  initializeCurrentGameTimer();
  loadSettings(); // Load settings after game state
  scheduleProbabilityPersonalizationRefresh(getLocalStorage("savedGames", []));
  loadRuntimeModel().then((model) => {
    // The fetched model usually matches the bundled one; only re-render when it differs.
    if (!RUNTIME_MODEL_STATE.lastLoadChanged) return;
    scheduleProbabilityPersonalizationRefresh(getLocalStorage("savedGames", []), { force: true });
    scheduleRender();
  });
  initializeVoiceScoreModuleWhenEnabled();

  const experimentalFeaturesToggle = document.getElementById("experimentalFeaturesToggle");
  if (experimentalFeaturesToggle) {
    experimentalFeaturesToggle.checked = isExperimentalFeaturesEnabled();
    experimentalFeaturesToggle.addEventListener("change", event => toggleExperimentalFeatures(event.target));
  }
  const voiceImprovementOptInToggle = document.getElementById("voiceImprovementOptInToggle");
  if (voiceImprovementOptInToggle) {
    voiceImprovementOptInToggle.checked = isVoiceImprovementOptedIn();
    voiceImprovementOptInToggle.addEventListener("change", event => toggleVoiceImprovementConsent(event.target));
  }
  initializeHomeScreen();
  maybePromptForVoiceExperimentalOnboarding();

  // These two used to be saved only when Settings was closed, so a toggle followed by a closed app lost it.
  [["mustWinByBidToggle", MUST_WIN_BY_BID_KEY], ["misdealHandlingToggle", MISDEAL_HANDLING_KEY]].forEach(([id, key]) => {
    document.getElementById(id)?.addEventListener("change", event => {
      setLocalStorage(key, event.target.checked);
      scheduleRender();
    });
  });

  // Pro mode toggle (in settings modal, not main nav)
  const proModeToggleModal = document.getElementById("proModeToggleModal");
  if (proModeToggleModal) {
      proModeToggleModal.checked = getLocalStorage(PRO_MODE_KEY, false);
      proModeToggleModal.addEventListener("change", (e) => toggleProMode(e.target));
  }
  updateProModeUI(getLocalStorage(PRO_MODE_KEY, false)); // Initial UI update
  window.addEventListener("resize", scheduleViewportCompatibilitySync);
  window.addEventListener("orientationchange", scheduleViewportCompatibilitySync);
  if (window.visualViewport && typeof window.visualViewport.addEventListener === "function") {
    window.visualViewport.addEventListener("resize", scheduleViewportCompatibilitySync);
  }

  document.getElementById("hamburgerIcon")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleMenu(event);
  });
  document.getElementById("closeViewSavedGameModalBtn")?.addEventListener("click", (e) => { e.stopPropagation(); closeViewSavedGameModal(); });
  document.getElementById("closeSavedGamesModalBtn")?.addEventListener("click", (e) => { e.stopPropagation(); closeSavedGamesModal(); });
  document.getElementById("teamSelectionForm")?.addEventListener("submit", handleTeamSelectionSubmit);
  document.getElementById("dealerOrderForm")?.addEventListener("submit", handleDealerOrderSubmit);
  document.getElementById("deleteGameDataForm")?.addEventListener("submit", handleDeleteGameDataSubmit);
  document.getElementById("deleteGameDataConfirmInput")?.addEventListener("input", syncDeleteGameDataConfirmButton);
  pruneExpiredGameDataRecovery();
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
    bugReportModal: closeBugReportModal,
    versionInfoModal: closeVersionInfoModal,
    statisticsModal: closeStatisticsModal,
    entityStatisticsModal: closeEntityStatisticsModal,
    teamSelectionModal: closeTeamSelectionModal,
    resumeGameModal: closeResumeGameModal,
	    settingsModal: closeSettingsModal,
	    themeModal: () => closeThemeModal(null),
	    confirmationModal: dismissConfirmationModal,
	    noticeModal: closeNoticeModal,
	    presetEditorModal: closePresetEditorModal,
	    tableTalkModal: closeTableTalkModal,
	    probabilityModal: closeProbabilityModal,
	    dealerOrderModal: closeDealerOrderModal,
	    dealerPairSelectionModal: cancelDealerPairSelection,
	    zeroPointsModal: () => closeModal("zeroPointsModal"),
	    rematchDealerModal: () => closeRematchDealerModal(true),
	    voiceExperimentalOnboardingModal: cancelVoiceExperimentalOnboarding,
	    deleteGameDataModal: closeDeleteGameDataModal,
	  };

  // Where the press began: selecting text in a field and letting go over the backdrop ends in a
  // click on the backdrop, which must not close the sheet and throw the typed text away.
  let pressStartedOn = null;
  document.addEventListener("pointerdown", (e) => { pressStartedOn = e.target; }, true);
  document.addEventListener("click", (e) => {
    Object.entries(modalCloseHandlers).forEach(([id, handler]) => {
      const modalEl = document.getElementById(id);
      if (modalEl && !modalEl.classList.contains("hidden") && e.target === modalEl) {
        if (pressStartedOn && pressStartedOn !== modalEl) return;
        // The second tap of a double tap on whatever opened the panel lands on its backdrop.
        if (isModalJustOpened(modalEl)) return;
        handler();
      }
    });
  });

  // Escape dismisses the top-most dialog: notices sit above confirmations, and
  // otherwise the highest-stacked open sheet with a close handler goes first.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const isOpen = id => document.getElementById(id)?.classList.contains("hidden") === false;
    let dialogId = ["noticeModal", "confirmationModal"].find(isOpen);
    if (!dialogId) {
      const stackOrder = el => Number(getComputedStyle(el).zIndex) || 0;
      dialogId = Object.keys(modalCloseHandlers)
        .filter(isOpen)
        .sort((a, b) => stackOrder(document.getElementById(a)) - stackOrder(document.getElementById(b)))
        .pop();
    }
    if (!dialogId) {
      // No panel is open: Escape closes the menu, then puts away the scoring keypad.
      if (document.getElementById("menu")?.classList.contains("show")) {
        e.preventDefault();
        setMenuOpenState(false);
        document.getElementById("hamburgerIcon")?.focus?.({ preventScroll: true });
      } else if (activeScoreKeypadTarget) {
        e.preventDefault();
        closeScoreKeypad();
      }
      return;
    }
    e.preventDefault();
    modalCloseHandlers[dialogId]();
  });
  document.documentElement.classList.remove("app-boot");
}

// A defer script already has the full DOM. Analytics and cloud downloads must
// not delay local play; retain the event path for non-deferred/test loaders.
if (document.readyState === "interactive" || document.readyState === "complete") {
  initializeRookApp();
} else {
  document.addEventListener("DOMContentLoaded", initializeRookApp, { once: true });
}

if ('serviceWorker' in navigator) {
  let refreshing = false;
  let updateActivated = false;
  const reloadOnControllerChange = Boolean(navigator.serviceWorker.controller);
  const interactionRevisionAtStartup = getRookAppInteractionRevision();
  const canReloadForUpdate = () => shouldReloadForServiceWorkerUpdate(
    reloadOnControllerChange,
    interactionRevisionAtStartup,
    getRookAppInteractionRevision(),
  );

  // Swapping pages while the app is on screen reads as a blink after launch,
  // so an update loads the next time the app goes to the background.
  const reloadForUpdateWhileHidden = () => {
    if (refreshing || !updateActivated || document.visibilityState !== 'hidden' || !canReloadForUpdate()) return;
    refreshing = true;
    window.location.reload();
  };
  document.addEventListener('visibilitychange', reloadForUpdateWhileHidden);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    if (!canReloadForUpdate()) {
      if (reloadOnControllerChange) {
        console.info("App update activated; reload deferred until the next launch because the app is in use.");
      }
      return;
    }
    updateActivated = true;
    reloadForUpdateWhileHidden();
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
}

function handleTeamSelectionCancel() {
  if (state.gameOver) {
    openConfirmationModal(
      'This game is finished. Canceling now erases it instead of saving it.',
      () => { closeTeamSelectionModal(); resetGame(); closeConfirmationModal(); },
      closeConfirmationModal,
      { title: "Erase this game?", confirmLabel: "Erase game", cancelLabel: "Keep game", tone: "danger" }
    );
  } else {
    pendingGameAction = null;
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
    // Measured when a drag starts: at script load the stylesheet has not applied yet and the
    // unstyled drawer is as wide as the screen, which made the drag lag the finger and the
    // open/close threshold far too long.
    let menuWidth = 280;

    function onTouchStart(e) {
        menuWidth = menu.offsetWidth || 280;
        startX = e.touches[0].clientX;
        currentX = startX;
        const menuOpen = menu.classList.contains("show");
        // A sheet or dialog owns the screen while it is open; edge swipes must not slide the menu under it.
        // Home and first-run onboarding cover the scoreboard, and the menu would open hidden beneath them.
        const modalOpen = document.body.classList.contains("modal-open") || Boolean(document.querySelector(".modal:not(.hidden)"))
            || isHomeScreenOpen() || document.body.classList.contains("onboarding-open");
        if (!menuOpen && startX <= 20 && !modalOpen) {
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
        // The drawer is positioned with a transform so dragging (and the CSS
        // slide) stays on the compositor instead of relayouting the page.
        if (isOpening) {
            const left = Math.min(0, -menuWidth + currentX);
            menu.style.transform = `translateX(${left}px)`;
            overlay.style.opacity = (menuWidth + left) / menuWidth;
        } else {
            const left = Math.min(0, deltaX);
            menu.style.transform = `translateX(${left}px)`;
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
        setMenuOpenState(shouldOpen);
        menu.style.transform = "";
        overlay.style.opacity = "";
    }

    // These handlers never cancel native scrolling, so keep them off the
    // browser's scroll-blocking path while retaining the horizontal menu drag.
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    // The system can cancel a touch (incoming call, gesture handoff); settle the drag instead of leaving it armed.
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
})();

// Expose integration hooks used by firebase-init.js, which runs as an ES module.
if (typeof window !== 'undefined') {
  const loadedVoiceScoreRuntime = getVoiceScoreRuntime();
  Object.assign(window, {
    DEFAULT_STATE,
    getLocalStorage,
    isCloudSyncStorageKey,
    captureCloudSyncStorageSnapshot,
    getCloudSyncStorageChanges,
    getRookAppInteractionRevision,
    exportGameData,
    importGameData,
    loadCurrentGameState,
    renderApp,
    showWarningToast,
    initializeTheme,
    initializeCustomThemeColors,
    loadSettings,
    updateProModeUI,
    startVoiceScoreEntry: loadedVoiceScoreRuntime?.startVoiceScoreEntry || startLazyVoiceScoreEntry,
    stopVoiceScoreEntry: loadedVoiceScoreRuntime?.stopVoiceScoreEntry || stopLoadedVoiceScoreEntry,
    requestVoiceScoreActionPlan: loadedVoiceScoreRuntime?.requestVoiceScoreActionPlan || requestLazyVoiceScoreActionPlan,
    requestVoiceScoreMicrophonePermission: loadedVoiceScoreRuntime?.requestVoiceScoreMicrophonePermission
      || requestLazyVoiceScoreMicrophonePermission,
    openBugReportModal,
    closeBugReportModal,
    handleBugReportSubmit,
  });
}

// Expose selected helpers when running in a Node/CommonJS environment (e.g. tests)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sanitizePlayerName,
    escapeHtml,
    escapeHtmlValue,
    escapeAttribute,
    updateState,
    setLocalStorage,
    getLocalStorage,
    loadCurrentGameState,
    resetGame,
    saveCurrentGameState,
    GAME_DATA_KEYS,
    GAME_DATA_RESET_DEVICE_KEY,
    GAME_DATA_RESET_MARKERS_KEY,
    DELETED_GAME_DATA_RECOVERY_KEY,
    getGameDataSummary,
    describeGameDataSummary,
    isGameDataDeletePhrase,
    nextGameDataResetMarker,
    readGameDataRecovery,
    pruneExpiredGameDataRecovery,
    mergeGameDataEntries,
    deleteAllGameData,
    restoreDeletedGameData,
    renderGameDataControls,
    openDeleteGameDataModal,
    handleDeleteGameDataSubmit,
    syncDeleteGameDataConfirmButton,
    saveCompletedGameSnapshot,
    viewSavedGame,
    getStateForTests: () => state,
    getPendingConfirmationForTests: () => ({ confirm: confirmationCallback, cancel: noCallback }),
    sanitizeHexColor,
    ROOK_APP_STORAGE_KEYS,
    isRookAppStorageKey,
    isCloudSyncStorageKey,
    captureCloudSyncStorageSnapshot,
    getCloudSyncStorageChanges,
    recordRookAppInteraction,
    getRookAppInteractionRevision,
    shouldReloadForServiceWorkerUpdate,
    shouldAttemptJsonParse,
    getAppStorageEntries,
    buildGameDataExport,
    parseGameDataImport,
    replaceAppStorage,
    ensurePlayersArray,
    canonicalizePlayers,
    formatTeamDisplay,
    buildTeamKey,
    parseLegacyTeamName,
    deriveTeamDisplay,
    getTeamSnapshotForSide,
    getGameTeamDisplay,
    getCurrentDealer,
    normalizeTeamsStorage,
    applyTeamResultDelta,
    getRematchDealerCandidates,
    buildDealerOrderStartingWith,
    buildRematchSetupState,
    handleMisdeal,
    startRematchWithFirstDealer,
    playersEqual,
    getHistoryRoundsForDisplay,
    renderReadOnlyGameDetails,
    buildSavedGameCard,
    buildFreezerGameCard,
    findStoredGameIndex,
    getLibraryTimestamp,
    foldLibrarySearchText,
    formatLibraryAgo,
    getStatistics,
    sortStatisticsData,
    buildStatsModel,
    getStatsModel,
    clearStatisticsCache,
    statsNormalizeGames,
    statsBuildBidBuckets,
    statsBidBucketIndex,
    statsComputeRatings,
    statsRankEntities,
    statsRankOf,
    statsPeriodBounds,
    statsPreviousBounds,
    statsCanonicalMetric,
    STATS_RANK_METRICS,
    STATS_PERIODS,
    statsLimitPerEntity,
    statsGateFor,
    statsNiceScale,
    statsNiceRange,
    statsColumnPath,
    statsBarsChart,
    statsDivergingChart,
    statsLineChart,
    statsHeatmap,
    statsScatterChart,
    statsStackedBar,
    statsTrajectory,
    statsFormStrip,
    statsRenderOverview,
    statsRenderLeaders,
    statsLeaderRowsHtml,
    statsRenderBidding,
    statsRenderRecords,
    statsRenderProfile,
    statsGameRow,
    statsRankBadge,
    statsProfileBack,
    statsApplyControls,
    renderStatisticsApp,
    statsRender,
    statsRedraw,
    statsHandleClick,
    statsFocusSelector,
    statsRestoreFocus,
    getStatisticsRoster,
    getStatsUiForTests: () => statsUi,
    bucketScore,
    getBucketRange,
    generateComplexProbabilityBreakdown,
    generateProbabilityBreakdown,
    buildProbabilityTimeline,
    enhanceProbabilityExplanation,
    buildProbabilityIndex,
    MODEL_FEATURE_SET,
    LEGACY_MODEL_FEATURE_SET,
    FALLBACK_RUNTIME_MODEL,
    PROBABILITY_PERSONALIZATION_KEY,
    buildModelFeatureVector,
    extractModelFeaturesFromRoundContext,
    predictBaseModelProbabilityFromFeatures,
    normalizeRuntimeModelArtifact,
    fitOpponentAdjustedPlayerRatings,
    buildHierarchicalPlayerStrengthProfile,
    getHierarchicalPlayerPriorForState,
    fitPersonalizationCalibration,
    ensureProbabilityPersonalizationForGames,
    getModelProbabilitySnapshotForState,
    buildWinProbabilityCacheKey,
    getWinProbability,
    calculateWinProbabilityComplex,
    calculateWinProbability,
    validateBid,
    validatePoints,
    isUsableBid,
    getCustomBidProblem,
    applyInAppNumericKey,
    calculateRoundPointsOutcome,
    handleTeamClick,
    submitStructuredRound,
    submitRoundFromCurrentInputs,
    handleBidSelect,
    handleScoreKeypadInput,
    openScoreKeypad,
    getTransientScoreInputsForTests: () => ({ customBid: ephemeralCustomBid, points: ephemeralPoints, keypad: activeScoreKeypadTarget }),
    getHistoryScrollKey,
    resetRenderAnimationState,
    startHistoryEdit,
    commitHistoryEdit,
    clampDurationMs,
    isStartTimestampActive,
    calculateSafeTimeAccumulation,
    hasStartedCurrentGameTimer,
    shouldRunCurrentGameTimer,
    getCurrentGameTime,
    buildCurrentGameTimerCheckpoint,
    normalizeLoadedGameTimerState,
    buildCurrentGameTimerActivity,
    getCurrentGameSkippedTime,
    isCurrentGameTimerOnBreak,
    settleCurrentGameTimer,
    formatDuration,
    formatLiveGameDuration,
    shouldApplyStandaloneSafeAreaFallback,
    shouldEnableAppViewportScroll,
    getBugReportUrl,
    getBugReportDiagnostics,
    openBugReportModal,
    cancelBugReport,
    cancelDealerPairSelection,
    rememberModalFocus,
    restoreModalFocus,
    isModalJustOpened,
    syncModalStackInertness,
    swallowLeakedModalTap,
    deactivateModalEnvironment,
    activateModalEnvironment,
    getTeamColorTokens,
    getTeamAvatarInk,
    syncTeamColorTokens,
    resetThemeColors,
    renderApp,
    closePresetEditorModal,
    canShowProbabilityExplanation,
    describeRequestFailure,
    probabilityScore,
    patchVoiceScoreControls,
    updateExperimentalFeaturesUI,
    cancelVoiceExperimentalOnboarding,
    recalcRunningTotals,
    computeGameOutcomeFromRounds,
    startVoiceScoreEntry,
    stopVoiceScoreEntry,
    getVoiceScoreCommandUrl,
    getVoiceScoreRecordingMimeType,
    getVoiceScoreAudioConstraints,
    getVoiceScoreRecorderOptions,
    shouldPreferRecordedVoiceScoreEntry,
    requestVoiceScoreActionPlan,
    requestVoiceScoreMicrophonePermission,
    cancelVoiceScoreEntry,
    getVoiceScoreConversation,
    clearVoiceScoreConversation,
    updateVoiceScoreConversation,
    redactVoiceImprovementPrompt,
    buildVoiceImprovementSample,
    recordVoiceImprovementSample,
    isExperimentalFeaturesEnabled,
    isVoiceImprovementOptedIn,
    isVoiceExperimentalOnboardingComplete,
    toggleVoiceImprovementConsent,
    continueVoiceExperimentalOnboarding,
    renderVoiceScoreControls,
    getVoiceScoreAppContext,
    getVoiceScoreActionTypes,
    getVoiceScoreActionHandlerTypes,
    warmVoiceScoreEndpoint,
    applyVoiceScorePlan,
    speakVoiceScoreReply,
    isVoiceScoreSpeechEnabled,
    normalizeVoiceScorePlan,
    resolveVoiceScoreStatisticsSelection,
    applyVoiceScoreStatsControls,
    getPaperGamePhotoUrl,
    normalizePaperGamePhotoResult,
    requestPaperGamePhotoScan,
    buildPaperGameRoundsFromRows,
    applyPaperGamePhotoResult,
    handleResumeScoreEdited,
    handleResumeGameSubmit,
    updatePaperGamePhotoExperimentUI,
    getFilteredPlayerSuggestions,
    hasActiveGame,
    getHomeScreenGameSignature,
    isOnboardingComplete,
    hasExistingRookData,
    ONBOARDING_COMPLETED_KEY,
  };
}
