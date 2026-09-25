"use strict";

// --- Home Screen & First-Run Onboarding ---
// Home is the launch destination whenever no game is in progress. It also
// reappears after a game is saved or frozen, and the menu can open it at any
// time (then it offers "Continue game"). Onboarding runs once per device.
const ONBOARDING_COMPLETED_KEY = `${LOCAL_ONLY_STORAGE_PREFIX}onboardingCompleted`;
const HOME_BOOT_CLASS = "home-boot";
let homeScreenOpen = false;
let homeScreenGameSignature = "";
let onboardingSlideIndex = 0;
let onboardingScrollFrame = null;

function hasActiveGame(gameState = state) {
  if (!gameState || typeof gameState !== "object") return false;
  const rounds = Array.isArray(gameState.rounds) ? gameState.rounds : [];
  const dealers = Array.isArray(gameState.dealers) ? gameState.dealers.filter(Boolean) : [];
  const players = [
    ...ensurePlayersArray(gameState.usPlayers),
    ...ensurePlayersArray(gameState.demPlayers),
  ].filter(Boolean);
  const startingTotals = sanitizeTotals(gameState.startingTotals);
  return rounds.length > 0
    || Boolean(gameState.gameOver)
    || Boolean(gameState.biddingTeam)
    || dealers.length > 0
    || players.length > 0
    || startingTotals.us !== 0
    || startingTotals.dem !== 0;
}

// Changes when a different game lands on the scoreboard (a frozen game, a paper
// game, a cloud restore), but not while the same game simply ticks along.
function getHomeScreenGameSignature(gameState = state) {
  if (!hasActiveGame(gameState)) return "";
  const totals = sanitizeTotals(gameState.startingTotals);
  return JSON.stringify([
    Array.isArray(gameState.rounds) ? gameState.rounds.length : 0,
    totals.us,
    totals.dem,
    ensurePlayersArray(gameState.usPlayers),
    ensurePlayersArray(gameState.demPlayers),
    Array.isArray(gameState.dealers) ? gameState.dealers : [],
    Boolean(gameState.gameOver),
  ]);
}

function isHomeScreenOpen() {
  return homeScreenOpen;
}

function setHomeScreenChromeInert(isInert) {
  ["app", "hamburgerIcon", "versionBadge"].forEach(id => {
    const el = document.getElementById(id);
    if (el && "inert" in el) el.inert = isInert;
  });
}

function openHomeScreen({ focus = false } = {}) {
  const home = document.getElementById("homeScreen");
  if (!home) return false;
  closeMenuOverlay();
  homeScreenOpen = true;
  homeScreenGameSignature = getHomeScreenGameSignature();
  renderHomeScreen();
  document.documentElement.classList.remove(HOME_BOOT_CLASS);
  document.body.classList.add("home-open");
  if ("inert" in home) home.inert = document.body.classList.contains("modal-open");
  setHomeScreenChromeInert(true);
  home.scrollTop = 0;
  if (focus) document.getElementById("homeNewGameBtn")?.focus({ preventScroll: true });
  return true;
}

function closeHomeScreen() {
  if (!homeScreenOpen && !document.documentElement.classList.contains(HOME_BOOT_CLASS)) return;
  const home = document.getElementById("homeScreen");
  homeScreenOpen = false;
  homeScreenGameSignature = "";
  document.documentElement.classList.remove(HOME_BOOT_CLASS);
  document.body.classList.remove("home-open");
  if (home && "inert" in home) home.inert = true;
  // Leave the scoreboard inert if a sheet is still open over it.
  const app = document.getElementById("app");
  if (app && "inert" in app) app.inert = document.body.classList.contains("modal-open");
  ["hamburgerIcon", "versionBadge"].forEach(id => {
    const el = document.getElementById(id);
    if (el && "inert" in el) el.inert = false;
  });
  scheduleViewportCompatibilitySync();
}

// Called after every scoreboard render so Home follows state changes it did not start.
function syncHomeScreenWithGame() {
  if (!homeScreenOpen) return;
  const signature = getHomeScreenGameSignature();
  if (signature && signature !== homeScreenGameSignature) {
    closeHomeScreen();
    return;
  }
  homeScreenGameSignature = signature;
  renderHomeScreen();
}

function getLatestSavedGameEntry() {
  const savedGames = getLocalStorage("savedGames", []);
  if (!Array.isArray(savedGames) || !savedGames.length) return null;
  let latest = null;
  savedGames.forEach((game, index) => {
    if (!game || typeof game !== "object") return;
    const stamp = game.timestamp || null;
    const time = getLibraryTimestamp(stamp)?.getTime() ?? 0;
    if (!latest || time >= latest.time) latest = { game, index, time, stamp };
  });
  return latest;
}

function getLatestFrozenGameEntry() {
  const freezerGames = getLocalStorage("freezerGames", []);
  if (!Array.isArray(freezerGames) || !freezerGames.length) return null;
  let latest = null;
  freezerGames.forEach((game, index) => {
    if (!game || typeof game !== "object") return;
    const stamp = game.frozenAt || game.timestamp || null;
    const time = getLibraryTimestamp(stamp)?.getTime() ?? 0;
    if (!latest || time > latest.time) latest = { game, index, time, stamp };
  });
  return latest;
}

function buildHomeScoreLine(usName, usScore, demName, demScore, { winner = null } = {}) {
  const side = (key, name, score) => `
    <span class="home-score__side home-score__side--${key}${winner === key ? " is-winner" : ""}">
      <span class="home-score__name">${escapeHtmlValue(name)}</span>
      <span class="home-score__value">${escapeHtmlValue(score)}</span>
    </span>`;
  return `<span class="home-score">${side("us", usName, usScore)}<span class="home-score__vs" aria-hidden="true">vs</span>${side("dem", demName, demScore)}</span>`;
}

function buildHomeActiveGameCard() {
  const totals = getCurrentTotals();
  const usName = state.usTeamName || "Us";
  const demName = state.demTeamName || "Dem";
  const detail = state.gameOver
    ? "Game over, ready to save"
    : state.rounds.length
      ? `Round ${state.rounds.length + 1} up next`
      : "Set up, no hands played yet";
  return `
    <button type="button" class="home-card home-card--live" onclick="homeContinueGame()" aria-label="Continue game: ${escapeAttribute(usName)} ${totals.us}, ${escapeAttribute(demName)} ${totals.dem}">
      <span class="home-card__eyebrow"><span class="home-card__pulse" aria-hidden="true"></span>Game in progress</span>
      ${buildHomeScoreLine(usName, totals.us, demName, totals.dem)}
      <span class="home-card__foot">
        <span>${escapeHtmlValue(detail)}</span>
        <span class="home-card__cta">Continue<svg class="ui-icon" aria-hidden="true"><use href="#ui-icon-chevron"/></svg></span>
      </span>
    </button>`;
}

function buildHomeFrozenGameCard(entry) {
  const { game, index, time, stamp } = entry;
  const totals = sanitizeTotals(game.finalScore);
  const usName = getGameTeamDisplay(game, "us");
  const demName = getGameTeamDisplay(game, "dem");
  const when = time ? `Frozen ${formatLibraryAgo(stamp)}` : "Frozen";
  return `
    <button type="button" class="home-card home-card--frozen" onclick="homeResumeFrozenGame(${index})" aria-label="Resume frozen game: ${escapeAttribute(usName)} ${totals.us}, ${escapeAttribute(demName)} ${totals.dem}">
      <span class="home-card__eyebrow"><svg class="ui-icon" aria-hidden="true"><use href="#dialog-icon-snowflake"/></svg>Pick up where you left off</span>
      ${buildHomeScoreLine(usName, totals.us, demName, totals.dem)}
      <span class="home-card__foot">
        <span>${escapeHtmlValue(when)}</span>
        <span class="home-card__cta">Resume<svg class="ui-icon" aria-hidden="true"><use href="#ui-icon-chevron"/></svg></span>
      </span>
    </button>`;
}

function buildHomeLastGameCard(entry) {
  const { game, index, time, stamp } = entry;
  const totals = sanitizeTotals(game.finalScore);
  const usName = getGameTeamDisplay(game, "us");
  const demName = getGameTeamDisplay(game, "dem");
  const winner = game.winner === "us" || game.winner === "dem" ? game.winner : null;
  const when = time ? formatLibraryAgo(stamp) : "";
  return `
    <button type="button" class="home-card home-card--recent" onclick="homeViewLastGame(${index})" aria-label="Last game: ${escapeAttribute(usName)} ${totals.us}, ${escapeAttribute(demName)} ${totals.dem}">
      <span class="home-card__eyebrow"><svg class="ui-icon" aria-hidden="true"><use href="#dialog-icon-trophy"/></svg>Last game${when ? ` · ${escapeHtmlValue(when)}` : ""}</span>
      ${buildHomeScoreLine(usName, totals.us, demName, totals.dem, { winner })}
    </button>`;
}

function renderHomeScreen() {
  const statusEl = document.getElementById("homeScreenStatus");
  if (!statusEl) return;
  const activeGame = hasActiveGame();
  const frozenEntry = activeGame ? null : getLatestFrozenGameEntry();
  const lastEntry = getLatestSavedGameEntry();

  const cards = [];
  if (activeGame) cards.push(buildHomeActiveGameCard());
  else if (frozenEntry) cards.push(buildHomeFrozenGameCard(frozenEntry));
  if (lastEntry) cards.push(buildHomeLastGameCard(lastEntry));
  statusEl.innerHTML = cards.join("");
  statusEl.classList.toggle("hidden", !cards.length);

  const greeting = document.getElementById("homeScreenGreeting");
  if (greeting) {
    greeting.textContent = activeGame
      ? "Your game is waiting."
      : lastEntry || frozenEntry ? "Ready for another hand?" : "Ready to deal?";
  }

  const newGameBtn = document.getElementById("homeNewGameBtn");
  newGameBtn?.classList.toggle("home-primary--quiet", activeGame);

  const savedCount = (getLocalStorage("savedGames", []) || []).length;
  const frozenCount = (getLocalStorage("freezerGames", []) || []).length;
  const gamesMeta = document.getElementById("homeGamesMeta");
  if (gamesMeta) {
    const parts = [];
    if (savedCount) parts.push(`${savedCount} saved`);
    if (frozenCount) parts.push(`${frozenCount} frozen`);
    gamesMeta.textContent = parts.length ? parts.join(" · ") : "None yet";
  }

  const authLabel = document.getElementById("homeAuthLabel");
  if (authLabel) authLabel.textContent = isHomeUserSignedIn() ? "Sign out" : "Sign in to sync";
}

function isHomeUserSignedIn() {
  const user = typeof window !== "undefined" ? window.firebaseAuth?.currentUser : null;
  return Boolean(user && !user.isAnonymous);
}

function homeToggleAuth() {
  if (isHomeUserSignedIn()) {
    window.signOutUser?.();
  } else {
    window.signInWithGoogle?.();
  }
}

function homeContinueGame() {
  closeHomeScreen();
}

function homeStartNewGame() {
  if (!hasActiveGame()) {
    closeHomeScreen();
    emitRookEvent("home_new_game");
    return;
  }
  openConfirmationModal(
    "Unsaved progress on the current game will be lost.",
    () => {
      closeConfirmationModal();
      closeTeamSelectionModal();
      resetGame();
      closeHomeScreen();
      emitRookEvent("home_new_game");
    },
    closeConfirmationModal,
    { title: "Start a new game?", confirmLabel: "New game", tone: "warning", icon: "refresh" }
  );
}

function homeResumeFrozenGame(index) {
  // With nothing on the scoreboard there is nothing to replace, so skip the confirmation.
  loadFreezerGame(index, { confirm: hasActiveGame() });
}

function homeViewLastGame(index) {
  viewSavedGame(index, { returnToLibrary: false });
}

// --- Onboarding ---
function isOnboardingComplete() {
  return Boolean(getLocalStorage(ONBOARDING_COMPLETED_KEY, false));
}

// People who already have games on this device are not new; don't greet them with a tour.
// Only games count: startup migrations write settings and an empty teams record on every launch.
function hasExistingRookData() {
  const savedGames = getLocalStorage("savedGames", []);
  const freezerGames = getLocalStorage("freezerGames", []);
  return (Array.isArray(savedGames) && savedGames.length > 0)
    || (Array.isArray(freezerGames) && freezerGames.length > 0)
    || hasActiveGame();
}

function getOnboardingSlides() {
  return Array.from(document.querySelectorAll("#onboardingTrack .onboarding__slide"));
}

function setOnboardingSlide(index, { scroll = true, smooth = true } = {}) {
  const slides = getOnboardingSlides();
  if (!slides.length) return;
  const nextIndex = Math.max(0, Math.min(slides.length - 1, index));
  onboardingSlideIndex = nextIndex;
  const track = document.getElementById("onboardingTrack");
  if (scroll && track) {
    const reduceMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: slides[nextIndex].offsetLeft, behavior: smooth && !reduceMotion ? "smooth" : "auto" });
  }
  slides.forEach((slide, i) => {
    slide.classList.toggle("is-active", i === nextIndex);
    slide.setAttribute("aria-hidden", String(i !== nextIndex));
    if ("inert" in slide) slide.inert = i !== nextIndex;
  });
  document.querySelectorAll("#onboardingDots .onboarding__dot").forEach((dot, i) => {
    dot.classList.toggle("is-active", i === nextIndex);
    dot.setAttribute("aria-current", i === nextIndex ? "step" : "false");
  });
  const isLast = nextIndex === slides.length - 1;
  const nextBtn = document.getElementById("onboardingNext");
  if (nextBtn) nextBtn.textContent = isLast ? "Let's play" : "Next";
  document.getElementById("onboardingSkip")?.classList.toggle("is-hidden", isLast);
}

function handleOnboardingScroll() {
  if (onboardingScrollFrame) return;
  onboardingScrollFrame = scheduleFrame(() => {
    onboardingScrollFrame = null;
    const track = document.getElementById("onboardingTrack");
    if (!track || !track.clientWidth) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    if (index !== onboardingSlideIndex) setOnboardingSlide(index, { scroll: false });
  });
}

function openOnboarding({ replay = false } = {}) {
  const overlay = document.getElementById("onboarding");
  if (!overlay) return false;
  overlay.dataset.replay = String(replay);
  overlay.classList.remove("hidden");
  document.body.classList.add("onboarding-open");
  const home = document.getElementById("homeScreen");
  if (home && "inert" in home) home.inert = true;
  setHomeScreenChromeInert(true);
  setOnboardingSlide(0, { smooth: false });
  document.getElementById("onboardingNext")?.focus({ preventScroll: true });
  emitRookEvent("onboarding_started", { replay });
  return true;
}

function finishOnboarding(outcome = "completed") {
  const overlay = document.getElementById("onboarding");
  if (!overlay || overlay.classList.contains("hidden")) return;
  setLocalStorage(ONBOARDING_COMPLETED_KEY, true);
  overlay.classList.add("hidden");
  document.body.classList.remove("onboarding-open");
  emitRookEvent(`onboarding_${outcome}`, { step: onboardingSlideIndex + 1 });
  if (homeScreenOpen) {
    const home = document.getElementById("homeScreen");
    if (home && "inert" in home) home.inert = false;
    document.getElementById("homeNewGameBtn")?.focus({ preventScroll: true });
  } else {
    setHomeScreenChromeInert(false);
  }
}

function advanceOnboarding() {
  const slides = getOnboardingSlides();
  if (onboardingSlideIndex >= slides.length - 1) {
    finishOnboarding("completed");
    return;
  }
  setOnboardingSlide(onboardingSlideIndex + 1);
}

function maybeStartOnboarding() {
  if (isOnboardingComplete()) return false;
  if (hasExistingRookData()) {
    setLocalStorage(ONBOARDING_COMPLETED_KEY, true);
    return false;
  }
  return openOnboarding();
}

function initializeHomeScreen() {
  const track = document.getElementById("onboardingTrack");
  track?.addEventListener("scroll", handleOnboardingScroll, { passive: true });
  document.querySelectorAll("#onboardingDots .onboarding__dot").forEach((dot, i) => {
    dot.addEventListener("click", () => setOnboardingSlide(i));
  });

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    const overlay = document.getElementById("onboarding");
    if (overlay && !overlay.classList.contains("hidden")) {
      if (event.key === "Escape") { event.preventDefault(); finishOnboarding("skipped"); }
      else if (event.key === "ArrowRight") { event.preventDefault(); setOnboardingSlide(onboardingSlideIndex + 1); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); setOnboardingSlide(onboardingSlideIndex - 1); }
      return;
    }
    // Escape on Home returns to a game in progress; with no game there is nowhere to go back to.
    if (event.key === "Escape" && homeScreenOpen && hasActiveGame()
        && !document.body.classList.contains("modal-open")) {
      event.preventDefault();
      homeContinueGame();
    }
  });

  if (hasActiveGame()) {
    closeHomeScreen();
  } else {
    openHomeScreen();
  }
  maybeStartOnboarding();
}
