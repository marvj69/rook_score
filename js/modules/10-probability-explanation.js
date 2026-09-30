"use strict";

// Loaded when the win-probability explanation opens.

// Groups the model inputs the way the written explanation does, so the
// "what is pulling the odds" chart reads in the same terms.
const PROBABILITY_FACTOR_GROUPS = [
  { label: "Score and lead", features: ["diff", "abs_diff", "lead_sign", "diff_x_abs_diff", "diff_x_score_sum", "lead_sign_x_score_sum", "target_pressure_diff"] },
  { label: "Stage of the game", features: ["round_idx", "diff_x_round", "momentum_x_round", "point_delta_x_round", "bidder_sign_x_round"] },
  { label: "Last hand", features: ["momentum", "abs_momentum", "point_delta", "diff_x_point_delta", "momentum_x_abs_momentum"] },
  { label: "Last bid", features: ["bid_amount", "bidding_team_sign", "bid_x_team", "diff_x_bid", "bidder_sign_x_abs_point_delta"] },
];
const PROBABILITY_CHART = { width: 320, height: 196, left: 34, right: 14, top: 24, bottom: 44 };

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
    buildProbabilityTimeline(games, context),
  );
}

// Replays the game one hand at a time through the same calculator the score
// screen uses, so the last point always equals the number shown in the app.
function buildProbabilityTimeline(games, context) {
  const rounds = Array.isArray(state.rounds) ? state.rounds : [];
  const points = [{ hand: 0, us: 0, dem: 0, prob: 50 }];
  rounds.forEach((round, index) => {
    const totals = sanitizeTotals(round?.runningTotals);
    const prefix = { ...state, rounds: rounds.slice(0, index + 1) };
    points.push({ hand: index + 1, us: totals.us, dem: totals.dem, prob: calculateWinProbability(prefix, games, context).us });
  });
  return points;
}

const probabilityShortName = (name, max = 16) => (String(name).length > max ? `${String(name).slice(0, max - 1)}…` : String(name));
const probabilityFixed = (value, digits = 1) => parseFiniteNumber(value, 0).toFixed(digits);
const probabilitySigned = (value, digits = 1) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;

function probabilityReadout(point, usName, demName) {
  const prob = parseFiniteNumber(point?.prob, 50);
  const hand = point.hand === 0 ? "Start" : `Hand ${point.hand}`;
  const signed = value => (value < 0 ? `−${Math.abs(value)}` : String(value));
  const score = `${signed(point.us)} – ${signed(point.dem)}`;
  const leader = Math.abs(prob - 50) < 0.05 ? `Even ${probabilityFixed(50)}%` : prob > 50 ? `${usName} ${probabilityFixed(prob)}%` : `${demName} ${probabilityFixed(100 - prob)}%`;
  return { hand, score, leader, side: prob > 50 ? "us" : prob < 50 ? "dem" : "even" };
}

// Center-out bar on a 0-100 track: grows right for Us, left for Dem.
function probabilityCenterBar(value, maxAbs) {
  const half = maxAbs > 0 ? Math.min(50, (Math.abs(value) / maxAbs) * 50) : 0;
  const left = value >= 0 ? 50 : 50 - half;
  return `<span class="probability-track" aria-hidden="true"><i class="probability-track-fill probability-track-fill--${value >= 0 ? "us" : "dem"}" style="left:${left.toFixed(2)}%;width:${half.toFixed(2)}%"></i></span>`;
}

function probabilitySplitBar(usPercent, usName, demName) {
  const us = Math.min(100, Math.max(0, parseFiniteNumber(usPercent, 50)));
  return `
    <div class="probability-split" role="img" aria-label="${usName} ${probabilityFixed(us)} percent, ${demName} ${probabilityFixed(100 - us)} percent">
      <span class="probability-split-us" style="width:${us.toFixed(2)}%"></span>
      <span class="probability-split-dem" style="width:${(100 - us).toFixed(2)}%"></span>
      <i class="probability-split-mid"></i>
    </div>`;
}

function probabilityRaceBars(scores, usName, demName) {
  const row = (side, name, total) => `
      <div class="probability-race-row">
        <span>${name}</span>
        <span class="probability-race-track" aria-hidden="true"><i class="probability-race-fill probability-race-fill--${side}" style="width:${Math.min(100, Math.max(0, total / 5)).toFixed(1)}%"></i></span>
        <b>${total}</b>
      </div>`;
  return `
    <div class="probability-race" aria-label="Score progress toward 500">
      <p class="probability-eyebrow">Race to 500</p>${row("us", usName, scores.us)}${row("dem", demName, scores.dem)}
    </div>`;
}

// 100 similar games: one dot each, Us first. Makes "62%" concrete.
function probabilityDotGrid(usPercent, usName, demName) {
  const usDots = Math.min(99, Math.max(1, Math.round(parseFiniteNumber(usPercent, 50))));
  let dots = "";
  for (let i = 0; i < 100; i++) {
    const cx = 6 + (i % 10) * 11.5;
    const cy = 6 + Math.floor(i / 10) * 11.5;
    dots += `<circle class="probability-dot probability-dot--${i < usDots ? "us" : "dem"}" cx="${cx}" cy="${cy}" r="4.3" style="animation-delay:${i * 7}ms"/>`;
  }
  return `
    <div class="probability-dots">
      <svg viewBox="0 0 120 120" role="img" aria-label="Of 100 similar games, ${usDots} go to ${usName} and ${100 - usDots} to ${demName}">${dots}</svg>
      <div class="probability-dots-key">
        <p><b class="probability-key-us">${usDots}</b> of 100 similar games go to <strong>${usName}</strong></p>
        <p><b class="probability-key-dem">${100 - usDots}</b> go to <strong>${demName}</strong></p>
        <p class="probability-note">If the model is accurate. Each dot is one imagined game.</p>
      </div>
    </div>`;
}

function probabilityTimelineChart(points, usName, demName, usShort, demShort) {
  const { width: W, height: H, left: L, right: R, top: T, bottom: B } = PROBABILITY_CHART;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const x = index => L + (points.length > 1 ? (index / (points.length - 1)) * plotW : 0);
  const y = prob => T + (1 - prob / 100) * plotH;
  const mid = y(50);
  const coords = points.map((point, index) => `${x(index).toFixed(1)},${y(point.prob).toFixed(1)}`);
  const line = `M${coords.join(" L")}`;
  const area = `M${x(0).toFixed(1)},${mid.toFixed(1)} L${coords.join(" L")} L${x(points.length - 1).toFixed(1)},${mid.toFixed(1)} Z`;
  const grid = [25, 50, 75].map(value => `
        <line class="probability-grid${value === 50 ? " probability-grid--mid" : ""}" x1="${L}" x2="${W - R}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"/>
        <text class="probability-axis" x="${L - 6}" y="${(y(value) + 3.5).toFixed(1)}" text-anchor="end">${value}%</text>`).join("");
  const step = Math.max(1, Math.ceil((points.length - 1) / 6));
  const xLabels = points.map((point, index) => (
    index === 0 || index === points.length - 1 || index % step === 0
      ? `<text class="probability-axis" x="${x(index).toFixed(1)}" y="${H - B + 14}" text-anchor="middle">${index === 0 ? "Start" : `#${index}`}</text>` : ""
  )).join("");
  const radius = points.length > 16 ? 2.4 : 3.6;
  const dots = points.map((point, index) => (
    index === 0 ? "" : `<circle class="probability-point probability-point--${point.prob >= 50 ? "us" : "dem"}" cx="${x(index).toFixed(1)}" cy="${y(point.prob).toFixed(1)}" r="${radius}"/>`
  )).join("");
  const data = points.map((point, index) => [x(index).toFixed(1), y(point.prob).toFixed(1), point.hand, point.us, point.dem, probabilityFixed(point.prob, 2)].join(",")).join(";");
  const lastIndex = points.length - 1;
  const readout = probabilityReadout(points[lastIndex], usName, demName);

  return `
    <div class="probability-chart" data-probability-chart="timeline" data-points="${data}" data-us-name="${usName}" data-dem-name="${demName}" tabindex="0" role="group" aria-label="Win probability after each hand. Use the left and right arrow keys to inspect a hand.">
      <div class="probability-readout" aria-live="polite">
        <strong data-readout="hand">${readout.hand}</strong>
        <span data-readout="score">${readout.score}</span>
        <em class="probability-readout-prob probability-readout-prob--${readout.side}" data-readout="leader">${readout.leader}</em>
      </div>
      <svg viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id="probabilityClipUs"><rect x="0" y="0" width="${W}" height="${mid.toFixed(1)}"/></clipPath>
          <clipPath id="probabilityClipDem"><rect x="0" y="${mid.toFixed(1)}" width="${W}" height="${H}"/></clipPath>
        </defs>
        <text class="probability-side-label probability-side-label--us" x="${L}" y="${T - 10}">▲ ${usShort} ahead</text>
        <text class="probability-side-label probability-side-label--dem" x="${L}" y="${H - 6}">▼ ${demShort} ahead</text>
        ${grid}
        <path class="probability-area probability-area--us" d="${area}" clip-path="url(#probabilityClipUs)"/>
        <path class="probability-area probability-area--dem" d="${area}" clip-path="url(#probabilityClipDem)"/>
        <path class="probability-line" d="${line}" pathLength="1"/>
        ${dots}
        <g class="probability-scrub" data-scrub>
          <line x1="${x(lastIndex).toFixed(1)}" x2="${x(lastIndex).toFixed(1)}" y1="${T}" y2="${H - B}"/>
          <circle cx="${x(lastIndex).toFixed(1)}" cy="${y(points[lastIndex].prob).toFixed(1)}" r="6"/>
        </g>
        ${xLabels}
      </svg>
    </div>`;
}

// One bar per hand: how far that hand moved Us's chance, in percentage points.
function probabilitySwingChart(points, usName, demName) {
  const { width: W, left: L, right: R } = PROBABILITY_CHART;
  const H = 76;
  const plotW = W - L - R;
  const deltas = points.slice(1).map((point, index) => ({ hand: point.hand, delta: point.prob - points[index].prob }));
  const maxAbs = Math.max(8, ...deltas.map(item => Math.abs(item.delta)));
  const mid = H / 2;
  const slot = plotW / Math.max(1, points.length - 1);
  const barWidth = Math.min(18, Math.max(3, slot * 0.6));
  const bars = deltas.map(item => {
    const cx = L + (item.hand / Math.max(1, points.length - 1)) * plotW;
    const height = Math.max(1.5, (Math.abs(item.delta) / maxAbs) * (mid - 6));
    const top = item.delta >= 0 ? mid - height : mid;
    return `<rect class="probability-swing-bar probability-swing-bar--${item.delta >= 0 ? "us" : "dem"}" x="${(cx - barWidth / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${height.toFixed(1)}" rx="2"><title>Hand ${item.hand}: ${probabilitySigned(item.delta)} points</title></rect>`;
  }).join("");
  const biggest = deltas.reduce((best, item) => (Math.abs(item.delta) > Math.abs(best.delta) ? item : best), deltas[0]);
  const biggestText = Math.abs(biggest.delta) < 0.05
    ? "No hand moved the odds."
    : `Biggest swing: hand ${biggest.hand}, ${probabilityFixed(Math.abs(biggest.delta))} points toward <strong>${biggest.delta > 0 ? usName : demName}</strong>.`;
  return `
    <div class="probability-swings" data-probability-chart="swings">
      <p class="probability-eyebrow">Change per hand</p>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Change in ${usName}'s win probability for each hand">
        <line class="probability-grid probability-grid--mid" x1="${L}" x2="${W - R}" y1="${mid}" y2="${mid}"/>
        <text class="probability-axis" x="${L - 6}" y="${mid + 3.5}" text-anchor="end">0</text>
        <text class="probability-axis" x="${L - 6}" y="12" text-anchor="end">${usName.length > 6 ? "▲" : `▲ ${usName}`}</text>
        <text class="probability-axis" x="${L - 6}" y="${H - 4}" text-anchor="end">${demName.length > 6 ? "▼" : `▼ ${demName}`}</text>
        ${bars}
      </svg>
      <p class="probability-note">${biggestText}</p>
    </div>`;
}

function probabilityStageChart(stages, usName) {
  const rows = stages.map((stage, index) => {
    const prob = Math.min(1, Math.max(0, stage.prob));
    const delta = index > 0 ? (prob - stages[index - 1].prob) * 100 : 0;
    return `
        <div class="probability-stage${stage.final ? " probability-stage--final" : ""}">
          <span class="probability-stage-label">${stage.label}</span>
          ${probabilityCenterBar(prob - 0.5, 0.5)}
          <b>${probabilityFixed(prob * 100)}%</b>
          <small>${index > 0 && Math.abs(delta) >= 0.05 ? `${probabilitySigned(delta)}` : ""}</small>
        </div>`;
  }).join("");
  return `
    <div class="probability-card" data-probability-chart="stages">
      <p class="probability-eyebrow">Chance for ${usName}, step by step</p>
      ${rows}
      <p class="probability-note">Bars grow from 50% toward the side that is ahead.</p>
    </div>`;
}

function probabilityFactorChart(model, features, featureNames, usName, demName) {
  const contribution = names => names.reduce((sum, name) => (
    featureNames.includes(name) ? sum + parseFiniteNumber(model.coefficients?.[name], 0) * parseFiniteNumber(features[name], 0) : sum
  ), 0);
  const claimed = new Set(PROBABILITY_FACTOR_GROUPS.flatMap(group => group.features));
  const groups = PROBABILITY_FACTOR_GROUPS.map(group => ({ label: group.label, value: contribution(group.features) }));
  const other = contribution(featureNames.filter(name => !claimed.has(name)));
  if (Math.abs(other) > 1e-9) groups.push({ label: "Other inputs", value: other });
  const intercept = parseFiniteNumber(model.intercept, 0);
  if (intercept !== 0) groups.unshift({ label: "Starting point", value: intercept });
  const total = groups.reduce((sum, group) => sum + group.value, 0);
  const maxAbs = Math.max(0.5, ...groups.map(group => Math.abs(group.value)), Math.abs(total));
  const row = (label, value, extra = "") => `
        <div class="probability-stage probability-stage--pull${extra}">
          <span class="probability-stage-label">${label}</span>
          ${probabilityCenterBar(value, maxAbs)}
          <b>${probabilitySigned(value, 2)}</b>
        </div>`;
  return `
    <div class="probability-card" data-probability-chart="factors">
      <p class="probability-eyebrow">What is pulling the odds</p>
      ${groups.map(group => row(group.label, group.value)).join("")}
      ${row("Combined pull", total, " probability-stage--final")}
      <p class="probability-note">Right of center favors ${usName}; left favors ${demName}. Numbers are the model's internal log-odds scale, before calibration. Inputs overlap, so read each group as a whole.</p>
    </div>`;
}

function generateComplexProbabilityBreakdown(scoreDiff, roundsPlayed, labelUs, labelDem, winProb, historicalGames, currentScores, probabilityContext, modelSnapshot, timeline = null) {
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
  const favored = Math.abs(winProb.us - 50) < 0.05 ? "" : winProb.us > 50 ? "us" : "dem";

  const playerStatus = playerContributes
    ? `For this game, player history moves ${usName} from <strong>${percent(snapshot.baseModelProbUs)}</strong> to <strong>${percent(snapshot.modelProbUs)}</strong> before display rounding and limits.`
    : prior?.playersWithHistory > 0
      ? "Saved history is available, but the two sides' adjustments balance out. The game-position estimate stays the same."
      : "No player adjustment is contributing here. Only the recorded position contributes.";
  const playerSection = modelContributes && usesPlayerPrior ? `
    <section class="probability-detail" data-probability-step="players">
      <h4><span class="probability-badge">2</span>Add what your saved games say about the players</h4>
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
      <div class="probability-weight" role="img" aria-label="${percent(historicalWeight)} saved history, ${percent(1 - historicalWeight)} model">
        <span class="probability-weight-history" style="width:${(historicalWeight * 100).toFixed(1)}%"></span><span class="probability-weight-model"></span>
      </div>
      <p class="probability-note probability-weight-key"><span>Saved history</span><span>Model</span></p>
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

  // Every stage that really contributes, in the order the calculator applies it.
  const stages = [];
  if (modelContributes) stages.push({ label: "Game position", prob: parseFiniteNumber(snapshot.baseModelProbUs, 0.5) });
  if (personalizationContributes || playerContributes) {
    stages.push({ label: personalizationContributes ? "Your calibration" : "Player history", prob: parseFiniteNumber(snapshot.modelProbUs, 0.5) });
  }
  if (historyContributes) stages.push({ label: "Saved results", prob: historicalProbability });
  stages.push({ label: "Shown", prob: winProb.us / 100, final: true });
  const stageChart = stages.length > 2 ? probabilityStageChart(stages, usName) : "";
  const factorChart = features && modelContributes ? probabilityFactorChart(model, features, featureNames, usName, demName) : "";
  const timelineSection = Array.isArray(timeline) && timeline.length > 1 ? `
      <section class="probability-card probability-timeline" data-probability-section="timeline" aria-labelledby="probabilityTimelineTitle">
        <h3 id="probabilityTimelineTitle">How the odds moved</h3>
        <p class="probability-note">Tap or drag across the chart to see any hand.</p>
        ${probabilityTimelineChart(timeline, usName, demName, escapeHtmlValue(probabilityShortName(labelUs || "Us")), escapeHtmlValue(probabilityShortName(labelDem || "Dem")))}
        ${probabilitySwingChart(timeline, usName, demName)}
      </section>` : "";

  return `
    <div class="probability-explanation">
      <section class="probability-live" data-probability-section="estimate" aria-labelledby="probabilityLiveTitle">
        <h3 id="probabilityLiveTitle">The estimate right now</h3>
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div class="probability-team probability-team--us"><span>${usName}</span><strong>${winProb.us.toFixed(1)}%</strong>${favored === "us" ? '<em class="probability-favored">Favored</em>' : ""}</div>
          <div class="probability-team probability-team--dem"><span>${demName}</span><strong>${winProb.dem.toFixed(1)}%</strong>${favored === "dem" ? '<em class="probability-favored">Favored</em>' : ""}</div>
        </div>
        ${probabilitySplitBar(winProb.us, usName, demName)}
        <p class="probability-hand-summary">After hand ${roundCount}: <strong>${scores.us} – ${scores.dem}</strong>. ${leadText}</p>
        ${probabilityRaceBars(scores, usName, demName)}
        <p class="probability-note">Based on: ${sourceText}. The percentages add up to 100%.</p>
      </section>

      <section class="probability-overview probability-card" data-probability-section="overview" aria-labelledby="probabilitySimpleTitle">
        <h3 id="probabilitySimpleTitle">The simple explanation</h3>
        <p>Win probability estimates each team's chance of <strong>winning the whole game</strong> after the last recorded hand.</p>
        <p>${simpleExplanation}</p>
        ${probabilityDotGrid(winProb.us, usName, demName)}
      </section>

      ${timelineSection}

      <section class="probability-depth" data-probability-section="details" aria-labelledby="probabilityDetailTitle">
        <h3 id="probabilityDetailTitle">How it is calculated</h3>
        ${stageChart}
        ${modelContributes ? `
        <section class="probability-detail" data-probability-step="model">
          <h4><span class="probability-badge">1</span>Read the recorded game position</h4>
          <p>A model called logistic regression turns these inputs into a starting estimate:</p>
          ${factorChart}
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
          <h4>${modelContributes ? `<span class="probability-badge">${usesPlayerPrior || personalizationContributes || historyContributes ? 3 : 2}</span>` : ""}Show the final percentage</h4>
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

// Makes the timeline chart scrubbable by touch, mouse or arrow keys.
function enhanceProbabilityExplanation(root) {
  const chart = root?.querySelector?.('[data-probability-chart="timeline"]');
  const svg = chart?.querySelector("svg");
  if (!chart || !svg) return;
  const points = chart.dataset.points.split(";").map(entry => {
    const [px, py, hand, us, dem, prob] = entry.split(",").map(Number);
    return { px, py, hand, us, dem, prob };
  });
  const usName = chart.dataset.usName;
  const demName = chart.dataset.demName;
  const scrub = svg.querySelector("[data-scrub]");
  const viewWidth = svg.viewBox.baseVal.width;
  let current = points.length - 1;

  const show = index => {
    current = Math.min(points.length - 1, Math.max(0, index));
    const point = points[current];
    const readout = probabilityReadout(point, usName, demName);
    scrub.querySelector("line").setAttribute("x1", point.px);
    scrub.querySelector("line").setAttribute("x2", point.px);
    scrub.querySelector("circle").setAttribute("cx", point.px);
    scrub.querySelector("circle").setAttribute("cy", point.py);
    chart.querySelector('[data-readout="hand"]').textContent = readout.hand;
    chart.querySelector('[data-readout="score"]').textContent = readout.score;
    const leader = chart.querySelector('[data-readout="leader"]');
    leader.textContent = readout.leader;
    leader.className = `probability-readout-prob probability-readout-prob--${readout.side}`;
  };
  const fromPointer = event => {
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const x = ((event.clientX - box.left) / box.width) * viewWidth;
    let nearest = 0;
    points.forEach((point, index) => {
      if (Math.abs(point.px - x) < Math.abs(points[nearest].px - x)) nearest = index;
    });
    show(nearest);
  };

  chart.addEventListener("pointerdown", event => {
    if (event.pointerType !== "mouse") chart.setPointerCapture?.(event.pointerId);
    fromPointer(event);
  });
  chart.addEventListener("pointermove", event => {
    if (event.buttons || event.pointerType === "mouse") fromPointer(event);
  });
  chart.addEventListener("keydown", event => {
    const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "Home" ? -points.length : event.key === "End" ? points.length : 0;
    if (!step) return;
    event.preventDefault();
    show(current + step);
  });
}
