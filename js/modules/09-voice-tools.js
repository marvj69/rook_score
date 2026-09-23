"use strict";

// --- Voice Tool Registry ---
// The one catalog of voice planner statuses, actions, and action fields.
// api/voice-score-command.js builds its schema and prompt from it, and the lazy
// voice bundle uses it to whitelist, execute, and sanitize the same actions.
// Adding a tool: add it here, describe it in VOICE_TOOL_DESCRIPTIONS on the
// server, and give it a handler in VOICE_SCORE_ACTION_HANDLERS in the browser.
const VOICE_TOOLS = (() => {
  const teams = ["us", "dem"];
  const views = ["teams", "players"];
  const gameTypes = ["completed", "freezer"];
  const enumField = values => ({ kind: "enum", schema: { type: "string", enum: values } });
  const numberField = { kind: "number", schema: { type: "number" } };
  const booleanField = { kind: "boolean", schema: { type: "boolean" } };
  const colorField = { kind: "color", schema: { type: "string" } };
  const playersField = count => ({
    kind: "players",
    schema: { type: "array", minItems: count, maxItems: count, items: { type: "string" } },
  });
  const scoredHandFields = ["biddingTeam", "bidAmount", "points", "enterBidderPoints"];

  return Object.freeze({
    statuses: ["execute", "confirm", "clarify", "answer", "unsupported"],
    outcomes: ["success", "failed", "cancelled", "clarify", "unsupported", "answered"],
    fields: {
      biddingTeam: enumField(teams),
      team: enumField(teams),
      bidAmount: numberField,
      points: numberField,
      enterBidderPoints: booleanField,
      roundNumber: { kind: "number", schema: { type: "integer", minimum: 1 } },
      usTotal: numberField,
      demTotal: numberField,
      usScore: numberField,
      demScore: numberField,
      target: enumField([
        "savedGames", "settings", "about", "statistics", "dealerOrder", "teamSelection",
        "resumeGame", "theme", "presets", "probability", "version", "bugReport",
        "confirmation", "all",
      ]),
      dealers: playersField(4),
      usPlayers: playersField(2),
      demPlayers: playersField(2),
      firstDealer: { kind: "player", schema: { type: "string" } },
      pair: enumField(["13", "24"]),
      key: enumField([
        "mustWinByBid", "misdealHandling", "proMode", "experimentalFeatures",
        "tableTalkPenaltyType", "tableTalkPenaltyPoints", "spokenReplies",
      ]),
      value: {
        kind: "settingValue",
        schema: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] },
      },
      open: booleanField,
      authAction: enumField(["toggle", "signIn", "signOut"]),
      confirmationChoice: enumField(["confirm", "cancel"]),
      gameAction: enumField(["switchTab", "search", "sort", "view", "delete", "resume"]),
      gameType: enumField(gameTypes),
      tab: enumField(gameTypes),
      query: { kind: "text", schema: { type: "string" } },
      sort: enumField(["newest", "oldest", "highest", "lowest"]),
      index: numberField,
      usColor: colorField,
      demColor: colorField,
      themeAction: enumField(["randomize", "reset", "apply"]),
      presets: {
        kind: "numbers",
        schema: { type: "array", minItems: 1, maxItems: 12, items: { type: "number" } },
      },
      statsView: enumField(views),
      statsMetric: enumField([
        "netPerGame", "bidMakePct", "setsForced", "comebacks",
        "closeWins", "perfect360s", "misdeals", "games",
      ]),
      statsSort: enumField(["recent", "most", "least"]),
      entityMode: enumField(views),
      entityKey: { kind: "entityKey", schema: { type: "string" } },
    },
    // Action type -> the fields that action accepts.
    actions: {
      scoreRound: scoredHandFields,
      replaceLastRound: scoredHandFields,
      editRound: ["roundNumber", "bidAmount", "usTotal", "demTotal"],
      undo: [],
      redo: [],
      misdeal: [],
      newGame: [],
      freezeGame: [],
      saveGame: [],
      rematch: ["firstDealer"],
      openModal: ["target"],
      closeModal: ["target"],
      setDealerOrder: ["dealers"],
      startPaperGame: ["usScore", "demScore", "usPlayers", "demPlayers"],
      setTeams: ["usPlayers", "demPlayers"],
      selectDealerPair: ["pair"],
      selectBid: ["biddingTeam", "bidAmount"],
      setSetting: ["key", "value"],
      tableTalkPenalty: ["team"],
      toggleMenu: ["open"],
      authAction: ["authAction"],
      confirmationAction: ["confirmationChoice"],
      gameLibraryAction: ["gameAction", "gameType", "tab", "query", "sort", "index"],
      setThemeColors: ["usColor", "demColor"],
      themeAction: ["themeAction"],
      setBidPresets: ["presets"],
      setStatsControls: ["statsView", "statsMetric", "statsSort", "entityMode", "entityKey"],
      exportData: [],
      noop: [],
    },
  });
})();

// The Vercel function require()s this file. Browsers and the test loader run it
// as a classic script instead, where `require` is undefined; firebase-init.js
// reads the window copy.
if (typeof require === "function" && typeof module !== "undefined" && module.exports) {
  module.exports = VOICE_TOOLS;
}
if (typeof window !== "undefined") window.ROOK_VOICE_TOOLS = VOICE_TOOLS;
