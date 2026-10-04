const { test } = require('node:test');
const assert = require('node:assert/strict');

const { setupDomStubs, installLiveDocument } = require('./helpers/dom-stubs.cjs');
const { DAY, NOW, round, makeGame, quickWin, sampleLibrary } = require('./helpers/stats-fixtures.cjs');

setupDomStubs();

const {
  setLocalStorage,
  buildStatsModel,
  clearStatisticsCache,
  statsNiceScale,
  statsNiceRange,
  statsColumnPath,
  statsBarsChart,
  statsDivergingChart,
  statsLineChart,
  statsHeatmap,
  statsScatterChart,
  statsStackedBar,
  statsTrajectory,
  statsFormStrip,
  statsRenderOverview,
  statsRenderLeaders,
  statsLeaderRowsHtml,
  statsRenderBidding,
  statsRenderRecords,
  statsRenderProfile,
  statsApplyControls,
  renderStatisticsApp,
  statsRender,
  statsRedraw,
  statsHandleClick,
  statsFocusSelector,
  statsRestoreFocus,
  getStatisticsRoster,
  applyVoiceScoreStatsControls,
  getStatsUiForTests,
  escapeHtmlValue,
} = require('../js/app.js');

const model = (games, options = {}) => buildStatsModel(games, { now: NOW, ...options });
const BAD_TEXT = /NaN|undefined|Infinity|\[object/;

function allScreens(m) {
  const first = m.players.list[0];
  const team = m.teams.list[0];
  return {
    overview: statsRenderOverview(m),
    players: statsRenderLeaders(m, 'player'),
    teams: statsRenderLeaders(m, 'team'),
    bidding: statsRenderBidding(m),
    records: statsRenderRecords(m),
    player: first ? statsRenderProfile(m, first) : '',
    team: team ? statsRenderProfile(m, team) : '',
  };
}

test('axis scales round to clean steps', () => {
  assert.deepEqual(statsNiceScale(97, 3).ticks, [0, 50, 100]);
  assert.deepEqual(statsNiceScale(14, 3).ticks, [0, 5, 10, 15]);
  assert.deepEqual(statsNiceScale(0).ticks, [0, 0.5, 1]);
  const range = statsNiceRange(962, 1047, 3);
  assert.ok(range.min <= 962 && range.max >= 1047);
  assert.ok(range.ticks.every(tick => tick % range.step === 0));
  const flat = statsNiceRange(1000, 1000, 3);
  assert.ok(flat.max > flat.min, 'a flat series still gets a drawable axis');
});

test('column paths round the data end only and survive zero height', () => {
  const up = statsColumnPath(10, 20, 20, 100, 4);
  assert.match(up, /^M10 100V24Q10 20 14 20H26Q30 20 30 24V100Z$/);
  const down = statsColumnPath(10, 20, 180, 100, 4);
  assert.match(down, /^M10 100V176Q10 180 14 180H26Q30 180 30 176V100Z$/);
  assert.match(statsColumnPath(10, 20, 100, 100), /^M10 100h20v0\.8h-20Z$/);
  assert.doesNotMatch(statsColumnPath(10, 20, 99.8, 100), /NaN/);
});

test('every screen renders for empty, tiny, and full libraries without bad values', () => {
  for (const games of [[], [quickWin('us', NOW - DAY)], sampleLibrary(3), sampleLibrary(36), sampleLibrary(120, ['Ann', 'Bob', 'Cy', 'Di', 'Eve', 'Flo'])]) {
    for (const period of ['all', 'year', 'd90', 'd30']) {
      const m = model(games, { period });
      const screens = allScreens(m);
      for (const [name, html] of Object.entries(screens)) {
        assert.doesNotMatch(html, BAD_TEXT, `${name} (${games.length} games, ${period}) shows a broken value`);
      }
    }
  }
});

test('names can never inject markup', () => {
  const hostile = ['<img src=x onerror=alert(1)>', '"quoted" & \'single\'', 'Cy', 'Di'];
  const games = Array.from({ length: 6 }, (unused, i) => quickWin(i % 2 ? 'us' : 'dem', NOW - (7 - i) * DAY, { us: [hostile[0], hostile[1]], dem: [hostile[2], hostile[3]] }));
  const m = model(games);
  for (const [name, html] of Object.entries(allScreens(m))) {
    assert.doesNotMatch(html, /<img/i, `${name} leaks a raw tag`);
    assert.doesNotMatch(html, /"quoted"/, `${name} leaks a raw quote that could close an attribute`);
    assert.doesNotMatch(html, /'single'/, `${name} leaks a raw apostrophe`);
  }
  const profile = statsRenderProfile(m, m.players.byKey.get('<img src=x onerror=alert(1)>'.toLowerCase()));
  assert.match(profile, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(profile, /&quot;quoted&quot; &amp; &#39;single&#39;/);
});

test('charts pair every mark with a tooltip line and every figure with a table for screen readers', () => {
  const m = model(sampleLibrary(36));
  const html = Object.values(allScreens(m)).join('');
  const figures = html.match(/<figure class="st-chart[\s\S]*?<\/figure>/g) || [];
  assert.ok(figures.length >= 6, 'the full library draws several charts');
  for (const figure of figures) {
    assert.match(figure, /tabindex="0"/);
    assert.match(figure, /role="group"/);
    assert.match(figure, /aria-label="[^"]+Use the arrow keys/);
    assert.match(figure, /<table class="sr-only"><caption>[^<]+<\/caption>/);
    const tips = (figure.match(/data-tip="/g) || []).length;
    const rows = (figure.match(/<tbody>[\s\S]*<\/tbody>/) || [''])[0].match(/<tr>/g) || [];
    assert.ok(tips > 0, 'marks carry tooltip text');
    if (!figure.includes('st-chart--heat')) assert.equal(rows.length, tips, 'the table lists exactly what the marks say');
    assert.match(figure, /class="st-tip" role="status" aria-live="polite" hidden/);
  }
});

test('bar, line, heat and scatter builders lay out the data they are given', () => {
  const bars = statsBarsChart({
    items: [
      { label: '≤115', sub: 'n=12', value: 80, display: '80%', detail: '10 of 12', tone: 'blue' },
      { label: '120–125', sub: 'n=30', value: 55, display: '55%', detail: '17 of 30', tone: 'blue' },
      { label: '130+', sub: 'n=2', value: 50, display: '50%', detail: '1 of 2', tone: 'blue', faded: true },
      { label: '360', sub: 'n=0', value: 0, display: '–', detail: '0 of 0', tone: 'blue' },
    ],
    max: 100, ticks: [0, 50, 100], formatTick: v => `${v}%`, reference: { value: 60, label: 'all 60%' },
    aria: 'Bids made.', caption: 'Bids made', headers: ['Bid', 'Bids'], valueHeader: 'Made',
  });
  assert.equal((bars.match(/class="st-bar /g) || []).length, 3, 'a zero bar draws nothing but keeps its label and tooltip');
  assert.equal((bars.match(/class="st-hit"/g) || []).length, 4);
  assert.match(bars, /st-bar--blue is-faded/);
  assert.equal((bars.match(/<tbody>[\s\S]*<\/tbody>/)[0].match(/<tr><th scope="row">[^<]*<\/th><td>[^<]*<\/td><td><\/td><\/tr>/g) || []).length, 4, 'rows are padded to the header width');
  assert.match(bars, /all 60%/);
  assert.match(bars, />80%<\/text>/, 'only the tallest bar is labelled directly');
  assert.equal((bars.match(/class="st-value"/g) || []).length, 1);

  const line = statsLineChart({
    points: [1000, 1012, 998, 1030].map((value, i) => ({ value, label: `Game ${i + 1}`, display: String(value), detail: 'x', axis: String(i + 1) })),
    baseline: 1000, baselineLabel: 'start', aria: 'Rating.', caption: 'Rating', headers: ['Game', 'Change'], valueHeader: 'Rating',
  });
  assert.match(line, /class="st-line"[^>]*pathLength="1"/);
  assert.equal((line.match(/class="st-hit"/g) || []).length, 4);
  assert.match(line, /class="st-dot st-dot--end"/);
  assert.match(line, /class="st-cross"[^>]*hidden/);

  const heat = statsHeatmap({ byDay: { '2026-10-03': 3, '2026-10-01': 1 }, weeks: 10, now: NOW, aria: 'Games per day' });
  const cells = heat.match(/class="st-cell /g) || [];
  assert.ok(cells.length > 60 && cells.length <= 70, 'ten weeks of days, none in the future');
  assert.match(heat, /st-heat--4/);
  assert.match(heat, /Sat, Oct 3/);

  const scatter = statsScatterChart({
    points: [{ key: 'ann', label: 'A', name: 'Ann', x: 125, y: 70, detail: '20 bids' }, { key: 'bob', label: 'B', name: 'Bob', x: 140, y: 52, detail: '18 bids' }],
    refX: 130, refY: 61, aria: 'Bidders.', caption: 'Bidders', headers: ['Player', 'Average bid'], valueHeader: 'Made', xLabel: 'Average bid', yLabel: 'Made',
  });
  assert.equal((scatter.match(/data-open-entity="player"/g) || []).length, 2);
  assert.doesNotMatch(scatter, BAD_TEXT);
});

test('parts of a whole and small marks stay honest', () => {
  assert.equal(statsStackedBar([{ label: 'A', value: 0, tone: 'blue' }, { label: 'B', value: 0, tone: 'aqua' }], { aria: 'x' }), '');
  const stack = statsStackedBar([{ label: 'Made', value: 3, tone: 'aqua', display: '3' }, { label: 'Set', value: 1, tone: 'orange', display: '1' }, { label: 'None', value: 0, tone: 'blue' }], { aria: 'Bids' });
  assert.match(stack, /flex:3 1 0/);
  assert.match(stack, /75%/);
  assert.doesNotMatch(stack, />None</, 'zero segments are left out');
  assert.equal(statsTrajectory([0]), '');
  assert.match(statsTrajectory([0, 50, -30, 120]), /class="st-traj__line"/);
  const form = statsFormStrip(['W', 'W', 'L', 'W', 'L', 'W', 'W']);
  assert.equal((form.match(/st-form__chip /g) || []).length, 5, 'only the latest five show');
  assert.match(form, /aria-label="Last 5 games, oldest first: lost, won, lost, won, won"/);
});

test('the leaderboard marks small samples instead of ranking them', () => {
  const games = [...sampleLibrary(12), quickWin('us', NOW - DAY, { us: ['Zed', 'Yan'], dem: ['Ann', 'Bob'] })];
  const m = model(games);
  const html = statsRenderLeaders(m, 'player');
  assert.match(html, /is-provisional/);
  assert.match(html, /st-rank st-rank--none/);
  assert.match(html, /st-rank st-rank--1/);
  assert.match(html, /Rank by/);
  assert.match(html, /<option value="winPct" selected>Win %<\/option>/);
  assert.match(html, /Players need 3 games to be ranked\. \d+ (isn’t|aren’t) there yet\./);
});

// A busy table plus a long tail of one-game names, like a real year of play.
function longTailLibrary() {
  const regulars = sampleLibrary(60, ['Ann', 'Bob', 'Cy', 'Di']);
  const guests = Array.from({ length: 30 }, (unused, i) => quickWin(i % 2 ? 'us' : 'dem', NOW - (100 + i) * DAY, { us: [`Guest${i}`, 'Ann'], dem: ['Cy', `Visitor${i}`] }));
  return [...regulars, ...guests];
}

test('a long tail of one-game names folds away and the board can be searched', () => {
  const m = model(longTailLibrary());
  const ui = getStatsUiForTests();
  ui.search = { players: '', teams: '' };
  ui.showUnranked = { players: false, teams: false };
  const total = m.players.list.length;
  assert.ok(total > 40);
  const folded = statsRenderLeaders(m, 'player');
  assert.match(folded, /data-stats-search="player"/, 'a long list offers search');
  assert.match(folded, /data-stats-toggle="unranked"/);
  const rowCount = html => (html.match(/class="st-row[ "]/g) || []).length;
  const shown = rowCount(folded);
  assert.ok(shown < total / 4, `only ${shown} of ${total} rows are drawn at first`);
  assert.match(folded, /Show \d+ more, not ranked yet/);
  assert.match(folded, /Players need \d+ games to be ranked\./);

  ui.showUnranked.players = true;
  assert.equal(rowCount(statsRenderLeaders(m, 'player')), total, 'opening the tail shows everyone');
  assert.match(statsRenderLeaders(m, 'player'), /Show fewer/);

  ui.search.players = 'guest1';
  const found = statsLeaderRowsHtml(m, 'player');
  const names = [...found.matchAll(/class="st-row__name">([^<]*)</g)].map(match => match[1]);
  assert.ok(names.length >= 10 && names.every(name => name.toLowerCase().includes('guest1')), `search matches: ${names.join(', ')}`);
  assert.doesNotMatch(found, /data-stats-toggle/, 'a search shows its matches, with no fold');
  ui.search.players = 'nobody <b>here</b>';
  const none = statsLeaderRowsHtml(m, 'player');
  assert.match(none, /No players match “nobody &lt;b&gt;here&lt;\/b&gt;”/);
  ui.search = { players: '', teams: '' };
  ui.showUnranked = { players: false, teams: false };
});

test('short lists need neither search nor folding', () => {
  const html = statsRenderLeaders(model(sampleLibrary(20)), 'player');
  assert.doesNotMatch(html, /data-stats-search/);
  assert.doesNotMatch(html, /data-stats-toggle="unranked"/);
});

test('older voice controls map onto the new screens', () => {
  const library = sampleLibrary(12);
  setLocalStorage('savedGames', library, { sync: false });
  clearStatisticsCache();
  const ui = getStatsUiForTests();
  statsApplyControls({ view: 'players', metric: 'bidSuccessPct', sort: 'least' });
  assert.equal(ui.tab, 'players');
  assert.deepEqual(ui.rank.players, { metric: 'bidMakePct', dir: 'asc' });
  statsApplyControls({ view: 'teams', metric: '360s', sort: 'most' });
  assert.equal(ui.tab, 'teams');
  assert.deepEqual(ui.rank.teams, { metric: 'perfect360s', dir: 'desc' });
  statsApplyControls({ view: 'players', sort: 'recent' });
  assert.deepEqual(ui.rank.players, { metric: 'recent', dir: 'desc' });
  statsApplyControls({ view: 'players', metric: 'comebacks' });
  assert.equal(ui.rank.players.metric, 'comebacks');
  statsApplyControls({ view: 'players', metric: 'not-a-metric' });
  assert.equal(ui.rank.players.metric, 'comebacks', 'unknown metrics are ignored');
  statsApplyControls({ view: 'players', entityMode: 'players', entityKey: 'ann' });
  assert.equal(ui.stack[ui.stack.length - 1].key, 'ann');
});

test('the voice roster names every player and team, newest first, from the core', () => {
  setLocalStorage('savedGames', [
    quickWin('us', NOW - 5 * DAY, { us: ['Old', 'Timer'], dem: ['Cy', 'Di'] }),
    quickWin('us', NOW - 1 * DAY, { us: ['Ann', 'Bob'], dem: ['Cy', 'Di'] }),
    { usTeamName: 'Zed & Yan', demTeamName: 'Ann & Bob', winner: 'us', timestamp: new Date(NOW - 3 * DAY).toISOString(), rounds: [round('us', 120, 130)], finalScore: { us: 505, dem: 100 } },
  ], { sync: false });
  const roster = getStatisticsRoster();
  assert.deepEqual(roster.playersData.slice(0, 4).map(player => player.name), ['Ann', 'Bob', 'Cy', 'Di'], 'the latest game’s players lead, ties by name');
  const keys = roster.teamsData.map(team => team.key);
  assert.ok(keys.includes('ann||bob') && keys.includes('old||timer') && keys.includes('yan||zed'));
  assert.equal(keys.indexOf('ann||bob') < keys.indexOf('old||timer'), true);
  assert.ok(roster.teamsData.every(team => Array.isArray(team.players) && team.name));
  assert.equal(escapeHtmlValue('<'), '&lt;');
});

test('a voice command lands on the right Statistics screen and names who it is showing', async () => {
  setLocalStorage('savedGames', sampleLibrary(12), { sync: false });
  clearStatisticsCache();
  const ui = getStatsUiForTests();
  const spoken = await applyVoiceScoreStatsControls({
    type: 'setStatsControls', statsView: 'players', statsMetric: 'bidSuccessPct', statsSort: 'least', entityMode: 'players', entityKey: 'Ann',
  });
  assert.equal(spoken, 'Showing statistics for Ann.');
  assert.equal(ui.tab, 'players');
  assert.deepEqual(ui.rank.players, { metric: 'bidMakePct', dir: 'asc' });
  assert.equal(ui.stack[ui.stack.length - 1].key, 'ann');

  const plain = await applyVoiceScoreStatsControls({ type: 'setStatsControls', statsView: 'teams', statsMetric: 'netPerGame', statsSort: 'most' });
  assert.equal(plain, 'Statistics updated.');
  assert.equal(ui.tab, 'teams');
  assert.deepEqual(ui.stack, [], 'no profile unless one was asked for');
  await assert.rejects(applyVoiceScoreStatsControls({ type: 'setStatsControls', entityMode: 'players', entityKey: 'Nobody Here' }), /No saved statistics were found for Nobody Here/);
});

test('avatar initials never split an emoji or accented letter in half', () => {
  const names = ['🔥 Bob', '😀', 'Émile Zola', '👩‍🍳 Chef', 'Zoë'];
  const games = names.map((name, i) => quickWin(i % 2 ? 'us' : 'dem', NOW - (10 - i) * DAY, { us: [name, 'Pal'], dem: ['Cy', 'Di'] }));
  const m = model(games);
  const html = [statsRenderLeaders(m, 'player'), statsRenderLeaders(m, 'team')].join('');
  const initials = [...html.matchAll(/class="st-avatar[^"]*" aria-hidden="true">([^<]*)</g)].map(match => match[1]);
  assert.ok(initials.length >= names.length);
  const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  for (const text of initials) assert.doesNotMatch(text, loneSurrogate, `broken initials: ${JSON.stringify(text)}`);
  assert.ok(initials.includes('🔥B'), 'the emoji stays whole beside the next initial');
  assert.ok(initials.includes('ÉZ'));
});

// --- Review fixes ---

test('every chart table has one header per column and no empty column', () => {
  const m = model(sampleLibrary(36));
  const html = Object.values(allScreens(m)).join('');
  const tables = html.match(/<table class="sr-only">[\s\S]*?<\/table>/g) || [];
  assert.ok(tables.length >= 6);
  for (const table of tables) {
    const headers = [...table.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map(match => match[1]);
    assert.equal(new Set(headers).size, headers.length, `repeated column header in ${headers.join(' | ')}`);
    const rows = [...table.matchAll(/<tr><th scope="row">[\s\S]*?<\/tr>/g)].map(match => [...match[0].matchAll(/<td>([^<]*)<\/td>/g)].map(cell => cell[1]));
    for (const cells of rows) assert.equal(cells.length, headers.length - 1, `ragged row in ${headers.join(' | ')}`);
    headers.slice(1).forEach((header, column) => {
      assert.ok(rows.some(cells => cells[column] !== ''), `the "${header}" column is empty in ${headers.join(' | ')}`);
    });
  }
});

test('axis ticks never stall on a flat, tiny, or broken range', () => {
  assert.deepEqual(statsNiceRange(1000, 1000 + 1.2e-13, 3).ticks.length > 1, true, 'a hair of spread is a flat line');
  assert.ok(statsNiceRange(5, 5).max > statsNiceRange(5, 5).min);
  assert.deepEqual(statsNiceRange(NaN, 5).ticks, [0, 0.5, 1]);
  assert.deepEqual(statsNiceRange(0, Infinity).ticks, [0, 0.5, 1]);
  assert.deepEqual(statsNiceScale(Infinity).ticks, [0, 0.5, 1]);
  assert.ok(statsNiceScale(1e-300).ticks.length <= 61);
  assert.ok(statsNiceRange(0, 1e12, 3).ticks.length <= 61);
});

test('a focused control is found again after its screen redraws', () => {
  const root = { contains: element => element.inside === true };
  const control = (attributes, inside = true) => ({
    inside, getAttribute: name => (name in attributes ? attributes[name] : null), hasAttribute: name => name in attributes,
  });
  assert.equal(statsFocusSelector(control({ 'data-game-list': 'blowouts' }), root), '[data-game-list="blowouts"]');
  assert.equal(statsFocusSelector(control({ 'data-rank-dir': 'player' }), root), '[data-rank-dir="player"]');
  assert.equal(statsFocusSelector(control({ 'data-stats-toggle': 'unranked', 'data-kind': 'team' }), root), '[data-stats-toggle="unranked"][data-kind="team"]');
  assert.equal(statsFocusSelector(control({ 'data-stats-toggle': 'insights' }), root), '[data-stats-toggle="insights"]');
  assert.equal(statsFocusSelector(control({ 'data-stats-search': 'player' }), root), '[data-stats-search="player"]');
  assert.equal(statsFocusSelector(control({ 'data-game-list': 'blowouts' }, false), root), '', 'a control outside the screen is not ours to restore');
  assert.equal(statsFocusSelector(control({ 'data-open-game': '4' }), root), '', 'rows are not worth refocusing');
  assert.equal(statsFocusSelector(null, root), '');

  const calls = [];
  const next = { focus: options => calls.push(['focus', options]), setSelectionRange: (...range) => calls.push(['caret', ...range]) };
  statsRestoreFocus({ querySelector: selector => (selector === '[data-stats-search="player"]' ? next : null) }, '[data-stats-search="player"]', [2, 4]);
  assert.deepEqual(calls, [['focus', { preventScroll: true }], ['caret', 2, 4]], 'the cursor goes back where it was');
  statsRestoreFocus({ querySelector: () => null }, '[data-gone]', null);
});

test('redrawing in place keeps the reader where they are; changing the view starts at the top', () => {
  const live = installLiveDocument();
  try {
    setLocalStorage('savedGames', sampleLibrary(12), { sync: false });
    clearStatisticsCache();
    live.get('statisticsModal').classList.remove('hidden');
    live.get('statisticsModalContent').setAttribute('aria-busy', 'true');
    renderStatisticsApp();
    const scroller = live.get('statisticsModalScroll');
    scroller.scrollTop = 612;
    statsRedraw();
    assert.equal(scroller.scrollTop, 612, 'a toggle or chip redraws without throwing the page back up');
    statsRender({ restoreScroll: false });
    assert.equal(scroller.scrollTop, 0, 'a new view starts at the top');
    statsRender({ scrollTo: 90 });
    assert.equal(scroller.scrollTop, 90);
  } finally {
    live.restore();
    setLocalStorage('savedGames', [], { sync: false });
    clearStatisticsCache();
  }
});

test('an open Statistics sheet redraws when saved games change underneath it', () => {
  const live = installLiveDocument();
  const ui = getStatsUiForTests();
  try {
    const games = sampleLibrary(12);
    setLocalStorage('savedGames', games, { sync: false });
    clearStatisticsCache();
    const sheet = live.get('statisticsModal');
    const content = live.get('statisticsModalContent');
    sheet.classList.remove('hidden');
    content.setAttribute('aria-busy', 'true');
    renderStatisticsApp();
    assert.match(content.innerHTML, /st-hero__value">12</);
    live.get('statisticsModalScroll').scrollTop = 640;

    // The game viewer deletes a game: the sheet underneath must not keep rows for the old numbering.
    setLocalStorage('savedGames', games.slice(1), { sync: false });
    assert.match(content.innerHTML, /st-hero__value">11</, 'the delete shows up without reopening');
    assert.equal(live.get('statisticsModalScroll').scrollTop, 640, 'and the reader keeps their place');

    // A profile on top redraws too, and says so when its player is gone.
    const profile = live.get('entityStatisticsModal');
    profile.classList.remove('hidden');
    ui.stack.push({ kind: 'player', key: 'ann' });
    live.get('entityStatisticsModalContent').scrollTop = 300;
    setLocalStorage('savedGames', games.slice(2), { sync: false });
    assert.match(live.get('entityStatisticsModalContent').innerHTML, /st-profile/);
    assert.equal(live.get('entityStatisticsModalContent').scrollTop, 300);
    setLocalStorage('savedGames', [], { sync: false });
    assert.match(content.innerHTML, /No stats yet/);
    assert.match(live.get('entityStatisticsModalContent').innerHTML, /Nothing to show/);

    // Closed sheets are left alone, and one still waiting for its first draw is not poked early.
    ui.stack.length = 0;
    sheet.classList.add('hidden');
    profile.classList.add('hidden');
    content.innerHTML = 'untouched';
    setLocalStorage('savedGames', games, { sync: false });
    assert.equal(content.innerHTML, 'untouched');
    sheet.classList.remove('hidden');
    content.setAttribute('aria-busy', 'true');
    setLocalStorage('savedGames', games.slice(3), { sync: false });
    assert.equal(content.innerHTML, 'untouched', 'still loading: the first draw will use the new data');
  } finally {
    ui.stack.length = 0;
    live.restore();
    setLocalStorage('savedGames', [], { sync: false });
    clearStatisticsCache();
  }
});

test('the empty-state button only asks about unsaved progress when there is some', () => {
  const live = installLiveDocument();
  try {
    const press = () => statsHandleClick({
      target: { closest: () => ({ matches: () => false, hasAttribute: name => name === 'data-stats-start', getAttribute: () => null }) },
      preventDefault() {},
    });
    press();
    assert.equal(live.has('confirmationModal') && !live.get('confirmationModal').classList.contains('hidden'), false, 'an empty scoreboard has nothing to lose');
  } finally {
    live.restore();
  }
});

test('asking for a player by name steps the period filter back to all time if it would hide them', async () => {
  const ui = getStatsUiForTests();
  const old = quickWin('us', NOW - 400 * DAY, { us: ['Olly', 'Pat'], dem: ['Cy', 'Di'] });
  setLocalStorage('savedGames', [old, ...sampleLibrary(8)], { sync: false });
  clearStatisticsCache();
  ui.period = 'd30';
  const spoken = await applyVoiceScoreStatsControls({ type: 'setStatsControls', entityMode: 'players', entityKey: 'Olly' });
  assert.equal(spoken, 'Showing statistics for Olly.');
  assert.equal(ui.period, 'all', 'the filter would have shown "Nothing to show"');
  assert.equal(ui.stack[ui.stack.length - 1].key, 'olly');

  // Someone who is in the period keeps the filter the reader chose.
  ui.period = 'd30';
  ui.stack.length = 0;
  setLocalStorage('savedGames', [quickWin('us', Date.now() - DAY, { us: ['Olly', 'Pat'], dem: ['Cy', 'Di'] })], { sync: false });
  clearStatisticsCache();
  await applyVoiceScoreStatsControls({ type: 'setStatsControls', entityMode: 'players', entityKey: 'Olly' });
  assert.equal(ui.period, 'd30');
  ui.period = 'all';
  ui.stack.length = 0;
  setLocalStorage('savedGames', [], { sync: false });
  clearStatisticsCache();
});
