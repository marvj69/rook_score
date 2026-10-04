// Shared by the statistics test files. Rounds are written the way a table would
// call them: who bid, what they bid, and how many points that side took. The
// points follow the app's own rules.
const DAY = 86400000;
const NOW = Date.parse('2026-10-04T18:00:00.000Z');

function round(by, bid, took, raw) {
  const other = by === 'us' ? 'dem' : 'us';
  const points = { us: 0, dem: 0 };
  if (raw) {
    points.us = raw[0];
    points.dem = raw[1];
  } else if (took === 360) {
    points[by] = 360;
  } else {
    points[other] = 180 - took;
    points[by] = took >= bid ? took : -bid;
  }
  return { biddingTeam: by, bidAmount: bid, usPoints: points.us, demPoints: points.dem };
}

function makeGame({ us = ['Ann', 'Bob'], dem = ['Cy', 'Di'], rounds, winner, at, minutes = 30, final, extra = {} }) {
  let totals = { us: 0, dem: 0 };
  const built = rounds.map((entry, roundIndex) => {
    totals = { us: totals.us + entry.usPoints, dem: totals.dem + entry.demPoints };
    return { roundIndex, ...entry, runningTotals: { ...totals } };
  });
  return {
    usTeamName: us.join(' & '), demTeamName: dem.join(' & '),
    usPlayers: us, demPlayers: dem,
    rounds: built, finalScore: final || totals,
    winner: winner || (totals.us > totals.dem ? 'us' : 'dem'),
    timestamp: new Date(at).toISOString(), durationMs: minutes * 60000,
    startingTotals: { us: 0, dem: 0 }, victoryMethod: 'Won on Bid',
    misdealDealers: [],
    ...extra,
  };
}

// A short, clean 2-hand game that one side wins.
function quickWin(winnerSide, at, names = {}) {
  const loserSide = winnerSide === 'us' ? 'dem' : 'us';
  return makeGame({
    ...names, at, winner: winnerSide,
    rounds: [round(winnerSide, 120, 140), round(winnerSide, 130, 150)],
    final: { [winnerSide]: 520, [loserSide]: 200 },
  });
}

// A small, varied library: four players rotating partners, mixed bids, comebacks,
// sets, a 360, misdeals, and games spread over several months.
function sampleLibrary(count = 36, names = ['Ann', 'Bob', 'Cy', 'Di']) {
  let seed = 12345;
  const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const games = [];
  for (let i = 0; i < count; i++) {
    const order = [...names].sort(() => rand() - 0.5);
    const us = order.slice(0, 2);
    const dem = order.slice(2, 4);
    const rounds = [];
    let totals = { us: 0, dem: 0 };
    while (rounds.length < 14) {
      const by = rand() < 0.5 ? 'us' : 'dem';
      const bid = 100 + Math.floor(rand() * 10) * 5;
      const took = Math.round((60 + rand() * 120) / 5) * 5;
      const made = took >= bid;
      const next = round(by, bid, rand() < 0.04 ? 360 : took);
      rounds.push(next);
      totals = { us: totals.us + next.usPoints, dem: totals.dem + next.demPoints };
      if ((made && totals[by] >= 500) || Math.abs(totals.us - totals.dem) >= 1000) break;
    }
    const winner = totals.us === totals.dem ? 'us' : totals.us > totals.dem ? 'us' : 'dem';
    games.push(makeGame({
      us, dem, rounds, winner, at: NOW - (count - i) * 3 * DAY, minutes: 25 + Math.floor(rand() * 40),
      extra: { misdealDealers: rand() < 0.2 ? [order[0]] : [] },
    }));
  }
  return games;
}

module.exports = { DAY, NOW, round, makeGame, quickWin, sampleLibrary };
