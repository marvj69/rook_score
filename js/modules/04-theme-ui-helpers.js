"use strict";

// --- Theme & UI Helpers ---
const IOS_STANDALONE_SAFE_AREA_FALLBACK_CLASS = "ios-standalone-safe-area-fallback";
const APP_CONTENT_OVERFLOWS_CLASS = "app-content-overflows";
const IOS_STANDALONE_SAFE_AREA_FALLBACK_TOP_PX = 44;
// Mirrors --top-edge-clearance in app.css.
const TOP_EDGE_CLEARANCE_MAX_PX = 16;
let viewportCompatibilitySyncScheduled = false;

function getComputedSafeAreaInsetTop() {
  if (typeof document === "undefined" || !document.body || typeof getComputedStyle !== "function") return 0;
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;";
  document.body.appendChild(probe);
  const value = parseFloat(getComputedStyle(probe).paddingTop);
  probe.remove();
  return Number.isFinite(value) ? value : 0;
}

function isProbablyIOSDevice() {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return /iPad|iPhone|iPod/.test(userAgent)
    || (platform === "MacIntel" && Number(navigator.maxTouchPoints) > 1);
}

function isStandaloneDisplayMode() {
  if (typeof window === "undefined") return false;
  const navigatorStandalone = window.navigator && window.navigator.standalone === true;
  const mediaStandalone = typeof window.matchMedia === "function"
    && window.matchMedia("(display-mode: standalone)").matches;
  return navigatorStandalone || mediaStandalone;
}

function shouldApplyStandaloneSafeAreaFallback({ isIOS, isStandalone, safeAreaInsetTop }) {
  return Boolean(isIOS && isStandalone && Number(safeAreaInsetTop) < 1);
}

function applyStandaloneSafeAreaFallback(safeAreaInsetTop = getComputedSafeAreaInsetTop()) {
  const body = document.getElementById("bodyRoot") || document.body;
  if (!body) return false;
  const needsFallback = shouldApplyStandaloneSafeAreaFallback({
    isIOS: isProbablyIOSDevice(),
    isStandalone: isStandaloneDisplayMode(),
    safeAreaInsetTop,
  });
  body.classList.toggle(IOS_STANDALONE_SAFE_AREA_FALLBACK_CLASS, needsFallback);
  return needsFallback;
}

function shouldEnableAppViewportScroll(appScrollHeight, viewportHeight, safeAreaInsetTop = 0) {
  const contentHeight = Number(appScrollHeight);
  const availableHeight = Number(viewportHeight) - Math.max(0, Number(safeAreaInsetTop) || 0);
  if (!Number.isFinite(contentHeight) || !Number.isFinite(availableHeight) || availableHeight <= 0) return false;
  return contentHeight > availableHeight + 1;
}

function getViewportHeight() {
  if (typeof window === "undefined") return 0;
  const visualHeight = Number(window.visualViewport && window.visualViewport.height);
  if (Number.isFinite(visualHeight) && visualHeight > 0) return visualHeight;
  const innerHeight = Number(window.innerHeight);
  if (Number.isFinite(innerHeight) && innerHeight > 0) return innerHeight;
  return Number(document.documentElement && document.documentElement.clientHeight) || 0;
}

function syncAppViewportOverflowClass(measuredSafeAreaInsetTop = getComputedSafeAreaInsetTop()) {
  const body = document.getElementById("bodyRoot") || document.body;
  const app = document.getElementById("app");
  if (!body || !app) return false;
  const safeAreaInsetTop = body.classList.contains(IOS_STANDALONE_SAFE_AREA_FALLBACK_CLASS)
    ? IOS_STANDALONE_SAFE_AREA_FALLBACK_TOP_PX
    : measuredSafeAreaInsetTop + Math.min(Math.max(0, Number(measuredSafeAreaInsetTop) || 0), TOP_EDGE_CLEARANCE_MAX_PX);
  const shouldScroll = shouldEnableAppViewportScroll(app.scrollHeight, getViewportHeight(), safeAreaInsetTop);
  body.classList.toggle(APP_CONTENT_OVERFLOWS_CLASS, shouldScroll);
  return shouldScroll;
}

function syncViewportCompatibilityClasses() {
  // Read the inset once: each probe insertion/computed-style read can force layout.
  const safeAreaInsetTop = getComputedSafeAreaInsetTop();
  applyStandaloneSafeAreaFallback(safeAreaInsetTop);
  syncAppViewportOverflowClass(safeAreaInsetTop);
}

function scheduleViewportCompatibilitySync() {
  if (viewportCompatibilitySyncScheduled) return;
  viewportCompatibilitySyncScheduled = true;
  const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb) => setTimeout(cb, 0);
  schedule(() => {
    viewportCompatibilitySyncScheduled = false;
    syncViewportCompatibilityClasses();
  });
}

function enforceDarkMode() {
  const root = document.documentElement;
  if (!root.classList.contains("dark")) {
    root.classList.add("dark");
  }
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", "#161b3d");
  // Remove legacy flag so we're not tempted to read it elsewhere.
  localStorage.removeItem("darkModeEnabled");
}
function initializeTheme() {
  const body = document.getElementById("bodyRoot") || document.body;

  // Classes that must ALWAYS be present, no matter which theme is selected
  const BASE_BODY_CLASSES = [
    "bg-gray-900",
    "text-white",
    "min-h-screen",
    "transition-colors", "duration-300",
    "liquid-glass"
  ];
  const baseClassString = BASE_BODY_CLASSES.join(" ");

  const ensureBaseClasses = (themeString) => {
    const tokens = new Set((themeString || "").split(/\s+/).filter(Boolean));
    let mutated = false;
    const deprecated = ["bg-white", "text-gray-800", "dark:bg-gray-900", "dark:text-white"];
    const dynamicCompatibility = [IOS_STANDALONE_SAFE_AREA_FALLBACK_CLASS, APP_CONTENT_OVERFLOWS_CLASS];
    for (const cls of deprecated) {
      if (tokens.delete(cls)) mutated = true;
    }
    for (const cls of dynamicCompatibility) {
      if (tokens.delete(cls)) mutated = true;
    }
    for (const cls of BASE_BODY_CLASSES) {
      if (!tokens.has(cls)) {
        tokens.add(cls);
        mutated = true;
      }
    }
    return { normalized: Array.from(tokens).join(" "), mutated };
  };

  // ------------------------------------------------------------------
  //  One-time migration for themes stored by older app versions
  // ------------------------------------------------------------------
  // Only theme tokens and the base classes are honoured; anything else stored
  // (a bad import, a synced value from another app) must not blank the app.
  const storedTheme = getLocalStorage(THEME_KEY, "");
  const savedTheme = typeof storedTheme === "string"
    ? storedTheme.split(/\s+/).filter(token => BASE_BODY_CLASSES.includes(token) || /^theme-[a-z0-9-]+$/i.test(token)).join(" ")
    : "";
  // Re-running after a cloud merge only swaps theme tokens. Every other body class
  // is live screen state (an open sheet, Home, first-run onboarding); dropping
  // home-open hides Home and leaves the inert scoreboard showing, frozen.
  const liveClasses = Array.from(body.classList).filter(cls => !/^theme-/i.test(cls));

  if (savedTheme) {
    const { normalized, mutated } = ensureBaseClasses(savedTheme);
    if ((mutated || savedTheme !== storedTheme) && normalized !== storedTheme) {
      setLocalStorage(THEME_KEY, normalized);
    }
    body.className = normalized;
    liveClasses.forEach(cls => body.classList.add(cls));
    syncViewportCompatibilityClasses();
    return;
  }

  // ------------------------------------------------------------------
  //  Apply the theme (or fall back to default)
  // ------------------------------------------------------------------
  // First launch / user has never customised a theme
  body.className = `${baseClassString} theme-blue-red theme-cartoony`.trim();
  liveClasses.forEach(cls => body.classList.add(cls));
  syncViewportCompatibilityClasses();
}
function isValidHexColor(colorString) {
  if (!colorString || typeof colorString !== 'string') return false;
  // Basic hex color validation (e.g., #RRGGBB or #RGB)
  return /^#([0-9A-F]{3}){1,2}$/i.test(colorString);
}

function sanitizeHexColor(colorString) {
  if (typeof colorString !== 'string') return '';
  const trimmed = colorString.trim();
  if (!trimmed) return '';
  const withoutQuotes = trimmed.replace(/^['"]+|['"]+$/g, '');
  if (!withoutQuotes) return '';
  const candidate = withoutQuotes.startsWith('#') ? withoutQuotes : `#${withoutQuotes}`;
  if (!isValidHexColor(candidate)) return '';
  // Color inputs only accept the six-digit form; "#f00" would otherwise be read as black.
  return candidate.length === 4
    ? `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`.toLowerCase()
    : candidate.toLowerCase();
}

// --- Readable text for any team colour ---
// Players pick any colour for each side, so the app cannot assume white text works on it, or that the
// colour itself reads as text on the dark glass. Each colour gets companions, set on the page whenever
// the colour is (and from the first frame by the boot script in index.html, which mirrors this):
//   --primary-ink / --accent-ink   text to put ON the colour (white, or near-black on light colours)
//   --primary-text / --accent-text the colour as text ON the dark surface (lifted when it is too dark)
//   --primary-action               the primary deepened until white button text reads on it (AA)
//   --avatar-ink                   initials on the avatar gradient, which blends both colours
// Colours that already read (the defaults, any mid-tone) come through unchanged.
const TEAM_TEXT_SURFACE_LUMINANCE = 0.0108; // #12183a, the dark glass team-coloured text sits on
const TEAM_INK_LIGHT = "#ffffff";
const TEAM_INK_DARK = "#0b1020";
const TEAM_INK_WHITE_MIN_CONTRAST = 2.5; // below this white text is washed out and dark text takes over
const TEAM_AVATAR_WHITE_MIN_CONTRAST = 1.8; // initials carry a text shadow, so they tolerate a little less

function getTeamColorChannels(hex) {
  const clean = sanitizeHexColor(hex);
  return clean ? [1, 3, 5].map(index => parseInt(clean.slice(index, index + 2), 16)) : null;
}
function getTeamColorLuminance(channels) {
  const [red, green, blue] = channels.map(value => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : Math.pow((unit + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
function getTeamColorContrast(first, second) {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
// Like color-mix(in srgb, base, other weight%): the share of `other` is `weight` (0 to 1).
function mixTeamColor(base, other, weight) {
  const from = getTeamColorChannels(base);
  const to = getTeamColorChannels(other);
  const hex = value => Math.round(value).toString(16).padStart(2, "0");
  return `#${[0, 1, 2].map(i => hex(from[i] * (1 - weight) + to[i] * weight)).join("")}`;
}
function getTeamColorTokens(hex) {
  const color = sanitizeHexColor(hex);
  if (!color) return null;
  const luminance = getTeamColorLuminance(getTeamColorChannels(color));
  const ink = getTeamColorContrast(1, luminance) >= TEAM_INK_WHITE_MIN_CONTRAST ? TEAM_INK_LIGHT : TEAM_INK_DARK;
  let text = color;
  for (let weight = 0.1; weight <= 1 && getTeamColorContrast(getTeamColorLuminance(getTeamColorChannels(text)), TEAM_TEXT_SURFACE_LUMINANCE) < 4.5; weight += 0.1) {
    text = mixTeamColor(color, "#ffffff", weight);
  }
  let action = mixTeamColor(color, "#0a1030", 0.32);
  for (let weight = 0.36; weight <= 0.96 && getTeamColorContrast(1, getTeamColorLuminance(getTeamColorChannels(action))) < 4.5; weight += 0.04) {
    action = mixTeamColor(color, "#0a1030", weight);
  }
  return { ink, text, action };
}
function getTeamAvatarInk(usHex, demHex) {
  const readsWithWhite = hex => {
    const color = sanitizeHexColor(hex);
    return !color || getTeamColorContrast(1, getTeamColorLuminance(getTeamColorChannels(mixTeamColor(color, "#ffffff", 0.22)))) >= TEAM_AVATAR_WHITE_MIN_CONTRAST;
  };
  return readsWithWhite(usHex) && readsWithWhite(demHex) ? TEAM_INK_LIGHT : TEAM_INK_DARK;
}
// Derives the companions from the team colours on the page right now.
function syncTeamColorTokens() {
  const body = document.getElementById("bodyRoot");
  if (!body || !body.style || typeof body.style.setProperty !== "function" || typeof body.style.getPropertyValue !== "function") return;
  const root = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => sanitizeHexColor(body.style.getPropertyValue(name)) || sanitizeHexColor(root.getPropertyValue(name)) || fallback;
  const us = pick("--primary-color", "#4f8cff");
  const dem = pick("--accent-color", "#ff5c5c");
  const usTokens = getTeamColorTokens(us);
  const demTokens = getTeamColorTokens(dem);
  body.style.setProperty("--primary-ink", usTokens.ink);
  body.style.setProperty("--primary-text", usTokens.text);
  body.style.setProperty("--primary-action", usTokens.action);
  body.style.setProperty("--accent-ink", demTokens.ink);
  body.style.setProperty("--accent-text", demTokens.text);
  body.style.setProperty("--avatar-ink", getTeamAvatarInk(us, dem));
}

function initializeCustomThemeColors() {
  const rootStyles = getComputedStyle(document.documentElement);
  const defaultUsColor = rootStyles.getPropertyValue('--primary-color').trim() || "#3b82f6";
  const defaultDemColor = rootStyles.getPropertyValue('--accent-color').trim() || "#ef4444";

  const storedUsColor = getLocalStorage('customUsColor', '');
  const storedDemColor = getLocalStorage('customDemColor', '');

  const body = document.getElementById('bodyRoot');
  const usPicker = document.getElementById('usColorPicker');
  const demPicker = document.getElementById('demColorPicker');

  const usColor = sanitizeHexColor(storedUsColor);
  if (usColor) {
    if (storedUsColor !== usColor) setLocalStorage('customUsColor', usColor);
    if (body) body.style.setProperty('--primary-color', usColor);
    if (usPicker) usPicker.value = usColor;
  } else {
    if (localStorage.getItem('customUsColor') !== null) { // Warn only when a value existed
      console.warn(`Invalid customUsColor ("${storedUsColor}") in localStorage. Using default.`);
      removeLocalStorageKey('customUsColor');
    }
    if (body) body.style.setProperty('--primary-color', defaultUsColor);
    if (usPicker) usPicker.value = defaultUsColor;
  }

  const demColor = sanitizeHexColor(storedDemColor);
  if (demColor) {
    if (storedDemColor !== demColor) setLocalStorage('customDemColor', demColor);
    if (body) body.style.setProperty('--accent-color', demColor);
    if (demPicker) demPicker.value = demColor;
  } else {
    if (localStorage.getItem('customDemColor') !== null) {
      console.warn(`Invalid customDemColor ("${storedDemColor}") in localStorage. Using default.`);
      removeLocalStorageKey('customDemColor');
    }
    if (body) body.style.setProperty('--accent-color', defaultDemColor);
    if (demPicker) demPicker.value = defaultDemColor;
  }
  syncTeamColorTokens();
  updatePreview(); // Ensure preview matches
}
function applyCustomThemeColors() {
  const body = document.getElementById('bodyRoot');
  const usPicker = document.getElementById('usColorPicker');
  const demPicker = document.getElementById('demColorPicker');

  const usColor = sanitizeHexColor(usPicker ? usPicker.value : '');
  const demColor = sanitizeHexColor(demPicker ? demPicker.value : '');

  if (usColor) {
    if (body) body.style.setProperty('--primary-color', usColor);
    setLocalStorage('customUsColor', usColor);
  } else {
    removeLocalStorageKey('customUsColor');
  }

  if (demColor) {
    if (body) body.style.setProperty('--accent-color', demColor);
    setLocalStorage('customDemColor', demColor);
  } else {
    removeLocalStorageKey('customDemColor');
  }

  syncTeamColorTokens();
  closeThemeModal(null); // Pass null if event is not available or needed
}
// The look the app ships with (the stylesheet's own team colours), not a copy that can drift from it.
function getDefaultTeamColors() {
  const root = getComputedStyle(document.documentElement);
  return {
    us: sanitizeHexColor(root.getPropertyValue('--primary-color')) || "#4f8cff",
    dem: sanitizeHexColor(root.getPropertyValue('--accent-color')) || "#ff5c5c",
  };
}
// Like every other control here, Reset only moves the pickers; "Nothing changes until you tap Apply".
function resetThemeColors() {
  const defaults = getDefaultTeamColors();
  document.getElementById('usColorPicker').value = defaults.us;
  document.getElementById('demColorPicker').value = defaults.dem;
  updatePreview();
}
function hslToHex(h, s, l) { // Helper for random colors
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [0, 8, 4].map(n => Math.round(f(n) * 255).toString(16).padStart(2, '0')).join('');
}
function randomizeThemeColors() {
  const h = Math.floor(Math.random() * 360);
  const s = Math.floor(Math.random() * 51) + 50; // Saturation 50-100%
  const l = Math.floor(Math.random() * 41) + 30; // Lightness 30-70%
  document.getElementById('usColorPicker').value = hslToHex(h, s, l);
  document.getElementById('demColorPicker').value = hslToHex((h + 180) % 360, s, l); // Complementary
  updatePreview();
}
function selectThemePreset(button) {
  document.getElementById('usColorPicker').value = button.dataset.us;
  document.getElementById('demColorPicker').value = button.dataset.dem;
  updatePreview();
}
// Weighted RGB distance; below ~80 the two teams are hard to tell apart.
function themeColorsLookAlike(a, b) {
  const [x, y] = [a, b].map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
  const [dr, dg, db] = [0, 1, 2].map(i => x[i] - y[i]);
  const r = (x[0] + y[0]) / 512;
  return (2 + r) * dr * dr + 4 * dg * dg + (3 - r) * db * db < 6400;
}
function updatePreview() {
  const modal = document.getElementById('themeModal');
  const colors = { us: document.getElementById('usColorPicker')?.value, dem: document.getElementById('demColorPicker')?.value };
  if (!modal || !colors.us || !colors.dem) return;
  for (const team of ['us', 'dem']) {
    modal.style.setProperty(`--preview-${team}`, colors[team]);
    const previewInk = (getTeamColorTokens(colors[team]) || { ink: TEAM_INK_LIGHT }).ink;
    modal.querySelectorAll(`[data-theme-team="${team}"]`).forEach(el => {
      el.style.setProperty('--team', colors[team]);
      el.style.setProperty('--team-ink', previewInk);
    });
    document.getElementById(`${team}ColorHex`).textContent = colors[team].toUpperCase();
  }
  modal.querySelectorAll('.theme-preset').forEach(button => {
    button.setAttribute('aria-pressed', button.dataset.us === colors.us && button.dataset.dem === colors.dem);
  });
  document.getElementById('themeContrastNote').classList.toggle('hidden', !themeColorsLookAlike(colors.us, colors.dem));
}
function openThemeModal(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  document.getElementById("settingsModal")?.classList.add("hidden");
  initializeCustomThemeColors(); // Ensure pickers and preview are up-to-date
  openSheetModal("themeModal", () => closeThemeModal(null));
}
function closeThemeModal(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  if (document.getElementById("themeModal")?.classList.contains("hidden") !== false) return;
  // Show Settings first so closing the sheet keeps the modal environment active.
  document.getElementById("settingsModal")?.classList.remove("hidden");
  closeSheetModal("themeModal");
}
// Routine saves are silent; this toast only surfaces problems the user must know about.
function showWarningToast(message) {
  const el = document.getElementById("saveIndicator");
  if (!el) return;
  clearTimeout(el.hideTimer);
  clearTimeout(el.removeTimer);
  el.textContent = message;
  el.classList.remove("hidden");
  // #saveIndicator.hidden is display:none; flush style so the rendered
  // opacity-0 state is the transition's start point, then slide in next frame.
  void el.offsetWidth;
  (window.requestAnimationFrame || setTimeout)(() => el.classList.add("show"));
  el.hideTimer = setTimeout(() => {
    el.classList.remove("show");
    el.removeTimer = setTimeout(() => el.classList.add("hidden"), 300);
  }, 1800);
}
