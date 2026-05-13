"use strict";

// --- Theme & UI Helpers ---
function enforceDarkMode() {
  const root = document.documentElement;
  if (!root.classList.contains("dark")) {
    root.classList.add("dark");
  }
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", "#24284f");
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
    for (const cls of deprecated) {
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
    return;
  }

  // ------------------------------------------------------------------
  //  Apply the theme (or fall back to default)
  // ------------------------------------------------------------------
  // First launch / user has never customised a theme
  body.className = `${baseClassString} theme-blue-red`.trim();
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
  document.getElementById('bodyRoot').style.setProperty('--primary-color', defaultUs);
  document.getElementById('bodyRoot').style.setProperty('--accent-color', defaultDem);
  removeLocalStorageKey('customUsColor');
  removeLocalStorageKey('customDemColor');
  const usPicker = document.getElementById('usColorPicker');
  const demPicker = document.getElementById('demColorPicker');
  if (usPicker) usPicker.value = defaultUs;
  if (demPicker) demPicker.value = defaultDem;
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
function updatePreview() {
  const usColor = document.getElementById('usColorPicker')?.value;
  const demColor = document.getElementById('demColorPicker')?.value;
  const previewUs = document.getElementById('previewUs');
  const previewDem = document.getElementById('previewDem');
  if (previewUs && usColor) previewUs.style.backgroundColor = usColor;
  if (previewDem && demColor) previewDem.style.backgroundColor = demColor;
}
 function openThemeModal(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  document.getElementById("settingsModal")?.classList.add("hidden");
  const themeModalEl = document.getElementById("themeModal");
  if (themeModalEl) {
      themeModalEl.classList.remove("hidden");
      const content = themeModalEl.querySelector(".bg-white, .dark\\:bg-gray-800");
      if (content) content.onclick = e => e.stopPropagation(); // Prevent closing on content click
      initializeCustomThemeColors(); // Ensure pickers and preview are up-to-date
  }
}
function closeThemeModal(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  document.getElementById("themeModal")?.classList.add("hidden");
  document.getElementById("settingsModal")?.classList.remove("hidden"); // Show settings modal again
}
function showSaveIndicator(message = "Saved") {
  const el = document.getElementById("saveIndicator");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden", "bg-red-600"); // Remove error class if present
  el.classList.add("show");
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.classList.add("hidden"), 150); }, 1000);
}
