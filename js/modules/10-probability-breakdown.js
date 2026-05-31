"use strict";

// --- Probability Breakdown Functions ---
function openProbabilityModal() {
  emitRookEvent("probability_opened", getRookGameEventParams(state));
  const modalHtml = `
    <div id="probabilityModal" class="probability-modal fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 modal" role="dialog" aria-modal="true" aria-labelledby="probabilityModalTitle" style="-webkit-overflow-scrolling: touch;" tabindex="-1">
      <div class="probability-modal-content relative mx-auto my-8 w-full max-w-lg bg-white rounded-xl shadow-lg dark:bg-gray-800 overflow-hidden" style="max-height: 80vh;">
        <div class="p-6 overflow-y-auto" style="max-height: calc(80vh - 0px);">
          <header class="flex justify-between items-center mb-6">
            <h2 id="probabilityModalTitle" class="text-2xl font-bold text-gray-800 dark:text-white">Win Probability</h2>
            <button type="button" onclick="closeProbabilityModal()" class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>
          ${generateProbabilityBreakdown()}
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  activateModalEnvironment();
}

function closeProbabilityModal() {
  const modal = document.getElementById('probabilityModal');
  if (modal) {
    modal.remove();
    deactivateModalEnvironment();
  }
}

function generateProbabilityBreakdown() {
  if (!state.showWinProbability || !state.rounds || state.rounds.length === 0 || state.gameOver) {
    return "";
  }

  const historicalGames = getLocalStorage("savedGames");
  const games = Array.isArray(historicalGames) ? historicalGames : [];
  const probabilityContext = getProbabilityContext(games);
  const winProb = getWinProbability(state, games, probabilityContext);

  // Get current game state
  const lastRound = state.rounds[state.rounds.length - 1];
  const currentScores = sanitizeTotals(lastRound?.runningTotals);
  const scoreDiff = currentScores.us - currentScores.dem;
  const roundsPlayed = state.rounds.length;
  const prevRound = roundsPlayed > 1 ? state.rounds[roundsPlayed - 2] : null;
  const prevTotals = sanitizeTotals(prevRound?.runningTotals);
  const prevDiff = prevTotals.us - prevTotals.dem;
  const momentum = scoreDiff - prevDiff;
  const labelUs = state.usTeamName || "Us";
  const labelDem = state.demTeamName || "Dem";
  const modelSnapshot = getModelProbabilitySnapshotForState(state, probabilityContext.model, probabilityContext.personalization);

  return generateComplexProbabilityBreakdown(
    scoreDiff,
    roundsPlayed,
    labelUs,
    labelDem,
    winProb,
    games,
    currentScores,
    momentum,
    probabilityContext,
    modelSnapshot
  );
}

function generateComplexProbabilityBreakdown(scoreDiff, roundsPlayed, labelUs, labelDem, winProb, historicalGames, currentScores, momentum, probabilityContext, modelSnapshot) {
  const labelUsDisplay = escapeHtmlValue(labelUs || "Us");
  const labelDemDisplay = escapeHtmlValue(labelDem || "Dem");
  const leadLabelDisplay = scoreDiff > 0 ? labelUsDisplay : labelDemDisplay;

  // Get the probability table for complex analysis
  const games = Array.isArray(historicalGames) ? historicalGames : [];
  const cacheKey = getProbabilityCacheKey(games);
  if (!PROB_CACHE.has(cacheKey)) {
    PROB_CACHE.set(cacheKey, buildProbabilityIndex(games));
  }
  const table = PROB_CACHE.get(cacheKey);

  // Calculate the bucketed score and key for this situation
  const roundIndex = Math.max(0, roundsPlayed - 1);
  const bucketedScore = bucketScore(scoreDiff);
  const key = `${roundIndex}|${bucketedScore}`;
  const counts = table[key] || { us: 1, dem: 1 };
  const empirical = counts.us / (counts.us + counts.dem);
  const totalObs = counts.us + counts.dem - 2; // Remove Laplace prior
  const K_CONFIDENCE_THRESHOLD = 30;
  const beta = Math.min(1, Math.log(totalObs + 1) / Math.log(K_CONFIDENCE_THRESHOLD + 1));
  const snapshot = modelSnapshot || getModelProbabilitySnapshotForState(
    state,
    probabilityContext?.model || getActiveRuntimeModel(),
    probabilityContext?.personalization || null
  );
  const modelProbUs = snapshot.modelProbUs;
  const baseModelProbUs = snapshot.baseModelProbUs;
  const personalizationRecord = snapshot.personalizationRecord;
  const personalizationActive = snapshot.personalizationActive;
  const modelId = snapshot.modelId;

  // Score bucketing analysis
  const bucketAnalysis = (() => {
    const bucketRange = getBucketRange(bucketedScore);
    const bucketSize = Math.abs(bucketedScore);
    let bucketDescription = "";

    if (bucketSize === 0) {
      bucketDescription = "Tied games";
    } else if (bucketSize <= 130) {
      bucketDescription = `Close games (${bucketRange})`;
    } else if (bucketSize <= 180) {
      bucketDescription = `Large leads (${bucketRange})`;
    } else {
      bucketDescription = `Dominant positions (${bucketRange})`;
    }

    return {
      bucketedScore,
      bucketDescription,
      bucketRange
    };
  })();

  // Historical pattern analysis (exact bucket + round)
  const historicalAnalysis = (() => {
    const relevantGames = games.filter(game => {
      return game.rounds && game.rounds.length > 0 && game.finalScore;
    });

    if (relevantGames.length === 0) {
      return {
        text: "No historical data",
        explanation: "Model-only estimate (no saved games with complete rounds)",
        empiricalRate: 0,
        totalObservations: 0
      };
    }

    const explanation = totalObs > 0
      ? `Exact match: round ${roundsPlayed}, bucket ${bucketAnalysis.bucketRange}`
      : `No exact matches yet for round ${roundsPlayed} in bucket ${bucketAnalysis.bucketRange}`;
    return {
      text: `${relevantGames.length} saved games available`,
      explanation,
      empiricalRate: totalObs > 0 ? empirical : 0,
      totalObservations: totalObs
    };
  })();

  // Blending analysis
  const blendingAnalysis = (() => {
    const empiricalWeight = Math.round(beta * 100);
    const modelWeight = Math.round((1 - beta) * 100);
    const empiricalPercent = Math.round(empirical * 100);
    const modelPercent = Math.round(modelProbUs * 100);
    const baseModelPercent = Math.round(baseModelProbUs * 100);
    const modelLabel = personalizationActive ? "personalized model" : "base model";

    let confidence = "Low";
    if (totalObs >= 50) confidence = "Very High";
    else if (totalObs >= 20) confidence = "High";
    else if (totalObs >= 10) confidence = "Medium";
    else if (totalObs >= 5) confidence = "Low-Medium";

    return {
      empiricalWeight,
      modelWeight,
      empiricalPercent,
      modelPercent,
      baseModelPercent,
      modelLabel,
      confidence,
      totalObservations: totalObs
    };
  })();

  const personalizationAnalysis = (() => {
    const record = normalizePersonalizationRecord(personalizationRecord);
    if (!record || record.modelId !== modelId) {
      return {
        status: "Inactive",
        detail: "No personalization record for the active model yet.",
        effectText: `Base model: ${Math.round(baseModelProbUs * 100)}% (no personalization applied)`,
      };
    }

    const updatedAtMs = Date.parse(record.updatedAt || "");
    const updatedAtText = Number.isFinite(updatedAtMs) ? formatTimestamp(updatedAtMs, "Unknown") : "Unknown";
    const baseLossText = Number.isFinite(record.baseLogLoss) ? record.baseLogLoss.toFixed(4) : "N/A";
    const personalizedLossText = Number.isFinite(record.personalizedLogLoss) ? record.personalizedLogLoss.toFixed(4) : "N/A";

    if (personalizationActive) {
      return {
        status: "Active",
        detail: `${record.gameSamples} games / ${record.roundSamples} rounds • Updated ${updatedAtText}`,
        effectText: `Base model: ${Math.round(baseModelProbUs * 100)}% -> Personalized: ${Math.round(modelProbUs * 100)}%`,
      };
    }

    if (record.gameSamples < PERSONALIZATION_MIN_GAMES || record.roundSamples < PERSONALIZATION_MIN_ROUNDS) {
      return {
        status: "Inactive (more local data needed)",
        detail: `${record.gameSamples}/${PERSONALIZATION_MIN_GAMES} games • ${record.roundSamples}/${PERSONALIZATION_MIN_ROUNDS} rounds`,
        effectText: `Base model: ${Math.round(baseModelProbUs * 100)}% (personalization pending)`,
      };
    }

    return {
      status: "Inactive (no reliable gain)",
      detail: `Log loss: base ${baseLossText} vs personalized ${personalizedLossText}`,
      effectText: `Base model: ${Math.round(baseModelProbUs * 100)}% (guardrails kept identity calibration)`,
    };
  })();

  return `
    <div class="space-y-4">
      <!-- Header -->
      <div class="text-center border-b border-gray-200 dark:border-gray-700 pb-3">
        <div class="text-xl font-bold text-gray-800 dark:text-white mb-1">
          Win Probability Breakdown
        </div>
        <div class="flex items-center justify-center gap-6 text-lg">
          <div class="flex items-center gap-2">
            <div class="w-3 h-3 rounded-full bg-primary"></div>
            <span class="font-semibold text-white">${labelUsDisplay}: ${winProb.us.toFixed(1)}%</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-3 h-3 rounded-full bg-accent"></div>
            <span class="font-semibold text-white">${labelDemDisplay}: ${winProb.dem.toFixed(1)}%</span>
          </div>
        </div>
        <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Method: Historical bucket + regression model${personalizationActive ? " + user calibration" : ""} • Confidence: ${blendingAnalysis.confidence}
        </div>
      </div>

      <!-- Current Situation -->
      <div class="space-y-3">
        <h3 class="font-semibold text-gray-800 dark:text-white">Current Situation</h3>

        <div class="bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Score Classification</div>
            <div class="text-sm text-blue-700 dark:text-blue-300 font-medium">${escapeHtmlValue(bucketAnalysis.bucketDescription)}</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            <strong>Current:</strong> ${currentScores.us} - ${currentScores.dem} 
            ${Math.abs(scoreDiff) > 0 ? `(${Math.abs(scoreDiff)} point ${leadLabelDisplay} lead)` : '(Tied)'}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Bucketed as: ${escapeHtmlValue(bucketAnalysis.bucketRange)} • Round ${roundsPlayed}
          </div>
        </div>
      </div>

      <!-- Statistical Analysis -->
      <div class="space-y-3">
        <h3 class="font-semibold text-gray-800 dark:text-white">Statistical Analysis</h3>

        <div class="bg-gradient-to-r from-green-50 to-green-100 dark:from-green-900/30 dark:to-green-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Historical Bucket (Exact Match)</div>
            <div class="text-sm text-green-700 dark:text-green-300 font-medium">${historicalAnalysis.empiricalRate > 0 ? `${Math.round(historicalAnalysis.empiricalRate * 100)}% historical win rate` : 'No exact matches yet'}</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            <strong>Data:</strong> ${historicalAnalysis.totalObservations} observations in this exact round + bucket
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ${escapeHtmlValue(historicalAnalysis.explanation)}
          </div>
        </div>

        <div class="bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/30 dark:to-purple-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Probability Blend</div>
            <div class="text-sm text-purple-700 dark:text-purple-300 font-medium">${blendingAnalysis.empiricalWeight}% Historical bucket + ${blendingAnalysis.modelWeight}% Regression model</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            <strong>Inputs:</strong> ${blendingAnalysis.empiricalPercent}% (bucket) + ${blendingAnalysis.modelPercent}% (${blendingAnalysis.modelLabel}) -> ${winProb.us.toFixed(1)}%
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Base model output before personalization: ${blendingAnalysis.baseModelPercent}%.
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Based on ${blendingAnalysis.totalObservations} observations in this exact bucket. More data = higher historical weight.
          </div>
        </div>

        <div class="bg-gradient-to-r from-amber-50 to-amber-100 dark:from-amber-900/30 dark:to-amber-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Per-User Calibration</div>
            <div class="text-sm text-amber-700 dark:text-amber-300 font-medium">${escapeHtmlValue(personalizationAnalysis.status)}</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            ${escapeHtmlValue(personalizationAnalysis.detail)}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ${escapeHtmlValue(personalizationAnalysis.effectText)}
          </div>
        </div>
      </div>

      <!-- How It Works -->
      <div class="border-t border-gray-200 dark:border-gray-700 pt-3">
        <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <h4 class="font-medium text-gray-800 dark:text-white mb-2">How This Probability Was Calculated</h4>
          <div class="text-xs text-gray-600 dark:text-gray-400 space-y-1">
            <p>• <strong>Current state:</strong> Uses the live score after round ${roundsPlayed} and momentum (change in score diff from the previous round)</p>
            <p>• <strong>Historical bucket:</strong> Looks up saved games in the exact round index and 20-point score-diff bucket, with Laplace smoothing (1|1)</p>
            <p>• <strong>Recency weighting:</strong> Disabled; all saved games count equally</p>
            <p>• <strong>Regression model:</strong> Computes base probability from 14 features (score diff, round index, momentum, bid context, and interaction terms), then applies global Platt calibration</p>
            <p>• <strong>User calibration:</strong> Learns per-user slope/intercept from completed local games and applies only when data + log-loss guardrails are met</p>
            <p>• <strong>Blend:</strong> Final probability = (weight * historical) + (1 - weight) * model; weight grows with the log of observations in this exact bucket (full weight at 30)</p>
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">
            Historical bucket and user calibration update as you save games; global model coefficients stay fixed until retrained.
          </div>
        </div>
      </div>
    </div>
  `;
}

function getBucketRange(bucketedScore) {
  const abs = Math.abs(bucketedScore);
  if (abs === 0) return "0";
  if (abs === 180) return "161+";
  const lower = abs - 19;
  return `${lower}-${abs}`;
}
function buildNameRecencyMaps(teamsObj = null) {
  const playerRecency = new Map();
  const teamRecency = new Map();
  const updateRecency = (map, key, timestampMs) => {
    if (!key) return;
    const prev = map.get(key);
    if (prev === undefined || timestampMs > prev) map.set(key, timestampMs);
  };
  const addPlayerName = (name, timestampMs) => {
    const cleaned = sanitizePlayerName(name || "");
    if (!cleaned) return;
    updateRecency(playerRecency, cleaned, timestampMs);
  };
  const addPlayers = (players, timestampMs) => {
    ensurePlayersArray(players).forEach(name => addPlayerName(name, timestampMs));
  };
  const addTeam = (players, timestampMs) => {
    const key = buildTeamKey(players);
    updateRecency(teamRecency, key, timestampMs);
  };
  const addGame = (game) => {
    if (!game) return;
    const parsed = game.timestamp ? new Date(game.timestamp).getTime() : 0;
    const timestampMs = Number.isFinite(parsed) ? parsed : 0;
    const usPlayers = canonicalizePlayers(game.usPlayers || parseLegacyTeamName(game.usTeamName || game.usName));
    const demPlayers = canonicalizePlayers(game.demPlayers || parseLegacyTeamName(game.demTeamName || game.demName));
    addPlayers(usPlayers, timestampMs);
    addPlayers(demPlayers, timestampMs);
    addTeam(usPlayers, timestampMs);
    addTeam(demPlayers, timestampMs);
  };

  const savedGames = getLocalStorage("savedGames", []);
  if (Array.isArray(savedGames)) savedGames.forEach(addGame);
  const freezerGames = getLocalStorage("freezerGames", []);
  if (Array.isArray(freezerGames)) freezerGames.forEach(addGame);

  const now = Date.now();
  addPlayers(state.usPlayers, now);
  addPlayers(state.demPlayers, now);
  addPlayers(state.dealers, now);
  addTeam(state.usPlayers, now);
  addTeam(state.demPlayers, now);

  if (teamsObj && typeof teamsObj === "object") {
    Object.entries(teamsObj).forEach(([key, value]) => {
      updateRecency(teamRecency, key, 0);
      if (value && value.players) addPlayers(value.players, 0);
    });
  }

  return { playerRecency, teamRecency };
}
function getOrderedPlayerSuggestions() {
  const teamsObj = getTeamsObject();
  const { playerRecency } = buildNameRecencyMaps(teamsObj);

  return Array.from(playerRecency.entries())
    .sort((a, b) => {
      const diff = b[1] - a[1];
      if (diff) return diff;
      return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' });
    })
    .map(([name]) => name);
}
function getFilteredPlayerSuggestions(suggestions, query = '', limit = 6, excludedNames = []) {
  const normalizedQuery = sanitizePlayerName(query).toLowerCase();
  const excludedKeys = new Set(
    Array.from(excludedNames || [])
      .map(name => sanitizePlayerName(name).toLowerCase())
      .filter(Boolean)
  );
  const uniqueSuggestions = [];
  const seen = new Set();

  suggestions.forEach((name) => {
    const cleaned = sanitizePlayerName(name);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    if (excludedKeys.has(key)) return;
    if (normalizedQuery && !key.includes(normalizedQuery)) return;
    seen.add(key);
    uniqueSuggestions.push(cleaned);
  });

  return uniqueSuggestions.slice(0, limit);
}
function refreshPlayerSuggestions() {
  const orderedSuggestions = getOrderedPlayerSuggestions();

  const datalist = document.getElementById("playerNameSuggestions");
  if (datalist) {
    datalist.innerHTML = orderedSuggestions
      .map(name => `<option value="${escapeAttribute(name)}"></option>`)
      .join("\n");
  }

  return orderedSuggestions;
}
function populateTeamSelects() {
  const teamsObj = getTeamsObject();
  const { teamRecency } = buildNameRecencyMaps(teamsObj);
  const entrySortFn = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  const teamEntries = Object.entries(teamsObj).map(([key, value]) => ({
    key,
    players: ensurePlayersArray(value.players),
    displayName: deriveTeamDisplay(value.players, value.displayName || ''),
    lastPlayed: teamRecency.get(key) || 0,
  })).filter(entry => entry.displayName).sort((a, b) => {
    const diff = b.lastPlayed - a.lastPlayed;
    if (diff) return diff;
    return entrySortFn(a.displayName, b.displayName);
  });

  const configureTeamSection = (selectId, inputIds, currentPlayers) => {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">-- Select saved pairing --</option>';
    teamEntries.forEach(entry => {
      const option = new Option(entry.displayName, entry.key);
      selectEl.add(option);
    });

    const currentKey = buildTeamKey(currentPlayers);
    if (currentKey && teamsObj[currentKey]) {
      selectEl.value = currentKey;
    } else {
      selectEl.value = "";
    }

    selectEl.onchange = () => {
      const chosen = teamsObj[selectEl.value];
      if (!chosen) return;
      const chosenPlayers = ensurePlayersArray(chosen.players);
      inputIds.forEach((id, idx) => {
        const inputEl = document.getElementById(id);
        if (inputEl) inputEl.value = chosenPlayers[idx] || "";
      });
    };

    inputIds.forEach((id, idx) => {
      const inputEl = document.getElementById(id);
      if (inputEl) inputEl.value = sanitizePlayerName(currentPlayers[idx] || "");
    });
  };

  // Check for pre-populated data from dealer pair selection
  const usPlayersToUse = window.prePopulatedTeamData?.usPlayers || ensurePlayersArray(state.usPlayers);
  const demPlayersToUse = window.prePopulatedTeamData?.demPlayers || ensurePlayersArray(state.demPlayers);
  
  configureTeamSection("selectUsTeam", ["usPlayerOne", "usPlayerTwo"], usPlayersToUse);
  configureTeamSection("selectDemTeam", ["demPlayerOne", "demPlayerTwo"], demPlayersToUse);
  
  // Clear pre-populated data after use
  if (window.prePopulatedTeamData) {
    window.prePopulatedTeamData = null;
  }

  refreshPlayerSuggestions();
}
function handleTeamSelectionSubmit(e) {
  e.preventDefault();

  const usPlayers = ensurePlayersArray([
    document.getElementById("usPlayerOne")?.value,
    document.getElementById("usPlayerTwo")?.value,
  ]);
  const demPlayers = ensurePlayersArray([
    document.getElementById("demPlayerOne")?.value,
    document.getElementById("demPlayerTwo")?.value,
  ]);

  if (!usPlayers[0] || !usPlayers[1]) {
    alert("Please enter both player names for Team 'Us'.");
    return;
  }
  if (!demPlayers[0] || !demPlayers[1]) {
    alert("Please enter both player names for Team 'Dem'.");
    return;
  }
  if (usPlayers[0].toLowerCase() === usPlayers[1].toLowerCase()) {
    alert("Team 'Us' needs two different players.");
    return;
  }
  if (demPlayers[0].toLowerCase() === demPlayers[1].toLowerCase()) {
    alert("Team 'Dem' needs two different players.");
    return;
  }

  const usKey = buildTeamKey(usPlayers);
  const demKey = buildTeamKey(demPlayers);
  if (!usKey || !demKey) {
    alert("Problem building team combinations. Please check the names and try again.");
    return;
  }
  if (usKey === demKey) {
    alert("Both teams cannot have the same two players.");
    return;
  }

  addTeamIfNotExists(usPlayers, formatTeamDisplay(usPlayers));
  addTeamIfNotExists(demPlayers, formatTeamDisplay(demPlayers));
  updateState({ usPlayers, demPlayers });
  saveCurrentGameState();
  closeTeamSelectionModal();
  if (pendingGameAction === "freeze") { confirmFreeze(); }
  else if (pendingGameAction === "save") { handleManualSaveGame(); }
  pendingGameAction = null;
}
function getDeviceDetails() {
  let appVersion = typeof APP_VERSION !== "undefined" ? APP_VERSION : "N/A";
  try {
      const verEl = document.querySelector("#versionBadge p");
      if (verEl && verEl.textContent.trim()) appVersion = verEl.textContent.trim();
  } catch (e) { console.warn("Could not get app version:", e); }

  let fbStatus = "N/A", fbUserId = "N/A", fbIsAnon = "N/A";
  if (window.firebaseAuth) {
      fbStatus = window.firebaseReady ? "Ready" : "Not Ready/Offline";
      if (window.firebaseAuth.currentUser) {
          fbUserId = window.firebaseAuth.currentUser.uid;
          fbIsAnon = String(window.firebaseAuth.currentUser.isAnonymous);
      }
  }
  return `User Agent: ${navigator.userAgent}\nScreen: ${window.innerWidth}x${window.innerHeight} (DPR: ${window.devicePixelRatio})\nApp Version: ${appVersion}\nDark Mode: ${document.documentElement.classList.contains('dark')}\nPro Mode: ${localStorage.getItem(PRO_MODE_KEY) === 'true'}\nFirebase: ${fbStatus} (User: ${fbUserId}, Anon: ${fbIsAnon})\nTimestamp: ${new Date().toISOString()}`;
}
function handleBugReportClick() {
    const recipient = "heinonenmh@gmail.com";
    const subject = "Rook Score App - Bug Report";
    const deviceDetails = getDeviceDetails();
    let appStateString = "Could not retrieve app state.";
    try {
      appStateString = [
        `Teams: ${state.usTeamName || "Us"} vs ${state.demTeamName || "Dem"}`,
        `Scores: Us ${state.rounds?.[state.rounds.length-1]?.runningTotals?.us ?? 0} - Dem ${state.rounds?.[state.rounds.length-1]?.runningTotals?.dem ?? 0}`,
        `Rounds played: ${state.rounds?.length ?? 0}`,
        `Game Over: ${state.gameOver ? "Yes" : "No"}`,
        `Winner: ${state.winner || "N/A"}`,
        `Victory Method: ${state.victoryMethod || "N/A"}`
      ].join('\n');
    } catch (e) {
      appStateString = `Error summarizing state: ${e.message}`;
    }
    const body = `Please describe the bug:\n[ ** Enter Description Here ** ]\n\n--- Device & App Info ---\n${deviceDetails}\n\n--- App State ---\n${appStateString}\n\n(Review before sending)`;
    const mailtoLink = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (mailtoLink.length > 2000) {
        alert("Bug report details are very long. Please copy the following details manually into your email client if the body is incomplete.");
        console.log("--- COPY BUG REPORT DETAILS BELOW ---");
        console.log(body); // Log to console as fallback
    }
    window.location.href = mailtoLink;
}
