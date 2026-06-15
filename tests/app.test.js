const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function setupDomStubs() {
  const noop = () => {};

  const createClassList = () => ({
    add: noop,
    remove: noop,
    toggle: noop,
    contains: () => false,
  });

  const createStyle = () =>
    new Proxy(
      {},
      {
        get: () => '',
        set: () => true,
        has: () => false,
      },
    );

  function createElementStub() {
    const classList = createClassList();
    const style = createStyle();
    const element = {
      classList,
      style,
      dataset: {},
      textContent: '',
      innerHTML: '',
      appendChild: noop,
      removeChild: noop,
      append: noop,
      remove: noop,
      focus: noop,
      blur: noop,
      click: noop,
      insertAdjacentHTML: noop,
      setAttribute: noop,
      removeAttribute: noop,
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
      addEventListener: noop,
      removeEventListener: noop,
      querySelector: () => createElementStub(),
      querySelectorAll: () => [],
      scrollIntoView: noop,
      contains: () => false,
    };

    return new Proxy(element, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'innerHTML') {
          // Simulate browser's HTML escaping behavior
          const text = target.textContent || '';
          return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }
        if (prop === 'outerHTML' || prop === 'textContent') return target.textContent || '';
        if (prop === 'value') return target.value ?? '';
        if (prop === 'checked') return false;
        if (prop === Symbol.iterator) {
          return function* () {};
        }
        return noop;
      },
      set(target, prop, value) {
        if (prop === 'textContent') {
          target.textContent = value;
          return true;
        }
        target[prop] = value;
        return true;
      },
    });
  }

  const body = createElementStub();
  const documentElement = createElementStub();
  const head = createElementStub();

  const documentStub = {
    body,
    documentElement,
    head,
    title: '',
    readyState: 'complete',
    addEventListener: noop,
    removeEventListener: noop,
    getElementById: () => createElementStub(),
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
    createElement: () => createElementStub(),
    createElementNS: () => createElementStub(),
    createDocumentFragment: () => createElementStub(),
    createTextNode: () => createElementStub(),
    createRange: () => ({
      selectNodeContents: noop,
      setStart: noop,
      setEnd: noop,
      collapse: noop,
    }),
    execCommand: noop,
  };

  const storageMap = new Map();
  const storage = {
    getItem: key => (storageMap.has(key) ? storageMap.get(key) : null),
    setItem: (key, value) => storageMap.set(key, String(value)),
    removeItem: key => storageMap.delete(key),
    clear: () => storageMap.clear(),
    key: index => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  };

  const navigatorStub = {
    userAgent: 'node-test',
    clipboard: { writeText: noop },
    serviceWorker: {
      controller: null,
      addEventListener: noop,
      ready: Promise.resolve({}),
      register: () => Promise.resolve({}),
    },
  };

  const windowStub = {
    document: documentStub,
    localStorage: storage,
    navigator: navigatorStub,
    innerWidth: 1024,
    innerHeight: 768,
    devicePixelRatio: 2,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    requestAnimationFrame: cb => setTimeout(cb, 0),
    cancelAnimationFrame: id => clearTimeout(id),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    alert: noop,
    confirm: () => false,
    scrollTo: noop,
    location: { href: 'http://localhost/', reload: noop, assign: noop },
    matchMedia: () => ({
      matches: false,
      addListener: noop,
      removeListener: noop,
      addEventListener: noop,
      removeEventListener: noop,
    }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    performance: { now: () => Date.now() },
    crypto: { getRandomValues: array => array.fill(0) },
  };

  windowStub.window = windowStub;
  windowStub.globalThis = windowStub;

  global.window = windowStub;
  global.document = documentStub;
  global.localStorage = storage;
  global.navigator = navigatorStub;
  global.getComputedStyle = windowStub.getComputedStyle;
  global.self = windowStub;
  global.globalThis = global;

  return { documentStub, storage, windowStub };
}

setupDomStubs();

const {
  sanitizePlayerName,
  escapeHtml,
  escapeHtmlValue,
  escapeAttribute,
  ensurePlayersArray,
  canonicalizePlayers,
  formatTeamDisplay,
  buildTeamKey,
  parseLegacyTeamName,
  deriveTeamDisplay,
  getGameTeamDisplay,
  formatGameLocationParts,
  createManualGameLocationRecord,
  getStoredLocationDisplay,
  getGameLocationDisplay,
  captureGameLocation,
  getRematchDealerCandidates,
  buildDealerOrderStartingWith,
  buildRematchSetupState,
  playersEqual,
  renderReadOnlyGameDetails,
  buildSavedGameCard,
  buildFreezerGameCard,
  bucketScore,
  getBucketRange,
  buildProbabilityIndex,
  MODEL_FEATURE_SET,
  FALLBACK_RUNTIME_MODEL,
  PROBABILITY_PERSONALIZATION_KEY,
  buildModelFeatureVector,
  extractModelFeaturesFromRoundContext,
  predictBaseModelProbabilityFromFeatures,
  applyPlattCalibration,
  fitPersonalizationCalibration,
  ensureProbabilityPersonalizationForGames,
  getModelProbabilitySnapshotForState,
  buildWinProbabilityCacheKey,
  getWinProbability,
  getProbabilityContext,
  calculateWinProbabilityComplex,
  calculateWinProbability,
  getFilteredPlayerSuggestions,
} = require('../js/app.js');

const resetState = () => {
  localStorage.clear();
};

const makeTrainingGames = (numGames = 10, roundsPerGame = 6) => {
  const games = [];
  for (let g = 0; g < numGames; g += 1) {
    const usWins = g % 2 === 0;
    const rounds = [];
    let usTotal = 0;
    let demTotal = 0;
    for (let r = 0; r < roundsPerGame; r += 1) {
      const swing = 25 + (r * 5);
      const usPoints = usWins ? (60 + swing) : (35 - Math.floor(swing / 5));
      const demPoints = 180 - usPoints;
      usTotal += usPoints;
      demTotal += demPoints;
      rounds.push({
        roundIndex: r,
        bidAmount: 130 + ((r % 3) * 5),
        biddingTeam: r % 2 === 0 ? 'us' : 'dem',
        usPoints,
        demPoints,
        runningTotals: { us: usTotal, dem: demTotal },
      });
    }

    games.push({
      winner: usWins ? 'us' : 'dem',
      finalScore: { us: usTotal, dem: demTotal },
      rounds,
      timestamp: new Date(Date.UTC(2025, 0, 1 + g)).toISOString(),
    });
  }
  return games;
};

test('sanitizePlayerName trims and normalizes whitespace', () => {
  assert.equal(sanitizePlayerName('  Alice   Bob '), 'Alice Bob');
  assert.equal(sanitizePlayerName('\tCarol\n'), 'Carol');
  assert.equal(sanitizePlayerName(undefined), '');
});

test('ensurePlayersArray always returns two sanitized names', () => {
  const cleaned = ensurePlayersArray(['  Alice  ', ' Bob ']);
  assert.deepEqual(cleaned, ['Alice', 'Bob']);

  const withMissing = ensurePlayersArray(['Alice']);
  assert.deepEqual(withMissing, ['Alice', '']);

  const fallback = ensurePlayersArray(null);
  assert.deepEqual(fallback, ['', '']);
});

test('formatGameLocationParts normalizes street city and state code', () => {
  assert.equal(
    formatGameLocationParts({ street: ' 123 Main St ', city: ' Detroit ', state: 'Michigan' }),
    '123 Main St, Detroit, MI',
  );
  assert.equal(
    formatGameLocationParts({ street: 'W Capitol Dr', city: 'Milwaukee', state: 'wi' }),
    'W Capitol Dr, Milwaukee, WI',
  );
});

test('manual game location records and game display prefer completed location', () => {
  const manual = createManualGameLocationRecord(' 55 Lake St, Marquette, Michigan ');
  assert.equal(manual.formatted, '55 Lake St, Marquette, MI');
  assert.equal(getStoredLocationDisplay(manual), '55 Lake St, Marquette, MI');
  assert.equal(
    getGameLocationDisplay({
      frozenLocation: createManualGameLocationRecord('12 Frozen Rd, Green Bay, WI'),
      location: manual,
    }),
    '55 Lake St, Marquette, MI',
  );
});

test('captureGameLocation does not prompt when automatic location is unavailable', async () => {
  let promptCalled = false;
  const originalPrompt = window.prompt;
  window.prompt = () => {
    promptCalled = true;
    return 'Should Not Be Used, Detroit, MI';
  };

  try {
    const location = await captureGameLocation();
    assert.equal(location, null);
    assert.equal(promptCalled, false);
  } finally {
    if (originalPrompt === undefined) {
      delete window.prompt;
    } else {
      window.prompt = originalPrompt;
    }
  }
});

test('saved and freezer game cards render formatted location details', () => {
  const completedGame = {
    usTeamName: 'Alice & Bob',
    demTeamName: 'Cara & Dan',
    usPlayers: ['Alice', 'Bob'],
    demPlayers: ['Cara', 'Dan'],
    winner: 'us',
    victoryMethod: 'Won on Bid',
    timestamp: '2026-05-18T14:00:00.000Z',
    durationMs: 600000,
    finalScore: { us: 520, dem: 220 },
    rounds: [{ bidAmount: 120, biddingTeam: 'us', usPoints: 130, demPoints: 50, runningTotals: { us: 520, dem: 220 } }],
    frozenLocation: createManualGameLocationRecord('10 Frozen Rd, Lansing, MI'),
    location: createManualGameLocationRecord('100 Final St, Detroit, MI'),
  };
  const freezerGame = {
    usName: 'Eve & Finn',
    demName: 'Gina & Hank',
    usPlayers: ['Eve', 'Finn'],
    demPlayers: ['Gina', 'Hank'],
    timestamp: '2026-05-18T14:00:00.000Z',
    finalScore: { us: 180, dem: 60 },
    lastBid: '130 (Eve & Finn)',
    accumulatedTime: 300000,
    frozenLocation: createManualGameLocationRecord('200 Freeze Ave, Madison, WI'),
  };

  const completedCard = buildSavedGameCard(completedGame, 0);
  const freezerCard = buildFreezerGameCard(freezerGame, 0);
  const detailsHtml = renderReadOnlyGameDetails(completedGame);

  assert.match(completedCard, /Location: 100 Final St, Detroit, MI/);
  assert.doesNotMatch(completedCard, /10 Frozen Rd/);
  assert.match(freezerCard, /Last frozen at: 200 Freeze Ave, Madison, WI/);
  assert.match(detailsHtml, /<span class="text-xs font-semibold text-gray-800 dark:text-white">Location<\/span>/);
  assert.match(detailsHtml, /100 Final St, Detroit, MI/);
});

test('sanitizePlayerName returns empty string for non-string values', () => {
  assert.equal(sanitizePlayerName(123), '');
  assert.equal(sanitizePlayerName({ name: 'Alice' }), '');
});

test('canonicalizePlayers sorts names case-insensitively', () => {
  assert.deepEqual(canonicalizePlayers(['bob', 'Alice ']), ['Alice', 'bob']);
  assert.deepEqual(canonicalizePlayers(['', '']), ['', '']);
});

test('formatTeamDisplay joins non-empty names with ampersand', () => {
  assert.equal(formatTeamDisplay(['Alice', 'Bob']), 'Alice & Bob');
  assert.equal(formatTeamDisplay(['Alice', '']), 'Alice');
  assert.equal(formatTeamDisplay(['', '']), '');
});

test('rematch dealer candidates prefer the current dealing order', () => {
  const candidates = getRematchDealerCandidates({
    dealers: ['Alice', 'Bob', 'Carol', 'Dan'],
    usPlayers: ['Alice', 'Carol'],
    demPlayers: ['Bob', 'Dan'],
  });

  assert.deepEqual(candidates, ['Alice', 'Bob', 'Carol', 'Dan']);
});

test('rematch dealer candidates fall back to interleaved team players', () => {
  const candidates = getRematchDealerCandidates({
    dealers: [],
    usTeamName: 'Alice & Carol',
    demTeamName: 'Bob & Dan',
  });

  assert.deepEqual(candidates, ['Alice', 'Bob', 'Carol', 'Dan']);
});

test('buildDealerOrderStartingWith rotates the order to the selected starter', () => {
  assert.deepEqual(
    buildDealerOrderStartingWith(['Alice', 'Bob', 'Carol', 'Dan'], 'Carol'),
    ['Carol', 'Dan', 'Alice', 'Bob'],
  );
  assert.deepEqual(buildDealerOrderStartingWith(['Alice', 'Bob', 'Carol', 'Dan'], 'Eve'), []);
});

test('buildRematchSetupState keeps players and clears game progress', () => {
  const nextState = buildRematchSetupState({
    rounds: [{ bidAmount: 120 }],
    undoneRounds: [{ bidAmount: 125 }],
    gameOver: true,
    winner: 'us',
    usTeamName: 'Alice & Carol',
    demTeamName: 'Bob & Dan',
    usPlayers: ['Alice', 'Carol'],
    demPlayers: ['Bob', 'Dan'],
    startingTotals: { us: 420, dem: 310 },
    dealers: ['Alice', 'Bob', 'Carol', 'Dan'],
    misdealCount: 2,
  }, 'Bob', true);

  assert.ok(nextState);
  assert.deepEqual(nextState.rounds, []);
  assert.deepEqual(nextState.undoneRounds, []);
  assert.equal(nextState.gameOver, false);
  assert.equal(nextState.winner, null);
  assert.deepEqual(nextState.startingTotals, { us: 0, dem: 0 });
  assert.deepEqual(nextState.usPlayers, ['Alice', 'Carol']);
  assert.deepEqual(nextState.demPlayers, ['Bob', 'Dan']);
  assert.deepEqual(nextState.dealers, ['Bob', 'Carol', 'Dan', 'Alice']);
  assert.equal(nextState.misdealCount, 0);
  assert.equal(nextState.showWinProbability, true);
});

test('buildTeamKey lowercases sorted player names', () => {
  assert.equal(buildTeamKey(['Alice', 'bob']), 'alice||bob');
  assert.equal(buildTeamKey(['', '']), '');
});
test('getFilteredPlayerSuggestions returns recent matching names without duplicates', () => {
  const suggestions = getFilteredPlayerSuggestions([
    ' Alice ',
    'bob',
    'ALICE',
    'Bobby',
    'Carol',
    '',
  ], 'bo', 5);

  assert.deepEqual(suggestions, ['bob', 'Bobby']);
});

test('getFilteredPlayerSuggestions limits blank-query results to the requested size', () => {
  const suggestions = getFilteredPlayerSuggestions(['Alice', 'Bob', 'Carol', 'Diane'], '', 2);

  assert.deepEqual(suggestions, ['Alice', 'Bob']);
});

test('getFilteredPlayerSuggestions excludes names already chosen elsewhere', () => {
  const suggestions = getFilteredPlayerSuggestions(['Alice', 'Bob', 'Carol', 'Diane'], '', 6, [' bob ', 'DIANE']);

  assert.deepEqual(suggestions, ['Alice', 'Carol']);
});


test('parseLegacyTeamName handles separators and fallbacks', () => {
  assert.deepEqual(parseLegacyTeamName('Alice & Bob'), ['Alice', 'Bob']);
  assert.deepEqual(parseLegacyTeamName('Alice and Bob'), ['Alice', 'Bob']);
  assert.deepEqual(parseLegacyTeamName('Solo'), ['Solo', '']);
  assert.deepEqual(parseLegacyTeamName(''), ['', '']);
});

test('deriveTeamDisplay prefers players but respects fallback text', () => {
  assert.equal(deriveTeamDisplay(['Alice', 'Bob'], 'Fallback'), 'Alice & Bob');
  assert.equal(deriveTeamDisplay(['', ''], 'Fallback'), 'Fallback');
});

test('getGameTeamDisplay canonicalizes player names and falls back as needed', () => {
  const game = {
    usPlayers: ['  Bob', 'Alice '],
    demPlayers: ['Zoe', 'Yan'],
    usTeamName: 'Us Team',
    demTeamName: 'Dem Team',
  };

  assert.equal(getGameTeamDisplay(game, 'us'), 'Alice & Bob');
  assert.equal(getGameTeamDisplay(game, 'dem'), 'Yan & Zoe');
  assert.equal(getGameTeamDisplay({}, 'us'), 'Us');
});

test('getGameTeamDisplay uses legacy fields and guards invalid input', () => {
  const game = {
    usPlayers: null,
    usTeamPlayers: ['Zoe', 'Alan'],
    usTeamName: 'Legacy Us',
    demPlayers: ['', ''],
    demTeamName: 'Defenders',
    demName: 'Fallback Dem',
  };

  assert.equal(getGameTeamDisplay(game, 'us'), 'Alan & Zoe');
  assert.equal(getGameTeamDisplay(game, 'dem'), 'Defenders');
  assert.equal(getGameTeamDisplay(null, 'us'), 'Us');
  assert.equal(getGameTeamDisplay(game, 'invalid'), 'Dem');
});

test('playersEqual ignores ordering but respects exact casing', () => {
  assert.equal(playersEqual(['Alice', 'Bob'], ['Bob', 'Alice']), true);
  assert.equal(playersEqual(['Alice', ''], ['', 'Alice']), true);
  assert.equal(playersEqual(['Alice', 'Bob'], ['alice', 'bob']), false);
  assert.equal(playersEqual(['Alice', 'Bob'], ['Alice', 'Charlie']), false);
});

test('bucketScore groups differences into twenty point buckets with caps', () => {
  assert.equal(bucketScore(1), 20);
  assert.equal(bucketScore(19), 20);
  assert.equal(bucketScore(20), 20);
  assert.equal(bucketScore(21), 40);
  assert.equal(bucketScore(-1), -20);
  assert.equal(bucketScore(-37), -40);
  assert.equal(bucketScore(999), 180);
});

test('bucketScore reserves zero for ties and caps large negative swings', () => {
  assert.equal(bucketScore(0), 0);
  assert.equal(bucketScore(-5), -20);
  assert.equal(bucketScore(-999), -180);
});

test('getBucketRange labels score buckets with matching signed bucket semantics', () => {
  assert.equal(getBucketRange(0), '0');
  assert.equal(getBucketRange(20), '1-20');
  assert.equal(getBucketRange(-40), '21-40');
  assert.equal(getBucketRange(180), '161+');
});

test('model feature set includes all expected runtime features', () => {
  assert.equal(MODEL_FEATURE_SET.length, 14);
  assert.ok(MODEL_FEATURE_SET.includes('diff'));
  assert.ok(MODEL_FEATURE_SET.includes('momentum_x_round'));
  assert.ok(MODEL_FEATURE_SET.includes('lead_sign'));
});

test('extractModelFeaturesFromRoundContext maps full feature vector correctly', () => {
  const prevRound = { runningTotals: { us: 45, dem: 135 } };
  const lastRound = {
    runningTotals: { us: 200, dem: 190 },
    bidAmount: 140,
    biddingTeam: 'Dem',
    usPoints: 155,
    demPoints: 55,
  };
  const features = extractModelFeaturesFromRoundContext(1, lastRound, prevRound);

  assert.equal(features.diff, 10);
  assert.equal(features.round_idx, 1);
  assert.equal(features.momentum, 100);
  assert.equal(features.bid_amount, 140);
  assert.equal(features.bidding_team_sign, -1);
  assert.equal(features.point_delta, 100);
  assert.equal(features.abs_diff, 10);
  assert.equal(features.abs_momentum, 100);
  assert.equal(features.diff_x_round, 10);
  assert.equal(features.point_delta_x_round, 100);
  assert.equal(features.bid_x_team, -140);
  assert.equal(features.diff_x_point_delta, 1000);
  assert.equal(features.momentum_x_round, 100);
  assert.equal(features.lead_sign, 1);
});

test('extractModelFeaturesFromRoundContext normalizes missing bid and team fields', () => {
  const lastRound = {
    runningTotals: { us: 20, dem: 60 },
    usPoints: 20,
    demPoints: 60,
  };
  const features = extractModelFeaturesFromRoundContext(0, lastRound, null);
  assert.equal(features.bid_amount, 0);
  assert.equal(features.bidding_team_sign, 0);
  assert.equal(features.momentum, 0);
});

test('base model probability matches expected calibrated value for known round sample', () => {
  const features = buildModelFeatureVector({
    diff: -90,
    roundIdx: 0,
    momentum: 0,
    bidAmount: 130,
    biddingTeamSign: -1,
    pointDelta: -90,
  });

  const probUs = predictBaseModelProbabilityFromFeatures(features, FALLBACK_RUNTIME_MODEL);
  assert.ok(Math.abs(probUs - 0.3609258237010129) < 1e-9);
});

test('buildProbabilityIndex aggregates historical outcomes with priors', () => {
  resetState();
  const fixedNow = Date.now();
  const originalNow = Date.now;
  Date.now = () => fixedNow;
  try {
    const historicalGames = [
      {
        finalScore: { us: 500, dem: 300 },
        rounds: [
          { runningTotals: { us: 120, dem: 40 } },
          { runningTotals: { us: 220, dem: 120 } },
        ],
        timestamp: new Date(fixedNow).toISOString(),
      },
      {
        finalScore: { us: 420, dem: 500 },
        rounds: [
          { runningTotals: { us: 0, dem: 60 } },
        ],
        timestamp: new Date(fixedNow).toISOString(),
      },
    ];

    const table = buildProbabilityIndex(historicalGames);
    assert.ok(table['0|80']);
    assert.deepEqual(table['0|80'], { us: 2, dem: 1 });
    assert.deepEqual(table['1|100'], { us: 2, dem: 1 });
    assert.deepEqual(table['0|-60'], { us: 1, dem: 2 });
  } finally {
    Date.now = originalNow;
  }
});

test('buildProbabilityIndex uses explicit saved winner over final score leader', () => {
  const historicalGames = [
    {
      winner: 'us',
      finalScore: { us: 480, dem: 520 },
      rounds: [{ runningTotals: { us: 10, dem: 0 } }],
    },
  ];

  const table = buildProbabilityIndex(historicalGames);
  assert.deepEqual(table['0|20'], { us: 2, dem: 1 });
});

test('buildProbabilityIndex weights games equally and skips invalid games', () => {
  resetState();
  const fixedNow = new Date('2025-01-15T00:00:00Z').valueOf();
  const fourteenDays = 14 * 86_400_000;
  const historicalGames = [
    {
      finalScore: { us: 400, dem: 320 },
      rounds: [{ runningTotals: { us: 140, dem: 80 } }],
      timestamp: new Date(fixedNow).toISOString(),
    },
    {
      finalScore: { us: 410, dem: 360 },
      rounds: [
        { runningTotals: { us: 160, dem: 100 } },
        {},
      ],
      timestamp: new Date(fixedNow - fourteenDays).toISOString(),
    },
    {
      // Missing finalScore should be ignored entirely
      rounds: [{ runningTotals: { us: 100, dem: 40 } }],
      timestamp: new Date(fixedNow).toISOString(),
    },
    {
      finalScore: { us: 330, dem: 420 },
      rounds: [{}],
      timestamp: new Date(fixedNow).toISOString(),
    },
  ];

  const table = buildProbabilityIndex(historicalGames);
  const key = '0|60';
  assert.ok(table[key]);
  assert.deepEqual(table[key], { us: 3, dem: 1 });
  // Missing or empty runningTotals entries should not create additional buckets
  assert.equal(table['1|0'], undefined);
});

test('buildProbabilityIndex ignores timestamps when aggregating', () => {
  resetState();
  const historicalGames = [
    {
      finalScore: { us: 500, dem: 300 },
      rounds: [{ runningTotals: { us: 0, dem: 0 } }],
      timestamp: undefined,
    },
    {
      finalScore: { us: 500, dem: 300 },
      rounds: [{ runningTotals: { us: 0, dem: 0 } }],
      timestamp: 'not-a-date',
    },
  ];

  const table = buildProbabilityIndex(historicalGames);
  assert.deepEqual(table['0|0'], { us: 3, dem: 1 });
});

test('buildProbabilityIndex does not bias ties toward a team', () => {
  resetState();
  const fixedNow = new Date('2025-02-01T00:00:00Z').valueOf();
  const originalNow = Date.now;
  Date.now = () => fixedNow;
  try {
    const historicalGames = [
      {
        finalScore: { us: 500, dem: 500 },
        rounds: [{ runningTotals: { us: 0, dem: 0 } }],
        timestamp: new Date(fixedNow).toISOString(),
      },
    ];

    const table = buildProbabilityIndex(historicalGames);
    assert.deepEqual(table['0|0'], { us: 1.5, dem: 1.5 });
  } finally {
    Date.now = originalNow;
  }
});

test('calculateWinProbabilityComplex keeps small leads separated by team', () => {
  const historicalGames = Array.from({ length: 30 }, (_, index) => ({
    winner: 'us',
    finalScore: { us: 500 + index, dem: 300 },
    rounds: [{ runningTotals: { us: 10, dem: 0 } }],
  }));
  const usSmallLead = { rounds: [{ runningTotals: { us: 10, dem: 0 } }] };
  const demSmallLead = { rounds: [{ runningTotals: { us: 0, dem: 10 } }] };

  const table = buildProbabilityIndex(historicalGames);
  assert.deepEqual(table['0|20'], { us: 31, dem: 1 });
  assert.equal(table['0|-20'], undefined);

  const usLeadProb = calculateWinProbabilityComplex(usSmallLead, historicalGames);
  const demLeadProb = calculateWinProbabilityComplex(demSmallLead, historicalGames);
  assert.ok(usLeadProb.us > 90);
  assert.ok(demLeadProb.us < usLeadProb.us);
});

test('calculateWinProbabilityComplex blends empirical and model probabilities', () => {
  resetState();
  const fixedNow = Date.now();
  const originalNow = Date.now;
  Date.now = () => fixedNow;
  try {
    const state = {
      rounds: [
        { runningTotals: { us: 120, dem: 60 } },
        { runningTotals: { us: 220, dem: 160 } },
      ],
    };

    const historicalGames = [
      {
        finalScore: { us: 500, dem: 350 },
        rounds: [
          { runningTotals: { us: 80, dem: 40 } },
          { runningTotals: { us: 200, dem: 150 } },
        ],
        timestamp: new Date(fixedNow).toISOString(),
      },
      {
        finalScore: { us: 360, dem: 500 },
        rounds: [
          { runningTotals: { us: 40, dem: 80 } },
          { runningTotals: { us: 130, dem: 190 } },
        ],
        timestamp: new Date(fixedNow).toISOString(),
      },
      {
        finalScore: { us: 500, dem: 250 },
        rounds: [
          { runningTotals: { us: 60, dem: 20 } },
          { runningTotals: { us: 190, dem: 120 } },
        ],
        timestamp: new Date(fixedNow).toISOString(),
      },
    ];

    const result = calculateWinProbabilityComplex(state, historicalGames);
    assert.ok(result.us >= 0 && result.us <= 100);
    assert.ok(result.dem >= 0 && result.dem <= 100);
    assert.notEqual(result.us, 50);
    assert.equal(Number(result.us.toFixed(1)) + Number(result.dem.toFixed(1)), 100);
  } finally {
    Date.now = originalNow;
  }
});

test('calculateWinProbabilityComplex cache keys include game content', () => {
  resetState();
  const fixedNow = new Date('2025-02-01T00:00:00Z').valueOf();
  const originalNow = Date.now;
  Date.now = () => fixedNow;
  try {
    const state = {
      rounds: [{ runningTotals: { us: 0, dem: 0 } }],
    };

    const iso = new Date(fixedNow).toISOString();
    const historicalGamesUs = [
      {
        finalScore: { us: 500, dem: 300 },
        rounds: [{ runningTotals: { us: 0, dem: 0 } }],
        timestamp: iso,
      },
      {
        finalScore: { us: 500, dem: 320 },
        rounds: [{ runningTotals: { us: 0, dem: 0 } }],
        timestamp: iso,
      },
    ];
    const historicalGamesDem = [
      {
        finalScore: { us: 300, dem: 500 },
        rounds: [{ runningTotals: { us: 0, dem: 0 } }],
        timestamp: iso,
      },
      {
        finalScore: { us: 320, dem: 500 },
        rounds: [{ runningTotals: { us: 0, dem: 0 } }],
        timestamp: iso,
      },
    ];

    const usFavored = calculateWinProbabilityComplex(state, historicalGamesUs);
    const demFavored = calculateWinProbabilityComplex(state, historicalGamesDem);
    assert.ok(usFavored.us > demFavored.us);
  } finally {
    Date.now = originalNow;
  }
});

test('calculateWinProbabilityComplex returns even odds with no rounds', () => {
  const result = calculateWinProbabilityComplex({ rounds: [] }, []);
  assert.deepEqual(result, { us: 50, dem: 50 });
});

test('calculateWinProbabilityComplex falls back to runtime regression model without history', () => {
  const state = {
    rounds: [
      {
        runningTotals: { us: 45, dem: 135 },
        bidAmount: 130,
        biddingTeam: 'Dem',
        usPoints: 45,
        demPoints: 135,
      },
      {
        runningTotals: { us: 200, dem: 190 },
        bidAmount: 140,
        biddingTeam: 'dem',
        usPoints: 155,
        demPoints: 55,
      },
    ],
  };
  const snapshot = getModelProbabilitySnapshotForState(state, FALLBACK_RUNTIME_MODEL, null);
  const result = calculateWinProbabilityComplex(state, []);

  assert.equal(result.us, +(snapshot.modelProbUs * 100).toFixed(1));
  assert.equal(result.dem, +((1 - snapshot.modelProbUs) * 100).toFixed(1));
});

test('calculateWinProbabilityComplex favors opponent when trailing with no data', () => {
  const state = {
    rounds: [
      { runningTotals: { us: 80, dem: 120 } },
    ],
  };
  const result = calculateWinProbabilityComplex(state, []);
  assert.ok(result.dem > result.us);
  assert.equal(result.us + result.dem, 100);
});

test('calculateWinProbabilityComplex never returns 0% or 100% endpoints', () => {
  const usLocked = calculateWinProbabilityComplex({
    rounds: [
      { runningTotals: { us: 500, dem: 0 } },
    ],
  }, []);
  assert.ok(usLocked.us < 100);
  assert.ok(usLocked.dem > 0);

  const demLocked = calculateWinProbabilityComplex({
    rounds: [
      { runningTotals: { us: 0, dem: 500 } },
    ],
  }, []);
  assert.ok(demLocked.us > 0);
  assert.ok(demLocked.dem < 100);
});

test('calculateWinProbability proxies to calculateWinProbabilityComplex', () => {
  const state = {
    rounds: [
      { runningTotals: { us: 120, dem: 60 } },
    ],
  };
  const historicalGames = [];
  assert.deepEqual(
    calculateWinProbability(state, historicalGames),
    calculateWinProbabilityComplex(state, historicalGames),
  );
});

test('fitPersonalizationCalibration returns identity when improvement threshold is not met', () => {
  const logits = [0, 0, 0, 0, 0, 0];
  const labels = [0, 1, 0, 1, 0, 1];
  const result = fitPersonalizationCalibration(logits, labels, { minImprovement: 0.5 });

  assert.equal(result.accepted, false);
  assert.equal(result.slope, 1);
  assert.equal(result.intercept, 0);
  assert.equal(result.personalizedLogLoss, result.baseLogLoss);
});

test('fitPersonalizationCalibration accepts calibration when log loss improves', () => {
  const logits = [-1, -0.6, -0.2, 0.2, 0.6, 1];
  const labels = [0, 0, 0, 1, 1, 1];
  const result = fitPersonalizationCalibration(logits, labels, {
    epochs: 5000,
    minImprovement: 1e-8,
    maxSlope: 100,
    maxAbsIntercept: 20,
  });

  assert.equal(result.accepted, true);
  assert.ok(result.personalizedLogLoss < result.baseLogLoss);
  assert.notEqual(result.slope, 1);
});

test('ensureProbabilityPersonalizationForGames stores personalization record from saved games', () => {
  resetState();
  const games = makeTrainingGames(10, 6);
  const record = ensureProbabilityPersonalizationForGames(games, FALLBACK_RUNTIME_MODEL, { force: true });
  const stored = JSON.parse(localStorage.getItem(PROBABILITY_PERSONALIZATION_KEY));

  assert.equal(stored.schemaVersion, 1);
  assert.equal(stored.modelId, FALLBACK_RUNTIME_MODEL.modelId);
  assert.equal(stored.gameSamples, 10);
  assert.equal(stored.roundSamples, 60);
  assert.equal(record.gamesHash, stored.gamesHash);
});

test('ensureProbabilityPersonalizationForGames does not recompute when hash is unchanged', () => {
  resetState();
  const games = makeTrainingGames(10, 6);
  ensureProbabilityPersonalizationForGames(games, FALLBACK_RUNTIME_MODEL, { force: true });
  const firstStored = JSON.parse(localStorage.getItem(PROBABILITY_PERSONALIZATION_KEY));

  const secondRecord = ensureProbabilityPersonalizationForGames(games, FALLBACK_RUNTIME_MODEL);
  const secondStored = JSON.parse(localStorage.getItem(PROBABILITY_PERSONALIZATION_KEY));

  assert.equal(secondRecord.gamesHash, firstStored.gamesHash);
  assert.equal(secondStored.updatedAt, firstStored.updatedAt);
});

test('win probability cache key and output change when personalization parameters change', () => {
  resetState();
  const state = {
    rounds: [
      {
        runningTotals: { us: 160, dem: 80 },
        bidAmount: 130,
        biddingTeam: 'us',
        usPoints: 160,
        demPoints: 80,
      },
    ],
  };
  const historicalGames = [];
  const common = {
    schemaVersion: 1,
    modelId: FALLBACK_RUNTIME_MODEL.modelId,
    roundSamples: 120,
    gameSamples: 20,
    gamesHash: '0',
    updatedAt: '2026-02-06T00:00:00.000Z',
    baseLogLoss: 0.5,
  };
  const contextA = {
    model: FALLBACK_RUNTIME_MODEL,
    personalization: { ...common, slope: 1, intercept: 0, personalizedLogLoss: 0.49 },
  };
  const contextB = {
    model: FALLBACK_RUNTIME_MODEL,
    personalization: { ...common, slope: 2, intercept: 0, personalizedLogLoss: 0.45 },
  };

  const keyA = buildWinProbabilityCacheKey(state, historicalGames, contextA);
  const keyB = buildWinProbabilityCacheKey(state, historicalGames, contextB);
  assert.notEqual(keyA, keyB);

  const first = getWinProbability(state, historicalGames, contextA);
  const second = getWinProbability(state, historicalGames, contextB);
  assert.notEqual(first.us, second.us);
});

test('win probability cache key changes when current round model features change', () => {
  const historicalGames = [];
  const context = { model: FALLBACK_RUNTIME_MODEL, personalization: null };
  const directBidState = {
    rounds: [
      {
        runningTotals: { us: 160, dem: 140 },
        bidAmount: 120,
        biddingTeam: 'us',
        usPoints: 160,
        demPoints: 140,
      },
    ],
  };
  const higherBidSameScoreState = {
    rounds: [
      {
        runningTotals: { us: 160, dem: 140 },
        bidAmount: 180,
        biddingTeam: 'dem',
        usPoints: 140,
        demPoints: 160,
      },
    ],
  };

  const keyA = buildWinProbabilityCacheKey(directBidState, historicalGames, context);
  const keyB = buildWinProbabilityCacheKey(higherBidSameScoreState, historicalGames, context);
  assert.notEqual(keyA, keyB);

  const first = getWinProbability(directBidState, historicalGames, context);
  const second = getWinProbability(higherBidSameScoreState, historicalGames, context);
  assert.notEqual(first.us, second.us);
});

// --- Dealer Order & Misdeal Handling Tests ---

test('escapeHtml returns empty string for non-string input', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(123), '');
  assert.equal(escapeHtml({}), '');
});

test('escapeHtml handles empty strings', () => {
  assert.equal(escapeHtml(''), '');
});

test('escapeHtml escapes text that could break out of templates', () => {
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)"> & Tom\'s'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Tom&#39;s',
  );
});

test('escapeAttribute escapes non-string values through the value helper', () => {
  assert.equal(escapeHtmlValue(180), '180');
  assert.equal(escapeAttribute('" onclick="alert(1)'), '&quot; onclick=&quot;alert(1)');
});

test('service worker update flow activates without a user prompt', () => {
  const source = readFileSync(
    path.join(repoRoot, 'js/modules/14-initialization-and-exports.js'),
    'utf8',
  );

  assert.doesNotMatch(source, /confirm\s*\(/);
  assert.match(source, /activateUpdatedWorker/);
  assert.match(source, /registration\.waiting/);
  assert.match(source, /registration\.addEventListener\('updatefound'/);
  assert.match(source, /SKIP_WAITING/);
  assert.match(source, /updateViaCache:\s*'none'/);
  assert.match(source, /registration\.update\(\)/);
});

test('service worker cache bump skips waiting after precache', () => {
  const source = readFileSync(path.join(repoRoot, 'service-worker.js'), 'utf8');

  assert.match(source, /const CACHE_NAME = "rook-cache-v2\.1\.2";/);
  assert.match(source, /cache\.addAll\(urlsToCache\)/);
  assert.match(source, /self\.skipWaiting\(\)/);
  assert.match(source, /self\.clients\.claim\(\)/);
});

test('version surfaces are aligned for the 2.1 release', () => {
  const configSource = readFileSync(path.join(repoRoot, 'js/modules/00-config.js'), 'utf8');
  const htmlSource = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.version, '2.1.0');
  assert.match(configSource, /const APP_VERSION = "2\.1";/);
  assert.match(configSource, /Version 2\.1 adds the cartoony glass theme/);
  assert.match(htmlSource, /<p>2\.1<\/p>/);
  assert.match(htmlSource, /What's New in v2\.1/);
});

test('version badge opens an in-app release modal instead of an alert', () => {
  const htmlSource = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const miscSource = readFileSync(path.join(repoRoot, 'js/modules/09-settings-validation-misc.js'), 'utf8');
  const initSource = readFileSync(path.join(repoRoot, 'js/modules/14-initialization-and-exports.js'), 'utf8');

  assert.match(htmlSource, /id="versionInfoModal"/);
  assert.match(htmlSource, /id="versionInfoModalMessage"/);
  assert.match(miscSource, /function showVersionNum\(\)/);
  assert.match(miscSource, /openModal\("versionInfoModal"\)/);
  assert.match(miscSource, /message\.textContent = APP_RELEASE_SUMMARY/);
  assert.doesNotMatch(miscSource, /alert\s*\(\s*APP_RELEASE_SUMMARY\s*\)/);
  assert.match(initSource, /versionInfoModal: closeVersionInfoModal/);
});

test('liquid glass cards do not globally replay entrance animations', () => {
  const css = readFileSync(path.join(repoRoot, 'css/app.css'), 'utf8');
  const glassCardRule = css.match(/body\.liquid-glass :is\(\.bg-white,[\s\S]*?\n\}/);

  assert.ok(glassCardRule);
  assert.doesNotMatch(glassCardRule[0], /animation:\s*cardPopIn/);
  assert.match(css, /\.animate-card-pop\s*\{/);
});

test('main card pop animations are gated by render state', () => {
  const stateSource = readFileSync(path.join(repoRoot, 'js/modules/01-state-and-win-prob-render.js'), 'utf8');
  const renderSource = readFileSync(path.join(repoRoot, 'js/modules/11-rendering.js'), 'utf8');

  assert.match(stateSource, /function getOneShotCardPopAnimation/);
  assert.match(stateSource, /function getScoreCardAnimation/);
  assert.match(stateSource, /function getHistoryCardAnimation/);
  assert.match(renderSource, /getOneShotCardPopAnimation\(`team-card:\$\{teamKey\}`/);
  assert.match(renderSource, /getScoreCardAnimation\(biddingTeam/);
  assert.match(renderSource, /getHistoryCardAnimation\(rounds\.length/);
  assert.doesNotMatch(renderSource, /style="animation: cardPopIn/);
});
