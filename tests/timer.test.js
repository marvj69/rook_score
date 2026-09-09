const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const T = 1_800_000_000_000;
const MIN = 60_000;
const source = readFileSync(path.join(__dirname, '../js/modules/05-game-state-management.js'), 'utf8');
function harness() {
  let now = T;
  const events = {};
  const stored = {};
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    state: {},
    document: { hidden: false, getElementById: () => null, addEventListener: (key, fn) => { events[key] = fn; } },
    window: { addEventListener: (key, fn) => { events[key] = fn; } },
    setInterval: () => 1, clearInterval() {}, scheduleRender() {},
    ACTIVE_GAME_KEY: 'activeGameState', LOCAL_STORAGE_CACHE: new Map(),
    localStorage: { removeItem: key => { delete stored[key]; } },
    setLocalStorage: (key, value) => { stored[key] = JSON.parse(JSON.stringify(value)); },
    sanitizeTotals: x => x, showSaveIndicator() {},
  });
  vm.runInContext(source, context);
  return { c: context, events, stored, at: value => { now = value; } };
}
function game(overrides = {}) {
  return { rounds: [{}], timerStarted: true, gameOver: false, accumulatedTime: 3 * MIN,
    timerLastActivityAt: T, startTime: T, timerLastSavedAt: T, ...overrides };
}

test('foreground checkpoints, background recovery and exports share an absolute idle deadline', () => {
  const { c } = harness();
  let current = game();
  for (let seconds = 15; seconds <= 24 * 60 * 60; seconds += 15) {
    current = c.buildCurrentGameTimerCheckpoint(current, T + seconds * 1000);
  }
  assert.equal(current.accumulatedTime, 23 * MIN);
  assert.equal(current.timerSkippedMs, (24 * 60 - 20) * MIN);
  assert.equal(current.timerLastActivityAt, T);
  const recovered = c.normalizeLoadedGameTimerState(game(), T + 24 * 60 * MIN);
  assert.equal(recovered.accumulatedTime, current.accumulatedTime);
  assert.equal(recovered.timerSkippedMs, current.timerSkippedMs);
  assert.equal(c.getCurrentGameTime(current, T + 48 * 60 * MIN), 23 * MIN);
});

test('no idle time is skipped before the exact boundary; play can continue for days', () => {
  const { c } = harness();
  assert.equal(c.isCurrentGameTimerIdle(game(), T + 20 * MIN - 1), false);
  assert.equal(c.isCurrentGameTimerIdle(game(), T + 20 * MIN), true);
  assert.equal(c.getCurrentGameSkippedTime(game(), T + 20 * MIN), 0);
  assert.equal(c.getCurrentGameSkippedTime(game(), T + 20 * MIN + 1), 1);
  let current = game();
  for (let i = 1; i <= 500; i++) current = c.buildCurrentGameTimerActivity(current, T + i * 10 * MIN);
  assert.equal(current.accumulatedTime, 5003 * MIN);
  assert.equal(current.timerSkippedMs, 0);
});

test('scoring after an overnight gap resumes without counting the gap', () => {
  const { c, at } = harness();
  c.state = game();
  at(T + 12 * 60 * MIN);
  c.recordCurrentGameTimerActivity();
  assert.equal(c.state.accumulatedTime, 23 * MIN);
  at(T + 12 * 60 * MIN + MIN);
  assert.equal(c.getCurrentGameTime(c.state), 24 * MIN);
  at(T + 24 * 60 * MIN);
  c.recordCurrentGameTimerActivity();
  assert.equal(c.state.accumulatedTime, 43 * MIN);
});

test('retired manual-pause snapshots migrate without counting the break or getting stuck', () => {
  const { c } = harness();
  const resumed = c.normalizeLoadedGameTimerState(game({
    timerPaused: true, startTime: null, accumulatedTime: 5 * MIN,
  }), T + 24 * 60 * MIN);
  assert.equal(resumed.accumulatedTime, 5 * MIN);
  assert.equal(resumed.timerPaused, false);
  assert.equal(c.getCurrentGameTime(resumed, T + 24 * 60 * MIN + MIN), 6 * MIN);
});

test('page lifecycle never grants activity, and repeated reloads never double count', () => {
  const { c, at, events, stored } = harness();
  c.state = game();
  c.initializeCurrentGameTimer();
  at(T + 5 * MIN);
  c.document.hidden = true;
  events.visibilitychange();
  events.pagehide();
  at(T + 180 * MIN);
  c.document.hidden = false;
  events.pageshow();
  events.visibilitychange();
  assert.equal(c.state.accumulatedTime, 23 * MIN);
  assert.equal(c.state.timerSkippedMs, 160 * MIN);
  for (let i = 0; i < 5; i++) c.state = c.normalizeLoadedGameTimerState(stored.activeGameState, T + 180 * MIN);
  assert.equal(c.state.accumulatedTime, 23 * MIN);
  assert.equal(c.state.timerSkippedMs, 160 * MIN);
});

test('unstarted and completed games never restart', () => {
  const { c } = harness();
  const fresh = c.normalizeLoadedGameTimerState({ rounds: [], accumulatedTime: 0 }, T);
  assert.equal(fresh.timerStarted, false);
  assert.equal(fresh.startTime, null);
  const completed = c.normalizeLoadedGameTimerState(game({ gameOver: true, startTime: null }), T + 24 * 60 * MIN);
  assert.equal(completed.accumulatedTime, 3 * MIN);
  assert.equal(completed.startTime, null);
  assert.equal(c.getCurrentGameTime(completed, T + 48 * 60 * MIN), 3 * MIN);
});

test('migration, malformed values and clock changes cannot inflate a segment without bound', () => {
  const { c } = harness();
  const legacy = c.normalizeLoadedGameTimerState({ rounds: [{}], startTime: T, accumulatedTime: 100 * MIN }, T + 72 * 60 * MIN);
  assert.equal(legacy.accumulatedTime, 120 * MIN);
  const hiddenLegacy = c.normalizeLoadedGameTimerState({ rounds: [{}], timerLastSavedAt: T, startTime: null, accumulatedTime: 100 * MIN }, T + 72 * 60 * MIN);
  assert.equal(hiddenLegacy.accumulatedTime, 120 * MIN);
  const malformed = c.normalizeLoadedGameTimerState({ rounds: [{}], startTime: 'oops', accumulatedTime: -1, timerSkippedMs: Infinity }, T);
  assert.equal(malformed.accumulatedTime, 0);
  assert.equal(malformed.timerSkippedMs, 0);
  const back = c.buildCurrentGameTimerCheckpoint(game(), T - 10 * MIN);
  assert.equal(back.accumulatedTime, 3 * MIN);
  assert.equal(c.getCurrentGameTime(back, T - 9 * MIN), 4 * MIN);
  const forward = c.buildCurrentGameTimerCheckpoint(game(), T + 365 * 24 * 60 * MIN);
  assert.equal(forward.accumulatedTime, 23 * MIN);
});


test('legacy snapshots with a stale segment start recover only after their latest checkpoint', () => {
  const { c } = harness();
  const legacy = c.normalizeLoadedGameTimerState({
    rounds: [{}], startTime: T, timerLastSavedAt: T + 60 * MIN, accumulatedTime: 60 * MIN,
  }, T + 24 * 60 * MIN);
  assert.equal(legacy.accumulatedTime, 80 * MIN);
  assert.equal(legacy.timerSkippedMs, (24 * 60 - 80) * MIN);
});
