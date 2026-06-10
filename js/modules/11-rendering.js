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

function renderApp() {
  const { error, rounds, bidAmount, showCustomBid, biddingTeam, customBidValue, gameOver, lastBidAmount, lastBidTeam } = state;
  const totals = getCurrentTotals();
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
    const totalDeals = (roundNumber - 1) + (state.misdealCount || 0);
    const dealerIndex = totalDeals % state.dealers.length;
    const currentDealer = state.dealers[dealerIndex];
    const escapedDealer = escapeHtml(currentDealer);
    dealerRow = `<div class="mt-2 flex flex-row items-center justify-center gap-2">
      <span class="inline-block px-3 py-1 text-xs font-medium rounded-full" style="background-color: color-mix(in srgb, var(--primary-color) 20%, transparent); border: 1px solid color-mix(in srgb, var(--primary-color) 30%, transparent); color: var(--primary-color);">Dealer: ${escapedDealer}</span>
    </div>`;
  }

  // Show "Enter dealing order" button only before game starts AND if no dealers set
  let dealerEntryButton = "";
  const hasDealers = state.dealers && state.dealers.length > 0;
  if (rounds.length === 0 && !hasDealers) {
    dealerEntryButton = `<div class="mt-2"><button onclick="openDealerOrderModal()" class="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500">Enter dealing order</button></div>`;
  }

  // Show "Misdeal" button if dealers exist, setting is enabled, and game hasn't started bidding yet
  const misdealHandlingEnabled = !!getLocalStorage(MISDEAL_HANDLING_KEY, false);
  const misdealButton = (hasDealers && misdealHandlingEnabled && !biddingTeam && !gameOver)
    ? `<button onclick="handleMisdeal()" class="px-2.5 py-1 bg-yellow-500 dark:bg-yellow-600 text-white rounded-md hover:bg-yellow-600 dark:hover:bg-yellow-700 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-500 shadow-sm whitespace-nowrap">Misdeal</button>`
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
    ${renderTimeWarning()}
    <div class="flex flex-row gap-3 flex-wrap justify-center items-stretch">
      ${renderTeamCard("us", totals.us, winProb)}
      ${renderRoundCard(roundNumber, lastBidDisplayHtml)}
      ${renderTeamCard("dem", totals.dem, winProb)}
    </div>
    ${error ? `<div>${renderErrorAlert(error)}</div>` : ""}
    ${renderScoreInputCard()}
    ${renderHistoryCard()}
    ${renderGameOverOverlay()}
  `;
  if (gameOver && !confettiTriggered) {
    confettiTriggered = true;
    launchGameOverConfetti();
  }
}
function renderTeamCard(teamKey, score, winProb) {
  const isSelected = state.biddingTeam === teamKey;
  const teamLabel = teamKey === "us" ? (state.usTeamName || "Us") : (state.demTeamName || "Dem");
  const teamLabelDisplay = escapeHtmlValue(teamLabel);
  const teamLabelAttr = escapeAttribute(teamLabel);
  const colorClass = teamKey === "us" ? "bg-primary" : "bg-accent";
  const selectedEffect = isSelected ? "sunken-selected" : "";
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
    <button type="button"
    class="${colorClass} ${selectedEffect} threed text-white cursor-pointer transition-all flex flex-col items-center justify-center flex-1 min-w-[calc(33%-1rem)] sm:min-w-0 w-auto h-32 p-2${animation.className}"${animation.attrs}
    onclick="handleTeamClick('${teamKey}')"
    aria-pressed="${isSelected}" aria-label="Select ${teamLabelAttr}">
    <div class="text-center">
<h2 class="text-base sm:text-xl font-bold truncate max-w-[100px] sm:max-w-[120px]" style="text-shadow: 0 2px 0 rgba(0,0,0,0.25);">${teamLabelDisplay}</h2>
<p class="text-2xl font-extrabold" style="text-shadow: 0 2px 0 rgba(0,0,0,0.2);">${score}</p>
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
    ? "flex items-center border border-orange-400 rounded px-2 py-1 text-sm text-orange-700 bg-orange-100 hover:bg-orange-200 transition focus:outline-none focus:ring-2 focus:ring-orange-500 dark:bg-orange-900/60 dark:text-orange-300 threed disabled:opacity-50 disabled:cursor-not-allowed"
    : "flex items-center border border-gray-400 rounded px-2 py-1 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 transition focus:outline-none focus:ring-2 focus:ring-gray-500 dark:bg-gray-800/50 dark:text-gray-300 threed disabled:opacity-50 disabled:cursor-not-allowed";
  const penaltyBtnOnClick = penaltyActive ? 'undoPenaltyFlag()' : 'handleCheatFlag()';
  return `
    <div class="${fadeClass}bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-600 rounded-xl shadow-md${animation.className}"${animation.attrs}>
      <div class="border-b-2 border-gray-200 dark:border-gray-700 p-3 flex justify-between items-center">
        <h2 class="text-lg font-extrabold text-gray-800 dark:text-white">Enter Bid for ${biddingTeamDisplayText}</h2>
        <div class="flex space-x-2">
          <button type="button" class="flex items-center border border-gray-300 rounded px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 transition disabled:opacity-50 focus:outline-none focus:ring-2 ${focusRingColor} dark:border-gray-600 dark:text-white dark:hover:bg-gray-700 threed" onclick="handleUndo(event)" ${!rounds.length ? "disabled" : ""} title="Undo">${Icons.Undo}Undo</button>
          <button type="button" class="flex items-center border border-gray-300 rounded px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 transition disabled:opacity-50 focus:outline-none focus:ring-2 ${focusRingColor} dark:border-gray-600 dark:text-white dark:hover:bg-gray-700 threed" onclick="handleRedo(event)" ${!undoneRounds.length ? "disabled" : ""} title="Redo">${Icons.Redo}Redo</button>
          <button type="button"
    class="${penaltyBtnClass}"
    onclick="${penaltyBtnOnClick}"
    ${!hasBid ? "disabled" : ""}
    title="Flag Table Talk - Choose Team">
<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10v4a1 1 0 0 0 1 1h2l5 3V6L6 9H4a1 1 0 0 0-1 1zm13-1.5v5a2.5 2.5 0 0 0 0-5z" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16 12a4 4 0 0 0 4-4" stroke="currentColor" stroke-width="2" fill="none"/></svg>
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
                const btnActive = `${biddingTeam === "us" ? "bg-primary" : "bg-accent"} text-white shadow hover:brightness-95`;
                const btnInactive = `bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-500 dark:text-white dark:hover:bg-gray-600`;
                return `<button type="button" class="${btnBase} ${isActive ? btnActive : btnInactive}" onclick="handleBidSelect('${escapeAttribute(b)}')" aria-pressed="${isActive}">${b === "other" ? "Other" : escapeHtmlValue(b)}</button>`;
              }).join("")}
            </div>
            ${showCustomBid ? `<div class="mt-2"><input type="number" inputmode="numeric" pattern="[0-9]*" step="5" value="${customBidValueAttr}" oninput="handleCustomBidChange(event)" placeholder="Enter custom bid" class="w-full sm:w-1/2 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ${focusRingColor} transition dark:bg-gray-700 dark:border-gray-500 dark:text-white" /></div>` : ""}
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
          <button type="button" class="flex-1 rounded-full px-3 py-1.5 text-sm font-medium threed transition focus:outline-none focus:ring-2 focus:ring-opacity-50 ${biddingTeamButtonActive ? `${biddingTeamColorClass} text-white shadow hover:brightness-95` : `bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-500 dark:text-white dark:hover:bg-gray-600`} ${focusRingColor}" onclick="handleBiddingPointsToggle(true)" aria-pressed="${biddingTeamButtonActive}">${biddingTeamDisplay}</button>
          <button type="button" class="flex-1 rounded-full px-3 py-1.5 text-sm font-medium threed transition focus:outline-none focus:ring-2 focus:ring-opacity-50 ${nonBiddingTeamButtonActive ? `${nonBiddingTeamColorClass} text-white shadow hover:brightness-95` : `bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-500 dark:text-white dark:hover:bg-gray-600`} ${focusRingColor}" onclick="handleBiddingPointsToggle(false)" aria-pressed="${nonBiddingTeamButtonActive}">${nonBiddingTeamDisplay}</button>
        </div>
      </div>
      <div>
        <label for="pointsInput" class="block text-sm font-medium mb-1.5 text-gray-700 dark:text-white">${labelDisplay}</label>
        <div class="flex flex-col sm:flex-row sm:items-center sm:gap-5">
          <input id="pointsInput" type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="360" step="5" value="${ephemeralPointsAttr}" oninput="ephemeralPoints = this.value" placeholder="Enter points" class="w-full sm:flex-grow border border-gray-300 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ${focusRingColor} transition dark:bg-gray-700 dark:border-gray-500 dark:text-white" />
          <button type="submit" class="mt-2 sm:mt-0 bg-blue-600 text-white px-5 py-2 text-sm font-bold rounded-xl shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-blue-400 threed">Submit</button>
        </div>
      </div>
    </div>`;
}
function isHistoryCellEditing(idx, field) {
  return state.historyEdit && state.historyEdit.idx === idx && state.historyEdit.field === field;
}
function startHistoryEdit(idx, field) {
  updateState({ historyEdit: { idx, field }, error: "" });
  setTimeout(() => {
    const input = document.getElementById(`history-edit-${idx}-${field}`);
    if (input) {
      input.focus();
      input.select();
    }
  }, 0);
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
  const rounds = Array.isArray(state.rounds) ? state.rounds : [];
  if (!rounds.length || !rounds[idx]) {
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
      nextState.accumulatedTime = calculateSafeTimeAccumulation(state.accumulatedTime, state.startTime);
    }
    nextState.startTime = null;
  }

  const priorWinner = state.winner;
  const priorGameOver = state.gameOver;
  if (priorGameOver && priorWinner && (!outcome.gameOver || outcome.winner !== priorWinner)) {
    const teams = getTeamsObject();
    const reverted = applyTeamResultDelta(teams, {
      usPlayers: state.usPlayers,
      demPlayers: state.demPlayers,
      usDisplay: state.usTeamName,
      demDisplay: state.demTeamName,
      winner: priorWinner,
    }, -1);
    if (reverted) setTeamsObject(teams);
  }
  if (outcome.gameOver && outcome.winner && (!priorGameOver || outcome.winner !== priorWinner)) {
    const teams = getTeamsObject();
    const applied = applyTeamResultDelta(teams, {
      usPlayers: state.usPlayers,
      demPlayers: state.demPlayers,
      usDisplay: state.usTeamName,
      demDisplay: state.demTeamName,
      winner: outcome.winner,
    }, 1);
    if (applied) setTeamsObject(teams);
  }

  updateState(nextState);
  saveCurrentGameState();
}
function renderHistoryCard() {
  const { rounds, usTeamName, demTeamName } = state;
  const labelUs = usTeamName || "Us";
  const labelDem = demTeamName || "Dem";
  const labelUsDisplay = escapeHtmlValue(labelUs);
  const labelDemDisplay = escapeHtmlValue(labelDem);
  const labelUsAttr = escapeAttribute(labelUs);
  const labelDemAttr = escapeAttribute(labelDem);
  if (!rounds.length) return ""; // Don't render if no history

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
    historyEditKey,
  ].join("|");

  if (HISTORY_RENDER_CACHE.key === cacheKey) return HISTORY_RENDER_CACHE.html;

  const html = `
    <div class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-600 rounded-xl shadow-md${animation.className}"${animation.attrs}>
      <div class="border-b-2 border-gray-200 dark:border-gray-700 p-4">
        <div class="flex items-start justify-between gap-3">
          <h2 class="text-lg font-extrabold text-gray-800 dark:text-white">History</h2>
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
          ${rounds.map((round, idx) => {
            const biddingTeamLabel = round.biddingTeam === "us" ? (round.usTeamNameOnRound || labelUs) : (round.demTeamNameOnRound || labelDem);
            const biddingTeamLabelAttr = escapeAttribute(biddingTeamLabel);
            const bidValue = Number.isFinite(Number(round.bidAmount)) ? round.bidAmount : 0;
            const usValue = Number.isFinite(Number(round.runningTotals?.us)) ? round.runningTotals.us : 0;
            const demValue = Number.isFinite(Number(round.runningTotals?.dem)) ? round.runningTotals.dem : 0;
            const bidInput = isHistoryCellEditing(idx, "bid")
              ? `<input id="history-edit-${idx}-bid" type="number" inputmode="numeric" class="w-16 bg-white/80 dark:bg-gray-600 border border-gray-200 dark:border-gray-500 rounded-lg px-2 py-0.5 text-center text-black dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500" value="${bidValue}" onkeydown="handleHistoryEditKey(event, ${idx}, 'bid')" onblur="commitHistoryEdit(${idx}, 'bid', this.value)" />`
              : `<button type="button" class="inline-flex items-center text-black dark:text-white font-semibold hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1" onclick="startHistoryEdit(${idx}, 'bid')" aria-label="Edit ${biddingTeamLabelAttr} bid for round ${idx + 1}">${bidValue}</button>`;
            const bidContent = round.biddingTeam === "us"
              ? `<div class="flex items-center justify-center gap-1"><span class="text-gray-800 dark:text-white">←</span>${bidInput}</div>`
              : `<div class="flex items-center justify-center gap-1">${bidInput}<span class="text-gray-800 dark:text-white">→</span></div>`;
            const usScoreContent = isHistoryCellEditing(idx, "us")
              ? `<input id="history-edit-${idx}-us" type="number" inputmode="numeric" class="w-full bg-white/80 dark:bg-gray-600 border border-gray-200 dark:border-gray-500 rounded-lg px-2 py-0.5 text-left text-gray-800 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500" value="${usValue}" onkeydown="handleHistoryEditKey(event, ${idx}, 'us')" onblur="commitHistoryEdit(${idx}, 'us', this.value)" />`
              : `<button type="button" class="w-full text-left text-gray-800 dark:text-white font-semibold hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded" onclick="startHistoryEdit(${idx}, 'us')" aria-label="Edit ${labelUsAttr} score for round ${idx + 1}">${usValue}</button>`;
            const demScoreContent = isHistoryCellEditing(idx, "dem")
              ? `<input id="history-edit-${idx}-dem" type="number" inputmode="numeric" class="w-full bg-white/80 dark:bg-gray-600 border border-gray-200 dark:border-gray-500 rounded-lg px-2 py-0.5 text-right text-gray-800 dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500" value="${demValue}" onkeydown="handleHistoryEditKey(event, ${idx}, 'dem')" onblur="commitHistoryEdit(${idx}, 'dem', this.value)" />`
              : `<button type="button" class="w-full text-right text-gray-800 dark:text-white font-semibold hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded" onclick="startHistoryEdit(${idx}, 'dem')" aria-label="Edit ${labelDemAttr} score for round ${idx + 1}">${demValue}</button>`;
            return `
              <div key="${idx}" class="grid grid-cols-3 gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-xl text-sm border border-gray-200 dark:border-gray-600 hover:shadow-md transition-shadow">
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
                  class="w-full p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-b-xl">
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
  const winnerLabel = state.winner === "us" ? (state.usTeamName || "Us") : (state.winner === "dem" ? (state.demTeamName || "Dem") : "It's a Tie");
  const winnerDisplay = escapeHtmlValue(winnerLabel);
  const victoryMethodDisplay = escapeHtmlValue(state.victoryMethod || 'Game Ended');
  return `
<div data-overlay="gameover"
     class="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-md flex items-center justify-center p-4"
     style="z-index:49; animation: fadeIn 0.3s ease-out;"
     role="alertdialog" aria-labelledby="gameOverTitle" aria-modal="true">
      <div class="bg-white dark:bg-gray-800 w-full max-w-md rounded-2xl shadow-2xl text-center border-2 border-yellow-400 dark:border-yellow-600" style="animation: popBounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;">
        <div class="p-6">
          <h2 id="gameOverTitle" class="text-4xl font-black mb-2 animate-fadeIn text-gray-800 dark:text-white" style="text-shadow: 0 4px 0 rgba(0,0,0,0.15);">Game Over!</h2>
          <p class="text-2xl font-extrabold mb-1 animate-fadeIn text-gray-700 dark:text-white" style="text-shadow: 0 2px 0 rgba(0,0,0,0.1);">${winnerDisplay} Wins!</p>
          <p class="text-sm mb-6 animate-fadeIn text-gray-500 dark:text-gray-400 font-semibold">(${victoryMethodDisplay})</p>
          <div class="flex space-x-3 justify-center flex-wrap gap-2">
            <button onclick="handleGameOverFixClick(event)" class="bg-gray-200 text-gray-800 px-5 py-3 rounded-xl shadow-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 dark:focus:ring-gray-500 threed font-bold text-sm" type="button">Fix Score</button>
            <button onclick="handleGameOverSaveClick(event)" class="bg-green-600 text-white px-5 py-3 rounded-xl shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 transition dark:bg-green-500 dark:hover:bg-green-600 dark:focus:ring-green-400 threed font-bold text-sm" type="button">Save Game</button>
            <button onclick="handleNewGame()" class="bg-blue-600 text-white px-5 py-3 rounded-xl shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-blue-400 threed font-bold text-sm" type="button">New Game</button>
          </div>
        </div>
      </div>
    </div>`;
}
// (renderReadOnlyGameDetails, renderSavedGames, renderFreezerGames, renderStatisticsContent, renderTeamStatsTable - these remain substantial and are called by modal openers)
function renderReadOnlyGameDetails(game) {
  const { rounds, timestamp, usTeamName, demTeamName, durationMs, winner, finalScore, victoryMethod } = game;
  const usDisp = getGameTeamDisplay(game, "us") || usTeamName || "Us";
  const demDisp = getGameTeamDisplay(game, "dem") || demTeamName || "Dem";
  const usDisplay = escapeHtmlValue(usDisp);
  const demDisplay = escapeHtmlValue(demDisp);
  const finalTotals = sanitizeTotals(finalScore);
  const usScore = finalTotals.us, demScore = finalTotals.dem;
  const usWinner = winner === "us", demWinner = winner === "dem";
  const dateStr = new Date(timestamp).toLocaleString([], { year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
  const dateDisplay = escapeHtmlValue(dateStr);
  const victoryMethodDisplay = escapeHtmlValue(victoryMethod);
  const locationDisplay = escapeHtmlValue(getGameLocationDisplay(game) || "N/A");

  // Determine sandbag for winner
  let sandbagResult = "N/A";
  if (winner === "us" || winner === "dem") {
    const winnerPlayers = winner === "us"
      ? canonicalizePlayers(game.usPlayers || parseLegacyTeamName(game.usTeamName || game.usName))
      : canonicalizePlayers(game.demPlayers || parseLegacyTeamName(game.demTeamName || game.demName));
    sandbagResult = isGameSandbagForTeamKey(game, winnerPlayers) ? "Yes" : "No";
  }

  const roundsCount = Array.isArray(rounds) ? rounds.length : 0;
  const roundsLabel = roundsCount === 1 ? "1 Round" : `${roundsCount} Rounds`;

  const roundHtml = (rounds || []).map((r, idx) => {
      const runningTotals = sanitizeTotals(r.runningTotals);
      const bidTeam = r.biddingTeam === "us" ? (r.usTeamNameOnRound || usDisp) : (r.demTeamNameOnRound || demDisp);
      const bidTeamDisplay = escapeHtmlValue(bidTeam);
      const arrow = r.biddingTeam === "us" ? "←" : "→";
      const bidDisplay = `${escapeHtmlValue(r.bidAmount)} ${arrow}`;
      return `
      <div class="grid grid-cols-5 gap-1 p-2 bg-gray-50 rounded-xl dark:bg-gray-700 text-sm sm:text-base mb-2">
        <div class="text-left font-medium col-span-1 ${r.biddingTeam === "us" && r.usPoints < r.bidAmount ? 'text-red-500' : 'text-gray-800 dark:text-white'}">${runningTotals.us}</div>
        <div class="text-center text-gray-600 dark:text-gray-300 text-xs sm:text-sm col-span-3">
          <span class="bg-gray-200 dark:bg-gray-600 px-2 py-0.5 rounded-full">${bidTeamDisplay} bid ${bidDisplay}</span>
        </div>
        <div class="text-right font-medium col-span-1 ${r.biddingTeam === "dem" && r.demPoints < r.bidAmount ? 'text-red-500' : 'text-gray-800 dark:text-white'}">${runningTotals.dem}</div>
      </div>`;
  }).join("");

  return `
    <div class="space-y-4"> <!-- Reduced vertical spacing -->
      <div class="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 shadow-sm"> <!-- Reduced padding -->
        <div class="flex flex-col sm:flex-row justify-between items-center mb-2"> <!-- Reduced margin -->
          <h4 class="text-xl font-bold text-gray-800 dark:text-white text-center sm:text-left">${usDisplay} vs ${demDisplay}</h4>
          <span class="bg-blue-100 text-blue-800 text-xs font-medium px-3 py-1 rounded-full dark:bg-blue-900 dark:text-blue-300">${dateDisplay}</span>
        </div>
        <div class="flex justify-around items-center text-center">
          <div class="${usWinner ? 'text-green-500 dark:text-green-400' : 'text-gray-800 dark:text-white'}">
            <div class="text-sm">${usDisplay}</div><div class="text-2xl font-bold">${usScore}</div>
            ${usWinner ? '<div class="text-xs font-medium">WINNER</div>' : ''}
          </div>
          <div class="text-gray-400 dark:text-gray-500 text-lg">vs</div>
          <div class="${demWinner ? 'text-green-500 dark:text-green-400' : 'text-gray-800 dark:text-white'}">
            <div class="text-sm">${demDisplay}</div><div class="text-2xl font-bold">${demScore}</div>
            ${demWinner ? '<div class="text-xs font-medium">WINNER</div>' : ''}
          </div>
        </div>
        ${victoryMethod ? `<p class="text-center text-xs text-gray-500 dark:text-gray-400 mt-1">(${victoryMethodDisplay})</p>` : ''}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 mb-1">
        <div class="bg-white dark:bg-gray-800 rounded-xl p-2 shadow-sm flex flex-col items-start">
          <span class="text-xs font-semibold text-gray-800 dark:text-white">Sandbag?</span>
          <span class="text-sm text-gray-700 dark:text-gray-300">${sandbagResult}</span>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl p-2 shadow-sm flex flex-col items-start">
          <span class="text-xs font-semibold text-gray-800 dark:text-white">Location</span>
          <span class="text-sm text-gray-700 dark:text-gray-300">${locationDisplay}</span>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl p-2 shadow-sm flex flex-col items-start sm:items-end">
          <span class="text-xs font-semibold text-gray-800 dark:text-white">Duration</span>
          <span class="text-sm text-gray-700 dark:text-gray-300">${durationMs ? formatDuration(durationMs) : "N/A"}</span>
        </div>
      </div>
      <div class="bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm"> <!-- Reduced padding -->
        <div class="flex items-center justify-between mb-1">
          <p class="font-semibold text-gray-800 dark:text-white">Round History</p>
          <span class="text-xs font-medium text-gray-500 dark:text-gray-400">${roundsLabel}</span>
        </div>
        <div class="space-y-2 max-h-60 overflow-y-auto rounded-xl pr-1 no-scrollbar">${roundHtml || '<p class="text-gray-500">No rounds.</p>'}</div>
      </div>
      <div class="flex justify-center"><button type="button" onclick="closeViewSavedGameModal()" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white transition-colors threed">Close</button></div>
    </div>`;
}
