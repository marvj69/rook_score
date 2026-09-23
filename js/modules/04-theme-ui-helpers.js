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
  const savedTheme = getLocalStorage(THEME_KEY, "");

  if (savedTheme) {
    const { normalized, mutated } = ensureBaseClasses(savedTheme);
    if (mutated && normalized !== savedTheme) {
      setLocalStorage(THEME_KEY, normalized);
    }
    body.className = normalized;
    syncViewportCompatibilityClasses();
    return;
  }

  // ------------------------------------------------------------------
  //  Apply the theme (or fall back to default)
  // ------------------------------------------------------------------
  // First launch / user has never customised a theme
  body.className = `${baseClassString} theme-blue-red theme-cartoony`.trim();
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
  return isValidHexColor(candidate) ? candidate : '';
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
    if (storedUsColor !== null) { // Warn only when a value existed
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
    if (storedDemColor !== null) {
      console.warn(`Invalid customDemColor ("${storedDemColor}") in localStorage. Using default.`);
      removeLocalStorageKey('customDemColor');
    }
    if (body) body.style.setProperty('--accent-color', defaultDemColor);
    if (demPicker) demPicker.value = defaultDemColor;
  }
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

  closeThemeModal(null); // Pass null if event is not available or needed
}
function resetThemeColors() {
  const defaultUs = "#3b82f6", defaultDem = "#ef4444";
  const bodyStyle = document.getElementById('bodyRoot').style;
  bodyStyle.setProperty('--primary-color', defaultUs);
  bodyStyle.setProperty('--accent-color', defaultDem);
  removeLocalStorageKey('customUsColor');
  removeLocalStorageKey('customDemColor');
  document.getElementById('usColorPicker').value = defaultUs;
  document.getElementById('demColorPicker').value = defaultDem;
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
    modal.querySelectorAll(`[data-theme-team="${team}"]`).forEach(el => el.style.setProperty('--team', colors[team]));
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
function showSaveIndicator(message = "Saved") {
  const el = document.getElementById("saveIndicator");
  if (!el) return;
  clearTimeout(el.hideTimer);
  clearTimeout(el.removeTimer);
  el.textContent = message;
  el.classList.remove("hidden");
  // Wait a frame after un-hiding so the slide-in transition runs.
  (window.requestAnimationFrame || setTimeout)(() => el.classList.add("show"));
  el.hideTimer = setTimeout(() => {
    el.classList.remove("show");
    el.removeTimer = setTimeout(() => el.classList.add("hidden"), 300);
  }, 1800);
}
