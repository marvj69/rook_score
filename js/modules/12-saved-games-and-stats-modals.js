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

  container.innerHTML = listHtml || (!normalizedTerm ? '' : `<p class="text-gray-500 col-span-full text-center">${emptySearchMessage} "${displaySearch}".</p>`);
}

function buildSavedGameCard(game, originalIndex) {
  const usDisplay = getGameTeamDisplay(game, 'us');
  const demDisplay = getGameTeamDisplay(game, 'dem');
  const usScore = game.finalScore?.us ?? 0;
  const demScore = game.finalScore?.dem ?? 0;
  const usWon = game.winner === 'us';
  const demWon = game.winner === 'dem';
  const timestamp = game.timestamp ? new Date(game.timestamp).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown date';

  return `
    <div class="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-lg transition-shadow dark:bg-gray-800 dark:border-gray-700 cursor-pointer relative" onclick="viewSavedGame(${originalIndex})">
      ${usWon ? `<div class="absolute top-0 right-2 bg-green-100 text-green-800 text-xs font-semibold px-2 py-0.5 rounded-full dark:bg-green-900 dark:text-green-300">Winner: ${usDisplay}</div>` : ''}
      ${demWon ? `<div class="absolute top-0 right-2 bg-green-100 text-green-800 text-xs font-semibold px-2 py-0.5 rounded-full dark:bg-green-900 dark:text-green-300">Winner: ${demDisplay}</div>` : ''}
      <div class="p-5">
        <div class="flex justify-between items-start mb-2">
          <div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">${usDisplay} vs ${demDisplay}</h3>
            <div class="text-sm text-gray-500 dark:text-gray-400">${timestamp}</div>
          </div>
          <div class="flex space-x-1">
            <button onclick="viewSavedGame(${originalIndex}); event.stopPropagation();" class="p-1.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-300" aria-label="View"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg></button>
            <button onclick="deleteSavedGame(${originalIndex}); event.stopPropagation();" class="p-1.5 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 rounded-full focus:outline-none focus:ring-2 focus:ring-red-300" aria-label="Delete">${Icons.Trash}</button>
          </div>
        </div>
        <div class="text-sm">
          <span class="${usWon ? 'text-green-600 font-bold' : 'text-gray-700 dark:text-gray-300'}">${usDisplay}: ${usScore}</span> |
          <span class="${demWon ? 'text-green-600 font-bold' : 'text-gray-700 dark:text-gray-300'}">${demDisplay}: ${demScore}</span>
        </div>
        <div class="mt-2 flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
          ${game.victoryMethod ? `<span class="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full dark:bg-purple-900 dark:text-purple-300">${game.victoryMethod}</span>` : ''}
          ${game.durationMs ? `<span>${formatDuration(game.durationMs)}</span>` : ''}
        </div>
      </div>
    </div>`;
}

function buildFreezerGameCard(game, originalIndex) {
  const usDisplay = getGameTeamDisplay(game, 'us');
  const demDisplay = getGameTeamDisplay(game, 'dem');
  const usScore = game.finalScore?.us ?? 0;
  const demScore = game.finalScore?.dem ?? 0;
  const timestamp = game.timestamp ? new Date(game.timestamp).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown date';
  const leadInfo = usScore > demScore
    ? `${usDisplay} leads by ${usScore - demScore}`
    : demScore > usScore
      ? `${demDisplay} leads by ${demScore - usScore}`
      : 'Tied';

  return `
    <div class="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-lg transition-shadow dark:bg-gray-800 dark:border-gray-700 cursor-pointer relative" onclick="loadFreezerGame(${originalIndex})">
      <div class="absolute top-0 right-2 bg-yellow-100 text-yellow-800 text-xs font-semibold px-2 py-0.5 rounded-full dark:bg-yellow-900 dark:text-yellow-300">${leadInfo}</div>
      <div class="p-5">
        <div class="flex justify-between items-start mb-2">
          <div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">${usDisplay} vs ${demDisplay}</h3>
            <div class="text-sm text-gray-500 dark:text-gray-400">Frozen: ${timestamp}</div>
          </div>
          <div class="flex space-x-1">
            <button onclick="loadFreezerGame(${originalIndex}); event.stopPropagation();" class="p-1.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-300" aria-label="Load">${Icons.Load}</button>
            <button onclick="deleteFreezerGame(${originalIndex}); event.stopPropagation();" class="p-1.5 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 rounded-full focus:outline-none focus:ring-2 focus:ring-red-300" aria-label="Delete">${Icons.Trash}</button>
          </div>
        </div>
        <div class="text-sm text-gray-700 dark:text-gray-300">
          <span>${usDisplay}: ${usScore}</span> | <span>${demDisplay}: ${demScore}</span>
        </div>
        <div class="mt-2 flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
          ${game.lastBid ? `<span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full dark:bg-indigo-900 dark:text-indigo-300">Last Bid: ${game.lastBid}</span>` : ''}
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
    contentEl.innerHTML = `<div class="py-8 text-center"><svg xmlns="http://www.w3.org/2000/svg" class="h-14 w-14 mx-auto text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg><p class="mt-4 text-gray-600 dark:text-gray-400 text-lg">No stats yet. Play some games!</p><button onclick="handleNewGame(); closeMenuOverlay(); closeStatisticsModal();" class="mt-6 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm">Start New Game</button></div>`;
  } else {
    const statCard = (title, value, iconSvg, color) => `
      <div class="bg-gradient-to-br from-${color}-50 to-${color}-100 dark:from-gray-700 dark:to-gray-800 rounded-lg p-2 shadow-sm">
        <div class="flex items-center">
          <div class="p-1.5 bg-${color}-500 rounded-lg text-white">${iconSvg}</div>
          <div class="ml-2 min-w-0">
            <p class="text-xs uppercase font-semibold text-gray-500 dark:text-gray-400">${title}</p>
            <p class="text-lg font-bold text-gray-900 dark:text-white leading-tight">${value}</p>
          </div>
        </div>
      </div>`;

    const icons = {
      avgBid: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>',
      timePlayed: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      gamesPlayed: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>',
    };

    const viewSelector = `<div class="mb-4"><label for="statsViewModeSelect" class="block text-sm font-medium text-gray-700 dark:text-white mb-2">Show statistics for</label><div class="relative"><select id="statsViewModeSelect" class="appearance-none block w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg py-2.5 px-3 text-gray-700 dark:text-white leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:focus:ring-blue-400"><option value="teams"${statsViewMode === 'teams' ? ' selected' : ''}>Teams</option><option value="players"${statsViewMode === 'players' ? ' selected' : ''}>Individuals</option></select><div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 dark:text-gray-300"><svg class="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg></div></div></div>`;

    const metricOptions = ['games', 'timePlayed', 'avgBid', 'bidSuccessPct', 'sandbagger', '360s']
      .map(opt => {
        let label = '';
        switch (opt) {
          case 'games':
            label = 'Games Played';
            break;
          case 'timePlayed':
            label = 'Time Played';
            break;
          case 'avgBid':
            label = 'Avg Bid';
            break;
          case 'bidSuccessPct':
            label = 'Bid Success %';
            break;
          case 'sandbagger':
            label = 'Sandbagger?';
            break;
          default:
            label = '360s';
        }
        return `<option value="${opt}"${statsMetricKey === opt ? ' selected' : ''}>${label}</option>`;
      })
      .join('');
    const metricLabel = statsViewMode === 'teams' ? 'Team statistic' : 'Individual statistic';
    const statSelector = `<div class="mb-4"><label for="additionalStatSelector" class="block text-sm font-medium text-gray-700 dark:text-white mb-2">${metricLabel}</label><div class="relative"><select id="additionalStatSelector" class="appearance-none block w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg py-2.5 px-3 text-gray-700 dark:text-white leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:focus:ring-blue-400">${metricOptions}</select><div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 dark:text-gray-300"><svg class="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg></div></div></div>`;

    const sortSelector = `<div class="mb-2"><label for="statsSortSelect" class="block text-sm font-medium text-gray-700 dark:text-white mb-2">Sort by</label><div class="relative"><select id="statsSortSelect" class="appearance-none block w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg py-2.5 px-3 text-gray-700 dark:text-white leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:focus:ring-blue-400"><option value="recent"${statsSortKey === 'recent' ? ' selected' : ''}>Recency</option><option value="most"${statsSortKey === 'most' ? ' selected' : ''}>Most</option><option value="least"${statsSortKey === 'least' ? ' selected' : ''}>Least</option></select><div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 dark:text-gray-300"><svg class="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg></div></div></div>`;

    const statsDataForMode = statsViewMode === 'teams' ? stats.teamsData : stats.playersData;
    const sortedStats = sortStatisticsData(statsDataForMode, statsSortKey, statsMetricKey);
    const statsTableHtml = renderStatsTable(statsViewMode, sortedStats, statsMetricKey);
    const controlsBlock = `<div class="stats-controls bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">${viewSelector}${statSelector}${sortSelector}</div>`;
    const hint = `<p class="mt-3 text-xs text-gray-500 dark:text-gray-400">Tap a ${statsViewMode === 'teams' ? 'team' : 'player'} to see full details.</p>`;

    contentEl.innerHTML = `${controlsBlock}${hint}<div id="teamStatsTableWrapper" class="pb-6">${statsTableHtml}</div>`;

    if (footerEl && stats.totalGames > 0) {
      footerEl.innerHTML = `<div class="grid grid-cols-3 gap-2">
        ${statCard("Avg Bid", stats.overallAverageBid, icons.avgBid, "blue")}
        ${statCard("Time Played", formatDuration(stats.totalTimePlayedMs), icons.timePlayed, "purple")}
        ${statCard("Games Played", stats.totalGames, icons.gamesPlayed, "green")}
      </div>`;
      footerEl.classList.remove("hidden");
    }
  }
  const viewModeSelect = document.getElementById('statsViewModeSelect');
  if (viewModeSelect) {
    viewModeSelect.value = statsViewMode;
    viewModeSelect.addEventListener('change', e => {
      statsViewMode = e.target.value === 'players' ? 'players' : 'teams';
      renderStatisticsContent();
    });
  }
  const selector = document.getElementById("additionalStatSelector");
  if (selector) {
      selector.value = statsMetricKey;
      selector.addEventListener("change", function () {
          statsMetricKey = this.value;
          const latestStats = getStatistics();
          const data = statsViewMode === 'players' ? latestStats.playersData : latestStats.teamsData;
          const sortedData = sortStatisticsData(data, statsSortKey, statsMetricKey);
          document.getElementById("teamStatsTableWrapper").innerHTML = renderStatsTable(statsViewMode, sortedData, statsMetricKey);
          ensureStatisticsEntityInteraction();
      });
  }
  const sortSelect = document.getElementById("statsSortSelect");
  if (sortSelect) {
    sortSelect.value = statsSortKey;
    sortSelect.addEventListener("change", function () {
      statsSortKey = this.value;
      renderStatisticsContent();
    });
  }
  ensureStatisticsEntityInteraction();
}

function ensureStatisticsEntityInteraction() {
  const container = document.getElementById("statisticsModalContent");
  if (!container || container.dataset.entityClickBound === 'true') return;
  container.addEventListener('click', handleStatisticsEntityClick);
  container.dataset.entityClickBound = 'true';
}

function handleStatisticsEntityClick(event) {
  const trigger = event.target.closest('.stats-entity-trigger');
  if (!trigger) return;
  event.preventDefault();
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
    titleEl.textContent = mode === 'players' ? 'Player Statistics' : 'Team Statistics';
  }

  const displayName = entity.name || (mode === 'teams' ? deriveTeamDisplay(entity.players, 'Unnamed Team') : sanitizePlayerName(entity.name) || 'Unnamed Player');
  const playersDisplay = mode === 'teams' ? formatTeamDisplay(entity.players || []) : '';
  const helperText = mode === 'teams' && playersDisplay
    ? `<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Players: ${playersDisplay}</p>`
    : '';

  const statEntries = [
    { label: 'Games Played', value: entity.gamesPlayed ?? 0 },
    { label: 'Wins', value: entity.wins ?? 0 },
    { label: 'Losses', value: entity.losses ?? 0 },
    { label: 'Win %', value: entity.winPercent ? `${entity.winPercent}${entity.winPercent.toString().includes('%') ? '' : '%'}` : '0%' },
    { label: 'Average Bid', value: entity.avgBid ?? 'N/A' },
    { label: 'Total Bid Amount', value: entity.totalBidAmount ?? 0 },
    { label: 'Bids Made', value: entity.bidsMade ?? 0 },
    { label: 'Bids Succeeded', value: entity.bidsSucceeded ?? 0 },
    { label: 'Bid Success %', value: entity.bidSuccessPct === 'N/A' ? 'N/A' : `${entity.bidSuccessPct}${entity.bidSuccessPct.toString().includes('%') ? '' : '%'}` },
    { label: 'Hands Played', value: entity.handsPlayed ?? 0 },
    { label: 'Hands Won', value: entity.handsWon ?? 0 },
    { label: 'Sandbag Games', value: entity.sandbagGames ?? 0 },
    { label: 'Sandbagger Flag', value: entity.sandbagger ?? 'No' },
    { label: 'Perfect 360s', value: entity.count360 ?? 0 },
    { label: 'Total Time Played', value: entity.totalTimeMs ? formatDuration(entity.totalTimeMs) : 'N/A' },
    { label: 'Last Played', value: entity.lastPlayed ? formatTimestamp(entity.lastPlayed) : 'Unknown' },
  ];

  const formatValue = (val) => {
    if (typeof val === 'number' && Number.isFinite(val)) {
      return val.toLocaleString();
    }
    return val;
  };

  const detailRows = statEntries.map(entry => `
    <div class="flex items-center justify-between py-2">
      <dt class="text-sm font-medium text-gray-600 dark:text-gray-300">${entry.label}</dt>
      <dd class="text-sm text-gray-900 dark:text-gray-100">${formatValue(entry.value)}</dd>
    </div>
  `).join('');

  const quickStats = [
    { label: 'Win %', value: statEntries[3].value },
    { label: 'Games', value: statEntries[0].value },
    { label: 'Total Time', value: statEntries[14].value },
    { label: '360s', value: statEntries[13].value },
  ].map(card => `
    <div class="rounded-xl bg-white/60 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
      <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">${card.label}</p>
      <p class="mt-1 text-lg font-semibold text-gray-900 dark:text-white">${formatValue(card.value)}</p>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="space-y-6">
      <div>
        <h3 class="text-2xl font-bold text-gray-900 dark:text-white">${displayName}</h3>
        ${helperText}
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        ${quickStats}
      </div>
      <dl class="divide-y divide-gray-200 dark:divide-gray-700 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        ${detailRows}
      </dl>
    </div>
  `;
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
  const headers = { games: "Games", avgBid: "Avg Bid", bidSuccessPct: "Bid Success %", sandbagger: "Sandbagger?", "360s": "360s", timePlayed: "Time Played" };
  const nameHeader = mode === 'teams' ? 'Team' : 'Player';
  if (!statsData || !statsData.length) {
    const emptyLabel = mode === 'teams' ? 'No team stats yet.' : 'No individual stats yet.';
    return `<p class="text-center text-gray-500 dark:text-gray-400 mt-4">${emptyLabel}</p>`;
  }

  let tableHTML = `<div id="teamStatsTableContainer" class="mt-4"><div class="overflow-x-auto -mx-4 sm:mx-0"><div class="inline-block min-w-full align-middle"><table class="min-w-full divide-y divide-gray-200 dark:divide-gray-600"><thead><tr>
      <th scope="col" class="py-3 pl-4 pr-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 sticky left-0 z-10">${nameHeader}</th>
      <th scope="col" class="px-3 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700">Win %</th>
      <th scope="col" class="px-3 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700">${headers[additionalStatKey] || 'Stat'}</th>`;
  tableHTML += `</tr></thead><tbody class="divide-y divide-gray-200 dark:divide-gray-600 bg-white dark:bg-gray-800">`;

  statsData.forEach((item, index) => {
    const rowClass = index % 2 === 0 ? "bg-white dark:bg-gray-800" : "bg-gray-50 dark:bg-gray-700";
    const lookup = {
      games: item.gamesPlayed,
      '360s': item.count360,
      avgBid: item.avgBid,
      bidSuccessPct: item.bidSuccessPct,
      sandbagger: item.sandbagger,
      timePlayed: formatDuration(item.totalTimeMs),
    };
    let statVal = lookup[additionalStatKey] ?? '0';
    if (additionalStatKey.includes('Pct') && typeof statVal === 'string' && !statVal.includes('%') && statVal !== 'N/A') statVal += '%';

    const entityKey = item.key;
    const displayName = item.name || (mode === 'teams' ? deriveTeamDisplay(item.players, 'Unnamed Team') : sanitizePlayerName(item.name) || 'Unnamed Player');
    const playersDisplay = mode === 'teams' ? formatTeamDisplay(item.players || []) : '';
    const secondaryLine = mode === 'teams' && playersDisplay && playersDisplay !== displayName
      ? `<span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">${playersDisplay}</span>`
      : '';
    tableHTML += `<tr class="${rowClass}">
      <td class="py-3 pl-4 pr-3 text-sm font-medium text-gray-900 dark:text-white sticky left-0 z-10 ${rowClass}">
        <button type="button"
          class="stats-entity-trigger group flex w-full items-start justify-between gap-3 rounded-lg px-2 py-2 -mx-2 -my-1.5 text-left transition-colors hover:bg-gray-100/70 active:bg-gray-200/70 dark:hover:bg-gray-600/40 dark:active:bg-gray-600/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400"
          data-entity-mode="${mode}" data-entity-key="${entityKey}" aria-haspopup="dialog">
          <span class="min-w-0">
            <span class="block font-semibold text-blue-600 group-hover:text-blue-500 dark:text-blue-300 dark:group-hover:text-blue-200 truncate">${displayName}</span>
            ${secondaryLine}
          </span>
          <span class="mt-0.5 flex-shrink-0 text-gray-400 group-hover:text-gray-500 dark:text-gray-500 dark:group-hover:text-gray-400">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </button>
      </td>
      <td class="whitespace-nowrap px-3 py-3.5 text-sm text-center text-gray-700 dark:text-gray-300">${item.winPercent}%</td>
      <td class="whitespace-nowrap px-3 py-3.5 text-sm text-center text-gray-700 dark:text-gray-300">${statVal}</td>`;
    tableHTML += `</tr>`;
  });

  tableHTML += `</tbody></table></div></div></div>`;
  return tableHTML;
}
