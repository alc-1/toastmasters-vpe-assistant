// popup/popup.js

const BASECAMP_HOST = "apps.basecamp.toastmasters.org";

const scrapeBtn = document.getElementById("scrapeBtn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const rawDataEl = document.getElementById("rawData");

init();

async function init() {
  // Si on a déjà une extraction en cache, on l'affiche au chargement du popup.
  const cached = await chrome.storage.local.get(["basecampData", "basecampScrapedAt"]);
  if (cached.basecampData) {
    setStatus(`Dernière extraction : ${new Date(cached.basecampScrapedAt).toLocaleString("fr-CH")}`);
    renderResult(cached.basecampData);
  }

  scrapeBtn.addEventListener("click", onScrapeClick);
}

async function onScrapeClick() {
  scrapeBtn.disabled = true;
  setStatus("Extraction en cours...");
  summaryEl.innerHTML = "";
  rawDataEl.textContent = "";

  try {
    const tab = await getActiveTab();

    if (!tab?.url || !tab.url.includes(BASECAMP_HOST)) {
      setStatus(
        `Ouvre un onglet sur ${BASECAMP_HOST} (connecté à Basecamp Toastmasters), puis réessaie.`
      );
      return;
    }

    const response = await sendMessageToTab(tab.id, { type: "SCRAPE_BASECAMP" });

    if (!response) {
      setStatus(
        "Pas de réponse du content script. Recharge l'onglet Basecamp Toastmasters et réessaie."
      );
      return;
    }

    if (!response.ok) {
      setStatus(`Erreur pendant l'extraction : ${response.error}`);
      return;
    }

    const scrapedAt = Date.now();
    await chrome.storage.local.set({
      basecampData: response.data,
      basecampScrapedAt: scrapedAt,
    });

    setStatus(`Extraction terminée : ${new Date(scrapedAt).toLocaleString("fr-CH")}`);
    renderResult(response.data);
  } catch (err) {
    setStatus(`Erreur inattendue : ${err.message}`);
  } finally {
    scrapeBtn.disabled = false;
  }
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        // Le content script n'est probablement pas injecté sur cet onglet
        // (page pas encore chargée au moment de l'installation, etc.)
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
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

  let html = `<table><tr><th>Club</th><th>Entrées (membre x path)</th></tr>`;
  for (const club of Object.values(data)) {
    html += `<tr><td>${escapeHtml(club.name)}</td><td>${club.members.length}</td></tr>`;
  }
  html += `</table><p>${clubCount} club(s), ${totalMembers} entrée(s) au total.</p>`;
  summaryEl.innerHTML = html;

  rawDataEl.textContent = JSON.stringify(data, null, 2);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
