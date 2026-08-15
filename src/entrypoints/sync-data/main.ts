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
import { EXPORT_TYPE_LABEL, type ExportType } from "../../shared/export/rows";
import { escapeHtml } from "../../shared/dom-utils";
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

const exportMenuBtn = document.getElementById("exportMenuBtn") as HTMLButtonElement;
const exportPopover = document.getElementById("exportPopover")!;

exportMenuBtn.addEventListener("click", () => {
  const isOpen = !exportPopover.hidden;
  exportPopover.hidden = isOpen;
  exportMenuBtn.setAttribute("aria-expanded", String(!isOpen));
});

// Attached once, at module load (same convention as the scrape button
// listeners above). Closes the popover on a click anywhere outside it —
// deliberately not on clicking "Export to Excel" itself, so the inline
// #statusExport success/error message it renders stays visible.
document.addEventListener("mousedown", (e) => {
  if (exportPopover.hidden) return;
  const target = e.target as Node;
  if (exportPopover.contains(target) || exportMenuBtn.contains(target)) return;
  exportPopover.hidden = true;
  exportMenuBtn.setAttribute("aria-expanded", "false");
});

// Which export type is currently selected in the Export card's radio-style
// selector. null only while neither Basecamp nor EasySpeak data is loaded
// yet (nothing to export). Persists across refresh() calls so a manual pick
// survives storage-change-triggered re-renders, unless that pick becomes
// unavailable — see refresh() below.
let selectedExportType: ExportType | null = null;

// True only once the user has actually clicked an option themselves.
// Distinguishes a deliberate choice (never silently overridden again) from
// an automatic fallback pick (e.g. "basecamp" chosen only because "all"
// wasn't available yet at the time) — refresh() upgrades the latter to
// "all" the moment it becomes available, instead of leaving the selector
// stuck on a narrower option once every source is actually loaded.
let exportTypeUserPicked = false;

const EXPORT_OPTION_DESC: Record<ExportType, string> = {
  all: "Aggregated data + sources + matches",
  basecamp: "Original Basecamp data",
  easyspeak: "Original EasySpeak data",
};

function computeExportAvailability(basecampData: BasecampScrape | null, easyspeakData: EasySpeakScrape | null): Record<ExportType, boolean> {
  const hasBasecamp = !!basecampData;
  const hasEasySpeak = !!easyspeakData;
  return { all: hasBasecamp && hasEasySpeak, basecamp: hasBasecamp, easyspeak: hasEasySpeak };
}

function updateExportButtonState() {
  exportBtn.disabled = selectedExportType === null;
}

function renderExportOptions(availability: Record<ExportType, boolean>) {
  const root = document.getElementById("exportOptionsRoot")!;
  root.innerHTML = (["all", "basecamp", "easyspeak"] as ExportType[])
    .map((type) => {
      const enabled = availability[type];
      const selected = selectedExportType === type;
      return `
        <label class="option-card${selected ? " selected" : ""}${enabled ? "" : " disabled"}">
          <input type="radio" name="exportType" value="${type}"${selected ? " checked" : ""}${enabled ? "" : " disabled"}>
          <span class="option-card__body">
            <span class="option-card__title">${EXPORT_TYPE_LABEL[type]}</span>
            <span class="option-card__desc">${EXPORT_OPTION_DESC[type]}</span>
          </span>
        </label>
      `;
    })
    .join("");

  root.querySelectorAll<HTMLInputElement>('input[name="exportType"]').forEach((input) => {
    input.addEventListener("change", () => {
      selectedExportType = input.value as ExportType;
      exportTypeUserPicked = true;
      renderExportOptions(availability);
    });
  });

  updateExportButtonState();
}

// Plain synchronous client-side work (no browser.tabs/background-lifetime
// constraint applies, unlike EasySpeak's tab-navigation), so this is wired
// directly rather than through onScrapeClick()/sendMessage() — same
// reasoning already applied to Member Review's direct resolution-store
// writes.
exportBtn.addEventListener("click", async () => {
  if (!selectedExportType) return;
  exportBtn.disabled = true;
  exportBtn.textContent = "Generating…";
  statusExport.textContent = "";
  try {
    const summary = await exportToExcel(selectedExportType);
    statusExport.innerHTML = `✓ Exported <ins>${escapeHtml(summary.filename)}</ins>`;
  } catch (err) {
    statusExport.textContent = `Export failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    exportBtn.textContent = exportIdleLabel;
    updateExportButtonState();
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

// refresh() is triggered from two independent places: explicitly, right
// after a scrape's onScrapeClick() resolves, and by the storage.onChanged
// listener above, which fires the instant a scrape writes its data to
// browser.storage.local — which happens *before* background/messaging.ts's
// runScrape() flips the source's icon status to "success" and responds.
// That means two overlapping refresh() calls can resolve out of order: an
// earlier-triggered call (from the storage write) can still read a stale
// "loading" status and finish *after* a later-triggered call already
// rendered the correct "success" state, stomping the badge back to
// "Importing" even though the data is already fully loaded (reproduced via
// the e2e suite — every other section, which only depends on `cached` and
// not `statuses`, still rendered correctly, only the loading-status-derived
// badge text got stuck). refreshToken guards against this: a call only
// applies its render once nothing newer has started meanwhile.
let refreshToken = 0;

async function refresh() {
  const myToken = ++refreshToken;

  // Tells background this counts as "having seen" any finished (success/
  // error) result, reverting the toolbar icon to idle — a still-loading
  // source is left alone. Also gives us the current per-source status so a
  // scrape running from elsewhere still shows as "Importing" here.
  const statuses = (await sendMessage({ type: "POPUP_OPENED" })) || { basecamp: "idle", easyspeak: "idle" };

  const cached = await local.get(["basecampData", "basecampScrapedAt", "easyspeakData", "easyspeakScrapedAt"]);

  if (myToken !== refreshToken) return; // a newer refresh() has since started — this one is stale

  // `statuses` and `cached` are two sequential awaits, not one atomic
  // snapshot — background/messaging.ts's runScrape() always writes the
  // scraped data to storage.local *before* flipping the source's
  // storage.session icon status to "success", so it's possible for this
  // call's `cached` read (the later of the two) to already see the data
  // while its earlier `statuses` read still said "loading", straddling the
  // exact moment the scrape finished. Data presence is the more
  // authoritative signal in that case — a source with data is never still
  // loading, regardless of what a status flag captured a moment earlier
  // says — so it always wins over a stale "loading".
  const basecampLoading = statuses.basecamp === "loading" && !cached.basecampData;
  const easyspeakLoading = statuses.easyspeak === "loading" && !cached.easyspeakData;

  renderSourceCard(basecampEls, badgeBasecamp, metaBasecamp, detailsBasecamp, "Import Basecamp Data", cached.basecampData ?? null, cached.basecampScrapedAt, basecampLoading, countBasecampMembers);
  renderSourceCard(easyspeakEls, badgeEasySpeak, metaEasySpeak, detailsEasySpeak, "Import EasySpeak Data", cached.easyspeakData ?? null, cached.easyspeakScrapedAt, easyspeakLoading, countEasySpeakMembers);
  await renderProgress();

  const exportAvailability = computeExportAvailability(cached.basecampData ?? null, cached.easyspeakData ?? null);
  if (!selectedExportType || !exportAvailability[selectedExportType]) {
    selectedExportType = (["all", "basecamp", "easyspeak"] as ExportType[]).find((t) => exportAvailability[t]) ?? null;
    exportTypeUserPicked = false;
  } else if (!exportTypeUserPicked && exportAvailability.all && selectedExportType !== "all") {
    // The current selection is still valid, but was only ever an automatic
    // fallback (e.g. "basecamp" picked back when EasySpeak hadn't been
    // imported yet) — now that "all" is available, prefer it. A selection
    // the user picked themselves is left alone even if "all" is available.
    selectedExportType = "all";
  }
  renderExportOptions(exportAvailability);

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
