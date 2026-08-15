// src/entrypoints/sync-data/main.ts
//
// Step 2 of the wizard: a Basecamp card and an EasySpeak card, plus a
// completion summary once both imports are in. Reuses
// shared/sync-status-panel.ts's bindSourceEls/onScrapeClick/renderScrapeResult
// for the actual scrape trigger + response handling (unchanged) — this file
// only owns the card/badge/summary presentation layered on top of it.

import { local, session } from "../../shared/storage";
import { sendMessage } from "../../shared/send-message";
import { renderAppShell, renderStepFooter } from "../../shared/app-shell";
import { computeStepperInfo, markStepVisited } from "../../shared/stepper-info";
import {
  bindSourceEls,
  loadMatchSummary,
  onScrapeClick,
  renderScrapeResult,
  type SourceEls,
} from "../../shared/sync-status-panel";
import { countBasecampMembers, countEasySpeakMembers } from "../../shared/sync/delta";
import { exportToExcel } from "../../shared/export/export-to-excel";
import type { BasecampScrape, EasySpeakScrape } from "../../shared/types";

type BadgeTone = "danger" | "pending" | "success";

const BADGE_LABEL: Record<BadgeTone, string> = {
  danger: "Not Imported",
  pending: "Importing",
  success: "Imported",
};

const basecampEls: SourceEls = bindSourceEls({ btn: "scrapeBasecampBtn", status: "statusBasecamp", summary: "summaryBasecamp", rawData: "rawDataBasecamp" });
const easyspeakEls: SourceEls = bindSourceEls({ btn: "scrapeEasySpeakBtn", status: "statusEasySpeak", summary: "summaryEasySpeak", rawData: "rawDataEasySpeak" });

const badgeBasecamp = document.getElementById("badgeBasecamp")!;
const progressBasecamp = document.getElementById("progressBasecamp")!;
const metaBasecamp = document.getElementById("metaBasecamp")!;
const detailsBasecamp = document.getElementById("detailsBasecamp") as HTMLDetailsElement;
const badgeEasySpeak = document.getElementById("badgeEasySpeak")!;
const metaEasySpeak = document.getElementById("metaEasySpeak")!;
const detailsEasySpeak = document.getElementById("detailsEasySpeak") as HTMLDetailsElement;
const completionSummary = document.getElementById("completionSummary")!;
const continueHelper = document.getElementById("continueHelper")!;

// Set once an Import/Re-import button is actually clicked on this page load
// — the completion summary below is gated on this (not just on both sources
// having data), so simply revisiting the page with already-imported data
// doesn't show it again; a fresh page load always starts false.
let importActionOccurred = false;

// Attached once, at module load — see the identical reasoning in the header
// comment this replaced: init()/refresh() can re-run on every
// browser.storage.onChanged event, and basecampEls.btn/easyspeakEls.btn are
// never replaced by rendering, so re-attaching here would stack listeners.
basecampEls.btn.addEventListener("click", async () => {
  setBadge(badgeBasecamp, "pending");
  await onScrapeClick<BasecampScrape>({
    els: basecampEls,
    message: { type: "SCRAPE_BASECAMP" },
    loadingLabel: "Importing…",
    render: renderScrapeResult,
  });
  importActionOccurred = true;
  await refresh();
});

easyspeakEls.btn.addEventListener("click", async () => {
  setBadge(badgeEasySpeak, "pending");
  await onScrapeClick<EasySpeakScrape>({
    els: easyspeakEls,
    message: { type: "SCRAPE_EASYSPEAK" },
    loadingLabel: "Importing…",
    render: renderScrapeResult,
  });
  importActionOccurred = true;
  await refresh();
});

const exportBtn = document.getElementById("exportExcelBtn") as HTMLButtonElement;
const statusExport = document.getElementById("statusExport")!;
const exportIdleLabel = exportBtn.textContent ?? "";

// Plain synchronous client-side work (no browser.tabs/background-lifetime
// constraint applies, unlike EasySpeak's tab-navigation), so this is wired
// directly rather than through onScrapeClick()/sendMessage() — same
// reasoning already applied to Member Review's direct resolution-store
// writes. Never gated on data being present: a partial (one-sided, or even
// empty) export is still legitimate, and exportToExcel() already degrades
// gracefully via buildReport()'s empty-scrape tolerance.
exportBtn.addEventListener("click", async () => {
  exportBtn.disabled = true;
  exportBtn.textContent = "Generating…";
  statusExport.textContent = "";
  try {
    const summary = await exportToExcel();
    const note = !summary.hasBasecampData || !summary.hasEasySpeakData ? " (partial data — import both sources for a complete export)" : "";
    statusExport.textContent = `Downloaded ${summary.filename}${note}`;
  } catch (err) {
    statusExport.textContent = `Export failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = exportIdleLabel;
  }
});

init();

// Keeps this tab in sync if a scrape started elsewhere (e.g. another Sync
// Data tab) finishes while this one stays open. Session-area changes are
// handled separately below (renderProgress alone, not a full init()) since
// those fire once per page fetched during a Basecamp import — far too often
// to justify a full re-render.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local") init();
  else if (area === "session" && changes.scrapeProgress) renderProgress();
});

async function init() {
  await markStepVisited("syncData");
  const stepperInfo = await computeStepperInfo();
  document.getElementById("appShell")!.innerHTML = renderAppShell({ active: "syncData", info: stepperInfo });
  document.getElementById("stepFooter")!.innerHTML = renderStepFooter("syncData", stepperInfo);

  await refresh();
}

async function refresh() {
  // Tells background this counts as "having seen" any finished (success/
  // error) result, reverting the toolbar icon to idle — a still-loading
  // source is left alone. Also gives us the current per-source status so a
  // scrape running from elsewhere still shows as "Importing" here.
  const statuses = (await sendMessage({ type: "POPUP_OPENED" })) || { basecamp: "idle", easyspeak: "idle" };

  const cached = await local.get(["basecampData", "basecampScrapedAt", "easyspeakData", "easyspeakScrapedAt"]);

  renderSourceCard(basecampEls, badgeBasecamp, metaBasecamp, detailsBasecamp, "Import Basecamp Data", cached.basecampData ?? null, cached.basecampScrapedAt, statuses.basecamp === "loading", countBasecampMembers);
  renderSourceCard(easyspeakEls, badgeEasySpeak, metaEasySpeak, detailsEasySpeak, "Import EasySpeak Data", cached.easyspeakData ?? null, cached.easyspeakScrapedAt, statuses.easyspeak === "loading", countEasySpeakMembers);
  await renderProgress();

  await renderCompletionSummary(cached.basecampData ?? null, cached.easyspeakData ?? null);

  const hasBoth = !!cached.basecampData && !!cached.easyspeakData;
  continueHelper.textContent = hasBoth ? "" : "Import Basecamp and EasySpeak data to continue.";
}

// Reads the live progress of a still-running Basecamp import (written by
// background/scrape-progress.ts to browser.storage.session) and renders it
// as a plain-text line — e.g. "Club 2 of 5 (Springfield) — 40 members out
// of 70 loaded so far". currentClubMembersTotal comes straight from the
// API's own per-club "count" field (see ScrapeProgress), so this is a real
// fraction, not an estimate. Called once on page load/refresh and again on
// every scrapeProgress change via the browser.storage.onChanged listener
// above; naturally blanks itself once the import finishes or errors, since
// messaging.ts clears the stored progress at that point.
async function renderProgress() {
  const state = await session.value("scrapeProgress");
  const progress = state?.basecamp;
  if (!progress) {
    progressBasecamp.textContent = "";
    return;
  }
  const clubLabel = `Club ${progress.currentClubIndex} of ${progress.clubsTotal} (${progress.currentClubName})`;
  progressBasecamp.textContent =
    progress.currentClubMembersTotal === null
      ? `${clubLabel} — starting…`
      : `${clubLabel} — ${progress.currentClubMembersFetched} member${progress.currentClubMembersFetched === 1 ? "" : "s"} out of ${progress.currentClubMembersTotal} loaded so far`;
}

function setBadge(el: HTMLElement, tone: BadgeTone) {
  el.className = `badge badge-${tone}`;
  el.textContent = BADGE_LABEL[tone];
}

// Time-only ("7:42 AM") rather than shared/sync-status-panel.ts's formatDate
// (full date + time) — a freshly imported source is always "today", so the
// date part is redundant noise in the card's 3-line result.
function formatTime(timestamp: number | undefined): string {
  if (!timestamp) return "just now";
  return new Date(timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function renderSourceCard<T extends BasecampScrape | EasySpeakScrape>(
  els: SourceEls,
  badge: HTMLElement,
  result: HTMLElement,
  details: HTMLDetailsElement,
  idleLabel: string,
  data: T | null,
  scrapedAt: number | undefined,
  isLoading: boolean,
  countMembers: (data: T) => number
) {
  if (isLoading) {
    setBadge(badge, "pending");
    els.btn.className = "btn btn-primary sync-card__action";
    els.btn.disabled = true;
    els.btn.textContent = "Importing…";
    details.hidden = true;
    return;
  }

  els.btn.disabled = false;

  if (data) {
    setBadge(badge, "success");
    // De-emphasized once a source already has data — re-importing is a
    // secondary action that shouldn't compete with the page's primary
    // Continue button, so it becomes a plain link rather than a full button.
    els.btn.className = "link-btn";
    els.btn.textContent = "Re-import data";
    const count = countMembers(data);
    result.innerHTML = `
      <div class="sync-card__result-status">Imported ✓</div>
      <div>${count} member${count === 1 ? "" : "s"}</div>
      <div>Imported ${formatTime(scrapedAt)}</div>
    `;
    els.status.textContent = "";
    details.hidden = false;
    renderScrapeResult(els, data);
  } else {
    setBadge(badge, "danger");
    els.btn.className = "btn btn-primary sync-card__action";
    els.btn.textContent = idleLabel;
    result.innerHTML = "";
    els.status.textContent = "";
    details.hidden = true;
  }
}

async function renderCompletionSummary(basecampData: BasecampScrape | null, easyspeakData: EasySpeakScrape | null) {
  if (!importActionOccurred || !basecampData || !easyspeakData) {
    completionSummary.hidden = true;
    return;
  }

  const { matched, total } = await loadMatchSummary(basecampData, easyspeakData);
  const basecampCount = countBasecampMembers(basecampData);
  const easyspeakCount = countEasySpeakMembers(easyspeakData);
  const needsReview = total - matched;

  completionSummary.hidden = false;
  completionSummary.innerHTML = `
    <div class="setup-summary__title sync-summary-title">
      <span>Data Import Complete</span>
      <span class="sync-summary-check">✓</span>
    </div>
    <div class="setup-summary__stats">
      <div class="setup-summary__item">Basecamp: ${basecampCount} member${basecampCount === 1 ? "" : "s"}</div>
      <div class="setup-summary__item">EasySpeak: ${easyspeakCount} member${easyspeakCount === 1 ? "" : "s"}</div>
      <div class="setup-summary__item">Matched: ${matched} member${matched === 1 ? "" : "s"}</div>
      <div class="setup-summary__item">Needs Review: ${needsReview} member${needsReview === 1 ? "" : "s"}</div>
    </div>
    <p class="setup-summary__footer">Ready to continue to Club Review.</p>
  `;
}
