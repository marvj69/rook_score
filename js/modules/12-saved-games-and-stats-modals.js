"use strict";

// --- Saved Games Modal (New Functions) ---
const STATS_RESULT_CACHE = { key: null, value: null };
let gamesFilterRenderScheduled = false;

function clearStatisticsCache() {
  STATS_RESULT_CACHE.key = null;
  STATS_RESULT_CACHE.value = null;
}

function switchGamesTab(tabType) {
  const completedTab = document.getElementById('completedGamesTab');
  const freezerTab = document.getElementById('freezerGamesTab');
  const completedSection = document.getElementById('completedGamesSection');
  const freezerSection = document.getElementById('freezerGamesSection');

  const activeClasses = ['border-blue-600', 'text-blue-600', 'dark:text-blue-400', 'dark:border-blue-400'];
  const inactiveClasses = ['border-transparent', 'text-gray-500', 'hover:text-gray-700', 'dark:text-gray-400', 'dark:hover:text-gray-300'];

  if (tabType === 'completed') {
      completedTab.classList.add(...activeClasses); completedTab.classList.remove(...inactiveClasses);
      freezerTab.classList.add(...inactiveClasses); freezerTab.classList.remove(...activeClasses);
      completedSection.classList.remove('hidden'); freezerSection.classList.add('hidden');
  } else {
      freezerTab.classList.add(...activeClasses); freezerTab.classList.remove(...inactiveClasses);
      completedTab.classList.add(...inactiveClasses); completedTab.classList.remove(...activeClasses);
      freezerSection.classList.remove('hidden'); completedSection.classList.add('hidden');
  }
  document.getElementById('gameSearchInput').value = '';
  document.getElementById('gameSortSelect').value = 'newest';
  renderGamesWithFilter();
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
function sortGames() { renderGamesWithFilter(); }
function renderGamesWithFilter() {
  const rawSearchValue = document.getElementById('gameSearchInput').value || '';
  const searchTerm = rawSearchValue.trim().toLowerCase();
  const displaySearch = rawSearchValue.trim();
  const sortOption = document.getElementById('gameSortSelect').value;
  const completedTabActive = !document.getElementById('completedGamesSection').classList.contains('hidden');

  if (completedTabActive) {
    renderGamesList({
      storageKey: 'savedGames',
      containerId: 'savedGamesList',
      emptyMessageId: 'noCompletedGamesMessage',
      emptySearchMessage: 'No completed games match',
      searchTerm,
      displaySearch,
      sortOption,
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
      buildCard: buildFreezerGameCard,
    });
  }
}

function renderGamesList({ storageKey, containerId, emptyMessageId, emptySearchMessage, searchTerm, displaySearch, sortOption, buildCard }) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const entries = getLocalStorage(storageKey, []).map((game, index) => ({ game, index }));
  const normalizedTerm = searchTerm || '';

  const filteredEntries = normalizedTerm
    ? entries.filter(({ game }) => {
        const us = getGameTeamDisplay(game, 'us').toLowerCase();
        const dem = getGameTeamDisplay(game, 'dem').toLowerCase();
        const timestamp = game.timestamp ? new Date(game.timestamp).toLocaleString().toLowerCase() : '';
        return us.includes(normalizedTerm) || dem.includes(normalizedTerm) || timestamp.includes(normalizedTerm);
      })
    : entries;

  const sortedEntries = sortGamesBy(filteredEntries, sortOption);
  const listHtml = sortedEntries.map(({ game, index }) => buildCard(game, index)).join('');

  const emptyMessageEl = document.getElementById(emptyMessageId);
  if (emptyMessageEl) emptyMessageEl.classList.toggle('hidden', sortedEntries.length > 0);

  container.innerHTML = listHtml || (!normalizedTerm ? '' : `<p class="text-gray-500 col-span-full text-center">${escapeHtmlValue(emptySearchMessage)} "${escapeHtmlValue(displaySearch)}".</p>`);
}

function buildSavedGameCard(game, originalIndex) {
  const usDisplay = getGameTeamDisplay(game, 'us');
  const demDisplay = getGameTeamDisplay(game, 'dem');
  const usDisplayText = escapeHtmlValue(usDisplay);
  const demDisplayText = escapeHtmlValue(demDisplay);
  const finalTotals = sanitizeTotals(game.finalScore);
  const usScore = finalTotals.us;
  const demScore = finalTotals.dem;
  const usWon = game.winner === 'us';
  const demWon = game.winner === 'dem';
  const timestamp = game.timestamp ? new Date(game.timestamp).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown date';
  const timestampText = escapeHtmlValue(timestamp);
  const victoryMethodText = escapeHtmlValue(game.victoryMethod);

  return `
    <div class="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-lg transition-shadow dark:bg-gray-800 dark:border-gray-700 cursor-pointer relative" onclick="viewSavedGame(${originalIndex})">
      ${usWon ? `<div class="absolute top-0 right-2 bg-green-100 text-green-800 text-xs font-semibold px-2 py-0.5 rounded-full dark:bg-green-900 dark:text-green-300">Winner: ${usDisplayText}</div>` : ''}
      ${demWon ? `<div class="absolute top-0 right-2 bg-green-100 text-green-800 text-xs font-semibold px-2 py-0.5 rounded-full dark:bg-green-900 dark:text-green-300">Winner: ${demDisplayText}</div>` : ''}
      <div class="p-5">
        <div class="flex justify-between items-start mb-2">
          <div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">${usDisplayText} vs ${demDisplayText}</h3>
            <div class="text-sm text-gray-500 dark:text-gray-400">${timestampText}</div>
          </div>
          <div class="flex space-x-1">
            <button onclick="viewSavedGame(${originalIndex}); event.stopPropagation();" class="p-1.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-300" aria-label="View"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg></button>
            <button onclick="deleteSavedGame(${originalIndex}); event.stopPropagation();" class="p-1.5 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 rounded-full focus:outline-none focus:ring-2 focus:ring-red-300" aria-label="Delete">${Icons.Trash}</button>
          </div>
        </div>
        <div class="text-sm">
          <span class="${usWon ? 'text-green-600 font-bold' : 'text-gray-700 dark:text-gray-300'}">${usDisplayText}: ${usScore}</span> |
          <span class="${demWon ? 'text-green-600 font-bold' : 'text-gray-700 dark:text-gray-300'}">${demDisplayText}: ${demScore}</span>
        </div>
        <div class="mt-2 flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
          ${game.victoryMethod ? `<span class="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full dark:bg-purple-900 dark:text-purple-300">${victoryMethodText}</span>` : ''}
          ${game.durationMs ? `<span>${formatDuration(game.durationMs)}</span>` : ''}
        </div>
      </div>
    </div>`;
}

function buildFreezerGameCard(game, originalIndex) {
  const usDisplay = getGameTeamDisplay(game, 'us');
  const demDisplay = getGameTeamDisplay(game, 'dem');
  const usDisplayText = escapeHtmlValue(usDisplay);
  const demDisplayText = escapeHtmlValue(demDisplay);
  const finalTotals = sanitizeTotals(game.finalScore);
  const usScore = finalTotals.us;
  const demScore = finalTotals.dem;
  const timestamp = game.timestamp ? new Date(game.timestamp).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown date';
  const leadInfo = usScore > demScore
    ? `${usDisplay} leads by ${usScore - demScore}`
    : demScore > usScore
      ? `${demDisplay} leads by ${demScore - usScore}`
      : 'Tied';
  const leadInfoText = escapeHtmlValue(leadInfo);
  const timestampText = escapeHtmlValue(timestamp);
  const lastBidText = escapeHtmlValue(game.lastBid);

  return `
    <div class="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-lg transition-shadow dark:bg-gray-800 dark:border-gray-700 cursor-pointer relative" onclick="loadFreezerGame(${originalIndex})">
      <div class="absolute top-0 right-2 bg-yellow-100 text-yellow-800 text-xs font-semibold px-2 py-0.5 rounded-full dark:bg-yellow-900 dark:text-yellow-300">${leadInfoText}</div>
      <div class="p-5">
        <div class="flex justify-between items-start mb-2">
          <div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">${usDisplayText} vs ${demDisplayText}</h3>
            <div class="text-sm text-gray-500 dark:text-gray-400">Frozen: ${timestampText}</div>
          </div>
          <div class="flex space-x-1">
            <button onclick="loadFreezerGame(${originalIndex}); event.stopPropagation();" class="p-1.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-300" aria-label="Load">${Icons.Load}</button>
            <button onclick="deleteFreezerGame(${originalIndex}); event.stopPropagation();" class="p-1.5 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 rounded-full focus:outline-none focus:ring-2 focus:ring-red-300" aria-label="Delete">${Icons.Trash}</button>
          </div>
        </div>
        <div class="text-sm text-gray-700 dark:text-gray-300">
          <span>${usDisplayText}: ${usScore}</span> | <span>${demDisplayText}: ${demScore}</span>
        </div>
        <div class="mt-2 flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
          ${game.lastBid ? `<span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full dark:bg-indigo-900 dark:text-indigo-300">Last Bid: ${lastBidText}</span>` : ''}
          ${game.accumulatedTime ? `<span>Played: ${formatDuration(game.accumulatedTime)}</span>` : ''}
        </div>
      </div>
    </div>`;
}

function sortGamesBy(entries, sortOption = 'newest') {
  const sorted = [...entries];
  const getTimestamp = ({ game }) => {
    const parsed = game.timestamp ? Date.parse(game.timestamp) : NaN;
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  const getHighScore = ({ game }) => {
    const finalScore = game.finalScore || {};
    const usScore = Number(finalScore.us) || 0;
    const demScore = Number(finalScore.dem) || 0;
    return Math.max(usScore, demScore);
  };

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
// --- Statistics Modal Rendering ---
const STATS_METRIC_CONFIG = {
  netPerGame: {
    label: 'Net/G',
    long: 'Net / Game',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 17l6-6 4 4 8-8"/><path stroke-linecap="round" stroke-linejoin="round" d="M14 7h7v7"/></svg>',
  },
  bidMakePct: {
    label: 'Bid Make',
    long: 'Bid Make %',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18z"/></svg>',
  },
  setsForced: {
    label: 'Sets',
    long: 'Sets Forced',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z"/><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4"/></svg>',
  },
  comebacks: {
    label: 'Comebacks',
    long: 'Comeback Wins',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v6h6"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 17a9 9 0 00-15.5-6.2L3 13"/></svg>',
  },
  closeWins: {
    label: 'Close Wins',
    long: 'Close Wins',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18z"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 7v5l3 3"/></svg>',
  },
  perfect360s: {
    label: '360s',
    long: 'Perfect 360s',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.05 10.1c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>',
  },
  games: {
    label: 'Games',
    long: 'Games Played',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>',
  },
};

const STATS_SORT_ORDER = ['recent', 'most', 'least'];
const STATS_SORT_CONFIG = {
  recent: { label: 'Recent', icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' },
  most: { label: 'Most', icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>' },
  least: { label: 'Least', icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>' },
};

function parseStatNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeStatSide(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return raw === 'us' || raw === 'dem' ? raw : '';
}

function getOpponentSide(side) {
  return side === 'us' ? 'dem' : 'us';
}

function getSideValue(side, usValue, demValue) {
  return side === 'us' ? usValue : demValue;
}

function formatStatNumber(value, options = {}) {
  const {
    minimumFractionDigits = 0,
    maximumFractionDigits = 0,
    fallback = 'N/A',
  } = options;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num.toLocaleString([], { minimumFractionDigits, maximumFractionDigits });
}

function formatSignedStat(value, options = {}) {
  const { maximumFractionDigits = 0, fallback = 'N/A' } = options;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num === 0) return '0';
  return `${num > 0 ? '+' : ''}${formatStatNumber(num, { maximumFractionDigits })}`;
}

function formatPercentStat(value, fallback = 'N/A') {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return `${num.toFixed(1)}%`;
}

function getMetricSortValue(item, metricKey) {
  switch (metricKey) {
    case 'games': return item.gamesPlayed;
    case 'netPerGame': return item.netPerGame;
    case 'bidMakePct': return item.bidMakePct;
    case 'setsForced': return item.setsForced;
    case 'comebacks': return item.comebackWins;
    case 'closeWins': return item.closeWins;
    case 'perfect360s': return item.perfect360s;
    default: return null;
  }
}

function sortStatisticsData(statsData, sortKey, metricKey) {
  if (!Array.isArray(statsData)) return [];
  const sorted = [...statsData];
  const nameKey = (item) => (item.name || '').toLowerCase();

  if (sortKey === 'recent') {
    sorted.sort((a, b) => {
      const diff = (b.lastPlayed || 0) - (a.lastPlayed || 0);
      if (diff !== 0) return diff;
      return nameKey(a).localeCompare(nameKey(b));
    });
    return sorted;
  }

  const direction = sortKey === 'least' ? 1 : -1;
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

function getEntityInitials(displayName, players) {
  if (Array.isArray(players) && players.length) {
    const initials = players
      .map(p => sanitizePlayerName(p))
      .filter(Boolean)
      .map(p => p.charAt(0).toUpperCase())
      .slice(0, 2);
    if (initials.length) return initials.join('');
  }
  const cleaned = (displayName || '').trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/[\s&/+,]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function getWinPctTier(percent) {
  const value = Number(typeof percent === 'string' ? percent.replace('%', '') : percent);
  if (!Number.isFinite(value)) return 'neutral';
  if (value >= 60) return 'high';
  if (value >= 40) return 'mid';
  return 'low';
}

function getMetricDisplay(metricKey, item) {
  switch (metricKey) {
    case 'games': return String(item.gamesPlayed ?? 0);
    case 'netPerGame': return formatSignedStat(item.netPerGame);
    case 'bidMakePct': return formatPercentStat(item.bidMakePct);
    case 'setsForced': return String(item.setsForced ?? 0);
    case 'comebacks': return String(item.comebackWins ?? 0);
    case 'closeWins': return String(item.closeWins ?? 0);
    case 'perfect360s': return String(item.perfect360s ?? 0);
    default: return '0';
  }
}

function getStatsSubline(mode, item, displayName) {
  const playersDisplay = mode === 'teams' ? formatTeamDisplay(item.players || []) : '';
  const record = `${item.wins ?? 0}-${item.losses ?? 0}`;
  const net = `${formatSignedStat(item.netPerGame)}/g`;
  if (mode === 'teams' && playersDisplay && playersDisplay !== displayName) {
    return `${playersDisplay} | ${record}`;
  }
  return `${record} | ${net}`;
}

function getTopStatItem(data, metricKey, predicate = null) {
  if (!Array.isArray(data) || !data.length) return null;
  const candidates = predicate ? data.filter(predicate) : data;
  return candidates
    .filter(item => Number.isFinite(getMetricSortValue(item, metricKey)))
    .sort((a, b) => {
      const diff = getMetricSortValue(b, metricKey) - getMetricSortValue(a, metricKey);
      if (diff !== 0) return diff;
      return (b.gamesPlayed || 0) - (a.gamesPlayed || 0);
    })[0] || null;
}

function buildStatsSpotlightCards(stats, mode) {
  const data = mode === 'players' ? stats.playersData : stats.teamsData;
  if (!data || !data.length) return '';

  const bestRecord = getTopStatItem(data, 'games', item => item.winPercentNumber >= 0)
    ? [...data].sort((a, b) => {
        const pctDiff = (b.winPercentNumber || 0) - (a.winPercentNumber || 0);
        if (pctDiff !== 0) return pctDiff;
        return (b.gamesPlayed || 0) - (a.gamesPlayed || 0);
      })[0]
    : null;
  const bestNet = getTopStatItem(data, 'netPerGame');
  const bidBoss = getTopStatItem(data, 'bidMakePct', item => (item.bidAttempts || 0) > 0);
  const pressure = getTopStatItem(data, 'setsForced');

  const cards = [
    {
      label: 'Best Record',
      item: bestRecord,
      value: bestRecord?.name || 'N/A',
      meta: bestRecord ? `${bestRecord.winPercent}% | ${bestRecord.wins}-${bestRecord.losses}` : 'No games',
      tone: 'blue',
    },
    {
      label: 'Point Swing',
      item: bestNet,
      value: bestNet?.name || 'N/A',
      meta: bestNet ? `${formatSignedStat(bestNet.netPerGame)}/game` : 'No scores',
      tone: 'purple',
    },
    {
      label: 'Bid Boss',
      item: bidBoss,
      value: bidBoss?.name || 'N/A',
      meta: bidBoss ? `${formatPercentStat(bidBoss.bidMakePct)} on ${bidBoss.bidAttempts} bids` : 'No bids',
      tone: 'green',
    },
    {
      label: 'Pressure',
      item: pressure,
      value: pressure?.name || 'N/A',
      meta: pressure ? `${pressure.setsForced} set${pressure.setsForced === 1 ? '' : 's'} forced` : 'No sets',
      tone: 'amber',
    },
  ];

  return `
    <div class="stats-spotlight-grid" aria-label="${escapeAttribute(mode === 'players' ? 'Player leaders' : 'Team leaders')}">
      ${cards.map(card => `
        <div class="stats-spotlight-card stats-spotlight-card--${card.tone}">
          <span class="stats-spotlight-card__label">${escapeHtmlValue(card.label)}</span>
          <span class="stats-spotlight-card__value">${escapeHtmlValue(card.value)}</span>
          <span class="stats-spotlight-card__meta">${escapeHtmlValue(card.meta)}</span>
        </div>`).join('')}
    </div>`;
}

function renderStatisticsContent() {
  const stats = getStatistics();
  const contentEl = document.getElementById("statisticsModalContent");
  if (!contentEl) return;
  const footerEl = document.getElementById("statisticsModalFooter");
  if (footerEl) {
    footerEl.innerHTML = "";
    footerEl.classList.add("hidden");
  }

  if (!stats.totalGames && !stats.teamsData.length) {
    contentEl.innerHTML = `
      <div class="stats-empty">
        <span class="stats-empty__icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
        </span>
        <h3 class="stats-empty__title">No stats yet</h3>
        <p class="stats-empty__body">Play a few games and your team and player performance will appear here.</p>
        <button type="button" onclick="handleNewGame(); closeMenuOverlay(); closeStatisticsModal();" class="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-lg shadow-sm transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14m-7-7h14"/></svg>
          Start a Game
        </button>
      </div>`;
    return;
  }

  const segmented = `
    <div class="stats-segmented" role="tablist" aria-label="Statistics view">
      <button type="button" class="stats-segmented__option" role="tab" data-stats-view="teams" aria-pressed="${statsViewMode === 'teams'}" aria-selected="${statsViewMode === 'teams'}">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
        Teams
      </button>
      <button type="button" class="stats-segmented__option" role="tab" data-stats-view="players" aria-pressed="${statsViewMode === 'players'}" aria-selected="${statsViewMode === 'players'}">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
        Players
      </button>
    </div>`;

  const chips = Object.entries(STATS_METRIC_CONFIG).map(([key, conf]) => `
    <button type="button" class="stats-chip" data-stats-metric="${escapeAttribute(key)}" aria-pressed="${statsMetricKey === key}">
      ${conf.icon}
      <span>${escapeHtmlValue(conf.label)}</span>
    </button>`).join('');

  const sortConf = STATS_SORT_CONFIG[statsSortKey] || STATS_SORT_CONFIG.recent;
  const filterRow = `
    <div class="stats-filter-row">
      <div class="stats-chip-rail-wrap" aria-label="Metric filter">
        <div class="stats-chip-rail" role="tablist">${chips}</div>
      </div>
      <button type="button" class="stats-sort-toggle" id="statsSortToggle" aria-label="Cycle sort: currently ${escapeAttribute(sortConf.label)}">
        <span class="stats-sort-toggle__icon">${sortConf.icon}</span>
        <span>${escapeHtmlValue(sortConf.label)}</span>
      </button>
    </div>`;

  const controlsBlock = `<div class="stats-controls bg-white dark:bg-gray-800">${segmented}${filterRow}</div>`;

  const statsDataForMode = statsViewMode === 'teams' ? stats.teamsData : stats.playersData;
  const sortedStats = sortStatisticsData(statsDataForMode, statsSortKey, statsMetricKey);
  const tableHtml = renderStatsTable(statsViewMode, sortedStats, statsMetricKey);
  const spotlightHtml = buildStatsSpotlightCards(stats, statsViewMode);

  contentEl.innerHTML = `${controlsBlock}${spotlightHtml}<div id="teamStatsTableWrapper" class="stats-results">${tableHtml}</div>`;

  if (footerEl && stats.totalGames > 0) {
    footerEl.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card kpi-card--blue">
          <span class="kpi-card__accent"></span>
          <span class="kpi-card__label">Games</span>
          <span class="kpi-card__value">${escapeHtmlValue(String(stats.totalGames))}</span>
        </div>
        <div class="kpi-card kpi-card--purple">
          <span class="kpi-card__accent"></span>
          <span class="kpi-card__label">Avg Margin</span>
          <span class="kpi-card__value">${escapeHtmlValue(formatStatNumber(stats.averageMargin))}</span>
        </div>
        <div class="kpi-card kpi-card--green">
          <span class="kpi-card__accent"></span>
          <span class="kpi-card__label">Bid Make</span>
          <span class="kpi-card__value">${escapeHtmlValue(formatPercentStat(stats.overallBidMakePct))}</span>
        </div>
        <div class="kpi-card kpi-card--amber">
          <span class="kpi-card__accent"></span>
          <span class="kpi-card__label">Sets</span>
          <span class="kpi-card__value">${escapeHtmlValue(String(stats.totalSetsForced))}</span>
        </div>
      </div>`;
    footerEl.classList.remove("hidden");
  }

  bindStatsControlHandlers();
  ensureStatisticsEntityInteraction();
}

function bindStatsControlHandlers() {
  document.querySelectorAll('[data-stats-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-stats-view') === 'players' ? 'players' : 'teams';
      if (next === statsViewMode) return;
      statsViewMode = next;
      renderStatisticsContent();
    });
  });

  document.querySelectorAll('[data-stats-metric]').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-stats-metric');
      if (!next || next === statsMetricKey) return;
      statsMetricKey = next;
      const latest = getStatistics();
      const data = statsViewMode === 'players' ? latest.playersData : latest.teamsData;
      const sorted = sortStatisticsData(data, statsSortKey, statsMetricKey);
      const wrapper = document.getElementById('teamStatsTableWrapper');
      if (wrapper) wrapper.innerHTML = renderStatsTable(statsViewMode, sorted, statsMetricKey);
      document.querySelectorAll('[data-stats-metric]').forEach(el => {
        el.setAttribute('aria-pressed', String(el.getAttribute('data-stats-metric') === statsMetricKey));
      });
      ensureStatisticsEntityInteraction();
    });
  });

  const sortToggle = document.getElementById('statsSortToggle');
  if (sortToggle) {
    sortToggle.addEventListener('click', () => {
      const idx = STATS_SORT_ORDER.indexOf(statsSortKey);
      const nextIdx = idx === -1 ? 0 : (idx + 1) % STATS_SORT_ORDER.length;
      statsSortKey = STATS_SORT_ORDER[nextIdx];
      renderStatisticsContent();
    });
  }
}

function ensureStatisticsEntityInteraction() {
  const container = document.getElementById("statisticsModalContent");
  if (!container || container.dataset.entityClickBound === 'true') return;
  container.addEventListener('click', handleStatisticsEntityClick);
  container.addEventListener('keydown', handleStatisticsEntityKeydown);
  container.dataset.entityClickBound = 'true';
}

function handleStatisticsEntityClick(event) {
  const trigger = event.target.closest('.stats-entity-trigger');
  if (!trigger) return;
  event.preventDefault();
  triggerEntityStatistics(trigger);
}

function handleStatisticsEntityKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const trigger = event.target.closest('.stats-entity-trigger');
  if (!trigger) return;
  if (trigger.tagName === 'BUTTON') return;
  event.preventDefault();
  triggerEntityStatistics(trigger);
}

function triggerEntityStatistics(trigger) {
  const mode = trigger.getAttribute('data-entity-mode');
  const key = trigger.getAttribute('data-entity-key');
  if (!mode || !key) return;
  openEntityStatisticsModal(mode, key);
}

function openEntityStatisticsModal(mode, entityKey) {
  const normalizedMode = mode === 'players' ? 'players' : 'teams';
  const stats = getStatistics();
  const collection = normalizedMode === 'players' ? stats.playersData : stats.teamsData;
  const entity = collection.find(item => item.key === entityKey);
  if (!entity) return;
  renderEntityStatisticsContent(normalizedMode, entity);
  openModal('entityStatisticsModal');
}

function closeEntityStatisticsModal() {
  closeModal('entityStatisticsModal');
  const container = document.getElementById('entityStatisticsModalContent');
  if (container) container.innerHTML = '';
}

function renderEntityStatisticsContent(mode, entity) {
  const container = document.getElementById('entityStatisticsModalContent');
  if (!container) return;
  const titleEl = document.getElementById('entityStatisticsModalTitle');
  if (titleEl) {
    titleEl.textContent = mode === 'players' ? 'Player Stats' : 'Team Stats';
  }

  const displayName = entity.name || (mode === 'teams'
    ? deriveTeamDisplay(entity.players, 'Unnamed Team')
    : sanitizePlayerName(entity.name) || 'Unnamed Player');
  const playersDisplay = mode === 'teams' ? formatTeamDisplay(entity.players || []) : '';
  const initials = getEntityInitials(displayName, mode === 'teams' ? entity.players : null);
  const winPctRaw = Number(entity.winPercent);
  const winPct = Number.isFinite(winPctRaw) ? winPctRaw : 0;
  const winTier = getWinPctTier(entity.winPercent);
  const wlRecord = `${entity.wins ?? 0}-${entity.losses ?? 0}`;

  const formatNumber = (val) => (typeof val === 'number' && Number.isFinite(val)) ? val.toLocaleString() : val;

  const subline = mode === 'teams' && playersDisplay && playersDisplay !== displayName
    ? `<p class="entity-hero__sub">${escapeHtmlValue(playersDisplay)} | ${escapeHtmlValue(wlRecord)} record</p>`
    : `<p class="entity-hero__sub">${mode === 'teams' ? 'Team' : 'Player'} | ${escapeHtmlValue(wlRecord)} record</p>`;

  const quickStats = [
    { label: 'Games', value: formatNumber(entity.gamesPlayed ?? 0) },
    { label: 'Net/G', value: formatSignedStat(entity.netPerGame) },
    { label: 'Bid Make', value: formatPercentStat(entity.bidMakePct) },
    { label: 'Sets', value: formatNumber(entity.setsForced ?? 0) },
  ].map(card => `
    <div class="entity-quickstat">
      <span class="entity-quickstat__label">${escapeHtmlValue(card.label)}</span>
      <span class="entity-quickstat__value">${escapeHtmlValue(card.value)}</span>
    </div>`).join('');

  const sections = [
    {
      title: 'Performance',
      rows: [
        { label: 'Wins', value: formatNumber(entity.wins ?? 0) },
        { label: 'Losses', value: formatNumber(entity.losses ?? 0) },
        { label: 'Win %', value: `${entity.winPercent ?? '0.0'}%` },
        { label: 'Avg Score', value: formatStatNumber(entity.avgScore) },
        { label: 'Avg Margin', value: formatSignedStat(entity.netPerGame) },
        { label: 'Round Win %', value: formatPercentStat(entity.roundWinPct) },
      ],
    },
    {
      title: 'Bidding',
      rows: [
        { label: mode === 'players' ? 'Team Bids' : 'Bids', value: formatNumber(entity.bidAttempts ?? 0) },
        { label: 'Bids Made', value: formatNumber(entity.bidsMade ?? 0) },
        { label: 'Bid Make %', value: formatPercentStat(entity.bidMakePct) },
        { label: 'Average Bid', value: entity.avgBid ?? 'N/A' },
        { label: 'Avg Over Bid', value: formatSignedStat(entity.avgBidMargin) },
        { label: 'Bid Sets', value: formatNumber(entity.bidsSet ?? 0) },
      ],
    },
    {
      title: 'Highlights',
      rows: [
        { label: 'Sets Forced', value: formatNumber(entity.setsForced ?? 0) },
        { label: 'Perfect 360s', value: formatNumber(entity.perfect360s ?? 0) },
        { label: 'Comeback Wins', value: formatNumber(entity.comebackWins ?? 0) },
        { label: 'Close Wins', value: formatNumber(entity.closeWins ?? 0) },
        { label: 'Best Score', value: formatStatNumber(entity.bestScore) },
      ],
    },
    {
      title: 'Activity',
      rows: [
        { label: 'Total Time', value: entity.totalTimeMs ? formatDuration(entity.totalTimeMs) : 'N/A' },
        { label: 'Avg Game Time', value: entity.avgGameTimeMs ? formatDuration(entity.avgGameTimeMs) : 'N/A' },
        { label: 'Last Played', value: entity.lastPlayed ? formatTimestamp(entity.lastPlayed) : 'Unknown' },
      ],
    },
  ];

  const sectionsHtml = sections.map(section => `
    <div class="entity-section">
      <p class="entity-section__title">${escapeHtmlValue(section.title)}</p>
      <dl class="entity-section__list">
        ${section.rows.map(row => `
          <div class="entity-section__row">
            <dt class="entity-section__label">${escapeHtmlValue(row.label)}</dt>
            <dd class="entity-section__value">${row.raw ? row.value : escapeHtmlValue(String(row.value))}</dd>
          </div>`).join('')}
      </dl>
    </div>`).join('');

  container.innerHTML = `
    <div class="entity-detail">
      <section class="entity-hero">
        <span class="stats-initials stats-initials--lg" aria-hidden="true">${escapeHtmlValue(initials)}</span>
        <div class="entity-hero__text">
          <h3 class="entity-hero__name">${escapeHtmlValue(displayName)}</h3>
          ${subline}
        </div>
        <div class="entity-hero__win">
          <span class="entity-hero__win-label">Win Rate</span>
          <span class="entity-hero__win-value win-tier-${winTier}">${escapeHtmlValue(String(entity.winPercent ?? '0.0'))}%</span>
          <span class="entity-hero__win-bar" aria-hidden="true">
            <span class="entity-hero__win-bar-fill" style="--win-pct: ${Math.max(0, Math.min(100, winPct))}%;"></span>
          </span>
        </div>
      </section>
      <div class="entity-quickstats">
        ${quickStats}
      </div>
      <div class="entity-sections">
        ${sectionsHtml}
      </div>
    </div>`;
}
function getStatistics() {
  const savedGamesRaw = localStorage.getItem("savedGames") || "";
  if (STATS_RESULT_CACHE.key === savedGamesRaw && STATS_RESULT_CACHE.value) {
    return STATS_RESULT_CACHE.value;
  }

  const savedGames = getLocalStorage("savedGames", []).filter(g => g && Array.isArray(g.rounds) && g.rounds.length > 0);

  const teamStatsMap = new Map();
  const playerStatsMap = new Map();
  let totalBidAttempts = 0;
  let totalBidsMade = 0;
  let totalBidAmount = 0;
  let totalSetsForced = 0;
  let totalPerfect360s = 0;
  let totalRounds = 0;
  let totalAbsoluteMargin = 0;
  let totalGameDuration = 0;

  const createStatsRecord = (base) => ({
    ...base,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalPointsFor: 0,
    totalPointsAgainst: 0,
    bidAttempts: 0,
    bidsMade: 0,
    bidsSet: 0,
    totalBidAmount: 0,
    bidMarginTotal: 0,
    roundsPlayed: 0,
    roundsWon: 0,
    setsForced: 0,
    perfect360s: 0,
    comebackWins: 0,
    closeWins: 0,
    closeLosses: 0,
    bestScore: null,
    highestBidMade: null,
    lastPlayed: 0,
    totalTimeMs: 0,
  });

  const ensureTeamRecord = (key, players, displayName, timestampMs) => {
    if (!key) return null;
    if (!teamStatsMap.has(key)) {
      teamStatsMap.set(key, createStatsRecord({
        key,
        name: displayName,
        players,
      }));
    }
    const record = teamStatsMap.get(key);
    if (timestampMs && timestampMs > record.lastPlayed) record.lastPlayed = timestampMs;
    if (!record.name) record.name = displayName;
    record.players = canonicalizePlayers(record.players.length ? record.players : players);
    return record;
  };

  const ensurePlayerRecord = (name, timestampMs) => {
    const cleanName = sanitizePlayerName(name);
    if (!cleanName) return null;
    const key = cleanName.toLowerCase();
    if (!playerStatsMap.has(key)) {
      playerStatsMap.set(key, createStatsRecord({
        key,
        name: cleanName,
      }));
    }
    const record = playerStatsMap.get(key);
    if (timestampMs && timestampMs > record.lastPlayed) record.lastPlayed = timestampMs;
    return record;
  };

  const updateRecordGroup = (records, updater) => {
    records.filter(Boolean).forEach(updater);
  };

  savedGames.forEach(game => {
    const gameDuration = Math.max(0, parseStatNumber(game.durationMs, 0));
    totalGameDuration += gameDuration;
    const parsedTimestamp = Date.parse(game.timestamp || "");
    const timestampMs = Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0;

    const usPlayers = canonicalizePlayers(game.usPlayers || parseLegacyTeamName(game.usTeamName || game.usName));
    const demPlayers = canonicalizePlayers(game.demPlayers || parseLegacyTeamName(game.demTeamName || game.demName));
    const usKey = buildTeamKey(usPlayers);
    const demKey = buildTeamKey(demPlayers);
    const usDisplay = deriveTeamDisplay(usPlayers, game.usTeamName || game.usName || 'Us') || 'Us';
    const demDisplay = deriveTeamDisplay(demPlayers, game.demTeamName || game.demName || 'Dem') || 'Dem';

    const usTeam = ensureTeamRecord(usKey, usPlayers, usDisplay, timestampMs);
    const demTeam = ensureTeamRecord(demKey, demPlayers, demDisplay, timestampMs);

    const usPlayerRecords = usPlayers.filter(Boolean).map(name => ensurePlayerRecord(name, timestampMs)).filter(Boolean);
    const demPlayerRecords = demPlayers.filter(Boolean).map(name => ensurePlayerRecord(name, timestampMs)).filter(Boolean);
    const recordsBySide = {
      us: [usTeam, ...usPlayerRecords],
      dem: [demTeam, ...demPlayerRecords],
    };

    let runningTotals = sanitizeTotals(game.startingTotals);
    const trailedBeforeEnd = {
      us: runningTotals.us < runningTotals.dem,
      dem: runningTotals.dem < runningTotals.us,
    };

    game.rounds.forEach((round, roundIndex) => {
      totalRounds++;
      const bidAmount = Math.max(0, parseStatNumber(round.bidAmount, 0));
      const bidSide = normalizeStatSide(round.biddingTeam);
      const usPoints = parseStatNumber(round.usPoints, 0);
      const demPoints = parseStatNumber(round.demPoints, 0);
      const roundTotals = round.runningTotals && typeof round.runningTotals === 'object'
        ? sanitizeTotals(round.runningTotals)
        : { us: runningTotals.us + usPoints, dem: runningTotals.dem + demPoints };

      updateRecordGroup(recordsBySide.us, rec => {
        rec.roundsPlayed++;
        if (usPoints > demPoints) rec.roundsWon++;
        if (usPoints === 360) rec.perfect360s++;
      });
      updateRecordGroup(recordsBySide.dem, rec => {
        rec.roundsPlayed++;
        if (demPoints > usPoints) rec.roundsWon++;
        if (demPoints === 360) rec.perfect360s++;
      });

      if (usPoints === 360) totalPerfect360s++;
      if (demPoints === 360) totalPerfect360s++;

      if (bidSide && bidAmount > 0) {
        const bidPoints = getSideValue(bidSide, usPoints, demPoints);
        const madeBid = bidPoints >= bidAmount;
        const opponentSide = getOpponentSide(bidSide);
        totalBidAttempts++;
        totalBidAmount += bidAmount;
        if (madeBid) totalBidsMade++;
        else totalSetsForced++;

        updateRecordGroup(recordsBySide[bidSide], rec => {
          rec.bidAttempts++;
          rec.totalBidAmount += bidAmount;
          rec.bidMarginTotal += bidPoints - bidAmount;
          if (madeBid) {
            rec.bidsMade++;
            rec.highestBidMade = Math.max(rec.highestBidMade || 0, bidAmount);
          } else {
            rec.bidsSet++;
          }
        });

        if (!madeBid) {
          updateRecordGroup(recordsBySide[opponentSide], rec => {
            rec.setsForced++;
          });
        }
      }

      if (roundIndex < game.rounds.length - 1) {
        if (roundTotals.us < roundTotals.dem) trailedBeforeEnd.us = true;
        if (roundTotals.dem < roundTotals.us) trailedBeforeEnd.dem = true;
      }
      runningTotals = roundTotals;
    });

    const finalTotals = game.finalScore ? sanitizeTotals(game.finalScore) : runningTotals;
    const winnerSide = normalizeStatSide(game.winner)
      || (finalTotals.us > finalTotals.dem ? 'us' : finalTotals.dem > finalTotals.us ? 'dem' : '');
    totalAbsoluteMargin += Math.abs(finalTotals.us - finalTotals.dem);

    ['us', 'dem'].forEach(side => {
      const pointsFor = getSideValue(side, finalTotals.us, finalTotals.dem);
      const pointsAgainst = getSideValue(side, finalTotals.dem, finalTotals.us);
      const margin = pointsFor - pointsAgainst;
      const won = winnerSide === side;
      const lost = winnerSide && winnerSide !== side;
      updateRecordGroup(recordsBySide[side], rec => {
        rec.gamesPlayed++;
        rec.totalTimeMs += gameDuration;
        rec.totalPointsFor += pointsFor;
        rec.totalPointsAgainst += pointsAgainst;
        rec.bestScore = rec.bestScore === null ? pointsFor : Math.max(rec.bestScore, pointsFor);
        if (won) {
          rec.wins++;
          if (Math.abs(margin) <= 50) rec.closeWins++;
          if (trailedBeforeEnd[side]) rec.comebackWins++;
        } else if (lost) {
          rec.losses++;
          if (Math.abs(margin) <= 50) rec.closeLosses++;
        }
      });
    });
  });

  const finalizeRecord = (record) => {
    const games = record.gamesPlayed || 0;
    const winPercentNumber = games ? (record.wins / games) * 100 : 0;
    const bidMakePct = record.bidAttempts ? (record.bidsMade / record.bidAttempts) * 100 : null;
    const roundWinPct = record.roundsPlayed ? (record.roundsWon / record.roundsPlayed) * 100 : null;
    const avgScore = games ? record.totalPointsFor / games : null;
    const avgAllowed = games ? record.totalPointsAgainst / games : null;
    const netPerGame = games ? (record.totalPointsFor - record.totalPointsAgainst) / games : 0;
    const avgBidValue = record.bidAttempts ? record.totalBidAmount / record.bidAttempts : null;
    const avgBidMargin = record.bidAttempts ? record.bidMarginTotal / record.bidAttempts : null;
    return {
      ...record,
      winPercentNumber,
      winPercent: winPercentNumber.toFixed(1),
      avgScore,
      avgAllowed,
      netPerGame,
      bidMakePct,
      bidSuccessPct: bidMakePct === null ? 'N/A' : bidMakePct.toFixed(1),
      avgBid: avgBidValue === null ? 'N/A' : formatStatNumber(avgBidValue),
      avgBidMargin,
      roundWinPct,
      avgGameTimeMs: games ? record.totalTimeMs / games : 0,
      count360: record.perfect360s,
    };
  };

  const teamsData = Array.from(teamStatsMap.values()).map(finalizeRecord).sort((a, b) => b.lastPlayed - a.lastPlayed);
  const playersData = Array.from(playerStatsMap.values()).map(finalizeRecord).sort((a, b) => b.lastPlayed - a.lastPlayed);

  const result = {
    totalGames: savedGames.length,
    totalRounds,
    overallAverageBid: totalBidAttempts > 0 ? formatStatNumber(totalBidAmount / totalBidAttempts) : 'N/A',
    overallBidMakePct: totalBidAttempts ? (totalBidsMade / totalBidAttempts) * 100 : null,
    totalBidAttempts,
    totalBidsMade,
    totalSetsForced,
    totalPerfect360s,
    averageMargin: savedGames.length ? totalAbsoluteMargin / savedGames.length : 0,
    teamsData,
    playersData,
    totalTimePlayedMs: totalGameDuration,
  };
  STATS_RESULT_CACHE.key = savedGamesRaw;
  STATS_RESULT_CACHE.value = result;
  return result;
}
function renderStatsTable(mode, statsData, additionalStatKey) {
  const metricConf = STATS_METRIC_CONFIG[additionalStatKey] || { label: 'Stat', long: 'Stat' };
  const nameHeader = mode === 'teams' ? 'Team' : 'Player';

  if (!statsData || !statsData.length) {
    const emptyLabel = mode === 'teams' ? 'No team stats yet.' : 'No individual stats yet.';
    return `<p class="stats-results__empty">${emptyLabel}</p>`;
  }

  const cards = statsData.map(item => buildStatsRowCard(mode, item, additionalStatKey)).join('');
  const tableRows = statsData.map((item) => buildStatsTableRow(mode, item, additionalStatKey)).join('');

  return `
    <div class="stats-cards-view stats-rows" role="list" aria-label="${escapeAttribute(nameHeader + ' statistics')}">
      ${cards}
    </div>
    <div class="stats-table-view">
      <div class="stats-table-shell">
        <table class="stats-table min-w-full">
          <thead>
            <tr>
              <th scope="col" class="stats-table__th-name">${escapeHtmlValue(nameHeader)}</th>
              <th scope="col" class="stats-table__th">Win %</th>
              <th scope="col" class="stats-table__th">${escapeHtmlValue(metricConf.long)}</th>
              <th scope="col" class="stats-table__th-icon" aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>`;
}

function buildStatsRowCard(mode, item, additionalStatKey) {
  const metricConf = STATS_METRIC_CONFIG[additionalStatKey] || { label: 'Stat', long: 'Stat' };
  const entityKey = item.key;
  const displayName = item.name || (mode === 'teams'
    ? deriveTeamDisplay(item.players, 'Unnamed Team')
    : sanitizePlayerName(item.name) || 'Unnamed Player');
  const playersDisplay = mode === 'teams' ? formatTeamDisplay(item.players || []) : '';
  const initials = getEntityInitials(displayName, mode === 'teams' ? item.players : null);
  const winPctRaw = Number(item.winPercent);
  const winPct = Number.isFinite(winPctRaw) ? winPctRaw : 0;
  const winTier = getWinPctTier(item.winPercent);
  const metricVal = getMetricDisplay(additionalStatKey, item);
  const subline = `<span class="stats-row-card__sub">${escapeHtmlValue(getStatsSubline(mode, item, displayName))}</span>`;

  return `
    <button type="button"
      class="stats-row-card stats-entity-trigger"
      data-entity-mode="${escapeAttribute(mode)}"
      data-entity-key="${escapeAttribute(entityKey)}"
      aria-haspopup="dialog"
      role="listitem">
      <span class="stats-row-card__main">
        <span class="stats-initials" aria-hidden="true">${escapeHtmlValue(initials)}</span>
        <span class="stats-row-card__title">
          <span class="stats-row-card__name">${escapeHtmlValue(displayName)}</span>
          ${subline}
        </span>
      </span>
      <span class="stats-row-card__metrics">
        <span class="win-chip win-chip--${winTier}" aria-label="Win percent ${escapeAttribute(String(winPct))} percent">
          <span class="win-chip__bar" style="--win-pct: ${Math.max(0, Math.min(100, winPct))}%;"></span>
          <span class="win-chip__value">${escapeHtmlValue(String(item.winPercent))}%</span>
        </span>
        <span class="stats-row-card__metric">
          <span class="stats-row-card__metric-label">${escapeHtmlValue(metricConf.label)}</span>
          <span class="stats-row-card__metric-value">${escapeHtmlValue(metricVal)}</span>
        </span>
        <span class="stats-row-card__chevron" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
        </span>
      </span>
    </button>`;
}

function buildStatsTableRow(mode, item, additionalStatKey) {
  const entityKey = item.key;
  const displayName = item.name || (mode === 'teams'
    ? deriveTeamDisplay(item.players, 'Unnamed Team')
    : sanitizePlayerName(item.name) || 'Unnamed Player');
  const playersDisplay = mode === 'teams' ? formatTeamDisplay(item.players || []) : '';
  const initials = getEntityInitials(displayName, mode === 'teams' ? item.players : null);
  const winPctRaw = Number(item.winPercent);
  const winPct = Number.isFinite(winPctRaw) ? winPctRaw : 0;
  const winTier = getWinPctTier(item.winPercent);
  const metricVal = getMetricDisplay(additionalStatKey, item);
  const subline = `<span class="stats-table__sub">${escapeHtmlValue(getStatsSubline(mode, item, displayName))}</span>`;

  return `
    <tr class="stats-table__row stats-entity-trigger"
      data-entity-mode="${escapeAttribute(mode)}"
      data-entity-key="${escapeAttribute(entityKey)}"
      tabindex="0"
      role="button"
      aria-haspopup="dialog">
      <td class="stats-table__td-name">
        <span class="stats-initials" aria-hidden="true">${escapeHtmlValue(initials)}</span>
        <span class="stats-table__name-block">
          <span class="stats-table__name">${escapeHtmlValue(displayName)}</span>
          ${subline}
        </span>
      </td>
      <td class="stats-table__td">
        <span class="win-chip win-chip--${winTier}">
          <span class="win-chip__bar" style="--win-pct: ${Math.max(0, Math.min(100, winPct))}%;"></span>
          <span class="win-chip__value">${escapeHtmlValue(String(item.winPercent))}%</span>
        </span>
      </td>
      <td class="stats-table__td"><span class="stats-table__metric">${escapeHtmlValue(metricVal)}</span></td>
      <td class="stats-table__td-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
      </td>
    </tr>`;
}
