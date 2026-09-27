"use strict";

const SAME_ORIGIN_PAPER_GAME_PHOTO_URL = "/api/paper-game-photo";
const VERCEL_PAPER_GAME_PHOTO_URL = "https://rook-score.vercel.app/api/paper-game-photo";
const PAPER_GAME_PHOTO_GITHUB_PAGES_HOSTNAMES = new Set([
  "marvj69.github.io",
  "www.marvj69.github.io",
]);
const PAPER_GAME_PHOTO_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const PAPER_GAME_PHOTO_MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const PAPER_GAME_PHOTO_MAX_DIMENSION = 1800;
const PAPER_GAME_PHOTO_MAX_HISTORY_ROWS = 60;
let activePaperGamePhotoController = null;
// Rounds rebuilt from the last successful scan, kept until the resume form is
// submitted or reset. They only apply while the score fields still match.
let pendingPaperGameHistory = null;

function getPaperGamePhotoUrl() {
  if (typeof window === "undefined" || !window.location) return SAME_ORIGIN_PAPER_GAME_PHOTO_URL;
  return PAPER_GAME_PHOTO_GITHUB_PAGES_HOSTNAMES.has(window.location.hostname)
    ? VERCEL_PAPER_GAME_PHOTO_URL
    : SAME_ORIGIN_PAPER_GAME_PHOTO_URL;
}

function normalizePaperGamePhotoResult(result) {
  const candidate = result && typeof result === "object" ? result : {};
  const parseScore = (value) => {
    const score = Number(value);
    if (
      !Number.isFinite(score)
      || !Number.isInteger(score)
      || Math.abs(score) > 1000
      || Math.abs(score % 5) > 1e-9
    ) {
      throw new Error("The photo result contained an invalid score.");
    }
    return score;
  };

  const parseBid = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const bid = Number(value);
    return Number.isInteger(bid) && bid > 0 && bid <= 360 && bid % 5 === 0 ? bid : null;
  };

  const usScore = parseScore(candidate.usScore);
  const demScore = parseScore(candidate.demScore);
  let rows = [];
  if (Array.isArray(candidate.rows) && candidate.rows.length <= PAPER_GAME_PHOTO_MAX_HISTORY_ROWS) {
    try {
      rows = candidate.rows.map(row => ({
        us: parseScore(row?.us),
        bid: parseBid(row?.bid),
        dem: parseScore(row?.dem),
      }));
    } catch {
      rows = [];
    }
    const last = rows[rows.length - 1];
    if (!last || last.us !== usScore || last.dem !== demScore) rows = [];
  }

  return {
    usScore,
    demScore,
    bid: parseBid(candidate.bid),
    confidence: ["high", "medium", "low"].includes(candidate.confidence)
      ? candidate.confidence
      : "low",
    warning: typeof candidate.warning === "string" ? candidate.warning.trim().slice(0, 240) : "",
    rows,
  };
}

// Picks the bidding team for a paper row from how each total moved. A team
// that dropped by exactly the bid was set; otherwise the only team that gained
// at least the bid made it. Anything else (penalties, odd house rules) falls
// back to the team that went down, then to the larger gain.
function inferPaperGameBiddingTeam(usPoints, demPoints, bid) {
  if (usPoints === -bid && demPoints !== -bid) return "us";
  if (demPoints === -bid && usPoints !== -bid) return "dem";
  const usMade = usPoints >= bid;
  const demMade = demPoints >= bid;
  if (usMade !== demMade) return usMade ? "us" : "dem";
  if ((usPoints < 0) !== (demPoints < 0)) return usPoints < 0 ? "us" : "dem";
  return usPoints >= demPoints ? "us" : "dem";
}

// Turns the running totals written on a paper sheet into app rounds. Returns
// null when any hand is missing its bid, since those rounds cannot be rebuilt.
function buildPaperGameRoundsFromRows(rows, { usTeamName = "Us", demTeamName = "Dem" } = {}) {
  const sourceRows = Array.isArray(rows) ? rows.slice() : [];
  // A leading "0 | | 0" line is where the sheet starts, not a hand.
  if (sourceRows.length && sourceRows[0].us === 0 && sourceRows[0].dem === 0 && !sourceRows[0].bid) {
    sourceRows.shift();
  }
  if (!sourceRows.length) return null;

  const rounds = [];
  let previous = { us: 0, dem: 0 };
  for (const row of sourceRows) {
    if (!row || !row.bid) return null;
    const usPoints = row.us - previous.us;
    const demPoints = row.dem - previous.dem;
    rounds.push({
      roundIndex: rounds.length,
      biddingTeam: inferPaperGameBiddingTeam(usPoints, demPoints, row.bid),
      bidAmount: row.bid,
      usPoints,
      demPoints,
      runningTotals: { us: row.us, dem: row.dem },
      usTeamNameOnRound: usTeamName || "Us",
      demTeamNameOnRound: demTeamName || "Dem",
    });
    previous = { us: row.us, dem: row.dem };
  }
  return rounds;
}

// Hands the scanned rounds to the resume form when its scores still match the
// sheet's final totals, then forgets them.
function takePaperGameImportedRounds(usScore, demScore, teamNames = {}) {
  const history = pendingPaperGameHistory;
  pendingPaperGameHistory = null;
  if (!history || history.usScore !== usScore || history.demScore !== demScore) return null;
  return buildPaperGameRoundsFromRows(history.rows, teamNames);
}

function setPaperGamePhotoStatus(message = "", tone = "neutral") {
  const status = document.getElementById("resumePaperPhotoStatus");
  if (!status) return;

  status.textContent = message;
  status.classList.toggle("hidden", !message);
  status.classList.remove(
    "text-blue-700",
    "dark:text-blue-200",
    "text-green-700",
    "dark:text-green-300",
    "text-red-700",
    "dark:text-red-300",
  );

  if (tone === "success") {
    status.classList.add("text-green-700", "dark:text-green-300");
  } else if (tone === "error") {
    status.classList.add("text-red-700", "dark:text-red-300");
  } else {
    status.classList.add("text-blue-700", "dark:text-blue-200");
  }
}

function setPaperGamePhotoBusy(isBusy) {
  const button = document.getElementById("resumePaperPhotoButton");
  if (!button) return;
  button.disabled = Boolean(isBusy);
  button.setAttribute("aria-busy", String(Boolean(isBusy)));
  const label = button.querySelector("[data-paper-photo-label]");
  if (label) {
    label.textContent = isBusy ? "Reading Score Sheet…" : "Take Photo / Choose Image";
  }
}

function updatePaperGamePhotoExperimentUI(isEnabled = isExperimentalFeaturesEnabled()) {
  const container = document.getElementById("resumePaperPhotoContainer");
  if (container) container.classList.toggle("hidden", !isEnabled);
  if (!isEnabled) cancelPaperGamePhotoScan();
  return Boolean(isEnabled);
}

function resetPaperGamePhotoUI() {
  pendingPaperGameHistory = null;
  const input = document.getElementById("resumePaperPhotoInput");
  if (input) input.value = "";
  setPaperGamePhotoBusy(false);
  setPaperGamePhotoStatus("");
  updatePaperGamePhotoExperimentUI();
}

function triggerPaperGamePhotoInput() {
  if (!isExperimentalFeaturesEnabled()) {
    setPaperGamePhotoStatus("Turn on Experimental Features in Settings to use photo import.", "error");
    return false;
  }
  document.getElementById("resumePaperPhotoInput")?.click();
  return true;
}

function loadPaperGamePhotoImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("This image could not be opened. Try a JPEG photo."));
    };
    image.src = objectUrl;
  });
}

function canvasToPaperGamePhotoBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("The photo could not be prepared for upload."));
    }, "image/jpeg", quality);
  });
}

async function preparePaperGamePhoto(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("Choose an image of the paper score sheet.");
  }
  if (file.size > PAPER_GAME_PHOTO_MAX_SOURCE_BYTES) {
    throw new Error("That photo is too large. Try a closer crop or a lower-resolution photo.");
  }

  const image = await loadPaperGamePhotoImage(file);
  const sourceWidth = Number(image.naturalWidth || image.width);
  const sourceHeight = Number(image.naturalHeight || image.height);
  if (!sourceWidth || !sourceHeight || sourceWidth < 160 || sourceHeight < 160) {
    throw new Error("That photo is too small. Take a clearer photo of the whole score table.");
  }

  let scale = Math.min(1, PAPER_GAME_PHOTO_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const qualityLevels = [0.9, 0.82, 0.74, 0.66];

  for (const quality of qualityLevels) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo preparation is unavailable in this browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToPaperGamePhotoBlob(canvas, quality);
    if (blob.size <= PAPER_GAME_PHOTO_MAX_UPLOAD_BYTES) return blob;
    scale *= 0.86;
  }

  throw new Error("The prepared photo is still too large. Crop it to the score table and try again.");
}

async function requestPaperGamePhotoScan(photoBlob, signal) {
  const body = new FormData();
  body.append("photo", photoBlob, "rook-paper-score.jpg");
  const response = await fetch(getPaperGamePhotoUrl(), {
    method: "POST",
    headers: { Accept: "application/json" },
    body,
    signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "The score sheet could not be read. Try a clearer photo.");
  }
  return normalizePaperGamePhotoResult(payload.scan);
}

function applyPaperGamePhotoResult(result) {
  const normalized = normalizePaperGamePhotoResult(result);
  const usScoreInput = document.getElementById("resumeUsScore");
  const demScoreInput = document.getElementById("resumeDemScore");
  if (!usScoreInput || !demScoreInput) {
    throw new Error("The Resume Paper Game score fields are unavailable.");
  }

  const roundCount = buildPaperGameRoundsFromRows(normalized.rows)?.length || 0;
  pendingPaperGameHistory = roundCount
    ? { usScore: normalized.usScore, demScore: normalized.demScore, rows: normalized.rows, roundCount }
    : null;

  usScoreInput.value = String(normalized.usScore);
  demScoreInput.value = String(normalized.demScore);
  usScoreInput.dispatchEvent(new Event("input", { bubbles: true }));
  demScoreInput.dispatchEvent(new Event("input", { bubbles: true }));

  setPaperGamePhotoStatus(getPaperGamePhotoReviewMessage(normalized, roundCount), "success");
  return normalized;
}

function getPaperGamePhotoReviewMessage(result, roundCount) {
  const scores = `Us ${result.usScore}, Dem ${result.demScore}`;
  const history = roundCount
    ? ` ${roundCount} round${roundCount === 1 ? "" : "s"} of history will be imported.`
    : " The earlier rounds could not all be read, so only the current score will be used.";
  return result.warning
    ? `${scores}.${history} ${result.warning}`
    : `Filled ${scores} from the bottom score row.${history} Check both, then start tracking.`;
}

// Warns when a hand edit means the scanned history no longer adds up to the
// entered scores, and restores the import note if the edit is undone.
function handleResumeScoreEdited() {
  const history = pendingPaperGameHistory;
  if (!history) return;
  const usScore = Number(document.getElementById("resumeUsScore")?.value);
  const demScore = Number(document.getElementById("resumeDemScore")?.value);
  if (usScore === history.usScore && demScore === history.demScore) {
    setPaperGamePhotoStatus(getPaperGamePhotoReviewMessage(history, history.roundCount), "success");
  } else {
    setPaperGamePhotoStatus(
      "The scores no longer match the photo, so only the scores you entered will be used. The photo's round history will not be imported.",
      "neutral",
    );
  }
}

async function handlePaperGamePhotoSelected(input) {
  const file = input?.files?.[0];
  if (input) input.value = "";
  if (!file) return false;
  if (!isExperimentalFeaturesEnabled()) {
    setPaperGamePhotoStatus("Turn on Experimental Features in Settings to use photo import.", "error");
    return false;
  }

  cancelPaperGamePhotoScan();
  pendingPaperGameHistory = null;
  const controller = new AbortController();
  activePaperGamePhotoController = controller;
  setPaperGamePhotoBusy(true);
  setPaperGamePhotoStatus("Preparing and reading the score sheet…");

  try {
    const preparedPhoto = await preparePaperGamePhoto(file);
    const result = await requestPaperGamePhotoScan(preparedPhoto, controller.signal);
    if (activePaperGamePhotoController !== controller) return false;
    applyPaperGamePhotoResult(result);
    return true;
  } catch (error) {
    if (error?.name !== "AbortError" && activePaperGamePhotoController === controller) {
      setPaperGamePhotoStatus(
        error?.message || "The score sheet could not be read. Try a clearer photo.",
        "error",
      );
    }
    return false;
  } finally {
    if (activePaperGamePhotoController === controller) {
      activePaperGamePhotoController = null;
      setPaperGamePhotoBusy(false);
    }
  }
}

function cancelPaperGamePhotoScan() {
  if (activePaperGamePhotoController) {
    activePaperGamePhotoController.abort();
    activePaperGamePhotoController = null;
  }
  setPaperGamePhotoBusy(false);
}
