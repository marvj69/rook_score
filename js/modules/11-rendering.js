"use strict";

// --- Rendering Functions ---
// (renderApp, renderTeamCard, renderRoundCard, renderErrorAlert, renderScoreInputCard, renderPointsInput, renderHistoryCard, renderGameOverOverlay, renderReadOnlyGameDetails, renderSavedGames, renderFreezerGames, renderStatisticsContent, renderTeamStatsTable)
// These are substantial and involve generating HTML. They are defined below.
let confettiLoadPromise = null;

function loadConfettiScript() {
  if (typeof window !== "undefined" && typeof window.confetti === "function") {
    return Promise.resolve(window.confetti);
  }
  if (confettiLoadPromise) return confettiLoadPromise;
  if (typeof document === "undefined" || !document.head || typeof document.createElement !== "function") {
    return Promise.resolve(null);
  }

  confettiLoadPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "vendor/canvas-confetti.min.js";
    script.async = true;
    script.onload = () => resolve(typeof window !== "undefined" && typeof window.confetti === "function" ? window.confetti : null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return confettiLoadPromise;
}

function launchGameOverConfetti() {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  loadConfettiScript().then((confettiFn) => {
    if (typeof confettiFn === "function") {
      confettiFn({ particleCount: 200, spread: 70, origin: { y: 0.6 }, disableForReducedMotion: true });
    }
  });
}

function renderCurrentGameTimer() {
  const displayTime = formatLiveGameDuration(getCurrentGameTime(state));
  return `
    <div class="history-game-timer" aria-label="Current game time">
      <svg class="history-game-timer__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5"></circle>
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 7.5V12l3 2"></path>
      </svg>
      <span>Game time</span>
      <span id="currentGameTimerValue" class="history-game-timer__value" role="timer" aria-live="off">${displayTime}</span>
    </div>`;
}

function renderApp() {
  const { error, rounds, bidAmount, showCustomBid, biddingTeam, customBidValue, gameOver } = state;
  const scorePreview = getRoundScorePreview();
  const totals = scorePreview.totals;
  const roundNumber = rounds.length + 1;

  const shouldShowWinProbability = state.showWinProbability && !gameOver && rounds.length > 0;
  const historicalGames = shouldShowWinProbability ? getLocalStorage("savedGames") : null;
  const winProb = shouldShowWinProbability ? getWinProbability(state, historicalGames) : null;

  let lastBidDisplayHtml = "";
  // Show "Current Bid" if a bid is being selected
  if (biddingTeam && (bidAmount || (showCustomBid && customBidValue))) {
      const currentBidDisplayAmount = bidAmount || customBidValue;
      const currentBiddingTeamName = biddingTeam === "us" ? (state.usTeamName || "Us") : (state.demTeamName || "Dem");
      const currentBiddingTeamDisplay = escapeHtmlValue(currentBiddingTeamName);
      const currentBidAmountDisplay = escapeHtmlValue(currentBidDisplayAmount);
      const arrow = biddingTeam === "us" ? "←" : "→";
      const teamColor = biddingTeam === "us" ? 'var(--primary-color)' : 'var(--accent-color)';
      if (validateBid(currentBidDisplayAmount) === "") { // Only display if valid
          lastBidDisplayHtml = `<div class=\"mt-1 text-xs text-white\">Current Bid: <span class=\"font-semibold\" style=\"color: ${teamColor};\">${currentBiddingTeamDisplay}</span><br><span class=\"inline-block mt-0.5 font-bold\">${currentBidAmountDisplay} <span>${arrow}</span></span></div>`;
      }
  }
  // If not, show "Last Bid" from the last completed round
  else if (state.rounds.length > 0) {
      const lastRound = state.rounds[state.rounds.length - 1];
      const lastBidAmount = lastRound.bidAmount;
      const lastBidTeam = lastRound.biddingTeam;
      const teamName = lastBidTeam === "us" ? (state.usTeamName || "Us") : (state.demTeamName || "Dem");
      const teamDisplay = escapeHtmlValue(teamName);
      const lastBidAmountDisplay = escapeHtmlValue(lastBidAmount);
      const arrow = lastBidTeam === "us" ? "←" : "→";
      const teamColor = lastBidTeam === "us" ? 'var(--primary-color)' : 'var(--accent-color)';
      lastBidDisplayHtml = `<div class=\"mt-1 text-xs text-white\">Last Bid: <span class=\"font-semibold\" style=\"color: ${teamColor};\">${teamDisplay}</span><br><span class=\"inline-block mt-0.5 font-bold\">${lastBidAmountDisplay} <span>${arrow}</span></span></div>`;
  }


  // Calculate current dealer badge (including misdeals in the count)
  let dealerRow = "";
  if (state.dealers && state.dealers.length > 0) {
    const currentDealer = getCurrentDealer(state);
    const escapedDealer = escapeHtml(currentDealer);
    dealerRow = `<div class="mt-2 flex flex-row items-center justify-center gap-2">
      <span class="inline-block px-3 py-1 text-xs font-medium rounded-full" style="background-color: color-mix(in srgb, var(--primary-color) 20%, transparent); border: 1px solid color-mix(in srgb, var(--primary-color) 30%, transparent); color: var(--primary-color);">Dealer: ${escapedDealer}</span>
    </div>`;
  }

  // Show "Enter dealing order" button only before game starts AND if no dealers set
  let dealerEntryButton = "";
  const hasDealers = state.dealers && state.dealers.length > 0;
  if (rounds.length === 0 && !hasDealers) {
    dealerEntryButton = `<div class="mt-2"><button onclick="openDealerOrderModal()" class="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500">Enter dealing order</button></div>`;
  }

  // Show "Misdeal" button if dealers exist, setting is enabled, and game hasn't started bidding yet
  const misdealHandlingEnabled = !!getLocalStorage(MISDEAL_HANDLING_KEY, false);
  const misdealButton = (hasDealers && misdealHandlingEnabled && !biddingTeam && !gameOver)
    ? `<button onclick="handleMisdeal()" class="px-2.5 py-1 bg-yellow-500 dark:bg-yellow-600 text-white rounded-md text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-500 shadow-sm whitespace-nowrap">Misdeal</button>`
    : "";
  if (dealerRow && misdealButton) {
    dealerRow = dealerRow.replace("</div>", `${misdealButton}</div>`);
  }

  document.getElementById("app").innerHTML = `
    <div class="text-center space-y-2">
      <h1 class="font-extrabold text-5xl sm:text-6xl text-gray-800 dark:text-white" style="text-shadow: 0 4px 0 rgba(0,0,0,0.2), 0 6px 20px rgba(0,0,0,0.3);">Rook!</h1>
      <p class="text-md sm:text-lg text-gray-600 dark:text-white font-semibold">Tap a team to start a bid!</p>
      ${dealerEntryButton}
      ${dealerRow}
    </div>
    <div class="flex flex-row gap-3 flex-wrap justify-center items-stretch">
      ${renderTeamCard("us", totals.us, winProb, scorePreview.active)}
      ${renderRoundCard(roundNumber, lastBidDisplayHtml)}
      ${renderTeamCard("dem", totals.dem, winProb, scorePreview.active)}
    </div>
    ${error ? `<div>${renderErrorAlert(error)}</div>` : ""}
    ${renderScoreInputCard()}
    ${renderHistoryCard()}
    ${renderGameOverOverlay()}
    ${activeScoreKeypadTarget === "bid"
      ? renderInAppNumericKeypad("bid", "Custom bid keypad")
      : activeScoreKeypadTarget === "points"
        ? renderInAppNumericKeypad("points", "Points keypad")
        : ""}
  `;
  updateCurrentGameTimerDisplay();
  scheduleViewportCompatibilitySync();
  syncHomeScreenWithGame();
  if (gameOver && !confettiTriggered) {
    confettiTriggered = true;
    launchGameOverConfetti();
  }
}
function getRoundScorePreview() {
  const currentTotals = getCurrentTotals();
  const pointsValue = String(ephemeralPoints ?? "").trim();
  if (!pointsValue || state.gameOver || !state.biddingTeam || !state.bidAmount) {
    return { totals: currentTotals, active: false };
  }

  const outcome = calculateRoundPointsOutcome({
    biddingTeam: state.biddingTeam,
    bidAmount: state.bidAmount,
    pointsValue,
    enterBidderPoints: state.enterBidderPoints,
    currentTotals,
    pendingPenalty: state.pendingPenalty,
  });
  return outcome.error
    ? { totals: currentTotals, active: false }
    : { totals: outcome.newTotals, active: true };
}
function updateTeamScorePreview() {
  const scorePreview = getRoundScorePreview();
  ["us", "dem"].forEach((teamKey) => {
    const scoreElement = document.getElementById(`teamScore-${teamKey}`);
    const cardElement = document.getElementById(`teamCard-${teamKey}`);
    if (scoreElement) scoreElement.textContent = String(scorePreview.totals[teamKey]);
    cardElement?.classList.toggle("team-card--score-preview", scorePreview.active);
  });
}
function renderTeamCard(teamKey, score, winProb, isScorePreview = false) {
  const isSelected = state.biddingTeam === teamKey;
  const teamLabel = teamKey === "us" ? (state.usTeamName || "Us") : (state.demTeamName || "Dem");
  const teamLabelDisplay = escapeHtmlValue(teamLabel);
  const teamLabelAttr = escapeAttribute(teamLabel);
  const colorClass = teamKey === "us" ? "bg-primary" : "bg-accent";
  const selectedEffect = isSelected ? "sunken-selected" : "";
  const scorePreviewClass = isScorePreview ? " team-card--score-preview" : "";
  let winProbDisplay = "";
  if (winProb) {
    const prob = teamKey === "us" ? winProb.us : winProb.dem;
    const teamColorVar = teamKey === "us" ? "var(--primary-color)" : "var(--accent-color)";
    const brightness = isSelected ? "brightness(0.7)" : "brightness(0.85)"; // Darken more when selected
    // Inner div for probability text to ensure z-index works with sunken-selected's ::after
    winProbDisplay = `
      <div class="mt-1 text-xs rounded-full px-2 py-1 relative" style="background-color: ${teamColorVar}; filter: ${brightness};">
        <span class="relative font-medium" style="color: #FFF; z-index: 1;">Win: ${prob.toFixed(1)}%</span>
      </div>`;
  }
  const animDelay = teamKey === "us" ? "0s" : "0.1s";
  const animation = getOneShotCardPopAnimation(`team-card:${teamKey}`, { delay: animDelay });
  return `
    <button id="teamCard-${teamKey}" type="button"
    class="${colorClass} ${selectedEffect} threed text-white cursor-pointer transition-all flex flex-col items-center justify-center flex-1 min-w-[calc(33%-1rem)] sm:min-w-0 w-auto h-32 p-2${scorePreviewClass}${animation.className}"${animation.attrs}
    onclick="handleTeamClick('${teamKey}')"
    aria-pressed="${isSelected}" aria-label="Select ${teamLabelAttr}">
    <div class="text-center">
<h2 class="text-base sm:text-xl font-bold truncate max-w-[100px] sm:max-w-[120px]" style="text-shadow: 0 2px 0 rgba(0,0,0,0.25);">${teamLabelDisplay}</h2>
<p id="teamScore-${teamKey}" class="team-score-value text-2xl font-extrabold" style="text-shadow: 0 2px 0 rgba(0,0,0,0.2);" aria-live="polite" aria-atomic="true">${score}</p>
${winProbDisplay}
    </div>
  </button>`;
}
function renderRoundCard(roundNumber, lastBidDisplayHtml) {
  const animation = getOneShotCardPopAnimation(`round-card:${roundNumber}`, { delay: "0.05s" });
  return `
    <div class="bg-white dark:bg-gray-800 rounded-xl border-2 border-gray-200 dark:border-gray-600 shadow-md threed flex flex-col items-center justify-center p-3 flex-1 min-w-[calc(33%-1rem)] sm:min-w-0 w-auto h-32${animation.className}"${animation.attrs}>
      <div class="text-center space-y-1">
        <h2 class="text-lg font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Round</h2>
        <p class="text-3xl font-black text-gray-900 dark:text-white" style="text-shadow: 0 3px 0 rgba(0,0,0,0.15);">${roundNumber}</p>
        ${lastBidDisplayHtml}
      </div>
    </div>`;
}
function renderErrorAlert(errorMessage) {
  return `<div role="alert" class="flex items-center border border-red-400 rounded-xl p-4 bg-red-50 text-red-700 space-x-3 dark:bg-red-900/50 dark:border-red-600 dark:text-red-300">${Icons.AlertCircle}<div class="flex-1">${escapeHtmlValue(errorMessage)}</div></div>`;
}
function renderInAppNumericKeypad(target, label) {
  const keys = [
    ["1", "1"], ["2", "2"], ["3", "3"],
    ["4", "4"], ["5", "5"], ["6", "6"],
    ["7", "7"], ["8", "8"], ["9", "9"],
    ["clear", "Clear"], ["0", "0"], ["backspace", "⌫"],
  ];
  const safeTarget = target === "bid" ? "bid" : "points";
  const safeLabel = escapeAttribute(label);
  const displayValue = safeTarget === "bid"
    ? String(ephemeralCustomBid || state.customBidValue || "")
    : String(ephemeralPoints || "");
  const displayValueAttr = escapeAttribute(displayValue);
  const displayPlaceholder = safeTarget === "bid" ? "Enter bid" : "Enter points";
  const submitRoundButton = safeTarget === "points"
    ? `<button type="button" class="score-keypad-sheet__submit threed" onclick="handleFormSubmit(event)">Submit Round</button>`
    : "";
  if (activeScoreKeypadTarget !== safeTarget) return "";
  const animationClass = scoreKeypadShouldAnimate ? " score-keypad-sheet--entering" : "";
  scoreKeypadShouldAnimate = false;

  return `
    <div id="scoreKeypadBackdrop" class="score-keypad-backdrop" onclick="closeScoreKeypad()" aria-hidden="true"></div>
    <section id="scoreKeypadSheet" class="score-keypad-sheet${animationClass}" role="dialog" aria-label="${safeLabel}">
      <div class="score-keypad-sheet__header">
        <span>${escapeHtmlValue(label)}</span>
        <button type="button" class="score-keypad-sheet__done threed" onclick="closeScoreKeypad()" aria-label="Hide ${safeLabel}">Done</button>
      </div>
      <input id="scoreKeypadDisplay" type="text" inputmode="none" readonly tabindex="-1" class="score-keypad-sheet__display" value="${displayValueAttr}" placeholder="${displayPlaceholder}" aria-label="${safeLabel} value" aria-readonly="true" aria-live="polite" />
      <div class="score-keypad" role="group" aria-label="${safeLabel}">
        ${keys.map(([key, display]) => {
          const keyClass = key === "clear" || key === "backspace" ? " score-keypad__key--action" : "";
          const ariaLabel = key === "backspace" ? "Delete last digit" : (key === "clear" ? "Clear value" : `Number ${key}`);
          return `<button type="button" class="score-keypad__key${keyClass} threed" onclick="handleScoreKeypadInput('${safeTarget}', '${key}')" aria-label="${ariaLabel}">${display}</button>`;
        }).join("")}
      </div>
      ${submitRoundButton}
    </section>`;
}
function renderScoreInputCard() {
  const { biddingTeam, bidAmount, showCustomBid, customBidValue, rounds, gameOver, undoneRounds, pendingPenalty } = state;
  if (gameOver || !biddingTeam) { getScoreCardAnimation(""); return ""; }
  const animation = getScoreCardAnimation(biddingTeam, { duration: "0.45s", delay: "0.05s" });
  const fadeClass = animation.className ? "animate-fadeIn " : "";
  const hasBid = bidAmount || (showCustomBid && validateBid(customBidValue) === "");
  const biddingTeamDisplayName = biddingTeam === "us" ? (state.usTeamName || "Us") : (state.demTeamName || "Dem");
  const biddingTeamDisplayText = escapeHtmlValue(biddingTeamDisplayName);
  const customBidValueAttr = escapeAttribute(customBidValue);
  const focusRingColor = biddingTeam === "us" ? "focus:ring-blue-500 dark:focus:ring-blue-400" : "focus:ring-red-500 dark:focus:ring-red-400";
  const penaltyActive = pendingPenalty && pendingPenalty.team === biddingTeam && pendingPenalty.type === "cheat";
  const penaltyBtnClass = penaltyActive
    ? "flex items-center border border-orange-400 rounded px-2 py-1 text-sm text-orange-700 bg-orange-100 transition focus:outline-none focus:ring-2 focus:ring-orange-500 dark:bg-orange-900/60 dark:text-orange-300 threed disabled:opacity-50 disabled:cursor-not-allowed"
    : "flex items-center border border-gray-400 rounded px-2 py-1 text-sm text-gray-600 bg-gray-50 transition focus:outline-none focus:ring-2 focus:ring-gray-500 dark:bg-gray-800/50 dark:text-gray-300 threed disabled:opacity-50 disabled:cursor-not-allowed";
  const penaltyBtnOnClick = penaltyActive ? 'undoPenaltyFlag()' : 'handleCheatFlag()';
  return `
    <div class="${fadeClass}bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-600 rounded-xl shadow-md${animation.className}"${animation.attrs}>
      <div class="border-b-2 border-gray-200 dark:border-gray-700 p-3 flex justify-between items-center">
        <h2 class="text-lg font-extrabold text-gray-800 dark:text-white">Enter Bid for ${biddingTeamDisplayText}</h2>
        <div class="flex space-x-2">
          <button type="button" class="flex items-center border border-gray-300 rounded px-2 py-1 text-sm text-gray-700 transition disabled:opacity-50 focus:outline-none focus:ring-2 ${focusRingColor} dark:border-gray-600 dark:text-white threed" onclick="handleUndo(event)" ${!rounds.length ? "disabled" : ""}>${Icons.Undo}Undo</button>
          <button type="button" class="flex items-center border border-gray-300 rounded px-2 py-1 text-sm text-gray-700 transition disabled:opacity-50 focus:outline-none focus:ring-2 ${focusRingColor} dark:border-gray-600 dark:text-white threed" onclick="handleRedo(event)" ${!undoneRounds.length ? "disabled" : ""}>${Icons.Redo}Redo</button>
          <button type="button"
    class="${penaltyBtnClass}"
    onclick="${penaltyBtnOnClick}"
    ${!hasBid ? "disabled" : ""}
    aria-label="Flag Table Talk - Choose Team">
<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 6.75c2.5.15 4.25 1.15 5.25 3L13 13l-1.75 3.25C10.25 18.1 8.5 19.1 6 19.25"/><path stroke-linecap="round" stroke-linejoin="round" d="M6 11.25c2.1-.45 4.05-.25 5.85.6M6 14.75c2.1.45 4.05.25 5.85-.6"/><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.25c1 .6 1.5 1.5 1.5 2.75s-.5 2.15-1.5 2.75M19.75 8.25C21.25 9.45 22 11.05 22 13s-.75 3.55-2.25 4.75"/></svg>
  </button>
        </div>
      </div>
      <div class="p-4 score-input-container show">
        <form onsubmit="handleFormSubmit(event)" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1.5 text-gray-700 dark:text-white">Bid Amount</label>
            <div class="flex flex-wrap gap-2">
              ${presetBids.map(b => {
                const isActive = b === "other" ? showCustomBid : (state.bidAmount === String(b) && !showCustomBid);
                const btnBase = `px-3 py-1.5 text-sm font-medium threed rounded-lg transition focus:outline-none focus:ring-2 ${focusRingColor}`;
                const btnActive = `${biddingTeam === "us" ? "bg-primary" : "bg-accent"} text-white shadow`;
                const btnInactive = `bg-white border border-gray-300 text-gray-700 dark:bg-gray-700 dark:border-gray-500 dark:text-white`;
                return `<button type="button" class="${btnBase} ${isActive ? btnActive : btnInactive}" onclick="handleBidSelect('${escapeAttribute(b)}')" aria-pressed="${isActive}">${b === "other" ? "Other" : escapeHtmlValue(b)}</button>`;
              }).join("")}
            </div>
            ${showCustomBid ? `<div class="mt-3 score-keypad-field">
              <input id="customBidInput" type="text" inputmode="none" readonly aria-readonly="true" aria-expanded="${activeScoreKeypadTarget === "bid"}" value="${customBidValueAttr}" placeholder="Tap to enter bid" onclick="openScoreKeypad('bid')" onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openScoreKeypad('bid'); } else if (event.key === 'Escape') { closeScoreKeypad(); }" class="score-number-display w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 ${focusRingColor} transition dark:bg-gray-700 dark:border-gray-500 dark:text-white" />
            </div>` : ""}
          </div>
          ${(bidAmount || (showCustomBid && customBidValue && validateBid(customBidValue)==="")) ? renderPointsInput() : ""}
        </form>
      </div>
    </div>`;
}
function renderPointsInput() {
  const { biddingTeam, enterBidderPoints, usTeamName, demTeamName } = state;
  const biddingTeamName = biddingTeam === "us" ? (usTeamName || "Us") : (demTeamName || "Dem");
  const nonBiddingTeamName = biddingTeam === "us" ? (demTeamName || "Dem") : (usTeamName || "Us");
  const labelText = enterBidderPoints ? `${biddingTeamName} Points (Bidding)` : `${nonBiddingTeamName} Points (Non-Bidding)`;
  const biddingTeamDisplay = escapeHtmlValue(biddingTeamName);
  const nonBiddingTeamDisplay = escapeHtmlValue(nonBiddingTeamName);
  const labelDisplay = escapeHtmlValue(labelText);
  const ephemeralPointsAttr = escapeAttribute(ephemeralPoints);

  // Determine active button based on whose points are being entered
  const biddingTeamButtonActive = enterBidderPoints;
  const nonBiddingTeamButtonActive = !enterBidderPoints;

  // Team-specific colors for active buttons
  const biddingTeamColorClass = biddingTeam === "us" ? "bg-primary" : "bg-accent";
  const nonBiddingTeamColorClass = biddingTeam === "us" ? "bg-accent" : "bg-primary";

  const focusRingColor = biddingTeam === "us" ? "focus:ring-blue-500 dark:focus:ring-blue-400" : "focus:ring-red-500 dark:focus:ring-red-400";

  return `
    <div class="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
      <div>
        <label class="block text-sm font-medium mb-1.5 text-gray-700 dark:text-white">Enter Points For</label>
        <div class="flex gap-3">
          <button type="button" class="flex-1 rounded-full px-3 py-1.5 text-sm font-medium threed transition focus:outline-none focus:ring-2 focus:ring-opacity-50 ${biddingTeamButtonActive ? `${biddingTeamColorClass} text-white shadow` : `bg-white border border-gray-300 text-gray-700 dark:bg-gray-700 dark:border-gray-500 dark:text-white`} ${focusRingColor}" onclick="handleBiddingPointsToggle(true)" aria-pressed="${biddingTeamButtonActive}">${biddingTeamDisplay}</button>
          <button type="button" class="flex-1 rounded-full px-3 py-1.5 text-sm font-medium threed transition focus:outline-none focus:ring-2 focus:ring-opacity-50 ${nonBiddingTeamButtonActive ? `${nonBiddingTeamColorClass} text-white shadow` : `bg-white border border-gray-300 text-gray-700 dark:bg-gray-700 dark:border-gray-500 dark:text-white`} ${focusRingColor}" onclick="handleBiddingPointsToggle(false)" aria-pressed="${nonBiddingTeamButtonActive}">${nonBiddingTeamDisplay}</button>
        </div>
      </div>
      <div>
        <label for="pointsInput" class="block text-sm font-medium mb-1.5 text-gray-700 dark:text-white">${labelDisplay}</label>
        <input id="pointsInput" type="text" inputmode="none" readonly aria-readonly="true" aria-expanded="${activeScoreKeypadTarget === "points"}" value="${ephemeralPointsAttr}" placeholder="Tap to enter points" onclick="openScoreKeypad('points')" onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openScoreKeypad('points'); } else if (event.key === 'Escape') { closeScoreKeypad(); }" class="score-number-display w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 ${focusRingColor} transition dark:bg-gray-700 dark:border-gray-500 dark:text-white" />
        <button type="submit" class="mt-3 w-full bg-blue-600 text-white px-5 py-2.5 text-sm font-bold rounded-xl shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-blue-500 dark:focus:ring-blue-400 threed">Submit Round</button>
      </div>
    </div>`;
}
function isHistoryCellEditing(idx, field) {
  return state.historyEdit && state.historyEdit.idx === idx && state.historyEdit.field === field;
}
function startHistoryEdit(idx, field) {
  updateState({ historyEdit: { idx, field }, error: "" });
  // The input only exists after the render frame queued by updateState.
  scheduleFrame(() => {
    const input = document.getElementById(`history-edit-${idx}-${field}`);
    if (input) {
      input.focus();
      input.select();
    }
  });
}
function cancelHistoryEdit() {
  if (state.historyEdit) updateState({ historyEdit: null });
}
function handleHistoryEditKey(e, idx, field) {
  if (e.key === "Enter") {
    e.preventDefault();
    commitHistoryEdit(idx, field, e.target.value);
  } else if (e.key === "Escape") {
    e.preventDefault();
    cancelHistoryEdit();
  }
}
function recalcRunningTotals(rounds, startingTotals) {
  const baseTotals = sanitizeTotals(startingTotals);
  let running = { ...baseTotals };
  return rounds.map((round) => {
    const usPoints = Number(round.usPoints);
    const demPoints = Number(round.demPoints);
    running = {
      us: running.us + (Number.isFinite(usPoints) ? usPoints : 0),
      dem: running.dem + (Number.isFinite(demPoints) ? demPoints : 0),
    };
    return { ...round, runningTotals: sanitizeTotals(running) };
  });
}
function computeGameOutcomeFromRounds(rounds) {
  if (!rounds.length) return { gameOver: false, winner: null, victoryMethod: null };
  const lastRound = rounds[rounds.length - 1];
  const lastTotals = sanitizeTotals(lastRound?.runningTotals);
  const biddingTeam = lastRound?.biddingTeam;
  const bidAmount = Number(lastRound?.bidAmount) || 0;
  const usEarned = Number(lastRound?.usPoints) || 0;
  const demEarned = Number(lastRound?.demPoints) || 0;
  const mustWinByBid = getLocalStorage(MUST_WIN_BY_BID_KEY, false);
  let gameOver = false, winner = null, victoryMethod = null;

  if (Math.abs(lastTotals.us - lastTotals.dem) >= 1000) {
    gameOver = true; winner = lastTotals.us > lastTotals.dem ? "us" : "dem"; victoryMethod = "1000 Point Spread";
  } else if ((biddingTeam === "us" && usEarned < 0 && lastTotals.dem >= 500) || (biddingTeam === "dem" && demEarned < 0 && lastTotals.us >= 500)) {
    if (!mustWinByBid) { gameOver = true; winner = biddingTeam === "us" ? "dem" : "us"; victoryMethod = "Set Other Team"; }
  } else if (
    (biddingTeam === "us" && lastTotals.us >= 500 && usEarned >= bidAmount) ||
    (biddingTeam === "dem" && lastTotals.dem >= 500 && demEarned >= bidAmount)
  ) {
    gameOver = true; winner = biddingTeam; victoryMethod = "Won on Bid";
  } else if ((biddingTeam === "us" && usEarned < 0 && lastTotals.dem >= 500) || (biddingTeam === "dem" && demEarned < 0 && lastTotals.us >= 500)) {
    gameOver = true; winner = biddingTeam === "us" ? "dem" : "us"; victoryMethod = "Set Other Team";
  }

  return { gameOver, winner, victoryMethod };
}
function commitHistoryEdit(idx, field, rawValue) {
  // A cancelled or already-committed edit re-enters here through the input's
  // blur when the re-render removes it; there is nothing left to commit.
  if (!isHistoryCellEditing(idx, field)) return;
  const rounds = Array.isArray(state.rounds) ? state.rounds : [];
  if (!rounds.length || !rounds[idx]) {
    cancelHistoryEdit();
    return;
  }
  if (String(rawValue ?? "").trim() === "") {
    cancelHistoryEdit();
    return;
  }

  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue)) {
    updateState({ historyEdit: null, error: "Enter a valid number." });
    return;
  }
  if (field === "bid") {
    const bidError = validateBid(String(numericValue));
    if (bidError) {
      updateState({ historyEdit: null, error: bidError });
      return;
    }
  }

  recordCurrentGameTimerActivity();
  const updatedRounds = rounds.map((round) => ({ ...round }));
  const baseTotals = getBaseTotals();
  if (field === "bid") {
    updatedRounds[idx].bidAmount = numericValue;
  } else {
    const prevTotals = idx === 0 ? baseTotals : sanitizeTotals(updatedRounds[idx - 1].runningTotals);
    if (field === "us") {
      updatedRounds[idx].usPoints = numericValue - prevTotals.us;
    } else if (field === "dem") {
      updatedRounds[idx].demPoints = numericValue - prevTotals.dem;
    }
  }

  const recalculatedRounds = recalcRunningTotals(updatedRounds, baseTotals);
  const outcome = computeGameOutcomeFromRounds(recalculatedRounds);
  const lastRound = recalculatedRounds[recalculatedRounds.length - 1];
  const nextState = {
    rounds: recalculatedRounds,
    undoneRounds: [],
    gameOver: outcome.gameOver,
    winner: outcome.winner,
    victoryMethod: outcome.victoryMethod,
    historyEdit: null,
    error: "",
  };
  if (field === "bid" && idx === recalculatedRounds.length - 1) {
    nextState.lastBidAmount = String(lastRound.bidAmount);
    nextState.lastBidTeam = lastRound.biddingTeam;
  }
  if (outcome.gameOver) {
    if (isStartTimestampActive(state.startTime)) {
      nextState.accumulatedTime = getCurrentGameTime(state);
    }
    nextState.startTime = null;
    nextState.timerStarted = hasStartedCurrentGameTimer(state);
  } else if (state.gameOver && recalculatedRounds.length) {
    const resumedAt = Date.now();
    nextState.timerStarted = true;
    nextState.startTime = resumedAt;
    nextState.timerLastSavedAt = resumedAt;
    nextState.timerLastActivityAt = resumedAt;
    nextState.timerPaused = false;
  }

  const priorWinner = state.winner;
  const priorGameOver = state.gameOver;
  // Same identity resolution as updateTeamsStatsOnGameEnd (dealer-pair fallback included).
  const usTeam = getTeamSnapshotForSide(state, "us");
  const demTeam = getTeamSnapshotForSide(state, "dem");
  const teamIdentity = { usPlayers: usTeam.players, demPlayers: demTeam.players, usDisplay: usTeam.display, demDisplay: demTeam.display };
  if (priorGameOver && priorWinner && (!outcome.gameOver || outcome.winner !== priorWinner)) {
    const teams = getTeamsObject();
    const reverted = applyTeamResultDelta(teams, { ...teamIdentity, winner: priorWinner }, -1);
    if (reverted) setTeamsObject(teams);
  }
  if (outcome.gameOver && outcome.winner && (!priorGameOver || outcome.winner !== priorWinner)) {
    const teams = getTeamsObject();
    const applied = applyTeamResultDelta(teams, { ...teamIdentity, winner: outcome.winner }, 1);
    if (applied) setTeamsObject(teams);
  }

  updateState(nextState);
  saveCurrentGameState();
}
function getHistoryRoundsForDisplay(rounds) {
  return rounds.map((round, idx) => ({ round, idx })).reverse();
}

function renderHistoryCard() {
  const { rounds, usTeamName, demTeamName } = state;
  const labelUs = usTeamName || "Us";
  const labelDem = demTeamName || "Dem";
  const labelUsDisplay = escapeHtmlValue(labelUs);
  const labelDemDisplay = escapeHtmlValue(labelDem);
  const labelUsAttr = escapeAttribute(labelUs);
  const labelDemAttr = escapeAttribute(labelDem);
  if (!rounds.length) return hasStartedCurrentGameTimer(state)
    ? `<div class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-600 rounded-xl p-4">${renderCurrentGameTimer()}</div>`
    : "";

  // Check if we should show the probability dropdown button
  const showProbabilityButton = state.showWinProbability && !state.gameOver && rounds.length > 0;
  const currentTotals = getLastRunningTotals();
  const pointDiffRaw = currentTotals.us - currentTotals.dem;
  const pointDiffDisplay = pointDiffRaw > 0
    ? `${labelUsDisplay} +${pointDiffRaw}`
    : pointDiffRaw < 0
      ? `${labelDemDisplay} +${Math.abs(pointDiffRaw)}`
      : "Tied";
  const pointDiffColorClass = pointDiffRaw > 0
    ? "text-primary"
    : pointDiffRaw < 0
      ? "text-accent"
      : "text-gray-800 dark:text-white";

  const lastRound = rounds[rounds.length - 1] || {};
  const historyEditKey = state.historyEdit ? `${state.historyEdit.idx}:${state.historyEdit.field}` : "";
  const animation = getHistoryCardAnimation(rounds.length, { duration: "0.4s", delay: "0.1s" });
  const cacheKey = [
    animation.className ? "animated" : "static",
    roundsVersion,
    rounds.length,
    currentTotals.us,
    currentTotals.dem,
    lastRound.bidAmount ?? "",
    lastRound.biddingTeam ?? "",
    labelUs,
    labelDem,
    showProbabilityButton ? 1 : 0,
    state.gameOver ? 1 : 0,
    hasStartedCurrentGameTimer(state) ? 1 : 0,
    historyEditKey,
  ].join("|");

  if (HISTORY_RENDER_CACHE.key === cacheKey) return HISTORY_RENDER_CACHE.html;

  const html = `
    <div class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-600 rounded-xl shadow-md${animation.className}"${animation.attrs}>
      <div class="border-b-2 border-gray-200 dark:border-gray-700 p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-extrabold text-gray-800 dark:text-white">History</h2>
            ${renderCurrentGameTimer()}
          </div>
          <p class="text-sm font-medium text-gray-600 dark:text-gray-300">
            Point Difference:
            <span class="font-semibold ${pointDiffColorClass}">${pointDiffDisplay}</span>
          </p>
        </div>
        <div class="grid grid-cols-3 gap-2 mt-3 font-medium text-gray-600 dark:text-white text-sm sm:text-base">
          <div class="text-left truncate">${labelUsDisplay}</div>
          <div class="text-center">Bid</div>
          <div class="text-right truncate">${labelDemDisplay}</div>
        </div>
      </div>
      <div class="p-4 max-h-60 overflow-y-auto no-scrollbar">
        <div class="space-y-2">
          ${getHistoryRoundsForDisplay(rounds).map(({ round, idx }) => {
            const biddingTeamLabel = round.biddingTeam === "us" ? (round.usTeamNameOnRound || labelUs) : (round.demTeamNameOnRound || labelDem);
            const biddingTeamLabelAttr = escapeAttribute(biddingTeamLabel);
            const bidValue = Number.isFinite(Number(round.bidAmount)) ? round.bidAmount : 0;
            const usValue = Number.isFinite(Number(round.runningTotals?.us)) ? round.runningTotals.us : 0;
            const demValue = Number.isFinite(Number(round.runningTotals?.dem)) ? round.runningTotals.dem : 0;
            const bidInput = isHistoryCellEditing(idx, "bid")
              ? `<input id="history-edit-${idx}-bid" type="number" inputmode="numeric" class="w-16 bg-white/80 dark:bg-gray-600 border border-gray-200 dark:border-gray-500 rounded-lg px-2 py-0.5 text-center text-black dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500" value="${bidValue}" onkeydown="handleHistoryEditKey(event, ${idx}, 'bid')" onblur="commitHistoryEdit(${idx}, 'bid', this.value)" />`
              : `<button type="button" class="inline-flex items-center text-black dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1" onclick="startHistoryEdit(${idx}, 'bid')" aria-label="Edit ${biddingTeamLabelAttr} bid for round ${idx + 1}">${bidValue}</button>`;
            const bidContent = round.biddingTeam === "us"
              ? `<div class="flex items-center justify-center gap-1"><span class="text-gray-800 dark:text-white">←</span>${bidInput}</div>`
              : `<div class="flex items-center justify-center gap-1">${bidInput}<span class="text-gray-800 dark:text-white">→</span></div>`;
            const usScoreContent = isHistoryCellEditing(idx, "us")
              ? `<input id="history-edit-${idx}-us" type="number" inputmode="numeric" class="w-full bg-white/80 dark:bg-gray-600 border border-gray-200 dark:border-gray-500 rounded-lg px-2 py-0.5 text-left text-gray-800 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500" value="${usValue}" onkeydown="handleHistoryEditKey(event, ${idx}, 'us')" onblur="commitHistoryEdit(${idx}, 'us', this.value)" />`
              : `<button type="button" class="w-full text-left text-gray-800 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 rounded" onclick="startHistoryEdit(${idx}, 'us')" aria-label="Edit ${labelUsAttr} score for round ${idx + 1}">${usValue}</button>`;
            const demScoreContent = isHistoryCellEditing(idx, "dem")
              ? `<input id="history-edit-${idx}-dem" type="number" inputmode="numeric" class="w-full bg-white/80 dark:bg-gray-600 border border-gray-200 dark:border-gray-500 rounded-lg px-2 py-0.5 text-right text-gray-800 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500" value="${demValue}" onkeydown="handleHistoryEditKey(event, ${idx}, 'dem')" onblur="commitHistoryEdit(${idx}, 'dem', this.value)" />`
              : `<button type="button" class="w-full text-right text-gray-800 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 rounded" onclick="startHistoryEdit(${idx}, 'dem')" aria-label="Edit ${labelDemAttr} score for round ${idx + 1}">${demValue}</button>`;
            return `
              <div class="grid grid-cols-3 gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-xl text-sm border border-gray-200 dark:border-gray-600 transition-shadow">
                <div class="text-left">${usScoreContent}</div>
                <div class="text-center text-gray-600 dark:text-gray-400">${bidContent}</div>
                <div class="text-right">${demScoreContent}</div>
              </div>`;
          }).join("")}
        </div>
      </div>
      ${showProbabilityButton ? `
        <div class="border-t-2 border-gray-200 dark:border-gray-700">
          <button onclick="openProbabilityModal()" 
                  class="w-full p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-b-xl">
            <div class="flex items-center justify-between">
              <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">How was this probability reached?</span>
              <svg class="w-4 h-4 text-gray-400 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            </div>
          </button>
        </div>
      ` : ''}
    </div>`;
  HISTORY_RENDER_CACHE.key = cacheKey;
  HISTORY_RENDER_CACHE.html = html;
  return html;
}
function renderGameOverOverlay() {
  if (!state.gameOver) return "";
  const isTie = state.winner !== "us" && state.winner !== "dem";
  const winnerLabel = state.winner === "us" ? (state.usTeamName || "Us") : (state.demTeamName || "Dem");
  const headline = isTie ? "It's a Tie" : `${escapeHtmlValue(winnerLabel)} Wins!`;
  const victoryMethodDisplay = escapeHtmlValue(state.victoryMethod || 'Game Ended');
  return `
<div data-overlay="gameover" class="dialog-modal dialog-modal--gameover" role="alertdialog" aria-labelledby="gameOverTitle" aria-describedby="gameOverWinner" aria-modal="true">
  <div class="dialog-card dialog-card--gold">
    <div class="dialog-body">
      <span class="dialog-icon dialog-icon--lg" aria-hidden="true">${getDialogIconSvg("trophy")}</span>
      <p id="gameOverTitle" class="dialog-eyebrow">Game Over</p>
      <h2 id="gameOverWinner" class="dialog-title dialog-title--xl">${headline}</h2>
      <span class="dialog-chip">${victoryMethodDisplay}</span>
    </div>
    <div class="dialog-actions dialog-actions--stack">
      <button onclick="handleGameOverSaveClick(event)" class="dialog-btn dialog-btn--primary" type="button">Save Game</button>
      <div class="dialog-actions" style="padding: 0;">
        <button onclick="handleGameOverFixClick(event)" class="dialog-btn dialog-btn--secondary dialog-btn--sm" type="button">Fix Score</button>
        <button onclick="handleGameOverRematchClick(event)" class="dialog-btn dialog-btn--secondary dialog-btn--sm" type="button">Rematch</button>
        <button onclick="handleNewGame()" class="dialog-btn dialog-btn--secondary dialog-btn--sm" type="button">New Game</button>
      </div>
    </div>
  </div>
</div>`;
}
// (renderReadOnlyGameDetails, renderSavedGames, renderFreezerGames, renderStatisticsContent, renderTeamStatsTable - these remain substantial and are called by modal openers)
function renderReadOnlyGameDetails(game, originalIndex = null) {
  const { rounds, timestamp, usTeamName, demTeamName, durationMs, winner, finalScore, victoryMethod } = game;
  const usDisp = getGameTeamDisplay(game, "us") || usTeamName || "Us";
  const demDisp = getGameTeamDisplay(game, "dem") || demTeamName || "Dem";
  const finalTotals = sanitizeTotals(finalScore);
  const usScore = finalTotals.us, demScore = finalTotals.dem;
  const usWinner = winner === "us", demWinner = winner === "dem";
  const hasWinner = usWinner || demWinner;
  const date = timestamp ? new Date(timestamp) : null;
  const dateStr = date && !Number.isNaN(date.getTime())
    ? date.toLocaleString([], { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "Unknown date";
  const roundList = Array.isArray(rounds) ? rounds : [];
  const roundsCount = roundList.length;
  const margin = Math.abs(usScore - demScore);

  const bidSummary = roundList.reduce((summary, round) => {
    const bidSide = typeof round.biddingTeam === "string" ? round.biddingTeam.trim().toLowerCase() : "";
    const bidAmount = Number(round.bidAmount);
    if ((bidSide !== "us" && bidSide !== "dem") || !Number.isFinite(bidAmount) || bidAmount <= 0) return summary;
    const points = Number(bidSide === "us" ? round.usPoints : round.demPoints);
    summary.attempts++;
    if (Number.isFinite(points) && points >= bidAmount) summary.made++;
    else summary.sets++;
    return summary;
  }, { attempts: 0, made: 0, sets: 0 });
  const bidMakeValue = bidSummary.attempts ? `${bidSummary.made}/${bidSummary.attempts}` : "N/A";
  const bidMakeSub = bidSummary.attempts ? `${Math.round((bidSummary.made / bidSummary.attempts) * 100)}% made` : "no bids";

  const renderTeam = (side, name, score, isWinner) => `
    <div class="gd-team gd-team--${side}${isWinner ? " is-winner" : ""}${hasWinner && !isWinner ? " is-dim" : ""}">
      <span class="gd-team__badge">${isWinner ? `${LIBRARY_ICONS.trophy}Winner` : "&nbsp;"}</span>
      <span class="gd-team__name">${escapeHtmlValue(name)}</span>
      <span class="gd-team__score">${escapeHtmlValue(String(score))}</span>
    </div>`;

  const renderStat = (label, value, sub = "") => `
    <div class="gd-stat">
      <dt class="gd-stat__label">${escapeHtmlValue(label)}</dt>
      <dd class="gd-stat__value">${escapeHtmlValue(value)}</dd>
      ${sub ? `<dd class="gd-stat__sub">${escapeHtmlValue(sub)}</dd>` : ""}
    </div>`;

  const formatDelta = (value) => (value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0");
  let previousTotals = sanitizeTotals(game.startingTotals);
  const roundHtml = roundList.map((r, i) => {
    const runningTotals = sanitizeTotals(r.runningTotals);
    const usDelta = runningTotals.us - previousTotals.us;
    const demDelta = runningTotals.dem - previousTotals.dem;
    previousTotals = runningTotals;
    const bidSide = typeof r.biddingTeam === "string" ? r.biddingTeam.trim().toLowerCase() : "";
    const bidAmount = Number(r.bidAmount);
    const hasBid = (bidSide === "us" || bidSide === "dem") && Number.isFinite(bidAmount) && bidAmount > 0;
    const bidderPoints = Number(bidSide === "us" ? r.usPoints : r.demPoints);
    const wasSet = hasBid && !(Number.isFinite(bidderPoints) && bidderPoints >= bidAmount);
    const bidTeamName = bidSide === "us" ? (r.usTeamNameOnRound || usDisp) : (r.demTeamNameOnRound || demDisp);
    const bidLabel = hasBid
      ? `${escapeHtmlValue(bidTeamName)} bid ${escapeHtmlValue(String(bidAmount))}${wasSet ? " and were set" : " and made it"}`
      : "No bid recorded";
    const totalCell = (side, total, delta) => {
      const isSetSide = wasSet && bidSide === side;
      return `
        <span class="gd-round__total gd-round__total--${side}${isSetSide ? " is-set" : ""}">
          <span class="gd-round__running">${escapeHtmlValue(String(total))}</span>
          <span class="gd-round__delta">${escapeHtmlValue(formatDelta(delta))}</span>
        </span>`;
    };
    return `
      <li class="gd-round${wasSet ? " is-set" : ""}" aria-label="${escapeAttribute(`Round ${i + 1}: ${bidLabel}. ${usDisp} ${runningTotals.us}, ${demDisp} ${runningTotals.dem}`)}">
        ${totalCell("us", runningTotals.us, usDelta)}
        <span class="gd-round__mid">
          <span class="gd-round__num">R${i + 1}</span>
          ${hasBid ? `
            <span class="gd-round__bid gd-round__bid--${bidSide}">
              ${bidSide === "us" ? '<span class="gd-round__arrow" aria-hidden="true">&larr;</span>' : ""}
              <span>${escapeHtmlValue(String(bidAmount))}</span>
              ${wasSet ? '<span class="gd-round__set">Set</span>' : '<span class="gd-round__made" aria-hidden="true">&#10003;</span>'}
              ${bidSide === "dem" ? '<span class="gd-round__arrow" aria-hidden="true">&rarr;</span>' : ""}
            </span>` : '<span class="gd-round__bid gd-round__bid--none">&mdash;</span>'}
        </span>
        ${totalCell("dem", runningTotals.dem, demDelta)}
      </li>`;
  }).join("");

  const deleteButton = Number.isInteger(originalIndex)
    ? `<button type="button" class="gd-action gd-action--danger" onclick="deleteViewedSavedGame(${originalIndex})">${LIBRARY_ICONS.trash}<span>Delete</span></button>`
    : "";

  return `
    <section class="gd-hero" aria-label="Final score">
      <p class="gd-hero__date">${LIBRARY_ICONS.clock}<span>${escapeHtmlValue(dateStr)}</span></p>
      <div class="gd-scoreboard">
        ${renderTeam("us", usDisp, usScore, usWinner)}
        <span class="gd-scoreboard__vs" aria-hidden="true">vs</span>
        ${renderTeam("dem", demDisp, demScore, demWinner)}
      </div>
      ${victoryMethod || (hasWinner && margin) ? `
        <div class="gd-hero__chips">
          ${victoryMethod ? `<span class="game-chip game-chip--method">${escapeHtmlValue(victoryMethod)}</span>` : ""}
          ${hasWinner && margin ? `<span class="game-chip">Won by ${escapeHtmlValue(String(margin))}</span>` : ""}
        </div>` : ""}
    </section>
    <dl class="gd-stats">
      ${renderStat("Rounds", String(roundsCount))}
      ${renderStat("Bids made", bidMakeValue, bidMakeSub)}
      ${renderStat("Sets", String(bidSummary.sets))}
      ${renderStat("Duration", durationMs ? formatDuration(durationMs) : "N/A")}
    </dl>
    <section class="gd-rounds" aria-label="Round history">
      <div class="gd-rounds__head">
        <span class="gd-rounds__team gd-rounds__team--us"><span class="game-card__dot" aria-hidden="true"></span><span>${escapeHtmlValue(usDisp)}</span></span>
        <span class="gd-rounds__title">Bid</span>
        <span class="gd-rounds__team gd-rounds__team--dem"><span>${escapeHtmlValue(demDisp)}</span><span class="game-card__dot" aria-hidden="true"></span></span>
      </div>
      ${roundHtml ? `<ol class="gd-rounds__list">${roundHtml}</ol>` : '<p class="gd-rounds__empty">No rounds were recorded for this game.</p>'}
    </section>
    <div class="gd-actions">
      ${deleteButton}
      <button type="button" class="gd-action gd-action--primary" onclick="closeViewSavedGameModal()">Done</button>
    </div>`;
}
