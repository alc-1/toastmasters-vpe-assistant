// src/shared/sync-status-panel.ts
//
// Shared logic behind the "Data Extraction" card + sync-status summary,
// used by both popup/index.ts and options/sync-data.ts — the two pages
// render matching markup with matching element ids (scrapeBasecampBtn,
// statusBasecamp, summaryBasecamp, rawDataBasecamp, and the EasySpeak
// equivalents, plus a shared #statusSummary root) and both drive it through
// this module instead of duplicating the rendering/formatting/scrape-click
// code. Deliberately browser.*-dependent (browser.storage via shared/storage.ts,
// browser.runtime.sendMessage via shared/send-message.ts) — same category of
// exception as shared/resolution-store.ts/shared/settings-store.ts.
//
// Page-specific behavior stays out of this file: popup/index.ts still owns
// its own report/review-matches buttons, its Settings footer link, its
// popup-subtitle update, and the pre-click status message it sets before the
// EasySpeak flow can steal focus and tear the popup down.

import { escapeHtml } from "./dom-utils";
import { sendMessage } from "./send-message";
import { loadResolutionData } from "./resolution-store";
import { anonymizeBasecampScrape, anonymizeEasySpeakScrape } from "./anonymize";
import { buildReport, computeMatchSummary, type MatchSummary } from "./sync/delta";
import type { BasecampOverviewScrape, BasecampScrape, EasySpeakScrape, SourceKey } from "./types";

export type ScrapeRequest = { type: "SCRAPE_BASECAMP" } | { type: "SCRAPE_EASYSPEAK" };

export interface SourceEls {
  btn: HTMLButtonElement;
  // The element whose textContent is the button's actual label. Both
  // source buttons carry a permanent ".sync-card__action-sublabel" child
  // (their "opens a new tab" explanation) alongside a
  // ".sync-card__action-label" child, so label updates must target that
  // label child specifically, or they'd blow away the sublabel along with
  // it — falls back to the button itself if a caller's markup has no such
  // split (there is none today, but the fallback keeps this generic).
  btnLabel: HTMLElement;
  status: HTMLElement;
  summary: HTMLElement;
  rawData: HTMLElement;
  idleLabel: string;
}

export interface SourceElIds {
  btn: string;
  status: string;
  summary: string;
  rawData: string;
}

export function bindSourceEls(ids: SourceElIds): SourceEls {
  const btn = document.getElementById(ids.btn) as HTMLButtonElement;
  const btnLabel = (btn.querySelector<HTMLElement>(".sync-card__action-label")) ?? btn;
  return {
    btn,
    btnLabel,
    status: document.getElementById(ids.status)!,
    summary: document.getElementById(ids.summary)!,
    rawData: document.getElementById(ids.rawData)!,
    idleLabel: btnLabel.textContent ?? "",
  };
}

export function formatDate(timestamp: number | undefined): string {
  return timestamp ? new Date(timestamp).toLocaleString() : "never";
}

export function setStatus(els: SourceEls, text: string) {
  els.status.textContent = text;
}

// Loading is communicated via the button itself (disabled + relabeled),
// not the status line — that keeps showing the last extraction time.
export function setButtonLoading(els: SourceEls, isLoading: boolean, loadingLabel: string) {
  els.btn.disabled = isLoading;
  els.btnLabel.textContent = isLoading ? loadingLabel : els.idleLabel;
}

// `anonymize` runs `data` through the standalone (no ReportResult/`maps`)
// form of shared/anonymize.ts's scrape anonymizers — this is a single
// just-scraped source, with no matched report to derive cross-source labels
// from yet, so it self-numbers from its own club/member order instead. Those
// labels aren't guaranteed to match Club Progress/export's numbering for the
// same person, an accepted simplification for this low-stakes "did the
// scrape work" debug view (see shared/anonymize.ts's own doc comment). `source`
// picks which of the two structurally-different anonymizers applies
// (BasecampScrape/EasySpeakScrape aren't distinguishable at runtime by shape
// alone once a club has zero members) — same SourceKey tag callers already
// have on hand (it's what picked SCRAPE_BASECAMP vs. SCRAPE_EASYSPEAK).
export function renderScrapeResult(els: SourceEls, data: BasecampScrape | EasySpeakScrape, source: SourceKey, anonymize: boolean) {
  const displayData = anonymize
    ? source === "basecamp"
      ? anonymizeBasecampScrape(data as BasecampScrape)
      : anonymizeEasySpeakScrape(data as EasySpeakScrape)
    : data;
  const clubCount = Object.keys(displayData).length;
  const totalMembers = Object.values(displayData).reduce((sum, club) => sum + club.members.length, 0);

  let html = `<table><tr><th>Club</th><th>Entries (member x path)</th></tr>`;
  for (const club of Object.values(displayData)) {
    html += `<tr><td>${escapeHtml(club.name)}</td><td>${club.members.length}</td></tr>`;
  }
  html += `</table><p>${clubCount} club(s), ${totalMembers} entries total.</p>`;
  els.summary.innerHTML = html;

  els.rawData.textContent = JSON.stringify(displayData, null, 2);
}

interface ScrapeClickOptions<T> {
  els: SourceEls;
  message: ScrapeRequest;
  loadingLabel: string;
  render: (els: SourceEls, data: T) => void;
  onDone?: () => void | Promise<void>;
}

// Deliberately does NOT write basecampData/easyspeakData/*ScrapedAt itself —
// background/api/basecamp.ts and background/api/easyspeak.ts already persist
// the result (via local.setForProfile(), captured against the profile the
// scrape was actually run for) before responding. A second, ambient
// local.set() here would be not just redundant but actively racy: if the
// user switches the active profile in another tab while a scrape is still
// running, an ambient write at response time would land in whichever
// profile is active *now*, not the one the scrape ran for.
export async function onScrapeClick<T>({ els, message, loadingLabel, render, onDone }: ScrapeClickOptions<T>) {
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

    setStatus(els, `Extraction complete: ${formatDate(Date.now())}`);
    render(els, response.data as T);

    if (onDone) await onDone();
  } catch (err) {
    setStatus(els, `Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setButtonLoading(els, false, loadingLabel);
  }
}

// The actual "which members count as matched" rule (isMemberResolved) lives
// in shared/sync/delta.ts, where it's pure and Vitest-testable — this is
// just the storage/report-building glue around it. Exported so the Sync Data
// page's Member Matching card + completion summary can reuse it directly
// instead of re-wiring loadResolutionData()/buildReport()/computeMatchSummary()
// themselves.
export async function loadMatchSummary(
  basecampData: BasecampScrape,
  easyspeakData: EasySpeakScrape,
  basecampCompletedPaths: BasecampOverviewScrape = {}
): Promise<MatchSummary> {
  const resolution = await loadResolutionData();
  const report = buildReport(basecampData, easyspeakData, {}, resolution, basecampCompletedPaths);
  return computeMatchSummary(report);
}
