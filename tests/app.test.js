const { test } = require('node:test');
const assert = require('node:assert/strict');

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
        if (prop === 'innerHTML' || prop === 'outerHTML' || prop === 'textContent') return '';
        if (prop === 'value') return target.value ?? '';
        if (prop === 'checked') return false;
        if (prop === Symbol.iterator) {
          return function* () {};
        }
        return noop;
      },
      set(target, prop, value) {
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
  ensurePlayersArray,
  canonicalizePlayers,
  formatTeamDisplay,
  buildTeamKey,
  parseLegacyTeamName,
  deriveTeamDisplay,
  getGameTeamDisplay,
  playersEqual,
  bucketScore,
  buildProbabilityIndex,
  calculateWinProbabilityComplex,
  calculateWinProbability,
} = require('../js/app.js');

const LOGISTIC_PARAMS = {
  intercept: 0.2084586876141831,
  coeffDiff: 0.00421107,
  coeffRound: -0.09520921,
  coeffMomentum: 0.00149416,
};

const computeLogisticPercentage = (diff, roundIndex, momentum) => {
  const { intercept, coeffDiff, coeffRound, coeffMomentum } = LOGISTIC_PARAMS;
  const z =
    intercept +
    coeffDiff * diff +
    coeffRound * roundIndex +
    coeffMomentum * momentum;
  const probUs = 1 / (1 + Math.exp(-z));
  return {
    us: +(probUs * 100).toFixed(1),
    dem: +((1 - probUs) * 100).toFixed(1),
  };
};

const resetState = () => {
  localStorage.clear();
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

test('buildTeamKey lowercases sorted player names', () => {
  assert.equal(buildTeamKey(['Alice', 'bob']), 'alice||bob');
  assert.equal(buildTeamKey(['', '']), '');
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
  assert.equal(bucketScore(19), 0);
  assert.equal(bucketScore(20), 20);
  assert.equal(bucketScore(-37), -20);
  assert.equal(bucketScore(999), 180);
});

test('bucketScore returns zero for ties and caps large negative swings', () => {
  assert.equal(bucketScore(0), 0);
  const smallNegative = bucketScore(-5);
  assert.ok(smallNegative === 0);
  assert.ok(Object.is(smallNegative, -0));
  assert.equal(bucketScore(-999), -180);
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

test('buildProbabilityIndex applies recency weighting and skips invalid games', () => {
  resetState();
  const fixedNow = new Date('2025-01-15T00:00:00Z').valueOf();
  const originalNow = Date.now;
  Date.now = () => fixedNow;
  try {
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
    assert.ok(Math.abs(table[key].us - 2.8) < 1e-9);
    assert.ok(Math.abs(table[key].dem - 1) < 1e-9);
    // Missing or empty runningTotals entries should not create additional buckets
    assert.equal(table['1|0'], undefined);
  } finally {
    Date.now = originalNow;
  }
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
    assert.ok(result.us > result.dem);
    assert.ok(result.us >= 50);
    assert.equal(Number(result.us.toFixed(1)) + Number(result.dem.toFixed(1)), 100);
  } finally {
    Date.now = originalNow;
  }
});

test('calculateWinProbabilityComplex returns even odds with no rounds', () => {
  const result = calculateWinProbabilityComplex({ rounds: [] }, []);
  assert.deepEqual(result, { us: 50, dem: 50 });
});

test('calculateWinProbabilityComplex falls back to logistic model without history', () => {
  const state = {
    rounds: [
      { runningTotals: { us: 40, dem: 20 } },
      { runningTotals: { us: 110, dem: 60 } },
    ],
  };
  const roundIndex = state.rounds.length - 1;
  const currentDiff = 110 - 60;
  const prevDiff = 40 - 20;
  const momentum = currentDiff - prevDiff;

  const expected = computeLogisticPercentage(currentDiff, roundIndex, momentum);
  const result = calculateWinProbabilityComplex(state, []);

  assert.equal(result.us, expected.us);
  assert.equal(result.dem, expected.dem);
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
