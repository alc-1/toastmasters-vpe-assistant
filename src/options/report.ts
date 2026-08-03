// src/options/report.ts
//
// DOM glue for the comparison report page: reads the already-scraped data
// straight out of chrome.storage.local (no live scraping happens here) and
// hands it to buildReport() from shared/sync/delta.ts, then renders the
// result. Kept separate from shared/sync/* so the pure matching/diff logic
// stays chrome.*-free and independently testable.

import { escapeHtml, warningIconHtml } from "../shared/dom-utils";
import { local } from "../shared/storage";
import { loadResolutionData } from "../shared/resolution-store";
import { buildLevelSummary, buildReport, reportToRows, toCsv } from "../shared/sync/delta";
import { renderAppShell } from "../shared/app-shell";
import { computeStepperInfo } from "../shared/stepper-info";
import type { ClubPairReport, LevelSummaryRow, MemberReport, PathReport, ReportResult } from "../shared/types";

const downloadCsvBtn = document.getElementById("downloadCsvBtn") as HTMLButtonElement;
downloadCsvBtn.disabled = true;

// Set once, at module load, rather than inside refresh() — refresh() can run
// more than once per page load (see the chrome.storage.onChanged listener
// below), and re-attaching this listener on every call would stack a new
// one each time instead of replacing it, since downloadCsvBtn is a
// module-level element whose innerHTML is never replaced by rendering.
let currentReport: ReportResult | null = null;
downloadCsvBtn.addEventListener("click", () => {
  if (currentReport) downloadCsv(currentReport);
});

refresh();

// Keeps this tab in sync if data is re-extracted or resolution decisions are
// edited from another tab (e.g. Members, Club Review) while this one stays open.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") refresh();
});

async function refresh() {
  const stepperInfo = await computeStepperInfo();
  document.getElementById("appShell")!.innerHTML = renderAppShell({ active: "report", info: stepperInfo });

  const cached = await local.get(["basecampData", "basecampScrapedAt", "easyspeakData", "easyspeakScrapedAt"]);

  if (!cached.basecampData || !cached.easyspeakData) {
    currentReport = null;
    downloadCsvBtn.disabled = true;
    document.getElementById("conflictWarning")!.innerHTML = "";
    document.getElementById("kpiRoot")!.innerHTML = "";
    document.getElementById("clubTabs")!.innerHTML = "";
    document.getElementById("summaryTableRoot")!.innerHTML = "";
    document.getElementById("reportRoot")!.innerHTML =
      '<p class="empty-state">Both Basecamp and EasySpeak data are needed to build this report. ' +
      "Click the extension's toolbar icon and run both extractions first.</p>";
    return;
  }

  document.getElementById("reportMeta")!.textContent =
    `Basecamp last extracted: ${formatDate(cached.basecampScrapedAt)} — ` + `EasySpeak last extracted: ${formatDate(cached.easyspeakScrapedAt)}`;

  // Loading persisted resolution decisions here (not just in members.ts) is
  // required, not optional — otherwise this page's CSV export and Level
  // Summary would silently diverge from what the Member Review view shows.
  const resolution = await loadResolutionData();
  const report = buildReport(
    cached.basecampData,
    cached.easyspeakData,
    { basecampScrapedAt: cached.basecampScrapedAt, easyspeakScrapedAt: cached.easyspeakScrapedAt },
    // This page shows the VPE's authoritative record, so an unconfirmed
    // fuzzy guess must never render here as if it were a fact — only an
    // exact name match or an explicitly-confirmed memberLinks entry counts.
    // The Members view is where fuzzy suggestions actually get resolved.
    { ...resolution, allowFuzzyMemberMatches: false }
  );

  currentReport = report;
  downloadCsvBtn.disabled = false;

  renderConflictWarning(report);
  renderKpiRow(report);

  // Zipped by index: buildLevelSummary(report) produces one group per
  // report.clubPairs entry, in the same order, so a tab can drive both the
  // summary table and the member-list detail for the same club together.
  const summaryGroups = buildLevelSummary(report);
  const clubSections = report.clubPairs.map((clubPair, index) => ({
    clubKey: summaryGroups[index].clubKey,
    clubName: summaryGroups[index].clubName,
    summaryRows: summaryGroups[index].rows,
    clubPair,
  }));

  renderClubTabs(clubSections);
}

// ---------------------------------------------------------------------------
// Conflict warning banner: flags clubs with no counterpart at all in the
// other system, and members left unmatched within a matched club pair (an
// unconfirmed fuzzy guess counts as unmatched here too, since this page
// excludes those — see the allowFuzzyMemberMatches: false call above).
// ---------------------------------------------------------------------------

function renderConflictWarning(report: ReportResult) {
  const root = document.getElementById("conflictWarning")!;

  const unmatchedClubCount = report.clubPairs.filter((c) => !c.basecampClubId || !c.easyspeakClubId).length;
  // An orphan-resolved member (matchConfidence "confirmed" with no real
  // counterpart) has already been reviewed and dismissed, so it's excluded
  // here the same way a "both"-presence member is.
  const unmatchedMemberCount = report.clubPairs.reduce(
    (sum, c) => sum + c.members.filter((m) => m.presence !== "both" && m.matchConfidence !== "confirmed").length,
    0
  );

  if (unmatchedClubCount === 0 && unmatchedMemberCount === 0) {
    root.innerHTML = "";
    return;
  }

  const parts: string[] = [];
  if (unmatchedClubCount > 0) parts.push(`${unmatchedClubCount} club${unmatchedClubCount === 1 ? "" : "s"}`);
  if (unmatchedMemberCount > 0) parts.push(`${unmatchedMemberCount} member${unmatchedMemberCount === 1 ? "" : "s"}`);

  const fixLinks = [
    unmatchedClubCount > 0 ? '<a href="club-review.html">Fix club matches in Club Review</a>' : "",
    unmatchedMemberCount > 0 ? '<a href="members.html">Fix member matches in Member Review</a>' : "",
  ].filter(Boolean);

  root.innerHTML = `
    <div class="conflict-warning">
      ${warningIconHtml("Conflicts found")}
      ${parts.join(" and ")} without a match between Basecamp and EasySpeak.
      ${fixLinks.join(" · ")}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// KPI row: a global (all-clubs) at-a-glance summary, shown above the club
// tabs so a VPE sees the overall picture before drilling into one club —
// every figure here is a plain aggregation over the same ReportResult the
// rest of the page already renders from, not a new calculation.
// ---------------------------------------------------------------------------

interface ReportKpis {
  members: number;
  paths: number;
  needsReview: number;
  missingMatches: number;
}

function computeKpis(report: ReportResult): ReportKpis {
  let members = 0;
  let paths = 0;
  let needsReview = 0;
  let missingMatches = 0;

  for (const club of report.clubPairs) {
    members += club.members.length;
    for (const member of club.members) {
      paths += member.paths.filter((p) => !p.nonPathway).length;
      if (member.matchConfidence === "fuzzy") needsReview += 1;
      // Excludes orphan-resolved members (matchConfidence "confirmed" with no
      // real counterpart) — a reviewed-and-dismissed member isn't "missing".
      if (member.presence !== "both" && member.matchConfidence !== "confirmed") missingMatches += 1;
    }
  }

  return { members, paths, needsReview, missingMatches };
}

function renderKpiRow(report: ReportResult) {
  const root = document.getElementById("kpiRoot")!;
  const kpis = computeKpis(report);

  const cards: { label: string; value: number; modifier?: "warning" | "danger" }[] = [
    { label: "Members", value: kpis.members },
    { label: "Paths", value: kpis.paths },
    { label: "Needs Review", value: kpis.needsReview, modifier: "warning" },
    { label: "Missing Matches", value: kpis.missingMatches, modifier: "danger" },
  ];

  root.innerHTML = cards
    .map((c) => {
      const valueClass = c.modifier && c.value > 0 ? ` is-${c.modifier}` : "";
      return `
        <div class="kpi-card">
          <div class="kpi-card__value${valueClass}">${c.value}</div>
          <div class="kpi-card__label">${escapeHtml(c.label)}</div>
        </div>
      `;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Club tabs: each tab drives both the "Next Level Summary" table and the
// "Member List" detail view for the same club together.
// ---------------------------------------------------------------------------

interface SummaryColumn {
  key: keyof LevelSummaryRow;
  label: string;
  colClass: string;
}

const SUMMARY_COLUMNS: SummaryColumn[] = [
  { key: "memberName", label: "Member", colClass: "col-member" },
  { key: "pathName", label: "Path", colClass: "col-path" },
  { key: "currentLevelSortValue", label: "Current Level", colClass: "col-level" },
  { key: "theoreticalMissing", label: "To Next Lvl (Basecamp)", colClass: "col-basecamp" },
  { key: "unreportedInBasecamp", label: "Unreported (Basecamp)", colClass: "col-unreported" },
  { key: "realMissing", label: "To Next Lvl (Real)", colClass: "col-real" },
];

interface ClubSection {
  clubKey: string;
  clubName: string | null;
  summaryRows: LevelSummaryRow[];
  clubPair: ClubPairReport;
}

let clubSections: ClubSection[] = [];
let activeClubKey: string | null = null;
let summaryRows: LevelSummaryRow[] = [];
let summarySort: { key: keyof LevelSummaryRow; direction: "asc" | "desc" } = { key: "realMissing", direction: "asc" };

function renderClubTabs(sections: ClubSection[]) {
  clubSections = sections;
  const tabsRoot = document.getElementById("clubTabs")!;

  if (sections.length === 0) {
    document.getElementById("conflictWarning")!.innerHTML = "";
    tabsRoot.innerHTML = "";
    document.getElementById("summaryTableRoot")!.innerHTML = "";
    document.getElementById("reportRoot")!.innerHTML = '<p class="empty-state">No clubs found in either data source.</p>';
    return;
  }

  activeClubKey = sections[0].clubKey;
  tabsRoot.innerHTML = sections
    .map((s) => {
      const unmatched = !s.clubPair.basecampClubId || !s.clubPair.easyspeakClubId;
      const warningIcon = unmatched ? warningIconHtml("No match found between Basecamp and EasySpeak for this club") : "";
      return `<button class="tab-btn" data-club-key="${s.clubKey}">${warningIcon}${escapeHtml(s.clubName ?? "(unnamed club)")}</button>`;
    })
    .join("");

  tabsRoot.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeClubKey = btn.dataset.clubKey ?? null;
      updateActiveTab();
      renderActiveClub();
    });
  });

  updateActiveTab();
  renderActiveClub();
}

function updateActiveTab() {
  document.querySelectorAll<HTMLButtonElement>("#clubTabs .tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.clubKey === activeClubKey);
  });
}

// Sort state (summarySort) is shared across tabs on purpose — switching
// clubs shouldn't reset how the VPE has the list sorted.
function renderActiveClub() {
  const section = clubSections.find((s) => s.clubKey === activeClubKey);
  renderSummaryTable(section ? section.summaryRows : []);
  document.getElementById("reportRoot")!.innerHTML = section ? renderClubDetail(section.clubPair) : "";
}

function renderSummaryTable(rows: LevelSummaryRow[]) {
  summaryRows = rows;
  const root = document.getElementById("summaryTableRoot")!;

  if (rows.length === 0) {
    root.innerHTML = '<p class="empty-state">No Pathways paths found.</p>';
    return;
  }

  const colgroupHtml = SUMMARY_COLUMNS.map((col) => `<col class="${col.colClass}">`).join("");
  const theadHtml = SUMMARY_COLUMNS.map((col) => `<th data-key="${col.key}">${escapeHtml(col.label)}</th>`).join("");
  root.innerHTML = `<table class="table summary"><colgroup>${colgroupHtml}</colgroup><thead><tr>${theadHtml}</tr></thead><tbody></tbody></table>`;

  root.querySelectorAll<HTMLTableCellElement>("th").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key as keyof LevelSummaryRow;
      summarySort = summarySort.key === key ? { key, direction: summarySort.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" };
      updateSummaryHeaders();
      renderSummaryBody();
    });
  });

  updateSummaryHeaders();
  renderSummaryBody();
}

function updateSummaryHeaders() {
  document.querySelectorAll<HTMLTableCellElement>("table.summary th").forEach((th) => {
    const col = SUMMARY_COLUMNS.find((c) => c.key === th.dataset.key)!;
    const isActive = th.dataset.key === summarySort.key;
    const arrow = isActive ? (summarySort.direction === "asc" ? " ▲" : " ▼") : "";
    th.innerHTML = `${escapeHtml(col.label)}${arrow ? `<span class="sort-indicator">${arrow}</span>` : ""}`;
  });
}

function renderSummaryBody() {
  const tbody = document.querySelector("table.summary tbody")!;
  const sorted = [...summaryRows].sort((a, b) => compareSummaryRows(a, b, summarySort.key, summarySort.direction));
  tbody.innerHTML = sorted.map(renderSummaryRow).join("");
}

// Nulls (e.g. "Not in Basecamp"/"Completed" rows with no speech counts to
// compare) always sort last, regardless of ascending/descending — they're
// "not applicable", not a real ranking value.
function compareSummaryRows(a: LevelSummaryRow, b: LevelSummaryRow, key: keyof LevelSummaryRow, direction: "asc" | "desc") {
  const av = a[key];
  const bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;

  const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
  return direction === "asc" ? cmp : -cmp;
}

function renderSummaryRow(row: LevelSummaryRow) {
  const muted = row.currentLevelLabel === "Completed" || row.currentLevelLabel === "Not in Basecamp";
  return `
    <tr class="${muted ? "muted-row" : ""}">
      <td>${escapeHtml(row.memberName)}</td>
      <td>${escapeHtml(row.pathName)} <span class="badge badge-${row.pathPresence}">${presenceLabel(row.pathPresence)}</span></td>
      <td>${escapeHtml(row.currentLevelLabel)}</td>
      <td class="numeric">${row.theoreticalMissing ?? "—"}</td>
      <td class="numeric">${row.unreportedInBasecamp ?? "—"}</td>
      <td class="numeric">${row.realMissing ?? "—"}</td>
    </tr>
  `;
}

function downloadCsv(report: ReportResult) {
  const csv = toCsv(reportToRows(report));
  // Leading BOM so Excel detects UTF-8 (member/path names carry accents).
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `toastmasters-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function renderClubDetail(clubPair: ClubPairReport) {
  const { basecampClubName, easyspeakClubName, matchScore, clubMatchForced, members } = clubPair;

  let matchNote: string;
  if (basecampClubName && easyspeakClubName) {
    const scoreText = clubMatchForced ? "pinned in Setup" : `match ${Math.round((matchScore ?? 0) * 100)}%`;
    matchNote = `${escapeHtml(basecampClubName)} / ${escapeHtml(easyspeakClubName)} — ${scoreText}`;
  } else if (basecampClubName) {
    matchNote = `${escapeHtml(basecampClubName)} (no EasySpeak counterpart found)`;
  } else {
    matchNote = `${escapeHtml(easyspeakClubName ?? "")} (no Basecamp counterpart found)`;
  }

  const both = members.filter((m) => m.presence === "both").length;
  const fuzzy = members.filter((m) => m.matchConfidence === "fuzzy").length;
  const bcOnly = members.filter((m) => m.presence === "basecamp-only").length;
  const esOnly = members.filter((m) => m.presence === "easyspeak-only").length;

  // members[] comes out in match-assignment order (matched pairs first,
  // then leftovers) — sort alphabetically for a predictable, scannable list.
  const sortedMembers = [...members].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return `
    <div class="club-summary">
      ${matchNote} · ${members.length} member(s) — ${both} in both (${fuzzy} fuzzy match${fuzzy === 1 ? "" : "es"}),
      ${bcOnly} Basecamp-only, ${esOnly} EasySpeak-only
    </div>
    ${sortedMembers.map(renderMember).join("")}
  `;
}

function renderMember(member: MemberReport) {
  const presenceBadge = `<span class="badge badge-${member.presence}">${presenceLabel(member.presence)}</span>`;
  const scoreTitle = member.matchScore != null ? ` title="match score: ${member.matchScore.toFixed(2)}"` : "";
  const confidenceBadge = member.matchConfidence ? `<span class="badge badge-${member.matchConfidence}"${scoreTitle}>${member.matchConfidence}</span>` : "";

  const noActivePathNote = member.easyspeakNoActivePath ? '<div class="no-active-path">No active EasySpeak path.</div>' : "";

  const pathsHtml = member.paths.map(renderPath).join("");

  return `
    <details class="member">
      <summary>
        <span class="member-name">${escapeHtml(member.name)}</span>
        ${presenceBadge}
        ${confidenceBadge}
      </summary>
      ${noActivePathNote}
      ${pathsHtml || '<div class="non-pathway-note">No paths found.</div>'}
    </details>
  `;
}

function presenceLabel(presence: string): string {
  if (presence === "both") return "In both";
  if (presence === "basecamp-only") return "Basecamp only";
  return "EasySpeak only";
}

function renderPath(path: PathReport) {
  const presenceNote = path.presence === "both" ? "" : ` (${presenceLabel(path.presence)})`;

  if (path.nonPathway) {
    return `
      <div class="path-block">
        <div class="path-title">${escapeHtml(path.displayName)}<span class="path-presence">${presenceNote}</span></div>
        <div class="non-pathway-note">Non-Pathways activity, not compared.</div>
      </div>
    `;
  }

  return `
    <div class="path-block">
      <div class="path-title">${escapeHtml(path.displayName)}<span class="path-presence">${presenceNote}</span></div>
      <table class="table levels">
        <tr>
          <th>Level</th>
          <th>EasySpeak (done/needed)</th>
          <th>Basecamp (completed/total)</th>
          <th>Approved</th>
          <th>Missing (ES)</th>
          <th>Missing (BC)</th>
          <th>Discrepancy</th>
          <th>Pending validation</th>
        </tr>
        ${path.levels.map(renderLevelRow).join("")}
        ${renderPathCompletionRow(path.pathCompletion)}
      </table>
    </div>
  `;
}

function renderLevelRow(level: PathReport["levels"][number]) {
  const rowClass = level.pendingValidation ? "pending" : level.discrepancy ? "discrepancy" : "";
  // Basecamp's Level 5 total is cumulated with its separate "Path
  // Completion" entry before comparison (see diffLevels() in
  // shared/sync/conflicts.ts) since EasySpeak counts both as one Level 5
  // bucket — flagged here so the inflated total doesn't look like a bug.
  const levelLabel =
    level.level === 5
      ? `5<span class="level-note" title="Basecamp total includes Path Completion, to match how EasySpeak counts Level 5">*</span>`
      : String(level.level);
  return `
    <tr class="${rowClass}">
      <td>${levelLabel}</td>
      <td>${level.easyspeak ? `${level.easyspeak.done}/${level.easyspeak.needed}` : "—"}</td>
      <td>${level.basecamp ? `${level.basecamp.completed}/${level.basecamp.total}` : "—"}</td>
      <td>${level.basecamp ? (level.basecamp.approved ? "Yes" : "No") : "—"}</td>
      <td>${level.easyspeakMissing ?? "—"}</td>
      <td>${level.basecampMissing ?? "—"}</td>
      <td>${level.discrepancy ?? "—"}</td>
      <td>${level.pendingValidation ? "Yes" : "No"}</td>
    </tr>
  `;
}

function renderPathCompletionRow(pathCompletion: PathReport["pathCompletion"]) {
  if (!pathCompletion) return "";
  return `
    <tr class="completion-row">
      <td>Path Completion<span class="level-note" title="Already included in the Level 5 total above">*</span></td>
      <td>—</td>
      <td>${pathCompletion.completed}/${pathCompletion.total}</td>
      <td>—</td>
      <td>—</td>
      <td>${pathCompletion.missing}</td>
      <td>—</td>
      <td>—</td>
    </tr>
  `;
}

function formatDate(timestamp: number | undefined): string {
  return timestamp ? new Date(timestamp).toLocaleString("en-US") : "never";
}
