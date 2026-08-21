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
            <button type="button" onclick="closeProbabilityModal()" class="text-gray-500 dark:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 rounded-lg">
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
  const labelUs = state.usTeamName || "Us";
  const labelDem = state.demTeamName || "Dem";
  const modelSnapshot = getModelProbabilitySnapshotForState(
    state,
    probabilityContext.model,
    probabilityContext.personalization,
    games,
  );

  return generateComplexProbabilityBreakdown(
    scoreDiff,
    roundsPlayed,
    labelUs,
    labelDem,
    winProb,
    games,
    currentScores,
    probabilityContext,
    modelSnapshot
  );
}

function generateComplexProbabilityBreakdown(scoreDiff, roundsPlayed, labelUs, labelDem, winProb, historicalGames, currentScores, probabilityContext, modelSnapshot) {
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
    probabilityContext?.personalization || null,
    games,
  );
  const modelProbUs = snapshot.modelProbUs;
  const baseModelProbUs = snapshot.baseModelProbUs;
  const personalizationRecord = snapshot.personalizationRecord;
  const personalizationActive = snapshot.personalizationActive;
  const effectiveModel = probabilityContext?.model || getActiveRuntimeModel();
  const usesEmpiricalBlend = effectiveModel?.metadata?.empiricalBlendEnabled !== false;
  const historicalContributes = usesEmpiricalBlend && beta > 0;
  const modelContributes = !usesEmpiricalBlend || beta < 1;
  const personalizationContributes = modelContributes && personalizationActive;
  const hierarchicalPrior = snapshot.hierarchicalPlayerPrior;
  const hierarchicalContributes = modelContributes && snapshot.hierarchicalPlayerPriorActive;
  const bucketRange = getBucketRange(bucketedScore);
  const empiricalWeight = Math.round(beta * 100);
  const modelWeight = Math.round((1 - beta) * 100);
  const empiricalPercent = Math.round(empirical * 100);
  const modelPercent = Math.round(modelProbUs * 100);
  const modelLabel = personalizationContributes
    ? "Personalized model"
    : hierarchicalContributes
      ? "Player-adjusted model"
      : "Regression model";
  const methodLabel = historicalContributes
    ? (modelContributes ? `Saved-game history + ${modelLabel.toLowerCase()}` : "Saved-game history")
    : modelLabel;

  const estimateAnalysis = (() => {
    if (!historicalContributes) {
      return {
        title: "Model Estimate",
        source: `100% ${modelLabel}`,
        input: `Current estimate: ${winProb.us.toFixed(1)}% for ${labelUsDisplay}`,
        detail: hierarchicalContributes
          ? "Uses the current score and bid context, then adjusts for each player's prior results and opponent strength."
          : "Uses the current score, round, recent score movement, and latest bid context.",
      };
    }

    if (!modelContributes) {
      return {
        title: "Saved-Game Estimate",
        source: "100% Saved-game history",
        input: `Historical result: ${empiricalPercent}% for ${labelUsDisplay} -> ${winProb.us.toFixed(1)}%`,
        detail: `Based on ${totalObs} comparable saved rounds.`,
      };
    }

    return {
      title: "Probability Blend",
      source: `${empiricalWeight}% Saved-game history + ${modelWeight}% ${modelLabel}`,
      input: `${empiricalPercent}% history + ${modelPercent}% model -> ${winProb.us.toFixed(1)}%`,
      detail: `Based on ${totalObs} comparable saved rounds. Saved history gains influence as more matches are recorded.`,
    };
  })();

  const personalizationAnalysis = personalizationContributes ? (() => {
    const record = normalizePersonalizationRecord(personalizationRecord);
    if (!record) return null;
    const updatedAtMs = Date.parse(record.updatedAt || "");
    const updatedAtText = Number.isFinite(updatedAtMs) ? formatTimestamp(updatedAtMs, "Unknown") : "Unknown";
    return {
      detail: `${record.gameSamples} games / ${record.roundSamples} rounds • Updated ${updatedAtText}`,
      effectText: `Base model: ${Math.round(baseModelProbUs * 100)}% -> Personalized: ${Math.round(modelProbUs * 100)}%`,
    };
  })() : null;

  const hierarchicalAnalysis = hierarchicalContributes ? {
    detail: `${hierarchicalPrior.historyGames} prior games • ${hierarchicalPrior.playersWithHistory} of 4 current players have history`,
    effectText: `State model: ${Math.round(baseModelProbUs * 100)}% -> Player-adjusted: ${Math.round(modelProbUs * 100)}%`,
  } : null;

  const activeEngineExplanation = [
    modelContributes
      ? `<p>• <strong>Current game:</strong> Reads the score after round ${roundsPlayed}, the stage of the game, recent score movement, and the latest bid context.</p>`
      : `<p>• <strong>Current game:</strong> Matches the score after round ${roundsPlayed} with comparable saved situations.</p>`,
    modelContributes
      ? `<p>• <strong>Model estimate:</strong> A pretrained model uses those details to estimate each team's chance of winning.</p>`
      : "",
    historicalContributes
      ? `<p>• <strong>Saved-game history:</strong> Comparable moments from completed games saved on this device contribute to this estimate.</p>`
      : "",
    personalizationContributes
      ? `<p>• <strong>Personalization:</strong> A locally learned adjustment is currently refining the model estimate for your games.</p>`
      : "",
    hierarchicalContributes
      ? `<p>• <strong>Player strength:</strong> Prior results are shrunk toward even odds and adjusted for the strength of partners and opponents.</p>`
      : "",
    historicalContributes && modelContributes
      ? `<p>• <strong>Final result:</strong> The displayed probability blends the model estimate with the matching saved-game results.</p>`
      : `<p>• <strong>Final result:</strong> The displayed probability comes from the ${historicalContributes ? "matching saved-game results" : "model estimate"}.</p>`,
  ].filter(Boolean).join("\n");

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
          Method: ${escapeHtmlValue(methodLabel)}
        </div>
      </div>

      <!-- Current Situation -->
      <div class="space-y-3">
        <h3 class="font-semibold text-gray-800 dark:text-white">Current Situation</h3>

        <div class="bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Current Score</div>
            <div class="text-sm text-blue-700 dark:text-blue-300 font-medium">Round ${roundsPlayed}</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            ${currentScores.us} - ${currentScores.dem}
            ${Math.abs(scoreDiff) > 0 ? `(${Math.abs(scoreDiff)} point ${leadLabelDisplay} lead)` : '(Tied)'}
          </div>
        </div>
      </div>

      <!-- Statistical Analysis -->
      <div class="space-y-3">
        <h3 class="font-semibold text-gray-800 dark:text-white">Statistical Analysis</h3>

        ${historicalContributes ? `
        <div class="bg-gradient-to-r from-green-50 to-green-100 dark:from-green-900/30 dark:to-green-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Saved-Game Matches</div>
            <div class="text-sm text-green-700 dark:text-green-300 font-medium">${empiricalPercent}% ${labelUsDisplay} win rate</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            ${totalObs} comparable saved rounds
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Round ${roundsPlayed} • ${scoreDiff === 0 ? "Tied score" : `${leadLabelDisplay} ahead by ${escapeHtmlValue(bucketRange)} points`}
          </div>
        </div>
        ` : ""}

        <div class="bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/30 dark:to-purple-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">${escapeHtmlValue(estimateAnalysis.title)}</div>
            <div class="text-sm text-purple-700 dark:text-purple-300 font-medium">${escapeHtmlValue(estimateAnalysis.source)}</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            ${estimateAnalysis.input}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ${escapeHtmlValue(estimateAnalysis.detail)}
          </div>
        </div>

        ${personalizationAnalysis ? `
        <div class="bg-gradient-to-r from-amber-50 to-amber-100 dark:from-amber-900/30 dark:to-amber-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Per-User Calibration</div>
            <div class="text-sm text-amber-700 dark:text-amber-300 font-medium">Active</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            ${escapeHtmlValue(personalizationAnalysis.detail)}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ${escapeHtmlValue(personalizationAnalysis.effectText)}
          </div>
        </div>
        ` : ""}

        ${hierarchicalAnalysis ? `
        <div class="bg-gradient-to-r from-amber-50 to-amber-100 dark:from-amber-900/30 dark:to-amber-800/30 rounded-lg p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="font-medium text-gray-700 dark:text-gray-300">Player Strength Adjustment</div>
            <div class="text-sm text-amber-700 dark:text-amber-300 font-medium">Active</div>
          </div>
          <div class="text-sm text-gray-600 dark:text-gray-400">
            ${escapeHtmlValue(hierarchicalAnalysis.detail)}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ${escapeHtmlValue(hierarchicalAnalysis.effectText)}
          </div>
        </div>
        ` : ""}
      </div>

      <!-- How It Works -->
      <div class="border-t border-gray-200 dark:border-gray-700 pt-3">
        <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <h4 class="font-medium text-gray-800 dark:text-white mb-2">How the Win Probability Engine Works</h4>
          <div class="text-xs text-gray-600 dark:text-gray-400 space-y-1">
            ${activeEngineExplanation}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">
            The estimate updates after each completed round.
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
const SAME_ORIGIN_BUG_REPORT_URL = "/api/bug-report";
const VERCEL_BUG_REPORT_URL = "https://rook-score.vercel.app/api/bug-report";
const BUG_REPORT_GITHUB_PAGES_HOSTNAMES = new Set(["marvj69.github.io"]);
const BUG_REPORT_TIMEOUT_MS = 15000;
let activeBugReportAbortController = null;

function getBugReportUrl() {
  if (typeof window === "undefined" || !window.location) return SAME_ORIGIN_BUG_REPORT_URL;
  return BUG_REPORT_GITHUB_PAGES_HOSTNAMES.has(window.location.hostname)
    ? VERCEL_BUG_REPORT_URL
    : SAME_ORIGIN_BUG_REPORT_URL;
}

function getBugReportAppVersion() {
  let appVersion = typeof APP_VERSION !== "undefined" ? APP_VERSION : "N/A";
  try {
    const versionElement = document.querySelector("#versionBadge p");
    if (versionElement?.textContent?.trim()) appVersion = versionElement.textContent.trim();
  } catch (error) {
    console.warn("Could not read the app version for diagnostics:", error);
  }
  return appVersion;
}

function getBugReportDiagnostics() {
  const rounds = Array.isArray(state?.rounds) ? state.rounds : [];
  const latestTotals = rounds.at(-1)?.runningTotals || state?.startingTotals || {};
  const firebaseUser = window.firebaseAuth?.currentUser || null;
  const locationOrigin = typeof window.location?.origin === "string" ? window.location.origin : "";
  const locationPath = typeof window.location?.pathname === "string" ? window.location.pathname : "";
  const displayMode = window.matchMedia?.("(display-mode: standalone)")?.matches
    || window.navigator?.standalone === true
    ? "standalone"
    : "browser";

  return {
    capturedAt: new Date().toISOString(),
    appVersion: getBugReportAppVersion(),
    page: `${locationOrigin}${locationPath}` || "N/A",
    userAgent: String(navigator.userAgent || "N/A").slice(0, 500),
    viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
    devicePixelRatio: Number(window.devicePixelRatio) || 1,
    displayMode,
    online: navigator.onLine !== false,
    theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
    proMode: localStorage.getItem(PRO_MODE_KEY) === "true",
    firebase: {
      status: window.firebaseReady ? "ready" : "not-ready-or-offline",
      signedIn: Boolean(firebaseUser),
      anonymous: firebaseUser ? Boolean(firebaseUser.isAnonymous) : null,
    },
    game: {
      roundsPlayed: rounds.length,
      scores: {
        us: Number(latestTotals.us) || 0,
        dem: Number(latestTotals.dem) || 0,
      },
      gameOver: Boolean(state?.gameOver),
      winner: state?.winner === "us" || state?.winner === "dem" ? state.winner : null,
      victoryMethod: typeof state?.victoryMethod === "string"
        ? state.victoryMethod.slice(0, 80)
        : null,
    },
  };
}

function createBugReportId() {
  if (typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  const randomPart = Math.random().toString(36).slice(2, 12);
  return `${Date.now().toString(36)}-${randomPart}`;
}

function setBugReportStatus(message, tone = "error") {
  const statusElement = document.getElementById("bugReportStatus");
  if (!statusElement) return;
  const toneClasses = tone === "info"
    ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
    : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300";
  statusElement.className = `rounded-xl px-3 py-2.5 text-sm ${toneClasses}`;
  statusElement.textContent = message;
}

function resetBugReportForm() {
  const form = document.getElementById("bugReportForm");
  form?.reset();
  form?.classList.remove("hidden");
  document.getElementById("bugReportSuccess")?.classList.add("hidden");
  document.getElementById("bugReportStatus")?.classList.add("hidden");
  const diagnosticsCheckbox = document.getElementById("bugReportIncludeDiagnostics");
  if (diagnosticsCheckbox) diagnosticsCheckbox.checked = true;
  const submitButton = document.getElementById("bugReportSubmitButton");
  if (submitButton) {
    submitButton.disabled = false;
    const label = submitButton.querySelector("span");
    if (label) label.textContent = "Send Report";
  }
}

function openBugReportModal() {
  closeModal("aboutModal");
  resetBugReportForm();
  openModal("bugReportModal");
}

function closeBugReportModal() {
  activeBugReportAbortController?.abort();
  activeBugReportAbortController = null;
  closeModal("bugReportModal");
}

function validateBugReportForm(form) {
  const summaryInput = form.elements.namedItem("summary");
  const descriptionInput = form.elements.namedItem("description");
  const contactEmailInput = form.elements.namedItem("contactEmail");
  const summary = String(summaryInput?.value || "").trim();
  const description = String(descriptionInput?.value || "").trim();
  const contactEmail = String(contactEmailInput?.value || "").trim();

  summaryInput?.setCustomValidity(summary ? "" : "Please add a short summary.");
  descriptionInput?.setCustomValidity(
    description.length >= 10 ? "" : "Please add at least 10 characters describing what happened.",
  );
  contactEmailInput?.setCustomValidity(
    !contactEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)
      ? ""
      : "Enter a valid email address or leave this blank.",
  );

  return typeof form.reportValidity !== "function" || form.reportValidity();
}

async function handleBugReportSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget || document.getElementById("bugReportForm");
  if (!form || !validateBugReportForm(form)) return false;

  const submitButton = document.getElementById("bugReportSubmitButton");
  const submitLabel = submitButton?.querySelector("span");
  if (submitButton?.disabled) return false;
  if (navigator.onLine === false) {
    setBugReportStatus("You appear to be offline. Your report is still here—reconnect and try again.");
    return false;
  }

  const formData = new FormData(form);
  const payload = {
    reportId: createBugReportId(),
    category: String(formData.get("category") || ""),
    summary: String(formData.get("summary") || "").trim(),
    description: String(formData.get("description") || "").trim(),
    steps: String(formData.get("steps") || "").trim(),
    contactEmail: String(formData.get("contactEmail") || "").trim(),
    website: String(formData.get("website") || ""),
    diagnostics: formData.get("includeDiagnostics") ? getBugReportDiagnostics() : null,
  };

  if (submitButton) submitButton.disabled = true;
  if (submitLabel) submitLabel.textContent = "Sending…";
  setBugReportStatus("Sending your report securely…", "info");

  const abortController = new AbortController();
  activeBugReportAbortController = abortController;
  const timeoutId = setTimeout(() => abortController.abort(), BUG_REPORT_TIMEOUT_MS);

  try {
    const response = await fetch(getBugReportUrl(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = response.status === 429
        ? "Too many reports were sent recently. Please wait a few minutes and try again."
        : result.error || "Your report could not be sent right now. Please try again.";
      throw Object.assign(new Error(message), { isExpected: true });
    }

    form.classList.add("hidden");
    document.getElementById("bugReportSuccess")?.classList.remove("hidden");
    return true;
  } catch (error) {
    if (activeBugReportAbortController !== abortController) return false;
    const message = error.isExpected
      ? error.message
      : error.name === "AbortError"
        ? "Sending took too long. Your report is still here—please try again."
        : "Your report could not be sent right now. Your details are still here so you can try again.";
    setBugReportStatus(message);
    return false;
  } finally {
    clearTimeout(timeoutId);
    if (activeBugReportAbortController === abortController) {
      activeBugReportAbortController = null;
    }
    if (submitButton) submitButton.disabled = false;
    if (submitLabel) submitLabel.textContent = "Send Report";
  }
}
