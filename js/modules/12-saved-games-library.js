"use strict";

// --- Saved Games Modal (New Functions) ---
let gamesFilterRenderScheduled = false;

const LIBRARY_ICONS = {
  trophy: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M8 21h8m-4-4v4m-6-9a6 6 0 0012 0V4H6v8z"/><path stroke-linecap="round" stroke-linejoin="round" d="M6 6H4a2 2 0 002 4m12-4h2a2 2 0 01-2 4"/></svg>',
  trash: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6m4-6v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"/></svg>',
  chevron: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>',
  play: '<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 001.5.86l10.5-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z"/></svg>',
  snowflake: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 2v20M4.9 6.5l14.2 11M4.9 17.5l14.2-11M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5"/></svg>',
  clock: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
};
const LIBRARY_ANIMATED_CARD_LIMIT = 8;
// Cards are added a page at a time as the list scrolls, so big libraries open instantly.
const LIBRARY_PAGE_SIZE = 30;
const LIBRARY_LOAD_AHEAD_PX = 1200;
const libraryListState = {};
let libraryLoadMoreScheduled = false;
// Per-game sort/search values, rebuilt whenever the saved lists change.
let libraryGameMeta = new WeakMap();
const LIBRARY_DATE_OPTIONS = {
  full: { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' },
  time: { hour: 'numeric', minute: '2-digit' },
  month: { month: 'long' },
  monthYear: { month: 'long', year: 'numeric' },
  weekday: { weekday: 'long' },
  dayShort: { weekday: 'short', month: 'short', day: 'numeric' },
  dateShort: { month: 'short', day: 'numeric', year: 'numeric' },
};
const LIBRARY_DATE_FORMATTERS = {};

// toLocale*String builds a new formatter on every call; reuse one per format instead.
function formatLibraryDate(date, format) {
  const formatter = LIBRARY_DATE_FORMATTERS[format]
    || (LIBRARY_DATE_FORMATTERS[format] = new Intl.DateTimeFormat([], LIBRARY_DATE_OPTIONS[format]));
  return formatter.format(date);
}

let libraryRenderDayKey = "";

function clearLibraryGameCache() {
  libraryGameMeta = new WeakMap();
}

function getLibraryGameMeta(game) {
  let meta = libraryGameMeta.get(game);
  if (!meta) {
    const date = getLibraryTimestamp(game.timestamp);
    const finalScore = game.finalScore || {};
    meta = {
      date,
      time: date ? date.getTime() : 0,
      highScore: Math.max(Number(finalScore.us) || 0, Number(finalScore.dem) || 0),
      dayKey: '',
      group: null,
      searchText: null,
    };
    libraryGameMeta.set(game, meta);
  }
  // Group labels ("Today", "This Week") shift at midnight. The key is computed
  // once per render pass rather than once per game.
  const dayKey = libraryRenderDayKey || new Date().toDateString();
  if (meta.dayKey !== dayKey) {
    meta.dayKey = dayKey;
    meta.group = null;
    meta.searchText = null;
  }
  return meta;
}

function getLibraryGameGroup(game) {
  const meta = getLibraryGameMeta(game);
  return meta.group || (meta.group = getLibraryDateGroup(game.timestamp));
}

function getLibrarySearchText(game) {
  const meta = getLibraryGameMeta(game);
  if (meta.searchText === null) {
    meta.searchText = [
      getGameTeamDisplay(game, 'us'),
      getGameTeamDisplay(game, 'dem'),
      meta.date ? formatLibraryDate(meta.date, 'full') : '',
      meta.date ? getLibraryGameGroup(game).label : '',
    ].join('\n').toLowerCase();
  }
  return meta.searchText;
}

function switchGamesTab(tabType) {
  const isFreezer = tabType === 'freezer';
  const tabs = { completed: document.getElementById('completedGamesTab'), freezer: document.getElementById('freezerGamesTab') };
  Object.entries(tabs).forEach(([key, tab]) => {
    if (!tab) return;
    const active = (key === 'freezer') === isFreezer;
    tab.setAttribute('aria-selected', String(active));
    tab.setAttribute('aria-pressed', String(active));
  });
  tabs.completed?.closest('.library-segmented')?.setAttribute('data-active', isFreezer ? 'freezer' : 'completed');
  document.getElementById('completedGamesSection')?.classList.toggle('hidden', isFreezer);
  document.getElementById('freezerGamesSection')?.classList.toggle('hidden', !isFreezer);
  document.getElementById('gameSearchInput').value = '';
  document.getElementById('gameSortSelect').value = 'newest';
  renderGamesWithFilter({ animate: true });
}
function updateGamesCount() {
  const savedGames = getLocalStorage("savedGames", []);
  const freezerGames = getLocalStorage("freezerGames", []);
  document.getElementById('completedGamesCount').textContent = savedGames.length;
  document.getElementById('freezerGamesCount').textContent = freezerGames.length;
  document.getElementById('noCompletedGamesMessage').classList.toggle('hidden', savedGames.length > 0);
  document.getElementById('noFreezerGamesMessage').classList.toggle('hidden', freezerGames.length > 0);
}
function filterGames() {
  if (gamesFilterRenderScheduled) return;
  gamesFilterRenderScheduled = true;
  scheduleFrame(() => {
    gamesFilterRenderScheduled = false;
    renderGamesWithFilter();
  });
}
function clearGameSearch() {
  const input = document.getElementById('gameSearchInput');
  if (!input) return;
  input.value = '';
  renderGamesWithFilter();
  input.focus();
}
function sortGames() { renderGamesWithFilter(); }
// keepPosition re-renders in place (after a delete) instead of jumping back to the top.
function renderGamesWithFilter({ animate = false, keepPosition = false } = {}) {
  const rawSearchValue = document.getElementById('gameSearchInput').value || '';
  const searchTerm = rawSearchValue.trim().toLowerCase();
  const displaySearch = rawSearchValue.trim();
  const sortOption = document.getElementById('gameSortSelect').value;
  const completedTabActive = !document.getElementById('completedGamesSection').classList.contains('hidden');
  document.getElementById('gameSearchClearBtn')?.classList.toggle('hidden', !rawSearchValue);

  if (completedTabActive) {
    renderGamesList({
      storageKey: 'savedGames',
      containerId: 'savedGamesList',
      emptyMessageId: 'noCompletedGamesMessage',
      emptySearchMessage: 'No completed games match',
      searchTerm,
      displaySearch,
      sortOption,
      animate,
      keepPosition,
      buildCard: buildSavedGameCard,
    });
  } else {
    renderGamesList({
      storageKey: 'freezerGames',
      containerId: 'freezerGamesList',
      emptyMessageId: 'noFreezerGamesMessage',
      emptySearchMessage: 'No frozen games match',
      searchTerm,
      displaySearch,
      sortOption,
      animate,
      keepPosition,
      buildCard: buildFreezerGameCard,
    });
  }
}

function renderGamesList({ storageKey, containerId, emptyMessageId, emptySearchMessage, searchTerm, displaySearch, sortOption, animate = false, keepPosition = false, buildCard }) {
  const container = document.getElementById(containerId);
  if (!container) return;
  libraryRenderDayKey = new Date().toDateString();

  const entries = getLocalStorage(storageKey, []).map((game, index) => ({ game, index }));
  const normalizedTerm = searchTerm || '';

  const filteredEntries = normalizedTerm
    ? entries.filter(({ game }) => getLibrarySearchText(game).includes(normalizedTerm))
    : entries;

  const sortedEntries = sortGamesBy(filteredEntries, sortOption);
  const previous = libraryListState[containerId];
  const state = {
    entries: sortedEntries,
    buildCard,
    groupByDate: sortOption === 'newest' || sortOption === 'oldest',
    rendered: 0,
    lastGroupKey: null,
  };
  libraryListState[containerId] = state;
  const pageCount = keepPosition && previous ? Math.max(LIBRARY_PAGE_SIZE, previous.rendered) : LIBRARY_PAGE_SIZE;
  const listHtml = buildLibraryListPage(state, pageCount);

  const emptyMessageEl = document.getElementById(emptyMessageId);
  if (emptyMessageEl) emptyMessageEl.classList.toggle('hidden', sortedEntries.length > 0 || Boolean(normalizedTerm));

  const scroller = document.getElementById('savedGamesScroll');
  if (scroller && !keepPosition) scroller.scrollTop = 0;
  container.classList.toggle('library-list--animate', animate);
  container.innerHTML = listHtml || (!normalizedTerm ? '' : `
    <div class="library-no-match">
      <p>${escapeHtmlValue(emptySearchMessage)} <strong>“${escapeHtmlValue(displaySearch)}”</strong></p>
      <button type="button" class="library-no-match__clear" onclick="clearGameSearch()">Clear search</button>
    </div>`);
  ensureLibraryScrollPaging();
}

// Builds the next `count` cards (with any date headings) and advances the list's cursor.
function buildLibraryListPage(state, count) {
  const end = Math.min(state.entries.length, state.rendered + count);
  let html = '';
  for (let position = state.rendered; position < end; position += 1) {
    const { game, index } = state.entries[position];
    if (state.groupByDate) {
      const group = getLibraryGameGroup(game);
      if (group.key !== state.lastGroupKey) {
        state.lastGroupKey = group.key;
        html += `<h4 class="library-group${getLibraryEnterClass(position)}" ${getLibraryCardStyle(position)}>${escapeHtmlValue(group.label)}</h4>`;
      }
    }
    html += state.buildCard(game, index, position, state.groupByDate);
  }
  state.rendered = end;
  return html;
}

function getActiveLibraryListId() {
  const freezerSection = document.getElementById('freezerGamesSection');
  return freezerSection && !freezerSection.classList.contains('hidden') ? 'freezerGamesList' : 'savedGamesList';
}

function loadMoreLibraryGames() {
  const containerId = getActiveLibraryListId();
  const state = libraryListState[containerId];
  const container = document.getElementById(containerId);
  const scroller = document.getElementById('savedGamesScroll');
  if (!state || !container || !scroller || state.rendered >= state.entries.length) return false;
  const distanceToEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  if (distanceToEnd > LIBRARY_LOAD_AHEAD_PX) return false;
  container.insertAdjacentHTML('beforeend', buildLibraryListPage(state, LIBRARY_PAGE_SIZE));
  return true;
}

function ensureLibraryScrollPaging() {
  const scroller = document.getElementById('savedGamesScroll');
  if (!scroller || scroller.dataset.pagingBound === 'true') return;
  scroller.addEventListener('scroll', () => {
    if (libraryLoadMoreScheduled) return;
    libraryLoadMoreScheduled = true;
    scheduleFrame(() => {
      libraryLoadMoreScheduled = false;
      loadMoreLibraryGames();
    });
  }, { passive: true });
  scroller.dataset.pagingBound = 'true';
}

function getLibraryTimestamp(value) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function getLibraryDayDiff(date, now = new Date()) {
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOf(now) - startOf(date)) / 86400000);
}

function getLibraryDateGroup(timestamp, now = new Date()) {
  const date = getLibraryTimestamp(timestamp);
  if (!date) return { key: 'unknown', label: 'Undated' };
  const dayDiff = getLibraryDayDiff(date, now);
  if (dayDiff <= 0) return { key: 'today', label: 'Today' };
  if (dayDiff === 1) return { key: 'yesterday', label: 'Yesterday' };
  if (dayDiff < 7) return { key: 'week', label: 'This Week' };
  const sameYear = date.getFullYear() === now.getFullYear();
  return {
    key: `${date.getFullYear()}-${date.getMonth()}`,
    label: formatLibraryDate(date, sameYear ? 'month' : 'monthYear'),
  };
}

// Under a Today/Yesterday group heading the day is already shown, so only the time is needed.
function formatLibraryWhen(timestamp, { grouped = false, now = new Date() } = {}) {
  const date = getLibraryTimestamp(timestamp);
  if (!date) return 'Unknown date';
  const time = formatLibraryDate(date, 'time');
  const dayDiff = getLibraryDayDiff(date, now);
  if (dayDiff <= 1) {
    if (grouped) return time;
    return `${dayDiff <= 0 ? 'Today' : 'Yesterday'} · ${time}`;
  }
  if (dayDiff < 7) return `${formatLibraryDate(date, 'weekday')} · ${time}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  const day = formatLibraryDate(date, sameYear ? 'dayShort' : 'dateShort');
  return grouped ? `${day} · ${time}` : day;
}

function formatLibraryAgo(timestamp, now = new Date()) {
  const date = getLibraryTimestamp(timestamp);
  if (!date) return 'a while ago';
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const dayDiff = getLibraryDayDiff(date, now);
  if (dayDiff === 1) return 'yesterday';
  if (dayDiff < 7) return `${dayDiff} days ago`;
  return `on ${formatLibraryWhen(timestamp, { now })}`;
}

// Only the first few cards stagger in; the rest are below the fold and appear without animating.
function isLibraryEnterPosition(position) {
  return (Number(position) || 0) < LIBRARY_ANIMATED_CARD_LIMIT;
}

function getLibraryEnterClass(position) {
  return isLibraryEnterPosition(position) ? ' library-enter' : '';
}

function getLibraryCardStyle(position) {
  return isLibraryEnterPosition(position) ? `style="--card-i: ${Number(position) || 0}"` : '';
}

function buildLibraryTeamRow(side, name, score, { lead = false, trophy = false, dim = false, trail = false } = {}) {
  const classes = ['game-card__team', `game-card__team--${side}`];
  if (lead) classes.push('is-lead');
  if (dim) classes.push('is-dim');
  if (trail) classes.push('is-trail');
  return `
    <div class="${classes.join(' ')}">
      <span class="game-card__dot" aria-hidden="true"></span>
      <span class="game-card__name">${escapeHtmlValue(name)}</span>
      ${trophy ? `<span class="game-card__trophy" aria-label="Winner">${LIBRARY_ICONS.trophy}</span>` : ''}
      <span class="game-card__score">${escapeHtmlValue(String(score))}</span>
    </div>`;
}

function buildSavedGameCard(game, originalIndex, position = 0, grouped = false) {
  const usDisplay = getGameTeamDisplay(game, 'us');
  const demDisplay = getGameTeamDisplay(game, 'dem');
  const finalTotals = sanitizeTotals(game.finalScore);
  const usScore = finalTotals.us;
  const demScore = finalTotals.dem;
  const usWon = game.winner === 'us';
  const demWon = game.winner === 'dem';
  const hasWinner = usWon || demWon;
  const when = formatLibraryWhen(game.timestamp, { grouped });
  const roundsCount = Array.isArray(game.rounds) ? game.rounds.length : 0;
  const margin = Math.abs(usScore - demScore);
  const winnerName = usWon ? usDisplay : demWon ? demDisplay : '';
  const facts = [
    roundsCount ? `${roundsCount} rd${roundsCount === 1 ? '' : 's'}` : '',
    game.durationMs ? formatDuration(game.durationMs) : '',
  ].filter(Boolean).join(' · ');
  const summary = `${usDisplay} ${usScore}, ${demDisplay} ${demScore}. ${winnerName ? `${winnerName} won. ` : ''}${formatLibraryWhen(game.timestamp)}`;

  return `
    <article class="game-card game-card--completed${getLibraryEnterClass(position)}" ${getLibraryCardStyle(position)}>
      <button type="button" class="game-card__open" onclick="viewSavedGame(${originalIndex})" aria-label="${escapeAttribute(`View game details: ${summary}`)}"></button>
      <div class="game-card__meta">
        <span class="game-card__when">${escapeHtmlValue(when)}</span>
        ${facts ? `<span class="game-card__facts">${escapeHtmlValue(facts)}</span>` : ''}
      </div>
      <div class="game-card__body">
        <div class="game-card__teams">
          ${buildLibraryTeamRow('us', usDisplay, usScore, { lead: usWon, trophy: usWon, dim: hasWinner && !usWon })}
          ${buildLibraryTeamRow('dem', demDisplay, demScore, { lead: demWon, trophy: demWon, dim: hasWinner && !demWon })}
        </div>
        <span class="game-card__chevron" aria-hidden="true">${LIBRARY_ICONS.chevron}</span>
      </div>
      <div class="game-card__footer">
        <div class="game-card__chips">
          ${game.victoryMethod ? `<span class="game-chip game-chip--method">${escapeHtmlValue(game.victoryMethod)}</span>` : ''}
          ${hasWinner && margin ? `<span class="game-chip">Won by ${escapeHtmlValue(String(margin))}</span>` : ''}
        </div>
        <button type="button" onclick="deleteSavedGame(${originalIndex}); event.stopPropagation();" class="game-card__icon-btn game-card__icon-btn--danger" aria-label="${escapeAttribute(`Delete game: ${usDisplay} vs ${demDisplay}`)}">${LIBRARY_ICONS.trash}</button>
      </div>
    </article>`;
}

function buildFreezerGameCard(game, originalIndex, position = 0) {
  const usDisplay = getGameTeamDisplay(game, 'us');
  const demDisplay = getGameTeamDisplay(game, 'dem');
  const finalTotals = sanitizeTotals(game.finalScore);
  const usScore = finalTotals.us;
  const demScore = finalTotals.dem;
  const usLeads = usScore > demScore;
  const demLeads = demScore > usScore;
  const leadInfo = usLeads || demLeads ? `Up ${Math.abs(usScore - demScore)}` : 'Tied';
  const lastBidMatch = typeof game.lastBid === 'string' ? game.lastBid.match(/^\s*(\d+)/) : null;
  const lastBid = lastBidMatch ? lastBidMatch[1] : game.lastBid;
  const roundsCount = Array.isArray(game.rounds) ? game.rounds.length : 0;
  const facts = [
    roundsCount ? `${roundsCount} rd${roundsCount === 1 ? '' : 's'}` : '',
    game.accumulatedTime ? `${formatDuration(game.accumulatedTime)} played` : '',
  ].filter(Boolean).join(' · ');
  const frozenAgo = formatLibraryAgo(game.timestamp);

  return `
    <article class="game-card game-card--frozen${getLibraryEnterClass(position)}" ${getLibraryCardStyle(position)}>
      <button type="button" class="game-card__open" onclick="loadFreezerGame(${originalIndex})" aria-label="${escapeAttribute(`Resume frozen game: ${usDisplay} ${usScore}, ${demDisplay} ${demScore}`)}"></button>
      <div class="game-card__meta">
        <span class="game-card__when game-card__when--frozen"><span class="game-card__meta-icon">${LIBRARY_ICONS.snowflake}</span>Frozen ${escapeHtmlValue(frozenAgo)}</span>
        ${facts ? `<span class="game-card__facts">${escapeHtmlValue(facts)}</span>` : ''}
      </div>
      <div class="game-card__body">
        <div class="game-card__teams">
          ${buildLibraryTeamRow('us', usDisplay, usScore, { lead: usLeads, trail: demLeads })}
          ${buildLibraryTeamRow('dem', demDisplay, demScore, { lead: demLeads, trail: usLeads })}
        </div>
      </div>
      <div class="game-card__footer">
        <div class="game-card__chips">
          <span class="game-chip game-chip--lead">${escapeHtmlValue(leadInfo)}</span>
          ${lastBid ? `<span class="game-chip">Bid ${escapeHtmlValue(lastBid)}</span>` : ''}
        </div>
        <button type="button" onclick="deleteFreezerGame(${originalIndex}); event.stopPropagation();" class="game-card__icon-btn game-card__icon-btn--danger" aria-label="${escapeAttribute(`Delete frozen game: ${usDisplay} vs ${demDisplay}`)}">${LIBRARY_ICONS.trash}</button>
        <button type="button" onclick="loadFreezerGame(${originalIndex}); event.stopPropagation();" class="game-card__resume" aria-label="${escapeAttribute(`Resume ${usDisplay} vs ${demDisplay}`)}">${LIBRARY_ICONS.play}<span>Resume</span></button>
      </div>
    </article>`;
}

function sortGamesBy(entries, sortOption = 'newest') {
  const sorted = [...entries];
  const getTimestamp = ({ game }) => getLibraryGameMeta(game).time;
  const getHighScore = ({ game }) => getLibraryGameMeta(game).highScore;

  switch (sortOption) {
    case 'oldest':
      sorted.sort((a, b) => getTimestamp(a) - getTimestamp(b));
      break;
    case 'highest':
      sorted.sort((a, b) => getHighScore(b) - getHighScore(a));
      break;
    case 'lowest':
      sorted.sort((a, b) => getHighScore(a) - getHighScore(b));
      break;
    case 'newest':
    default:
      sorted.sort((a, b) => getTimestamp(b) - getTimestamp(a));
      break;
  }
  return sorted;
}

// --- Shared with statistics ---
// The Statistics screens ship as a lazy bundle; these two stay in the core so
// voice commands can resolve names without loading it.

// A saved game's side as statistics see it: players in canonical order, the team
// key, and the display name. Legacy games only stored a team name.
function getGameSideIdentity(game, side) {
  const nameField = side === "us" ? game.usTeamName || game.usName : game.demTeamName || game.demName;
  const playersField = side === "us" ? game.usPlayers : game.demPlayers;
  const players = canonicalizePlayers(playersField || parseLegacyTeamName(nameField));
  const fallback = side === "us" ? "Us" : "Dem";
  const named = [];
  const seen = new Set();
  players.filter(Boolean).forEach(name => {
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      named.push(name);
    }
  });
  return {
    side,
    key: buildTeamKey(players),
    players,
    named,
    keys: named.map(name => name.toLowerCase()),
    name: deriveTeamDisplay(players, nameField || fallback) || fallback,
  };
}

// Players and teams named in saved games, most recently played first.
function getStatisticsRoster() {
  const players = new Map();
  const teams = new Map();
  const remember = (map, entry) => {
    const previous = map.get(entry.key);
    if (!previous) map.set(entry.key, entry);
    else if (entry.lastPlayed >= previous.lastPlayed) map.set(entry.key, { ...previous, ...entry });
  };
  getLocalStorage("savedGames", []).forEach(game => {
    if (!game || !Array.isArray(game.rounds) || !game.rounds.length) return;
    const parsed = typeof game.timestamp === "number" ? game.timestamp : Date.parse(game.timestamp || "");
    const lastPlayed = Number.isFinite(parsed) ? parsed : 0;
    ["us", "dem"].forEach(side => {
      const identity = getGameSideIdentity(game, side);
      if (identity.key) remember(teams, { key: identity.key, name: identity.name, players: identity.players, lastPlayed });
      identity.named.forEach((name, i) => remember(players, { key: identity.keys[i], name, lastPlayed }));
    });
  });
  const byRecency = (a, b) => (b.lastPlayed - a.lastPlayed) || a.name.localeCompare(b.name);
  return { playersData: [...players.values()].sort(byRecency), teamsData: [...teams.values()].sort(byRecency) };
}

function ensureStatsSheetGesture(modalId, closeFn) {
  const modal = document.getElementById(modalId);
  if (!modal || modal.dataset.sheetGestureBound === 'true') return;
  const shell = modal.querySelector('.stats-modal__shell');
  const dragZones = modal.querySelectorAll('[data-sheet-drag]');
  if (!shell || !dragZones.length) return;

  let startY = 0;
  let deltaY = 0;
  let dragging = false;

  const onStart = (e) => {
    if (window.innerWidth > 640) return;
    dragging = true;
    startY = e.touches[0].clientY;
    deltaY = 0;
    shell.style.transition = 'none';
  };
  const onMove = (e) => {
    if (!dragging) return;
    deltaY = Math.max(0, e.touches[0].clientY - startY);
    shell.style.transform = deltaY ? `translateY(${deltaY}px)` : '';
    if (deltaY > 0 && e.cancelable) e.preventDefault();
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    if (deltaY <= 90) {
      shell.style.transition = '';
      shell.style.transform = '';
      return;
    }
    // Finish the swipe from where the finger let go instead of snapping back first.
    modal.dataset.sheetDismissed = 'true';
    shell.style.transition = 'transform 0.22s cubic-bezier(0.4, 0, 1, 1)';
    shell.style.transform = 'translateY(105%)';
    modal.classList.add('is-dismissing');
    setTimeout(() => {
      closeFn();
      delete modal.dataset.sheetDismissed;
      modal.classList.remove('is-dismissing');
      shell.style.transition = '';
      shell.style.transform = '';
    }, 220);
  };

  dragZones.forEach((zone) => {
    zone.addEventListener('touchstart', onStart, { passive: true });
    zone.addEventListener('touchmove', onMove, { passive: false });
    zone.addEventListener('touchend', onEnd);
    zone.addEventListener('touchcancel', onEnd);
  });
  modal.dataset.sheetGestureBound = 'true';
}
