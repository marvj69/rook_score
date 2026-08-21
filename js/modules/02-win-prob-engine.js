"use strict";

// --- Win‑probability engine -------------------------------------------

const RUNTIME_MODEL_PATH = "./js/model_runtime_v2.json";
const PROBABILITY_PERSONALIZATION_KEY = "probabilityPersonalizationV1";
const PROBABILITY_PERSONALIZATION_SCHEMA_VERSION = 1;
const PERSONALIZATION_MIN_GAMES = 10;
const PERSONALIZATION_MIN_ROUNDS = 60;
const PERSONALIZATION_LR = 0.03;
const PERSONALIZATION_EPOCHS = 1600;
const PERSONALIZATION_L2 = 1e-3;
const PERSONALIZATION_MIN_IMPROVEMENT = 1e-4;
const PERSONALIZATION_MIN_SLOPE = 0.25;
const PERSONALIZATION_MAX_SLOPE = 3.5;
const PERSONALIZATION_MAX_ABS_INTERCEPT = 2.5;

const LEGACY_MODEL_FEATURE_SET = Object.freeze([
  "diff",
  "round_idx",
  "momentum",
  "bid_amount",
  "bidding_team_sign",
  "point_delta",
  "abs_diff",
  "abs_momentum",
  "diff_x_round",
  "point_delta_x_round",
  "bid_x_team",
  "diff_x_point_delta",
  "momentum_x_round",
  "lead_sign",
]);

const MODEL_FEATURE_SET = Object.freeze([
  "diff",
  "momentum",
  "bidding_team_sign",
  "point_delta",
  "diff_x_round",
  "point_delta_x_round",
  "bid_x_team",
  "momentum_x_round",
  "lead_sign",
  "diff_x_abs_diff",
  "momentum_x_abs_momentum",
  "diff_x_score_sum",
  "lead_sign_x_score_sum",
  "target_pressure_diff",
  "diff_x_bid",
  "bidder_sign_x_abs_point_delta",
  "bidder_sign_x_round",
]);

const SUPPORTED_MODEL_FEATURES = new Set([
  ...LEGACY_MODEL_FEATURE_SET,
  ...MODEL_FEATURE_SET,
]);

const FALLBACK_RUNTIME_MODEL = Object.freeze({
  schemaVersion: 2,
  modelId: "prod-432g-2777r-63ea9bf3-hier-v2",
  featureSet: [...MODEL_FEATURE_SET],
  intercept: 0,
  coefficients: {
    diff: 0.010160915989335243,
    momentum: -0.00221923785135143,
    bidding_team_sign: -0.7517611772780889,
    point_delta: 0.001545385931995299,
    diff_x_round: 4.804561549038419e-06,
    point_delta_x_round: 3.4232473772779214e-05,
    bid_x_team: 0.005319098297900099,
    momentum_x_round: 3.4232473772779214e-05,
    lead_sign: -0.18721698502684647,
    diff_x_abs_diff: -1.3739440446480084e-06,
    momentum_x_abs_momentum: 6.092703472996122e-06,
    diff_x_score_sum: 3.0242533832366335e-06,
    lead_sign_x_score_sum: 0.00044410681303124464,
    target_pressure_diff: -0.004257452492109581,
    diff_x_bid: -4.896794125162152e-05,
    bidder_sign_x_abs_point_delta: 0.0009991705997680564,
    bidder_sign_x_round: -0.012837195999746604,
  },
  calibration: {
    type: "platt",
    slope: 1,
    intercept: 0,
  },
  hierarchicalPlayerPrior: {
    type: "beta-plus-bradley-terry",
    betaAlpha: 12,
    playerWinLogOddsCoefficient: 0.5,
    opponentAdjustedL2: 0.05,
    opponentAdjustedCoefficient: 0.25,
    optimizer: "cyclic-coordinate-newton",
    maximumSweeps: 60,
    convergenceTolerance: 1e-8,
  },
  metadata: {
    generatedAt: "2026-08-21T00:04:26.827558Z",
    games: 432,
    roundSamples: 2777,
    normalizedInputSha256: "63ea9bf3abc405c230f30c9a942ffe18a8ec2160b77c989515ff0882958a33d7",
    empiricalBlendEnabled: false,
    legacyPersonalizationEnabled: false,
    selection: "rolling-origin state model plus library-local hierarchical player prior; state coefficients refit on all valid games after holdout evaluation",
  },
});

const RUNTIME_MODEL_STATE = {
  model: FALLBACK_RUNTIME_MODEL,
};
let runtimeModelLoadPromise = null;
const PERSONALIZATION_STATE_CACHE = { key: null, value: null };
const PROBABILITY_GAMES_HASH_CACHE = typeof WeakMap === "function" ? new WeakMap() : null;
const PLAYER_STRENGTH_CACHE = typeof WeakMap === "function" ? new WeakMap() : null;

const scheduleIdleWork = typeof requestIdleCallback === "function"
  ? (callback) => requestIdleCallback(callback, { timeout: 1200 })
  : (callback) => setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 0);
let pendingPersonalizationRefreshHandle = null;
let pendingPersonalizationRefresh = null;

function createNeutralPersonalizationRecord(model, gamesHash, dataset) {
  return {
    schemaVersion: PROBABILITY_PERSONALIZATION_SCHEMA_VERSION,
    modelId: model.modelId,
    slope: 1,
    intercept: 0,
    roundSamples: dataset.roundSamples,
    gameSamples: dataset.gameSamples,
    gamesHash,
    updatedAt: new Date().toISOString(),
    baseLogLoss: 0,
    personalizedLogLoss: 0,
  };
}

function parseFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampProbability(prob) {
  const num = parseFiniteNumber(prob, 0.5);
  if (num <= 1e-6) return 1e-6;
  if (num >= 1 - 1e-6) return 1 - 1e-6;
  return num;
}

function safeSigmoid(z) {
  const x = parseFiniteNumber(z, 0);
  if (x >= 0) {
    const expNeg = Math.exp(-Math.min(x, 60));
    return 1 / (1 + expNeg);
  }
  const expPos = Math.exp(Math.max(x, -60));
  return expPos / (1 + expPos);
}

function probabilityToLogit(prob) {
  const clipped = clampProbability(prob);
  return Math.log(clipped / (1 - clipped));
}

function applyPlattCalibration(prob, slope, intercept) {
  const logit = probabilityToLogit(prob);
  const calibratedLogit = parseFiniteNumber(slope, 1) * logit + parseFiniteNumber(intercept, 0);
  return safeSigmoid(calibratedLogit);
}

function toDisplayProbabilityPercents(probUs) {
  const usPercentRaw = clampProbability(probUs) * 100;
  const usPercentBounded = Math.min(99.9, Math.max(0.1, usPercentRaw));
  const us = +usPercentBounded.toFixed(1);
  const dem = +(100 - us).toFixed(1);
  return { us, dem };
}

function clearWinProbabilityCache() {
  WIN_PROB_CACHE.key = null;
  WIN_PROB_CACHE.value = null;
}

function clearPersonalizationStateCache() {
  PERSONALIZATION_STATE_CACHE.key = null;
  PERSONALIZATION_STATE_CACHE.value = null;
}

function invalidateProbabilityCachesForGames(games = null) {
  PROB_CACHE.clear();
  clearWinProbabilityCache();
  clearPersonalizationStateCache();
  if (games && typeof games === "object" && PROBABILITY_GAMES_HASH_CACHE) {
    PROBABILITY_GAMES_HASH_CACHE.delete(games);
  }
  if (games && typeof games === "object" && PLAYER_STRENGTH_CACHE) {
    PLAYER_STRENGTH_CACHE.delete(games);
  }
}

function getActiveRuntimeModel() {
  return RUNTIME_MODEL_STATE.model || FALLBACK_RUNTIME_MODEL;
}

function normalizeRuntimeModelArtifact(raw) {
  if (!raw || typeof raw !== "object") return null;
  const schemaVersion = Number(raw.schemaVersion);
  if (schemaVersion !== 1 && schemaVersion !== 2) return null;

  const modelId = typeof raw.modelId === "string" ? raw.modelId.trim() : "";
  const featureSet = Array.isArray(raw.featureSet) ? raw.featureSet.map(String) : [];
  const expectedFeatureSet = schemaVersion === 2 ? MODEL_FEATURE_SET : LEGACY_MODEL_FEATURE_SET;
  const hasExpectedFeatures = expectedFeatureSet.every(name => featureSet.includes(name));
  const hasOnlySupportedFeatures = featureSet.every(name => SUPPORTED_MODEL_FEATURES.has(name));
  if (!modelId || !hasExpectedFeatures || !hasOnlySupportedFeatures) return null;

  const intercept = parseFiniteNumber(raw.intercept, NaN);
  if (!Number.isFinite(intercept)) return null;

  const coefficients = {};
  for (const featureName of featureSet) {
    const coeff = parseFiniteNumber(raw.coefficients?.[featureName], NaN);
    if (!Number.isFinite(coeff)) return null;
    coefficients[featureName] = coeff;
  }

  if (raw.calibration?.type !== "platt") return null;
  const calSlope = parseFiniteNumber(raw.calibration?.slope, NaN);
  const calIntercept = parseFiniteNumber(raw.calibration?.intercept, NaN);
  if (!Number.isFinite(calSlope) || !Number.isFinite(calIntercept)) return null;

  let hierarchicalPlayerPrior = null;
  if (schemaVersion === 2) {
    const rawPrior = raw.hierarchicalPlayerPrior;
    if (rawPrior?.type !== "beta-plus-bradley-terry") return null;
    hierarchicalPlayerPrior = {
      type: "beta-plus-bradley-terry",
      betaAlpha: parseFiniteNumber(rawPrior.betaAlpha, NaN),
      playerWinLogOddsCoefficient: parseFiniteNumber(rawPrior.playerWinLogOddsCoefficient, NaN),
      opponentAdjustedL2: parseFiniteNumber(rawPrior.opponentAdjustedL2, NaN),
      opponentAdjustedCoefficient: parseFiniteNumber(rawPrior.opponentAdjustedCoefficient, NaN),
      optimizer: "cyclic-coordinate-newton",
      maximumSweeps: Math.max(1, Math.trunc(parseFiniteNumber(rawPrior.maximumSweeps, NaN))),
      convergenceTolerance: parseFiniteNumber(rawPrior.convergenceTolerance, NaN),
    };
    const priorValues = [
      hierarchicalPlayerPrior.betaAlpha,
      hierarchicalPlayerPrior.playerWinLogOddsCoefficient,
      hierarchicalPlayerPrior.opponentAdjustedL2,
      hierarchicalPlayerPrior.opponentAdjustedCoefficient,
      hierarchicalPlayerPrior.maximumSweeps,
      hierarchicalPlayerPrior.convergenceTolerance,
    ];
    if (priorValues.some(value => !Number.isFinite(value) || value <= 0)) return null;
  }

  return {
    schemaVersion,
    modelId,
    featureSet: [...featureSet],
    intercept,
    coefficients,
    calibration: {
      type: "platt",
      slope: calSlope,
      intercept: calIntercept,
    },
    hierarchicalPlayerPrior,
    metadata: {
      generatedAt: typeof raw.metadata?.generatedAt === "string" ? raw.metadata.generatedAt : null,
      games: parseFiniteNumber(raw.metadata?.games, 0),
      roundSamples: parseFiniteNumber(raw.metadata?.roundSamples, 0),
      empiricalBlendEnabled: raw.metadata?.empiricalBlendEnabled !== false,
      legacyPersonalizationEnabled: raw.metadata?.legacyPersonalizationEnabled !== false,
    },
  };
}

function loadRuntimeModel() {
  if (runtimeModelLoadPromise) return runtimeModelLoadPromise;
  if (typeof fetch !== "function") {
    return Promise.resolve(getActiveRuntimeModel());
  }

  runtimeModelLoadPromise = fetch(RUNTIME_MODEL_PATH, { cache: "no-cache" })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Runtime model fetch failed: ${response.status}`);
      }
      return response.json();
    })
    .then(raw => {
      const normalized = normalizeRuntimeModelArtifact(raw);
      if (!normalized) {
        throw new Error("Runtime model JSON failed validation.");
      }

      const previousModelId = getActiveRuntimeModel().modelId;
      RUNTIME_MODEL_STATE.model = normalized;
      clearWinProbabilityCache();
      clearPersonalizationStateCache();

      if (normalized.modelId !== previousModelId
          && normalized.metadata.legacyPersonalizationEnabled !== false) {
        const savedGames = getLocalStorage("savedGames", []);
        ensureProbabilityPersonalizationForGames(savedGames, normalized, { force: true });
      }

      return normalized;
    })
    .catch(error => {
      console.warn("Unable to load runtime model JSON. Falling back to bundled model.", error);
      return getActiveRuntimeModel();
    });

  return runtimeModelLoadPromise;
}

function normalizeBiddingTeamValue(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "us" || raw === "dem") return raw;
  return "";
}

function getBiddingTeamSign(biddingTeam) {
  const normalized = normalizeBiddingTeamValue(biddingTeam);
  if (normalized === "us") return 1;
  if (normalized === "dem") return -1;
  return 0;
}

function buildModelFeatureVector({
  diff,
  roundIdx,
  momentum,
  bidAmount,
  biddingTeamSign,
  pointDelta,
  usTotal,
  demTotal,
}) {
  const safeDiff = parseFiniteNumber(diff, 0);
  const safeRoundIdx = Math.max(0, Math.trunc(parseFiniteNumber(roundIdx, 0)));
  const safeMomentum = parseFiniteNumber(momentum, 0);
  const safeBidAmount = parseFiniteNumber(bidAmount, 0);
  const safeBiddingTeamSign = parseFiniteNumber(biddingTeamSign, 0);
  const safePointDelta = parseFiniteNumber(pointDelta, 0);
  const hasExplicitTotals = Number.isFinite(Number(usTotal)) && Number.isFinite(Number(demTotal));
  const safeUsTotal = hasExplicitTotals
    ? parseFiniteNumber(usTotal, 0)
    : Math.max(0, safeDiff);
  const safeDemTotal = hasExplicitTotals
    ? parseFiniteNumber(demTotal, 0)
    : Math.max(0, -safeDiff);
  const leadSign = safeDiff > 0 ? 1 : safeDiff < 0 ? -1 : 0;
  const scoreSum = safeUsTotal + safeDemTotal;

  return {
    diff: safeDiff,
    round_idx: safeRoundIdx,
    momentum: safeMomentum,
    bid_amount: safeBidAmount,
    bidding_team_sign: safeBiddingTeamSign,
    point_delta: safePointDelta,
    abs_diff: Math.abs(safeDiff),
    abs_momentum: Math.abs(safeMomentum),
    diff_x_round: safeDiff * safeRoundIdx,
    point_delta_x_round: safePointDelta * safeRoundIdx,
    bid_x_team: safeBidAmount * safeBiddingTeamSign,
    diff_x_point_delta: safeDiff * safePointDelta,
    momentum_x_round: safeMomentum * safeRoundIdx,
    lead_sign: leadSign,
    diff_x_abs_diff: safeDiff * Math.abs(safeDiff),
    momentum_x_abs_momentum: safeMomentum * Math.abs(safeMomentum),
    diff_x_score_sum: safeDiff * scoreSum,
    lead_sign_x_score_sum: leadSign * scoreSum,
    target_pressure_diff: Math.max(0, safeUsTotal - 400) - Math.max(0, safeDemTotal - 400),
    diff_x_bid: safeDiff * safeBidAmount,
    bidder_sign_x_abs_point_delta: safeBiddingTeamSign * Math.abs(safePointDelta),
    bidder_sign_x_round: safeBiddingTeamSign * safeRoundIdx,
  };
}

function extractModelFeaturesFromRoundContext(roundIndex, lastRound, prevRound = null) {
  const safeRoundIndex = Math.max(0, Math.trunc(parseFiniteNumber(roundIndex, 0)));
  const lastTotals = sanitizeTotals(lastRound?.runningTotals);
  const prevTotals = sanitizeTotals(prevRound?.runningTotals);

  const diff = lastTotals.us - lastTotals.dem;
  const prevDiff = prevTotals.us - prevTotals.dem;
  const momentum = safeRoundIndex === 0 ? 0 : diff - prevDiff;
  const bidAmount = parseFiniteNumber(lastRound?.bidAmount, 0);
  const biddingTeamSign = getBiddingTeamSign(lastRound?.biddingTeam);
  const usPoints = parseFiniteNumber(lastRound?.usPoints, 0);
  const demPoints = parseFiniteNumber(lastRound?.demPoints, 0);
  const pointDelta = usPoints - demPoints;

  return buildModelFeatureVector({
    diff,
    roundIdx: safeRoundIndex,
    momentum,
    bidAmount,
    biddingTeamSign,
    pointDelta,
    usTotal: lastTotals.us,
    demTotal: lastTotals.dem,
  });
}

function computeRawModelProbabilityFromFeatures(features, model = getActiveRuntimeModel()) {
  let z = parseFiniteNumber(model?.intercept, 0);
  const featureSet = Array.isArray(model?.featureSet) ? model.featureSet : MODEL_FEATURE_SET;
  for (const featureName of featureSet) {
    const featureValue = parseFiniteNumber(features?.[featureName], 0);
    const coefficient = parseFiniteNumber(model?.coefficients?.[featureName], 0);
    z += coefficient * featureValue;
  }
  return safeSigmoid(z);
}

function predictBaseModelProbabilityFromFeatures(features, model = getActiveRuntimeModel()) {
  const rawProb = computeRawModelProbabilityFromFeatures(features, model);
  return applyPlattCalibration(rawProb, model?.calibration?.slope, model?.calibration?.intercept);
}

function inferWinnerSide(game) {
  const winnerRaw = typeof game?.winner === "string" ? game.winner.trim().toLowerCase() : "";
  if (winnerRaw === "us" || winnerRaw === "dem") return winnerRaw;

  const finalTotals = sanitizeTotals(game?.finalScore);
  if (finalTotals.us > finalTotals.dem) return "us";
  if (finalTotals.dem > finalTotals.us) return "dem";
  return null;
}

function normalizeGameRoundsForModeling(rounds) {
  if (!Array.isArray(rounds) || !rounds.length) return [];
  return rounds
    .map((round, idx) => ({
      round,
      roundIndex: Math.max(0, Math.trunc(parseFiniteNumber(round?.roundIndex, idx))),
      originalIndex: idx,
    }))
    .sort((a, b) => a.roundIndex - b.roundIndex || a.originalIndex - b.originalIndex);
}

function normalizeProbabilityPlayerKey(value) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized || normalized === "us" || normalized === "dem") return "";
  return normalized;
}

function getProbabilityPlayerKeys(source, side) {
  const storedPlayers = Array.isArray(source?.[`${side}Players`])
    ? source[`${side}Players`].map(normalizeProbabilityPlayerKey).filter(Boolean)
    : [];
  let players = storedPlayers;
  if (players.length !== 2) {
    const display = source?.[`${side}TeamName`] || source?.[`${side}Name`] || "";
    players = parseLegacyTeamName(display).map(normalizeProbabilityPlayerKey).filter(Boolean);
  }
  const unique = [...new Set(players)].sort();
  return unique.length === 2 ? unique : [];
}

function betaPlayerLogOdds(record, alpha) {
  const games = Math.max(0, Math.trunc(parseFiniteNumber(record?.games, 0)));
  const wins = Math.min(games, Math.max(0, parseFiniteNumber(record?.wins, 0)));
  const safeAlpha = Math.max(1e-6, parseFiniteNumber(alpha, 12));
  return probabilityToLogit((wins + safeAlpha) / (games + (2 * safeAlpha)));
}

function fitOpponentAdjustedPlayerRatings(validGames, priorConfig) {
  const playerKeys = [...new Set(validGames.flatMap(game => [
    ...game.usPlayers,
    ...game.demPlayers,
  ]))].sort();
  if (!playerKeys.length || !validGames.length) return new Map();

  const playerIndex = new Map(playerKeys.map((key, index) => [key, index]));
  const rowEntries = validGames.map(game => [
    ...game.usPlayers.map(key => ({ playerIndex: playerIndex.get(key), value: 0.5 })),
    ...game.demPlayers.map(key => ({ playerIndex: playerIndex.get(key), value: -0.5 })),
  ]);
  const entriesByPlayer = Array.from({ length: playerKeys.length }, () => []);
  rowEntries.forEach((entries, rowIndex) => {
    entries.forEach(entry => entriesByPlayer[entry.playerIndex].push({
      rowIndex,
      value: entry.value,
    }));
  });

  const labels = validGames.map(game => game.label);
  const ratings = Array(playerKeys.length).fill(0);
  const logits = Array(validGames.length).fill(0);
  const l2 = Math.max(1e-6, parseFiniteNumber(priorConfig?.opponentAdjustedL2, 0.05));
  const maximumSweeps = Math.max(1, Math.trunc(parseFiniteNumber(priorConfig?.maximumSweeps, 60)));
  const tolerance = Math.max(1e-12, parseFiniteNumber(priorConfig?.convergenceTolerance, 1e-8));

  for (let sweep = 0; sweep < maximumSweeps; sweep += 1) {
    let maximumDelta = 0;
    for (let playerIdx = 0; playerIdx < playerKeys.length; playerIdx += 1) {
      let gradient = l2 * ratings[playerIdx];
      let hessian = l2;
      const entries = entriesByPlayer[playerIdx];
      for (const entry of entries) {
        const probability = safeSigmoid(logits[entry.rowIndex]);
        gradient += entry.value * (probability - labels[entry.rowIndex]);
        hessian += entry.value * entry.value * probability * (1 - probability);
      }
      const delta = hessian > 0 ? -gradient / hessian : 0;
      if (!Number.isFinite(delta)) continue;
      ratings[playerIdx] += delta;
      maximumDelta = Math.max(maximumDelta, Math.abs(delta));
      for (const entry of entries) {
        logits[entry.rowIndex] += entry.value * delta;
      }
    }
    if (maximumDelta < tolerance) break;
  }

  return new Map(playerKeys.map((key, index) => [key, ratings[index]]));
}

function buildHierarchicalPlayerStrengthProfile(historicalGames, model = getActiveRuntimeModel()) {
  const games = Array.isArray(historicalGames) ? historicalGames : [];
  const priorConfig = model?.hierarchicalPlayerPrior;
  if (model?.schemaVersion !== 2 || !priorConfig) {
    return { playerRecords: new Map(), ratings: new Map(), validGames: 0 };
  }

  const gamesHash = getProbabilityCacheKey(games);
  const configSignature = [
    model.modelId,
    priorConfig.betaAlpha,
    priorConfig.opponentAdjustedL2,
    priorConfig.maximumSweeps,
    priorConfig.convergenceTolerance,
    gamesHash,
  ].join("|");
  const cached = PLAYER_STRENGTH_CACHE?.get(games);
  if (cached?.signature === configSignature) return cached.profile;

  const playerRecords = new Map();
  const validGames = [];
  for (const game of games) {
    const winner = inferWinnerSide(game);
    const usPlayers = getProbabilityPlayerKeys(game, "us");
    const demPlayers = getProbabilityPlayerKeys(game, "dem");
    if (!winner) continue;
    const label = winner === "us" ? 1 : 0;
    if (usPlayers.length === 2 && demPlayers.length === 2) {
      validGames.push({ usPlayers, demPlayers, label });
    }
    for (const [side, players] of [["us", usPlayers], ["dem", demPlayers]]) {
      if (players.length !== 2) continue;
      const won = winner === side ? 1 : 0;
      for (const playerKey of players) {
        const record = playerRecords.get(playerKey) || { games: 0, wins: 0 };
        record.games += 1;
        record.wins += won;
        playerRecords.set(playerKey, record);
      }
    }
  }

  const profile = {
    playerRecords,
    ratings: fitOpponentAdjustedPlayerRatings(validGames, priorConfig),
    validGames: validGames.length,
  };
  PLAYER_STRENGTH_CACHE?.set(games, { signature: configSignature, profile });
  return profile;
}

function getHierarchicalPlayerPriorForState(
  currentState,
  historicalGames,
  model = getActiveRuntimeModel(),
) {
  const priorConfig = model?.hierarchicalPlayerPrior;
  const usPlayers = getProbabilityPlayerKeys(currentState, "us");
  const demPlayers = getProbabilityPlayerKeys(currentState, "dem");
  if (model?.schemaVersion !== 2 || !priorConfig
      || usPlayers.length !== 2 || demPlayers.length !== 2) {
    return {
      active: false,
      correction: 0,
      playerWinLogOddsDiff: 0,
      opponentAdjustedLogOddsDiff: 0,
      historyGames: 0,
      playersWithHistory: 0,
    };
  }

  const profile = buildHierarchicalPlayerStrengthProfile(historicalGames, model);
  const averagePlayerLogOdds = players => players.reduce((sum, playerKey) => (
    sum + betaPlayerLogOdds(profile.playerRecords.get(playerKey), priorConfig.betaAlpha)
  ), 0) / players.length;
  const averageRating = players => players.reduce((sum, playerKey) => (
    sum + parseFiniteNumber(profile.ratings.get(playerKey), 0)
  ), 0) / players.length;
  const playerWinLogOddsDiff = averagePlayerLogOdds(usPlayers) - averagePlayerLogOdds(demPlayers);
  const opponentAdjustedLogOddsDiff = averageRating(usPlayers) - averageRating(demPlayers);
  const correction = (
    priorConfig.playerWinLogOddsCoefficient * playerWinLogOddsDiff
    + priorConfig.opponentAdjustedCoefficient * opponentAdjustedLogOddsDiff
  );
  const playersWithHistory = [...usPlayers, ...demPlayers].filter(
    playerKey => (profile.playerRecords.get(playerKey)?.games || 0) > 0,
  ).length;

  return {
    active: playersWithHistory > 0 && Number.isFinite(correction) && correction !== 0,
    correction: Number.isFinite(correction) ? correction : 0,
    playerWinLogOddsDiff,
    opponentAdjustedLogOddsDiff,
    historyGames: profile.validGames,
    playersWithHistory,
  };
}

function buildPersonalizationDataset(savedGames, model = getActiveRuntimeModel()) {
  const games = Array.isArray(savedGames) ? savedGames : [];
  const logits = [];
  const labels = [];
  let gameSamples = 0;

  for (const game of games) {
    const winner = inferWinnerSide(game);
    if (!winner) continue;

    const rounds = normalizeGameRoundsForModeling(game?.rounds);
    if (!rounds.length) continue;

    let previousDiff = 0;
    let hasRoundSample = false;

    rounds.forEach((entry, idx) => {
      const round = entry.round;
      if (!round?.runningTotals) return;

      const totals = sanitizeTotals(round.runningTotals);
      const diff = totals.us - totals.dem;
      const momentum = idx === 0 ? 0 : diff - previousDiff;
      previousDiff = diff;

      const bidAmount = parseFiniteNumber(round?.bidAmount, 0);
      const biddingTeamSign = getBiddingTeamSign(round?.biddingTeam);
      const usPoints = parseFiniteNumber(round?.usPoints, 0);
      const demPoints = parseFiniteNumber(round?.demPoints, 0);
      const pointDelta = usPoints - demPoints;

      const features = buildModelFeatureVector({
        diff,
        roundIdx: entry.roundIndex,
        momentum,
        bidAmount,
        biddingTeamSign,
        pointDelta,
      });
      const baseProb = predictBaseModelProbabilityFromFeatures(features, model);
      logits.push(probabilityToLogit(baseProb));
      labels.push(winner === "us" ? 1 : 0);
      hasRoundSample = true;
    });

    if (hasRoundSample) {
      gameSamples += 1;
    }
  }

  return {
    logits,
    labels,
    roundSamples: logits.length,
    gameSamples,
  };
}

function computeBinaryLogLoss(labels, probs) {
  if (!Array.isArray(labels) || !Array.isArray(probs) || !labels.length || labels.length !== probs.length) {
    return 0;
  }

  let sum = 0;
  for (let idx = 0; idx < labels.length; idx += 1) {
    const y = parseFiniteNumber(labels[idx], 0) >= 0.5 ? 1 : 0;
    const p = clampProbability(probs[idx]);
    sum += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return sum / labels.length;
}

function fitPersonalizationCalibration(logits, labels, options = {}) {
  const xs = Array.isArray(logits) ? logits.map(v => parseFiniteNumber(v, 0)) : [];
  const ys = Array.isArray(labels) ? labels.map(v => (parseFiniteNumber(v, 0) >= 0.5 ? 1 : 0)) : [];

  if (!xs.length || xs.length !== ys.length) {
    return {
      slope: 1,
      intercept: 0,
      baseLogLoss: 0,
      personalizedLogLoss: 0,
      accepted: false,
      improvement: 0,
      guardrailsOk: false,
    };
  }

  const lr = parseFiniteNumber(options.learningRate, PERSONALIZATION_LR);
  const epochs = Math.max(1, Math.trunc(parseFiniteNumber(options.epochs, PERSONALIZATION_EPOCHS)));
  const l2 = Math.max(0, parseFiniteNumber(options.l2, PERSONALIZATION_L2));
  const minImprovement = parseFiniteNumber(options.minImprovement, PERSONALIZATION_MIN_IMPROVEMENT);
  const minSlope = parseFiniteNumber(options.minSlope, PERSONALIZATION_MIN_SLOPE);
  const maxSlope = parseFiniteNumber(options.maxSlope, PERSONALIZATION_MAX_SLOPE);
  const maxAbsIntercept = parseFiniteNumber(options.maxAbsIntercept, PERSONALIZATION_MAX_ABS_INTERCEPT);

  let slope = 1;
  let intercept = 0;
  const n = xs.length;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    let gradSlope = 0;
    let gradIntercept = 0;

    for (let idx = 0; idx < n; idx += 1) {
      const z = slope * xs[idx] + intercept;
      const p = safeSigmoid(z);
      const err = p - ys[idx];
      gradSlope += err * xs[idx];
      gradIntercept += err;
    }

    gradSlope = (gradSlope / n) + (l2 * slope);
    gradIntercept /= n;

    slope -= lr * gradSlope;
    intercept -= lr * gradIntercept;
  }

  const baseProbs = xs.map(v => safeSigmoid(v));
  const personalizedProbs = xs.map(v => safeSigmoid(slope * v + intercept));
  const baseLogLoss = computeBinaryLogLoss(ys, baseProbs);
  const personalizedLogLoss = computeBinaryLogLoss(ys, personalizedProbs);
  const improvement = baseLogLoss - personalizedLogLoss;
  const guardrailsOk = Number.isFinite(slope) && Number.isFinite(intercept)
    && slope >= minSlope && slope <= maxSlope
    && Math.abs(intercept) <= maxAbsIntercept;
  const accepted = guardrailsOk && improvement >= minImprovement;

  return {
    slope: accepted ? slope : 1,
    intercept: accepted ? intercept : 0,
    baseLogLoss,
    personalizedLogLoss: accepted ? personalizedLogLoss : baseLogLoss,
    accepted,
    improvement,
    guardrailsOk,
  };
}

function normalizePersonalizationRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (Number(raw.schemaVersion) !== PROBABILITY_PERSONALIZATION_SCHEMA_VERSION) return null;

  const modelId = typeof raw.modelId === "string" ? raw.modelId.trim() : "";
  if (!modelId) return null;

  const slope = parseFiniteNumber(raw.slope, NaN);
  const intercept = parseFiniteNumber(raw.intercept, NaN);
  const roundSamples = Math.max(0, Math.trunc(parseFiniteNumber(raw.roundSamples, NaN)));
  const gameSamples = Math.max(0, Math.trunc(parseFiniteNumber(raw.gameSamples, NaN)));
  const baseLogLoss = parseFiniteNumber(raw.baseLogLoss, NaN);
  const personalizedLogLoss = parseFiniteNumber(raw.personalizedLogLoss, NaN);
  const gamesHash = typeof raw.gamesHash === "string" ? raw.gamesHash : "0";
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : null;

  if (!Number.isFinite(slope) || !Number.isFinite(intercept)
      || !Number.isFinite(roundSamples) || !Number.isFinite(gameSamples)
      || !Number.isFinite(baseLogLoss) || !Number.isFinite(personalizedLogLoss)) {
    return null;
  }

  return {
    schemaVersion: PROBABILITY_PERSONALIZATION_SCHEMA_VERSION,
    modelId,
    slope,
    intercept,
    roundSamples,
    gameSamples,
    gamesHash,
    updatedAt,
    baseLogLoss,
    personalizedLogLoss,
  };
}

function isPersonalizationRecordActive(record, modelId = getActiveRuntimeModel().modelId) {
  if (!record || record.modelId !== modelId) return false;
  if (record.gameSamples < PERSONALIZATION_MIN_GAMES) return false;
  if (record.roundSamples < PERSONALIZATION_MIN_ROUNDS) return false;
  if (!(record.personalizedLogLoss <= (record.baseLogLoss - PERSONALIZATION_MIN_IMPROVEMENT))) return false;
  if (record.slope < PERSONALIZATION_MIN_SLOPE || record.slope > PERSONALIZATION_MAX_SLOPE) return false;
  if (Math.abs(record.intercept) > PERSONALIZATION_MAX_ABS_INTERCEPT) return false;
  return true;
}

function getPersonalizationSignature(record, modelId = getActiveRuntimeModel().modelId) {
  const normalized = normalizePersonalizationRecord(record);
  if (!normalized || normalized.modelId !== modelId) return "none";
  return [
    normalized.modelId,
    normalized.slope.toFixed(6),
    normalized.intercept.toFixed(6),
    normalized.roundSamples,
    normalized.gameSamples,
    normalized.gamesHash,
  ].join("|");
}

function createPersonalizationRecord(historicalGames, model = getActiveRuntimeModel(), gamesHash = getProbabilityCacheKey(historicalGames)) {
  const dataset = buildPersonalizationDataset(historicalGames, model);
  const hasEnoughData = dataset.gameSamples >= PERSONALIZATION_MIN_GAMES && dataset.roundSamples >= PERSONALIZATION_MIN_ROUNDS;
  if (!hasEnoughData) {
    return createNeutralPersonalizationRecord(model, gamesHash, dataset);
  }

  const fitResult = fitPersonalizationCalibration(dataset.logits, dataset.labels);
  const usePersonalization = hasEnoughData && fitResult.accepted;

  return {
    schemaVersion: PROBABILITY_PERSONALIZATION_SCHEMA_VERSION,
    modelId: model.modelId,
    slope: usePersonalization ? fitResult.slope : 1,
    intercept: usePersonalization ? fitResult.intercept : 0,
    roundSamples: dataset.roundSamples,
    gameSamples: dataset.gameSamples,
    gamesHash,
    updatedAt: new Date().toISOString(),
    baseLogLoss: fitResult.baseLogLoss,
    personalizedLogLoss: usePersonalization ? fitResult.personalizedLogLoss : fitResult.baseLogLoss,
  };
}

function ensureProbabilityPersonalizationForGames(historicalGames, model = getActiveRuntimeModel(), options = {}) {
  if (model?.metadata?.legacyPersonalizationEnabled === false) return null;
  const games = Array.isArray(historicalGames) ? historicalGames : [];
  const gamesHash = getProbabilityCacheKey(games);
  const cacheKey = `${model.modelId}|${gamesHash}`;
  const force = !!options.force;

  if (!force && PERSONALIZATION_STATE_CACHE.key === cacheKey && PERSONALIZATION_STATE_CACHE.value) {
    return PERSONALIZATION_STATE_CACHE.value;
  }

  const storedRecord = normalizePersonalizationRecord(getLocalStorage(PROBABILITY_PERSONALIZATION_KEY, null));
  if (!force && storedRecord && storedRecord.modelId === model.modelId && storedRecord.gamesHash === gamesHash) {
    PERSONALIZATION_STATE_CACHE.key = cacheKey;
    PERSONALIZATION_STATE_CACHE.value = storedRecord;
    return storedRecord;
  }

  const nextRecord = createPersonalizationRecord(games, model, gamesHash);
  setLocalStorage(PROBABILITY_PERSONALIZATION_KEY, nextRecord);
  PERSONALIZATION_STATE_CACHE.key = cacheKey;
  PERSONALIZATION_STATE_CACHE.value = nextRecord;
  clearWinProbabilityCache();
  return nextRecord;
}

function refreshProbabilityPersonalizationFromSavedGames(savedGames = getLocalStorage("savedGames", []), options = {}) {
  return ensureProbabilityPersonalizationForGames(savedGames, getActiveRuntimeModel(), options);
}

function scheduleProbabilityPersonalizationRefresh(savedGames = getLocalStorage("savedGames", []), options = {}) {
  pendingPersonalizationRefresh = {
    savedGames,
    options: {
      ...(pendingPersonalizationRefresh?.options || {}),
      ...options,
      force: !!(pendingPersonalizationRefresh?.options?.force || options.force),
    },
  };
  if (pendingPersonalizationRefreshHandle !== null) return;
  pendingPersonalizationRefreshHandle = scheduleIdleWork(() => {
    const job = pendingPersonalizationRefresh || { savedGames, options };
    pendingPersonalizationRefreshHandle = null;
    pendingPersonalizationRefresh = null;
    refreshProbabilityPersonalizationFromSavedGames(job.savedGames, job.options);
  });
}

function getProbabilityContext(historicalGames, options = {}) {
  const model = getActiveRuntimeModel();
  const personalization = model?.metadata?.legacyPersonalizationEnabled === false
    ? null
    : ensureProbabilityPersonalizationForGames(historicalGames, model, options);
  return { model, personalization };
}

function getModelProbabilitySnapshotForState(
  currentState,
  model = getActiveRuntimeModel(),
  personalization = null,
  historicalGames = [],
) {
  const rounds = Array.isArray(currentState?.rounds) ? currentState.rounds : [];
  if (!rounds.length) {
    return {
      modelId: model.modelId,
      features: null,
      roundIndex: 0,
      currentDiff: 0,
      momentum: 0,
      rawModelProbUs: 0.5,
      baseModelProbUs: 0.5,
      modelProbUs: 0.5,
      personalizationRecord: personalization,
      personalizationActive: false,
      hierarchicalPlayerPrior: null,
      hierarchicalPlayerPriorActive: false,
    };
  }

  const roundIndex = rounds.length - 1;
  const lastRound = rounds[roundIndex];
  const prevRound = roundIndex > 0 ? rounds[roundIndex - 1] : null;
  const features = extractModelFeaturesFromRoundContext(roundIndex, lastRound, prevRound);
  const rawModelProbUs = computeRawModelProbabilityFromFeatures(features, model);
  const baseModelProbUs = applyPlattCalibration(rawModelProbUs, model.calibration.slope, model.calibration.intercept);
  const personalizationRecord = normalizePersonalizationRecord(personalization);
  const personalizationActive = model?.metadata?.legacyPersonalizationEnabled !== false
    && isPersonalizationRecordActive(personalizationRecord, model.modelId);
  const hierarchicalPlayerPrior = getHierarchicalPlayerPriorForState(
    currentState,
    historicalGames,
    model,
  );
  const hierarchicalPlayerPriorActive = model?.schemaVersion === 2
    && hierarchicalPlayerPrior.active;
  let modelProbUs = baseModelProbUs;
  if (personalizationActive) {
    modelProbUs = applyPlattCalibration(
      baseModelProbUs,
      personalizationRecord.slope,
      personalizationRecord.intercept,
    );
  } else if (hierarchicalPlayerPriorActive) {
    modelProbUs = safeSigmoid(
      probabilityToLogit(baseModelProbUs) + hierarchicalPlayerPrior.correction,
    );
  }

  return {
    modelId: model.modelId,
    features,
    roundIndex,
    currentDiff: features.diff,
    momentum: features.momentum,
    rawModelProbUs,
    baseModelProbUs,
    modelProbUs,
    personalizationRecord,
    personalizationActive,
    hierarchicalPlayerPrior,
    hierarchicalPlayerPriorActive,
  };
}

function bucketScore(diff) {
  const value = parseFiniteNumber(diff, 0);
  if (value === 0) return 0;
  const sign = value < 0 ? -1 : 1;
  const band = Math.min(Math.ceil(Math.abs(value) / 20) * 20, 180);
  return sign * band;
}

function getProbabilityCacheKey(historicalGames) {
  if (!Array.isArray(historicalGames) || !historicalGames.length) return '0';
  if (PROBABILITY_GAMES_HASH_CACHE) {
    const cachedHash = PROBABILITY_GAMES_HASH_CACHE.get(historicalGames);
    if (cachedHash) return cachedHash;
  }

  let hash = 2166136261;

  const hashText = (value) => {
    const str = String(value ?? "");
    for (let idx = 0; idx < str.length; idx += 1) {
      hash ^= str.charCodeAt(idx);
      hash = Math.imul(hash, 16777619);
    }
  };

  for (const game of historicalGames) {
    const winner = inferWinnerSide(game) || "none";
    const totals = sanitizeTotals(game?.finalScore);
    const rounds = Array.isArray(game?.rounds) ? game.rounds : [];

    hashText(game?.id || game?.timestamp || "game");
    hashText(winner);
    hashText(totals.us);
    hashText(totals.dem);
    hashText(rounds.length);
    getProbabilityPlayerKeys(game, "us").forEach(hashText);
    getProbabilityPlayerKeys(game, "dem").forEach(hashText);

    for (let roundIdx = 0; roundIdx < rounds.length; roundIdx += 1) {
      const round = rounds[roundIdx];
      const runningTotals = sanitizeTotals(round?.runningTotals);
      hashText(roundIdx);
      hashText(round?.roundIndex ?? "");
      hashText(round?.biddingTeam || "");
      hashText(parseFiniteNumber(round?.bidAmount, 0));
      hashText(parseFiniteNumber(round?.usPoints, 0));
      hashText(parseFiniteNumber(round?.demPoints, 0));
      hashText(runningTotals.us);
      hashText(runningTotals.dem);
    }
  }

  const cacheKey = `${historicalGames.length}|${(hash >>> 0).toString(16)}`;
  if (PROBABILITY_GAMES_HASH_CACHE) {
    PROBABILITY_GAMES_HASH_CACHE.set(historicalGames, cacheKey);
  }
  return cacheKey;
}

function buildProbabilityIndex(historicalGames) {
  const table = {};
  if (!Array.isArray(historicalGames) || !historicalGames.length) return table;

  const add = (k, winner, weight) => {
    if (!table[k]) table[k] = { us: 1, dem: 1 };      // Laplace prior (1|1)
    table[k][winner] += weight;
  };

  historicalGames.forEach(g => {
    if (!g || !Array.isArray(g.rounds) || !g.rounds.length || !g.finalScore) return;

    const finalTotals = sanitizeTotals(g.finalScore);
    const winner = inferWinnerSide(g);
    const winners = winner ? [winner] : (finalTotals.us === finalTotals.dem ? ['us', 'dem'] : []);
    if (!winners.length) return;
    const weightEach = winners.length === 2 ? 0.5 : 1;

    g.rounds.forEach((r, idx) => {
      if (!r?.runningTotals) return;
      const runningTotals = sanitizeTotals(r.runningTotals);
      const diff = runningTotals.us - runningTotals.dem;
      const key = `${idx}|${bucketScore(diff)}`;
      winners.forEach(winner => add(key, winner, weightEach));
    });
  });
  return table;
}

/**
 * Calculates win probability by blending historical empirical data
 * with the calibrated regression model probability.
 */
function calculateWinProbabilityComplex(state, historicalGames, probabilityContext = null) {
  const rounds = Array.isArray(state?.rounds) ? state.rounds : [];
  if (!rounds.length) return { us: 50, dem: 50 };

  const lastRound = rounds[rounds.length - 1];
  const roundIndex = rounds.length - 1;
  const lastTotals = sanitizeTotals(lastRound?.runningTotals);
  const currentDiff = lastTotals.us - lastTotals.dem;

  const games = Array.isArray(historicalGames) ? historicalGames : [];
  const probCacheKey = getProbabilityCacheKey(games);
  if (!PROB_CACHE.has(probCacheKey)) {
    PROB_CACHE.set(probCacheKey, buildProbabilityIndex(games));
  }
  const table = PROB_CACHE.get(probCacheKey);

  const empiricalKey = `${roundIndex}|${bucketScore(currentDiff)}`;
  const counts = table[empiricalKey] || { us: 1, dem: 1 };
  const empiricalProbUs = counts.us / (counts.us + counts.dem);
  const observationsInBucket = (counts.us - 1) + (counts.dem - 1);

  const context = probabilityContext || { model: getActiveRuntimeModel(), personalization: null };
  const modelSnapshot = getModelProbabilitySnapshotForState(
    state,
    context.model,
    context.personalization,
    games,
  );
  const modelProbUs = modelSnapshot.modelProbUs;

  if (context.model?.metadata?.empiricalBlendEnabled === false) {
    return toDisplayProbabilityPercents(modelProbUs);
  }

  const K_CONFIDENCE_THRESHOLD = 30;
  const beta = Math.min(1, Math.log(observationsInBucket + 1) / Math.log(K_CONFIDENCE_THRESHOLD + 1));
  const blendedProbUs = (beta * empiricalProbUs) + ((1 - beta) * modelProbUs);

  return toDisplayProbabilityPercents(blendedProbUs);
}

function calculateWinProbability(state, historicalGames, probabilityContext = null) {
  return calculateWinProbabilityComplex(state, historicalGames, probabilityContext);
}

function buildWinProbabilityCacheKey(currentState, historicalGames, probabilityContext = null) {
  const rounds = Array.isArray(currentState?.rounds) ? currentState.rounds : [];
  const lastRound = rounds[rounds.length - 1];
  const prevRound = rounds.length > 1 ? rounds[rounds.length - 2] : null;
  const lastTotals = sanitizeTotals(lastRound?.runningTotals);
  const prevTotals = sanitizeTotals(prevRound?.runningTotals);
  const roundIndex = rounds.length > 0 ? rounds.length - 1 : 0;
  const features = extractModelFeaturesFromRoundContext(roundIndex, lastRound, prevRound);
  const gamesKey = getProbabilityCacheKey(historicalGames);
  const context = probabilityContext || getProbabilityContext(historicalGames);
  const modelId = context.model?.modelId || getActiveRuntimeModel().modelId;
  const featureSet = Array.isArray(context.model?.featureSet)
    ? context.model.featureSet
    : MODEL_FEATURE_SET;
  const featureSignature = featureSet.map(name => parseFiniteNumber(features[name], 0)).join(",");
  const personalizationSignature = getPersonalizationSignature(context.personalization, modelId);
  const currentPlayerSignature = [
    ...getProbabilityPlayerKeys(currentState, "us"),
    "vs",
    ...getProbabilityPlayerKeys(currentState, "dem"),
  ].join("|");

  return [
    rounds.length,
    lastTotals.us,
    lastTotals.dem,
    prevTotals.us,
    prevTotals.dem,
    featureSignature,
    gamesKey,
    modelId,
    personalizationSignature,
    currentPlayerSignature,
  ].join("|");
}

function getWinProbability(currentState, historicalGames, probabilityContext = null) {
  const games = Array.isArray(historicalGames) ? historicalGames : [];
  const context = probabilityContext || getProbabilityContext(games);
  const cacheKey = buildWinProbabilityCacheKey(currentState, games, context);
  if (WIN_PROB_CACHE.key === cacheKey && WIN_PROB_CACHE.value) {
    return WIN_PROB_CACHE.value;
  }

  const value = calculateWinProbability(currentState, games, context);
  WIN_PROB_CACHE.key = cacheKey;
  WIN_PROB_CACHE.value = value;
  return value;
}
