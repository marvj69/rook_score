"use strict";

// --- Game Actions & Logic ---
function handleCheatFlag() {
  if (!state.biddingTeam) return;  // Can't apply penalty without an active bidding team

  // Open team selection modal for table talk penalty
  openTableTalkModal();
}

function openTableTalkModal() {
  const usTeamName = state.usTeamName || "Us";
  const demTeamName = state.demTeamName || "Dem";
  const usTeamDisplay = escapeHtml(usTeamName);
  const demTeamDisplay = escapeHtml(demTeamName);

  const modalHtml = `
    <div id="tableTalkModal" class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 modal" role="dialog" aria-modal="true" aria-labelledby="tableTalkModalTitle">
      <div class="bg-white dark:bg-gray-800 w-full max-w-md rounded-xl shadow-lg">
        <div class="p-6">
          <h2 id="tableTalkModalTitle" class="text-xl font-bold mb-4 text-gray-800 dark:text-white text-center">Table Talk Penalty</h2>
          <p class="text-gray-600 dark:text-gray-300 mb-6 text-center">Which team engaged in table talk during this round?</p>
          <div class="space-y-3">
            <button 
              onclick="applyTableTalkPenalty('us')" 
              class="w-full text-white px-4 py-3 rounded-xl font-medium focus:outline-none hover:opacity-90 transition threed" 
              style="background-color: var(--primary-color);">
              ${usTeamDisplay}
            </button>
            <button 
              onclick="applyTableTalkPenalty('dem')" 
              class="w-full text-white px-4 py-3 rounded-xl font-medium focus:outline-none hover:opacity-90 transition threed" 
              style="background-color: var(--accent-color);">
              ${demTeamDisplay}
            </button>
          </div>
          <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
            <button 
              onclick="closeTableTalkModal()" 
              class="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white transition threed">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  activateModalEnvironment();
}

function closeTableTalkModal() {
  const modal = document.getElementById('tableTalkModal');
  if (modal) {
    modal.remove();
    deactivateModalEnvironment();
  }
}

function applyTableTalkPenalty(flaggedTeam) {
  const teamName = flaggedTeam === "us" 
    ? (state.usTeamName || "Us") 
    : (state.demTeamName || "Dem");

  closeTableTalkModal();

  // Get penalty type and create appropriate confirmation message
  const penaltyType = getLocalStorage(TABLE_TALK_PENALTY_TYPE_KEY, "setPoints");
  let confirmationMessage;

  console.log("Table Talk Penalty Type:", penaltyType);

  if (penaltyType === "setPoints") {
    const penaltyPoints = getLocalStorage(TABLE_TALK_PENALTY_POINTS_KEY, "180");
    console.log("Using setPoints penalty:", penaltyPoints);
    confirmationMessage = `Flag ${teamName} for table-talk? They will lose ${penaltyPoints} points.`;
  } else {
    // penaltyType === "loseBid" - they lose the bid amount in points
    const bidAmount = state.bidAmount || "0";
    console.log("Using loseBid penalty:", bidAmount);
    confirmationMessage = `Flag ${teamName} for table-talk? They will lose ${bidAmount} points (the bid amount).`;
  }

  // Show confirmation before applying penalty
  openConfirmationModal(
    confirmationMessage,
    () => { // YES
      applyCheatPenaltyRound(flaggedTeam);
      closeConfirmationModal();
      showSaveIndicator(`Penalty applied to ${teamName}`);
    },
    closeConfirmationModal // NO
  );
}

function applyCheatPenaltyRound(flaggedTeam) {
  // Get current state values
  const { biddingTeam, bidAmount, rounds, usTeamName, demTeamName } = state;
  if (!biddingTeam || !bidAmount) return;
  const numericBid = Number(bidAmount);
  const lastTotals = getLastRunningTotals();

  // Get penalty type and calculate penalty amount
  const penaltyType = getLocalStorage(TABLE_TALK_PENALTY_TYPE_KEY, "setPoints");
  let penaltyAmount;

  if (penaltyType === "setPoints") {
    penaltyAmount = parseInt(getLocalStorage(TABLE_TALK_PENALTY_POINTS_KEY, "180"));
  } else {
    penaltyAmount = numericBid; // Traditional penalty - lose the bid amount
  }

  let usEarned = 0, demEarned = 0;
  if (flaggedTeam === "us") {
    usEarned = -penaltyAmount;
    demEarned = 0;
  } else {
    usEarned = 0;
    demEarned = -penaltyAmount;
  }
  const newTotals = { us: lastTotals.us + usEarned, dem: lastTotals.dem + demEarned };
  const newRound = {
    roundIndex: rounds.length,
    biddingTeam,
    bidAmount: numericBid,
    usPoints: usEarned,
    demPoints: demEarned,
    runningTotals: newTotals,
    usTeamNameOnRound: usTeamName || "Us",
    demTeamNameOnRound: demTeamName || "Dem",
    penalty: "cheat",
    penaltyType: penaltyType,
    penaltyAmount: penaltyAmount
  };
  const updatedRounds = [...rounds, newRound];

  // Check for game over
  const mustWinByBid = getLocalStorage(MUST_WIN_BY_BID_KEY, false);
  let gameFinished = false, theWinner = null, victoryMethod = "Penalty: Lost Bid";
  if (Math.abs(newTotals.us - newTotals.dem) >= 1000) {
    gameFinished = true; theWinner = newTotals.us > newTotals.dem ? "us" : "dem"; victoryMethod = "1000 Point Spread";
  } else if ((biddingTeam === "us" && usEarned < 0 && newTotals.dem >= 500) || (biddingTeam === "dem" && demEarned < 0 && newTotals.us >= 500)) {
    if (!mustWinByBid) { gameFinished = true; theWinner = biddingTeam === "us" ? "dem" : "us"; victoryMethod = "Set Other Team"; }
  } else if (
// bidder wins by making their bid and crossing 500
(biddingTeam === "us" && newTotals.us >= 500 && usEarned >= numericBid) ||
(biddingTeam === "dem" && newTotals.dem >= 500 && demEarned >= numericBid)
    ) {
gameFinished   = true;
theWinner      = biddingTeam;
victoryMethod  = "Won on Bid";
    } else if (
// non-bidding team wins by setting the bidder and crossing 500
(biddingTeam === "us" && usEarned < 0 && newTotals.dem >= 500) ||
(biddingTeam === "dem" && demEarned < 0 && newTotals.us >= 500)
    ) {
gameFinished   = true;
theWinner      = biddingTeam === "us" ? "dem" : "us";
victoryMethod  = "Set Other Team";
    }
    // no "auto-win at 500+" fallback any more

  const timerRunning = isStartTimestampActive(state.startTime);
  let finalAccumulated = clampDurationMs(state.accumulatedTime);
  if (timerRunning && !gameFinished) { /* Time continues */ }
  else if (timerRunning && gameFinished) { 
    finalAccumulated = calculateSafeTimeAccumulation(finalAccumulated, state.startTime);
  }

  updateState({
    rounds: updatedRounds,
    undoneRounds: [],
    gameOver: gameFinished,
    winner: theWinner,
    victoryMethod,
    biddingTeam: "",
    bidAmount: "",
    showCustomBid: false,
    customBidValue: "",
    enterBidderPoints: false,
    error: "",
    accumulatedTime: finalAccumulated,
    startTime: gameFinished ? null : (timerRunning ? state.startTime : null),
    pendingPenalty: null
  });
  if (gameFinished && theWinner) updateTeamsStatsOnGameEnd(theWinner);
  saveCurrentGameState();
}

function handleTeamClick(team) {
  if (state.gameOver) return;
  if (state.biddingTeam === team) { // Click active team to deselect
    state.savedScoreInputStates[team] = { bidAmount: state.bidAmount, customBidValue: state.customBidValue, showCustomBid: state.showCustomBid, enterBidderPoints: state.enterBidderPoints, error: state.error };
    updateState({ biddingTeam: "", bidAmount: "", showCustomBid: false, customBidValue: "", enterBidderPoints: false, error: ""});
  } else { // Select a new team
    state.savedScoreInputStates[team === "us" ? "dem" : "us"] = null; // Clear other team's saved input
    let newTeamState = { biddingTeam: team, bidAmount: "", showCustomBid: false, customBidValue: "", enterBidderPoints: false, error: "" };
    if (state.savedScoreInputStates[team]) { // Restore if previously selected
      newTeamState = { ...newTeamState, ...state.savedScoreInputStates[team] };
    }
    updateState(newTeamState);
  }
  ephemeralCustomBid = ""; ephemeralPoints = ""; // Clear ephemeral inputs on team switch
}
function handleBidSelect(bid) {
  if (bid === "other") {
    updateState({ showCustomBid: true, bidAmount: "", customBidValue: ephemeralCustomBid }); // Keep current custom bid if switching back
  } else {
    updateState({ showCustomBid: false, bidAmount: String(bid), customBidValue: "" });
  }
  // Update last bid info only if a numeric bid is made or custom bid is valid
  const bidVal = (bid === "other" && validateBid(state.customBidValue)==="") ? state.customBidValue : (bid !== "other" ? String(bid) : null);
  if (bidVal) updateState({ lastBidAmount: bidVal, lastBidTeam: state.biddingTeam });
  else updateState({ lastBidAmount: null, lastBidTeam: null}); // Clear if "other" is selected with no valid custom bid yet

  // Save current bid selection to localStorage
  saveCurrentGameState();
}
// numbers that are technically "valid JSON" but we *don't* want to trigger a re-render for
const BLOCKED_BIDS = new Set([5, 10, 15]);

function handleCustomBidChange(e) {
  const valStr = e.target.value.trim();   // what the user just typed
  ephemeralCustomBid = valStr;            // persist while they're editing

  /* 1 ▸ don't redraw yet if…
  – the bid isn't valid JSON-wise  OR
  – it's one of the blocked small bids                       */
  if (validateBid(valStr) !== "" || BLOCKED_BIDS.has(+valStr)) return;

  /* 2 ▸ number is good and allowed → commit to state
  (this will re-render exactly once, keeping focus alive)    */
  updateState({
    customBidValue : valStr,
    bidAmount      : valStr,
    lastBidAmount  : valStr,
    lastBidTeam    : state.biddingTeam
  });
}

function handleBiddingPointsToggle(isBiddingTeamPoints) {
  ephemeralPoints = ""; // Clear ephemeral points input
  updateState({ enterBidderPoints: isBiddingTeamPoints });
}
function handleFormSubmit(e, skipZeroCheck = false) {
  e.preventDefault();
  const { biddingTeam, bidAmount, rounds, enterBidderPoints, usTeamName, demTeamName } = state;
  const pointsInputEl = document.getElementById("pointsInput");
  if (!pointsInputEl) { updateState({ error: "Points input not found." }); return; }
  const pointsVal = pointsInputEl.value;

  if (!biddingTeam || !bidAmount) { updateState({ error: "Please select bid amount." }); return; }
  const bidError = validateBid(bidAmount);
  const pointsError = validatePoints(pointsVal);
  if (bidError || pointsError) { updateState({ error: bidError || pointsError }); return; }

  const numericBid = Number(bidAmount);
  const numericPoints = Number(pointsVal);

  if (!skipZeroCheck && numericPoints === 0) {
  const enteredForNonBidder = !state.enterBidderPoints;   // true ⇢ '0' belonged to non-bid team

  openZeroPointsModal(chosen => {
    /* commit() will run once the DOM is ready */
    const commit = () => {
  const freshInput = document.getElementById("pointsInput");
  if (freshInput) freshInput.value = String(chosen);

  /* second arg ›› skipZeroCheck = true */
  handleFormSubmit(new Event("submit"), /* skipZeroCheck */ true);
};

    /* if the '0' was for the non-bidding team we must flip the toggle first,
 which triggers a re-render → wait one tick before commit()            */
 if (enteredForNonBidder && chosen !== 0 && state.enterBidderPoints === false) {
  handleBiddingPointsToggle(true);     // causes one re-render
  setTimeout(commit, 0);               // run after new DOM appears
    } else {
  commit();                            // no toggle needed
    }
  });

  return;                                 // pause main handler until modal choice
}

  if (rounds.length === 0 && state.startTime === null) updateState({ startTime: Date.now() });

  let usEarned = 0, demEarned = 0;
  const nonBiddingTeamTotal = 180; // Standard total points in a hand excluding Rook

  if (numericPoints === 360) { // Special 360 case (usually means all points + Rook)
      if (enterBidderPoints) { // Bidding team claims 360
          biddingTeam === "us" ? (usEarned = 360, demEarned = 0) : (demEarned = 360, usEarned = 0);
      } else { // Non-bidding team claims 360
          biddingTeam === "us" ? (usEarned = -numericBid, demEarned = 360) : (demEarned = -numericBid, usEarned = 360);
      }
  } else { // Standard point distribution
      if (enterBidderPoints) { // Points entered for bidding team
          biddingTeam === "us" ? (usEarned = numericPoints, demEarned = nonBiddingTeamTotal - numericPoints) : (demEarned = numericPoints, usEarned = nonBiddingTeamTotal - numericPoints);
      } else { // Points entered for non-bidding team
          biddingTeam === "us" ? (demEarned = numericPoints, usEarned = nonBiddingTeamTotal - numericPoints) : (usEarned = numericPoints, demEarned = nonBiddingTeamTotal - numericPoints);
      }
      // Apply penalty if bid not met
      if (state.pendingPenalty && state.pendingPenalty.type === "cheat") {
    if (state.pendingPenalty.team === "us")   usEarned  = -numericBid;
    else                                      demEarned = -numericBid;
}
      if (biddingTeam === "us" && usEarned < numericBid) usEarned = -numericBid;
      else if (biddingTeam === "dem" && demEarned < numericBid) demEarned = -numericBid;
  }

  const lastTotals = getLastRunningTotals();
  const newTotals = { us: lastTotals.us + usEarned, dem: lastTotals.dem + demEarned };
  const newRound = { roundIndex: rounds.length, biddingTeam, bidAmount: numericBid, usPoints: usEarned, demPoints: demEarned, runningTotals: newTotals, usTeamNameOnRound: usTeamName || "Us", demTeamNameOnRound: demTeamName || "Dem" };
  const updatedRounds = [...rounds, newRound];

  const mustWinByBid = getLocalStorage(MUST_WIN_BY_BID_KEY, false);
  let gameFinished = false, theWinner = null, victoryMethod = "Won on Bid";

  if (Math.abs(newTotals.us - newTotals.dem) >= 1000) {
      gameFinished = true; theWinner = newTotals.us > newTotals.dem ? "us" : "dem"; victoryMethod = "1000 Point Spread";
  } else if ((biddingTeam === "us" && usEarned < 0 && newTotals.dem >= 500) || (biddingTeam === "dem" && demEarned < 0 && newTotals.us >= 500)) {
      if (!mustWinByBid) { gameFinished = true; theWinner = biddingTeam === "us" ? "dem" : "us"; victoryMethod = "Set Other Team"; }
    } else if (
// bidder wins by making their bid and crossing 500
(biddingTeam === "us" && newTotals.us >= 500 && usEarned >= numericBid) ||
(biddingTeam === "dem" && newTotals.dem >= 500 && demEarned >= numericBid)
    ) {
gameFinished   = true;
theWinner      = biddingTeam;
victoryMethod  = "Won on Bid";
    } else if (
// non-bidding team wins by setting the bidder and crossing 500
(biddingTeam === "us" && usEarned < 0 && newTotals.dem >= 500) ||
(biddingTeam === "dem" && demEarned < 0 && newTotals.us >= 500)
    ) {
gameFinished   = true;
theWinner      = biddingTeam === "us" ? "dem" : "us";
victoryMethod  = "Set Other Team";
    }

  ephemeralCustomBid = ""; ephemeralPoints = "";
  const timerRunning = isStartTimestampActive(state.startTime);
  let finalAccumulated = clampDurationMs(state.accumulatedTime);
  if (timerRunning && !gameFinished) { /* Time continues */ }
  else if (timerRunning && gameFinished) { 
    finalAccumulated = calculateSafeTimeAccumulation(finalAccumulated, state.startTime);
  }

  updateState({
      rounds: updatedRounds, undoneRounds: [], gameOver: gameFinished, winner: theWinner, victoryMethod,
      biddingTeam: "", bidAmount: "", showCustomBid: false, customBidValue: "", enterBidderPoints: false, error: "",
      accumulatedTime: finalAccumulated, startTime: gameFinished ? null : (timerRunning ? state.startTime : null), pendingPenalty: null 
  });
  if (gameFinished && theWinner) updateTeamsStatsOnGameEnd(theWinner);
  saveCurrentGameState();
}
function handleUndo() {
  if (!state.rounds.length) return;
  const wasGameOver = state.gameOver;
  const priorWinner = state.winner;
  const teamSnapshot = {
    usPlayers: state.usPlayers,
    demPlayers: state.demPlayers,
    usDisplay: state.usTeamName,
    demDisplay: state.demTeamName,
  };
  const lastRound = state.rounds[state.rounds.length - 1];
  const newRounds = state.rounds.slice(0, -1);
  const newUndoneRounds = [...state.undoneRounds, lastRound];
  let newLastBid = null, newLastBidTeam = null;
  if (newRounds.length > 0) {
      newLastBid = String(newRounds[newRounds.length-1].bidAmount);
      newLastBidTeam = newRounds[newRounds.length-1].biddingTeam;
  }
  const nextState = { rounds: newRounds, undoneRounds: newUndoneRounds, gameOver: false, winner: null, victoryMethod: null, lastBidAmount: newLastBid, lastBidTeam: newLastBidTeam };
  if (!newRounds.length) {
      nextState.startTime = null;
      nextState.accumulatedTime = 0;
      nextState.timerLastSavedAt = null;
  }
  if (wasGameOver && priorWinner) {
    const teams = getTeamsObject();
    const reverted = applyTeamResultDelta(teams, { ...teamSnapshot, winner: priorWinner }, -1);
    if (reverted) setTeamsObject(teams);
  }
  updateState(nextState);
  saveCurrentGameState();
}
function handleRedo() {
  if (!state.undoneRounds.length) return;
  const redoRound = state.undoneRounds[state.undoneRounds.length - 1];
  const newRounds = [...state.rounds, redoRound];
  const newUndoneRounds = state.undoneRounds.slice(0, -1);

  // Re-check game over condition based on the new last round
  const lastTotals = newRounds[newRounds.length - 1].runningTotals;
  let gameOver = false, winner = null, victoryMethod = null;
  const mustWinByBid = getLocalStorage(MUST_WIN_BY_BID_KEY, false);

  if (Math.abs(lastTotals.us - lastTotals.dem) >= 1000) {
      gameOver = true; winner = lastTotals.us > lastTotals.dem ? "us" : "dem"; victoryMethod = "1000 Point Spread";
  } else if ((redoRound.biddingTeam === "us" && redoRound.usPoints < 0 && lastTotals.dem >= 500) || 
             (redoRound.biddingTeam === "dem" && redoRound.demPoints < 0 && lastTotals.us >= 500)) {
      if (!mustWinByBid) { gameOver = true; winner = redoRound.biddingTeam === "us" ? "dem" : "us"; victoryMethod = "Set Other Team"; }
  } else if (
      (redoRound.biddingTeam === "us" && lastTotals.us >= 500 && redoRound.usPoints >= redoRound.bidAmount) ||
      (redoRound.biddingTeam === "dem" && lastTotals.dem >= 500 && redoRound.demPoints >= redoRound.bidAmount)
  ) {
      gameOver = true; winner = redoRound.biddingTeam; victoryMethod = "Won on Bid";
  } else if (
      (redoRound.biddingTeam === "us" && redoRound.usPoints < 0 && lastTotals.dem >= 500) ||
      (redoRound.biddingTeam === "dem" && redoRound.demPoints < 0 && lastTotals.us >= 500)
  ) {
      gameOver = true; winner = redoRound.biddingTeam === "us" ? "dem" : "us"; victoryMethod = "Set Other Team";
  }

  updateState({ rounds: newRounds, undoneRounds: newUndoneRounds, gameOver, winner, victoryMethod, lastBidAmount: String(redoRound.bidAmount), lastBidTeam: redoRound.biddingTeam });
  if (gameOver && winner) updateTeamsStatsOnGameEnd(winner);
  saveCurrentGameState();
}
function handleMisdeal() {
  // Increment misdeal counter to skip to next dealer
  const newMisdealCount = (state.misdealCount || 0) + 1;
  updateState({ misdealCount: newMisdealCount });
  saveCurrentGameState();
  showSaveIndicator("Moved to next dealer");
}
function handleNewGame() {
  openConfirmationModal(
    "Start a new game? Unsaved progress will be lost.",
    () => {
closeTeamSelectionModal();
resetGame();
closeConfirmationModal();
    },
    closeConfirmationModal
  );
}
function hideGameOverOverlay() {
  const overlay = document.querySelector('[data-overlay="gameover"]');
  if (overlay) overlay.classList.add('hidden');
}

function handleGameOverSaveClick(e) {
  if (e) e.preventDefault();
  hideGameOverOverlay();
  pendingGameAction = "save";
  
  // Check if we have dealers and no team names set yet
  const hasTeamNames = state.usTeamName || state.demTeamName || 
                       (state.usPlayers && state.usPlayers.some(Boolean)) || 
                       (state.demPlayers && state.demPlayers.some(Boolean));
  const hasFourDealers = state.dealers && state.dealers.length === 4;
  
  if (hasFourDealers && !hasTeamNames) {
    // Show dealer pair selection first
    openDealerPairSelectionModal();
  } else {
    // Go directly to team selection
    openTeamSelectionModal();
  }
}
function handleGameOverFixClick(e) {
  if (e) e.preventDefault();
  if (!state.rounds.length) {
      hideGameOverOverlay();
      return;
  }
  hideGameOverOverlay();
  handleUndo();
}

function handleManualSaveGame() { // Called after team names confirmed or if already set
  if (!state.usTeamName || !state.demTeamName) {
    pendingGameAction = "save";
    
    // Check if we have dealers to auto-populate team selection
    const hasFourDealers = state.dealers && state.dealers.length === 4;
    const hasTeamNames = (state.usPlayers && state.usPlayers.some(Boolean)) || 
                         (state.demPlayers && state.demPlayers.some(Boolean));
    
    if (hasFourDealers && !hasTeamNames) {
      openDealerPairSelectionModal();
    } else {
      openTeamSelectionModal();
    }
    return;
  }
  if (!state.rounds.length) return;

  let finalAccumulated = calculateSafeTimeAccumulation(state.accumulatedTime, state.startTime);

  const lastRoundTotals = getCurrentTotals();
  const usPlayers = ensurePlayersArray(state.usPlayers);
  const demPlayers = ensurePlayersArray(state.demPlayers);
  const usDisplay = deriveTeamDisplay(usPlayers, state.usTeamName || "Us") || "Us";
  const demDisplay = deriveTeamDisplay(demPlayers, state.demTeamName || "Dem") || "Dem";
  const usTeamKey = buildTeamKey(usPlayers) || null;
  const demTeamKey = buildTeamKey(demPlayers) || null;
  const gameObj = {
      usTeamName: usDisplay,
      demTeamName: demDisplay,
      usPlayers,
      demPlayers,
      usTeamKey,
      demTeamKey,
      rounds: state.rounds,
      finalScore: lastRoundTotals,
      startingTotals: sanitizeTotals(state.startingTotals),
      winner: state.winner, victoryMethod: state.victoryMethod,
      timestamp: new Date().toISOString(), durationMs: finalAccumulated,
      // Simplified playerStats, more complex stats are in general statistics
      playerStats: { 
          [usDisplay]: { totalPoints: lastRoundTotals.us, wins: state.winner === "us" ? 1 : 0 },
          [demDisplay]: { totalPoints: lastRoundTotals.dem, wins: state.winner === "dem" ? 1 : 0 }
      }
  };
  const savedGames = getLocalStorage("savedGames", []);
  savedGames.push(gameObj);
  setLocalStorage("savedGames", savedGames);
  refreshProbabilityPersonalizationFromSavedGames(savedGames, { force: true });
  showSaveIndicator("Game Saved!");
  resetGame(); // Resets state and clears active game from storage
  confettiTriggered = false;
  pendingGameAction = null;
}
function handleFreezerGame() {
  if (state.gameOver || !state.rounds.length) {
    alert("No active game to freeze."); return;
  }
  if (!state.usTeamName || !state.demTeamName) {
    pendingGameAction = "freeze";
    
    // Check if we have dealers to auto-populate team selection
    const hasFourDealers = state.dealers && state.dealers.length === 4;
    const hasTeamNames = (state.usPlayers && state.usPlayers.some(Boolean)) || 
                         (state.demPlayers && state.demPlayers.some(Boolean));
    
    if (hasFourDealers && !hasTeamNames) {
      openDealerPairSelectionModal();
    } else {
      openTeamSelectionModal();
    }
    return;
  }
  confirmFreeze(); // Ask for confirmation
}
function confirmFreeze() {
   openConfirmationModal(
      "Freeze this game? It will be moved to Freezer Games and current game will reset.",
      () => { freezeCurrentGame(); closeConfirmationModal(); closeMenuOverlay(); },
      closeConfirmationModal
  );
}
function freezeCurrentGame() {
  let finalAccumulated = calculateSafeTimeAccumulation(state.accumulatedTime, state.startTime);
  const finalScore = getCurrentTotals();
  const lastRound = state.rounds.length ? state.rounds[state.rounds.length-1] : {};
  const usPlayers = ensurePlayersArray(state.usPlayers);
  const demPlayers = ensurePlayersArray(state.demPlayers);
  const usDisplay = deriveTeamDisplay(usPlayers, state.usTeamName || "Us") || "Us";
  const demDisplay = deriveTeamDisplay(demPlayers, state.demTeamName || "Dem") || "Dem";
  const usTeamKey = buildTeamKey(usPlayers) || null;
  const demTeamKey = buildTeamKey(demPlayers) || null;

  // Generate name from dealers if available, otherwise use timestamp
  let gameName;
  if (state.dealers && state.dealers.length === 4) {
    gameName = state.dealers.join(', ');
  } else {
    gameName = `FROZEN-${new Date().toLocaleTimeString()}`;
  }

  const frozenGame = {
      name: gameName,
      usName: usDisplay,
      demName: demDisplay,
      usPlayers,
      demPlayers,
      usTeamKey,
      demTeamKey,
      finalScore, // Current scores when frozen
      lastBid: lastRound.bidAmount ? `${lastRound.bidAmount} (${lastRound.biddingTeam === "us" ? usDisplay : demDisplay})` : "N/A",
      winner: null, victoryMethod: null, // Game is not over
      rounds: state.rounds,
      startingTotals: sanitizeTotals(state.startingTotals),
      timestamp: new Date().toISOString(),
      accumulatedTime: finalAccumulated,
      // Store necessary state to resume
      biddingTeam: state.biddingTeam, bidAmount: state.bidAmount,
      customBidValue: state.customBidValue, showCustomBid: state.showCustomBid,
      enterBidderPoints: state.enterBidderPoints, lastBidAmount: state.lastBidAmount, lastBidTeam: state.lastBidTeam,
      dealers: state.dealers || [], misdealCount: state.misdealCount || 0
  };
  const freezerGames = getLocalStorage("freezerGames");
  freezerGames.unshift(frozenGame); // Add to beginning
  setLocalStorage("freezerGames", freezerGames);
  showSaveIndicator("Game Frozen!");
  resetGame(); // Resets state and clears active game
  pendingGameAction = null;
}
function loadFreezerGame(index) {
  const freezerGames = getLocalStorage("freezerGames");
  const chosen = freezerGames[index];
  if (!chosen) return;
  openConfirmationModal(
    `Load frozen game "${chosen.name || 'Untitled'}"? Current game will be overwritten.`,
    () => {
      closeConfirmationModal();
      const chosenUsPlayers = ensurePlayersArray(chosen.usPlayers || parseLegacyTeamName(chosen.usName));
      const chosenDemPlayers = ensurePlayersArray(chosen.demPlayers || parseLegacyTeamName(chosen.demName));
      const chosenUsName = deriveTeamDisplay(chosenUsPlayers, chosen.usName || "Us") || "Us";
      const chosenDemName = deriveTeamDisplay(chosenDemPlayers, chosen.demName || "Dem") || "Dem";
      // Restore all relevant game state aspects
      updateState({
          rounds: chosen.rounds || [],
          startingTotals: sanitizeTotals(chosen.startingTotals),
          gameOver: false, // Frozen games are not over
          winner: null, victoryMethod: null,
          biddingTeam: chosen.biddingTeam || "",
          bidAmount: chosen.bidAmount || "",
          showCustomBid: chosen.showCustomBid || false,
          customBidValue: chosen.customBidValue || "",
          enterBidderPoints: chosen.enterBidderPoints || false,
          error: "", // Clear any previous error
          lastBidAmount: chosen.lastBidAmount || null,
          lastBidTeam: chosen.lastBidTeam || null,
          usPlayers: chosenUsPlayers,
          demPlayers: chosenDemPlayers,
          usTeamName: chosenUsName,
          demTeamName: chosenDemName,
          accumulatedTime: clampDurationMs(chosen.accumulatedTime), // Cap accumulated time
          startTime: Date.now(), // Restart timer
          showWinProbability: JSON.parse(localStorage.getItem(PRO_MODE_KEY)) || false,
          undoneRounds: [], // Clear any undone rounds from previous state
          dealers: chosen.dealers || [],
          misdealCount: chosen.misdealCount || 0
      });
      freezerGames.splice(index, 1); // Remove from freezer
      setLocalStorage("freezerGames", freezerGames);
      closeSavedGamesModal();
      saveCurrentGameState(); // Save the now active game
      confettiTriggered = false;
    },
    closeConfirmationModal
  );
}
function viewSavedGame(originalIndex) { // originalIndex is from the full savedGames list
  const savedGames = getLocalStorage("savedGames"); // Get the full list
  // Find the actual game object by its original index if filtering/sorting was applied
  // This requires the renderSavedGames to pass the original index or unique ID.
  // For simplicity, assuming originalIndex is correct for the current display of `savedGames`.
  // A robust solution would involve passing a game ID if the list is dynamically filtered/sorted.
  // Let's assume `renderSavedGames` provides an index that's valid for `getLocalStorage("savedGames")[index]`
  const chosen = savedGames[originalIndex];

  if (!chosen) return;
  document.getElementById("viewSavedGameDetails").innerHTML = renderReadOnlyGameDetails(chosen);
  openViewSavedGameModal();
}
function deleteGame(storageKey, index, descriptor) {
  const items = getLocalStorage(storageKey);
  openConfirmationModal(`Delete this ${descriptor}?`, () => {
    items.splice(index, 1);
    setLocalStorage(storageKey, items);
    if (storageKey === "savedGames") recalcTeamsStats(); // Only if deleting a completed game
    closeConfirmationModal();
    // Re-render the list in the modal
    if (document.getElementById("savedGamesModal") && !document.getElementById("savedGamesModal").classList.contains("hidden")) {
      updateGamesCount();
      renderGamesWithFilter();
    }
  }, closeConfirmationModal);
}
function deleteSavedGame(index) { deleteGame("savedGames", index, "completed game"); }
function deleteFreezerGame(index) { deleteGame("freezerGames", index, "frozen game"); }
