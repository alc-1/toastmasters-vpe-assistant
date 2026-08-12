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
import { local } from "./storage";
import { sendMessage } from "./send-message";
import { loadResolutionData } from "./resolution-store";
import { buildReport, computeMatchSummary, type MatchSummary } from "./sync/delta";
import type { BasecampScrape, EasySpeakScrape } from "./types";

export type ScrapeRequest = { type: "SCRAPE_BASECAMP" } | { type: "SCRAPE_EASYSPEAK" };

export interface SourceEls {
  btn: HTMLButtonElement;
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
  return {
    btn,
    status: document.getElementById(ids.status)!,
    summary: document.getElementById(ids.summary)!,
    rawData: document.getElementById(ids.rawData)!,
    idleLabel: btn.textContent ?? "",
  };
}

export function formatDate(timestamp: number | undefined): string {
  return timestamp ? new Date(timestamp).toLocaleString("en-US") : "never";
}

export function setStatus(els: SourceEls, text: string) {
  els.status.textContent = text;
}

// Loading is communicated via the button itself (disabled + relabeled),
// not the status line — that keeps showing the last extraction time.
export function setButtonLoading(els: SourceEls, isLoading: boolean, loadingLabel: string) {
  els.btn.disabled = isLoading;
  els.btn.textContent = isLoading ? loadingLabel : els.idleLabel;
}

export function renderScrapeResult(els: SourceEls, data: BasecampScrape | EasySpeakScrape) {
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

// ---------------------------------------------------------------------------
// Compact status summary — a quick-glance replacement for reading the two
// per-source status lines individually. Self-contained (re-reads storage
// itself) so any call site can refresh it without threading state through:
// called once on page open, and again after each successful scrape. Returns
// the cached data so callers can layer their own page-specific follow-up on
// top (e.g. popup/index.ts's popup-subtitle update) without this module
// needing to know about it.
// ---------------------------------------------------------------------------

export async function renderStatusSummary(
  loading: { basecamp?: boolean; easyspeak?: boolean } = {}
): Promise<{ basecampData: BasecampScrape | null; easyspeakData: EasySpeakScrape | null }> {
  const cached = await local.get(["basecampData", "easyspeakData"]);
  const root = document.getElementById("statusSummary")!;

  const rows = [
    renderStatusRow("Basecamp", sourceStatusValue(!!loading.basecamp, !!cached.basecampData)),
    renderStatusRow("EasySpeak", sourceStatusValue(!!loading.easyspeak, !!cached.easyspeakData)),
  ];

  if (cached.basecampData && cached.easyspeakData) {
    const { matched, total } = await loadMatchSummary(cached.basecampData, cached.easyspeakData);
    rows.push(renderStatusRow("Matches", { text: `${matched}/${total}`, tone: total > 0 && matched === total ? "success" : "pending" }));
  } else {
    rows.push(renderStatusRow("Matches", { text: "—", tone: null }));
  }

  root.innerHTML = rows.join("");
  return { basecampData: cached.basecampData ?? null, easyspeakData: cached.easyspeakData ?? null };
}

function sourceStatusValue(isLoading: boolean, hasData: boolean): { text: string; tone: "success" | "pending" | null } {
  if (isLoading) return { text: "Extracting…", tone: "pending" };
  if (hasData) return { text: "✓ Synced", tone: "success" };
  return { text: "Not yet extracted", tone: null };
}

function renderStatusRow(label: string, value: { text: string; tone: "success" | "pending" | null }): string {
  const toneClass = value.tone ? ` is-${value.tone}` : "";
  return `
    <div class="status-summary__row">
      <span class="status-summary__label">${escapeHtml(label)}</span>
      <span class="status-summary__value${toneClass}">${escapeHtml(value.text)}</span>
    </div>
  `;
}

// The actual "which members count as matched" rule (isMemberResolved) lives
// in shared/sync/delta.ts, where it's pure and Vitest-testable — this is
// just the storage/report-building glue around it. Exported so the Sync Data
// page's Member Matching card + completion summary can reuse it directly
// instead of re-wiring loadResolutionData()/buildReport()/computeMatchSummary()
// themselves.
export async function loadMatchSummary(basecampData: BasecampScrape, easyspeakData: EasySpeakScrape): Promise<MatchSummary> {
  const resolution = await loadResolutionData();
  const report = buildReport(basecampData, easyspeakData, {}, resolution);
  return computeMatchSummary(report);
}
