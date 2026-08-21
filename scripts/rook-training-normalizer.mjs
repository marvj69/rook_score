import { createHash } from "node:crypto";

export const NORMALIZED_TRAINING_SCHEMA_VERSION = 2;
export const TEAM_STRENGTH_ALPHA = 1.5;
export const TEAM_STRENGTH_BETA = 1.5;
export const PLAYER_ELO_INITIAL = 1500;
export const PLAYER_ELO_K = 24;

const VALID_SIDES = new Set(["us", "dem"]);
const VALID_VICTORY_METHODS = new Map([
  ["won on bid", "won_on_bid"],
  ["set other team", "set_other_team"],
  ["1000 point spread", "1000_point_spread"],
]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function normalizeSide(value, transformations) {
  const raw = typeof value === "string" ? value : "";
  const normalized = raw.trim().toLowerCase();
  if (!VALID_SIDES.has(normalized)) return null;
  if (raw !== normalized) transformations.normalizedBiddingTeamValues += 1;
  return normalized;
}

function normalizeTotals(value) {
  const us = finiteNumber(value?.us);
  const dem = finiteNumber(value?.dem);
  return us === null || dem === null ? null : { us, dem };
}

function normalizePlayerName(value) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized || normalized === "us" || normalized === "dem") return "";
  return normalized;
}

function splitTeamDisplay(value) {
  const display = normalizePlayerName(value);
  if (!display) return [];
  const players = display
    .split(/\s*(?:&|\band\b|\+|\/|\|)\s*/i)
    .map(normalizePlayerName)
    .filter(Boolean);
  return players.length === 2 ? [...new Set(players)].sort() : [];
}

function extractPlayers(game, side) {
  const storedValues = Array.isArray(game?.[`${side}Players`])
    ? game[`${side}Players`]
    : [];
  const storedPlayers = storedValues.map(normalizePlayerName).filter(Boolean);
  if (storedPlayers.length === 2) return [...new Set(storedPlayers)].sort();
  if (storedValues.length === 1) {
    const splitStoredValue = splitTeamDisplay(storedValues[0]);
    if (splitStoredValue.length === 2) return splitStoredValue;
  }
  const displayPlayers = splitTeamDisplay(game?.[`${side}TeamName`]);
  if (displayPlayers.length === 2) return displayPlayers;

  const keyPlayers = typeof game?.[`${side}TeamKey`] === "string"
    ? game[`${side}TeamKey`].split("||").map(normalizePlayerName).filter(Boolean)
    : [];
  return keyPlayers.length === 2 ? [...new Set(keyPlayers)].sort() : [];
}

const TEAM_NAME_PLACEHOLDERS = new Set([
  "us",
  "dem",
  "us team",
  "dem team",
  "team us",
  "team dem",
  "team 1",
  "team 2",
]);

function getTeamIdentityKey(game, side) {
  const players = extractPlayers(game, side);
  if (players.length === 2) return `players:${players.join("||")}`;

  const storedKey = normalizePlayerName(game?.[`${side}TeamKey`]);
  if (storedKey) return `stored:${storedKey}`;

  const display = normalizePlayerName(game?.[`${side}TeamName`] || game?.[`${side}Name`]);
  if (!display || TEAM_NAME_PLACEHOLDERS.has(display)) return "";
  return `display:${display}`;
}

function identityCompleteness(game) {
  return extractPlayers(game, "us").length
    + extractPlayers(game, "dem").length
    + (getTeamIdentityKey(game, "us") ? 1 : 0)
    + (getTeamIdentityKey(game, "dem") ? 1 : 0);
}

function identitySignature(game) {
  return stableJson({
    usPlayers: extractPlayers(game, "us"),
    demPlayers: extractPlayers(game, "dem"),
    usTeam: getTeamIdentityKey(game, "us"),
    demTeam: getTeamIdentityKey(game, "dem"),
  });
}

function normalizeVictoryMethod(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VALID_VICTORY_METHODS.get(normalized) || "unknown";
}

function normalizeGameCore(game) {
  const reasons = [];
  const transformations = {
    inferredStartingTotals: 0,
    normalizedBiddingTeamValues: 0,
  };
  const completedAt = normalizeTimestamp(game?.timestamp);
  if (!completedAt) reasons.push("invalid_timestamp");

  const winner = typeof game?.winner === "string" ? game.winner.trim().toLowerCase() : "";
  if (!VALID_SIDES.has(winner)) reasons.push("invalid_winner");

  if (!Array.isArray(game?.rounds) || game.rounds.length === 0) {
    reasons.push("missing_rounds");
    return { core: null, reasons, transformations };
  }

  const sortedRounds = game.rounds
    .map((round, originalIndex) => {
      const storedIndex = finiteNumber(round?.roundIndex);
      return {
        round,
        originalIndex,
        storedIndex: storedIndex === null ? originalIndex : Math.max(0, Math.trunc(storedIndex)),
      };
    })
    .sort((a, b) => a.storedIndex - b.storedIndex || a.originalIndex - b.originalIndex);

  const duplicateIndexes = new Set();
  const observedIndexes = new Set();
  for (const entry of sortedRounds) {
    if (observedIndexes.has(entry.storedIndex)) duplicateIndexes.add(entry.storedIndex);
    observedIndexes.add(entry.storedIndex);
  }
  if (duplicateIndexes.size) reasons.push("duplicate_round_indexes");

  const firstStoredTotals = normalizeTotals(sortedRounds[0]?.round?.runningTotals);
  const firstUsPoints = finiteNumber(sortedRounds[0]?.round?.usPoints);
  const firstDemPoints = finiteNumber(sortedRounds[0]?.round?.demPoints);
  let startingTotals = normalizeTotals(game?.startingTotals);
  if (!startingTotals && firstStoredTotals && firstUsPoints !== null && firstDemPoints !== null) {
    startingTotals = {
      us: firstStoredTotals.us - firstUsPoints,
      dem: firstStoredTotals.dem - firstDemPoints,
    };
    transformations.inferredStartingTotals += 1;
  }
  if (!startingTotals) reasons.push("missing_starting_totals");

  let running = startingTotals ? { ...startingTotals } : { us: 0, dem: 0 };
  const rounds = [];
  for (let index = 0; index < sortedRounds.length; index += 1) {
    const rawRound = sortedRounds[index].round;
    const biddingTeam = normalizeSide(rawRound?.biddingTeam, transformations);
    const bidAmount = finiteNumber(rawRound?.bidAmount);
    const usPoints = finiteNumber(rawRound?.usPoints);
    const demPoints = finiteNumber(rawRound?.demPoints);
    const storedRunningTotals = normalizeTotals(rawRound?.runningTotals);

    if (!biddingTeam) reasons.push(`round_${index}_invalid_bidding_team`);
    if (bidAmount === null
        || bidAmount <= 0
        || bidAmount % 5 !== 0
        || (bidAmount > 180 && bidAmount !== 360)) {
      reasons.push(`round_${index}_invalid_bid`);
    }
    if (usPoints === null || demPoints === null) reasons.push(`round_${index}_invalid_points`);
    if (!storedRunningTotals) reasons.push(`round_${index}_missing_running_totals`);

    if (usPoints !== null && demPoints !== null) {
      running = {
        us: running.us + usPoints,
        dem: running.dem + demPoints,
      };
    }
    if (storedRunningTotals
        && (storedRunningTotals.us !== running.us || storedRunningTotals.dem !== running.dem)) {
      reasons.push(`round_${index}_running_total_mismatch`);
    }

    rounds.push({
      roundIndex: index,
      biddingTeam,
      bidAmount,
      usPoints,
      demPoints,
      runningTotals: { ...running },
      terminal: index === sortedRounds.length - 1,
    });
  }

  const storedFinalScore = normalizeTotals(game?.finalScore);
  if (!storedFinalScore) reasons.push("missing_final_score");
  if (storedFinalScore
      && (storedFinalScore.us !== running.us || storedFinalScore.dem !== running.dem)) {
    reasons.push("final_score_mismatch");
  }

  if (reasons.length) {
    return { core: null, reasons: [...new Set(reasons)], transformations };
  }

  const core = {
    completedAt,
    winner,
    victoryMethod: normalizeVictoryMethod(game?.victoryMethod),
    startingTotals,
    finalScore: { ...running },
    rounds,
  };
  return { core, reasons: [], transformations };
}

function buildCoreFingerprint(core) {
  return sha256(stableJson(core));
}

function createIdentityRegistries(validGroups) {
  const allPlayerNames = new Set();
  const allTeamKeys = new Set();
  for (const group of validGroups) {
    const identityGame = group.identityGame;
    extractPlayers(identityGame, "us").forEach(name => allPlayerNames.add(name));
    extractPlayers(identityGame, "dem").forEach(name => allPlayerNames.add(name));
    const usTeamKey = getTeamIdentityKey(identityGame, "us");
    const demTeamKey = getTeamIdentityKey(identityGame, "dem");
    if (usTeamKey) allTeamKeys.add(usTeamKey);
    if (demTeamKey) allTeamKeys.add(demTeamKey);
  }
  const playerRegistry = new Map(
    [...allPlayerNames]
      .sort()
      .map((name, index) => [name, `player_${String(index + 1).padStart(3, "0")}`]),
  );
  const teamRegistry = new Map(
    [...allTeamKeys]
      .sort()
      .map((key, index) => [key, `team_${String(index + 1).padStart(3, "0")}`]),
  );
  return { playerRegistry, teamRegistry };
}

function buildSideIdentity(game, side, playerRegistry, teamRegistry) {
  const normalizedNames = extractPlayers(game, side);
  const playerIds = normalizedNames.map(name => playerRegistry.get(name)).filter(Boolean).sort();
  const teamId = teamRegistry.get(getTeamIdentityKey(game, side)) || null;
  return {
    identityAvailable: Boolean(teamId),
    playerIdentityAvailable: playerIds.length === 2,
    playerIds,
    teamId,
  };
}

function betaWinRate(record) {
  return (record.wins + TEAM_STRENGTH_ALPHA)
    / (record.games + TEAM_STRENGTH_ALPHA + TEAM_STRENGTH_BETA);
}

function getElo(playerElo, playerId) {
  return playerElo.get(playerId) ?? PLAYER_ELO_INITIAL;
}

function teamElo(playerElo, playerIds) {
  if (!playerIds.length) return PLAYER_ELO_INITIAL;
  return playerIds.reduce((sum, playerId) => sum + getElo(playerElo, playerId), 0) / playerIds.length;
}

function computeRollingStrength(games) {
  const teamRecords = new Map();
  const playerElo = new Map();
  const orderedGames = [...games].sort((a, b) => (
    a.completedAt.localeCompare(b.completedAt) || a.gameId.localeCompare(b.gameId)
  ));

  for (const game of orderedGames) {
    const usTeam = game.teams.us;
    const demTeam = game.teams.dem;
    const usRecord = usTeam.teamId
      ? teamRecords.get(usTeam.teamId) || { games: 0, wins: 0 }
      : { games: 0, wins: 0 };
    const demRecord = demTeam.teamId
      ? teamRecords.get(demTeam.teamId) || { games: 0, wins: 0 }
      : { games: 0, wins: 0 };
    const usElo = teamElo(playerElo, usTeam.playerIds);
    const demElo = teamElo(playerElo, demTeam.playerIds);
    const expectedUsWin = 1 / (1 + (10 ** ((demElo - usElo) / 400)));

    game.pregameStrength = {
      available: usTeam.identityAvailable && demTeam.identityAvailable,
      teamStrengthAvailable: usTeam.identityAvailable && demTeam.identityAvailable,
      playerStrengthAvailable: usTeam.playerIdentityAvailable && demTeam.playerIdentityAvailable,
      usTeamPriorGames: usRecord.games,
      demTeamPriorGames: demRecord.games,
      usTeamPriorWinRate: betaWinRate(usRecord),
      demTeamPriorWinRate: betaWinRate(demRecord),
      teamPriorWinRateDiff: betaWinRate(usRecord) - betaWinRate(demRecord),
      usPlayerElo: usElo,
      demPlayerElo: demElo,
      playerEloDiff: usElo - demElo,
      eloExpectedUsWin: expectedUsWin,
    };

    const usWon = game.winner === "us" ? 1 : 0;
    if (usTeam.teamId) {
      teamRecords.set(usTeam.teamId, {
        games: usRecord.games + 1,
        wins: usRecord.wins + usWon,
      });
    }
    if (demTeam.teamId) {
      teamRecords.set(demTeam.teamId, {
        games: demRecord.games + 1,
        wins: demRecord.wins + (1 - usWon),
      });
    }

    if (usTeam.playerIdentityAvailable && demTeam.playerIdentityAvailable) {
      const eloDelta = PLAYER_ELO_K * (usWon - expectedUsWin);
      usTeam.playerIds.forEach(playerId => playerElo.set(playerId, getElo(playerElo, playerId) + eloDelta));
      demTeam.playerIds.forEach(playerId => playerElo.set(playerId, getElo(playerElo, playerId) - eloDelta));
    }
  }

  return { teamRecords, playerElo };
}

function summarizeTeamDistribution(games) {
  const counts = new Map();
  for (const game of games) {
    for (const side of ["us", "dem"]) {
      const teamId = game.teams[side].teamId;
      if (teamId) counts.set(teamId, (counts.get(teamId) || 0) + 1);
    }
  }
  const sorted = [...counts.values()].sort((a, b) => b - a);
  return {
    distinctTeams: counts.size,
    maximumGamesForOneTeam: sorted[0] || 0,
    teamsWithAtLeast10Games: sorted.filter(count => count >= 10).length,
    teamsWithOneGame: sorted.filter(count => count === 1).length,
  };
}

function summarizeLibraryDistribution(games, libraryCount) {
  const counts = new Map();
  for (const game of games) {
    for (const libraryId of game.provenance.libraryIds) {
      counts.set(libraryId, (counts.get(libraryId) || 0) + 1);
    }
  }
  const observed = [...counts.values()].sort((a, b) => a - b);
  return {
    sourceLibraries: libraryCount,
    librariesWithValidGames: counts.size,
    minimumLogicalGamesPerLibrary: observed[0] || 0,
    medianLogicalGamesPerLibrary: observed.length
      ? Number(((observed[Math.floor((observed.length - 1) / 2)]
        + observed[Math.ceil((observed.length - 1) / 2)]) / 2).toFixed(1))
      : 0,
    maximumLogicalGamesPerLibrary: observed.at(-1) || 0,
  };
}

export function normalizeTrainingSnapshot(sourceDocuments, options = {}) {
  const projectId = String(options.projectId || "unknown");
  const generatedAt = options.generatedAt || new Date().toISOString();
  const rawCopies = [];
  for (const sourceDocument of Array.isArray(sourceDocuments) ? sourceDocuments : []) {
    const sourceKey = String(sourceDocument?.sourceKey || "unknown");
    const games = Array.isArray(sourceDocument?.games) ? sourceDocument.games : [];
    games.forEach(game => rawCopies.push({ sourceKey, game }));
  }
  const libraryRegistry = new Map(
    [...new Set(rawCopies.map(copy => copy.sourceKey))]
      .sort()
      .map((sourceKey, index) => [
        sourceKey,
        `library_${String(index + 1).padStart(3, "0")}`,
      ]),
  );

  const validByFingerprint = new Map();
  const quarantineByFingerprint = new Map();
  for (const copy of rawCopies) {
    const normalized = normalizeGameCore(copy.game);
    if (!normalized.core) {
      const quarantineFingerprint = sha256(stableJson({
        timestamp: copy.game?.timestamp || null,
        rounds: copy.game?.rounds || null,
        reasons: normalized.reasons,
      }));
      if (!quarantineByFingerprint.has(quarantineFingerprint)) {
        quarantineByFingerprint.set(quarantineFingerprint, {
          quarantineId: `quarantine_${quarantineFingerprint.slice(0, 20)}`,
          reasons: normalized.reasons,
          sourceCopies: 0,
        });
      }
      quarantineByFingerprint.get(quarantineFingerprint).sourceCopies += 1;
      continue;
    }

    const fingerprint = buildCoreFingerprint(normalized.core);
    if (!validByFingerprint.has(fingerprint)) {
      validByFingerprint.set(fingerprint, {
        fingerprint,
        core: normalized.core,
        copies: [],
        identityGame: copy.game,
        transformations: normalized.transformations,
      });
    }
    const group = validByFingerprint.get(fingerprint);
    group.copies.push(copy);
    group.transformations = {
      inferredStartingTotals: Math.min(
        group.transformations.inferredStartingTotals,
        normalized.transformations.inferredStartingTotals,
      ),
      normalizedBiddingTeamValues: Math.min(
        group.transformations.normalizedBiddingTeamValues,
        normalized.transformations.normalizedBiddingTeamValues,
      ),
    };
    const candidateCompleteness = identityCompleteness(copy.game);
    const selectedCompleteness = identityCompleteness(group.identityGame);
    if (candidateCompleteness > selectedCompleteness
        || (candidateCompleteness === selectedCompleteness
          && identitySignature(copy.game) < identitySignature(group.identityGame))) {
      group.identityGame = copy.game;
    }
  }

  const validGroups = [...validByFingerprint.values()];
  const { playerRegistry, teamRegistry } = createIdentityRegistries(validGroups);
  const games = validGroups
    .map(group => {
      const usIdentity = buildSideIdentity(group.identityGame, "us", playerRegistry, teamRegistry);
      const demIdentity = buildSideIdentity(group.identityGame, "dem", playerRegistry, teamRegistry);
      const identityVariants = new Set(group.copies.map(copy => identitySignature(copy.game)));
      return {
        gameId: `game_${group.fingerprint.slice(0, 24)}`,
        ...group.core,
        teams: { us: usIdentity, dem: demIdentity },
        provenance: {
          sourceCopies: group.copies.length,
          libraryIds: [...new Set(
            group.copies.map(copy => libraryRegistry.get(copy.sourceKey)).filter(Boolean),
          )].sort(),
          distinctIdentityVariants: identityVariants.size,
        },
      };
    })
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.gameId.localeCompare(b.gameId));

  computeRollingStrength(games);
  const gamesWithCompleteIdentity = games.filter(game => (
    game.teams.us.identityAvailable && game.teams.dem.identityAvailable
  )).length;
  const gamesWithCompletePlayerIdentity = games.filter(game => (
    game.teams.us.playerIdentityAvailable && game.teams.dem.playerIdentityAvailable
  )).length;
  const totalRounds = games.reduce((sum, game) => sum + game.rounds.length, 0);
  const nonTerminalRounds = games.reduce((sum, game) => sum + Math.max(0, game.rounds.length - 1), 0);
  const transformations = validGroups.reduce((totals, group) => ({
    inferredStartingTotals: totals.inferredStartingTotals
      + group.transformations.inferredStartingTotals,
    normalizedBiddingTeamValues: totals.normalizedBiddingTeamValues
      + group.transformations.normalizedBiddingTeamValues,
  }), { inferredStartingTotals: 0, normalizedBiddingTeamValues: 0 });
  const duplicateCopiesRemoved = rawCopies.length
    - games.reduce((sum, game) => sum + (game.provenance.sourceCopies > 0 ? 1 : 0), 0)
    - [...quarantineByFingerprint.values()].reduce((sum, item) => sum + (item.sourceCopies > 0 ? 1 : 0), 0);

  const dataset = {
    schemaVersion: NORMALIZED_TRAINING_SCHEMA_VERSION,
    generatedAt,
    source: {
      type: "firestore-read-only-snapshot",
      projectId,
      collection: "rookData",
      field: "savedGames",
      firebaseMutated: false,
    },
    privacy: {
      rawUserIdsIncluded: false,
      rawPlayerNamesIncluded: false,
      rawTeamNamesIncluded: false,
      rawSourceDocumentIdsIncluded: false,
      identityRepresentation: "snapshot-local opaque player, team, and source-library IDs",
    },
    strengthFeatures: {
      method: "chronological prior-only Beta team rates plus player Elo",
      betaPrior: { alpha: TEAM_STRENGTH_ALPHA, beta: TEAM_STRENGTH_BETA },
      playerElo: { initial: PLAYER_ELO_INITIAL, kFactor: PLAYER_ELO_K },
      outcomeWeightingUsed: false,
    },
    games,
    quarantine: [...quarantineByFingerprint.values()].sort((a, b) => a.quarantineId.localeCompare(b.quarantineId)),
  };

  const audit = {
    schemaVersion: NORMALIZED_TRAINING_SCHEMA_VERSION,
    generatedAt,
    projectId,
    rawStoredGameCopies: rawCopies.length,
    normalizedLogicalGames: games.length,
    quarantinedLogicalGames: quarantineByFingerprint.size,
    duplicateCopiesRemoved,
    totalRounds,
    nonTerminalTrainingObservations: nonTerminalRounds,
    winners: {
      us: games.filter(game => game.winner === "us").length,
      dem: games.filter(game => game.winner === "dem").length,
    },
    transformations,
    libraries: summarizeLibraryDistribution(games, libraryRegistry.size),
    identity: {
      gamesWithBothTeamsIdentified: gamesWithCompleteIdentity,
      gamesWithoutBothTeamsIdentified: games.length - gamesWithCompleteIdentity,
      completeIdentityCoveragePct: games.length
        ? Number(((gamesWithCompleteIdentity / games.length) * 100).toFixed(1))
        : 0,
      gamesWithBothPlayerPairsIdentified: gamesWithCompletePlayerIdentity,
      completePlayerIdentityCoveragePct: games.length
        ? Number(((gamesWithCompletePlayerIdentity / games.length) * 100).toFixed(1))
        : 0,
      distinctPlayers: playerRegistry.size,
      ...summarizeTeamDistribution(games),
    },
    quarantineReasons: [...quarantineByFingerprint.values()].reduce((result, item) => {
      item.reasons.forEach(reason => {
        result[reason] = (result[reason] || 0) + 1;
      });
      return result;
    }, {}),
    guarantees: {
      firebaseMutated: false,
      rawIdentitiesExcluded: true,
      terminalRoundsMarked: true,
      strengthFeaturesUseOnlyEarlierGames: true,
    },
  };

  return { dataset, audit };
}

export function buildRepresentationWeights(games, gameIds, options = {}) {
  const targetGames = Math.max(1, Number(options.targetGames || 16));
  const minimumWeight = Math.min(1, Math.max(0.05, Number(options.minimumWeight || 0.5)));
  const selected = new Set(gameIds);
  const teamCounts = new Map();

  for (const game of games) {
    if (!selected.has(game.gameId)) continue;
    for (const side of ["us", "dem"]) {
      const teamId = game.teams?.[side]?.teamId;
      if (teamId) teamCounts.set(teamId, (teamCounts.get(teamId) || 0) + 1);
    }
  }

  const weights = new Map();
  for (const game of games) {
    if (!selected.has(game.gameId)) continue;
    const counts = ["us", "dem"]
      .map(side => teamCounts.get(game.teams?.[side]?.teamId) || 0)
      .filter(Boolean);
    const maximumTeamFrequency = counts.length ? Math.max(...counts) : 0;
    const rawWeight = maximumTeamFrequency > targetGames
      ? Math.sqrt(targetGames / maximumTeamFrequency)
      : 1;
    weights.set(game.gameId, Math.max(minimumWeight, Math.min(1, rawWeight)));
  }

  return { weights, teamCounts, targetGames, minimumWeight };
}

export const __test = {
  stableJson,
  normalizePlayerName,
  extractPlayers,
  normalizeGameCore,
  buildCoreFingerprint,
};
