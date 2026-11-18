import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { __test as exportReader } from "../scripts/export-live-rook-training-data.mjs";

import {
  buildRepresentationWeights,
  normalizeTrainingSnapshot,
} from "../scripts/rook-training-normalizer.mjs";

function completedGame(overrides = {}) {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    winner: "us",
    victoryMethod: "Won on Bid",
    usPlayers: ["Marv", "Ethan"],
    demPlayers: ["Alex", "Sam"],
    rounds: [
      {
        roundIndex: 0,
        biddingTeam: "Us",
        bidAmount: "120",
        usPoints: "125",
        demPoints: "55",
        runningTotals: { us: "125", dem: "55" },
      },
      {
        roundIndex: 1,
        biddingTeam: "dem",
        bidAmount: 125,
        usPoints: 180,
        demPoints: -125,
        runningTotals: { us: 305, dem: -70 },
      },
    ],
    finalScore: { us: 305, dem: -70 },
    ...overrides,
  };
}

test("normalizer deduplicates model-identical cloud copies and removes raw identities", () => {
  const game = completedGame();
  const identityVariant = {
    ...completedGame(),
    usPlayers: ["Ethan", "Marv"],
    usTeamName: "Ethan & Marv",
  };
  const result = normalizeTrainingSnapshot([
    { sourceKey: "source_a", games: [game] },
    { sourceKey: "source_b", games: [identityVariant] },
  ], { projectId: "test-project", generatedAt: "2026-01-03T00:00:00.000Z" });

  assert.equal(result.audit.rawStoredGameCopies, 2);
  assert.equal(result.audit.normalizedLogicalGames, 1);
  assert.equal(result.audit.duplicateCopiesRemoved, 1);
  assert.equal(result.audit.quarantinedLogicalGames, 0);
  assert.equal(result.audit.nonTerminalTrainingObservations, 1);
  assert.equal(result.dataset.games[0].provenance.sourceCopies, 2);
  assert.deepEqual(result.dataset.games[0].provenance.libraryIds, ["library_001", "library_002"]);
  assert.equal(result.dataset.games[0].rounds[0].biddingTeam, "us");
  assert.deepEqual(result.dataset.games[0].startingTotals, { us: 0, dem: 0 });
  assert.equal(result.dataset.games[0].rounds[0].terminal, false);
  assert.equal(result.dataset.games[0].rounds[1].terminal, true);

  const serialized = JSON.stringify(result.dataset).toLowerCase();
  assert.doesNotMatch(serialized, /marv|ethan|alex|sam/);
  assert.equal(result.dataset.privacy.rawPlayerNamesIncluded, false);
  assert.equal(result.dataset.privacy.rawSourceDocumentIdsIncluded, false);
  assert.doesNotMatch(serialized, /source_a|source_b/);

  const reversed = normalizeTrainingSnapshot([
    { sourceKey: "source_b", games: [identityVariant] },
    { sourceKey: "source_a", games: [game] },
  ], { projectId: "test-project", generatedAt: "2026-01-03T00:00:00.000Z" });
  assert.deepEqual(reversed, result);
});

test("rolling strength uses only games completed before the current game", () => {
  const first = completedGame();
  const second = completedGame({
    timestamp: "2026-01-02T00:00:00.000Z",
    finalScore: { us: 305, dem: -70 },
  });
  const result = normalizeTrainingSnapshot([
    { sourceKey: "source_a", games: [second, first] },
  ], { generatedAt: "2026-01-03T00:00:00.000Z" });

  const [normalizedFirst, normalizedSecond] = result.dataset.games;
  assert.equal(normalizedFirst.pregameStrength.usTeamPriorGames, 0);
  assert.equal(normalizedFirst.pregameStrength.usTeamPriorWinRate, 0.5);
  assert.equal(normalizedFirst.pregameStrength.eloExpectedUsWin, 0.5);
  assert.equal(normalizedSecond.pregameStrength.usTeamPriorGames, 1);
  assert.ok(normalizedSecond.pregameStrength.usTeamPriorWinRate > 0.5);
  assert.ok(normalizedSecond.pregameStrength.eloExpectedUsWin > 0.5);
});

test("legacy team identities remain usable without exposing their display names", () => {
  const legacy = completedGame({
    usPlayers: ["Marv + Ethan"],
    demPlayers: [],
    usTeamName: "Marv + Ethan",
    demTeamName: "Kitchen Crew",
  });
  const result = normalizeTrainingSnapshot([{ sourceKey: "source_a", games: [legacy] }]);
  const game = result.dataset.games[0];

  assert.equal(game.teams.us.identityAvailable, true);
  assert.equal(game.teams.us.playerIdentityAvailable, true);
  assert.equal(game.teams.dem.identityAvailable, true);
  assert.equal(game.teams.dem.playerIdentityAvailable, false);
  assert.equal(result.audit.identity.gamesWithBothTeamsIdentified, 1);
  assert.doesNotMatch(JSON.stringify(result.dataset).toLowerCase(), /marv|ethan|kitchen/);
});

test("invalid games are quarantined instead of repaired with invented outcomes", () => {
  const invalid = completedGame({ winner: null, finalScore: null });
  const result = normalizeTrainingSnapshot([
    { sourceKey: "source_a", games: [invalid] },
  ]);

  assert.equal(result.dataset.games.length, 0);
  assert.equal(result.dataset.quarantine.length, 1);
  assert.match(result.dataset.quarantine[0].reasons.join(","), /invalid_winner/);
  assert.match(result.dataset.quarantine[0].reasons.join(","), /missing_final_score/);
});

test("team representation weighting depends on frequency and never outcomes", () => {
  const games = [];
  for (let index = 0; index < 20; index += 1) {
    const game = completedGame({ timestamp: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z` });
    games.push(game);
  }
  const result = normalizeTrainingSnapshot([{ sourceKey: "source_a", games }]);
  const gameIds = result.dataset.games.map(game => game.gameId);
  const weighted = buildRepresentationWeights(result.dataset.games, gameIds, {
    targetGames: 5,
    minimumWeight: 0.4,
  });

  assert.equal(weighted.weights.size, 20);
  for (const weight of weighted.weights.values()) {
    assert.equal(weight, 0.5);
  }

  const reversedOutcomes = result.dataset.games.map(game => ({
    ...game,
    winner: game.winner === "us" ? "dem" : "us",
  }));
  const reversed = buildRepresentationWeights(reversedOutcomes, gameIds, {
    targetGames: 5,
    minimumWeight: 0.4,
  });
  assert.deepEqual([...reversed.weights.values()], [...weighted.weights.values()]);
});

test("the training reader respects packed reset cutoffs, removals and later restores", () => {
  const reset = "2026-11-03T00:00:00.000Z";
  const removed = Date.parse("2026-11-05T00:00:00.000Z");
  const old = { id: "old", timestamp: "2026-11-01T00:00:00.000Z" };
  const keep = { id: "keep", timestamp: "2026-11-04T00:00:00.000Z" };
  const deleted = { ...keep, id: "deleted" };
  const restored = { ...keep, id: "restored" };
  const data = {
    gameDataResetAt: reset,
    savedGamesPacked: ["gzip-json-v1;", gzipSync(JSON.stringify([old, keep, deleted, restored])).toString("base64")],
    savedGames: [{ ...restored, restoredAt: "2026-11-06T00:00:00.000Z" }],
    removedGames: [deleted, restored].map(game => ({ list: "savedGames", key: game.id, at: removed })),
  };
  assert.deepEqual(exportReader.readSavedGames(data).map(game => game.id), ["keep", "restored"]);
});

test("a damaged library is counted and the export continues with other accounts", () => {
  const result = exportReader.collectTrainingSources([
    { document: { name: "demo/broken", fields: { savedGamesPacked: { stringValue: "incomplete" } } } },
    { document: { name: "demo/good", fields: { savedGames: { arrayValue: {} } } } },
  ]);
  assert.equal(result.unreadableLibraries, 1);
  assert.equal(result.sources.length, 1);
  assert.ok(result.sources[0].sourceKey.startsWith("source_"));
});
