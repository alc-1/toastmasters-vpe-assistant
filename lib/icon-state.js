// lib/icon-state.js
//
// Tracks per-source (basecamp/easyspeak) scrape status and keeps the
// toolbar icon in sync: idle -> loading (animated spinner) -> success
// (green check) / error (red cross). This is background-only — it is
// deliberately NOT loaded into popup.html. It owns a running setInterval
// for the spin animation; if the popup also loaded this file, opening the
// popup while something is loading would start a second, independent
// interval fighting over chrome.action.setIcon() with the background's
// own. Keeping all icon mutation in one context (the service worker)
// avoids that — the popup only ever asks background for the current
// statuses via the POPUP_OPENED message (see background.js) and never
// touches chrome.storage.session or chrome.action itself.

const ICON_STATUS_KEY = "iconStatus";
const SOURCES = ["basecamp", "easyspeak"];
const SIZES = [16, 32, 48, 128];
const LOADING_FRAME_COUNT = 8;
const LOADING_FRAME_INTERVAL_MS = 150;

function iconPathSet(basename) {
  const path = {};
  for (const size of SIZES) {
    path[size] = `icons/icon-${basename}-${size}.png`;
  }
  return path;
}

// icon-16.png etc. (no suffix) is the idle set — kept separate from the
// "icon-<state>-<size>.png" pattern used by the other three states since
// it's also manifest.json's static icons/default_icon.
const STATIC_ICON_PATHS = {
  idle: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
  success: iconPathSet("success"),
  error: iconPathSet("error"),
};

function loadingFramePath(frame) {
  return iconPathSet(`loading-${frame}`);
}

let animationTimer = null;
let animationFrame = 0;

/**
 * @returns {Promise<{basecamp: string, easyspeak: string}>}
 */
async function getIconStatuses() {
  const { [ICON_STATUS_KEY]: statuses } = await chrome.storage.session.get(ICON_STATUS_KEY);
  return statuses || { basecamp: "idle", easyspeak: "idle" };
}

/**
 * Records a source's status (called around each scrape) and updates the
 * toolbar icon to match.
 * @param {"basecamp"|"easyspeak"} source
 * @param {"idle"|"loading"|"success"|"error"} status
 */
async function setSourceStatus(source, status) {
  const statuses = await getIconStatuses();
  statuses[source] = status;
  await chrome.storage.session.set({ [ICON_STATUS_KEY]: statuses });
  await applyIcon(statuses);
  return statuses;
}

/**
 * Called when the popup opens: reverts any finished (success/error) source
 * back to idle — "opening the extension acknowledges" a finished result —
 * while leaving a still-in-progress (loading) source untouched.
 * @returns {Promise<{basecamp: string, easyspeak: string}>}
 */
async function acknowledgeIconStatuses() {
  const statuses = await getIconStatuses();
  let changed = false;
  for (const source of SOURCES) {
    if (statuses[source] === "success" || statuses[source] === "error") {
      statuses[source] = "idle";
      changed = true;
    }
  }
  if (changed) {
    await chrome.storage.session.set({ [ICON_STATUS_KEY]: statuses });
  }
  await applyIcon(statuses);
  return statuses;
}

/**
 * Combines both sources' statuses into the single toolbar icon's state:
 * any loading beats any error, which beats any success, which beats idle.
 * @param {{basecamp: string, easyspeak: string}} statuses
 */
function combineStatus(statuses) {
  const values = SOURCES.map((source) => statuses[source]);
  if (values.includes("loading")) return "loading";
  if (values.includes("error")) return "error";
  if (values.includes("success")) return "success";
  return "idle";
}

async function applyIcon(statuses) {
  const combined = combineStatus(statuses);
  if (combined === "loading") {
    startLoadingAnimation();
    return;
  }
  stopLoadingAnimation();
  await chrome.action.setIcon({ path: STATIC_ICON_PATHS[combined] });
}

function startLoadingAnimation() {
  if (animationTimer) return; // already animating
  chrome.action.setIcon({ path: loadingFramePath(animationFrame) });
  animationTimer = setInterval(() => {
    animationFrame = (animationFrame + 1) % LOADING_FRAME_COUNT;
    chrome.action.setIcon({ path: loadingFramePath(animationFrame) });
  }, LOADING_FRAME_INTERVAL_MS);
}

function stopLoadingAnimation() {
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
  }
  animationFrame = 0;
}
