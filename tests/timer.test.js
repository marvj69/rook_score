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
  return { rounds: [{}], timerStarted: true, gameOver: false, accumulatedTime: 3 * MIN, timerVersion: 3,
    timerLastActivityAt: T, startTime: T, timerLastSavedAt: T, ...overrides };
}
function hide(h, when) { h.at(when); h.c.document.hidden = true; h.events.visibilitychange(); h.events.pagehide(); }
function show(h, when) { h.at(when); h.c.document.hidden = false; h.events.pageshow(); h.events.visibilitychange(); }

test('a hand played with the phone locked counts in full, with no freeze or jump', () => {
  const h = harness();
  h.c.state = game();
  h.c.initializeCurrentGameTimer();
  hide(h, T + MIN);
  show(h, T + 26 * MIN);
  assert.equal(h.c.getCurrentGameTime(h.c.state), 29 * MIN);
  assert.equal(h.c.state.timerSkippedMs, 0);
  h.at(T + 27 * MIN);
  assert.equal(h.c.getCurrentGameTime(h.c.state), 30 * MIN);
});

test('a long break while away is left out and the clock resumes where players left', () => {
  const h = harness();
  h.c.state = game();
  h.c.initializeCurrentGameTimer();
  hide(h, T + 5 * MIN);
  h.at(T + 3 * 60 * MIN);
  // Nobody sees this, but even the raw value never includes the break.
  assert.equal(h.c.getCurrentGameTime(h.c.state), 8 * MIN);
  show(h, T + 3 * 60 * MIN);
  assert.equal(h.c.state.accumulatedTime, 8 * MIN);
  assert.equal(h.c.state.timerSkippedMs, 175 * MIN);
  h.at(T + 3 * 60 * MIN + 2 * MIN);
  assert.equal(h.c.getCurrentGameTime(h.c.state), 10 * MIN);
});

test('the break boundary is exact', () => {
  const { c } = harness();
  assert.equal(c.isCurrentGameTimerOnBreak(game(), T + 30 * MIN), false);
  assert.equal(c.getCurrentGameTime(game(), T + 30 * MIN), 33 * MIN);
  assert.equal(c.isCurrentGameTimerOnBreak(game(), T + 30 * MIN + 1), true);
  assert.equal(c.getCurrentGameTime(game(), T + 30 * MIN + 1), 3 * MIN);
  assert.equal(c.getCurrentGameSkippedTime(game(), T + 30 * MIN + 1), 30 * MIN + 1);
});

test('closing and reopening the app uses the persisted last sighting', () => {
  const h = harness();
  h.c.state = game();
  h.c.initializeCurrentGameTimer();
  h.at(T + 4 * MIN);
  h.events.pointerdown();
  h.c.checkpointCurrentGameTimer();
  // App killed without lifecycle events; reopened 20 minutes later.
  const reopened = harness();
  reopened.at(T + 24 * MIN);
  reopened.c.state = reopened.c.normalizeLoadedGameTimerState(h.stored.activeGameState, T + 24 * MIN);
  reopened.c.initializeCurrentGameTimer();
  assert.equal(reopened.c.getCurrentGameTime(reopened.c.state), 27 * MIN);
  assert.equal(reopened.c.getCurrentGameSkippedTime(reopened.c.state), 0);
  // The same close, reopened 40 minutes later, is a break from the last touch.
  const late = harness();
  late.at(T + 44 * MIN);
  late.c.state = late.c.normalizeLoadedGameTimerState(h.stored.activeGameState, T + 44 * MIN);
  late.c.initializeCurrentGameTimer();
  assert.equal(late.c.getCurrentGameTime(late.c.state), 7 * MIN);
  assert.equal(late.c.state.timerSkippedMs, 40 * MIN);
});

test('saves, reloads and background syncs never change the time', () => {
  const h = harness();
  h.c.state = game();
  for (let i = 1; i <= 200; i++) {
    h.at(T + i * 15_000);
    h.c.saveCurrentGameState({ sync: false, showIndicator: false });
    h.c.state = h.c.normalizeLoadedGameTimerState(h.stored.activeGameState, T + i * 15_000);
  }
  // 50 minutes of saves with nobody touching the app: the last 20 are a break.
  assert.equal(h.c.getCurrentGameTime(h.c.state, T + 50 * MIN), 3 * MIN);
  assert.equal(h.c.getCurrentGameTime(h.c.state, T + 29 * MIN), 32 * MIN);
  assert.equal(h.c.state.accumulatedTime, 3 * MIN);
  assert.equal(h.c.state.startTime, T);
});

test('touches keep a visible game counting; an untouched visible game pauses and resumes on touch', () => {
  const h = harness();
  h.c.state = game();
  h.c.initializeCurrentGameTimer();
  for (let m = 10; m <= 120; m += 10) { h.at(T + m * MIN); h.events.pointerdown(); }
  assert.equal(h.c.getCurrentGameTime(h.c.state), 123 * MIN);
  h.at(T + 5 * 60 * MIN);
  assert.equal(h.c.getCurrentGameTime(h.c.state), 123 * MIN);
  h.events.keydown();
  assert.equal(h.c.state.accumulatedTime, 123 * MIN);
  h.at(T + 5 * 60 * MIN + MIN);
  assert.equal(h.c.getCurrentGameTime(h.c.state), 124 * MIN);
});

test('scoring after an overnight gap resumes without counting the gap', () => {
  const { c, at } = harness();
  c.state = game();
  at(T + 12 * 60 * MIN);
  c.recordCurrentGameTimerActivity();
  assert.equal(c.state.accumulatedTime, 3 * MIN);
  at(T + 12 * 60 * MIN + 7 * MIN);
  c.recordCurrentGameTimerActivity();
  assert.equal(c.state.accumulatedTime, 10 * MIN);
});

test('long games are never capped', () => {
  const { c } = harness();
  let current = game();
  for (let i = 1; i <= 500; i++) current = c.buildCurrentGameTimerActivity(current, T + i * 10 * MIN);
  assert.equal(current.accumulatedTime, 5003 * MIN);
  assert.equal(current.timerSkippedMs, 0);
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
  const started = c.buildCurrentGameTimerActivity({ rounds: [], accumulatedTime: 0 }, T);
  assert.equal(started.startTime, T);
  assert.equal(c.getCurrentGameTime(started, T + MIN), MIN);
});

test('snapshots from older builds keep their counted time and resume from their last save', () => {
  const { c } = harness();
  const legacy = c.normalizeLoadedGameTimerState({
    rounds: [{}], startTime: T, timerLastSavedAt: T + 60 * MIN, timerLastActivityAt: T + 50 * MIN, accumulatedTime: 60 * MIN,
  }, T + 70 * MIN);
  assert.equal(legacy.startTime, T + 60 * MIN);
  assert.equal(c.getCurrentGameTime(legacy, T + 70 * MIN), 70 * MIN);
  const stale = c.normalizeLoadedGameTimerState({ rounds: [{}], timerLastSavedAt: T, startTime: null, accumulatedTime: 100 * MIN }, T + 72 * 60 * MIN);
  assert.equal(c.settleCurrentGameTimer(stale, T + 72 * 60 * MIN).accumulatedTime, 100 * MIN);
  const paused = c.normalizeLoadedGameTimerState(game({ timerPaused: true, startTime: null, accumulatedTime: 5 * MIN }), T + 24 * 60 * MIN);
  assert.equal(paused.timerPaused, false);
  assert.equal(c.getCurrentGameTime(paused, T + 24 * 60 * MIN + MIN), 6 * MIN);
});

test('malformed values and clock changes cannot inflate the time', () => {
  const { c } = harness();
  const malformed = c.normalizeLoadedGameTimerState({ rounds: [{}], startTime: 'oops', accumulatedTime: -1, timerSkippedMs: Infinity, timerVersion: 3 }, T);
  assert.equal(malformed.accumulatedTime, 0);
  assert.equal(malformed.timerSkippedMs, 0);
  const back = c.buildCurrentGameTimerCheckpoint(game({ timerLastActivityAt: T + 2 * MIN }), T - 10 * MIN);
  assert.equal(back.accumulatedTime, 5 * MIN);
  assert.equal(c.getCurrentGameTime(back, T - 9 * MIN), 6 * MIN);
  const forward = c.settleCurrentGameTimer(game(), T + 365 * 24 * 60 * MIN);
  assert.equal(forward.accumulatedTime, 3 * MIN);
});
