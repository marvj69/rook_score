const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { gzipSync, inflateSync } = require('node:zlib');

const root = path.join(__dirname, '..');
const modules = require('../scripts/app-module-files.cjs');
const voiceModules = ['js/modules/09-voice-tools.js', 'js/modules/09-voice-scoring.js'];
const probabilityModules = ['js/modules/10-probability-explanation.js'];
const read = file => readFileSync(path.join(root, file), 'utf8');

// Run the real classic scripts without CommonJS exports, in their browser order.
// Fake clocks let lifecycle tests prove elapsed time without sleeping.
function createRuntime(bundled, readyState = 'loading') {
  const noop = () => {};
  const listeners = { document: new Map(), window: new Map() };
  const elements = new Map();
  const storage = new Map();
  const frames = [];
  const intervals = new Map();
  let now = 100000;
  let nextTimer = 0;
  let measurements = 0;
  function element() {
    const classes = new Set();
    return {
      style: { setProperty: noop, removeProperty: noop }, dataset: {}, inert: false,
      textContent: '', innerHTML: '', scrollHeight: 900, offsetWidth: 280,
      classList: {
        add: name => classes.add(name), remove: name => classes.delete(name),
        contains: name => classes.has(name),
        toggle(name, enabled) {
          const shouldAdd = enabled ?? !classes.has(name);
          if (shouldAdd) classes.add(name); else classes.delete(name);
          return shouldAdd;
        },
      },
      insertAdjacentHTML(position, html) { this.innerHTML += html; }, closest: () => null,
      appendChild: noop, remove: noop, setAttribute: noop, removeAttribute: noop,
      addEventListener: noop, removeEventListener: noop, focus: noop, blur: noop,
      querySelector: () => null, querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 390, height: 100 }),
    };
  }
  const listen = target => (name, callback, options) => {
    const list = listeners[target].get(name) || [];
    list.push({ callback, options });
    listeners[target].set(name, list);
  };
  const document = {
    hidden: false, readyState, body: element(), head: element(),
    documentElement: element(), addEventListener: listen('document'),
    createElement: element, querySelector: () => null, querySelectorAll: () => [],
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
  };
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
    key: index => [...storage.keys()][index] ?? null,
    get length() { return storage.size; },
  };
  const context = vm.createContext({
    console, document, localStorage, URL,
    navigator: { userAgent: 'test', platform: 'test' },
    location: { hostname: 'localhost', origin: 'http://localhost' },
    innerHeight: 844, innerWidth: 390, addEventListener: listen('window'),
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    getComputedStyle: () => {
      measurements += 1;
      return { paddingTop: '0', getPropertyValue: () => '0' };
    },
    Date: class extends Date { static now() { return now; } },
    requestAnimationFrame: callback => frames.push(callback),
    setTimeout: () => ++nextTimer, clearTimeout: noop,
    setInterval: callback => { intervals.set(++nextTimer, callback); return nextTimer; },
    clearInterval: id => intervals.delete(id),
  });
  vm.runInContext('window = globalThis; self = globalThis;', context);
  const run = code => vm.runInContext(code, context);
  for (const file of bundled ? ['js/app.bundle.js'] : modules.filter(file => ![...voiceModules, ...probabilityModules].includes(file))) {
    run(read(file));
  }
  return {
    run, document, elements, frames, intervals, localStorage,
    get measurements() { return measurements; },
    advance(ms) { now += ms; },
    event(target, name) {
      for (const { callback } of listeners[target].get(name) || []) callback({});
    },
    listeners,
    loadVoice() { for (const file of bundled ? ['js/voice-score.bundle.js'] : voiceModules) run(read(file)); },
    loadProbability() { for (const file of bundled ? ['js/probability-explanation.bundle.js'] : probabilityModules) run(read(file)); },
  };
}

for (const bundled of [false, true]) {
  const label = bundled ? 'production bundles' : 'source modules';

  test(`${label}: viewport bursts use one frame and one safe-area measurement`, () => {
    const app = createRuntime(bundled);
    app.run('for (let i = 0; i < 30; i++) scheduleViewportCompatibilitySync();');
    assert.equal(app.frames.length, 1);
    app.frames.shift()();
    assert.equal(app.measurements, 1);
    assert.equal(app.elements.get('bodyRoot').classList.contains('app-content-overflows'), true);
    app.run('innerHeight = 1000; scheduleViewportCompatibilitySync();');
    app.frames.shift()();
    assert.equal(app.measurements, 2);
    assert.equal(app.elements.get('bodyRoot').classList.contains('app-content-overflows'), false);
  });

  test(`${label}: timer sleeps when idle or hidden and recovers elapsed time exactly`, () => {
    const app = createRuntime(bundled);
    app.run('initializeCurrentGameTimer(); initializeCurrentGameTimer();');
    assert.equal(app.intervals.size, 0);
    app.run('ensureCurrentGameTimerStarted(); syncCurrentGameTimerInterval();');
    assert.equal(app.intervals.size, 1);
    app.advance(5000);
    app.document.hidden = true;
    app.event('document', 'visibilitychange');
    assert.equal(app.intervals.size, 0);
    app.event('window', 'pagehide');
    const saved = JSON.parse(app.localStorage.getItem('activeGameState'));
    app.advance(60000);
    app.document.hidden = false;
    app.event('document', 'visibilitychange');
    assert.equal(app.intervals.size, 0, 'pagehide keeps ticks stopped until pageshow');
    app.event('window', 'pageshow');
    assert.equal(app.intervals.size, 1);
    assert.equal(app.run('getCurrentGameTime(state)'), 65000);
    app.run(`state = normalizeLoadedGameTimerState(${JSON.stringify(saved)});`);
    assert.equal(app.run('getCurrentGameTime(state)'), 65000, 'reload restores all hidden time');
    app.advance(15000);
    app.event('document', 'pointerdown');
    [...app.intervals.values()][0]();
    const touched = app.localStorage.getItem('activeGameState');
    assert.equal(app.run(`getCurrentGameTime(normalizeLoadedGameTimerState(${touched}))`), 80000, 'ticks persist the latest touch');
    app.run('state = settleCurrentGameTimer(state); updateState({ gameOver: true });');
    assert.equal(app.intervals.size, 0);
    app.advance(10000);
    assert.equal(app.run('getCurrentGameTime(state)'), 80000);
    app.run('resetGame();');
    assert.equal(app.intervals.size, 0);
    app.run('ensureCurrentGameTimerStarted();');
    assert.equal(app.intervals.size, 1);
  });

  test(`${label}: unchanged timer text does not rewrite the DOM`, () => {
    const app = createRuntime(bundled);
    const timer = app.document.getElementById('currentGameTimerValue');
    let writes = 0;
    let text = '00:00';
    Object.defineProperty(timer, 'textContent', {
      get: () => text, set: value => { text = value; writes++; },
    });
    app.run('updateCurrentGameTimerDisplay();');
    const initialWrites = writes;
    app.run('updateCurrentGameTimerDisplay(); updateCurrentGameTimerDisplay();');
    assert.equal(writes, initialWrites);
  });

  test(`${label}: current model skips empirical indexing and legacy models retain it`, () => {
    const app = createRuntime(bundled);
    app.run(`
      state = { ...DEFAULT_STATE, rounds: [
        { biddingTeam: 'us', bidAmount: 120, usPoints: 140, demPoints: 40,
          runningTotals: { us: 140, dem: 40 } }
      ] };
      globalThis.testGames = [{ id: 'test', rounds: state.rounds, finalScore: { us: 500, dem: 200 } }];
      globalThis.predicted = calculateWinProbabilityComplex(state, testGames);
    `);
    assert.equal(app.run('PROB_CACHE.size'), 0);
    app.loadProbability();
    app.run('state.showWinProbability = true; generateProbabilityBreakdown();');
    assert.equal(app.run('PROB_CACHE.size'), 0, 'the explanation also skips the unused table');
    assert.equal(app.run(`JSON.stringify(predicted) === JSON.stringify(
      toDisplayProbabilityPercents(getModelProbabilitySnapshotForState(state, getActiveRuntimeModel(), null, testGames).modelProbUs)
    )`), true);
    app.run(`calculateWinProbabilityComplex(state, testGames, {
      model: ${read('js/model_runtime_v1.json')}, personalization: null
    });`);
    assert.equal(app.run('PROB_CACHE.size'), 1);
  });

  test(`${label}: probability explanation loads once from the Pages base path`, async () => {
    const app = createRuntime(bundled);
    assert.equal(app.run('typeof generateProbabilityBreakdown'), 'undefined');
    app.document.baseURI = 'https://marvj69.github.io/rook_score/index.html';
    const scripts = [];
    app.document.createElement = () => ({
      events: {}, addEventListener(name, callback) { this.events[name] = callback; }, remove() {},
    });
    app.document.head.appendChild = script => scripts.push(script);
    const first = app.run('loadProbabilityExplanation()');
    const concurrent = app.run('loadProbabilityExplanation()');
    assert.equal(first, concurrent);
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].src, 'https://marvj69.github.io/rook_score/js/probability-explanation.bundle.js');
    app.loadProbability();
    scripts[0].events.load();
    await first;
    await app.run('loadProbabilityExplanation()');
    assert.equal(scripts.length, 1);
    assert.equal(app.run('typeof generateComplexProbabilityBreakdown'), 'function');
  });

  test(`${label}: probability explanation can retry a failed download`, async () => {
    const app = createRuntime(bundled);
    app.document.baseURI = 'http://localhost/';
    const scripts = [];
    app.document.createElement = () => ({
      events: {}, removed: false,
      addEventListener(name, callback) { this.events[name] = callback; },
      remove() { this.removed = true; },
    });
    app.document.head.appendChild = script => scripts.push(script);
    const first = app.run('loadProbabilityExplanation()');
    scripts[0].events.error();
    await assert.rejects(first, /could not load/);
    assert.equal(scripts[0].removed, true);
    const retry = app.run('loadProbabilityExplanation()');
    assert.equal(scripts.length, 2);
    app.loadProbability();
    scripts[1].events.load();
    await retry;
  });

  test(`${label}: classic global handlers and lazy voice integration survive packaging`, () => {
    const app = createRuntime(bundled);
    assert.equal(app.run('getVoiceScoreRuntime()'), null);
    for (const name of ['handleTeamClick', 'handleFormSubmit', 'handleUndo', 'handleRedo',
      'startHistoryEdit', 'openSettingsModal', 'openSavedGamesModal', 'openStatisticsModal']) {
      assert.equal(app.run(`typeof ${name}`), 'function', name);
    }
    for (const name of ['touchstart', 'touchmove', 'touchend']) {
      const listener = app.listeners.document.get(name).find(entry => entry.callback.name.startsWith('onTouch'));
      assert.equal(listener?.options?.passive, true, `${name} menu tracking is passive`);
    }
    app.loadVoice();
    assert.equal(app.run('typeof getVoiceScoreRuntime().refreshVoiceScoreControls'), 'function');
    assert.equal(app.run('normalizeVoiceScorePlan({ status: "answer", message: "Us leads.", actions: [{ type: "undo" }] }).actions.length'), 0);
    assert.equal(app.run('Object.keys(VOICE_TOOLS.actions).length > 0 && window.ROOK_VOICE_TOOLS === VOICE_TOOLS'), true);
    assert.equal(app.run('validateBid(125)'), '');
    assert.equal(app.run('validateBid(123)').length > 0, true);
  });
}

for (const bundled of [false, true]) {
  const label = bundled ? 'production bundles' : 'source modules';

  test(`${label}: the game library renders large collections a page at a time`, () => {
    const app = createRuntime(bundled);
    const games = Array.from({ length: 100 }, (_, i) => ({
      usTeamName: i === 90 ? 'Zelda & Link' : 'Alice & Bob', demTeamName: 'Cara & Dan',
      winner: 'us', timestamp: new Date(100000 - i * 36e5).toISOString(),
      finalScore: { us: 500 + i, dem: 200 }, rounds: [],
    }));
    app.localStorage.setItem('savedGames', JSON.stringify(games));
    const list = app.elements.get('savedGamesList') || app.document.getElementById('savedGamesList');
    const scroller = app.document.getElementById('savedGamesScroll');
    const cards = () => (list.innerHTML.match(/<article /g) || []).length;

    app.run("switchGamesTab('completed')");
    assert.equal(cards(), 30);
    assert.equal((list.innerHTML.match(/library-enter/g) || []).length > 0, true);
    assert.equal((list.innerHTML.match(/game-card[^"]*library-enter/g) || []).length, 8);

    Object.assign(scroller, { scrollHeight: 5000, clientHeight: 800, scrollTop: 0 });
    assert.equal(app.run('loadMoreLibraryGames()'), false);
    scroller.scrollTop = 3500;
    assert.equal(app.run('loadMoreLibraryGames()'), true);
    assert.equal(cards(), 60);
    assert.equal(scroller.scrollTop, 3500);

    // A delete re-render keeps everything already loaded and the scroll position.
    app.run('renderGamesWithFilter({ keepPosition: true })');
    assert.equal(cards(), 60);
    assert.equal(scroller.scrollTop, 3500);

    // Search covers games that were never rendered, and resets to the top.
    app.document.getElementById('gameSearchInput').value = 'zelda';
    app.run('renderGamesWithFilter()');
    assert.equal(cards(), 1);
    assert.match(list.innerHTML, /viewSavedGame\(90\)/);
    assert.equal(scroller.scrollTop, 0);

    // Oldest-first sort reaches the end of the list with no duplicate cards.
    app.document.getElementById('gameSearchInput').value = '';
    app.document.getElementById('gameSortSelect').value = 'oldest';
    app.run('renderGamesWithFilter()');
    assert.match(list.innerHTML, /viewSavedGame\(99\)/);
    for (let i = 0; i < 5; i++) { scroller.scrollTop = 1e6; app.run('loadMoreLibraryGames()'); }
    assert.equal(cards(), 100);
    assert.equal(new Set(list.innerHTML.match(/viewSavedGame\(\d+\)/g)).size, 100);
  });

  test(`${label}: saving games refreshes cached library search text`, () => {
    const app = createRuntime(bundled);
    app.run("setLocalStorage('savedGames', [{ usTeamName: 'Old Name', demTeamName: 'Them', timestamp: '2026-01-01T00:00:00Z', finalScore: { us: 500, dem: 100 } }], { sync: false })");
    assert.equal(app.run("getLibrarySearchText(getLocalStorage('savedGames')[0]).includes('old name')"), true);
    app.run("{ const games = getLocalStorage('savedGames'); games[0].usTeamName = 'New Name'; setLocalStorage('savedGames', games, { sync: false }); }");
    assert.equal(app.run("getLibrarySearchText(getLocalStorage('savedGames')[0]).includes('new name')"), true);
  });

  test(`${label}: Home launch is stable and initialization only runs once`, () => {
    const app = createRuntime(bundled);
    app.localStorage.setItem('localOnly:onboardingCompleted', 'true');
    app.document.documentElement.classList.add('home-boot');
    app.run('initializeRookApp()');
    const home = app.elements.get('homeScreen');
    assert.equal(home.inert, false);
    assert.equal(home.classList.contains('home-animate'), false);
    assert.equal(app.document.body.classList.contains('home-open'), true);
    assert.equal(app.document.documentElement.classList.contains('home-boot'), false);
    const keydownListeners = app.listeners.document.get('keydown').length;
    app.event('document', 'DOMContentLoaded');
    assert.equal(app.listeners.document.get('keydown').length, keydownListeners);
    app.run('closeHomeScreen(); openHomeScreen()');
    assert.equal(home.classList.contains('home-animate'), true, 'later Home navigation still animates');
  });

  test(`${label}: a parsed document starts local play before DOMContentLoaded`, () => {
    const app = createRuntime(bundled, 'interactive');
    assert.equal(app.run('rookAppInitialized'), true);
    const listeners = app.listeners.document.get('keydown').length;
    app.event('document', 'DOMContentLoaded');
    assert.equal(app.listeners.document.get('keydown').length, listeners);
  });

  test(`${label}: Home controls wait for full styling even when the core is ready`, () => {
    const app = createRuntime(bundled);
    const styles = app.document.getElementById('appStyles');
    styles.tagName = 'LINK';
    app.localStorage.setItem('localOnly:onboardingCompleted', 'true');
    app.run('initializeRookApp()');
    assert.equal(app.run('rookAppInitialized'), false);
    styles.dataset.loaded = 'true';
    app.run('initializeRookApp()');
    assert.equal(app.run('rookAppInitialized'), true);
    assert.equal(app.elements.get('homeScreen').inert, false);
  });

  test(`${label}: restoring an active game hides the page only until styles and initialization are ready`, () => {
    const app = createRuntime(bundled);
    const styles = app.document.getElementById('appStyles');
    styles.tagName = 'LINK';
    app.localStorage.setItem('localOnly:onboardingCompleted', 'true');
    app.localStorage.setItem('activeGameState', JSON.stringify({ biddingTeam: 'us', bidAmount: '125' }));
    app.document.documentElement.classList.add('app-boot');
    app.run('initializeRookApp()');
    assert.equal(app.run('rookAppInitialized'), false);
    assert.equal(app.document.documentElement.classList.contains('app-boot'), true);
    styles.dataset.loaded = 'true';
    app.run('initializeRookApp()');
    assert.equal(app.run('rookAppInitialized'), true);
    assert.equal(app.document.documentElement.classList.contains('app-boot'), false);
    assert.equal(app.run('isHomeScreenOpen()'), false);
    assert.equal(app.run('state.biddingTeam'), 'us');
  });

  test(`${label}: early authentication waits for the shared client and returns its result`, async () => {
    const app = createRuntime(bundled);
    app.run(`
      authCalls = [];
      firebaseClientLoadPromise = new Promise(resolve => { resolveFirebaseClient = resolve; });
      earlySignIn = window.signInWithGoogle('home');
      earlySignOut = window.signOutUser('menu');
    `);
    assert.equal(app.run('authCalls.length'), 0);
    app.run(`
      window.signInWithGoogle = async source => { authCalls.push(source); return { uid: 'test-user' }; };
      window.signOutUser = async source => { authCalls.push(source); return 'signed-out'; };
      window.startFirebaseInitialization = () => {};
      resolveFirebaseClient();
    `);
    const [user, signedOut] = await app.run('Promise.all([earlySignIn, earlySignOut])');
    assert.equal(user.uid, 'test-user');
    assert.equal(signedOut, 'signed-out');
    assert.equal(app.run('authCalls.join(",")'), 'home,menu');
  });
}

test('early Home destination handles empty and invalid saves without hiding active games', () => {
  const bootScript = read('index.html').match(/<script>([\s\S]*?)<\/script>/)[1];
  const fixtures = [
    [null, true], ['null', true], ['{}', true], ['[]', true], ['"bad"', true], ['{broken', true],
    [{ rounds: [], dealers: [], usPlayers: [], demPlayers: [] }, true],
    [{ rounds: [null, false, 5, []] }, true],
    [{ usPlayers: [' ', 15, 'ignored third player'] }, true],
    [{ startingTotals: { us: 'bad', dem: '0' } }, true],
    [{ rounds: [{}] }, false], [{ biddingTeam: 'us' }, false], [{ gameOver: true }, false],
    [{ dealers: ['Alice'] }, false], [{ usPlayers: [' Alice '] }, false],
    [{ startingTotals: { us: '-120', dem: 0 } }, false],
  ];
  for (const [state, expectedHome] of fixtures) {
    const classes = new Set();
    vm.runInNewContext(bootScript, {
      localStorage: { getItem: () => typeof state === 'object' && state !== null ? JSON.stringify(state) : state },
      document: { documentElement: { classList: { add: name => classes.add(name) } } },
    });
    assert.equal(classes.has('home-boot'), expectedHome, JSON.stringify(state));
    assert.equal(classes.has('app-boot'), !expectedHome, JSON.stringify(state));
  }
  const classes = new Set();
  vm.runInNewContext(bootScript, {
    localStorage: { getItem: () => { throw new Error('Storage blocked'); } },
    document: { documentElement: { classList: { add: name => classes.add(name) } } },
  });
  assert.equal(classes.has('home-boot'), true);
});

test('analytics replays early local-play events through its existing privacy filters', () => {
  const app = createRuntime(true);
  app.run(`emitRookEvent('round_recorded', { round_count: 2, player_name: 'private' }); emitRookEvent('unsupported_event');`);
  assert.equal(app.run('rookPendingAnalyticsEvents.length'), 2);
  app.run(`location.hostname = 'marvj69.github.io'; ${read('js/analytics.js')}`);
  assert.equal(app.run('typeof rookPendingAnalyticsEvents'), 'undefined');
  assert.equal(app.run(`dataLayer.filter(entry => entry[0] === 'event').length`), 1);
  assert.equal(app.run(`dataLayer.find(entry => entry[0] === 'event')[2].round_count`), 2);
  assert.equal(app.run(`'player_name' in dataLayer.find(entry => entry[0] === 'event')[2]`), false);
});

test('production JavaScript stays within the download budgets', () => {
  for (const [file, bytes, gzipBytes] of [
    ['js/app.bundle.js', 276000, 72000], // Home/onboarding plus early initialization and authentication readiness
    ['js/voice-score.bundle.js', 60000, 17000],
    ['js/probability-explanation.bundle.js', 26000, 8800],
    ['css/probability-explanation.css', 12000, 2800],
  ]) {
    const source = read(file);
    assert.ok(Buffer.byteLength(source) < bytes, `${file} raw size`);
    assert.ok(gzipSync(source).length < gzipBytes, `${file} gzip size`);
  }
});

test('Home styling stays small and every generated asset is checked before deployment', () => {
  const css = read('css/app.min.css');
  const html = read('index.html');
  const inlineStyles = html.match(/<style id="rook-startup-styles">([\s\S]*?)<\/style>/)[1];
  assert.ok(Buffer.byteLength(css) < 127000);
  assert.ok(gzipSync(css).length < 23000);
  // The utility reset/rules now travel with Home, eliminating a blocking fetch.
  assert.ok(Buffer.byteLength(inlineStyles) < 45000);
  assert.ok(gzipSync(inlineStyles).length < 10000);
  assert.equal(inlineStyles.startsWith(read('css/tailwind.css')), true);
  assert.match(inlineStyles, /home-boot/);
  assert.match(inlineStyles, /\.home-tile/);
  assert.match(read('.github/workflows/pages.yml'), /git diff --exit-code -- index\.html[^\n]*css\/app\.min\.css/);
});

test('Home can parse and paint without any external render-blocking CSS', () => {
  const head = read('index.html').split('</head>')[0].replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
  const stylesheets = [...head.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)];
  assert.equal(stylesheets.length, 1);
  assert.match(stylesheets[0][0], /id="appStyles"/);
  assert.match(stylesheets[0][0], /media="print"/);
  const synchronousScripts = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');
  assert.doesNotMatch(synchronousScripts, /\.media\s*=\s*["']all["']/);
  assert.match(head, /name="color-scheme" content="dark"/);
});

test('iPhone launch images are real, correctly sized dark PNGs and ship under relative URLs', () => {
  const html = read('index.html');
  const screens = require('../scripts/ios-launch-screens.cjs');
  const deployed = require('../scripts/static-site-files.cjs');
  for (const [width, height, scale] of screens) {
    for (const [orientation, w, h] of [['portrait', width * scale, height * scale], ['landscape', height * scale, width * scale]]) {
      const file = `icons/startup-${w}x${h}.png`;
      const image = readFileSync(path.join(root, file));
      assert.equal(image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), true);
      assert.equal(image.readUInt32BE(16), w);
      assert.equal(image.readUInt32BE(20), h);
      assert.equal(deployed.includes(file), true);
      assert.ok(html.includes(`href="${file}" media="(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${scale}) and (orientation: ${orientation})"`));
    }
  }
  const expectedColor = Buffer.from(JSON.parse(read('manifest.json')).background_color.slice(1), 'hex');
  for (const [w, h] of [[1206, 2622], [2622, 1206]]) {
    const image = readFileSync(path.join(root, `icons/startup-${w}x${h}.png`));
    const idatSize = image.readUInt32BE(33);
    const pixels = inflateSync(image.subarray(41, 41 + idatSize));
    const row = Buffer.alloc(1 + w * 3);
    row.fill(expectedColor, 1);
    assert.equal(pixels.length, row.length * h);
    for (let y = 0; y < h; y++) assert.equal(pixels.subarray(y * row.length, (y + 1) * row.length).equals(row), true);
  }
  assert.match(read('.github/workflows/pages.yml'), /icons\/startup-\*\.png/);
});

test('stylesheet minification preserves every authored rule, value and browser fallback', () => {
  const postcss = require('postcss');
  const semanticTree = node => {
    if (node.type === 'comment') return null;
    const result = { type: node.type };
    for (const field of ['selector', 'name', 'params', 'prop', 'value', 'important']) {
      if (node[field] !== undefined) result[field] = node[field];
    }
    if (node.nodes) result.nodes = node.nodes.map(semanticTree).filter(Boolean);
    return result;
  };
  assert.deepEqual(semanticTree(postcss.parse(read('css/app.min.css'))), semanticTree(postcss.parse(read('css/app.css'))));
});

test('Pages ships every local precache asset and the runtime model requested by the app', () => {
  const workflow = read('.github/workflows/pages.yml');
  assert.match(workflow, /node scripts\/stage-static-site\.mjs _pages/);
  const copiedFiles = require('../scripts/static-site-files.cjs');
  const precacheBlock = read('service-worker.js').match(/const urlsToCache = \[([\s\S]*?)\];/)[1];
  const precacheFiles = [...precacheBlock.matchAll(/"\.\/([^"]+)"/g)].map(match => match[1]);
  const modelFile = read('js/modules/02-win-prob-engine.js').match(/RUNTIME_MODEL_PATH = "\.\/([^"]+)"/)[1];
  for (const file of [...precacheFiles, modelFile, 'js/voice-score.bundle.js', 'js/probability-explanation.bundle.js', 'css/probability-explanation.css']) {
    assert.equal(existsSync(path.join(root, file)), true, `${file} exists`);
    assert.equal(copiedFiles.includes(file), true, `${file} is deployed`);
  }
});
