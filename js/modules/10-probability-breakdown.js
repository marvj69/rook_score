"use strict";

// --- Probability Breakdown Functions ---
let probabilityReturnFocus = null;
let probabilityExplanationLoadPromise = null;

function loadProbabilityExplanation() {
  if (typeof generateProbabilityBreakdown === "function") return Promise.resolve();
  if (probabilityExplanationLoadPromise) return probabilityExplanationLoadPromise;
  probabilityExplanationLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("js/probability-explanation.bundle.js", document.baseURI).href;
    script.async = true;
    const fail = () => {
      probabilityExplanationLoadPromise = null;
      script.remove();
      reject(new Error("Probability explanation could not load."));
    };
    script.addEventListener("error", fail, { once: true });
    script.addEventListener("load", () => {
      if (typeof generateProbabilityBreakdown === "function") resolve();
      else fail();
    }, { once: true });
    document.head.appendChild(script);
  });
  return probabilityExplanationLoadPromise;
}

// The explanation's chart styles ship outside the startup CSS. Plain text is
// still readable if the stylesheet fails, so a failure never blocks the modal.
let probabilityStylesLoadPromise = null;

function loadProbabilityStyles() {
  if (probabilityStylesLoadPromise) return probabilityStylesLoadPromise;
  probabilityStylesLoadPromise = new Promise(resolve => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("css/probability-explanation.css", document.baseURI).href;
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", () => {
      probabilityStylesLoadPromise = null;
      link.remove();
      resolve();
    }, { once: true });
    document.head.appendChild(link);
  });
  return probabilityStylesLoadPromise;
}

async function openProbabilityModal() {
  if (document.getElementById("probabilityModal")) return;
  probabilityReturnFocus = document.activeElement;
  emitRookEvent("probability_opened", getRookGameEventParams(state));
  const modalHtml = `
    <div id="probabilityModal" class="probability-modal fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 modal" role="dialog" aria-modal="true" aria-labelledby="probabilityModalTitle" tabindex="-1">
      <div class="probability-modal-content relative mx-auto w-full max-w-lg rounded-xl shadow-lg" style="max-height: 80vh;">
        <header class="probability-modal-header flex items-center justify-between gap-4 p-4 border-b border-gray-700 shrink-0">
          <h2 id="probabilityModalTitle" class="text-lg font-bold">How win probability works</h2>
          <button type="button" onclick="closeProbabilityModal()" class="probability-modal-close flex items-center justify-center w-11 h-11 shrink-0 rounded-lg" aria-label="Close win probability explanation">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div class="probability-modal-scroll">
          <p role="status">Loading explanation…</p>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  activateModalEnvironment();
  const modal = document.getElementById("probabilityModal");
  modal.focus();
  modal.addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    const controls = modal.querySelectorAll("button, summary");
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  try {
    await Promise.all([loadProbabilityExplanation(), loadProbabilityStyles()]);
    const content = document.querySelector("#probabilityModal .probability-modal-scroll");
    if (content) {
      content.innerHTML = generateProbabilityBreakdown();
      enhanceProbabilityExplanation(content);
    }
  } catch {
    const content = document.querySelector("#probabilityModal .probability-modal-scroll");
    if (content) content.innerHTML = '<p role="alert">The explanation could not load. Close this panel and try again.</p>';
  }
}

function closeProbabilityModal() {
  const modal = document.getElementById('probabilityModal');
  if (modal) {
    modal.remove();
    deactivateModalEnvironment();
    probabilityReturnFocus?.focus();
    probabilityReturnFocus = null;
  }
}

function getBucketRange(bucketedScore) {
  const abs = Math.abs(bucketedScore);
  if (abs === 0) return "0";
  if (abs === 180) return "161+";
  const lower = abs - 19;
  return `${lower}-${abs}`;
}
function buildNameRecencyMaps(teamsObj = null) {
  const playerRecency = new Map();
  const teamRecency = new Map();
  const updateRecency = (map, key, timestampMs) => {
    if (!key) return;
    const prev = map.get(key);
    if (prev === undefined || timestampMs > prev) map.set(key, timestampMs);
  };
  const addPlayerName = (name, timestampMs) => {
    const cleaned = sanitizePlayerName(name || "");
    if (!cleaned) return;
    updateRecency(playerRecency, cleaned, timestampMs);
  };
  const addPlayers = (players, timestampMs) => {
    ensurePlayersArray(players).forEach(name => addPlayerName(name, timestampMs));
  };
  const addTeam = (players, timestampMs) => {
    const key = buildTeamKey(players);
    updateRecency(teamRecency, key, timestampMs);
  };
  const addGame = (game) => {
    if (!game) return;
    const parsed = game.timestamp ? new Date(game.timestamp).getTime() : 0;
    const timestampMs = Number.isFinite(parsed) ? parsed : 0;
    const usPlayers = canonicalizePlayers(game.usPlayers || parseLegacyTeamName(game.usTeamName || game.usName));
    const demPlayers = canonicalizePlayers(game.demPlayers || parseLegacyTeamName(game.demTeamName || game.demName));
    addPlayers(usPlayers, timestampMs);
    addPlayers(demPlayers, timestampMs);
    addTeam(usPlayers, timestampMs);
    addTeam(demPlayers, timestampMs);
  };

  const savedGames = getLocalStorage("savedGames", []);
  if (Array.isArray(savedGames)) savedGames.forEach(addGame);
  const freezerGames = getLocalStorage("freezerGames", []);
  if (Array.isArray(freezerGames)) freezerGames.forEach(addGame);

  const now = Date.now();
  addPlayers(state.usPlayers, now);
  addPlayers(state.demPlayers, now);
  addPlayers(state.dealers, now);
  addTeam(state.usPlayers, now);
  addTeam(state.demPlayers, now);

  if (teamsObj && typeof teamsObj === "object") {
    Object.entries(teamsObj).forEach(([key, value]) => {
      updateRecency(teamRecency, key, 0);
      if (value && value.players) addPlayers(value.players, 0);
    });
  }

  return { playerRecency, teamRecency };
}
// Suggestions are rebuilt only when the underlying data changes; the dealer
// and team-name fields ask for them on every keystroke.
const PLAYER_SUGGESTION_CACHE = { key: null, suggestions: [], datalistHtml: null };

function getPlayerSuggestionCacheKey() {
  let stored = "";
  try {
    stored = `${localStorage.getItem("savedGames") || ""}\u0000${localStorage.getItem("freezerGames") || ""}\u0000${localStorage.getItem("teams") || ""}`;
  } catch {
    stored = "";
  }
  return `${stored}\u0000${JSON.stringify([state.usPlayers, state.demPlayers, state.dealers])}`;
}

function getOrderedPlayerSuggestions() {
  const cacheKey = getPlayerSuggestionCacheKey();
  if (PLAYER_SUGGESTION_CACHE.key === cacheKey) return PLAYER_SUGGESTION_CACHE.suggestions;

  const teamsObj = getTeamsObject();
  const { playerRecency } = buildNameRecencyMaps(teamsObj);

  const suggestions = Array.from(playerRecency.entries())
    .sort((a, b) => {
      const diff = b[1] - a[1];
      if (diff) return diff;
      return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' });
    })
    .map(([name]) => name);
  PLAYER_SUGGESTION_CACHE.key = cacheKey;
  PLAYER_SUGGESTION_CACHE.suggestions = suggestions;
  PLAYER_SUGGESTION_CACHE.datalistHtml = null;
  return suggestions;
}
function getFilteredPlayerSuggestions(suggestions, query = '', limit = 6, excludedNames = []) {
  const normalizedQuery = sanitizePlayerName(query).toLowerCase();
  const excludedKeys = new Set(
    Array.from(excludedNames || [])
      .map(name => sanitizePlayerName(name).toLowerCase())
      .filter(Boolean)
  );
  const uniqueSuggestions = [];
  const seen = new Set();

  suggestions.forEach((name) => {
    const cleaned = sanitizePlayerName(name);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    if (excludedKeys.has(key)) return;
    if (normalizedQuery && !key.includes(normalizedQuery)) return;
    seen.add(key);
    uniqueSuggestions.push(cleaned);
  });

  return uniqueSuggestions.slice(0, limit);
}
function refreshPlayerSuggestions() {
  const orderedSuggestions = getOrderedPlayerSuggestions();

  const datalist = document.getElementById("playerNameSuggestions");
  if (datalist) {
    const html = orderedSuggestions
      .map(name => `<option value="${escapeAttribute(name)}"></option>`)
      .join("\n");
    if (PLAYER_SUGGESTION_CACHE.datalistHtml !== html || datalist.childElementCount !== orderedSuggestions.length) {
      datalist.innerHTML = html;
      PLAYER_SUGGESTION_CACHE.datalistHtml = html;
    }
  }

  return orderedSuggestions;
}
function populateTeamSelects() {
  const teamsObj = getTeamsObject();
  const { teamRecency } = buildNameRecencyMaps(teamsObj);
  const entrySortFn = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  const teamEntries = Object.entries(teamsObj).map(([key, value]) => ({
    key,
    players: ensurePlayersArray(value.players),
    displayName: deriveTeamDisplay(value.players, value.displayName || ''),
    lastPlayed: teamRecency.get(key) || 0,
  })).filter(entry => entry.displayName).sort((a, b) => {
    const diff = b.lastPlayed - a.lastPlayed;
    if (diff) return diff;
    return entrySortFn(a.displayName, b.displayName);
  });

  const configureTeamSection = (selectId, inputIds, currentPlayers) => {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">-- Select saved pairing --</option>';
    teamEntries.forEach(entry => {
      const option = new Option(entry.displayName, entry.key);
      selectEl.add(option);
    });

    const currentKey = buildTeamKey(currentPlayers);
    if (currentKey && teamsObj[currentKey]) {
      selectEl.value = currentKey;
    } else {
      selectEl.value = "";
    }

    selectEl.onchange = () => {
      const chosen = teamsObj[selectEl.value];
      if (!chosen) return;
      const chosenPlayers = ensurePlayersArray(chosen.players);
      inputIds.forEach((id, idx) => {
        const inputEl = document.getElementById(id);
        if (inputEl) inputEl.value = chosenPlayers[idx] || "";
      });
    };

    inputIds.forEach((id, idx) => {
      const inputEl = document.getElementById(id);
      if (inputEl) inputEl.value = sanitizePlayerName(currentPlayers[idx] || "");
    });
  };

  // Check for pre-populated data from dealer pair selection
  const usPlayersToUse = window.prePopulatedTeamData?.usPlayers || ensurePlayersArray(state.usPlayers);
  const demPlayersToUse = window.prePopulatedTeamData?.demPlayers || ensurePlayersArray(state.demPlayers);
  
  configureTeamSection("selectUsTeam", ["usPlayerOne", "usPlayerTwo"], usPlayersToUse);
  configureTeamSection("selectDemTeam", ["demPlayerOne", "demPlayerTwo"], demPlayersToUse);
  
  // Clear pre-populated data after use
  if (window.prePopulatedTeamData) {
    window.prePopulatedTeamData = null;
  }

  refreshPlayerSuggestions();
}
function handleTeamSelectionSubmit(e) {
  e.preventDefault();

  const usPlayers = ensurePlayersArray([
    document.getElementById("usPlayerOne")?.value,
    document.getElementById("usPlayerTwo")?.value,
  ]);
  const demPlayers = ensurePlayersArray([
    document.getElementById("demPlayerOne")?.value,
    document.getElementById("demPlayerTwo")?.value,
  ]);

  if (!usPlayers[0] || !usPlayers[1]) {
    showNoticeModal("Please enter both player names for Team 'Us'.", { title: "Check team names", icon: "users" });
    return;
  }
  if (!demPlayers[0] || !demPlayers[1]) {
    showNoticeModal("Please enter both player names for Team 'Dem'.", { title: "Check team names", icon: "users" });
    return;
  }
  if (usPlayers[0].toLowerCase() === usPlayers[1].toLowerCase()) {
    showNoticeModal("Team 'Us' needs two different players.", { title: "Check team names", icon: "users" });
    return;
  }
  if (demPlayers[0].toLowerCase() === demPlayers[1].toLowerCase()) {
    showNoticeModal("Team 'Dem' needs two different players.", { title: "Check team names", icon: "users" });
    return;
  }

  const usKey = buildTeamKey(usPlayers);
  const demKey = buildTeamKey(demPlayers);
  if (!usKey || !demKey) {
    showNoticeModal("Problem building team combinations. Please check the names and try again.", { title: "Check team names", icon: "users" });
    return;
  }
  if (usKey === demKey) {
    showNoticeModal("Both teams cannot have the same two players.", { title: "Check team names", icon: "users" });
    return;
  }

  addTeamIfNotExists(usPlayers, formatTeamDisplay(usPlayers));
  addTeamIfNotExists(demPlayers, formatTeamDisplay(demPlayers));
  updateState({ usPlayers, demPlayers });
  saveCurrentGameState();
  closeTeamSelectionModal();
  if (pendingGameAction === "freeze") { confirmFreeze(); }
  else if (pendingGameAction === "save") { handleManualSaveGame(); }
  pendingGameAction = null;
}
const SAME_ORIGIN_BUG_REPORT_URL = "/api/bug-report";
const VERCEL_BUG_REPORT_URL = "https://rook-score.vercel.app/api/bug-report";
const BUG_REPORT_GITHUB_PAGES_HOSTNAMES = new Set(["marvj69.github.io"]);
const BUG_REPORT_TIMEOUT_MS = 15000;
let activeBugReportAbortController = null;

function getBugReportUrl() {
  if (typeof window === "undefined" || !window.location) return SAME_ORIGIN_BUG_REPORT_URL;
  return BUG_REPORT_GITHUB_PAGES_HOSTNAMES.has(window.location.hostname)
    ? VERCEL_BUG_REPORT_URL
    : SAME_ORIGIN_BUG_REPORT_URL;
}

function getBugReportAppVersion() {
  let appVersion = typeof APP_VERSION !== "undefined" ? APP_VERSION : "N/A";
  try {
    const versionElement = document.querySelector("#versionBadge p");
    if (versionElement?.textContent?.trim()) appVersion = versionElement.textContent.trim();
  } catch (error) {
    console.warn("Could not read the app version for diagnostics:", error);
  }
  return appVersion;
}

function getBugReportDiagnostics() {
  const rounds = Array.isArray(state?.rounds) ? state.rounds : [];
  const latestTotals = rounds[rounds.length - 1]?.runningTotals || state?.startingTotals || {};
  const firebaseUser = window.firebaseAuth?.currentUser || null;
  const locationOrigin = typeof window.location?.origin === "string" ? window.location.origin : "";
  const locationPath = typeof window.location?.pathname === "string" ? window.location.pathname : "";
  const displayMode = window.matchMedia?.("(display-mode: standalone)")?.matches
    || window.navigator?.standalone === true
    ? "standalone"
    : "browser";

  return {
    capturedAt: new Date().toISOString(),
    appVersion: getBugReportAppVersion(),
    page: `${locationOrigin}${locationPath}` || "N/A",
    userAgent: String(navigator.userAgent || "N/A").slice(0, 500),
    viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
    devicePixelRatio: Number(window.devicePixelRatio) || 1,
    displayMode,
    online: navigator.onLine !== false,
    theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
    proMode: localStorage.getItem(PRO_MODE_KEY) === "true",
    firebase: {
      status: window.firebaseReady ? "ready" : "not-ready-or-offline",
      signedIn: Boolean(firebaseUser),
      anonymous: firebaseUser ? Boolean(firebaseUser.isAnonymous) : null,
    },
    game: {
      roundsPlayed: rounds.length,
      scores: {
        us: Number(latestTotals.us) || 0,
        dem: Number(latestTotals.dem) || 0,
      },
      gameOver: Boolean(state?.gameOver),
      winner: state?.winner === "us" || state?.winner === "dem" ? state.winner : null,
      victoryMethod: typeof state?.victoryMethod === "string"
        ? state.victoryMethod.slice(0, 80)
        : null,
    },
  };
}

function createBugReportId() {
  if (typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  const randomPart = Math.random().toString(36).slice(2, 12);
  return `${Date.now().toString(36)}-${randomPart}`;
}

function setBugReportStatus(message, tone = "error") {
  const statusElement = document.getElementById("bugReportStatus");
  if (!statusElement) return;
  const toneClasses = tone === "info"
    ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
    : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300";
  statusElement.className = `rounded-xl px-3 py-2.5 text-sm ${toneClasses}`;
  statusElement.textContent = message;
}

function resetBugReportForm() {
  const form = document.getElementById("bugReportForm");
  form?.reset();
  form?.classList.remove("hidden");
  document.getElementById("bugReportSuccess")?.classList.add("hidden");
  document.getElementById("bugReportStatus")?.classList.add("hidden");
  const diagnosticsCheckbox = document.getElementById("bugReportIncludeDiagnostics");
  if (diagnosticsCheckbox) diagnosticsCheckbox.checked = true;
  const submitButton = document.getElementById("bugReportSubmitButton");
  if (submitButton) {
    submitButton.disabled = false;
    const label = submitButton.querySelector("span");
    if (label) label.textContent = "Send Report";
  }
}

function openBugReportModal() {
  closeModal("aboutModal");
  resetBugReportForm();
  openModal("bugReportModal");
}

function closeBugReportModal() {
  activeBugReportAbortController?.abort();
  activeBugReportAbortController = null;
  closeModal("bugReportModal");
}

function validateBugReportForm(form) {
  const summaryInput = form.elements.namedItem("summary");
  const descriptionInput = form.elements.namedItem("description");
  const contactEmailInput = form.elements.namedItem("contactEmail");
  const summary = String(summaryInput?.value || "").trim();
  const description = String(descriptionInput?.value || "").trim();
  const contactEmail = String(contactEmailInput?.value || "").trim();

  summaryInput?.setCustomValidity(summary ? "" : "Please add a short summary.");
  descriptionInput?.setCustomValidity(
    description.length >= 10 ? "" : "Please add at least 10 characters describing what happened.",
  );
  contactEmailInput?.setCustomValidity(
    !contactEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)
      ? ""
      : "Enter a valid email address or leave this blank.",
  );

  return typeof form.reportValidity !== "function" || form.reportValidity();
}

async function handleBugReportSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget || document.getElementById("bugReportForm");
  if (!form || !validateBugReportForm(form)) return false;

  const submitButton = document.getElementById("bugReportSubmitButton");
  const submitLabel = submitButton?.querySelector("span");
  if (submitButton?.disabled) return false;
  if (navigator.onLine === false) {
    setBugReportStatus("You appear to be offline. Your report is still here—reconnect and try again.");
    return false;
  }

  const formData = new FormData(form);
  const payload = {
    reportId: createBugReportId(),
    category: String(formData.get("category") || ""),
    summary: String(formData.get("summary") || "").trim(),
    description: String(formData.get("description") || "").trim(),
    steps: String(formData.get("steps") || "").trim(),
    contactEmail: String(formData.get("contactEmail") || "").trim(),
    website: String(formData.get("website") || ""),
    diagnostics: formData.get("includeDiagnostics") ? getBugReportDiagnostics() : null,
  };

  if (submitButton) submitButton.disabled = true;
  if (submitLabel) submitLabel.textContent = "Sending…";
  setBugReportStatus("Sending your report securely…", "info");

  const abortController = new AbortController();
  activeBugReportAbortController = abortController;
  const timeoutId = setTimeout(() => abortController.abort(), BUG_REPORT_TIMEOUT_MS);

  try {
    const response = await fetch(getBugReportUrl(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = response.status === 429
        ? "Too many reports were sent recently. Please wait a few minutes and try again."
        : result.error || "Your report could not be sent right now. Please try again.";
      throw Object.assign(new Error(message), { isExpected: true });
    }

    form.classList.add("hidden");
    document.getElementById("bugReportSuccess")?.classList.remove("hidden");
    return true;
  } catch (error) {
    if (activeBugReportAbortController !== abortController) return false;
    const message = error.isExpected
      ? error.message
      : error.name === "AbortError"
        ? "Sending took too long. Your report is still here—please try again."
        : "Your report could not be sent right now. Your details are still here so you can try again.";
    setBugReportStatus(message);
    return false;
  } finally {
    clearTimeout(timeoutId);
    if (activeBugReportAbortController === abortController) {
      activeBugReportAbortController = null;
    }
    if (submitButton) submitButton.disabled = false;
    if (submitLabel) submitLabel.textContent = "Send Report";
  }
}
