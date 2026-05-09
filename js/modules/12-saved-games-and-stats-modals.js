"use strict";

// --- Saved Games Modal (New Functions) ---
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
function filterGames() { renderGamesWithFilter(); }
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
function detectSandbag(rounds, winner, threshold = 2) { /* Placeholder */ return "N/A"; }

function sortStatisticsData(statsData, sortKey, metricKey) {
  if (!Array.isArray(statsData)) return [];
  const sorted = [...statsData];
  const normalizeNumber = (value) => {
    const num = typeof value === 'string' ? Number(value.replace('%', '').trim()) : Number(value);
    return Number.isFinite(num) ? num : null;
  };
  const getMetricValue = (item) => {
    switch (metricKey) {
      case 'games':
        return item.gamesPlayed;
      case 'timePlayed':
        return item.totalTimeMs;
      case 'avgBid':
        return normalizeNumber(item.avgBid);
      case 'bidSuccessPct':
        return normalizeNumber(item.bidSuccessPct);
      case 'sandbagger':
        return item.sandbagger === 'Yes' ? 1 : 0;
      case '360s':
        return item.count360;
      default:
        return null;
    }
  };
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
    const aVal = getMetricValue(a);
    const bVal = getMetricValue(b);
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
// --- Statistics Modal Rendering ---
const STATS_METRIC_CONFIG = {
  games: {
    label: 'Games',
    long: 'Games Played',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>',
  },
  timePlayed: {
    label: 'Time',
    long: 'Time Played',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
  },
  avgBid: {
    label: 'Avg Bid',
    long: 'Average Bid',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V6m0 12v2m9-9a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
  },
  bidSuccessPct: {
    label: 'Bid Win %',
    long: 'Bid Success Rate',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
  },
  sandbagger: {
    label: 'Sandbag',
    long: 'Sandbagger',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z"/></svg>',
  },
  '360s': {
    label: '360s',
    long: 'Perfect 360s',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.05 10.1c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>',
  },
};

const STATS_SORT_ORDER = ['recent', 'most', 'least'];
const STATS_SORT_CONFIG = {
  recent: { label: 'Recent', icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' },
  most: { label: 'Most', icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>' },
  least: { label: 'Least', icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>' },
};

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
    case '360s': return String(item.count360 ?? 0);
    case 'avgBid': return item.avgBid ?? 'N/A';
    case 'bidSuccessPct':
      return item.bidSuccessPct === 'N/A' || item.bidSuccessPct === undefined
        ? 'N/A'
        : `${item.bidSuccessPct}%`;
    case 'sandbagger': return item.sandbagger ?? 'No';
    case 'timePlayed': return formatDuration(item.totalTimeMs ?? 0);
    default: return '0';
  }
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
        Individuals
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

  contentEl.innerHTML = `${controlsBlock}<div id="teamStatsTableWrapper" class="stats-results">${tableHtml}</div>`;

  if (footerEl && stats.totalGames > 0) {
    footerEl.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card kpi-card--blue">
          <span class="kpi-card__accent"></span>
          <span class="kpi-card__label">Avg Bid</span>
          <span class="kpi-card__value">${escapeHtmlValue(stats.overallAverageBid)}</span>
        </div>
        <div class="kpi-card kpi-card--purple">
          <span class="kpi-card__accent"></span>
          <span class="kpi-card__label">Time Played</span>
          <span class="kpi-card__value">${escapeHtmlValue(formatDuration(stats.totalTimePlayedMs))}</span>
        </div>
        <div class="kpi-card kpi-card--green">
          <span class="kpi-card__accent"></span>
          <span class="kpi-card__label">Games</span>
          <span class="kpi-card__value">${escapeHtmlValue(String(stats.totalGames))}</span>
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
  const wlRecord = `${entity.wins ?? 0}–${entity.losses ?? 0}`;

  const formatNumber = (val) => (typeof val === 'number' && Number.isFinite(val)) ? val.toLocaleString() : val;
  const sandbagBadge = (entity.sandbagger === 'Yes')
    ? '<span class="entity-badge--yes">Yes</span>'
    : '<span class="entity-badge--no">No</span>';

  const subline = mode === 'teams' && playersDisplay && playersDisplay !== displayName
    ? `<p class="entity-hero__sub">${escapeHtmlValue(playersDisplay)}</p>`
    : `<p class="entity-hero__sub">${mode === 'teams' ? 'Team' : 'Player'} · ${escapeHtmlValue(wlRecord)} record</p>`;

  const quickStats = [
    { label: 'Games', value: formatNumber(entity.gamesPlayed ?? 0) },
    { label: 'Win %', value: `${entity.winPercent ?? '0.0'}%` },
    { label: 'Time', value: entity.totalTimeMs ? formatDuration(entity.totalTimeMs) : '—' },
    { label: '360s', value: formatNumber(entity.count360 ?? 0) },
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
        { label: 'Hands Played', value: formatNumber(entity.handsPlayed ?? 0) },
        { label: 'Hands Won', value: formatNumber(entity.handsWon ?? 0) },
      ],
    },
    {
      title: 'Bidding',
      rows: [
        { label: 'Average Bid', value: entity.avgBid ?? 'N/A' },
        { label: 'Bids Made', value: formatNumber(entity.bidsMade ?? 0) },
        { label: 'Bids Succeeded', value: formatNumber(entity.bidsSucceeded ?? 0) },
        { label: 'Bid Success %', value: entity.bidSuccessPct === 'N/A' || entity.bidSuccessPct === undefined ? 'N/A' : `${entity.bidSuccessPct}%` },
        { label: 'Total Bid Amount', value: formatNumber(entity.totalBidAmount ?? 0) },
      ],
    },
    {
      title: 'Highlights',
      rows: [
        { label: 'Perfect 360s', value: formatNumber(entity.count360 ?? 0) },
        { label: 'Sandbag Games', value: formatNumber(entity.sandbagGames ?? 0) },
        { label: 'Sandbagger', value: sandbagBadge, raw: true },
      ],
    },
    {
      title: 'Activity',
      rows: [
        { label: 'Total Time', value: entity.totalTimeMs ? formatDuration(entity.totalTimeMs) : 'N/A' },
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
  const savedGames = getLocalStorage("savedGames", []).filter(g => g && Array.isArray(g.rounds) && g.rounds.length > 0);

  const teamStatsMap = new Map();
  const playerStatsMap = new Map();
  let totalBids = 0;
  let sumOfBids = 0;
  let totalGameDuration = 0;

  const ensureTeamRecord = (key, players, displayName, timestampMs) => {
    if (!key) return null;
    if (!teamStatsMap.has(key)) {
      teamStatsMap.set(key, {
        key,
        name: displayName,
        players,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        totalBidAmount: 0,
        bidsMade: 0,
        bidsSucceeded: 0,
        handsPlayed: 0,
        handsWon: 0,
        sandbagGames: 0,
        perfect360s: 0,
        lastPlayed: 0,
        totalTimeMs: 0,
      });
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
      playerStatsMap.set(key, {
        key,
        name: cleanName,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        totalBidAmount: 0,
        bidsMade: 0,
        bidsSucceeded: 0,
        handsPlayed: 0,
        handsWon: 0,
        sandbagGames: 0,
        perfect360s: 0,
        lastPlayed: 0,
        totalTimeMs: 0,
      });
    }
    const record = playerStatsMap.get(key);
    if (timestampMs && timestampMs > record.lastPlayed) record.lastPlayed = timestampMs;
    return record;
  };

  savedGames.forEach(game => {
    const gameDuration = Number(game.durationMs) || 0;
    totalGameDuration += gameDuration;
    const timestampMs = new Date(game.timestamp || Date.now()).getTime();

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

    if (usTeam) {
      usTeam.gamesPlayed++;
      usTeam.totalTimeMs += gameDuration;
    }
    if (demTeam) {
      demTeam.gamesPlayed++;
      demTeam.totalTimeMs += gameDuration;
    }
    usPlayerRecords.forEach(rec => {
      rec.gamesPlayed++;
      rec.totalTimeMs += gameDuration;
    });
    demPlayerRecords.forEach(rec => {
      rec.gamesPlayed++;
      rec.totalTimeMs += gameDuration;
    });

    if (game.winner === 'us') {
      if (usTeam) usTeam.wins++;
      if (demTeam) demTeam.losses++;
      usPlayerRecords.forEach(rec => rec.wins++);
      demPlayerRecords.forEach(rec => rec.losses++);
    } else if (game.winner === 'dem') {
      if (demTeam) demTeam.wins++;
      if (usTeam) usTeam.losses++;
      demPlayerRecords.forEach(rec => rec.wins++);
      usPlayerRecords.forEach(rec => rec.losses++);
    }

    game.rounds.forEach(round => {
      const bidAmount = Number(round.bidAmount) || 0;
      if (bidAmount) {
        sumOfBids += bidAmount;
        totalBids++;
      }

      const usPoints = Number(round.usPoints) || 0;
      const demPoints = Number(round.demPoints) || 0;

      if (usTeam) usTeam.handsPlayed++;
      if (demTeam) demTeam.handsPlayed++;
      usPlayerRecords.forEach(rec => rec.handsPlayed++);
      demPlayerRecords.forEach(rec => rec.handsPlayed++);

      if (usPoints > demPoints) {
        if (usTeam) usTeam.handsWon++;
        usPlayerRecords.forEach(rec => rec.handsWon++);
      } else if (demPoints > usPoints) {
        if (demTeam) demTeam.handsWon++;
        demPlayerRecords.forEach(rec => rec.handsWon++);
      }

      if (usPoints === 360) {
        if (usTeam) usTeam.perfect360s++;
        usPlayerRecords.forEach(rec => rec.perfect360s++);
      }
      if (demPoints === 360) {
        if (demTeam) demTeam.perfect360s++;
        demPlayerRecords.forEach(rec => rec.perfect360s++);
      }

      if (round.biddingTeam === 'us') {
        if (usTeam) {
          usTeam.bidsMade++;
          usTeam.totalBidAmount += bidAmount;
          if (usPoints >= bidAmount) usTeam.bidsSucceeded++;
        }
        usPlayerRecords.forEach(rec => {
          rec.bidsMade++;
          rec.totalBidAmount += bidAmount;
          if (usPoints >= bidAmount) rec.bidsSucceeded++;
        });
      } else if (round.biddingTeam === 'dem') {
        if (demTeam) {
          demTeam.bidsMade++;
          demTeam.totalBidAmount += bidAmount;
          if (demPoints >= bidAmount) demTeam.bidsSucceeded++;
        }
        demPlayerRecords.forEach(rec => {
          rec.bidsMade++;
          rec.totalBidAmount += bidAmount;
          if (demPoints >= bidAmount) rec.bidsSucceeded++;
        });
      }
    });

    const sandbagUs = isGameSandbagForTeamKey(game, usPlayers);
    const sandbagDem = isGameSandbagForTeamKey(game, demPlayers);
    if (sandbagUs) {
      if (usTeam) usTeam.sandbagGames++;
      usPlayerRecords.forEach(rec => rec.sandbagGames++);
    }
    if (sandbagDem) {
      if (demTeam) demTeam.sandbagGames++;
      demPlayerRecords.forEach(rec => rec.sandbagGames++);
    }
  });

  const teamsData = Array.from(teamStatsMap.values()).map(team => {
    const winPercent = team.gamesPlayed ? ((team.wins / team.gamesPlayed) * 100).toFixed(1) : '0.0';
    const avgBid = team.bidsMade ? (team.totalBidAmount / team.bidsMade).toFixed(0) : 'N/A';
    const bidSuccessPct = team.bidsMade ? ((team.bidsSucceeded / team.bidsMade) * 100).toFixed(1) : 'N/A';
    const sandbagger = team.gamesPlayed && (team.sandbagGames / team.gamesPlayed > 0.5) ? 'Yes' : 'No';
    return {
      ...team,
      winPercent,
      avgBid,
      bidSuccessPct,
      sandbagger,
      count360: team.perfect360s,
    };
  }).sort((a, b) => b.lastPlayed - a.lastPlayed);

  const playersData = Array.from(playerStatsMap.values()).map(player => {
    const winPercent = player.gamesPlayed ? ((player.wins / player.gamesPlayed) * 100).toFixed(1) : '0.0';
    const avgBid = player.bidsMade ? (player.totalBidAmount / player.bidsMade).toFixed(0) : 'N/A';
    const bidSuccessPct = player.bidsMade ? ((player.bidsSucceeded / player.bidsMade) * 100).toFixed(1) : 'N/A';
    const sandbagger = player.gamesPlayed && (player.sandbagGames / player.gamesPlayed > 0.5) ? 'Yes' : 'No';
    return {
      ...player,
      winPercent,
      avgBid,
      bidSuccessPct,
      sandbagger,
      count360: player.perfect360s,
    };
  }).sort((a, b) => b.lastPlayed - a.lastPlayed);

  return {
    totalGames: savedGames.length,
    overallAverageBid: totalBids > 0 ? (sumOfBids / totalBids).toFixed(0) : 'N/A',
    teamsData,
    playersData,
    totalTimePlayedMs: totalGameDuration,
  };
}

function isGameSandbagForTeamKey(game, teamPlayers, threshold = 2) {
  const teamKey = buildTeamKey(teamPlayers);
  if (!teamKey) return false;

  const gameUsKey = buildTeamKey(canonicalizePlayers(game.usPlayers || parseLegacyTeamName(game.usTeamName || game.usName)));
  const gameDemKey = buildTeamKey(canonicalizePlayers(game.demPlayers || parseLegacyTeamName(game.demTeamName || game.demName)));

  let target = null;
  let opponent = null;
  if (teamKey === gameUsKey) {
    target = 'us';
    opponent = 'dem';
  } else if (teamKey === gameDemKey) {
    target = 'dem';
    opponent = 'us';
  } else {
    return false;
  }

  let sandbagOpportunities = 0;
  (game.rounds || []).forEach(round => {
    if (round.biddingTeam === opponent && Number(round[`${opponent}Points`]) < 0) {
      const targetPoints = Number(round[`${target}Points`]) || 0;
      const bidAmount = Number(round.bidAmount) || 0;
      if (targetPoints >= 80 || targetPoints >= bidAmount) sandbagOpportunities++;
    }
  });
  return sandbagOpportunities >= threshold;
}
function renderStatsTable(mode, statsData, additionalStatKey) {
  const metricConf = STATS_METRIC_CONFIG[additionalStatKey] || { label: 'Stat', long: 'Stat' };
  const nameHeader = mode === 'teams' ? 'Team' : 'Player';

  if (!statsData || !statsData.length) {
    const emptyLabel = mode === 'teams' ? 'No team stats yet.' : 'No individual stats yet.';
    return `<p class="stats-results__empty">${emptyLabel}</p>`;
  }

  const cards = statsData.map(item => buildStatsRowCard(mode, item, additionalStatKey)).join('');
  const tableRows = statsData.map((item, index) => buildStatsTableRow(mode, item, additionalStatKey, index)).join('');

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
  const isSandbag = additionalStatKey === 'sandbagger' && metricVal === 'Yes';
  const wlRecord = `${item.wins ?? 0}–${item.losses ?? 0}`;

  const subline = mode === 'teams' && playersDisplay && playersDisplay !== displayName
    ? `<span class="stats-row-card__sub">${escapeHtmlValue(playersDisplay)}</span>`
    : `<span class="stats-row-card__sub">${escapeHtmlValue(wlRecord)} · ${item.gamesPlayed ?? 0} game${(item.gamesPlayed ?? 0) === 1 ? '' : 's'}</span>`;

  const metricBadge = isSandbag
    ? `<span class="stats-row-card__metric-value stats-row-card__metric-value--warn">Yes</span>`
    : `<span class="stats-row-card__metric-value">${escapeHtmlValue(metricVal)}</span>`;

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
          ${metricBadge}
        </span>
        <span class="stats-row-card__chevron" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
        </span>
      </span>
    </button>`;
}

function buildStatsTableRow(mode, item, additionalStatKey, index) {
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
  const isSandbag = additionalStatKey === 'sandbagger' && metricVal === 'Yes';
  const subline = mode === 'teams' && playersDisplay && playersDisplay !== displayName
    ? `<span class="stats-table__sub">${escapeHtmlValue(playersDisplay)}</span>`
    : '';

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
      <td class="stats-table__td">${
        isSandbag
          ? '<span class="entity-badge--yes">Yes</span>'
          : `<span class="stats-table__metric">${escapeHtmlValue(metricVal)}</span>`
      }</td>
      <td class="stats-table__td-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
      </td>
    </tr>`;
}
