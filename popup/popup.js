// popup/popup.js

const scrapeBtn = document.getElementById("scrapeBtn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const rawDataEl = document.getElementById("rawData");

init();

async function init() {
  // If we already have a cached extraction, show it when the popup opens.
  const cached = await chrome.storage.local.get(["basecampData", "basecampScrapedAt"]);
  if (cached.basecampData) {
    setStatus(`Last extraction: ${new Date(cached.basecampScrapedAt).toLocaleString("en-US")}`);
    renderResult(cached.basecampData);
  }

  scrapeBtn.addEventListener("click", onScrapeClick);
}

async function onScrapeClick() {
  scrapeBtn.disabled = true;
  setStatus("Extracting...");
  summaryEl.innerHTML = "";
  rawDataEl.textContent = "";

  try {
    const response = await chrome.runtime.sendMessage({ type: "SCRAPE_BASECAMP" });

    if (!response) {
      setStatus("No response from the extension background worker. Try again.");
      return;
    }

    if (!response.ok) {
      setStatus(`Error during extraction: ${response.error}`);
      return;
    }

    const scrapedAt = Date.now();
    await chrome.storage.local.set({
      basecampData: response.data,
      basecampScrapedAt: scrapedAt,
    });

    setStatus(`Extraction complete: ${new Date(scrapedAt).toLocaleString("en-US")}`);
    renderResult(response.data);
  } catch (err) {
    setStatus(`Unexpected error: ${err.message}`);
  } finally {
    scrapeBtn.disabled = false;
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

function renderResult(data) {
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
  summaryEl.innerHTML = html;

  rawDataEl.textContent = JSON.stringify(data, null, 2);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
