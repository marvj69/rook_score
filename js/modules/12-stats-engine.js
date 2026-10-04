"use strict";

// --- Statistics engine ---
// Turns the saved-game library into everything the Statistics screens draw.
// Plain data in, plain objects out: nothing here touches the page. It ships in
// the lazy statistics bundle; getStatistics() keeps the older flat shape for
// voice commands and tests.

const STATS_CLOSE_MARGIN = 50;   // a game decided by this many points or fewer is "close"
const STATS_BIG_COMEBACK = 100;  // winning after trailing by this much is a comeback
const STATS_UPSET_CHANCE = 0.25; // a win from below this chance, going into the last hand, is an upset
const STATS_MIN_GAMES = 3;       // games before a win rate or rating is ranked
const STATS_MIN_BIDS = 8;        // bids before a make rate is ranked
const STATS_MAX_GAME_MS = 6 * 3600000; // a longer "game" is a timer left running, so its length is unknown
const STATS_ELO_START = 1000;
const STATS_ELO_K = 24;
const STATS_DAY_MS = 86400000;
const STATS_PERIODS = { all: "All time", year: "This year", d90: "Last 90 days", d30: "Last 30 days" };

function parseStatNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeStatSide(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw === "us" || raw === "dem" ? raw : "";
}

function getOpponentSide(side) {
  return side === "us" ? "dem" : "us";
}

function getSideValue(side, usValue, demValue) {
  return side === "us" ? usValue : demValue;
}

// Building an Intl formatter is far slower than using one, and a long history
// formats thousands of values, so each distinct format is built once.
const STATS_NUMBER_FORMATS = new Map();
const STATS_DATE_FORMATS = new Map();

function formatStatNumber(value, options = {}) {
  const { minimumFractionDigits = 0, maximumFractionDigits = 0, fallback = "N/A" } = options;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const key = `${minimumFractionDigits}|${maximumFractionDigits}`;
  if (!STATS_NUMBER_FORMATS.has(key)) STATS_NUMBER_FORMATS.set(key, new Intl.NumberFormat([], { minimumFractionDigits, maximumFractionDigits }));
  return STATS_NUMBER_FORMATS.get(key).format(num);
}

function formatSignedStat(value, options = {}) {
  const { maximumFractionDigits = 0, fallback = "N/A" } = options;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (Math.round(num * 10 ** maximumFractionDigits) === 0) return "0";
  return `${num > 0 ? "+" : "−"}${formatStatNumber(Math.abs(num), { maximumFractionDigits })}`;
}

function formatPercentStat(value, fallback = "N/A", digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return `${num.toFixed(digits)}%`;
}

function statsPlural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function statsDayKey(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// --- Periods ---
function statsPeriodBounds(period, now) {
  if (period === "d30") return { from: now - 30 * STATS_DAY_MS, to: Infinity };
  if (period === "d90") return { from: now - 90 * STATS_DAY_MS, to: Infinity };
  if (period === "year") return { from: new Date(new Date(now).getFullYear(), 0, 1).getTime(), to: Infinity };
  return null;
}

// The window just before the selected one, used for "vs. previous" comparisons.
function statsPreviousBounds(period, now) {
  const current = statsPeriodBounds(period, now);
  if (!current) return null;
  if (period === "year") {
    const today = new Date(now);
    const year = today.getFullYear() - 1;
    return {
      from: new Date(year, 0, 1).getTime(),
      to: new Date(year, today.getMonth(), today.getDate(), 23, 59, 59, 999).getTime(),
    };
  }
  const span = now - current.from;
  return { from: current.from - span, to: current.from - 1 };
}

// --- Game normalization ---
function statsNormalizeRounds(game, start) {
  const trail = [{ us: start.us, dem: start.dem }];
  let running = trail[0];
  const rounds = game.rounds.map((round, i) => {
    const raw = round && typeof round === "object" ? round : {};
    const usPts = parseStatNumber(raw.usPoints, 0);
    const demPts = parseStatNumber(raw.demPoints, 0);
    const totals = raw.runningTotals && typeof raw.runningTotals === "object"
      ? sanitizeTotals(raw.runningTotals)
      : { us: running.us + usPts, dem: running.dem + demPts };
    running = totals;
    trail.push(totals);
    const bidSide = normalizeStatSide(raw.biddingTeam);
    const bid = Math.max(0, parseStatNumber(raw.bidAmount, 0));
    // A table-talk penalty moves points but is not a bid that was played out.
    const penalty = Boolean(raw.penalty);
    const hasBid = !penalty && Boolean(bidSide) && bid > 0;
    const bidderPts = bidSide ? getSideValue(bidSide, usPts, demPts) : 0;
    return {
      i, usPts, demPts, usTotal: totals.us, demTotal: totals.dem,
      bidSide, bid, penalty, hasBid, bidderPts,
      made: hasBid && bidderPts >= bid,
      set: hasBid && bidderPts < bid,
    };
  });
  return { rounds, trail };
}

// One hand-by-hand walk of the score: who led, how often it changed hands, how
// deep a hole the winner climbed out of.
function statsReadScoreStory(trail, winner) {
  const maxLead = { us: 0, dem: 0 };
  const maxLeadBeforeEnd = { us: 0, dem: 0 };
  let leadChanges = 0;
  let lastLeader = "";
  let lastNotAhead = 0;
  trail.forEach((totals, step) => {
    const gap = totals.us - totals.dem;
    const leader = gap > 0 ? "us" : gap < 0 ? "dem" : "";
    if (leader) {
      if (lastLeader && leader !== lastLeader) leadChanges++;
      lastLeader = leader;
    }
    if (gap > maxLead.us) maxLead.us = gap;
    if (-gap > maxLead.dem) maxLead.dem = -gap;
    if (step < trail.length - 1) {
      if (gap > maxLeadBeforeEnd.us) maxLeadBeforeEnd.us = gap;
      if (-gap > maxLeadBeforeEnd.dem) maxLeadBeforeEnd.dem = -gap;
    }
    if (winner && leader !== winner) lastNotAhead = step;
  });
  let biggestSwing = { hand: 0, amount: 0, side: "" };
  for (let step = 1; step < trail.length; step++) {
    const change = (trail[step].us - trail[step].dem) - (trail[step - 1].us - trail[step - 1].dem);
    if (Math.abs(change) > biggestSwing.amount) {
      biggestSwing = { hand: step, amount: Math.abs(change), side: change > 0 ? "us" : "dem" };
    }
  }
  return {
    leadChanges,
    maxLead,
    maxLeadBeforeEnd,
    biggestSwing,
    // The hand after which the winner stayed in front.
    decidingHand: winner ? Math.min(trail.length - 1, lastNotAhead + 1) : 0,
  };
}

// How likely Us was to win after every hand, from the app's own win-probability
// model. Only the score and the last two hands feed it (no player history), so
// any saved game can be replayed the same way. trail[0] is the start, even odds.
// A game's trail depends only on its own rounds, so changing the period (which
// rebuilds the model) reuses what was already replayed.
const STATS_CHANCE_CACHE = new WeakMap();

function statsReadWinChances(game, rounds) {
  if (typeof extractModelFeaturesFromRoundContext !== "function" || typeof predictBaseModelProbabilityFromFeatures !== "function") return null;
  const model = getActiveRuntimeModel();
  const cached = STATS_CHANCE_CACHE.get(game);
  if (cached && cached.modelId === model.modelId && cached.length === rounds.length) return cached.trail;
  const asRound = round => ({
    runningTotals: { us: round.usTotal, dem: round.demTotal }, bidAmount: round.bid,
    biddingTeam: round.bidSide, usPoints: round.usPts, demPoints: round.demPts,
  });
  const trail = [0.5];
  rounds.forEach((round, i) => {
    const features = extractModelFeaturesFromRoundContext(i, asRound(round), i > 0 ? asRound(rounds[i - 1]) : null);
    const chance = predictBaseModelProbabilityFromFeatures(features, model);
    trail.push(Number.isFinite(chance) ? Math.min(0.999, Math.max(0.001, chance)) : 0.5);
  });
  STATS_CHANCE_CACHE.set(game, { modelId: model.modelId, length: rounds.length, trail });
  return trail;
}

// The winner's worst moment (going into the last hand) and the hand that moved
// their chances most.
function statsReadUpset(trail, winner) {
  if (!trail || !winner) return { upset: null, turningPoint: null };
  const chances = trail.map(chance => (winner === "us" ? chance : 1 - chance));
  let upset = null;
  for (let step = 1; step < chances.length - 1; step++) {
    if (!upset || chances[step] < upset.chance) upset = { chance: chances[step], hand: step };
  }
  let turningPoint = null;
  for (let step = 1; step < chances.length; step++) {
    const change = chances[step] - chances[step - 1];
    if (!turningPoint || Math.abs(change) > Math.abs(turningPoint.change)) turningPoint = { change, hand: step };
  }
  return { upset, turningPoint };
}

// Everything one side did in one game, counted once and shared by the team and
// both players it covers.
function statsReadSide(rec, side) {
  const out = {
    handsPlayed: 0, handsWon: 0, perfect360s: 0, bid360s: 0, penalties: 0,
    bids: [], defHands: 0, defPoints: 0, setsForced: 0,
  };
  rec.rounds.forEach(round => {
    const mine = getSideValue(side, round.usPts, round.demPts);
    const theirs = getSideValue(side, round.demPts, round.usPts);
    if (round.penalty) {
      if (mine < 0) out.penalties++;
      return;
    }
    out.handsPlayed++;
    if (mine > theirs) out.handsWon++;
    if (mine === 360) {
      out.perfect360s++;
      if (round.bidSide === side) out.bid360s++;
    }
    if (!round.hasBid) return;
    const before = rec.trail[round.i];
    if (round.bidSide === side) {
      out.bids.push({
        bid: round.bid, made: round.made, points: round.bidderPts,
        gap: getSideValue(side, before.us - before.dem, before.dem - before.us),
      });
    } else {
      out.defHands++;
      out.defPoints += mine;
      if (round.set) out.setsForced++;
    }
  });
  return out;
}

function statsDescribeGame(game, index) {
  if (!game || typeof game !== "object" || !Array.isArray(game.rounds) || !game.rounds.length) return null;
  const parsedTime = typeof game.timestamp === "number" ? game.timestamp : Date.parse(game.timestamp || "");
  const time = Number.isFinite(parsedTime) ? parsedTime : 0;
  const start = sanitizeTotals(game.startingTotals);
  const { rounds, trail } = statsNormalizeRounds(game, start);
  const final = game.finalScore ? sanitizeTotals(game.finalScore) : trail[trail.length - 1];
  const winner = normalizeStatSide(game.winner)
    || (final.us > final.dem ? "us" : final.dem > final.us ? "dem" : "");
  const sides = { us: getGameSideIdentity(game, "us"), dem: getGameSideIdentity(game, "dem") };
  // A name entered on both sides cannot be credited to either one, so it counts for neither.
  const clash = sides.us.keys.filter(key => sides.dem.keys.includes(key));
  if (clash.length) {
    ["us", "dem"].forEach(side => {
      const keep = sides[side].keys.map(key => !clash.includes(key));
      sides[side] = { ...sides[side], named: sides[side].named.filter((name, i) => keep[i]), keys: sides[side].keys.filter((key, i) => keep[i]) };
    });
  }
  const story = statsReadScoreStory(trail, winner);
  const winChances = statsReadWinChances(game, rounds);
  const { upset, turningPoint } = statsReadUpset(winChances, winner);

  const misdealNames = normalizeMisdealDealers(game.misdealDealers);
  const misdealsByKey = new Map();
  const misdealsBySide = { us: 0, dem: 0 };
  misdealNames.forEach(name => {
    const key = name.toLowerCase();
    const side = sides.us.keys.includes(key) ? "us" : sides.dem.keys.includes(key) ? "dem" : "";
    if (!side) return;
    misdealsByKey.set(key, (misdealsByKey.get(key) || 0) + 1);
    misdealsBySide[side]++;
  });

  const rec = {
    index, time, hasTime: time > 0, dayKey: time > 0 ? statsDayKey(time) : "",
    us: sides.us, dem: sides.dem, winner, final, start,
    margin: Math.abs(final.us - final.dem),
    victoryMethod: typeof game.victoryMethod === "string" ? game.victoryMethod : "",
    durationMs: statsPlausibleDuration(game.durationMs),
    hands: rounds.filter(round => !round.penalty).length,
    rounds, trail, ...story, winChances, upset, turningPoint,
    // A rule win (the other side was set past 500) can leave the winner behind on points.
    wonBehind: Boolean(winner) && getSideValue(winner, final.us - final.dem, final.dem - final.us) < 0,
    misdealCount: misdealNames.length, misdealsByKey, misdealsBySide,
    order: 0,
  };
  rec.sideStats = { us: statsReadSide(rec, "us"), dem: statsReadSide(rec, "dem") };
  return rec;
}

// Timers get left running overnight; a 60-hour "game" would swamp every total and average.
function statsPlausibleDuration(value) {
  const ms = Math.max(0, parseStatNumber(value, 0));
  return ms > STATS_MAX_GAME_MS ? 0 : ms;
}

// Newest-last, so streaks, ratings, and trends all read forward in time.
function statsNormalizeGames(rawGames) {
  const records = [];
  (Array.isArray(rawGames) ? rawGames : []).forEach((game, index) => {
    const rec = statsDescribeGame(game, index);
    if (rec) records.push(rec);
  });
  records.sort((a, b) => (a.time - b.time) || (a.index - b.index));
  records.forEach((rec, order) => { rec.order = order; });
  return records;
}

// --- Bid-size buckets ---
// Bids are grouped in tens, with thin ends folded inward, so every bar has
// enough hands behind it to mean something.
function statsBuildBidBuckets(amounts) {
  const regular = amounts.filter(bid => bid > 0 && bid <= 180);
  const hasSlam = amounts.some(bid => bid > 180);
  const buckets = [];
  if (regular.length) {
    const tail = Math.max(4, Math.ceil(regular.length * 0.05));
    for (const width of [10, 20]) {
      const counts = new Map();
      regular.forEach(bid => {
        const group = Math.floor(bid / width) * width;
        counts.set(group, (counts.get(group) || 0) + 1);
      });
      const groups = [...counts.keys()].sort((a, b) => a - b)
        .map(lo => ({ lo, hi: lo + width - 5, max: lo + width - 1, count: counts.get(lo), openLow: false, openHigh: false }));
      while (groups.length > 1 && groups[0].count < tail) {
        const first = groups.shift();
        groups[0].count += first.count;
        groups[0].lo = first.lo;
        groups[0].openLow = true;
      }
      while (groups.length > 1 && groups[groups.length - 1].count < tail) {
        const last = groups.pop();
        const prev = groups[groups.length - 1];
        prev.count += last.count;
        prev.hi = last.hi;
        prev.max = last.max;
        prev.openHigh = true;
      }
      if (groups.length <= 7 || width === 20) {
        groups.forEach((group, index) => {
          const label = group.openLow && group.openHigh ? "All"
            : group.openLow ? `≤${group.hi}`
              : group.openHigh ? `${group.lo}+`
                : `${group.lo}–${group.hi}`;
          buckets.push({
            id: `b${index}`, label, lo: group.lo, hi: group.hi,
            max: index === groups.length - 1 ? 180 : group.max,
            open: group.openLow || group.openHigh,
          });
        });
        break;
      }
    }
  }
  if (hasSlam) buckets.push({ id: "slam", label: "360", lo: 360, hi: 360, max: Infinity, open: false });
  return buckets;
}

function statsBidBucketIndex(bid, buckets) {
  if (!buckets.length) return -1;
  if (bid > 180) return buckets.findIndex(bucket => bucket.id === "slam");
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i].id !== "slam" && bid <= buckets[i].max) return i;
  }
  const last = buckets.length - 1;
  return buckets[last].id === "slam" ? last - 1 : last;
}

function statsNewBucketStats(buckets) {
  return buckets.map(() => ({ attempts: 0, made: 0, points: 0 }));
}

// --- Ratings ---
// Elo over every decided game, oldest first. A side's strength is the mean of
// its players, and both partners move together, so a rating reflects results
// against the opposition actually faced rather than raw win rate.
function statsComputeRatings(records) {
  const players = new Map();
  const teamHistory = new Map();
  const get = key => {
    if (!players.has(key)) players.set(key, { key, rating: STATS_ELO_START, history: [] });
    return players.get(key);
  };
  records.forEach(rec => {
    if (!rec.winner || !rec.us.keys.length || !rec.dem.keys.length) return;
    const average = keys => keys.reduce((sum, key) => sum + get(key).rating, 0) / keys.length;
    const expectedUs = 1 / (1 + 10 ** ((average(rec.dem.keys) - average(rec.us.keys)) / 400));
    const delta = STATS_ELO_K * ((rec.winner === "us" ? 1 : 0) - expectedUs);
    ["us", "dem"].forEach(side => {
      const direction = side === "us" ? 1 : -1;
      const keys = rec[side].keys;
      const before = average(keys);
      keys.forEach(key => {
        const player = get(key);
        const from = player.rating;
        player.rating += delta * direction;
        player.history.push({ order: rec.order, before: from, after: player.rating });
      });
      if (rec[side].key) {
        if (!teamHistory.has(rec[side].key)) teamHistory.set(rec[side].key, []);
        teamHistory.get(rec[side].key).push({ order: rec.order, before, after: average(keys) });
      }
    });
  });
  return { players, teamHistory };
}

// --- Entities (players and teams) ---
function statsNewEntity(kind, key, name, players) {
  return {
    kind, key, name, players: players || [],
    results: [], partners: new Map(), opponents: new Map(),
    gamesPlayed: 0, wins: 0, losses: 0,
    totalPointsFor: 0, totalPointsAgainst: 0,
    roundsPlayed: 0, roundsWon: 0,
    bidAttempts: 0, bidsMade: 0, bidsSet: 0, totalBidAmount: 0, bidMarginTotal: 0, bidPointsTotal: 0,
    defHands: 0, defPointsTotal: 0, setsForced: 0,
    perfect360s: 0, bid360s: 0, misdeals: 0, penalties: 0,
    comebackWins: 0, bigComebackWins: 0, wireToWireWins: 0, maxDeficitOvercome: 0, upsetWins: 0, lowestWinChance: null,
    closeWins: 0, closeLosses: 0, bestScore: null, highestBidMade: null, biggestSet: null,
    lastPlayed: 0, firstPlayed: 0, totalTimeMs: 0, timedGames: 0, totalHands: 0,
    bidBuckets: [],
  };
}

function statsAddHeadToHead(map, key, name, rec, won, lost, pf, pa) {
  if (!key) return;
  if (!map.has(key)) map.set(key, { key, name, games: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, last: 0 });
  const entry = map.get(key);
  entry.name = name;
  entry.games++;
  if (won) entry.wins++;
  if (lost) entry.losses++;
  entry.pointsFor += pf;
  entry.pointsAgainst += pa;
  if (rec.time >= entry.last) entry.last = rec.time;
}

function statsAddGame(entity, rec, side, extra, buckets) {
  const opp = getOpponentSide(side);
  const stats = rec.sideStats[side];
  const pf = rec.final[side];
  const pa = rec.final[opp];
  const won = rec.winner === side;
  const lost = Boolean(rec.winner) && !won;
  const deficit = rec.maxLeadBeforeEnd[opp];

  entity.gamesPlayed++;
  entity.totalTimeMs += rec.durationMs;
  if (rec.durationMs > 0) entity.timedGames++;
  entity.totalHands += rec.hands;
  entity.totalPointsFor += pf;
  entity.totalPointsAgainst += pa;
  entity.bestScore = entity.bestScore === null ? pf : Math.max(entity.bestScore, pf);
  entity.roundsPlayed += stats.handsPlayed;
  entity.roundsWon += stats.handsWon;
  entity.perfect360s += stats.perfect360s;
  entity.bid360s += stats.bid360s;
  entity.penalties += stats.penalties;
  entity.defHands += stats.defHands;
  entity.defPointsTotal += stats.defPoints;
  entity.setsForced += stats.setsForced;
  if (rec.time >= entity.lastPlayed) entity.lastPlayed = rec.time;
  if (!entity.firstPlayed || (rec.time && rec.time < entity.firstPlayed)) entity.firstPlayed = rec.time;

  if (won) {
    entity.wins++;
    if (Math.abs(pf - pa) <= STATS_CLOSE_MARGIN) entity.closeWins++;
    if (deficit > 0) entity.comebackWins++;
    if (deficit >= STATS_BIG_COMEBACK) entity.bigComebackWins++;
    if (deficit === 0) entity.wireToWireWins++;
    entity.maxDeficitOvercome = Math.max(entity.maxDeficitOvercome, deficit);
    if (rec.upset) {
      if (rec.upset.chance < STATS_UPSET_CHANCE) entity.upsetWins++;
      entity.lowestWinChance = entity.lowestWinChance === null ? rec.upset.chance : Math.min(entity.lowestWinChance, rec.upset.chance);
    }
  } else if (lost) {
    entity.losses++;
    if (Math.abs(pf - pa) <= STATS_CLOSE_MARGIN) entity.closeLosses++;
  }

  stats.bids.forEach(bid => {
    entity.bidAttempts++;
    entity.totalBidAmount += bid.bid;
    entity.bidMarginTotal += bid.points - bid.bid;
    entity.bidPointsTotal += bid.points;
    if (bid.made) {
      entity.bidsMade++;
      entity.highestBidMade = Math.max(entity.highestBidMade || 0, bid.bid);
    } else {
      entity.bidsSet++;
      entity.biggestSet = Math.max(entity.biggestSet || 0, bid.bid);
    }
    const index = statsBidBucketIndex(bid.bid, buckets);
    if (index >= 0) {
      if (!entity.bidBuckets.length) entity.bidBuckets = statsNewBucketStats(buckets);
      const slot = entity.bidBuckets[index];
      slot.attempts++;
      if (bid.made) slot.made++;
      slot.points += bid.points;
    }
  });

  entity.results.push({
    order: rec.order, index: rec.index, time: rec.time, side, won, lost, pf, pa, margin: pf - pa,
    opponent: rec[opp].name, hands: rec.hands, durationMs: rec.durationMs, deficit,
    partner: extra.partner || "", closeGame: Math.abs(pf - pa) <= STATS_CLOSE_MARGIN,
  });

  if (extra.partnerKey) statsAddHeadToHead(entity.partners, extra.partnerKey, extra.partner, rec, won, lost, pf, pa);
  extra.opponents.forEach(opponent => {
    statsAddHeadToHead(entity.opponents, opponent.key, opponent.name, rec, won, lost, pf, pa);
  });
}

function statsCollectEntities(records, buckets) {
  const players = new Map();
  const teams = new Map();
  const ensure = (map, kind, key, name, roster) => {
    if (!map.has(key)) map.set(key, statsNewEntity(kind, key, name, roster));
    const entity = map.get(key);
    entity.name = name;
    if (roster) entity.players = roster;
    return entity;
  };
  records.forEach(rec => {
    ["us", "dem"].forEach(side => {
      const mine = rec[side];
      const theirs = rec[getOpponentSide(side)];
      const opposingTeam = theirs.key ? [{ key: theirs.key, name: theirs.name }] : [];
      const opposingPlayers = theirs.named.map((name, i) => ({ key: theirs.keys[i], name }));
      if (mine.key) {
        const team = ensure(teams, "team", mine.key, mine.name, mine.players);
        statsAddGame(team, rec, side, { opponents: opposingTeam }, buckets);
        team.misdeals += rec.misdealsBySide[side];
      }
      mine.named.forEach((name, i) => {
        const key = mine.keys[i];
        const player = ensure(players, "player", key, name, null);
        const partnerIndex = mine.named.length === 2 ? 1 - i : -1;
        statsAddGame(player, rec, side, {
          opponents: opposingPlayers,
          partner: partnerIndex >= 0 ? mine.named[partnerIndex] : "",
          partnerKey: partnerIndex >= 0 ? mine.keys[partnerIndex] : "",
        }, buckets);
        player.misdeals += rec.misdealsByKey.get(key) || 0;
      });
    });
  });
  return { players, teams };
}

function statsFinishHeadToHead(map) {
  return [...map.values()].map(entry => ({
    ...entry,
    winPct: entry.games ? (entry.wins / entry.games) * 100 : 0,
    margin: entry.games ? (entry.pointsFor - entry.pointsAgainst) / entry.games : 0,
  })).sort((a, b) => (b.games - a.games) || (b.winPct - a.winPct) || a.name.localeCompare(b.name));
}

function statsFinishEntity(entity, ratings, scopedOrders) {
  const games = entity.gamesPlayed;
  entity.winPercentNumber = games ? (entity.wins / games) * 100 : 0;
  entity.winPercent = entity.winPercentNumber.toFixed(1);
  entity.bidMakePct = entity.bidAttempts ? (entity.bidsMade / entity.bidAttempts) * 100 : null;
  entity.bidSuccessPct = entity.bidMakePct === null ? "N/A" : entity.bidMakePct.toFixed(1);
  entity.roundWinPct = entity.roundsPlayed ? (entity.roundsWon / entity.roundsPlayed) * 100 : null;
  entity.avgScore = games ? entity.totalPointsFor / games : null;
  entity.avgAllowed = games ? entity.totalPointsAgainst / games : null;
  entity.netPerGame = games ? (entity.totalPointsFor - entity.totalPointsAgainst) / games : 0;
  const avgBidValue = entity.bidAttempts ? entity.totalBidAmount / entity.bidAttempts : null;
  entity.avgBidValue = avgBidValue;
  entity.avgBid = avgBidValue === null ? "N/A" : formatStatNumber(avgBidValue);
  entity.avgBidMargin = entity.bidAttempts ? entity.bidMarginTotal / entity.bidAttempts : null;
  entity.avgBidPoints = entity.bidAttempts ? entity.bidPointsTotal / entity.bidAttempts : null;
  entity.setsForcedPct = entity.defHands ? (entity.setsForced / entity.defHands) * 100 : null;
  entity.avgDefPoints = entity.defHands ? entity.defPointsTotal / entity.defHands : null;
  entity.avgGameTimeMs = entity.timedGames ? entity.totalTimeMs / entity.timedGames : 0;
  entity.avgHands = games ? entity.totalHands / games : 0;
  entity.count360 = entity.perfect360s;

  let run = 0;
  let runType = "";
  let runStart = 0;
  let longestWin = { length: 0, from: null, to: null };
  let longestLoss = { length: 0, from: null, to: null };
  entity.results.forEach((result, i) => {
    const type = result.won ? "W" : result.lost ? "L" : "";
    if (!type) {
      run = 0;
      runType = "";
      return;
    }
    if (type === runType) run++;
    else { run = 1; runType = type; runStart = i; }
    const longest = type === "W" ? longestWin : longestLoss;
    if (run > longest.length) {
      longest.length = run;
      longest.from = entity.results[runStart];
      longest.to = result;
    }
  });
  entity.streak = { type: runType, length: run };
  entity.streakValue = runType === "W" ? run : runType === "L" ? -run : 0;
  entity.longestWinStreak = longestWin;
  entity.longestLossStreak = longestLoss;
  entity.form = entity.results.slice(-10).map(result => (result.won ? "W" : result.lost ? "L" : "T"));

  // The rating is always as of the latest game; the chart only shows games in scope.
  const full = (entity.kind === "player" ? ratings.players.get(entity.key)?.history : ratings.teamHistory.get(entity.key)) || [];
  const inScope = scopedOrders ? full.filter(item => scopedOrders.has(item.order)) : full;
  entity.rating = full.length ? full[full.length - 1].after : STATS_ELO_START;
  entity.ratingHistory = inScope;
  entity.ratingStart = inScope.length ? inScope[0].before : entity.rating;
  entity.partners = statsFinishHeadToHead(entity.partners);
  entity.opponents = statsFinishHeadToHead(entity.opponents);
  return entity;
}

// Higher numbers first, with a stable name tiebreak.
function statsSortByName(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

// --- Ranking ---
// Metric ids keep the names the statistics screen and voice commands have always
// used. `gate` names the sample a rate needs before it can be ranked.
const STATS_RANK_METRICS = {
  winPct: { label: "Win %", short: "Win %", gate: "games", get: e => e.winPercentNumber, format: v => `${Math.round(v)}%`, max: 100 },
  rating: { label: "Rating", short: "Rating", gate: "games", get: e => e.rating, format: v => String(Math.round(v)) },
  wins: { label: "Wins", short: "Wins", get: e => e.wins, format: v => String(v) },
  games: { label: "Games played", short: "Games", get: e => e.gamesPlayed, format: v => String(v) },
  netPerGame: { label: "Avg margin", short: "Margin", gate: "games", get: e => e.netPerGame, format: v => formatSignedStat(v) },
  bidMakePct: { label: "Bid make %", short: "Bid make", gate: "bids", get: e => e.bidMakePct, format: v => `${Math.round(v)}%`, max: 100 },
  setsForced: { label: "Sets forced", short: "Sets", get: e => e.setsForced, format: v => String(v) },
  comebacks: { label: "Comeback wins", short: "Comebacks", get: e => e.bigComebackWins, format: v => String(v) },
  closeWins: { label: "Close wins", short: "Close wins", get: e => e.closeWins, format: v => String(v) },
  perfect360s: { label: "Perfect 360s", short: "360s", get: e => e.perfect360s, format: v => String(v) },
  misdeals: { label: "Misdeals", short: "Misdeals", medals: false, get: e => e.misdeals, format: v => String(v) },
  streak: { label: "Streak", short: "Streak", get: e => e.streakValue, format: v => (v > 0 ? `W${v}` : v < 0 ? `L${-v}` : "–") },
  recent: { label: "Last played", short: "Last", medals: false, get: e => e.lastPlayed, format: v => statsRelativeDay(v) },
};
// Voice commands and older saved links used these spellings.
const STATS_METRIC_ALIASES = { bidSuccessPct: "bidMakePct", "360s": "perfect360s" };

function statsCanonicalMetric(key) {
  const canonical = STATS_METRIC_ALIASES[key] || key;
  return Object.prototype.hasOwnProperty.call(STATS_RANK_METRICS, canonical) ? canonical : "";
}

function statsRelativeDay(ms, now = Date.now()) {
  if (!ms) return "never";
  const days = Math.floor((now - ms) / STATS_DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  if (days < 540) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

// How much history counts as "enough" depends on the group: with one person at
// 128 games, a 4-0 newcomer should not top a win-rate board. Like the
// "qualified batter" rule: a tenth of the busiest list member's games (never
// fewer than 3 or more than 10), and likewise for bids.
function statsGateFor(list) {
  const most = list.reduce((top, entity) => Math.max(top, entity.gamesPlayed), 0);
  const mostBids = list.reduce((top, entity) => Math.max(top, entity.bidAttempts), 0);
  return {
    games: Math.min(10, Math.max(STATS_MIN_GAMES, Math.ceil(most * 0.1))),
    bids: Math.min(30, Math.max(STATS_MIN_BIDS, Math.ceil(mostBids * 0.05))),
  };
}

function statsMeetsGate(entity, gate, thresholds) {
  if (gate === "games") return entity.gamesPlayed >= thresholds.games;
  if (gate === "bids") return entity.bidAttempts >= thresholds.bids;
  return true;
}

// Entities that clear the metric's sample gate come first; the rest follow,
// marked provisional so a 1-0 record cannot top the board.
function statsRankEntities(list, metricKey, direction = "desc") {
  const metric = STATS_RANK_METRICS[statsCanonicalMetric(metricKey) || "winPct"];
  const sign = direction === "asc" ? 1 : -1;
  const thresholds = statsGateFor(list);
  const rows = list.map(entity => {
    const value = metric.get(entity);
    return { entity, value, valid: Number.isFinite(value), qualified: Number.isFinite(value) && statsMeetsGate(entity, metric.gate, thresholds) };
  });
  rows.sort((a, b) => {
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    if (a.valid !== b.valid) return a.valid ? -1 : 1;
    if (a.valid && a.value !== b.value) return (a.value - b.value) * sign;
    return (b.entity.gamesPlayed - a.entity.gamesPlayed) || statsSortByName(a.entity, b.entity);
  });
  let rank = 0;
  rows.forEach(row => { row.rank = row.qualified ? ++rank : 0; });
  return rows;
}

// "#2 of 8" for one entity on one metric, among those that qualify.
function statsRankOf(list, entity, metricKey) {
  const rows = statsRankEntities(list, metricKey, "desc");
  const row = rows.find(item => item.entity === entity);
  const qualified = rows.filter(item => item.qualified).length;
  return row && row.qualified ? { rank: row.rank, of: qualified } : null;
}

// Older sort API: kept for voice commands and the compatibility tests.
function getMetricSortValue(item, metricKey) {
  switch (metricKey) {
    case "games": return item.gamesPlayed;
    case "netPerGame": return item.netPerGame;
    case "bidMakePct": return item.bidMakePct;
    case "setsForced": return item.setsForced;
    case "comebacks": return item.comebackWins;
    case "closeWins": return item.closeWins;
    case "perfect360s": return item.perfect360s;
    case "misdeals": return item.misdeals;
    default: return null;
  }
}

function sortStatisticsData(statsData, sortKey, metricKey) {
  if (!Array.isArray(statsData)) return [];
  const sorted = [...statsData];
  const nameKey = item => (item.name || "").toLowerCase();
  if (sortKey === "recent") {
    sorted.sort((a, b) => ((b.lastPlayed || 0) - (a.lastPlayed || 0)) || nameKey(a).localeCompare(nameKey(b)));
    return sorted;
  }
  const direction = sortKey === "least" ? 1 : -1;
  sorted.sort((a, b) => {
    const aVal = getMetricSortValue(a, metricKey);
    const bVal = getMetricSortValue(b, metricKey);
    const aValid = Number.isFinite(aVal);
    const bValid = Number.isFinite(bVal);
    if (!aValid && !bValid) return nameKey(a).localeCompare(nameKey(b));
    if (!aValid) return 1;
    if (!bValid) return -1;
    if (aVal === bVal) return nameKey(a).localeCompare(nameKey(b));
    return (aVal - bVal) * direction;
  });
  return sorted;
}

// --- Group-wide numbers ---
function statsVictoryMethod(method) {
  const text = String(method || "").toLowerCase();
  if (text.includes("spread")) return "spread";
  if (text.includes("set")) return "set";
  if (text.includes("bid")) return "bid";
  return "other";
}

function statsBuildTotals(records) {
  const totals = {
    games: records.length, hands: 0, rounds: 0, timeMs: 0, timedGames: 0,
    bidAttempts: 0, bidsMade: 0, bidsSet: 0, bidAmount: 0, bidPoints: 0,
    perfect360s: 0, misdeals: 0, penalties: 0,
    closeGames: 0, comebackGames: 0, wireToWireGames: 0, decidedGames: 0,
    marginTotal: 0, leadChangeTotal: 0, firstTime: 0, lastTime: 0,
    methods: { bid: 0, set: 0, spread: 0, other: 0 },
    margins: [0, 0, 0, 0, 0, 0, 0, 0],
  };
  records.forEach(rec => {
    totals.hands += rec.hands;
    totals.rounds += rec.rounds.length;
    if (rec.durationMs > 0) { totals.timeMs += rec.durationMs; totals.timedGames++; }
    totals.marginTotal += rec.margin;
    totals.leadChangeTotal += rec.leadChanges;
    totals.misdeals += rec.misdealCount;
    if (rec.hasTime) {
      totals.firstTime = totals.firstTime ? Math.min(totals.firstTime, rec.time) : rec.time;
      totals.lastTime = Math.max(totals.lastTime, rec.time);
    }
    ["us", "dem"].forEach(side => {
      const stats = rec.sideStats[side];
      totals.perfect360s += stats.perfect360s;
      totals.penalties += stats.penalties;
      stats.bids.forEach(bid => {
        totals.bidAttempts++;
        totals.bidAmount += bid.bid;
        totals.bidPoints += bid.points;
        if (bid.made) totals.bidsMade++;
        else totals.bidsSet++;
      });
    });
    if (rec.winner) {
      totals.decidedGames++;
      totals.methods[statsVictoryMethod(rec.victoryMethod)]++;
      const deficit = rec.maxLeadBeforeEnd[getOpponentSide(rec.winner)];
      if (deficit >= STATS_BIG_COMEBACK) totals.comebackGames++;
      if (deficit === 0) totals.wireToWireGames++;
    }
    if (rec.margin <= STATS_CLOSE_MARGIN) totals.closeGames++;
    totals.margins[Math.min(totals.margins.length - 1, Math.floor(rec.margin / 50))]++;
  });
  totals.avgMargin = records.length ? totals.marginTotal / records.length : 0;
  totals.avgHands = records.length ? totals.hands / records.length : 0;
  totals.avgGameMs = totals.timedGames ? totals.timeMs / totals.timedGames : 0;
  totals.avgBid = totals.bidAttempts ? totals.bidAmount / totals.bidAttempts : null;
  totals.avgBidPoints = totals.bidAttempts ? totals.bidPoints / totals.bidAttempts : null;
  totals.bidMakePct = totals.bidAttempts ? (totals.bidsMade / totals.bidAttempts) * 100 : null;
  totals.avgLeadChanges = records.length ? totals.leadChangeTotal / records.length : 0;
  return totals;
}

function statsBuildActivity(records, now) {
  const byDay = {};
  const weekday = new Array(7).fill(0);
  const hour = new Array(24).fill(0);
  const weekly = new Array(12).fill(0);
  records.forEach(rec => {
    if (!rec.hasTime) return;
    const date = new Date(rec.time);
    byDay[rec.dayKey] = (byDay[rec.dayKey] || 0) + 1;
    weekday[date.getDay()]++;
    hour[date.getHours()]++;
    const weeksAgo = Math.floor((now - rec.time) / (7 * STATS_DAY_MS));
    if (weeksAgo >= 0 && weeksAgo < weekly.length) weekly[weekly.length - 1 - weeksAgo]++;
  });
  return { byDay, weekday, hour, weekly };
}

// How bids fare, by size and by game situation, across every bid in scope.
function statsBuildBidAnalytics(records, buckets) {
  const sized = statsNewBucketStats(buckets);
  const frequency = new Map();
  const situations = {
    trailing: { attempts: 0, made: 0, bidTotal: 0 },
    even: { attempts: 0, made: 0, bidTotal: 0 },
    leading: { attempts: 0, made: 0, bidTotal: 0 },
  };
  records.forEach(rec => {
    ["us", "dem"].forEach(side => {
      rec.sideStats[side].bids.forEach(bid => {
        const index = statsBidBucketIndex(bid.bid, buckets);
        if (index >= 0) {
          sized[index].attempts++;
          if (bid.made) sized[index].made++;
          sized[index].points += bid.points;
        }
        const entry = frequency.get(bid.bid) || { bid: bid.bid, count: 0, made: 0 };
        entry.count++;
        if (bid.made) entry.made++;
        frequency.set(bid.bid, entry);
        const situation = bid.gap <= -STATS_CLOSE_MARGIN ? "trailing" : bid.gap >= STATS_CLOSE_MARGIN ? "leading" : "even";
        situations[situation].attempts++;
        situations[situation].bidTotal += bid.bid;
        if (bid.made) situations[situation].made++;
      });
    });
  });
  return {
    buckets: buckets.map((bucket, index) => {
      const slot = sized[index];
      return {
        ...bucket, ...slot,
        makePct: slot.attempts ? (slot.made / slot.attempts) * 100 : null,
        avgPoints: slot.attempts ? slot.points / slot.attempts : null,
      };
    }),
    common: [...frequency.values()].sort((a, b) => (b.count - a.count) || (a.bid - b.bid)),
    situations: Object.fromEntries(Object.entries(situations).map(([name, slot]) => [name, {
      ...slot,
      makePct: slot.attempts ? (slot.made / slot.attempts) * 100 : null,
      avgBid: slot.attempts ? slot.bidTotal / slot.attempts : null,
    }])),
  };
}

// --- Notable games ---
function statsSummarizeGame(rec) {
  const side = rec.winner || "us";
  const sign = side === "us" ? 1 : -1;
  const gaps = rec.trail.map(totals => (totals.us - totals.dem) * sign);
  return {
    index: rec.index, order: rec.order, time: rec.time, winner: rec.winner,
    us: rec.us.name, dem: rec.dem.name, usScore: rec.final.us, demScore: rec.final.dem,
    winnerName: rec.winner ? rec[rec.winner].name : "", loserName: rec.winner ? rec[getOpponentSide(rec.winner)].name : "",
    margin: rec.margin, hands: rec.hands, durationMs: rec.durationMs, leadChanges: rec.leadChanges,
    deficit: rec.winner ? rec.maxLeadBeforeEnd[getOpponentSide(rec.winner)] : 0,
    decidingHand: rec.decidingHand, victoryMethod: rec.victoryMethod, gaps,
    wonBehind: rec.wonBehind, winChance: rec.upset ? rec.upset.chance : null, winChanceHand: rec.upset ? rec.upset.hand : 0,
  };
}

function statsBuildGameLists(records) {
  const decided = records.filter(rec => rec.winner);
  const top = (list, compare, limit = 5) => [...list].sort(compare).slice(0, limit).map(statsSummarizeGame);
  return {
    closest: top(decided, (a, b) => (a.margin - b.margin) || (b.time - a.time)),
    blowouts: top(decided, (a, b) => (b.margin - a.margin) || (b.time - a.time)),
    comebacks: top(
      decided.filter(rec => rec.maxLeadBeforeEnd[getOpponentSide(rec.winner)] >= STATS_CLOSE_MARGIN),
      (a, b) => (b.maxLeadBeforeEnd[getOpponentSide(b.winner)] - a.maxLeadBeforeEnd[getOpponentSide(a.winner)]) || (b.time - a.time),
    ),
    upsets: top(decided.filter(rec => rec.upset && rec.upset.chance < 0.4), (a, b) => (a.upset.chance - b.upset.chance) || (b.time - a.time)),
    wildest: top(records.filter(rec => rec.leadChanges > 0), (a, b) => (b.leadChanges - a.leadChanges) || (b.time - a.time)),
    longest: top(records, (a, b) => (b.hands - a.hands) || (b.time - a.time)),
  };
}

// --- Records ---
function statsBestOf(list, pick, better = (a, b) => a > b) {
  let best = null;
  list.forEach(item => {
    const value = pick(item);
    if (Number.isFinite(value) && (best === null || better(value, best.value))) best = { item, value };
  });
  return best;
}

function statsBuildRecords(records, players, teams, totals) {
  const found = [];
  const add = (record) => { if (record) found.push(record); };
  const decided = records.filter(rec => rec.winner);

  const topScore = statsBestOf(records.flatMap(rec => ["us", "dem"].map(side => ({ rec, side }))), ({ rec, side }) => rec.final[side]);
  add(topScore && { id: "highScore", label: "Highest score", value: topScore.value, unit: "pts", holder: topScore.item.rec[topScore.item.side].name, game: topScore.item.rec.index, time: topScore.item.rec.time });

  const blowout = statsBestOf(decided, rec => rec.margin);
  add(blowout && blowout.value > 0 && { id: "blowout", label: "Biggest blowout", value: blowout.value, unit: "pts", holder: blowout.item[blowout.item.winner].name, game: blowout.item.index, time: blowout.item.time });

  const closest = statsBestOf(decided, rec => rec.margin, (a, b) => a < b);
  add(closest && { id: "closest", label: "Closest finish", value: closest.value, unit: "pts", holder: closest.item[closest.item.winner].name, game: closest.item.index, time: closest.item.time });

  const comeback = statsBestOf(decided, rec => rec.maxLeadBeforeEnd[getOpponentSide(rec.winner)]);
  add(comeback && comeback.value >= STATS_CLOSE_MARGIN && { id: "comeback", label: "Biggest comeback", value: comeback.value, unit: "down", holder: comeback.item[comeback.item.winner].name, game: comeback.item.index, time: comeback.item.time });

  const upset = statsBestOf(decided.filter(rec => rec.upset), rec => rec.upset.chance, (a, b) => a < b);
  add(upset && upset.value < STATS_UPSET_CHANCE && {
    id: "upset", label: "Biggest upset", value: Math.max(1, Math.round(upset.value * 100)), unit: "chance", holder: upset.item[upset.item.winner].name,
    note: `after hand ${upset.item.upset.hand}`, game: upset.item.index, time: upset.item.time,
  });
  const turning = statsBestOf(decided.filter(rec => rec.turningPoint), rec => Math.abs(rec.turningPoint.change));
  add(turning && turning.value >= 0.2 && {
    id: "turning", label: "Game-changing hand", value: Math.round(turning.value * 100), unit: "swing", holder: turning.item[turning.item.winner].name,
    note: `hand ${turning.item.turningPoint.hand}`, game: turning.item.index, time: turning.item.time,
  });

  const timed = records.filter(rec => rec.durationMs >= 5 * 60000);
  const longest = statsBestOf(timed, rec => rec.durationMs);
  add(longest && { id: "longest", label: "Longest game", value: longest.value, unit: "time", holder: `${longest.item.us.name} vs ${longest.item.dem.name}`, game: longest.item.index, time: longest.item.time });
  const quickest = statsBestOf(timed.filter(rec => rec.hands >= 3), rec => rec.durationMs, (a, b) => a < b);
  add(quickest && timed.length > 1 && { id: "quickest", label: "Quickest game", value: quickest.value, unit: "time", holder: `${quickest.item.us.name} vs ${quickest.item.dem.name}`, game: quickest.item.index, time: quickest.item.time });

  const mostHands = statsBestOf(records, rec => rec.hands);
  add(mostHands && { id: "marathon", label: "Most hands in a game", value: mostHands.value, unit: "hands", holder: `${mostHands.item.us.name} vs ${mostHands.item.dem.name}`, game: mostHands.item.index, time: mostHands.item.time });

  const wild = statsBestOf(records, rec => rec.leadChanges);
  add(wild && wild.value >= 2 && { id: "leadChanges", label: "Most lead changes", value: wild.value, unit: "changes", holder: `${wild.item.us.name} vs ${wild.item.dem.name}`, game: wild.item.index, time: wild.item.time });

  const swing = statsBestOf(records, rec => rec.biggestSwing.amount);
  add(swing && swing.value > 0 && { id: "swing", label: "Biggest single-hand swing", value: swing.value, unit: "pts", holder: swing.item[swing.item.biggestSwing.side].name, game: swing.item.index, time: swing.item.time });

  let bestBid = null;
  let worstSet = null;
  records.forEach(rec => {
    rec.rounds.forEach(round => {
      if (!round.hasBid) return;
      const side = round.bidSide;
      if (round.made && (!bestBid || round.bid > bestBid.value)) bestBid = { value: round.bid, holder: rec[side].name, game: rec.index, time: rec.time };
      if (round.set && (!worstSet || round.bid > worstSet.value)) worstSet = { value: round.bid, holder: rec[side].name, game: rec.index, time: rec.time };
    });
  });
  add(bestBid && { id: "bidMade", label: "Highest bid made", ...bestBid, unit: "bid" });
  add(worstSet && { id: "bidSet", label: "Biggest bid set", ...worstSet, unit: "bid" });

  const entityRecord = (id, label, list, pick, unit, minValue = 1, better, { ties = false } = {}) => {
    const best = statsBestOf(list, pick, better);
    if (!best || best.value < minValue) return;
    // Partners share team-level counts, so a tie names everyone on it rather than whoever sorted first.
    const holders = ties ? list.filter(entity => pick(entity) === best.value) : [best.item];
    const names = holders.map(entity => entity.name);
    const holder = names.length < 3 ? names.join(" and ") : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
    add({ id, label, value: best.value, unit, holder, ...(holders.length === 1 ? { entity: { kind: best.item.kind, key: best.item.key } } : {}) });
  };
  const everyone = [...teams, ...players];
  entityRecord("winStreak", "Longest win streak", everyone, e => e.longestWinStreak.length, "wins", 3);
  entityRecord("lossStreak", "Longest losing streak", everyone, e => e.longestLossStreak.length, "losses", 4);
  entityRecord("perfect360", "Most perfect 360s", players, e => e.perfect360s, "360s", 1, undefined, { ties: true });
  entityRecord("setsForced", "Most sets forced", players, e => e.setsForced, "sets", 3, undefined, { ties: true });
  entityRecord("misdeals", "Most misdeals", players, e => e.misdeals, "misdeals", 2, undefined, { ties: true });
  entityRecord("penalties", "Most table-talk penalties", players, e => e.penalties, "penalties", 1, undefined, { ties: true });
  if (totals.games) {
    const gate = statsGateFor(players);
    entityRecord("bestWinPct", "Best win rate", players.filter(e => e.gamesPlayed >= gate.games), e => e.winPercentNumber, "pct", 1, undefined, { ties: true });
  }
  return found;
}

// --- Insights ---
function statsBuildInsights(model) {
  const { totals, players, teams, bids, records, lists } = model;
  const found = [];
  const add = (insight) => { if (insight) found.push(insight); };
  const verb = (entity, plural, single) => (entity.kind === "team" && entity.players.filter(Boolean).length > 1 ? plural : single);
  const goto = entity => ({ entity: { kind: entity.kind, key: entity.key } });

  // Hot and cold runs right now.
  const hot = [...teams.list, ...players.list]
    .filter(e => e.streak.type === "W" && e.streak.length >= 3)
    .sort((a, b) => (b.streak.length - a.streak.length) || (b.gamesPlayed - a.gamesPlayed))[0];
  if (hot) {
    add({
      id: "hot", icon: "flame", tone: "good", score: 72 + hot.streak.length * 4,
      title: `${hot.name} ${verb(hot, "are", "is")} on a ${hot.streak.length}-game win streak`,
      detail: `${hot.wins}–${hot.losses} overall across ${statsPlural(hot.gamesPlayed, "game")}.`, action: goto(hot),
    });
  }
  const cold = [...teams.list, ...players.list]
    .filter(e => e.streak.type === "L" && e.streak.length >= 4)
    .sort((a, b) => (b.streak.length - a.streak.length) || (b.gamesPlayed - a.gamesPlayed))[0];
  if (cold) {
    add({
      id: "cold", icon: "snow", tone: "bad", score: 50 + cold.streak.length * 3,
      title: `${cold.name} ${verb(cold, "have", "has")} lost ${cold.streak.length} in a row`,
      detail: `${cold.wins}–${cold.losses} overall across ${statsPlural(cold.gamesPlayed, "game")}.`, action: goto(cold),
    });
  }

  // Who leads.
  const rankedPlayers = statsRankEntities(players.list, "winPct").filter(row => row.qualified);
  if (rankedPlayers.length >= 3) {
    const top = rankedPlayers[0].entity;
    add({
      id: "leader", icon: "crown", tone: "gold", score: 64,
      title: `${top.name} leads the table at ${Math.round(top.winPercentNumber)}% wins`,
      detail: `${top.wins}–${top.losses} over ${statsPlural(top.gamesPlayed, "game")}.`, action: goto(top),
    });
  }
  const rankedTeams = statsRankEntities(teams.list.filter(t => t.players.filter(Boolean).length === 2), "winPct")
    .filter(row => row.qualified && row.entity.gamesPlayed >= 4);
  if (rankedTeams.length >= 2) {
    const top = rankedTeams[0].entity;
    add({
      id: "pair", icon: "link", tone: "blue", score: 62,
      title: `${top.name} win ${Math.round(top.winPercentNumber)}% together`,
      detail: `${top.wins}–${top.losses} — the strongest partnership so far.`, action: goto(top),
    });
  }

  // Bidding.
  const sized = bids.buckets.filter(bucket => bucket.attempts >= STATS_MIN_BIDS && bucket.id !== "slam");
  if (sized.length >= 2 && totals.bidAttempts >= 30) {
    const best = sized.reduce((a, b) => (b.avgPoints > a.avgPoints ? b : a));
    add({
      id: "sweetSpot", icon: "target", tone: "blue", score: 66,
      title: `Bids of ${best.label} have earned the most`,
      detail: `${formatSignedStat(best.avgPoints)} points per hand on average, made ${Math.round(best.makePct)}% of the time.`,
      action: { tab: "bidding" },
    });
    const risky = sized.filter(bucket => bucket.makePct < 50).sort((a, b) => a.makePct - b.makePct)[0];
    if (risky) {
      add({
        id: "risky", icon: "alert", tone: "bad", score: 58,
        title: `Bids of ${risky.label} get set ${Math.round(100 - risky.makePct)}% of the time`,
        detail: `Across ${statsPlural(risky.attempts, "bid")} — a gamble that usually costs points.`, action: { tab: "bidding" },
      });
    }
  }
  const situations = bids.situations;
  if (situations.trailing.attempts >= 12 && situations.leading.attempts >= 12) {
    const gap = situations.trailing.avgBid - situations.leading.avgBid;
    if (Math.abs(gap) >= 4) {
      add({
        id: "pressure", icon: "bolt", tone: "gold", score: 47,
        title: gap > 0 ? "Teams bid bigger when they are behind" : "Teams bid smaller when they are behind",
        detail: `Trailing by ${STATS_CLOSE_MARGIN}+: average bid ${Math.round(situations.trailing.avgBid)}, made ${Math.round(situations.trailing.makePct)}%. Leading: ${Math.round(situations.leading.avgBid)}, made ${Math.round(situations.leading.makePct)}%.`,
        action: { tab: "bidding" },
      });
    }
  }
  const bidGate = Math.max(12, statsGateFor(players.list).bids);
  const bidders = players.list.filter(e => e.bidAttempts >= bidGate);
  if (bidders.length >= 3) {
    const safest = bidders.reduce((a, b) => (b.bidMakePct > a.bidMakePct ? b : a));
    add({
      id: "safestBidder", icon: "shield", tone: "good", score: 52,
      title: `${safest.name}'s bids get made ${Math.round(safest.bidMakePct)}% of the time`,
      detail: `The most reliable bidding side over ${statsPlural(safest.bidAttempts, "bid")}.`, action: goto(safest),
    });
  }
  const defenders = players.list.filter(e => e.defHands >= 15);
  if (defenders.length >= 3) {
    const best = defenders.reduce((a, b) => (b.setsForcedPct > a.setsForcedPct ? b : a));
    if (best.setsForcedPct >= 20) {
      add({
        id: "defense", icon: "shield", tone: "blue", score: 50,
        title: `${best.name} sets ${Math.round(best.setsForcedPct)}% of opposing bids`,
        detail: `${statsPlural(best.setsForced, "set")} forced from ${best.defHands} defensive hands.`, action: goto(best),
      });
    }
  }

  // Games themselves.
  const comeback = lists.comebacks[0];
  if (comeback && comeback.deficit >= STATS_BIG_COMEBACK) {
    add({
      id: "comeback", icon: "rocket", tone: "gold", score: 64,
      title: `${comeback.winnerName} came back from ${comeback.deficit} down`,
      detail: `The biggest turnaround on record${comeback.time ? `, ${statsFormatDate(comeback.time)}` : ""}.`, action: { game: comeback.index },
    });
  }
  const upsetRecord = model.recordBook.find(record => record.id === "upset");
  if (upsetRecord) {
    add({
      id: "upset", icon: "bolt", tone: "gold", score: 61,
      title: `${upsetRecord.holder} won with only ${upsetRecord.value}% odds`,
      detail: `The longest shot to pay off, ${upsetRecord.note}. Odds come from the win-probability model.`, action: { game: upsetRecord.game },
    });
  }
  if (totals.games >= 10) {
    const share = (totals.closeGames / totals.games) * 100;
    if (share >= 25) {
      add({
        id: "close", icon: "scale", tone: "blue", score: 40,
        title: `${Math.round(share)}% of games finish within ${STATS_CLOSE_MARGIN} points`,
        detail: `${statsPlural(totals.closeGames, "nail-biter")} out of ${totals.games}.`, action: { tab: "records" },
      });
    }
  }
  const rivalry = statsFindRivalry(teams.list);
  if (rivalry) {
    add({
      id: "rivalry", icon: "swords", tone: "gold", score: 55,
      title: `${rivalry.a} vs ${rivalry.b}: ${rivalry.aWins}–${rivalry.bWins}`,
      detail: `The tightest rivalry — ${statsPlural(rivalry.games, "meeting")} and nothing in it.`, action: { entity: { kind: "team", key: rivalry.aKey } },
    });
  }
  if (totals.perfect360s >= 1) {
    const leader = players.list.slice().sort((a, b) => b.perfect360s - a.perfect360s)[0];
    add({
      id: "perfect", icon: "star", tone: "gold", score: 46,
      title: `${statsPlural(totals.perfect360s, "perfect 360")} so far`,
      detail: leader && leader.perfect360s ? `${leader.name} has ${leader.perfect360s === totals.perfect360s ? "every one" : `the most with ${leader.perfect360s}`}.` : "A full sweep of the hand.", action: { tab: "records" },
    });
  }
  if (totals.games >= 8) {
    const peak = model.activity.weekday.reduce((best, count, day) => (count > best.count ? { day, count } : best), { day: 0, count: -1 });
    const share = (peak.count / totals.games) * 100;
    if (share >= 30) {
      add({
        id: "gameNight", icon: "calendar", tone: "blue", score: 36,
        title: `${statsWeekdayName(peak.day)} is game night`,
        detail: `${Math.round(share)}% of games were finished on a ${statsWeekdayName(peak.day)}.`, action: { tab: "overview" },
      });
    }
  }
  if (totals.games >= 3) {
    add({
      id: "pace", icon: "clock", tone: "blue", score: 30,
      title: `A typical game runs ${Math.round(totals.avgHands)} hands${totals.avgGameMs ? ` and ${formatDuration(totals.avgGameMs)}` : ""}`,
      detail: totals.avgLeadChanges >= 0.5 ? `The lead changes hands ${totals.avgLeadChanges.toFixed(1)} times per game.` : "Most games are led from start to finish.", action: { tab: "records" },
    });
  }
  const recent = model.recent;
  if (recent.last30 >= 1) {
    const change = recent.last30 - recent.prev30;
    add({
      id: "volume", icon: "trend", tone: change >= 0 ? "good" : "blue", score: 44,
      title: `${statsPlural(recent.last30, "game")} in the last 30 days`,
      detail: recent.prev30 ? `${change >= 0 ? "Up" : "Down"} ${Math.abs(change)} from the 30 days before.` : "Nothing in the 30 days before that.", action: { tab: "overview" },
    });
  }
  const misdealer = players.list.slice().sort((a, b) => b.misdeals - a.misdeals)[0];
  if (misdealer && misdealer.misdeals >= 3 && records.length >= 8) {
    add({
      id: "misdeals", icon: "shuffle", tone: "gold", score: 28,
      title: `${misdealer.name} leads the misdeal board`,
      detail: `${statsPlural(misdealer.misdeals, "misdeal")} and counting.`, action: goto(misdealer),
    });
  }

  return statsLimitPerEntity(found.sort((a, b) => b.score - a.score), 2);
}

// A dominant player could otherwise fill the whole list; keep the highlights varied.
function statsLimitPerEntity(insights, max) {
  const seen = new Map();
  return insights.filter(insight => {
    const key = insight.action && insight.action.entity ? insight.action.entity.key : "";
    if (!key) return true;
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    return count < max;
  });
}

function statsFindRivalry(teams) {
  let best = null;
  teams.forEach(team => {
    team.opponents.forEach(opponent => {
      if (team.key >= opponent.key || opponent.games < 4) return;
      if (Math.abs(opponent.wins - opponent.losses) > 1) return;
      if (!best || opponent.games > best.games) {
        best = { a: team.name, b: opponent.name, aKey: team.key, bKey: opponent.key, aWins: opponent.wins, bWins: opponent.losses, games: opponent.games };
      }
    });
  });
  return best;
}

function statsWeekdayName(day) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day] || "";
}

function statsFormatDate(ms, options = { month: "short", day: "numeric", year: "numeric" }) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const key = JSON.stringify(options);
  if (!STATS_DATE_FORMATS.has(key)) STATS_DATE_FORMATS.set(key, new Intl.DateTimeFormat([], options));
  return STATS_DATE_FORMATS.get(key).format(date);
}

// --- The model ---
function statsFilterRecords(records, bounds) {
  return bounds ? records.filter(rec => rec.hasTime && rec.time >= bounds.from && rec.time <= bounds.to) : records;
}

function buildStatsModel(rawGames, { period = "all", now = Date.now() } = {}) {
  const all = statsNormalizeGames(rawGames);
  const ratings = statsComputeRatings(all);
  const bounds = statsPeriodBounds(period, now);
  const records = statsFilterRecords(all, bounds);

  const buckets = statsBuildBidBuckets(records.flatMap(rec => ["us", "dem"].flatMap(side => rec.sideStats[side].bids.map(bid => bid.bid))));
  const { players: playerMap, teams: teamMap } = statsCollectEntities(records, buckets);
  const scopedOrders = bounds ? new Set(records.map(rec => rec.order)) : null;
  const playerList = [...playerMap.values()].map(entity => statsFinishEntity(entity, ratings, scopedOrders));
  const teamList = [...teamMap.values()].map(entity => statsFinishEntity(entity, ratings, scopedOrders));
  const byRecency = (a, b) => (b.lastPlayed - a.lastPlayed) || statsSortByName(a, b);
  playerList.sort(byRecency);
  teamList.sort(byRecency);

  const totals = statsBuildTotals(records);
  const model = {
    period, now, bounds, buckets,
    records, allCount: all.length,
    totals,
    players: { list: playerList, byKey: playerMap },
    teams: { list: teamList, byKey: teamMap },
    activity: statsBuildActivity(records, now),
    bids: statsBuildBidAnalytics(records, buckets),
    lists: statsBuildGameLists(records),
    recent: {
      last30: all.filter(rec => rec.hasTime && now - rec.time <= 30 * STATS_DAY_MS && rec.time <= now + STATS_DAY_MS).length,
      prev30: all.filter(rec => rec.hasTime && now - rec.time > 30 * STATS_DAY_MS && now - rec.time <= 60 * STATS_DAY_MS).length,
    },
  };
  const previousBounds = statsPreviousBounds(period, now);
  model.previous = previousBounds ? statsBuildTotals(statsFilterRecords(all, previousBounds)) : null;
  model.recordBook = statsBuildRecords(records, playerList, teamList, totals);
  model.insights = statsBuildInsights(model);
  return model;
}

// --- Caching and the older flat shape ---
const STATS_MODEL_CACHE = { raw: null, models: new Map() };

function clearStatisticsCache() {
  STATS_MODEL_CACHE.raw = null;
  STATS_MODEL_CACHE.models.clear();
  // Saved games changed (a delete, a cloud merge): a sheet that is open must not keep stale rows.
  if (typeof statsRefreshOpenSheets === "function") statsRefreshOpenSheets();
}

function getStatsModel({ period = "all", now = Date.now() } = {}) {
  const raw = localStorage.getItem("savedGames") || "";
  if (STATS_MODEL_CACHE.raw !== raw) {
    STATS_MODEL_CACHE.raw = raw;
    STATS_MODEL_CACHE.models.clear();
  }
  const key = `${period}|${statsDayKey(now)}`;
  if (!STATS_MODEL_CACHE.models.has(key)) {
    if (STATS_MODEL_CACHE.models.size >= 6) STATS_MODEL_CACHE.models.delete(STATS_MODEL_CACHE.models.keys().next().value);
    STATS_MODEL_CACHE.models.set(key, buildStatsModel(getLocalStorage("savedGames", []), { period, now }));
  }
  return STATS_MODEL_CACHE.models.get(key);
}

function getStatistics() {
  const model = getStatsModel({ period: "all" });
  const { totals } = model;
  return {
    totalGames: totals.games,
    totalRounds: totals.rounds,
    overallAverageBid: totals.avgBid === null ? "N/A" : formatStatNumber(totals.avgBid),
    overallBidMakePct: totals.bidMakePct,
    totalBidAttempts: totals.bidAttempts,
    totalBidsMade: totals.bidsMade,
    totalSetsForced: totals.bidsSet,
    totalPerfect360s: totals.perfect360s,
    totalMisdeals: totals.misdeals,
    averageMargin: totals.avgMargin,
    teamsData: model.teams.list,
    playersData: model.players.list,
    totalTimePlayedMs: totals.timeMs,
  };
}
