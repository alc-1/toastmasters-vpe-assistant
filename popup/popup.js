// popup/popup.js

const basecampEls = {
  btn: document.getElementById("scrapeBasecampBtn"),
  status: document.getElementById("statusBasecamp"),
  summary: document.getElementById("summaryBasecamp"),
  rawData: document.getElementById("rawDataBasecamp"),
};
basecampEls.idleLabel = basecampEls.btn.textContent;

const easyspeakEls = {
  btn: document.getElementById("scrapeEasySpeakBtn"),
  status: document.getElementById("statusEasySpeak"),
  summary: document.getElementById("summaryEasySpeak"),
  rawData: document.getElementById("rawDataEasySpeak"),
};
easyspeakEls.idleLabel = easyspeakEls.btn.textContent;

init();

async function init() {
  // Tells background this counts as "having seen" any finished (success/
  // error) result, reverting the toolbar icon to idle — a still-loading
  // source is left alone. Also gives us the current per-source status so
  // we know whether to disable a button below.
  const statuses = (await chrome.runtime.sendMessage({ type: "POPUP_OPENED" })) || {};

  // If we already have cached extractions, show them when the popup opens
  // — including while a scrape might currently be running, so there's
  // always something to look at rather than a blank panel.
  const cached = await chrome.storage.local.get([
    "basecampData",
    "basecampScrapedAt",
    "easyspeakData",
    "easyspeakScrapedAt",
  ]);

  if (cached.basecampData) {
    setStatus(basecampEls, `Last extraction: ${formatDate(cached.basecampScrapedAt)}`);
    renderBasecampResult(basecampEls, cached.basecampData);
  }

  if (cached.easyspeakData) {
    setStatus(easyspeakEls, `Last extraction: ${formatDate(cached.easyspeakScrapedAt)}`);
    renderEasySpeakResult(easyspeakEls, cached.easyspeakData);
  }

  setButtonLoading(basecampEls, statuses.basecamp === "loading", "Basecamp data loading...");
  setButtonLoading(easyspeakEls, statuses.easyspeak === "loading", "EasySpeak data loading...");

  basecampEls.btn.addEventListener("click", () =>
    onScrapeClick({
      els: basecampEls,
      messageType: "SCRAPE_BASECAMP",
      dataKey: "basecampData",
      scrapedAtKey: "basecampScrapedAt",
      loadingLabel: "Basecamp data loading...",
      render: renderBasecampResult,
    })
  );

  easyspeakEls.btn.addEventListener("click", () =>
    onScrapeClick({
      els: easyspeakEls,
      messageType: "SCRAPE_EASYSPEAK",
      dataKey: "easyspeakData",
      scrapedAtKey: "easyspeakScrapedAt",
      loadingLabel: "EasySpeak data loading...",
      render: renderEasySpeakResult,
    })
  );
}

// Loading is communicated via the button itself (disabled + relabeled),
// not the status line — that keeps showing the last extraction time.
function setButtonLoading(els, isLoading, loadingLabel) {
  els.btn.disabled = isLoading;
  els.btn.textContent = isLoading ? loadingLabel : els.idleLabel;
}

async function onScrapeClick({ els, messageType, dataKey, scrapedAtKey, loadingLabel, render }) {
  setButtonLoading(els, true, loadingLabel);
  // Deliberately not touching els.status/els.summary/els.rawData here —
  // keep showing the last extraction time and data until fresh data
  // actually arrives (or an error replaces the status line below).

  try {
    const response = await chrome.runtime.sendMessage({ type: messageType });

    if (!response) {
      setStatus(els, "No response from the extension background worker. Try again.");
      return;
    }

    if (!response.ok) {
      setStatus(els, `Error during extraction: ${response.error}`);
      return;
    }

    const scrapedAt = Date.now();
    await chrome.storage.local.set({
      [dataKey]: response.data,
      [scrapedAtKey]: scrapedAt,
    });

    setStatus(els, `Extraction complete: ${formatDate(scrapedAt)}`);
    render(els, response.data);
  } catch (err) {
    setStatus(els, `Unexpected error: ${err.message}`);
  } finally {
    setButtonLoading(els, false, loadingLabel);
  }
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString("en-US");
}

function setStatus(els, text) {
  els.status.textContent = text;
}

function renderBasecampResult(els, data) {
  const clubCount = Object.keys(data).length;
  const totalMembers = Object.values(data).reduce(
    (sum, club) => sum + club.members.length,
    0
  );

  let html = `<table><tr><th>Club</th><th>Entries (member x path)</th></tr>`;
  for (const club of Object.values(data)) {
    html += `<tr><td>${escapeHtml(club.name)}</td><td>${club.members.length}</td></tr>`;
  }
  html += `</table><p>${clubCount} club(s), ${totalMembers} entries total.</p>`;
  els.summary.innerHTML = html;

  els.rawData.textContent = JSON.stringify(data, null, 2);
}

function renderEasySpeakResult(els, data) {
  const clubCount = Object.keys(data).length;
  const totalMembers = Object.values(data).reduce(
    (sum, club) => sum + club.members.length,
    0
  );

  let html = `<table><tr><th>Club</th><th>Entries (member x path)</th><th>Needed</th><th>Done</th></tr>`;
  for (const club of Object.values(data)) {
    const { needed, done } = sumLevels(club.members);
    html += `<tr><td>${escapeHtml(club.name)}</td><td>${club.members.length}</td><td>${needed}</td><td>${done}</td></tr>`;
  }
  html += `</table><p>${clubCount} club(s), ${totalMembers} entries total.</p>`;
  els.summary.innerHTML = html;

  els.rawData.textContent = JSON.stringify(data, null, 2);
}

function sumLevels(members) {
  let needed = 0;
  let done = 0;
  for (const member of members) {
    for (const level of member.levels) {
      needed += level.needed;
      done += level.done;
    }
  }
  return { needed, done };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
