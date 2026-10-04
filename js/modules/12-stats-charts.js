"use strict";

// --- Statistics charts ---
// Hand-built SVG and HTML chart markup (no chart library). Every builder returns
// a string, escapes everything it prints, and pairs the picture with a table for
// screen readers. Each mark carries its own tooltip text in `data-tip`
// ("title\nvalue\ndetail"), so one small interaction layer (statsInitCharts)
// serves press, drag-to-scrub, and arrow keys for all of them.

let statsChartSerial = 0;

const STATS_ICONS = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/>',
  snow: '<path d="M12 2v20M4.9 6.5l14.2 11M4.9 17.5l14.2-11M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5"/>',
  crown: '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7ZM5 20h14"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1ZM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1ZM7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  swords: '<path d="M4 4l16 16M20 4 4 20M4 4h5M4 4v5M20 4h-5M20 4v5"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  trend: '<path d="M3 20h18M5 15l4-5 4 3 6-7"/><path d="M15 6h4v4"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  sortDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  sortUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  list: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  close: '<path d="M6 18 18 6M6 6l12 12"/>',
  search: '<path d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};

function statsIcon(name, className = "") {
  return `<svg class="ui-icon${className ? ` ${className}` : ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${STATS_ICONS[name] || ""}</svg>`;
}

// --- Scales ---
// Round axis limits to 1-2-5 steps so ticks read as 0 / 50 / 100, never 0 / 47 / 94.
function statsNiceStep(range, target) {
  const rough = range / target;
  const exp = Math.floor(Math.log10(rough));
  const base = rough / 10 ** exp;
  return (base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10) * 10 ** exp;
}

// Ticks are counted out rather than accumulated, so no range can make the loop stall.
function statsTicks(min, max, step) {
  const count = Math.min(60, Math.max(1, Math.round((max - min) / step)));
  return Array.from({ length: count + 1 }, (unused, i) => Number((min + i * step).toFixed(10)));
}

function statsNiceScale(maxValue, target = 3) {
  if (!(maxValue > 0) || !Number.isFinite(maxValue)) return { max: 1, step: 0.5, ticks: [0, 0.5, 1] };
  const step = statsNiceStep(maxValue, target);
  const max = Math.ceil(maxValue / step - 1e-9) * step;
  return { max, step, ticks: statsTicks(0, max, step) };
}

// Same idea for an axis that does not start at zero (ratings sit near 1000).
function statsNiceRange(low, high, target = 3) {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { min: 0, max: 1, step: 0.5, ticks: [0, 0.5, 1] };
  // A series flatter than a hair is a flat line: give it room to draw.
  if (!(high - low > Math.max(1e-6, Math.abs(high) * 1e-9))) {
    const pad = Math.max(1, Math.abs(high) * 0.05);
    return statsNiceRange(low - pad, high + pad, target);
  }
  const step = statsNiceStep(high - low, target);
  const min = Math.floor(low / step + 1e-9) * step;
  const max = Math.ceil(high / step - 1e-9) * step;
  return { min, max, step, ticks: statsTicks(min, max, step) };
}

const statsNum = value => (Number.isFinite(value) ? Number(value.toFixed(1)) : 0);
const statsPx = value => Number(value.toFixed(1));

// --- Shared bits ---
function statsTip(title, value, detail = "") {
  return [title, value, detail].filter((part, i) => i < 2 || part).join("\n");
}

// The screen-reader twin of a chart: the same numbers, as a table.
function statsDataTable(caption, headers, rows) {
  const head = headers.map(header => `<th scope="col">${escapeHtmlValue(header)}</th>`).join("");
  // Every row is as wide as the header, so a missing detail never leaves a ragged table.
  const body = rows.map(row => {
    const cells = row.slice(1);
    while (cells.length < headers.length - 1) cells.push("");
    return `<tr><th scope="row">${escapeHtmlValue(row[0])}</th>${cells.map(cell => `<td>${escapeHtmlValue(cell)}</td>`).join("")}</tr>`;
  }).join("");
  return `<table class="sr-only"><caption>${escapeHtmlValue(caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function statsFigure(kind, aria, inner, table, extraClass = "") {
  return `<figure class="st-chart st-chart--${kind}${extraClass ? ` ${extraClass}` : ""}" data-chart="${kind}" tabindex="0" role="group" aria-label="${escapeAttribute(aria)} Use the arrow keys to read each value.">${inner}${table}<div class="st-tip" role="status" aria-live="polite" hidden></div></figure>`;
}

// A column with a rounded data end and a square baseline. y1 is the data end.
function statsColumnPath(x, width, y1, y2, radius = 4) {
  const height = Math.abs(y2 - y1);
  if (height < 0.4) return `M${statsPx(x)} ${statsPx(y2)}h${statsPx(width)}v0.8h-${statsPx(width)}Z`;
  const r = Math.min(radius, width / 2, height);
  const [x0, x1, a, b] = [statsPx(x), statsPx(x + width), statsPx(y1), statsPx(y2)];
  const sign = y1 <= y2 ? 1 : -1;
  return `M${x0} ${b}V${statsPx(y1 + sign * r)}Q${x0} ${a} ${statsPx(x + r)} ${a}H${statsPx(x + width - r)}Q${x1} ${a} ${x1} ${statsPx(y1 + sign * r)}V${b}Z`;
}

// --- Columns ---
// items: { label, sub, value, display, detail, tone, faded }
function statsBarsChart({ items, max, ticks, reference = null, aria, caption, headers, valueHeader = "Value", labelEvery = 1, formatTick = String }) {
  const W = 340, H = 180, L = 34, R = 8, T = 16, B = 44;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const scale = ticks ? { max: max || ticks[ticks.length - 1], ticks } : statsNiceScale(Math.max(...items.map(item => item.value), 0));
  const domain = max || scale.max;
  const slot = plotW / items.length;
  const barWidth = Math.min(24, slot * 0.62);
  const y = value => T + plotH * (1 - Math.min(domain, Math.max(0, value)) / domain);
  const base = y(0);
  const top = items.reduce((best, item, i) => (item.value > (items[best]?.value ?? -Infinity) ? i : best), 0);

  const grid = scale.ticks.map(tick => `
    <line class="st-grid${tick === 0 ? " st-grid--base" : ""}" x1="${L}" x2="${W - R}" y1="${statsPx(y(tick))}" y2="${statsPx(y(tick))}"/>
    <text class="st-axis" x="${L - 6}" y="${statsPx(y(tick) + 3.5)}" text-anchor="end">${escapeHtmlValue(formatTick(tick))}</text>`).join("");

  const marks = items.map((item, i) => {
    const cx = L + slot * (i + 0.5);
    const x = cx - barWidth / 2;
    const tone = item.tone || "blue";
    const barTop = Math.min(base - 2, y(item.value));
    const bar = item.value > 0
      ? `<path class="st-bar st-bar--${tone}${item.faded ? " is-faded" : ""}" data-i="${i}" d="${statsColumnPath(x, barWidth, barTop, base)}"/>` : "";
    const label = i % labelEvery === 0
      ? `<text class="st-axis" x="${statsPx(cx)}" y="${H - B + 14}" text-anchor="middle">${escapeHtmlValue(item.label)}</text>${item.sub ? `<text class="st-axis st-axis--sub" x="${statsPx(cx)}" y="${H - B + 26}" text-anchor="middle">${escapeHtmlValue(item.sub)}</text>` : ""}` : "";
    const value = i === top && item.value > 0
      ? `<text class="st-value" x="${statsPx(cx)}" y="${statsPx(Math.max(T - 2, barTop - 5))}" text-anchor="middle">${escapeHtmlValue(item.display)}</text>` : "";
    const hit = `<rect class="st-hit" data-i="${i}" x="${statsPx(L + slot * i)}" y="${T}" width="${statsPx(slot)}" height="${statsPx(plotH + B - 6)}" data-x="${statsPx(cx)}" data-y="${statsPx(item.value > 0 ? barTop : base - 2)}" data-tip="${escapeAttribute(statsTip(item.title || item.label, item.display, item.detail))}"/>`;
    return `${bar}${label}${value}${hit}`;
  }).join("");

  const ref = reference && Number.isFinite(reference.value)
    ? `<line class="st-ref" x1="${L}" x2="${W - R}" y1="${statsPx(y(reference.value))}" y2="${statsPx(y(reference.value))}"/><text class="st-ref-label" x="${W - R}" y="${statsPx(y(reference.value) - 4)}" text-anchor="end">${escapeHtmlValue(reference.label)}</text>` : "";

  const table = statsDataTable(caption, [headers[0], valueHeader, ...headers.slice(1)], items.map(item => [item.title || item.label, item.display, ...(item.detailCells || [])]));
  return statsFigure("bars", aria, `<svg viewBox="0 0 ${W} ${H}" focusable="false" aria-hidden="true">${grid}${ref}${marks}</svg>`, table);
}

// Columns above and below a zero line. items: { label, value, display, detail, tone }
function statsDivergingChart({ items, aria, caption, headers, valueHeader = "Value", labelEvery = 1, formatTick = value => String(value) }) {
  const W = 340, H = 168, L = 34, R = 8, T = 14, B = 26;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const scale = statsNiceScale(Math.max(...items.map(item => Math.abs(item.value)), 1), 2);
  const mid = T + plotH / 2;
  const y = value => mid - (value / scale.max) * (plotH / 2);
  const slot = plotW / items.length;
  const barWidth = Math.min(20, slot * 0.66);

  const grid = [-scale.max, 0, scale.max].map(tick => `
    <line class="st-grid${tick === 0 ? " st-grid--base" : ""}" x1="${L}" x2="${W - R}" y1="${statsPx(y(tick))}" y2="${statsPx(y(tick))}"/>
    <text class="st-axis" x="${L - 6}" y="${statsPx(y(tick) + 3.5)}" text-anchor="end">${escapeHtmlValue(formatTick(tick))}</text>`).join("");

  const marks = items.map((item, i) => {
    const cx = L + slot * (i + 0.5);
    const tone = item.tone || (item.value >= 0 ? "aqua" : "orange");
    const end = y(item.value);
    const bar = `<path class="st-bar st-bar--${tone}${item.value < 0 ? " st-bar--down" : ""}" data-i="${i}" d="${statsColumnPath(cx - barWidth / 2, barWidth, end, mid, 3)}"/>`;
    const label = i % labelEvery === 0 || i === items.length - 1
      ? `<text class="st-axis" x="${statsPx(cx)}" y="${H - B + 15}" text-anchor="middle">${escapeHtmlValue(item.label)}</text>` : "";
    const hit = `<rect class="st-hit" data-i="${i}" x="${statsPx(L + slot * i)}" y="${T}" width="${statsPx(slot)}" height="${statsPx(plotH + B - 6)}" data-x="${statsPx(cx)}" data-y="${statsPx(end)}" data-tip="${escapeAttribute(statsTip(item.title || item.label, item.display, item.detail))}"/>`;
    return `${bar}${label}${hit}`;
  }).join("");

  const table = statsDataTable(caption, [headers[0], valueHeader, ...headers.slice(1)], items.map(item => [item.title || item.label, item.display, ...(item.detailCells || [])]));
  return statsFigure("diverging", aria, `<svg viewBox="0 0 ${W} ${H}" focusable="false" aria-hidden="true">${grid}${marks}</svg>`, table);
}

// --- Line ---
// points: { value, label, display, detail }. `baseline` draws a quiet reference line.
function statsLineChart({ points, baseline = null, baselineLabel = "", aria, caption, headers, valueHeader = "Value", formatTick = value => String(Math.round(value)), xLabels = null }) {
  const W = 340, H = 172, L = 40, R = 18, T = 18, B = 28;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const values = points.map(point => point.value).concat(Number.isFinite(baseline) ? [baseline] : []);
  const range = statsNiceRange(Math.min(...values), Math.max(...values), 3);
  const x = i => L + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const y = value => T + plotH * (1 - (value - range.min) / (range.max - range.min));
  const coords = points.map((point, i) => `${statsPx(x(i))},${statsPx(y(point.value))}`);
  const line = `M${coords.join("L")}`;
  const area = `${line}L${statsPx(x(points.length - 1))},${statsPx(T + plotH)}L${statsPx(x(0))},${statsPx(T + plotH)}Z`;
  const last = points.length - 1;

  const grid = range.ticks.map(tick => `
    <line class="st-grid${tick === range.min ? " st-grid--base" : ""}" x1="${L}" x2="${W - R}" y1="${statsPx(y(tick))}" y2="${statsPx(y(tick))}"/>
    <text class="st-axis" x="${L - 6}" y="${statsPx(y(tick) + 3.5)}" text-anchor="end">${escapeHtmlValue(formatTick(tick))}</text>`).join("");
  const ref = Number.isFinite(baseline)
    ? `<line class="st-ref" x1="${L}" x2="${W - R}" y1="${statsPx(y(baseline))}" y2="${statsPx(y(baseline))}"/><text class="st-ref-label" x="${W - R}" y="${statsPx(y(baseline) - 4)}" text-anchor="end">${escapeHtmlValue(baselineLabel)}</text>` : "";
  const step = Math.max(1, Math.ceil(last / 5));
  const axis = (xLabels || points.map(point => point.axis || "")).map((label, i) => (
    label && (i === 0 || i === last || i % step === 0) && (last - i >= step || i === last)
      ? `<text class="st-axis" x="${statsPx(x(i))}" y="${H - B + 16}" text-anchor="${i === 0 ? "start" : i === last ? "end" : "middle"}">${escapeHtmlValue(label)}</text>` : ""
  )).join("");
  const band = plotW / Math.max(1, points.length - 1);
  const hits = points.map((point, i) => {
    const left = Math.max(0, x(i) - band / 2);
    const right = Math.min(W, x(i) + band / 2);
    return `<rect class="st-hit" data-i="${i}" x="${statsPx(left)}" y="${T - 6}" width="${statsPx(right - left)}" height="${statsPx(plotH + 12)}" data-x="${statsPx(x(i))}" data-y="${statsPx(y(point.value))}" data-tip="${escapeAttribute(statsTip(point.label, point.display, point.detail))}"/>`;
  }).join("");
  // Markers on a long series would chop the line into dashes; the readout and end dot carry it.
  const showDots = points.length <= 12;
  const dots = points.map((point, i) => (showDots && i !== last ? `<circle class="st-dot" data-i="${i}" cx="${statsPx(x(i))}" cy="${statsPx(y(point.value))}" r="3"/>` : "")).join("");

  const table = statsDataTable(caption, [headers[0], valueHeader, ...headers.slice(1)], points.map(point => [point.label, point.display, ...(point.detailCells || [])]));
  const svg = `<svg viewBox="0 0 ${W} ${H}" focusable="false" aria-hidden="true">
    ${grid}${ref}
    <path class="st-area" d="${area}"/>
    <path class="st-line" d="${line}" pathLength="1"/>
    ${dots}
    <circle class="st-dot st-dot--end" cx="${statsPx(x(last))}" cy="${statsPx(y(points[last].value))}" r="4.5"/>
    <text class="st-value" x="${statsPx(x(last) - 8)}" y="${statsPx(Math.max(T - 4, y(points[last].value) - 9))}" text-anchor="end">${escapeHtmlValue(points[last].display)}</text>
    <line class="st-cross" x1="0" x2="0" y1="${T}" y2="${T + plotH}" hidden/>
    <circle class="st-cross-dot" cx="0" cy="0" r="5.5" hidden/>
    ${axis}${hits}
  </svg>`;
  return statsFigure("line", aria, svg, table);
}

// --- Scatter ---
// One dot per player. points: { key, label, name, x, y, detail }. The dashed-free
// guides mark the group average on each axis so "bold" and "safe" mean something.
function statsScatterChart({ points, refX = null, refY = null, aria, caption, headers, valueHeader, xLabel, yLabel }) {
  const W = 340, H = 232, L = 40, R = 16, T = 14, B = 42;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const xs = points.map(point => point.x).concat(Number.isFinite(refX) ? [refX] : []);
  const ys = points.map(point => point.y).concat(Number.isFinite(refY) ? [refY] : []);
  // Players bid alike, so the axes hug the data; otherwise every dot lands in one blob.
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const xr = statsNiceRange(Math.min(...xs) - Math.max(2, spanX * 0.15), Math.max(...xs) + Math.max(2, spanX * 0.15), 4);
  const yr = statsNiceRange(Math.max(0, Math.min(...ys) - Math.max(3, spanY * 0.15)), Math.min(100, Math.max(...ys) + Math.max(3, spanY * 0.15)), 4);
  const yMax = Math.min(100, yr.max);
  const x = value => L + plotW * ((value - xr.min) / (xr.max - xr.min));
  const y = value => T + plotH * (1 - (value - yr.min) / (yMax - yr.min));
  const grid = yr.ticks.filter(tick => tick <= yMax).map(tick => `
    <line class="st-grid${tick === yr.min ? " st-grid--base" : ""}" x1="${L}" x2="${W - R}" y1="${statsPx(y(tick))}" y2="${statsPx(y(tick))}"/>
    <text class="st-axis" x="${L - 6}" y="${statsPx(y(tick) + 3.5)}" text-anchor="end">${tick}%</text>`).join("")
    + xr.ticks.map(tick => `<text class="st-axis" x="${statsPx(x(tick))}" y="${H - B + 15}" text-anchor="middle">${tick}</text>`).join("");
  const guides = (Number.isFinite(refX) ? `<line class="st-ref" x1="${statsPx(x(refX))}" x2="${statsPx(x(refX))}" y1="${T}" y2="${T + plotH}"/><text class="st-ref-label" x="${statsPx(x(refX) + 4)}" y="${T + plotH - 4}">avg bid</text>` : "")
    + (Number.isFinite(refY) ? `<line class="st-ref" x1="${L}" x2="${W - R}" y1="${statsPx(y(refY))}" y2="${statsPx(y(refY))}"/><text class="st-ref-label" x="${W - R}" y="${statsPx(y(refY) - 4)}" text-anchor="end">avg made</text>` : "");
  const dots = points.map((point, i) => {
    const cx = statsPx(x(point.x));
    const cy = statsPx(y(point.y));
    const tip = escapeAttribute(statsTip(point.name, `${Math.round(point.y)}% made`, point.detail));
    return `<g class="st-scatter__dot" data-i="${i}"><circle class="st-scatter__fill" cx="${cx}" cy="${cy}" r="9.5"/><text class="st-scatter__label" x="${cx}" y="${statsPx(y(point.y) + 3.4)}" text-anchor="middle">${escapeHtmlValue(point.label)}</text></g>
      <circle class="st-hit" data-i="${i}" cx="${cx}" cy="${cy}" r="14" data-x="${cx}" data-y="${statsPx(y(point.y) - 9.5)}" data-tip="${tip}" data-open-entity="player" data-entity-key="${escapeAttribute(point.key)}"/>`;
  }).join("");
  const axisTitles = `<text class="st-axis st-axis--title" x="${statsPx(L + plotW / 2)}" y="${H - 4}" text-anchor="middle">${escapeHtmlValue(xLabel)} →</text><text class="st-axis st-axis--title" transform="translate(11 ${statsPx(T + plotH / 2)}) rotate(-90)" text-anchor="middle">${escapeHtmlValue(yLabel)} →</text>`;
  const table = statsDataTable(caption, [headers[0], headers[1], valueHeader], points.map(point => [point.name, String(Math.round(point.x)), `${Math.round(point.y)}%`]));
  return statsFigure("scatter", aria, `<svg viewBox="0 0 ${W} ${H}" focusable="false" aria-hidden="true">${grid}${guides}${dots}${axisTitles}</svg>`, table);
}

// --- Calendar heatmap ---
// One cell per day, weeks as columns (Sunday on top). `byDay` is { "2026-07-04": 3 }.
function statsHeatmap({ byDay, weeks, now, aria }) {
  const CELL = 10, GAP = 2.4, PITCH = CELL + GAP, LEFT = 18, TOP = 14;
  const today = new Date(now);
  const lastSunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  const firstSunday = new Date(lastSunday.getFullYear(), lastSunday.getMonth(), lastSunday.getDate() - (weeks - 1) * 7);
  const counts = Object.values(byDay);
  const peak = Math.max(1, ...counts);
  const levelOf = count => (count <= 0 ? 0 : Math.min(4, Math.ceil((count / peak) * 4)));
  const todayKey = statsDayKey(now);
  let cells = "";
  const months = [];
  const tableRows = [];
  let lastMonth = -1;
  let lastLabelColumn = -10;
  for (let col = 0; col < weeks; col++) {
    for (let row = 0; row < 7; row++) {
      const date = new Date(firstSunday.getFullYear(), firstSunday.getMonth(), firstSunday.getDate() + col * 7 + row);
      const key = statsDayKey(date.getTime());
      if (key > todayKey) continue;
      const count = byDay[key] || 0;
      const title = statsFormatDate(date.getTime(), { weekday: "short", month: "short", day: "numeric" });
      const display = count ? statsPlural(count, "game") : "No games";
      if (count) tableRows.push([title, display]);
      if (row === 0 && date.getMonth() !== lastMonth) {
        lastMonth = date.getMonth();
        // A month label needs about three columns of room.
        if (col - lastLabelColumn >= 3) {
          lastLabelColumn = col;
          months.push(`<text class="st-axis" x="${LEFT + col * PITCH}" y="9" text-anchor="start">${escapeHtmlValue(statsFormatDate(date.getTime(), { month: "short" }))}</text>`);
        }
      }
      cells += `<rect class="st-cell st-heat--${levelOf(count)}" data-c="${col}" data-r="${row}" x="${statsPx(LEFT + col * PITCH)}" y="${statsPx(TOP + row * PITCH)}" width="${CELL}" height="${CELL}" rx="2.4" data-i="${col * 7 + row}" data-tip="${escapeAttribute(statsTip(title, display))}" data-x="${statsPx(LEFT + col * PITCH + CELL / 2)}" data-y="${statsPx(TOP + row * PITCH)}"/>`;
    }
  }
  const rowLabels = [[1, "M"], [3, "W"], [5, "F"]].map(([row, text]) => `<text class="st-axis" x="0" y="${statsPx(TOP + row * PITCH + 8.5)}">${text}</text>`).join("");
  const width = LEFT + weeks * PITCH;
  const height = TOP + 7 * PITCH;
  const legend = [0, 1, 2, 3, 4].map(level => `<i class="st-heat-key st-heat--${level}"></i>`).join("");
  const table = statsDataTable(aria, ["Day", "Games"], tableRows);
  return `${statsFigure("heat", aria, `<svg viewBox="0 0 ${statsPx(width)} ${statsPx(height)}" focusable="false" aria-hidden="true">${months.join("")}${rowLabels}${cells}</svg>`, table)}
    <p class="st-heat-legend" aria-hidden="true"><span>Fewer</span>${legend}<span>More</span></p>`;
}

// --- Small pieces ---
function statsSparkline(values, { width = 96, height = 28 } = {}) {
  if (values.length < 2) return "";
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pad = 3;
  const x = i => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = value => height - pad - ((value - lo) / span) * (height - pad * 2);
  const path = values.map((value, i) => `${i ? "L" : "M"}${statsPx(x(i))} ${statsPx(y(value))}`).join("");
  const last = values.length - 1;
  return `<svg class="st-spark" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false"><path class="st-spark__line" d="${path}"/><circle class="st-spark__dot" cx="${statsPx(x(last))}" cy="${statsPx(y(values[last]))}" r="3"/></svg>`;
}

// Weekly counts as little columns, for the hero.
function statsMiniColumns(values, { width = 120, height = 34 } = {}) {
  const peak = Math.max(1, ...values);
  const slot = width / values.length;
  const barWidth = Math.max(3, slot - 3);
  const bars = values.map((value, i) => {
    const h = Math.max(value > 0 ? 3 : 1.5, (value / peak) * (height - 2));
    return `<rect class="st-mini${value > 0 ? "" : " is-zero"}" x="${statsPx(i * slot + (slot - barWidth) / 2)}" y="${statsPx(height - h)}" width="${statsPx(barWidth)}" height="${statsPx(h)}" rx="1.6"/>`;
  }).join("");
  return `<svg class="st-minicols" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">${bars}</svg>`;
}

function statsFormStrip(form, { limit = 5, size = "sm" } = {}) {
  const shown = form.slice(-limit);
  if (!shown.length) return "";
  const words = { W: "won", L: "lost", T: "tied" };
  const label = `Last ${shown.length} ${shown.length === 1 ? "game" : "games"}, oldest first: ${shown.map(result => words[result]).join(", ")}`;
  return `<span class="st-form st-form--${size}" role="img" aria-label="${escapeAttribute(label)}">${shown.map(result => `<i class="st-form__chip st-form__chip--${result.toLowerCase()}" aria-hidden="true">${result}</i>`).join("")}</span>`;
}

function statsMeter(percent, { tone = "blue", label = "" } = {}) {
  const value = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
  return `<span class="st-meter st-meter--${tone}"${label ? ` role="img" aria-label="${escapeAttribute(label)}"` : ' aria-hidden="true"'}><i style="width:${statsPx(value)}%"></i></span>`;
}

// Part-to-whole in one bar, with the legend that carries the numbers.
function statsStackedBar(segments, { aria }) {
  const shown = segments.filter(segment => segment.value > 0);
  const total = shown.reduce((sum, segment) => sum + segment.value, 0);
  if (!total) return "";
  const bar = shown.map(segment => `<i class="st-stack__seg st-tone--${segment.tone}" style="flex:${segment.value} 1 0"></i>`).join("");
  const legend = shown.map(segment => `<li><i class="st-swatch st-tone--${segment.tone}" aria-hidden="true"></i><span>${escapeHtmlValue(segment.label)}</span><b>${escapeHtmlValue(segment.display ?? String(segment.value))}</b><small>${Math.round((segment.value / total) * 100)}%</small></li>`).join("");
  return `<div class="st-stack" role="img" aria-label="${escapeAttribute(aria)}">${bar}</div><ul class="st-legend">${legend}</ul>`;
}

// Wins against losses in one bar (head to head).
function statsSplitBar(wins, losses, { aria }) {
  const total = wins + losses;
  if (!total) return `<span class="st-split st-split--empty" aria-hidden="true"></span>`;
  return `<span class="st-split" role="img" aria-label="${escapeAttribute(aria)}">${wins ? `<i class="st-split__win" style="flex:${wins} 1 0"></i>` : ""}${losses ? `<i class="st-split__loss" style="flex:${losses} 1 0"></i>` : ""}</span>`;
}

// How a game's lead moved, from the winner's side. Decorative: the row says it in words.
function statsTrajectory(gaps, { width = 112, height = 34 } = {}) {
  if (gaps.length < 2) return "";
  const reach = Math.max(60, ...gaps.map(gap => Math.abs(gap)));
  const pad = 3;
  const mid = height / 2;
  const x = i => pad + (i / (gaps.length - 1)) * (width - pad * 2);
  const y = gap => mid - (gap / reach) * (mid - pad);
  const points = gaps.map((gap, i) => `${statsPx(x(i))},${statsPx(y(gap))}`);
  const line = `M${points.join("L")}`;
  const area = `${line}L${statsPx(x(gaps.length - 1))},${statsPx(mid)}L${statsPx(x(0))},${statsPx(mid)}Z`;
  const id = `stt${++statsChartSerial}`;
  return `<svg class="st-traj" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
    <defs><clipPath id="${id}u"><rect x="0" y="0" width="${width}" height="${statsPx(mid)}"/></clipPath><clipPath id="${id}d"><rect x="0" y="${statsPx(mid)}" width="${width}" height="${statsPx(mid)}"/></clipPath></defs>
    <line class="st-grid st-grid--base" x1="${pad}" x2="${width - pad}" y1="${statsPx(mid)}" y2="${statsPx(mid)}"/>
    <path class="st-traj__up" d="${area}" clip-path="url(#${id}u)"/><path class="st-traj__down" d="${area}" clip-path="url(#${id}d)"/>
    <path class="st-traj__line" d="${line}"/>
    <circle class="st-traj__dot" cx="${statsPx(x(gaps.length - 1))}" cy="${statsPx(y(gaps[gaps.length - 1]))}" r="2.8"/>
  </svg>`;
}

// --- Interaction ---
// One set of listeners on a container serves every chart inside it, now and
// after any re-render. Marks are found with elementFromPoint so a finger
// dragged across a chart keeps updating, even though touch pins the event
// target to wherever the finger first landed.
function statsInitCharts(container) {
  if (!container || container.dataset.chartsBound === "true") return;
  container.dataset.chartsBound = "true";

  const hitsOf = figure => Array.from(figure.querySelectorAll("[data-tip]"));
  const hide = figure => {
    const tip = figure.querySelector(".st-tip");
    if (tip) tip.hidden = true;
    figure.querySelectorAll(".is-active").forEach(node => node.classList.remove("is-active"));
    // SVG elements have no `hidden` property, only the attribute.
    figure.querySelector(".st-cross")?.setAttribute("hidden", "");
    figure.querySelector(".st-cross-dot")?.setAttribute("hidden", "");
    delete figure.dataset.active;
  };
  const hideAll = except => container.querySelectorAll(".st-chart").forEach(figure => { if (figure !== except) hide(figure); });

  const show = (figure, hit) => {
    const tip = figure.querySelector(".st-tip");
    const svg = figure.querySelector("svg");
    if (!tip || !svg || !hit) return;
    const index = hit.getAttribute("data-i");
    figure.querySelectorAll(".is-active").forEach(node => node.classList.remove("is-active"));
    figure.querySelectorAll(`[data-i="${index}"]`).forEach(node => node.classList.add("is-active"));
    figure.dataset.active = index;

    const [title, value, detail] = (hit.getAttribute("data-tip") || "").split("\n");
    tip.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = value || "";
    const label = document.createElement("span");
    label.textContent = title || "";
    tip.append(strong, label);
    if (detail) {
      const small = document.createElement("small");
      small.textContent = detail;
      tip.append(small);
    }
    tip.hidden = false;

    const box = svg.getBoundingClientRect();
    const frame = figure.getBoundingClientRect();
    const view = svg.viewBox.baseVal;
    const scaleX = view && view.width ? box.width / view.width : 1;
    const scaleY = view && view.height ? box.height / view.height : 1;
    const ax = hit.getAttribute("data-x");
    const ay = hit.getAttribute("data-y");
    let left;
    let topEdge;
    if (ax !== null && ay !== null) {
      left = box.left - frame.left + Number(ax) * scaleX;
      topEdge = box.top - frame.top + Number(ay) * scaleY;
    } else {
      const rect = hit.getBoundingClientRect();
      left = rect.left - frame.left + rect.width / 2;
      topEdge = rect.top - frame.top;
    }
    const width = tip.offsetWidth || 90;
    const clamped = Math.min(Math.max(left, width / 2 + 4), Math.max(width / 2 + 4, frame.width - width / 2 - 4));
    tip.style.left = `${statsPx(clamped)}px`;
    const height = tip.offsetHeight || 44;
    const above = topEdge - height - 10;
    tip.style.top = `${statsPx(above < 0 ? topEdge + 16 : above)}px`;

    const cross = figure.querySelector(".st-cross");
    const dot = figure.querySelector(".st-cross-dot");
    if (cross && dot && ax !== null) {
      cross.setAttribute("x1", ax);
      cross.setAttribute("x2", ax);
      cross.removeAttribute("hidden");
      dot.setAttribute("cx", ax);
      dot.setAttribute("cy", ay);
      dot.removeAttribute("hidden");
    }
  };

  const hitAt = (figure, event) => {
    const node = document.elementFromPoint(event.clientX, event.clientY);
    const hit = node && node.closest ? node.closest("[data-tip]") : null;
    return hit && figure.contains(hit) ? hit : null;
  };

  // Reading a value takes a press (or a drag across the chart) or the arrow keys,
  // the same on a finger and a mouse; a tooltip stays until the next tap elsewhere.
  container.addEventListener("pointermove", event => {
    if (event.buttons === 0) return;
    const figure = event.target.closest && event.target.closest(".st-chart");
    if (!figure) return;
    const hit = hitAt(figure, event);
    if (hit) { hideAll(figure); show(figure, hit); }
  });
  container.addEventListener("pointerdown", event => {
    const figure = event.target.closest && event.target.closest(".st-chart");
    if (!figure) { hideAll(null); return; }
    hideAll(figure);
    const hit = hitAt(figure, event);
    if (hit) show(figure, hit);
  });
  container.addEventListener("focusout", event => {
    const figure = event.target.closest && event.target.closest(".st-chart");
    if (figure && !figure.contains(event.relatedTarget)) hide(figure);
  });
  container.addEventListener("keydown", event => {
    const figure = event.target.closest && event.target.closest(".st-chart");
    if (!figure || event.target !== figure) return;
    if (event.key === "Escape" && figure.dataset.active !== undefined) {
      event.stopPropagation();
      hide(figure);
      return;
    }
    const hits = hitsOf(figure);
    if (!hits.length) return;
    const current = figure.dataset.active === undefined ? -1 : hits.findIndex(hit => hit.getAttribute("data-i") === figure.dataset.active);
    // A dot that opens a player (the bidder map) opens from the keyboard too.
    if ((event.key === "Enter" || event.key === " ") && current >= 0 && hits[current].hasAttribute("data-open-entity")) {
      event.preventDefault();
      hits[current].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return;
    }
    let next = current;
    const vertical = figure.dataset.chart === "heat";
    if (event.key === "ArrowRight") next = vertical ? current + 7 : current + 1;
    else if (event.key === "ArrowLeft") next = vertical ? current - 7 : current - 1;
    else if (event.key === "ArrowDown" && vertical) next = current + 1;
    else if (event.key === "ArrowUp" && vertical) next = current - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = hits.length - 1;
    else return;
    event.preventDefault();
    next = Math.min(hits.length - 1, Math.max(0, next < 0 ? 0 : next));
    show(figure, hits[next]);
  });
}
