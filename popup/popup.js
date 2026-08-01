// popup/popup.js

const basecampEls = {
  btn: document.getElementById("scrapeBasecampBtn"),
  status: document.getElementById("statusBasecamp"),
  summary: document.getElementById("summaryBasecamp"),
  rawData: document.getElementById("rawDataBasecamp"),
};

const easyspeakEls = {
  btn: document.getElementById("scrapeEasySpeakBtn"),
  status: document.getElementById("statusEasySpeak"),
  summary: document.getElementById("summaryEasySpeak"),
  rawData: document.getElementById("rawDataEasySpeak"),
};

init();

async function init() {
  // If we already have cached extractions, show them when the popup opens.
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

  basecampEls.btn.addEventListener("click", () =>
    onScrapeClick({
      els: basecampEls,
      messageType: "SCRAPE_BASECAMP",
      dataKey: "basecampData",
      scrapedAtKey: "basecampScrapedAt",
      render: renderBasecampResult,
    })
  );

  easyspeakEls.btn.addEventListener("click", () =>
    onScrapeClick({
      els: easyspeakEls,
      messageType: "SCRAPE_EASYSPEAK",
      dataKey: "easyspeakData",
      scrapedAtKey: "easyspeakScrapedAt",
      render: renderEasySpeakResult,
    })
  );
}

async function onScrapeClick({ els, messageType, dataKey, scrapedAtKey, render }) {
  els.btn.disabled = true;
  setStatus(els, "Extracting...");
  els.summary.innerHTML = "";
  els.rawData.textContent = "";

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
    els.btn.disabled = false;
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
