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
let activePaperGamePhotoController = null;

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

  const hasBid = candidate.bid !== null && candidate.bid !== undefined && candidate.bid !== "";
  return {
    usScore: parseScore(candidate.usScore),
    demScore: parseScore(candidate.demScore),
    bid: hasBid && Number.isInteger(Number(candidate.bid)) ? Number(candidate.bid) : null,
    confidence: ["high", "medium", "low"].includes(candidate.confidence)
      ? candidate.confidence
      : "low",
    warning: typeof candidate.warning === "string" ? candidate.warning.trim().slice(0, 240) : "",
  };
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

  usScoreInput.value = String(normalized.usScore);
  demScoreInput.value = String(normalized.demScore);
  usScoreInput.dispatchEvent(new Event("input", { bubbles: true }));
  demScoreInput.dispatchEvent(new Event("input", { bubbles: true }));

  const reviewMessage = normalized.warning
    ? `Us ${normalized.usScore}, Dem ${normalized.demScore}. ${normalized.warning}`
    : `Filled Us ${normalized.usScore} and Dem ${normalized.demScore} from the bottom score row. Check both, then start tracking.`;
  setPaperGamePhotoStatus(reviewMessage, "success");
  return normalized;
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
