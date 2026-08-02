// src/popup/index.ts

import { escapeHtml } from "../shared/dom-utils";
import { local, type LocalSchema } from "../shared/storage";
import { pageUrl } from "../shared/pages";
import { sendMessage } from "../shared/send-message";
import type { BasecampScrape, EasySpeakScrape, EasySpeakMemberRow } from "../shared/types";

type ScrapeRequest = { type: "SCRAPE_BASECAMP" } | { type: "SCRAPE_EASYSPEAK" };

interface SourceEls {
  btn: HTMLButtonElement;
  status: HTMLElement;
  summary: HTMLElement;
  rawData: HTMLElement;
  idleLabel: string;
}

const basecampEls: SourceEls = {
  btn: document.getElementById("scrapeBasecampBtn") as HTMLButtonElement,
  status: document.getElementById("statusBasecamp")!,
  summary: document.getElementById("summaryBasecamp")!,
  rawData: document.getElementById("rawDataBasecamp")!,
  idleLabel: "",
};
basecampEls.idleLabel = basecampEls.btn.textContent ?? "";

const easyspeakEls: SourceEls = {
  btn: document.getElementById("scrapeEasySpeakBtn") as HTMLButtonElement,
  status: document.getElementById("statusEasySpeak")!,
  summary: document.getElementById("summaryEasySpeak")!,
  rawData: document.getElementById("rawDataEasySpeak")!,
  idleLabel: "",
};
easyspeakEls.idleLabel = easyspeakEls.btn.textContent ?? "";

const reportEls = {
  btn: document.getElementById("openReportBtn") as HTMLButtonElement,
  reviewMatchesBtn: document.getElementById("reviewMatchesBtn") as HTMLButtonElement,
  status: document.getElementById("statusReport")!,
};

init();

async function init() {
  // Tells background this counts as "having seen" any finished (success/
  // error) result, reverting the toolbar icon to idle — a still-loading
  // source is left alone. Also gives us the current per-source status so
  // we know whether to disable a button below.
  const statuses = (await sendMessage({ type: "POPUP_OPENED" })) || { basecamp: "idle", easyspeak: "idle" };

  // If we already have cached extractions, show them when the popup opens
  // — including while a scrape might currently be running, so there's
  // always something to look at rather than a blank panel.
  const cached = await local.get(["basecampData", "basecampScrapedAt", "easyspeakData", "easyspeakScrapedAt"]);

  if (cached.basecampData) {
    setStatus(basecampEls, `Last extraction: ${formatDate(cached.basecampScrapedAt)}`);
    renderBasecampResult(basecampEls, cached.basecampData);
  }

  if (cached.easyspeakData) {
    setStatus(easyspeakEls, `Last extraction: ${formatDate(cached.easyspeakScrapedAt)}`);
    renderEasySpeakResult(easyspeakEls, cached.easyspeakData);
  }

  updateReportButton(!!cached.basecampData, !!cached.easyspeakData);

  // Reopening the popup while a scrape is still running elsewhere (e.g. an
  // EasySpeak tab that survived the popup's own teardown) would otherwise
  // show this stale "Last extraction: ..." line right next to a
  // disabled/relabeled button — set it explicitly so the two agree.
  if (statuses.basecamp === "loading") setStatus(basecampEls, "Still extracting… this can take a minute or two.");
  if (statuses.easyspeak === "loading") setStatus(easyspeakEls, "Still extracting… this can take a minute or two.");

  setButtonLoading(basecampEls, statuses.basecamp === "loading", "Basecamp data loading...");
  setButtonLoading(easyspeakEls, statuses.easyspeak === "loading", "EasySpeak data loading...");

  basecampEls.btn.addEventListener("click", () =>
    onScrapeClick({
      els: basecampEls,
      message: { type: "SCRAPE_BASECAMP" },
      dataKey: "basecampData",
      scrapedAtKey: "basecampScrapedAt",
      loadingLabel: "Basecamp data loading...",
      render: renderBasecampResult,
    })
  );

  easyspeakEls.btn.addEventListener("click", () => {
    // Set synchronously, before onScrapeClick's internal sendMessage() is
    // awaited — ensureEasySpeakTab() steals focus almost immediately, and
    // Chrome tears down this popup the instant it loses focus, so anything
    // set after the await may never actually render.
    setStatus(easyspeakEls, "Opening an EasySpeak tab now — this will close the popup (that's expected). Reopen it once the tab finishes or closes itself to see the result.");
    onScrapeClick({
      els: easyspeakEls,
      message: { type: "SCRAPE_EASYSPEAK" },
      dataKey: "easyspeakData",
      scrapedAtKey: "easyspeakScrapedAt",
      loadingLabel: "EasySpeak data loading...",
      render: renderEasySpeakResult,
    });
  });

  reportEls.btn.addEventListener("click", () => chrome.tabs.create({ url: pageUrl("options/report.html") }));

  reportEls.reviewMatchesBtn.addEventListener("click", () => chrome.tabs.create({ url: pageUrl("options/members.html") }));

  // Never disabled — Settings (mock mode, EasySpeak server) is meaningful to
  // change before any extraction exists, unlike the report/review buttons.
  document.getElementById("openSettingsLink")!.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: pageUrl("options/settings.html") });
  });
}

// Enables the report/review-matches buttons only once both sources have
// data cached — called on popup open and again after each successful
// scrape, so they go live the moment the second source finishes without
// needing a reopen.
function updateReportButton(hasBasecamp: boolean, hasEasyspeak: boolean) {
  const disabled = !(hasBasecamp && hasEasyspeak);
  reportEls.btn.disabled = disabled;
  reportEls.reviewMatchesBtn.disabled = disabled;
  reportEls.status.textContent = disabled ? "Extract both Basecamp and EasySpeak data first." : "";
}

// Loading is communicated via the button itself (disabled + relabeled),
// not the status line — that keeps showing the last extraction time.
function setButtonLoading(els: SourceEls, isLoading: boolean, loadingLabel: string) {
  els.btn.disabled = isLoading;
  els.btn.textContent = isLoading ? loadingLabel : els.idleLabel;
}

interface ScrapeClickOptions<T> {
  els: SourceEls;
  message: ScrapeRequest;
  dataKey: "basecampData" | "easyspeakData";
  scrapedAtKey: "basecampScrapedAt" | "easyspeakScrapedAt";
  loadingLabel: string;
  render: (els: SourceEls, data: T) => void;
}

async function onScrapeClick<T>({ els, message, dataKey, scrapedAtKey, loadingLabel, render }: ScrapeClickOptions<T>) {
  setButtonLoading(els, true, loadingLabel);
  // Deliberately not touching els.status/els.summary/els.rawData here —
  // keep showing the last extraction time and data until fresh data
  // actually arrives (or an error replaces the status line below).

  try {
    const response = await sendMessage(message);

    if (!response) {
      setStatus(els, "No response from the extension background worker. Try again.");
      return;
    }

    if (!response.ok) {
      setStatus(els, `Error during extraction: ${response.error}`);
      return;
    }

    const scrapedAt = Date.now();
    await local.set({ [dataKey]: response.data, [scrapedAtKey]: scrapedAt } as Partial<LocalSchema>);

    setStatus(els, `Extraction complete: ${formatDate(scrapedAt)}`);
    render(els, response.data as T);

    const both = await local.get(["basecampData", "easyspeakData"]);
    updateReportButton(!!both.basecampData, !!both.easyspeakData);
  } catch (err) {
    setStatus(els, `Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setButtonLoading(els, false, loadingLabel);
  }
}

function formatDate(timestamp: number | undefined): string {
  return timestamp ? new Date(timestamp).toLocaleString("en-US") : "never";
}

function setStatus(els: SourceEls, text: string) {
  els.status.textContent = text;
}

function renderBasecampResult(els: SourceEls, data: BasecampScrape) {
  const clubCount = Object.keys(data).length;
  const totalMembers = Object.values(data).reduce((sum, club) => sum + club.members.length, 0);

  let html = `<table><tr><th>Club</th><th>Entries (member x path)</th></tr>`;
  for (const club of Object.values(data)) {
    html += `<tr><td>${escapeHtml(club.name)}</td><td>${club.members.length}</td></tr>`;
  }
  html += `</table><p>${clubCount} club(s), ${totalMembers} entries total.</p>`;
  els.summary.innerHTML = html;

  els.rawData.textContent = JSON.stringify(data, null, 2);
}

function renderEasySpeakResult(els: SourceEls, data: EasySpeakScrape) {
  const clubCount = Object.keys(data).length;
  const totalMembers = Object.values(data).reduce((sum, club) => sum + club.members.length, 0);

  let html = `<table><tr><th>Club</th><th>Entries (member x path)</th><th>Needed</th><th>Done</th></tr>`;
  for (const club of Object.values(data)) {
    const { needed, done } = sumLevels(club.members);
    html += `<tr><td>${escapeHtml(club.name)}</td><td>${club.members.length}</td><td>${needed}</td><td>${done}</td></tr>`;
  }
  html += `</table><p>${clubCount} club(s), ${totalMembers} entries total.</p>`;
  els.summary.innerHTML = html;

  els.rawData.textContent = JSON.stringify(data, null, 2);
}

function sumLevels(members: EasySpeakMemberRow[]) {
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
