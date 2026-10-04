"use strict";

// --- Statistics screens ---
// The sheet's five tabs, the player/team profile, and the controls that drive
// them. Everything is drawn from getStatsModel(); this file never computes a
// statistic, it only decides how to show one. Loaded on demand with the engine
// and chart builders as js/stats.bundle.js.

const STATS_TABS = [
  { id: "overview", label: "Overview" },
  { id: "players", label: "Players" },
  { id: "teams", label: "Teams" },
  { id: "bidding", label: "Bidding" },
  { id: "records", label: "Records" },
];

const STATS_GAME_LISTS = [
  { id: "closest", label: "Closest", empty: "No finished games yet." },
  { id: "blowouts", label: "Blowouts", empty: "No finished games yet." },
  { id: "comebacks", label: "Comebacks", empty: "No comeback of 50+ points yet." },
  { id: "upsets", label: "Upsets", empty: "Every winner so far was the favorite." },
  { id: "wildest", label: "Lead swaps", empty: "No game has changed hands yet." },
  { id: "longest", label: "Longest", empty: "No finished games yet." },
];

const statsUi = {
  tab: "overview",
  period: "all",
  rank: { players: { metric: "winPct", dir: "desc" }, teams: { metric: "winPct", dir: "desc" } },
  gameList: "closest",
  insightsOpen: false,
  search: { players: "", teams: "" },
  showUnranked: { players: false, teams: false },
  scroll: {},
  stack: [],
  returnFocus: null,
};

const statsEsc = escapeHtmlValue;
const statsPct = value => `${Math.round(value)}%`;
const statsSigned = value => formatSignedStat(value);
// Scores can be negative after a set, so they get a real minus and a spaced dash.
const statsScore = value => (value < 0 ? `−${Math.abs(value)}` : String(value));
const statsScoreLine = (first, second) => `${statsScore(first)} – ${statsScore(second)}`;

// "11h" past ten hours, so big totals fit a small tile on one line.
function statsCompactDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  return minutes < 600 ? formatDuration(ms) : `${Math.round(minutes / 60)}h`;
}

function statsModel() {
  return getStatsModel({ period: statsUi.period });
}

// Initials by whole characters, so an emoji or accented letter is never split in half.
function statsInitials(entity) {
  const chars = text => Array.from(text);
  if (entity.kind === "team") {
    return entity.players.filter(Boolean).slice(0, 2).map(name => (chars(sanitizePlayerName(name))[0] || "").toUpperCase()).join("") || "?";
  }
  const name = sanitizePlayerName(entity.name);
  const parts = name.split(/[\s&/+,]+/).filter(Boolean);
  if (parts.length >= 2) return (chars(parts[0])[0] + chars(parts[1])[0]).toUpperCase();
  return chars(name).slice(0, 2).join("").toUpperCase() || "?";
}

function statsAvatar(entity, size = "") {
  return `<span class="st-avatar${size ? ` st-avatar--${size}` : ""}" aria-hidden="true">${statsEsc(statsInitials(entity))}</span>`;
}

function statsRecordText(entity) {
  return `${entity.wins}–${entity.losses}`;
}

function statsListOf(model, kind) {
  return kind === "team" ? model.teams.list : model.players.list;
}

function statsTabFor(kind) {
  return kind === "team" ? "teams" : "players";
}

// --- Building blocks ---
function statsCard(title, body, { sub = "", action = "", id = "", className = "" } = {}) {
  return `<section class="st-card${className ? ` ${className}` : ""}"${id ? ` id="${id}"` : ""}>
    <header class="st-card__head"><h3 class="st-card__title">${statsEsc(title)}</h3>${action}</header>
    ${sub ? `<p class="st-card__sub">${statsEsc(sub)}</p>` : ""}${body}</section>`;
}

function statsLinkAction(label, tab) {
  return `<button type="button" class="st-link" data-stats-tab="${tab}">${statsEsc(label)}${statsIcon("chevron")}</button>`;
}

function statsTile(label, value, sub = "", { tone = "", icon = "" } = {}) {
  return `<div class="st-tile${tone ? ` st-tile--${tone}` : ""}"><span class="st-tile__label">${icon ? statsIcon(icon) : ""}${statsEsc(label)}</span><strong class="st-tile__value">${statsEsc(value)}</strong>${sub ? `<span class="st-tile__sub">${statsEsc(sub)}</span>` : ""}</div>`;
}

function statsEmpty(icon, title, body, actionHtml = "") {
  return `<div class="st-empty"><span class="st-empty__icon" aria-hidden="true">${statsIcon(icon)}</span><h3 class="st-empty__title">${statsEsc(title)}</h3><p class="st-empty__body">${statsEsc(body)}</p>${actionHtml}</div>`;
}

function statsNote(text) {
  return `<p class="st-note">${statsIcon("info")}<span>${statsEsc(text)}</span></p>`;
}

function statsOpenEntityAttrs(entity) {
  return `data-open-entity="${entity.kind}" data-entity-key="${statsEsc(entity.key)}"`;
}

// --- Leaderboard rows ---
function statsBarFor(metricKey, row, rows) {
  const qualified = rows.filter(item => item.qualified && Number.isFinite(item.value));
  const value = row.value;
  if (!Number.isFinite(value)) return { percent: 0, tone: "blue" };
  if (metricKey === "winPct" || metricKey === "bidMakePct") return { percent: value, tone: "blue" };
  const values = qualified.map(item => item.value);
  if (metricKey === "rating") {
    const low = Math.min(...values, value) - 25;
    const high = Math.max(...values, value) + 25;
    return { percent: ((value - low) / (high - low)) * 100, tone: "blue" };
  }
  if (metricKey === "recent") {
    const low = Math.min(...values, value);
    const high = Math.max(...values, value);
    return { percent: high > low ? 20 + ((value - low) / (high - low)) * 80 : 100, tone: "blue" };
  }
  const reach = Math.max(1, ...values.map(Math.abs), Math.abs(value));
  return { percent: (Math.abs(value) / reach) * 100, tone: value < 0 ? "orange" : "blue" };
}

function statsRankBadge(row, metricKey, direction) {
  if (!row.qualified) return `<span class="st-row__rank st-rank st-rank--none" aria-hidden="true">–</span>`;
  const medal = direction === "desc" && row.rank <= 3 && STATS_RANK_METRICS[metricKey].medals !== false ? ` st-rank--${row.rank}` : "";
  return `<span class="st-row__rank st-rank${medal}" aria-hidden="true">${row.rank}</span>`;
}

function statsEntityRow(row, rows, metricKey, direction, { compact = false } = {}) {
  const entity = row.entity;
  const metric = STATS_RANK_METRICS[metricKey];
  const valueText = row.valid ? metric.format(row.value) : "–";
  const bar = statsBarFor(metricKey, row, rows);
  const detail = `${statsRecordText(entity)} · ${statsPlural(entity.gamesPlayed, "game")}`;
  const rankText = row.qualified ? `rank ${row.rank}` : "not ranked yet";
  const label = `${entity.name}, ${rankText}, ${metric.label} ${valueText}, ${statsRecordText(entity)} over ${statsPlural(entity.gamesPlayed, "game")}`;
  return `<button type="button" class="st-row${row.qualified ? "" : " is-provisional"}" ${statsOpenEntityAttrs(entity)} aria-label="${statsEsc(label)}">
    ${statsRankBadge(row, metricKey, direction)}
    ${statsAvatar(entity)}
    <span class="st-row__body">
      <span class="st-row__top"><span class="st-row__name">${statsEsc(entity.name)}</span><span class="st-row__value">${statsEsc(valueText)}</span></span>
      <span class="st-row__sub">${statsEsc(detail)}</span>
      <span class="st-row__foot">${statsMeter(bar.percent, { tone: bar.tone })}${compact ? "" : statsFormStrip(entity.form, { limit: 5 })}</span>
    </span>
  </button>`;
}

function statsRankControls(kind) {
  const state = statsUi.rank[kind === "team" ? "teams" : "players"];
  const options = Object.entries(STATS_RANK_METRICS).map(([key, metric]) => `<option value="${key}"${key === state.metric ? " selected" : ""}>${statsEsc(metric.label)}</option>`).join("");
  const desc = state.dir === "desc";
  return `<div class="st-controls">
    <label class="st-select"><span class="st-select__cap">Rank by</span><select class="st-select__control" data-rank-select="${kind}" aria-label="Rank ${kind === "team" ? "teams" : "players"} by">${options}</select>${statsIcon("chevron", "st-select__chev")}</label>
    <button type="button" class="st-iconbtn" data-rank-dir="${kind}" aria-label="${desc ? "Highest first" : "Lowest first"}. Tap to reverse.">${statsIcon(desc ? "sortDown" : "sortUp")}<span>${desc ? "High to low" : "Low to high"}</span></button>
  </div>`;
}

// --- Overview ---
function statsPeriodName(period) {
  return { d30: "the previous 30 days", d90: "the previous 90 days", year: "this time last year" }[period] || "";
}

function statsHero(model) {
  const { totals, previous, activity } = model;
  let delta = "";
  if (previous) {
    const diff = totals.games - previous.games;
    delta = `<span class="st-delta st-delta--${diff > 0 ? "up" : diff < 0 ? "down" : "flat"}">${diff === 0 ? "Same as" : `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)} ${diff > 0 ? "more than" : "fewer than"}`} ${statsEsc(statsPeriodName(model.period))}</span>`;
  }
  const weekly = activity.weekly.some(count => count > 0)
    ? `<div class="st-hero__weeks">${statsMiniColumns(activity.weekly, { width: 144, height: 30 })}<span>Games per week, last 12 weeks</span></div>` : "";
  return `<section class="st-hero" aria-label="Summary">
    <div class="st-hero__lead"><strong class="st-hero__value">${totals.games.toLocaleString()}</strong><span class="st-hero__label">${totals.games === 1 ? "game" : "games"} played</span>${delta}</div>
    <dl class="st-hero__minis">
      <div><dt>Hands</dt><dd>${totals.hands.toLocaleString()}</dd></div>
      <div><dt>At the table</dt><dd>${totals.timeMs ? statsEsc(formatDuration(totals.timeMs)) : "–"}</dd></div>
      <div><dt>Avg game</dt><dd>${totals.avgGameMs ? statsEsc(formatDuration(totals.avgGameMs)) : "–"}</dd></div>
    </dl>
    ${weekly}
  </section>`;
}

function statsInsightAction(action) {
  if (!action) return "";
  if (action.entity) return `data-open-entity="${action.entity.kind}" data-entity-key="${statsEsc(action.entity.key)}"`;
  if (action.game !== undefined) return `data-open-game="${action.game}"`;
  if (action.tab) return `data-stats-tab="${action.tab}"`;
  return "";
}

function statsInsightsCard(model) {
  const list = model.insights;
  if (!list.length) return "";
  const shown = statsUi.insightsOpen ? list.slice(0, 9) : list.slice(0, 4);
  const rows = shown.map(insight => `<li><button type="button" class="st-insight st-insight--${insight.tone}" ${statsInsightAction(insight.action)}>
      <span class="st-insight__icon" aria-hidden="true">${statsIcon(insight.icon)}</span>
      <span class="st-insight__text"><strong>${statsEsc(insight.title)}</strong><small>${statsEsc(insight.detail)}</small></span>
      ${statsIcon("chevron", "st-insight__chev")}
    </button></li>`).join("");
  const more = list.length > 4
    ? `<button type="button" class="st-more" data-stats-toggle="insights" aria-expanded="${statsUi.insightsOpen}">${statsUi.insightsOpen ? "Show fewer" : `Show ${Math.min(list.length, 9) - 4} more`}</button>` : "";
  return statsCard("Highlights", `<ul class="st-insights">${rows}</ul>${more}`);
}

function statsLeadersCard(model) {
  const rows = statsRankEntities(model.players.list, "winPct", "desc");
  if (!rows.length) return "";
  const top = rows.slice(0, 5);
  const hint = rows.some(row => !row.qualified) ? `Players need ${statsGateFor(model.players.list).games} games to be ranked.` : "";
  return statsCard("Leaderboard", `<div class="st-rows">${top.map(row => statsEntityRow(row, rows, "winPct", "desc", { compact: true })).join("")}</div>`, {
    sub: hint, action: statsLinkAction("All players", "players"),
  });
}

function statsCalendarCard(model) {
  const { activity, totals } = model;
  if (!totals.firstTime) return "";
  // At least twenty weeks, so a young library still draws small cells rather than a few huge ones.
  const weeks = Math.min(26, Math.max(20, Math.ceil((model.now - totals.firstTime) / (7 * STATS_DAY_MS)) + 1));
  const days = Object.keys(activity.byDay).length;
  const peak = activity.weekday.reduce((best, count, day) => (count > best.count ? { day, count } : best), { day: 0, count: -1 });
  const share = totals.games ? (peak.count / totals.games) * 100 : 0;
  const sub = totals.games >= 6 && share >= 25
    ? `${statsWeekdayName(peak.day)}s are the busiest: ${Math.round(share)}% of games.`
    : `${statsPlural(days, "game day")} in this period.`;
  return statsCard("When you play", statsHeatmap({ byDay: activity.byDay, weeks, now: model.now, aria: "Games played per day" }), { sub });
}

function statsMedian(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function statsEndingsCard(model) {
  const { totals } = model;
  if (!totals.games) return "";
  const methods = [
    { key: "bid", label: "Won on a bid", tone: "blue" },
    { key: "set", label: "Set the other side", tone: "violet" },
    { key: "spread", label: "1,000-point spread", tone: "yellow" },
    { key: "other", label: "Other", tone: "magenta" },
  ];
  const stack = statsStackedBar(methods.map(method => ({ label: method.label, value: totals.methods[method.key], tone: method.tone, display: String(totals.methods[method.key]) })), { aria: "How games ended" });
  const margins = model.records.map(rec => rec.margin);
  const median = statsMedian(margins);
  const ranges = ["0–49", "50–99", "100–149", "150–199", "200–249", "250–299", "300–349", "350+"];
  const histogram = totals.games >= 4 ? statsBarsChart({
    items: totals.margins.map((count, i) => ({
      label: i === totals.margins.length - 1 ? "350+" : String(i * 50), value: count, display: String(count),
      detail: `${ranges[i]} points`, tone: "blue",
    })).map((item, i) => ({ ...item, title: ranges[i] })),
    aria: "Games by final margin.", caption: "Games by final margin", headers: ["Final margin (points)"], valueHeader: "Games",
  }) : "";
  return statsCard("How games end", `${stack}${histogram ? `<h4 class="st-subhead">Final margin</h4>${histogram}` : ""}`, {
    sub: totals.games >= 4 ? `Half of games finish within ${Math.round(median)} points; ${Math.round((totals.closeGames / totals.games) * 100)}% are decided by ${STATS_CLOSE_MARGIN} or fewer.` : "",
  });
}

function statsBidGlanceCard(model) {
  const { totals } = model;
  if (!totals.bidAttempts) return "";
  const stack = statsStackedBar([
    { label: "Made", value: totals.bidsMade, tone: "aqua", display: String(totals.bidsMade) },
    { label: "Set", value: totals.bidsSet, tone: "orange", display: String(totals.bidsSet) },
  ], { aria: "Bids made and set" });
  return statsCard("Bids at a glance", `${stack}<div class="st-kpis st-kpis--3">${statsTile("Made", statsPct(totals.bidMakePct), "of all bids")}${statsTile("Avg bid", formatStatNumber(totals.avgBid), "points")}${statsTile("Bids", totals.bidAttempts.toLocaleString(), "recorded")}</div>`, {
    action: statsLinkAction("Explore bidding", "bidding"),
  });
}

function statsRenderOverview(model) {
  return `<div class="st-page">${statsHero(model)}${statsInsightsCard(model)}${statsLeadersCard(model)}${statsCalendarCard(model)}${statsEndingsCard(model)}${statsBidGlanceCard(model)}</div>`;
}

// --- Players and teams ---
const STATS_SEARCH_FROM = 12; // lists longer than this get a search box

function statsLeaderState(kind) {
  return statsUi.rank[kind === "team" ? "teams" : "players"];
}

function statsGateText(model, kind, metricKey) {
  const metric = STATS_RANK_METRICS[metricKey];
  const gate = statsGateFor(statsListOf(model, kind));
  const noun = kind === "team" ? "Teams" : "Players";
  if (metric.gate === "games") return `${noun} need ${gate.games} games to be ranked`;
  if (metric.gate === "bids") return `${noun} need ${gate.bids} bids to be ranked`;
  return "";
}

// The rows alone, so typing in the search box redraws them without touching the box.
function statsLeaderRowsHtml(model, kind) {
  const state = statsLeaderState(kind);
  const key = kind === "team" ? "teams" : "players";
  const noun = kind === "team" ? "teams" : "players";
  const all = statsRankEntities(statsListOf(model, kind), state.metric, state.dir);
  const query = statsUi.search[key].trim().toLowerCase();
  const item = row => `<div role="listitem">${statsEntityRow(row, all, state.metric, state.dir)}</div>`;
  if (query) {
    const matches = all.filter(row => row.entity.name.toLowerCase().includes(query));
    return matches.length
      ? `<div class="st-rows" role="list">${matches.map(item).join("")}</div>`
      : `<p class="st-hint st-hint--center">No ${noun} match “${statsEsc(statsUi.search[key].trim())}”.</p>`;
  }
  const ranked = all.filter(row => row.qualified);
  const rest = all.filter(row => !row.qualified);
  // Everyone is shown while the group is small; a long tail of one-game names folds away.
  const preview = ranked.length ? 3 : 8;
  const open = statsUi.showUnranked[key] || rest.length <= preview + 2;
  const visible = [...ranked, ...(open ? rest : rest.slice(0, preview))];
  const toggle = rest.length > preview + 2
    ? `<button type="button" class="st-more" data-stats-toggle="unranked" data-kind="${kind}" aria-expanded="${open}">${open ? "Show fewer" : `Show ${rest.length - preview} more, not ranked yet`}</button>` : "";
  return `<div class="st-rows" role="list">${visible.map(item).join("")}</div>${toggle}`;
}

function statsRenderLeaders(model, kind) {
  const list = statsListOf(model, kind);
  const key = kind === "team" ? "teams" : "players";
  const noun = kind === "team" ? "teams" : "players";
  if (!list.length) {
    return `<div class="st-page">${statsEmpty("users", `No ${noun} in this period`, model.period === "all" ? "Finish and save a game to see them here." : "Try a longer period to see more history.", model.period === "all" ? "" : `<button type="button" class="st-cta" data-period-set="all">Show all time</button>`)}</div>`;
  }
  const state = statsLeaderState(kind);
  const gate = statsGateText(model, kind, state.metric);
  const unranked = statsRankEntities(list, state.metric, state.dir).filter(row => !row.qualified).length;
  const search = list.length > STATS_SEARCH_FROM ? `<label class="library-search st-search">
      <span class="sr-only">Find ${kind === "team" ? "a team" : "a player"}</span>
      ${statsIcon("search", "library-search__icon")}
      <input type="search" class="library-search__input" data-stats-search="${kind}" value="${statsEsc(statsUi.search[key])}" placeholder="Find ${kind === "team" ? "a team" : "a player"}" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="search" />
      <button type="button" class="library-search__clear${statsUi.search[key] ? "" : " hidden"}" data-stats-search-clear="${kind}" aria-label="Clear search">${statsIcon("close")}</button>
    </label>` : "";
  return `<div class="st-page">
    ${search}
    ${statsRankControls(kind)}
    ${gate && unranked ? `<p class="st-hint">${statsEsc(gate)}. ${unranked} ${unranked === 1 ? "isn’t" : "aren’t"} there yet.</p>` : ""}
    <div id="statsLeaderRows" data-kind="${kind}">${statsLeaderRowsHtml(model, kind)}</div>
  </div>`;
}

// --- Bidding ---
function statsRenderBidding(model) {
  const { totals, bids } = model;
  if (!totals.bidAttempts) {
    return `<div class="st-page">${statsEmpty("target", "No bids yet", "Once games with recorded bids are saved, you will see how each bid size really performs.")}</div>`;
  }
  const kpis = `<div class="st-kpis">${statsTile("Make rate", statsPct(totals.bidMakePct), `${totals.bidsMade} of ${totals.bidAttempts}`)}${statsTile("Average bid", formatStatNumber(totals.avgBid), "points")}${statsTile("Sets", String(totals.bidsSet), "failed bids")}${statsTile("Per bid", statsSigned(totals.avgBidPoints), "avg points")}</div>`;

  const sized = bids.buckets;
  const enough = sized.length >= 2 && totals.bidAttempts >= 10;
  const makeItems = sized.map(bucket => ({
    label: bucket.label, sub: `n=${bucket.attempts}`, value: bucket.makePct ?? 0, display: bucket.makePct === null ? "–" : statsPct(bucket.makePct),
    detail: `${bucket.made} of ${bucket.attempts} bids made`, detailCells: [String(bucket.attempts)], faded: bucket.attempts < 4,
  }));
  const bestMake = sized.filter(bucket => bucket.attempts >= STATS_MIN_BIDS).sort((a, b) => b.makePct - a.makePct)[0];
  const makeChart = enough ? statsBarsChart({
    items: makeItems, max: 100, ticks: [0, 50, 100], formatTick: value => `${value}%`,
    reference: { value: totals.bidMakePct, label: `all bids ${statsPct(totals.bidMakePct)}` },
    aria: "Share of bids made, by bid size.", caption: "Bids made by bid size", headers: ["Bid size", "Bids"], valueHeader: "Made",
  }) : statsNote("Make rates by bid size appear once a few more bids are recorded.");
  const makeSub = bestMake ? `Bids of ${bestMake.label} are made most often (${statsPct(bestMake.makePct)}). Faded bars have fewer than 4 bids.` : "Faded bars have fewer than 4 bids.";

  const evItems = sized.map(bucket => ({
    label: bucket.label, value: bucket.avgPoints ?? 0, display: bucket.avgPoints === null ? "–" : `${statsSigned(bucket.avgPoints)} pts`,
    detail: `${bucket.attempts} ${bucket.attempts === 1 ? "bid" : "bids"} · made ${bucket.makePct === null ? "–" : statsPct(bucket.makePct)}`, detailCells: [String(bucket.attempts)],
    tone: (bucket.avgPoints ?? 0) >= 0 ? "aqua" : "orange",
  }));
  const bestEv = sized.filter(bucket => bucket.attempts >= STATS_MIN_BIDS).sort((a, b) => b.avgPoints - a.avgPoints)[0];
  const evChart = enough ? statsDivergingChart({
    items: evItems, aria: "Average points per bid, by bid size.", caption: "Average points per bid by bid size", headers: ["Bid size", "Bids"], valueHeader: "Average points",
    formatTick: value => (value > 0 ? `+${Math.round(value)}` : String(Math.round(value))),
  }) : "";
  const evSub = `${bestEv ? `Bids of ${bestEv.label} have earned ${statsSigned(bestEv.avgPoints)} points a hand. ` : ""}A made bid scores what was taken; a set costs the whole bid. Bigger bids come with stronger hands, so this shows what happened, not what to bid.`;

  const situations = bids.situations;
  const situationRows = [
    ["trailing", `Behind by ${STATS_CLOSE_MARGIN}+`], ["even", "Within " + STATS_CLOSE_MARGIN], ["leading", `Ahead by ${STATS_CLOSE_MARGIN}+`],
  ].map(([key, label]) => {
    const item = situations[key];
    return `<div class="st-bar-row"><span class="st-bar-row__label">${statsEsc(label)}</span>${statsMeter(item.makePct ?? 0, { tone: "blue", label: `${label}: made ${item.makePct === null ? "none" : statsPct(item.makePct)}` })}<b>${item.attempts ? statsPct(item.makePct) : "–"}</b><small>${item.attempts ? `avg ${Math.round(item.avgBid)} · n=${item.attempts}` : "no bids"}</small></div>`;
  }).join("");

  const common = bids.common.slice(0, 6);
  const peakCount = common.length ? common[0].count : 1;
  const commonRows = common.map(entry => `<div class="st-bar-row"><span class="st-bar-row__label">${entry.bid}</span>${statsMeter((entry.count / peakCount) * 100, { tone: "violet", label: `${entry.bid}: bid ${entry.count} times` })}<b>${entry.count}</b><small>made ${statsPct((entry.made / entry.count) * 100)}</small></div>`).join("");

  const bidders = model.players.list.filter(entity => entity.bidAttempts >= STATS_MIN_BIDS);
  const defenders = model.players.list.filter(entity => entity.defHands >= 10)
    .sort((a, b) => b.setsForcedPct - a.setsForcedPct).slice(0, 6);
  const defenseRows = defenders.map(entity => `<button type="button" class="st-bar-row st-bar-row--link" ${statsOpenEntityAttrs(entity)}><span class="st-bar-row__label">${statsEsc(entity.name)}</span>${statsMeter(entity.setsForcedPct, { tone: "aqua", label: `${entity.name} sets ${statsPct(entity.setsForcedPct)} of opposing bids` })}<b>${statsPct(entity.setsForcedPct)}</b><small>${entity.setsForced} of ${entity.defHands}</small></button>`).join("");
  const bidderMap = bidders.length >= 3 ? statsScatterChart({
    points: bidders.map(entity => ({
      key: entity.key, label: statsInitials(entity), name: entity.name,
      x: entity.avgBidValue, y: entity.bidMakePct,
      detail: `${statsPlural(entity.bidAttempts, "bid")} · average bid ${Math.round(entity.avgBidValue)} · made ${statsPct(entity.bidMakePct)}`,
    })),
    aria: "Each player's average bid against how often their bids are made.", caption: "Average bid and make rate by player", headers: ["Player", "Average bid"], valueHeader: "Make rate",
    refX: totals.avgBid, refY: totals.bidMakePct, xLabel: "Average bid", yLabel: "Made",
  }) : "";

  return `<div class="st-page">
    ${kpis}
    ${statsCard("Make rate by bid size", makeChart, { sub: enough ? makeSub : "" })}
    ${enough ? statsCard("Points per bid", evChart, { sub: evSub }) : ""}
    ${statsCard("When you bid", `<div class="st-bar-rows">${situationRows}</div>`, { sub: "Make rate by the score when the bid was called." })}
    ${commonRows ? statsCard("Most-called bids", `<div class="st-bar-rows">${commonRows}</div>`) : ""}
    ${bidderMap ? statsCard("Bold or safe?", bidderMap, { sub: "Farther right bids bigger; higher gets made more often. Tap a dot to open that player." }) : ""}
    ${defenseRows ? statsCard("Best at setting bids", `<div class="st-bar-rows">${defenseRows}</div>`, { sub: "Share of opposing bids this player's side set (10+ defended hands)." }) : ""}
    ${statsNote("Bids are recorded for the side, not the person, so a player's bidding figures cover every hand their side bid.")}
  </div>`;
}

// --- Records ---
function statsRecordValue(record) {
  switch (record.unit) {
    case "time": return formatDuration(record.value);
    case "pct": return `${Math.round(record.value)}%`;
    case "chance": return `${record.value}%`;
    case "swing": return `${record.value}%`;
    case "down": return `${record.value}`;
    default: return String(Math.round(record.value));
  }
}

const STATS_RECORD_ICONS = {
  highScore: "star", blowout: "bolt", closest: "scale", comeback: "rocket", longest: "clock", quickest: "bolt", marathon: "list",
  leadChanges: "shuffle", swing: "trend", bidMade: "target", bidSet: "alert", winStreak: "flame", lossStreak: "snow", perfect360: "star",
  setsForced: "shield", misdeals: "shuffle", penalties: "alert", bestWinPct: "crown", upset: "bolt", turning: "trend",
};
const STATS_RECORD_UNITS = {
  pts: "points", down: "points down", time: "", hands: "hands", changes: "lead changes", bid: "", wins: "wins in a row", losses: "losses in a row",
  "360s": "perfect 360s", sets: "sets forced", misdeals: "misdeals", penalties: "penalties", pct: "wins",
  chance: "chance to win", swing: "win-chance swing",
};

function statsRecordCard(record) {
  const attrs = record.game !== undefined ? `data-open-game="${record.game}"` : record.entity ? `data-open-entity="${record.entity.kind}" data-entity-key="${statsEsc(record.entity.key)}"` : "";
  const when = record.time ? statsFormatDate(record.time, { month: "short", day: "numeric", year: "numeric" }) : "";
  const tag = attrs ? "button" : "div";
  return `<${tag} ${tag === "button" ? 'type="button"' : ""} class="st-record" ${attrs}>
    <span class="st-record__icon" aria-hidden="true">${statsIcon(STATS_RECORD_ICONS[record.id] || "trophy")}</span>
    <span class="st-record__label">${statsEsc(record.label)}</span>
    <strong class="st-record__value">${statsEsc(statsRecordValue(record))}${STATS_RECORD_UNITS[record.unit] ? ` <small>${statsEsc(STATS_RECORD_UNITS[record.unit])}</small>` : ""}</strong>
    <span class="st-record__holder">${statsEsc(record.holder)}</span>
    ${when || record.note ? `<span class="st-record__when">${statsEsc([record.note, when].filter(Boolean).join(" · "))}</span>` : ""}
  </${tag}>`;
}

function statsGameRow(game) {
  const winnerIsUs = game.winner === "us";
  const topName = game.winner ? game.winnerName : game.us;
  const otherName = game.winner ? game.loserName : game.dem;
  const topScore = game.winner ? (winnerIsUs ? game.usScore : game.demScore) : game.usScore;
  const otherScore = game.winner ? (winnerIsUs ? game.demScore : game.usScore) : game.demScore;
  const when = game.time ? statsFormatDate(game.time, { month: "short", day: "numeric" }) : "Undated";
  const upset = statsUi.gameList === "upsets" && game.winChance !== null ? `won with only ${Math.max(1, Math.round(game.winChance * 100))}% odds after hand ${game.winChanceHand}` : "";
  const facts = [upset, statsPlural(game.hands, "hand"), game.leadChanges ? statsPlural(game.leadChanges, "lead swap") : "", game.deficit >= STATS_CLOSE_MARGIN ? `from ${game.deficit} down` : ""].filter(Boolean).join(" · ");
  return `<button type="button" class="st-game" data-open-game="${game.index}" aria-label="${statsEsc(`${topName} ${statsScore(topScore)}, ${otherName} ${statsScore(otherScore)}, ${when}. ${facts}`)}">
    <span class="st-game__main"><span class="st-game__teams"><b>${statsEsc(topName)}</b> <i>beat</i> ${statsEsc(otherName)}</span><span class="st-game__score">${statsEsc(statsScoreLine(topScore, otherScore))}</span><span class="st-game__meta">${statsEsc(when)} · ${statsEsc(facts)}</span></span>
    ${statsTrajectory(game.gaps)}
    ${statsIcon("chevron", "st-game__chev")}
  </button>`;
}

function statsRenderRecords(model) {
  if (!model.records.length) {
    return `<div class="st-page">${statsEmpty("trophy", "No records yet", "Records appear after your first saved game.")}</div>`;
  }
  const grid = model.recordBook.map(statsRecordCard).join("");
  const chips = STATS_GAME_LISTS.map(list => `<button type="button" class="st-chip" data-game-list="${list.id}" aria-pressed="${statsUi.gameList === list.id}">${statsEsc(list.label)}</button>`).join("");
  const active = STATS_GAME_LISTS.find(list => list.id === statsUi.gameList) || STATS_GAME_LISTS[0];
  const games = model.lists[active.id] || [];
  const gameRows = games.length ? games.map(statsGameRow).join("") : `<p class="st-hint">${statsEsc(active.empty)}</p>`;

  const streakEntities = [...model.teams.list, ...model.players.list];
  const current = streakEntities.filter(entity => entity.streak.length >= 3)
    .sort((a, b) => (b.streak.length - a.streak.length) || (a.streak.type === "W" ? -1 : 1)).slice(0, 5);
  const longestNow = Math.max(1, ...current.map(item => item.streak.length));
  const streakRows = current.map(entity => `<button type="button" class="st-bar-row st-bar-row--link" ${statsOpenEntityAttrs(entity)}><span class="st-bar-row__label">${statsEsc(entity.name)}</span>${statsMeter((entity.streak.length / longestNow) * 100, { tone: entity.streak.type === "W" ? "aqua" : "orange", label: `${entity.name}: ${entity.streak.type === "W" ? "won" : "lost"} ${entity.streak.length} in a row` })}<b>${entity.streak.type}${entity.streak.length}</b><small>${entity.streak.type === "W" ? "winning" : "losing"}</small></button>`).join("");

  return `<div class="st-page">
    ${statsCard("Hall of fame", `<div class="st-records">${grid}</div>`, { sub: "Tap a record to open that game. Win chances come from the same model as Pro Mode, using only the score." })}
    ${statsCard("Standout games", `<div class="st-chips" role="group" aria-label="Game list">${chips}</div><div class="st-games">${gameRows}</div>`)}
    ${streakRows ? statsCard("Streaks right now", `<div class="st-bar-rows">${streakRows}</div>`, { sub: "Teams and players riding three or more in a row." }) : ""}
  </div>`;
}

// --- Profile ---
function statsGameLabel(result, number) {
  const date = result.time ? statsFormatDate(result.time, { month: "short", day: "numeric" }) : "";
  return `Game ${number}${date ? ` · ${date}` : ""}`;
}

function statsRenderProfile(model, entity) {
  const list = statsListOf(model, entity.kind);
  const rank = (metric) => statsRankOf(list, entity, metric);
  const rankText = metric => { const r = rank(metric); return r && list.length > 1 ? `#${r.rank} of ${r.of}` : ""; };
  const lastPlayed = entity.lastPlayed ? `last played ${statsRelativeDay(entity.lastPlayed, model.now)}` : "";
  const kind = entity.kind === "team" ? "Team" : "Player";
  const subline = [kind, statsPlural(entity.gamesPlayed, "game"), lastPlayed].filter(Boolean).join(" · ");
  const streak = entity.streak.length >= 2
    ? `<span class="st-badge st-badge--${entity.streak.type === "W" ? "hot" : "cold"}">${statsIcon(entity.streak.type === "W" ? "flame" : "snow")}${entity.streak.type === "W" ? "Won" : "Lost"} ${entity.streak.length} in a row</span>` : "";

  const hero = `<section class="st-profile__hero">
    ${statsAvatar(entity, "lg")}
    <div class="st-profile__who"><h3 class="st-profile__name">${statsEsc(entity.name)}</h3><p class="st-profile__sub">${statsEsc(subline)}</p></div>
    <div class="st-profile__win"><strong>${statsEsc(String(Math.round(entity.winPercentNumber)))}<small>%</small></strong><span>${statsEsc(statsRecordText(entity))}</span></div>
    <div class="st-profile__meter">${statsMeter(entity.winPercentNumber, { tone: "blue", label: `Win rate ${Math.round(entity.winPercentNumber)} percent` })}</div>
    <div class="st-profile__form">${statsFormStrip(entity.form, { limit: 10, size: "md" })}${streak}</div>
  </section>`;

  const tiles = `<div class="st-kpis">
    ${statsTile("Rating", entity.ratingHistory.length ? String(Math.round(entity.rating)) : "–", rankText("rating"))}
    ${statsTile("Avg margin", statsSigned(entity.netPerGame), rankText("netPerGame") || "points per game")}
    ${statsTile("Bids made", entity.bidMakePct === null ? "–" : statsPct(entity.bidMakePct), rankText("bidMakePct") || (entity.bidAttempts ? statsPlural(entity.bidAttempts, "bid") : "no bids"))}
    ${statsTile("Hands won", entity.roundWinPct === null ? "–" : statsPct(entity.roundWinPct), `${entity.roundsWon} of ${entity.roundsPlayed}`)}
  </div>`;

  const recent = entity.results.slice(-24);
  const offset = entity.results.length - recent.length;
  const lastFive = entity.results.slice(-5);
  const lastFiveWins = lastFive.filter(result => result.won).length;
  const resultsChart = recent.length >= 3 ? statsDivergingChart({
    items: recent.map((result, i) => ({
      label: String(offset + i + 1), title: `${statsGameLabel(result, offset + i + 1)} vs ${result.opponent}`,
      value: result.margin, display: `${result.won ? "Won" : result.lost ? "Lost" : "Tied"} ${statsScoreLine(result.pf, result.pa)}`,
      detail: `Margin ${statsSigned(result.margin)}`, detailCells: [statsSigned(result.margin)],
      tone: result.won ? "aqua" : result.lost ? "orange" : "blue",
    })),
    aria: `${entity.name}'s margin in each game.`, caption: `${entity.name}: margin by game`, headers: ["Game", "Margin"], valueHeader: "Result",
    labelEvery: Math.max(1, Math.ceil(recent.length / 6)), formatTick: value => (value > 0 ? `+${Math.round(value)}` : String(Math.round(value))),
  }) : statsNote("A results chart appears after three games.");
  const resultsSub = recent.length >= 3
    ? `${lastFiveWins} ${lastFiveWins === 1 ? "win" : "wins"} in the last ${lastFive.length}. Bars rise for the margin of a win and drop for a loss.` : "";

  const ratingOf = new Map(entity.ratingHistory.map(item => [item.order, item]));
  const rated = [];
  entity.results.forEach((result, i) => {
    if (ratingOf.has(result.order)) rated.push({ result, number: i + 1, item: ratingOf.get(result.order) });
  });
  // A trend reads best over recent games; 100 points also keeps the chart and its table light.
  const RATING_WINDOW = 100;
  const ratingPoints = rated.slice(-RATING_WINDOW).map(({ result, number, item }) => {
    const change = item.after - item.before;
    return {
      value: item.after, label: `${statsGameLabel(result, number)} vs ${result.opponent}`, display: String(Math.round(item.after)),
      detail: `${result.won ? "Win" : "Loss"}, ${statsSigned(change)} rating`, detailCells: [statsSigned(change)], axis: String(number),
    };
  });
  const ratingChart = ratingPoints.length >= 3 ? statsLineChart({
    points: ratingPoints, baseline: entity.ratingStart && model.period === "all" ? STATS_ELO_START : null, baselineLabel: "start 1,000",
    aria: `${entity.name}'s rating after each game.`, caption: `${entity.name}: rating after each game`, headers: ["Game", "Change"], valueHeader: "Rating",
  }) : statsNote("A rating trend appears after three rated games.");
  const ratingChange = ratingPoints.length >= 2 ? ratingPoints[ratingPoints.length - 1].value - ratingPoints[0].value : 0;
  const trimmed = rated.length > RATING_WINDOW;
  const ratingSub = ratingPoints.length >= 3
    ? `${ratingChange >= 0 ? "Up" : "Down"} ${Math.abs(Math.round(ratingChange))} points over ${trimmed ? `the latest ${RATING_WINDOW} games` : "these games"}. Everyone starts at 1,000; beating stronger opponents is worth more.${entity.kind === "team" ? " A team's rating is the average of its players'." : ""}` : "";

  const biddingBody = entity.bidAttempts >= 3 && model.buckets.length >= 2
    ? statsBarsChart({
      items: model.buckets.map((bucket, i) => {
        const slot = entity.bidBuckets[i] || { attempts: 0, made: 0 };
        const make = slot.attempts ? (slot.made / slot.attempts) * 100 : 0;
        return {
          label: bucket.label, sub: `n=${slot.attempts}`, value: make, display: slot.attempts ? statsPct(make) : "–",
          detail: `${slot.made} of ${slot.attempts} bids made`, detailCells: [String(slot.attempts)], faded: slot.attempts < 3,
        };
      }),
      max: 100, ticks: [0, 50, 100], formatTick: value => `${value}%`,
      reference: model.totals.bidMakePct === null ? null : { value: model.totals.bidMakePct, label: `everyone ${statsPct(model.totals.bidMakePct)}` },
      aria: `${entity.name}: share of bids made, by bid size.`, caption: `${entity.name}: bids made by bid size`, headers: ["Bid size", "Bids"], valueHeader: "Made",
    }) : statsNote(entity.bidAttempts ? "A bid chart appears after a few more bids." : "No bids recorded yet.");
  const biddingSub = entity.bidAttempts
    ? `${statsPlural(entity.bidAttempts, "bid")}, average ${entity.avgBid}. ${entity.kind === "player" ? "Figures cover every hand this player's side bid." : ""}`.trim() : "";

  const headRows = (entries, { emptyText, mode, linkKind, tag }) => {
    if (!entries.length) return `<p class="st-hint">${statsEsc(emptyText)}</p>`;
    return `<div class="st-bar-rows">${entries.slice(0, 6).map(entry => {
      const target = linkKind === "player" ? model.players.byKey.get(entry.key) : model.teams.byKey.get(entry.key);
      const attrs = target ? statsOpenEntityAttrs(target) : "";
      const element = target ? "button" : "div";
      return `<${element} ${target ? 'type="button"' : ""} class="st-h2h${target ? " st-bar-row--link" : ""}" ${attrs}>
        <span class="st-h2h__name">${statsEsc(entry.name)}${tag && tag.key === entry.key ? `<em>${statsEsc(tag.text)}</em>` : ""}</span>
        <span class="st-h2h__record">${entry.wins}–${entry.losses}</span>
        ${statsSplitBar(entry.wins, entry.losses, { aria: `${entry.wins} wins, ${entry.losses} losses` })}
        <small class="st-h2h__meta">${statsEsc(mode === "partners" ? `${statsPct(entry.winPct)} together` : `${statsSigned(entry.margin)} per game`)}</small>
      </${element}>`;
    }).join("")}</div>`;
  };

  const partnerBest = entity.partners.filter(entry => entry.games >= 3).sort((a, b) => (b.winPct - a.winPct) || (b.games - a.games))[0];
  const partnersCard = entity.kind === "player"
    ? statsCard("Partners", headRows(entity.partners, { emptyText: "No partners recorded yet.", mode: "partners", linkKind: "player", tag: partnerBest && entity.partners.length > 1 ? { key: partnerBest.key, text: "best" } : null }), {
      sub: entity.partners.length ? "Record when playing together." : "" })
    : statsCard("Players", `<div class="st-bar-rows">${entity.players.filter(Boolean).map(name => {
      const player = model.players.byKey.get(name.toLowerCase());
      return player ? `<button type="button" class="st-h2h st-bar-row--link" ${statsOpenEntityAttrs(player)}><span class="st-h2h__name">${statsEsc(player.name)}</span><span class="st-h2h__record">${statsEsc(statsRecordText(player))}</span>${statsSplitBar(player.wins, player.losses, { aria: `${player.wins} wins, ${player.losses} losses overall` })}<small class="st-h2h__meta">${statsPct(player.winPercentNumber)} overall</small></button>` : "";
    }).join("")}</div>`, { sub: "Each player's overall record, including games with other partners." });
  const toughest = entity.opponents.filter(entry => entry.games >= 3).sort((a, b) => (a.winPct - b.winPct) || (b.games - a.games))[0];
  const matchupsCard = statsCard(entity.kind === "team" ? "Against other teams" : "Against opponents", headRows(entity.opponents, {
    emptyText: "No opponents recorded yet.", mode: "matchups", linkKind: entity.kind === "team" ? "team" : "player",
    tag: toughest && toughest.winPct < 50 && entity.opponents.length > 1 ? { key: toughest.key, text: "toughest" } : null,
  }), { sub: entity.opponents.length ? "Record and average margin per game." : "" });

  const bestRun = entity.longestWinStreak.length;
  const highlights = `<div class="st-kpis st-kpis--3">
    ${statsTile("Sets forced", String(entity.setsForced), entity.setsForcedPct === null ? "" : `${statsPct(entity.setsForcedPct)} of bids`)}
    ${statsTile("360s", String(entity.perfect360s), entity.bid360s ? `${entity.bid360s} as bidder` : "perfect hands")}
    ${statsTile("Comebacks", String(entity.bigComebackWins), `from ${STATS_BIG_COMEBACK}+ down`)}
    ${statsTile("Close wins", String(entity.closeWins), `within ${STATS_CLOSE_MARGIN}`)}
    ${statsTile("Best run", String(bestRun), bestRun === 1 ? "win in a row" : "wins in a row")}
    ${statsTile("Best score", entity.bestScore === null ? "–" : statsScore(entity.bestScore), "one game")}
    ${statsTile("Misdeals", String(entity.misdeals), "dealt")}
    ${statsTile("Time", entity.totalTimeMs ? statsCompactDuration(entity.totalTimeMs) : "–", entity.avgGameTimeMs ? `${formatDuration(entity.avgGameTimeMs)} a game` : "played")}
    ${statsTile("Upsets", String(entity.upsetWins), `won from under ${Math.round(STATS_UPSET_CHANCE * 100)}%`)}
  </div>`;

  const recentGames = entity.results.slice(-5).reverse().map(result => `<button type="button" class="st-game st-game--compact" data-open-game="${result.index}" aria-label="${statsEsc(`${result.won ? "Won" : result.lost ? "Lost" : "Tied"} ${statsScore(result.pf)} to ${statsScore(result.pa)} against ${result.opponent}`)}">
      <span class="st-form__chip st-form__chip--${result.won ? "w" : result.lost ? "l" : "t"}" aria-hidden="true">${result.won ? "W" : result.lost ? "L" : "T"}</span>
      <span class="st-game__main"><span class="st-game__teams">vs ${statsEsc(result.opponent)}</span><span class="st-game__meta">${statsEsc(result.time ? statsFormatDate(result.time, { month: "short", day: "numeric", year: "numeric" }) : "Undated")} · ${statsPlural(result.hands, "hand")}</span></span>
      <span class="st-game__score">${statsEsc(statsScoreLine(result.pf, result.pa))}</span>${statsIcon("chevron", "st-game__chev")}
    </button>`).join("");

  const early = entity.gamesPlayed < STATS_MIN_GAMES
    ? statsNote(`Just getting started: trends fill in after ${STATS_MIN_GAMES} games.`) : "";

  return `<div class="st-page st-profile">
    ${hero}${early}${tiles}
    ${statsCard("Results", resultsChart, { sub: resultsSub })}
    ${statsCard("Rating", ratingChart, { sub: ratingSub })}
    ${statsCard("Bidding", biddingBody, { sub: biddingSub })}
    ${partnersCard}${matchupsCard}
    ${statsCard("Highlights", highlights)}
    ${recentGames ? statsCard("Recent games", `<div class="st-games">${recentGames}</div>`) : ""}
  </div>`;
}

// --- Rendering and navigation ---
const STATS_RENDERERS = {
  overview: model => statsRenderOverview(model),
  players: model => statsRenderLeaders(model, "player"),
  teams: model => statsRenderLeaders(model, "team"),
  bidding: model => statsRenderBidding(model),
  records: model => statsRenderRecords(model),
};

function statsSyncChrome() {
  document.querySelectorAll("#statsTabs [data-stats-tab]").forEach(button => {
    const active = button.getAttribute("data-stats-tab") === statsUi.tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  const select = document.getElementById("statsPeriodSelect");
  if (select && select.value !== statsUi.period) select.value = statsUi.period;
  const content = document.getElementById("statisticsModalContent");
  if (content) content.setAttribute("aria-labelledby", `statsTab-${statsUi.tab}`);
}

// A control that was focused before a redraw is found again by the data attribute that made it.
function statsFocusSelector(element, root) {
  if (!element || !root || !root.contains(element) || !element.getAttribute) return "";
  for (const name of ["data-rank-dir", "data-game-list", "data-stats-search", "data-stats-search-clear", "data-rank-select", "data-stats-toggle"]) {
    const value = element.getAttribute(name);
    if (value === null) continue;
    const kind = name === "data-stats-toggle" && element.hasAttribute("data-kind") ? `[data-kind="${element.getAttribute("data-kind")}"]` : "";
    return `[${name}="${value}"]${kind}`;
  }
  return "";
}

function statsRestoreFocus(root, selector, caret) {
  const next = selector ? root.querySelector(selector) : null;
  if (!next) return;
  next.focus({ preventScroll: true });
  if (caret && typeof next.setSelectionRange === "function") next.setSelectionRange(caret[0], caret[1]);
}

// `scrollTo` keeps the reader where they are; otherwise the tab's remembered spot or the top.
function statsRender({ restoreScroll = true, scrollTo = null } = {}) {
  const content = document.getElementById("statisticsModalContent");
  const scroller = document.getElementById("statisticsModalScroll");
  if (!content) return;
  const focusSelector = statsFocusSelector(document.activeElement, content);
  const caret = focusSelector.startsWith("[data-stats-search=") ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  const model = statsModel();
  statsSyncChrome();
  content.removeAttribute("aria-busy");
  if (!model.allCount) {
    content.innerHTML = statsEmpty("overview", "No stats yet", "Play and save a few games and your leaderboards, charts, and records will show up here.",
      `<button type="button" class="st-cta" data-stats-start>Start a game</button>`);
    return;
  }
  if (!model.records.length) {
    content.innerHTML = statsEmpty("calendar", "No games in this period", "Pick a longer period to see more of your history.", `<button type="button" class="st-cta" data-period-set="all">Show all time</button>`);
    return;
  }
  content.innerHTML = STATS_RENDERERS[statsUi.tab](model);
  statsInitCharts(content);
  if (scroller) scroller.scrollTop = scrollTo !== null ? scrollTo : restoreScroll ? statsUi.scroll[statsUi.tab] || 0 : 0;
  statsRestoreFocus(content, focusSelector, caret);
}

// Redraw the current tab where the reader is: same scroll position, same chip rail, same focused
// control. Toggles, chips, and data refreshes use it; changing tab, period, or ranking starts at the top.
function statsRedraw() {
  const scroller = document.getElementById("statisticsModalScroll");
  const rail = document.querySelector("#statisticsModalContent .st-chips");
  const railLeft = rail ? rail.scrollLeft : 0;
  statsRender({ scrollTo: scroller ? scroller.scrollTop : 0 });
  const nextRail = document.querySelector("#statisticsModalContent .st-chips");
  if (nextRail) nextRail.scrollLeft = railLeft;
}

// Saved games changed while a sheet is open (a delete from the game viewer, a cloud merge): redraw
// so no row keeps pointing at a game number that has since shifted.
function statsRefreshOpenSheets() {
  const sheet = document.getElementById("statisticsModal");
  const profile = document.getElementById("entityStatisticsModal");
  const content = document.getElementById("statisticsModalContent");
  // A sheet still waiting on its first draw will pick up the new data when it gets there.
  if (sheet && !sheet.classList.contains("hidden") && content && !content.hasAttribute("aria-busy")) statsRedraw();
  if (profile && !profile.classList.contains("hidden") && statsUi.stack.length) statsRenderProfileView({ keepScroll: true });
}

function statsShowTab(tab, { scrollTop = false } = {}) {
  if (!STATS_RENDERERS[tab]) return;
  const scroller = document.getElementById("statisticsModalScroll");
  if (scroller) statsUi.scroll[statsUi.tab] = scroller.scrollTop;
  statsUi.tab = tab;
  statsRender({ restoreScroll: !scrollTop });
}

function statsRenderProfileView({ keepScroll = false } = {}) {
  const content = document.getElementById("entityStatisticsModalContent");
  const back = document.getElementById("entityStatisticsBack");
  const title = document.getElementById("entityStatisticsModalTitle");
  if (!content) return;
  const current = statsUi.stack[statsUi.stack.length - 1];
  const model = statsModel();
  const entity = current && (current.kind === "team" ? model.teams.byKey.get(current.key) : model.players.byKey.get(current.key));
  const top = keepScroll ? content.scrollTop : 0;
  if (back) back.hidden = statsUi.stack.length < 2;
  if (!entity) {
    content.innerHTML = statsEmpty("info", "Nothing to show", "This player or team has no games in the selected period.");
    return;
  }
  if (title) title.textContent = entity.kind === "team" ? "Team stats" : "Player stats";
  content.innerHTML = statsRenderProfile(model, entity);
  statsInitCharts(content);
  content.scrollTop = top;
}

function statsOpenProfile(kind, key, { push = true } = {}) {
  const normalizedKind = kind === "team" || kind === "teams" ? "team" : "player";
  if (push) statsUi.stack.push({ kind: normalizedKind, key });
  // Remember what opened the first profile so closing it can hand focus back.
  if (statsUi.stack.length <= 1) statsUi.returnFocus = document.activeElement;
  // Visible first: a hidden element cannot be scrolled back to the top.
  if (document.getElementById("entityStatisticsModal")?.classList.contains("hidden")) {
    openSheetModal("entityStatisticsModal", closeEntityStatisticsModal);
  }
  statsRenderProfileView();
}

function statsProfileBack() {
  if (statsUi.stack.length > 1) {
    statsUi.stack.pop();
    statsRenderProfileView();
  } else {
    closeEntityStatisticsModal();
  }
}

function statsResetProfile() {
  statsUi.stack = [];
  const target = statsUi.returnFocus;
  statsUi.returnFocus = null;
  if (target && target.isConnected && typeof target.focus === "function") target.focus({ preventScroll: true });
}

function statsOpenGame(index) {
  if (typeof viewSavedGame === "function" && Number.isInteger(index)) viewSavedGame(index, { returnToLibrary: false });
}

function statsApplyControls({ view, metric, sort, entityMode, entityKey } = {}) {
  const canonical = statsCanonicalMetric(metric);
  const tab = view === "teams" || view === "players" ? view : null;
  if (tab) statsUi.tab = tab;
  const target = statsUi.tab === "teams" ? "teams" : "players";
  if (canonical) statsUi.rank[target].metric = canonical;
  if (sort === "recent") statsUi.rank[target] = { metric: "recent", dir: "desc" };
  else if (sort === "least") statsUi.rank[target].dir = "asc";
  else if (sort === "most") statsUi.rank[target].dir = "desc";
  if ((canonical || sort) && !tab && statsUi.tab !== "players" && statsUi.tab !== "teams") statsUi.tab = "players";
  statsRender({ restoreScroll: false });
  if (entityMode && entityKey) {
    statsShowAllTimeIfMissing(entityMode, entityKey);
    statsOpenProfile(entityMode, entityKey);
  }
}

// A period picked earlier can leave out someone who last played before it; asking for them by name
// should still land on their profile, so the filter steps back to all time.
function statsShowAllTimeIfMissing(mode, key) {
  if (statsUi.period === "all") return;
  const kind = mode === "team" || mode === "teams" ? "team" : "player";
  const model = statsModel();
  if ((kind === "team" ? model.teams.byKey : model.players.byKey).has(key)) return;
  statsUi.period = "all";
  statsRender({ restoreScroll: false });
}

// Older API, still used by voice commands.
function setStatisticsControls(controls) {
  statsApplyControls(controls);
}

function statsHandleClick(event) {
  const target = event.target.closest("button, [data-stats-tab], [data-open-entity], [data-open-game]");
  if (!target) return;
  if (target.matches("[data-stats-tab]")) {
    event.preventDefault();
    statsShowTab(target.getAttribute("data-stats-tab"), { scrollTop: !target.closest("#statsTabs") });
    return;
  }
  if (target.hasAttribute("data-open-entity")) {
    statsOpenProfile(target.getAttribute("data-open-entity"), target.getAttribute("data-entity-key"));
    return;
  }
  if (target.hasAttribute("data-open-game")) {
    statsOpenGame(Number(target.getAttribute("data-open-game")));
    return;
  }
  if (target.hasAttribute("data-rank-dir")) {
    const state = statsUi.rank[target.getAttribute("data-rank-dir") === "team" ? "teams" : "players"];
    state.dir = state.dir === "desc" ? "asc" : "desc";
    statsRedraw();
    return;
  }
  if (target.hasAttribute("data-game-list")) {
    statsUi.gameList = target.getAttribute("data-game-list");
    statsRedraw();
    return;
  }
  if (target.getAttribute("data-stats-toggle") === "insights") {
    statsUi.insightsOpen = !statsUi.insightsOpen;
    statsRedraw();
    return;
  }
  if (target.getAttribute("data-stats-toggle") === "unranked") {
    const key = target.getAttribute("data-kind") === "team" ? "teams" : "players";
    statsUi.showUnranked[key] = !statsUi.showUnranked[key];
    statsRedraw();
    return;
  }
  if (target.hasAttribute("data-stats-search-clear")) {
    const kind = target.getAttribute("data-stats-search-clear");
    statsUi.search[kind === "team" ? "teams" : "players"] = "";
    statsRedraw();
    document.querySelector(`[data-stats-search="${kind}"]`)?.focus();
    return;
  }
  if (target.hasAttribute("data-period-set")) {
    statsUi.period = target.getAttribute("data-period-set");
    statsRender({ restoreScroll: false });
    return;
  }
  if (target.hasAttribute("data-stats-start")) {
    closeMenuOverlay();
    closeStatisticsModal();
    // With nothing on the scoreboard there is nothing to lose, so skip the confirmation.
    if (hasActiveGame()) handleNewGame();
    else closeHomeScreen();
    return;
  }
  if (target.id === "entityStatisticsBack") statsProfileBack();
}

function statsHandleChange(event) {
  const target = event.target;
  if (target.id === "statsPeriodSelect") {
    statsUi.period = Object.prototype.hasOwnProperty.call(STATS_PERIODS, target.value) ? target.value : "all";
    statsRender({ restoreScroll: false });
    if (statsUi.stack.length) statsRenderProfileView();
    return;
  }
  const kind = target.getAttribute && target.getAttribute("data-rank-select");
  if (kind) {
    const metric = statsCanonicalMetric(target.value);
    if (metric) statsUi.rank[kind === "team" ? "teams" : "players"].metric = metric;
    statsRender({ restoreScroll: false });
  }
}

function statsHandleInput(event) {
  const kind = event.target.getAttribute && event.target.getAttribute("data-stats-search");
  if (!kind) return;
  statsUi.search[kind === "team" ? "teams" : "players"] = event.target.value;
  const host = document.getElementById("statsLeaderRows");
  if (host) host.innerHTML = statsLeaderRowsHtml(statsModel(), kind);
  document.querySelector(`[data-stats-search-clear="${kind}"]`)?.classList.toggle("hidden", !event.target.value);
}

function statsHandleKeydown(event) {
  const tab = event.target.closest && event.target.closest("#statsTabs [data-stats-tab]");
  if (!tab || (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End")) return;
  const ids = STATS_TABS.map(item => item.id);
  const current = ids.indexOf(tab.getAttribute("data-stats-tab"));
  const next = event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1
    : (current + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length;
  event.preventDefault();
  statsShowTab(ids[next]);
  document.querySelector(`#statsTabs [data-stats-tab="${ids[next]}"]`)?.focus();
}

function statsBindInteractions() {
  ["statisticsModal", "entityStatisticsModal"].forEach(id => {
    const modal = document.getElementById(id);
    if (!modal || modal.dataset.statsBound === "true") return;
    modal.dataset.statsBound = "true";
    modal.addEventListener("click", statsHandleClick);
    modal.addEventListener("change", statsHandleChange);
    modal.addEventListener("input", statsHandleInput);
    modal.addEventListener("keydown", statsHandleKeydown);
  });
}

// Called by openStatisticsModal() once the bundle has loaded.
function renderStatisticsApp(controls) {
  statsBindInteractions();
  statsUi.stack = [];
  statsUi.tab = "overview";
  statsUi.scroll = {};
  statsUi.insightsOpen = false;
  statsUi.search = { players: "", teams: "" };
  statsUi.showUnranked = { players: false, teams: false };
  if (controls && Object.keys(controls).length) statsApplyControls(controls);
  else statsRender({ restoreScroll: false });
}

// Called by openEntityStatisticsModal() once the bundle has loaded.
function showStatisticsProfile(mode, entityKey) {
  statsBindInteractions();
  statsUi.stack = [];
  const kind = mode === "players" || mode === "player" ? "player" : "team";
  statsShowAllTimeIfMissing(kind, entityKey);
  const model = statsModel();
  const exists = kind === "team" ? model.teams.byKey.has(entityKey) : model.players.byKey.has(entityKey);
  if (!exists) return false;
  statsOpenProfile(kind, entityKey);
  return true;
}
