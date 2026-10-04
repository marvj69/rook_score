const { test } = require('node:test');
const assert = require('node:assert/strict');

const { setupDomStubs } = require('./helpers/dom-stubs.cjs');

setupDomStubs();

const {
  setLocalStorage,
  getStatistics,
  buildStatsModel,
  getStatsModel,
  clearStatisticsCache,
  statsNormalizeGames,
  statsBuildBidBuckets,
  statsBidBucketIndex,
  statsComputeRatings,
  statsRankEntities,
  statsRankOf,
  statsPeriodBounds,
  statsPreviousBounds,
  statsLimitPerEntity,
  statsGateFor,
  statsCanonicalMetric,
  STATS_RANK_METRICS,
} = require('../js/app.js');

const { DAY, NOW, round, makeGame, quickWin } = require('./helpers/stats-fixtures.cjs');

const model = (games, options = {}) => buildStatsModel(games, { now: NOW, ...options });

test('games without rounds are ignored and the rest read oldest first', () => {
  const late = quickWin('us', NOW - 1 * DAY);
  const early = quickWin('dem', NOW - 9 * DAY);
  const records = statsNormalizeGames([late, { usPlayers: ['Ann', 'Bob'], rounds: [] }, null, 'junk', early]);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(rec => rec.index), [4, 0], 'the older game (stored last) comes first');
  assert.deepEqual(records.map(rec => rec.order), [0, 1]);
  assert.ok(records[0].time < records[1].time);
});

test('legacy team-name-only games, default labels, and single-name sides all resolve', () => {
  const legacy = {
    usTeamName: 'Zed & Yan', demTeamName: 'Xia & Wes', winner: 'us', timestamp: new Date(NOW - 3 * DAY).toISOString(),
    rounds: [round('us', 120, 130)], finalScore: { us: 505, dem: 100 },
  };
  const labels = quickWin('us', NOW - 2 * DAY, { us: ['', ''], dem: ['', ''] });
  labels.usTeamName = 'Us';
  labels.demTeamName = 'Dem';
  const solo = quickWin('dem', NOW - 1 * DAY, { us: ['Solo', ''], dem: ['Cy', 'Di'] });
  const result = model([legacy, labels, solo]);

  assert.equal(result.totals.games, 3, 'every game still counts toward the totals');
  assert.ok(result.teams.byKey.has('wes||xia'));
  assert.ok(result.players.byKey.has('zed'));
  assert.equal(result.teams.byKey.has(''), false, 'unnamed sides never become a team');
  assert.ok(result.teams.byKey.has('solo'));
  assert.equal(result.teams.byKey.get('solo').players.filter(Boolean).length, 1);
  assert.equal(result.players.byKey.get('solo').partners.length, 0);
});

test('a name repeated on one side counts once and the latest spelling wins', () => {
  const first = quickWin('us', NOW - 5 * DAY, { us: ['sam', 'Sam'], dem: ['Cy', 'Di'] });
  const second = quickWin('us', NOW - 2 * DAY, { us: ['Pat', 'Sam'], dem: ['Cy', 'Di'] });
  const result = model([first, second]);
  assert.equal(result.players.byKey.get('sam').gamesPlayed, 2);
  assert.equal(result.players.byKey.get('sam').name, 'Sam');
});

test('the score story counts lead changes, comebacks and the deciding hand', () => {
  const game = makeGame({
    at: NOW - DAY, winner: 'us',
    rounds: [
      round('dem', 120, 0, [50, 130]),
      round('us', 120, 0, [150, 30]),
      round('dem', 120, 0, [-120, 180]),
      round('us', 120, 0, [180, 20]),
      round('us', 130, 0, [250, 0]),
    ],
  });
  const [rec] = statsNormalizeGames([game]);
  assert.equal(rec.leadChanges, 3);
  assert.deepEqual(rec.maxLead, { us: 150, dem: 260 });
  assert.deepEqual(rec.maxLeadBeforeEnd, { us: 40, dem: 260 });
  assert.equal(rec.decidingHand, 5);
  assert.deepEqual(rec.biggestSwing, { hand: 3, amount: 300, side: 'dem' });
  assert.equal(rec.hands, 5);

  const result = model([game]);
  const ann = result.players.byKey.get('ann');
  assert.equal(ann.bigComebackWins, 1);
  assert.equal(ann.maxDeficitOvercome, 260);
  assert.equal(ann.wireToWireWins, 0);
  assert.equal(result.totals.comebackGames, 1);
  assert.equal(result.lists.comebacks[0].deficit, 260);
  assert.equal(result.recordBook.find(record => record.id === 'comeback').value, 260);
});

test('a side that never trails wins wire to wire; a tie at the start is not a lead', () => {
  const game = makeGame({
    at: NOW, rounds: [round('us', 100, 0, [120, 60]), round('us', 100, 0, [150, 30])], winner: 'us',
  });
  const [rec] = statsNormalizeGames([game]);
  assert.equal(rec.leadChanges, 0);
  assert.equal(rec.maxLeadBeforeEnd.dem, 0);
  assert.equal(rec.decidingHand, 1);
  assert.equal(model([game]).players.byKey.get('ann').wireToWireWins, 1);
});

test('a rule win can leave the winner behind on points', () => {
  const game = makeGame({
    at: NOW, winner: 'dem', final: { us: 550, dem: 505 },
    rounds: [round('us', 150, 0, [200, 0]), round('us', 150, 0, [-150, 180])],
  });
  const [rec] = statsNormalizeGames([game]);
  assert.equal(rec.wonBehind, true);
  const dem = model([game]).teams.byKey.get('cy||di');
  assert.equal(dem.wins, 1);
  assert.equal(dem.netPerGame, -45);
  assert.equal(dem.closeWins, 1);
});

test('table-talk penalties move points but never count as bids', () => {
  const game = makeGame({
    at: NOW, winner: 'us',
    rounds: [
      round('us', 120, 130),
      { biddingTeam: 'dem', bidAmount: 130, usPoints: 0, demPoints: -180, penalty: 'cheat', penaltyType: 'setPoints', penaltyAmount: 180 },
      round('us', 125, 140),
    ],
    final: { us: 520, dem: 40 },
  });
  const result = model([game]);
  assert.equal(result.totals.bidAttempts, 2, 'the penalty is not a bid');
  assert.equal(result.totals.rounds, 3);
  assert.equal(result.totals.hands, 2);
  assert.equal(result.totals.penalties, 1);
  const dem = result.teams.byKey.get('cy||di');
  assert.equal(dem.penalties, 1);
  assert.equal(dem.bidAttempts, 0);
  assert.equal(dem.setsForced, 0);
  assert.equal(result.teams.byKey.get('ann||bob').setsForced, 0, 'a penalty is not a set forced');
  assert.equal(result.recordBook.find(record => record.id === 'penalties').value, 1);
});

test('misdeals are credited only to players on the table', () => {
  const game = quickWin('us', NOW - DAY, { us: ['Ann', 'Bob'], dem: ['Cy', 'Di'] });
  game.misdealDealers = ['ann', 'Ann', 'Di', 'Stranger'];
  const result = model([game]);
  assert.equal(result.totals.misdeals, 4);
  assert.equal(result.players.byKey.get('ann').misdeals, 2);
  assert.equal(result.players.byKey.get('di').misdeals, 1);
  assert.equal(result.players.byKey.has('stranger'), false, 'no ghost players from stray names');
  assert.equal(result.teams.byKey.get('ann||bob').misdeals, 2);
  assert.equal(result.teams.byKey.get('cy||di').misdeals, 1);
});

test('bid buckets fold thin ends inward and every bid lands in exactly one', () => {
  const bids = [...Array(6).fill(120), ...Array(4).fill(125), ...Array(5).fill(130), ...Array(5).fill(140), 150, 155, 70];
  const buckets = statsBuildBidBuckets(bids);
  assert.deepEqual(buckets.map(bucket => bucket.label), ['≤125', '130–135', '140+']);
  assert.equal(statsBidBucketIndex(70, buckets), 0);
  assert.equal(statsBidBucketIndex(125, buckets), 0);
  assert.equal(statsBidBucketIndex(130, buckets), 1);
  assert.equal(statsBidBucketIndex(150, buckets), 2);
  assert.equal(statsBidBucketIndex(180, buckets), 2);
  const slam = statsBuildBidBuckets([...bids, 360]);
  assert.equal(slam[slam.length - 1].label, '360');
  assert.equal(statsBidBucketIndex(360, slam), slam.length - 1);
  assert.equal(statsBidBucketIndex(180, slam), slam.length - 2);
  assert.deepEqual(statsBuildBidBuckets([]), []);
  assert.deepEqual(statsBuildBidBuckets([360]).map(bucket => bucket.label), ['360']);
});

test('bid analytics tally make rate, points per hand and game situation', () => {
  const games = Array.from({ length: 6 }, (unused, i) => makeGame({
    at: NOW - (i + 1) * DAY, winner: 'us',
    rounds: [
      round('us', 120, 130), round('dem', 120, 60), round('us', 120, 130), round('us', 140, 0, [-140, 180]),
    ],
    final: { us: 500, dem: 300 },
  }));
  const { bids, totals } = model(games);
  const attempts = bids.buckets.reduce((sum, bucket) => sum + bucket.attempts, 0);
  assert.equal(attempts, totals.bidAttempts);
  assert.equal(totals.bidAttempts, 24);
  assert.equal(totals.bidsMade, 12);
  const at120 = bids.buckets.find(bucket => bucket.lo <= 120 && bucket.max >= 120);
  assert.deepEqual([at120.attempts, at120.made], [18, 12]);
  assert.ok(Math.abs(at120.makePct - (12 / 18) * 100) < 1e-9);
  const at140 = bids.buckets.find(bucket => bucket.lo <= 140 && bucket.max >= 140);
  assert.deepEqual([at140.attempts, at140.made], [6, 0]);
  assert.equal(at140.avgPoints, -140);
  assert.ok(bids.common[0].count >= bids.common[bids.common.length - 1].count);
  const situationTotal = ['trailing', 'even', 'leading'].reduce((sum, key) => sum + bids.situations[key].attempts, 0);
  assert.equal(situationTotal, totals.bidAttempts);
});

test('ratings follow Elo: equal sides trade 12 points and a rematch accounts for the new gap', () => {
  const g1 = quickWin('us', NOW - 3 * DAY);
  const g2 = quickWin('dem', NOW - 2 * DAY);
  const records = statsNormalizeGames([g1, g2]);
  const { players } = statsComputeRatings(records.slice(0, 1));
  assert.equal(players.get('ann').rating, 1012);
  assert.equal(players.get('cy').rating, 988);

  const both = statsComputeRatings(records);
  const expectedUs = 1 / (1 + 10 ** ((988 - 1012) / 400));
  assert.ok(Math.abs(both.players.get('ann').rating - (1012 - 24 * expectedUs)) < 1e-9);
  assert.ok(Math.abs(both.players.get('cy').rating - (988 + 24 * expectedUs)) < 1e-9);
  const total = [...both.players.values()].reduce((sum, player) => sum + (player.rating - 1000), 0);
  assert.ok(Math.abs(total) < 1e-9, 'with two players a side, ratings only move between players');
  assert.equal(both.teamHistory.get('ann||bob').length, 2);
  assert.equal(both.teamHistory.get('ann||bob')[0].after, 1012);
});

test('games with no winner or an unnamed side leave ratings alone', () => {
  const tied = quickWin('us', NOW - DAY);
  tied.winner = '';
  tied.finalScore = { us: 300, dem: 300 };
  const unnamed = quickWin('us', NOW - 2 * DAY, { us: ['', ''], dem: ['Cy', 'Di'] });
  const ratings = statsComputeRatings(statsNormalizeGames([tied, unnamed]));
  assert.equal(ratings.players.size, 0);
  const tiedModel = model([tied]);
  assert.equal(tiedModel.teams.byKey.get('ann||bob').wins, 0);
  assert.equal(tiedModel.teams.byKey.get('ann||bob').losses, 0);
  assert.equal(tiedModel.teams.byKey.get('ann||bob').gamesPlayed, 1);
});

test('streaks, form and longest runs read the results in order', () => {
  const order = ['us', 'us', 'dem', 'us', 'us', 'us'];
  const games = order.map((winner, i) => quickWin(winner, NOW - (order.length - i) * DAY));
  const ann = model(games).players.byKey.get('ann');
  assert.deepEqual(ann.form, ['W', 'W', 'L', 'W', 'W', 'W']);
  assert.deepEqual(ann.streak, { type: 'W', length: 3 });
  assert.equal(ann.streakValue, 3);
  assert.equal(ann.longestWinStreak.length, 3);
  assert.equal(ann.longestLossStreak.length, 1);
  const cy = model(games).players.byKey.get('cy');
  assert.deepEqual(cy.streak, { type: 'L', length: 3 });
  assert.equal(cy.streakValue, -3);
  assert.equal(STATS_RANK_METRICS.streak.format(-3), 'L3');
  assert.equal(STATS_RANK_METRICS.streak.format(4), 'W4');
});

test('partners and opponents are symmetric head-to-head records', () => {
  const games = [
    quickWin('us', NOW - 6 * DAY),
    quickWin('dem', NOW - 5 * DAY),
    quickWin('us', NOW - 4 * DAY, { us: ['Ann', 'Eve'], dem: ['Cy', 'Di'] }),
    quickWin('dem', NOW - 3 * DAY, { us: ['Ann', 'Eve'], dem: ['Cy', 'Di'] }),
    quickWin('us', NOW - 2 * DAY, { us: ['Ann', 'Eve'], dem: ['Cy', 'Di'] }),
  ];
  const result = model(games);
  const ann = result.players.byKey.get('ann');
  const withBob = ann.partners.find(partner => partner.key === 'bob');
  const withEve = ann.partners.find(partner => partner.key === 'eve');
  assert.deepEqual([withBob.games, withBob.wins, withBob.losses], [2, 1, 1]);
  assert.deepEqual([withEve.games, withEve.wins, withEve.losses], [3, 2, 1]);
  assert.equal(ann.partners[0].key, 'eve', 'most games together first');

  result.teams.list.forEach(team => {
    team.opponents.forEach(entry => {
      const mirror = result.teams.byKey.get(entry.key).opponents.find(other => other.key === team.key);
      assert.equal(mirror.games, entry.games);
      assert.equal(mirror.wins, entry.losses);
      assert.equal(mirror.losses, entry.wins);
    });
  });
  const annVsCy = ann.opponents.find(entry => entry.key === 'cy');
  assert.equal(annVsCy.games, 5);
  assert.equal(annVsCy.wins, ann.wins);
});

test('ranking holds back small samples and flips with the direction', () => {
  const veteran = Array.from({ length: 4 }, (unused, i) => quickWin(i < 3 ? 'us' : 'dem', NOW - (10 - i) * DAY));
  const rookie = quickWin('us', NOW - DAY, { us: ['New', 'Kid'], dem: ['Cy', 'Di'] });
  const result = model([...veteran, rookie]);
  const rows = statsRankEntities(result.players.list, 'winPct');
  const newcomer = rows.find(row => row.entity.key === 'new');
  assert.equal(newcomer.qualified, false, 'a 1-0 record cannot top the board');
  assert.equal(newcomer.rank, 0);
  assert.equal(rows.findIndex(row => row.entity.key === 'new') > rows.findIndex(row => row.qualified && row.entity.key === 'ann'), true);
  assert.ok(rows.filter(row => row.qualified).every((row, i) => row.rank === i + 1));

  const ascending = statsRankEntities(result.players.list, 'winPct', 'asc').filter(row => row.qualified);
  assert.ok(ascending[0].value <= ascending[ascending.length - 1].value);
  const ann = result.players.byKey.get('ann');
  assert.ok(statsRankOf(result.players.list, ann, 'winPct').rank >= 1);
  assert.equal(statsRankOf(result.players.list, result.players.byKey.get('new'), 'winPct'), null);
  assert.equal(statsCanonicalMetric('bidSuccessPct'), 'bidMakePct');
  assert.equal(statsCanonicalMetric('360s'), 'perfect360s');
  assert.equal(statsCanonicalMetric('nonsense'), '');
  assert.equal(STATS_RANK_METRICS.winPct.format(66.66), '67%');
});

test('periods keep only games in the window and expose the one before it', () => {
  const games = [
    quickWin('us', NOW - 5 * DAY), quickWin('us', NOW - 20 * DAY), quickWin('dem', NOW - 40 * DAY),
    quickWin('us', NOW - 55 * DAY), quickWin('us', NOW - 120 * DAY),
  ];
  games.push({ ...quickWin('us', NOW), timestamp: 'garbage' });
  assert.equal(model(games).totals.games, 6);
  const d30 = model(games, { period: 'd30' });
  assert.equal(d30.totals.games, 2);
  assert.equal(d30.previous.games, 2, '31–60 days ago');
  assert.equal(model(games, { period: 'd90' }).totals.games, 4);
  const year = model(games, { period: 'year' });
  assert.equal(year.totals.games, 5, 'a game with no readable date is outside any window');
  assert.equal(year.previous.games, 0);
  assert.equal(statsPeriodBounds('all', NOW), null);
  assert.equal(statsPreviousBounds('all', NOW), null);
  assert.equal(model(games).previous, null);
  const bounds = statsPreviousBounds('d30', NOW);
  assert.equal(bounds.to, NOW - 30 * DAY - 1);
  assert.equal(bounds.from, NOW - 60 * DAY);
  const recent = model(games).recent;
  assert.deepEqual([recent.last30, recent.prev30], [2, 2]);
});

test('a period keeps all-time ratings but charts only the games inside it', () => {
  const games = Array.from({ length: 6 }, (unused, i) => quickWin('us', NOW - (60 - i * 10) * DAY));
  const all = model(games).players.byKey.get('ann');
  const recent = model(games, { period: 'd30' }).players.byKey.get('ann');
  assert.equal(recent.rating, all.rating, 'the rating is as of the latest game either way');
  assert.equal(all.ratingHistory.length, 6);
  assert.equal(recent.ratingHistory.length, 3);
  assert.equal(recent.ratingStart, recent.ratingHistory[0].before);
});

test('records name the extremes and point at their games', () => {
  const blowout = quickWin('us', NOW - 4 * DAY);
  const nailBiter = makeGame({
    at: NOW - 3 * DAY, winner: 'dem', minutes: 70,
    rounds: [round('dem', 130, 140), round('us', 120, 130), round('dem', 125, 135)],
    final: { us: 495, dem: 500 },
  });
  const result = model([blowout, nailBiter]);
  const byId = Object.fromEntries(result.recordBook.map(record => [record.id, record]));
  assert.equal(byId.highScore.value, 520);
  assert.equal(byId.highScore.game, 0);
  assert.equal(byId.closest.value, 5);
  assert.equal(byId.closest.game, 1);
  assert.equal(byId.blowout.value, 320);
  assert.equal(byId.longest.value, 70 * 60000);
  assert.equal(byId.bidMade.value, 130, 'the biggest bid that was made');
  assert.equal(byId.bidSet, undefined, 'no bid was ever set, so there is no set record');
  assert.equal(result.lists.closest[0].index, 1);
  assert.equal(result.lists.blowouts[0].index, 0);
});

test('insights only speak when there is enough behind them', () => {
  const few = model([quickWin('us', NOW - DAY), quickWin('us', NOW - 2 * DAY)]);
  const ids = few.insights.map(insight => insight.id);
  assert.equal(ids.includes('leader'), false);
  assert.equal(ids.includes('pair'), false);
  assert.equal(ids.includes('sweetSpot'), false);
  assert.equal(ids.includes('hot'), false, 'two wins is not a streak worth announcing');

  const run = model(Array.from({ length: 5 }, (unused, i) => quickWin('us', NOW - (5 - i) * DAY)));
  const hot = run.insights.find(insight => insight.id === 'hot');
  assert.ok(hot);
  assert.match(hot.title, /5-game win streak/);
  assert.ok(run.insights.every((insight, i, list) => i === 0 || list[i - 1].score >= insight.score), 'best insight first');
  assert.ok(run.insights.every(insight => insight.title && insight.detail && insight.tone && insight.icon));
});

test('the model is cached until the library changes', () => {
  clearStatisticsCache();
  setLocalStorage('savedGames', [quickWin('us', NOW - DAY)], { sync: false });
  const first = getStatsModel({ now: NOW });
  assert.equal(getStatsModel({ now: NOW }), first);
  assert.notEqual(getStatsModel({ now: NOW, period: 'd30' }), first);
  setLocalStorage('savedGames', [quickWin('us', NOW - DAY), quickWin('dem', NOW - 2 * DAY)], { sync: false });
  const second = getStatsModel({ now: NOW });
  assert.notEqual(second, first);
  assert.equal(second.totals.games, 2);
  assert.equal(getStatistics().totalGames, 2);
});

test('empty and malformed libraries produce an empty model, not an error', () => {
  for (const input of [[], null, undefined, 'bad', [null, 5, 'x', {}, { rounds: 'no' }]]) {
    const result = buildStatsModel(input, { now: NOW });
    assert.equal(result.totals.games, 0);
    assert.equal(result.players.list.length, 0);
    assert.deepEqual(result.insights, []);
    assert.deepEqual(result.recordBook, []);
    assert.deepEqual(result.buckets, []);
  }
});

// --- Invariants and an independent recount, over a big varied library ---
const { sampleLibrary } = require('./helpers/stats-fixtures.cjs');
const SEVEN = ['Ann', 'Bob', 'Cy', 'Di', 'Eve', 'Flo', 'Gus'];

// Seven players make every pairing possible, but sampleLibrary only seats four at a time.
function crowdedLibrary(count, seed = 1) {
  const names = SEVEN;
  const games = [];
  let state = seed * 7919;
  const rand = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
  const base = sampleLibrary(count, ['Ann', 'Bob', 'Cy', 'Di']);
  base.forEach((game, i) => {
    const order = [...names].sort(() => rand() - 0.5).slice(0, 4);
    const copy = { ...game, usPlayers: [order[0], order[1]].sort(), demPlayers: [order[2], order[3]].sort() };
    copy.usTeamName = copy.usPlayers.join(' & ');
    copy.demTeamName = copy.demPlayers.join(' & ');
    copy.timestamp = new Date(NOW - (count - i) * 1.7 * DAY).toISOString();
    games.push(copy);
  });
  return games;
}

test('wins, losses, games and bids add up across players, teams and the whole library', () => {
  const games = crowdedLibrary(160);
  const m = model(games);
  const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0);
  const decided = m.records.filter(rec => rec.winner).length;

  assert.equal(m.totals.games, 160);
  assert.equal(sum(m.teams.list, e => e.gamesPlayed), 2 * 160);
  assert.equal(sum(m.players.list, e => e.gamesPlayed), 4 * 160);
  assert.equal(sum(m.teams.list, e => e.wins), decided);
  assert.equal(sum(m.teams.list, e => e.losses), decided);
  assert.equal(sum(m.players.list, e => e.wins), 2 * decided);
  assert.equal(sum(m.players.list, e => e.losses), 2 * decided);
  assert.equal(sum(m.teams.list, e => e.bidAttempts), m.totals.bidAttempts);
  assert.equal(sum(m.players.list, e => e.bidAttempts), 2 * m.totals.bidAttempts);
  assert.equal(sum(m.teams.list, e => e.bidsMade), m.totals.bidsMade);
  assert.equal(sum(m.teams.list, e => e.setsForced), m.totals.bidsSet, 'every failed bid is a set forced by the other side');
  assert.equal(sum(m.teams.list, e => e.bidBuckets.reduce((n, slot) => n + slot.attempts, 0)), m.totals.bidAttempts);
  assert.equal(m.bids.buckets.reduce((n, bucket) => n + bucket.attempts, 0), m.totals.bidAttempts);
  assert.equal(m.totals.methods.bid + m.totals.methods.set + m.totals.methods.spread + m.totals.methods.other, decided);
  assert.equal(m.totals.margins.reduce((a, b) => a + b, 0), 160);

  for (const entity of [...m.teams.list, ...m.players.list]) {
    assert.ok(entity.wins + entity.losses <= entity.gamesPlayed, entity.name);
    assert.ok(entity.winPercentNumber >= 0 && entity.winPercentNumber <= 100, entity.name);
    assert.equal(entity.results.length, entity.gamesPlayed);
    assert.ok(entity.form.length <= 10);
    assert.equal(entity.form[entity.form.length - 1] === 'W', entity.streak.type === 'W', 'the form strip ends where the streak says');
    assert.ok(entity.longestWinStreak.length >= (entity.streak.type === 'W' ? entity.streak.length : 0));
    assert.ok(entity.bidsMade + entity.bidsSet === entity.bidAttempts);
    assert.ok(entity.ratingHistory.length <= entity.gamesPlayed);
    for (const value of [entity.netPerGame, entity.rating, entity.winPercentNumber]) assert.ok(Number.isFinite(value), entity.name);
  }
});

test('with two players a side, ratings only move between players, and head-to-head records mirror each other', () => {
  const m = model(crowdedLibrary(160, 3));
  const drift = m.players.list.reduce((total, player) => total + (player.rating - 1000), 0);
  assert.ok(Math.abs(drift) < 1e-6, `ratings drifted by ${drift}`);

  for (const player of m.players.list) {
    for (const entry of player.opponents) {
      const mirror = m.players.byKey.get(entry.key).opponents.find(other => other.key === player.key);
      assert.deepEqual([mirror.games, mirror.wins, mirror.losses], [entry.games, entry.losses, entry.wins], `${player.name} vs ${entry.name}`);
    }
    for (const entry of player.partners) {
      const mirror = m.players.byKey.get(entry.key).partners.find(other => other.key === player.key);
      assert.deepEqual([mirror.games, mirror.wins, mirror.losses], [entry.games, entry.wins, entry.losses], `${player.name} with ${entry.name}`);
    }
  }
});

test('an independent recount of every team matches the model', () => {
  const games = crowdedLibrary(120, 5);
  const m = model(games);
  for (const team of m.teams.list) {
    let played = 0, wins = 0, bids = 0, made = 0, forced = 0, bidPoints = 0, closeWins = 0, pointsFor = 0;
    games.forEach(game => {
      const keyOf = players => [...players].map(name => name.toLowerCase()).sort().join('||');
      const side = keyOf(game.usPlayers) === team.key ? 'us' : keyOf(game.demPlayers) === team.key ? 'dem' : '';
      if (!side) return;
      const other = side === 'us' ? 'dem' : 'us';
      played++;
      pointsFor += game.finalScore[side];
      if (game.winner === side) {
        wins++;
        if (Math.abs(game.finalScore.us - game.finalScore.dem) <= 50) closeWins++;
      }
      game.rounds.forEach(roundEntry => {
        const bidder = roundEntry.biddingTeam;
        const points = roundEntry[`${bidder}Points`];
        if (bidder === side) {
          bids++;
          bidPoints += points;
          if (points >= roundEntry.bidAmount) made++;
        } else if (bidder === other && points < roundEntry.bidAmount) forced++;
      });
    });
    assert.deepEqual(
      [team.gamesPlayed, team.wins, team.bidAttempts, team.bidsMade, team.setsForced, team.bidPointsTotal, team.closeWins, team.totalPointsFor],
      [played, wins, bids, made, forced, bidPoints, closeWins, pointsFor],
      team.name,
    );
  }
});

test('narrower periods never have more games, and the same input always gives the same model', () => {
  const games = crowdedLibrary(100, 9);
  const counts = ['d30', 'd90', 'year', 'all'].map(period => model(games, { period }).totals.games);
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b));
  const again = (period) => JSON.stringify(model(games, { period }).totals);
  assert.equal(again('all'), again('all'));
  const a = model(games);
  const b = model(JSON.parse(JSON.stringify(games)));
  assert.equal(JSON.stringify(a.insights), JSON.stringify(b.insights));
  assert.equal(JSON.stringify(a.recordBook), JSON.stringify(b.recordBook));
  assert.equal(JSON.stringify(a.players.list.map(p => [p.key, p.rating, p.wins])), JSON.stringify(b.players.list.map(p => [p.key, p.rating, p.wins])));
});

test('a thousand games build in well under a second', () => {
  const games = crowdedLibrary(1000, 11);
  const started = process.hrtime.bigint();
  const m = model(games);
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(m.totals.games, 1000);
  assert.ok(elapsed < 1500, `took ${elapsed.toFixed(0)}ms`);
});

test('highlights never let one player or team fill the list', () => {
  const about = (id, key) => ({ id, action: key ? { entity: { kind: 'player', key } } : { tab: 'bidding' } });
  const kept = statsLimitPerEntity([about('a', 'ann'), about('b', 'ann'), about('c', 'ann'), about('d'), about('e', 'bob'), about('f', 'ann'), about('g')], 2);
  assert.deepEqual(kept.map(item => item.id), ['a', 'b', 'd', 'e', 'g']);
});

test('every game is replayed hand by hand through the win-probability model', () => {
  const comeback = makeGame({
    at: NOW - DAY, winner: 'us',
    rounds: [
      round('dem', 150, 0, [-150, 180]), round('dem', 150, 0, [30, 150]), round('dem', 140, 0, [20, 160]),
      round('us', 130, 0, [140, 40]), round('us', 140, 0, [180, 0]), round('us', 150, 0, [200, -150]),
    ],
  });
  const gentle = makeGame({
    at: NOW - 2 * DAY, winner: 'us',
    rounds: [round('us', 100, 0, [120, 60]), round('us', 100, 0, [130, 50]), round('us', 100, 0, [140, 40]), round('us', 100, 0, [150, 30]), round('us', 100, 0, [160, 20])],
  });
  const [rec, calm] = statsNormalizeGames([comeback, gentle]).sort((a, b) => a.index - b.index);
  assert.equal(rec.winChances.length, rec.rounds.length + 1);
  assert.ok(rec.winChances.every(chance => chance > 0 && chance < 1));
  assert.equal(rec.winChances[0], 0.5);
  assert.ok(rec.upset.chance < 0.25, `the winner was a long shot (${rec.upset.chance.toFixed(3)})`);
  assert.ok(calm.upset.chance > 0.5, `the front-runner never was (${calm.upset.chance.toFixed(3)})`);
  assert.ok(rec.upset.hand >= 1 && rec.upset.hand < rec.rounds.length, 'measured before the last hand');
  assert.ok(Math.abs(rec.turningPoint.change) > 0.1);

  const m = model([comeback, gentle]);
  assert.equal(m.teams.byKey.get('ann||bob').upsetWins, 1);
  assert.equal(m.recordBook.find(record => record.id === 'upset').game, rec.index);
  assert.equal(m.lists.upsets[0].index, rec.index);
  assert.ok(m.insights.some(insight => insight.id === 'upset'));
  assert.ok(m.teams.byKey.get('ann||bob').lowestWinChance < 0.25);
  const dull = model([gentle]);
  assert.equal(dull.recordBook.find(record => record.id === 'upset'), undefined, 'no upset when the winner was always ahead');
});

test('a hundred-game library keeps win chances sane for every game', () => {
  const m = model(crowdedLibrary(100, 4));
  for (const rec of m.records) {
    assert.ok(rec.winChances.every(chance => chance >= 0.001 && chance <= 0.999));
    if (rec.winner) assert.ok(rec.upset === null || (rec.upset.chance >= 0.001 && rec.upset.chance <= 0.999));
  }
  for (const entity of [...m.players.list, ...m.teams.list]) assert.ok(entity.upsetWins <= entity.wins);
});

test('how many games count as enough grows with the busiest player, within limits', () => {
  const people = (...counts) => counts.map(([gamesPlayed, bidAttempts], i) => ({ name: `P${i}`, gamesPlayed, bidAttempts }));
  assert.deepEqual(statsGateFor(people([128, 450], [4, 9])), { games: 10, bids: 23 });
  assert.deepEqual(statsGateFor(people([12, 40])), { games: 3, bids: 8 }, 'small groups keep the floor');
  assert.deepEqual(statsGateFor(people([50, 100])), { games: 5, bids: 8 });
  assert.deepEqual(statsGateFor(people([900, 4000])), { games: 10, bids: 30 }, 'and never more than the cap');
  assert.deepEqual(statsGateFor([]), { games: 3, bids: 8 });
});

test('a 4-0 newcomer cannot top a board where one player has played a hundred games', () => {
  const entity = (name, gamesPlayed, winPercentNumber) => ({ name, key: name, gamesPlayed, winPercentNumber, bidAttempts: gamesPlayed * 4, rating: 1000, wins: 0, losses: 0, netPerGame: 0, bidMakePct: 50 });
  const rows = statsRankEntities([entity('Hot', 4, 100), entity('Regular', 30, 70), entity('Veteran', 128, 55), entity('Few', 9, 90)], 'winPct');
  assert.deepEqual(rows.filter(row => row.qualified).map(row => row.entity.name), ['Regular', 'Veteran'], 'ten games to qualify here');
  assert.deepEqual(rows.map(row => row.entity.name).slice(0, 2), ['Regular', 'Veteran']);
  const small = statsRankEntities([entity('Hot', 4, 100), entity('Regular', 12, 70)], 'winPct');
  assert.deepEqual(small.filter(row => row.qualified).map(row => row.entity.name), ['Hot', 'Regular'], 'with a small group three games is enough');
});

test('a timer left running does not become a 60-hour game', () => {
  const normal = quickWin('us', NOW - 4 * DAY);
  const forgotten = quickWin('dem', NOW - 2 * DAY);
  forgotten.durationMs = 83 * 3600000;
  const quick = quickWin('us', NOW - DAY);
  quick.durationMs = 20 * 60000;
  const records = statsNormalizeGames([normal, forgotten, quick]);
  assert.deepEqual(records.map(rec => rec.durationMs), [30 * 60000, 0, 20 * 60000]);
  const m = model([normal, forgotten, quick]);
  assert.equal(m.totals.timeMs, 50 * 60000);
  assert.equal(m.totals.timedGames, 2);
  assert.equal(m.totals.avgGameMs, 25 * 60000, 'averaged over the games that have a real length');
  const ann = m.players.byKey.get('ann');
  assert.equal(ann.timedGames, 2);
  assert.equal(ann.avgGameTimeMs, 25 * 60000);
  const longest = m.recordBook.find(record => record.id === 'longest');
  assert.equal(longest.value, 30 * 60000, 'the forgotten game never becomes the longest');
});

// --- Review fixes ---

const penaltyHand = (side, amount = 180) => ({
  biddingTeam: side === 'us' ? 'dem' : 'us', bidAmount: 130,
  usPoints: side === 'us' ? -amount : 0, demPoints: side === 'dem' ? -amount : 0,
  penalty: 'cheat', penaltyType: 'setPoints', penaltyAmount: amount,
});
const penaltyGame = (i, us, dem, penalized = 'dem') => makeGame({
  us, dem, at: NOW - (8 - i) * DAY, winner: 'us', final: { us: 520, dem: 40 },
  rounds: [round('us', 120, 130), penaltyHand(penalized), round('us', 125, 140)],
});

test('a record that partners share names both of them rather than whoever sorted first', () => {
  const together = [0, 1, 2].map(i => penaltyGame(i, ['Ann', 'Bob'], ['Yan', 'Zed']));
  const shared = model(together).recordBook.find(record => record.id === 'penalties');
  assert.equal(shared.value, 3);
  assert.equal(shared.holder, 'Yan and Zed');
  assert.equal(shared.entity, undefined, 'two holders leave no single profile to open');

  const alone = [0, 1, 2].map(i => penaltyGame(i, ['Ann', 'Bob'], ['Yan']));
  const single = model(alone).recordBook.find(record => record.id === 'penalties');
  assert.equal(single.holder, 'Yan');
  assert.deepEqual(single.entity, { kind: 'player', key: 'yan' }, 'one holder still opens their profile');

  const everyone = [0, 1].flatMap(i => [penaltyGame(i, ['Ann', 'Bob'], ['Yan', 'Zed'], 'dem'), penaltyGame(i + 2, ['Ann', 'Bob'], ['Yan', 'Zed'], 'us')]);
  const crowd = model(everyone).recordBook.find(record => record.id === 'penalties');
  assert.match(crowd.holder, /^\w+, \w+ and 2 more$/, 'a long tie stays short enough for a tile');
});

test('a name entered on both sides is credited to neither side, and the game still counts', () => {
  const clash = makeGame({
    us: ['Ann', 'Bob'], dem: ['Ann', 'Cy'], at: NOW - DAY, winner: 'us', final: { us: 520, dem: 200 },
    rounds: [round('us', 120, 140), round('us', 130, 150)],
  });
  const result = model([clash]);
  assert.equal(result.totals.games, 1);
  assert.equal(result.players.byKey.has('ann'), false, 'no one can say which side Ann played for');
  const bob = result.players.byKey.get('bob');
  const cy = result.players.byKey.get('cy');
  assert.deepEqual([bob.gamesPlayed, bob.wins, cy.gamesPlayed, cy.losses], [1, 1, 1, 1]);
  assert.equal(bob.partners.length, 0, 'with Ann pulled out, Bob has no partner to credit');
  assert.ok(Math.abs((bob.rating - 1000) + (cy.rating - 1000)) < 1e-9, 'ratings still move between the two who can be credited');
});

test('the model cache turns over at local midnight, whatever the time zone', () => {
  setLocalStorage('savedGames', [quickWin('us', new Date(2026, 11, 31, 12).getTime())], { sync: false });
  clearStatisticsCache();
  const midnight = new Date(2027, 0, 1).getTime();
  const before = getStatsModel({ period: 'year', now: midnight - 60000 });
  const after = getStatsModel({ period: 'year', now: midnight + 60000 });
  assert.notEqual(before, after, 'a new local day builds a new model');
  assert.equal(before.records.length, 1);
  assert.equal(after.records.length, 0, 'and "this year" no longer includes last year\'s game');
  assert.equal(getStatsModel({ period: 'year', now: midnight + 120000 }), after, 'the same local day reuses it');
  setLocalStorage('savedGames', [], { sync: false });
  clearStatisticsCache();
});
