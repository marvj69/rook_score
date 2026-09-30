"use strict";

// Loaded when the win-probability explanation opens.
function generateProbabilityBreakdown() {
  if (!state.showWinProbability || !state.rounds || state.rounds.length === 0 || state.gameOver) {
    return "";
  }

  const storedGames = getLocalStorage("savedGames");
  const games = Array.isArray(storedGames) ? storedGames : [];
  const context = getProbabilityContext(games);
  const lastRound = state.rounds[state.rounds.length - 1];
  const scores = sanitizeTotals(lastRound?.runningTotals);
  const snapshot = getModelProbabilitySnapshotForState(state, context.model, context.personalization, games);

  return generateComplexProbabilityBreakdown(
    scores.us - scores.dem,
    state.rounds.length,
    state.usTeamName || "Us",
    state.demTeamName || "Dem",
    getWinProbability(state, games, context),
    games,
    scores,
    context,
    snapshot,
  );
}

function generateComplexProbabilityBreakdown(scoreDiff, roundsPlayed, labelUs, labelDem, winProb, historicalGames, currentScores, probabilityContext, modelSnapshot) {
  const usName = escapeHtmlValue(labelUs || "Us");
  const demName = escapeHtmlValue(labelDem || "Dem");
  const model = probabilityContext?.model || getActiveRuntimeModel();
  const games = Array.isArray(historicalGames) ? historicalGames : [];
  const snapshot = modelSnapshot || getModelProbabilitySnapshotForState(
    state, model, probabilityContext?.personalization || null, games,
  );
  const percent = value => `${(parseFiniteNumber(value, 0.5) * 100).toFixed(1)}%`;
  const scores = sanitizeTotals(currentScores);
  const roundCount = Math.max(1, Math.trunc(parseFiniteNumber(roundsPlayed, 1)));
  const features = snapshot.features;
  const prior = snapshot.hierarchicalPlayerPrior;
  const usesPlayerPrior = model.schemaVersion === 2 && Boolean(model.hierarchicalPlayerPrior);
  const playerAdjustmentActive = snapshot.hierarchicalPlayerPriorActive && !snapshot.personalizationActive;

  // Read the same legacy blend as the calculator only when that model uses it.
  // The current model never builds or displays this table.
  let historicalWeight = 0;
  let historicalProbability = 0.5;
  let matchingRounds = 0;
  if (model.metadata?.empiricalBlendEnabled !== false) {
    const cacheKey = getProbabilityCacheKey(games);
    if (!PROB_CACHE.has(cacheKey)) PROB_CACHE.set(cacheKey, buildProbabilityIndex(games));
    const historyCounts = PROB_CACHE.get(cacheKey)[`${roundCount - 1}|${bucketScore(scoreDiff)}`] || { us: 1, dem: 1 };
    matchingRounds = historyCounts.us + historyCounts.dem - 2;
    historicalProbability = historyCounts.us / (historyCounts.us + historyCounts.dem);
    historicalWeight = Math.min(1, Math.log(matchingRounds + 1) / Math.log(31));
  }
  const modelContributes = historicalWeight < 1;
  const historyContributes = historicalWeight > 0;
  const personalizationContributes = modelContributes && snapshot.personalizationActive;
  const playerContributes = modelContributes && playerAdjustmentActive;
  const trainingGames = Math.max(0, Math.trunc(parseFiniteNumber(model.metadata?.games, 0)));
  const trainingRounds = Math.max(0, Math.trunc(parseFiniteNumber(model.metadata?.roundSamples, 0)));
  const featureNames = Array.isArray(model.featureSet) ? model.featureSet : MODEL_FEATURE_SET;
  const leadText = scoreDiff === 0
    ? "The score is tied."
    : `${scoreDiff > 0 ? usName : demName} leads by ${Math.abs(scoreDiff)} points.`;
  const sourceText = historyContributes
    ? (modelContributes ? "Game-position model and matching saved results" : "Matching saved results")
    : (playerContributes ? "Game position and saved player results" : "Game position");
  const simpleExplanation = historyContributes
    ? "It compares the recorded position with finished games in your library. Matching results gain more influence as more examples are available."
    : `It starts with a model learned from finished games, using the score and last completed hand.${usesPlayerPrior ? " Saved results for the named players can then adjust the estimate." : ""}`;

  const playerStatus = playerContributes
    ? `For this game, player history moves ${usName} from <strong>${percent(snapshot.baseModelProbUs)}</strong> to <strong>${percent(snapshot.modelProbUs)}</strong> before display rounding and limits.`
    : prior?.playersWithHistory > 0
      ? "Saved history is available, but the two sides' adjustments balance out. The game-position estimate stays the same."
      : "No player adjustment is contributing here. Only the recorded position contributes.";
  const playerSection = modelContributes && usesPlayerPrior ? `
    <section class="probability-detail" data-probability-step="players">
      <h4>2. Add what your saved games say about the players</h4>
      <p>With two named players on each side, the app combines their results from <strong>your saved-game library</strong>. Players with no history start neutral.</p>
      <p>Small records are pulled toward even odds. A second rating accounts for partners and opponents; regular partners are harder to distinguish.</p>
      <p class="probability-current-effect">${playerStatus}</p>
      ${prior?.playersWithHistory > 0 ? `<p class="probability-note">${prior.playersWithHistory} of the 4 current players have saved results. The opponent ratings use ${prior.historyGames} qualifying four-player games across your library.</p>` : ""}
      <p class="probability-note">Use consistent, distinct names to match records. Finished games update player history; app updates can change the position model.</p>
    </section>` : "";

  const legacySection = historyContributes ? `
    <section class="probability-detail" data-probability-step="history">
      <h4>Use matching saved positions</h4>
      <p>This model matches the recorded hand number and signed score gap in saved games. Gaps use 20-point bands, plus tied and 161+ bands.</p>
      <p><strong>${matchingRounds} matching positions</strong>, plus one starting win per side, give ${usName} a smoothed estimate of <strong>${percent(historicalProbability)}</strong>.</p>
      <p>History weight is <code>min(1, ln(matches + 1) / ln(31))</code>: zero initially, 100% at 30 matches. Here: <strong>${percent(historicalWeight)} history</strong> and <strong>${percent(1 - historicalWeight)} model</strong>.</p>
    </section>` : "";

  const personalizationSection = personalizationContributes ? `
    <section class="probability-detail" data-probability-step="personalization">
      <h4>Adjust the model to your saved results</h4>
      <p>Local calibration from your saved games changes ${usName} from <strong>${percent(snapshot.baseModelProbUs)}</strong> to <strong>${percent(snapshot.modelProbUs)}</strong> before any saved-position blend.</p>
    </section>` : "";

  const usesScoreTotals = featureNames.includes("diff_x_score_sum");
  const interactionExample = usesScoreTotals ? "lead × combined score" : "lead × last hand's point difference";
  const weightedScore = features ? featureNames.reduce((sum, name) => (
    sum + parseFiniteNumber(model.coefficients?.[name], 0) * parseFiniteNumber(features[name], 0)
  ), parseFiniteNumber(model.intercept, 0)) : null;
  const calibrationSlope = parseFiniteNumber(model.calibration?.slope, 1);
  const calibrationIntercept = parseFiniteNumber(model.calibration?.intercept, 0);
  const calibrationText = calibrationSlope === 1 && calibrationIntercept === 0
    ? "Calibration is neutral here (slope 1, offset 0), leaving the percentage unchanged."
    : `This model then calibrates those odds with slope ${calibrationSlope} and offset ${calibrationIntercept}.`;
  const mathSection = modelContributes ? `
    <details class="probability-math" data-probability-step="math">
      <summary tabindex="0">The math behind this estimate</summary>
      <div class="probability-math-body">
        <p>The ${featureNames.length} inputs include lead × hand index and ${interactionExample}. Weights act together; they are not percentage-point bonuses.</p>
        <p><code>z = intercept + sum(weight × input)</code><br><code>sigmoid(z) = 1 / (1 + exp(−z))</code></p>
        ${weightedScore !== null ? `<p>Here, <code>z = ${weightedScore.toFixed(4)}</code>, giving <strong>${percent(snapshot.rawModelProbUs)}</strong> for ${usName}.</p>` : ""}
        <p>Calibration operates on log-odds: <code>logit(p) = ln(p / (1 − p))</code>. ${escapeHtmlValue(calibrationText)}</p>
        ${usesPlayerPrior && !personalizationContributes ? `
        <p>Smoothed player win rate: <code>(wins + ${model.hierarchicalPlayerPrior.betaAlpha}) / (games + ${2 * model.hierarchicalPlayerPrior.betaAlpha})</code>. <code>W</code> compares the sides' average player log-odds; <code>R</code> compares their average opponent-adjusted ratings.</p>
        <p>Ratings fit four-player results with a penalty toward neutral. Correction: <code>c = ${model.hierarchicalPlayerPrior.playerWinLogOddsCoefficient} × W + ${model.hierarchicalPlayerPrior.opponentAdjustedCoefficient} × R</code>. Apply it as <code>p = sigmoid(logit(base) + c)</code>, not added percentage points.</p>
        <p>Here, <code>c = ${parseFiniteNumber(prior?.correction, 0).toFixed(4)}</code>. Zero leaves the base unchanged.</p>` : ""}
        ${personalizationContributes ? `<p>The local calibration applies <code>sigmoid(slope × logit(base) + offset)</code> using the active calibration learned from your saved games.</p>` : ""}
        ${historyContributes ? `<p>The final blend is <code>p = history weight × history estimate + (1 − history weight) × model estimate</code>.</p>` : ""}
        <p>Hand ${roundCount} uses index ${roundCount - 1}. Momentum is zero on the first hand, then measures the change in lead.</p>
      </div>
    </details>` : "";

  return `
    <div class="probability-explanation">
      <section class="probability-overview" data-probability-section="overview" aria-labelledby="probabilitySimpleTitle">
        <h3 id="probabilitySimpleTitle">The simple explanation</h3>
        <p>Win probability estimates each team's chance of <strong>winning the whole game</strong> after the last recorded hand.</p>
        <p>${simpleExplanation}</p>
        <p class="probability-example">A 70% estimate means about 7 wins in 10 similar games, if the model is accurate. The other side still has a 30% chance.</p>
      </section>

      <section class="probability-live" data-probability-section="estimate" aria-labelledby="probabilityLiveTitle">
        <h3 id="probabilityLiveTitle">The estimate right now</h3>
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div class="probability-team probability-team--us"><span>${usName}</span><strong>${winProb.us.toFixed(1)}%</strong></div>
          <div class="probability-team probability-team--dem"><span>${demName}</span><strong>${winProb.dem.toFixed(1)}%</strong></div>
        </div>
        <p>After hand ${roundCount}: <strong>${scores.us} – ${scores.dem}</strong>. ${leadText}</p>
        <p class="probability-note">Based on: ${sourceText}. The percentages add up to 100%.</p>
      </section>

      <section class="probability-depth" data-probability-section="details" aria-labelledby="probabilityDetailTitle">
        <h3 id="probabilityDetailTitle">How it is calculated</h3>
        ${modelContributes ? `
        <section class="probability-detail" data-probability-step="model">
          <h4>1. Read the recorded game position</h4>
          <p>A model called logistic regression turns these inputs into a starting estimate:</p>
          <dl class="probability-inputs">
            <div><dt>The score</dt><dd>Who leads and by how much${usesScoreTotals ? ", plus both teams' totals" : ""}. The same lead can mean different odds early and late.</dd></div>
            <div><dt>The stage of the game</dt><dd>Hands recorded, combined with the lead and recent result.</dd></div>
            <div><dt>The last hand</dt><dd>Each side's points and the change in lead. A set is reflected in the bidder's negative points.</dd></div>
            <div><dt>The last bid</dt><dd>Which side bid and how much, read from the completed hand.</dd></div>
          </dl>
          <p>${trainingGames ? `The current model was trained offline from <strong>${trainingGames.toLocaleString("en-US")} completed games${trainingRounds ? ` and ${trainingRounds.toLocaleString("en-US")} recorded game positions` : ""}</strong>. ` : ""}Learned weights connect these inputs to the winner, without simulating future hands.</p>
          <p class="probability-current-effect">The game-position model gives ${usName} <strong>${percent(snapshot.baseModelProbUs)}</strong> before any player or library adjustment.</p>
        </section>` : ""}
        ${playerSection}
        ${personalizationSection}
        ${legacySection}
        <section class="probability-detail" data-probability-step="display">
          <h4>${modelContributes ? (usesPlayerPrior || personalizationContributes || historyContributes ? "3. " : "2. ") : ""}Show the final percentage</h4>
          <p>${historyContributes ? "Combine saved results and model using the weights above. " : playerContributes || personalizationContributes ? "The adjusted model estimate becomes the final probability. " : "The game-position estimate becomes the final probability. "}Display limits are <strong>0.1% to 99.9%</strong>, rounded to one decimal. The other side is 100 minus the first, keeping the total at 100%.</p>
          <p>It updates after a scored hand, a correction, or changes to player names or saved history. The next bid and previewed points are ignored until recorded.</p>
        </section>
        <section class="probability-detail" data-probability-step="limits">
          <h4>How to read the number</h4>
          <p>This predicts the eventual winner, not the next bid. A tied score can still have unequal odds.</p>
          <p>It cannot see the cards, trump, kitty or future play. Dealer order, elapsed time and the “must win by making bid” setting are not model inputs. One decimal place is display precision, not a claim of accuracy.</p>
        </section>
        ${mathSection}
      </section>
    </div>
  `;
}
