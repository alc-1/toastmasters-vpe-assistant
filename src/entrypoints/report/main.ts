// src/entrypoints/report/main.ts
//
// DOM glue for the comparison report page: reads the already-scraped data
// straight out of browser.storage.local (no live scraping happens here) and
// hands it to buildReport() from shared/sync/delta.ts, then renders the
// result. Kept separate from shared/sync/* so the pure matching/diff logic
// stays browser.*-free and independently testable.

import { approvedCheckIconHtml, escapeAttr, escapeHtml, warningIconHtml } from "../../shared/dom-utils";
import { local } from "../../shared/storage";
import { loadResolutionData } from "../../shared/resolution-store";
import { buildLevelSummary, buildReport, compareLevelSummaryRows, isMemberReadyForNextLevel, memberKey, needsAction } from "../../shared/sync/delta";
import { renderAppShell, renderStepFooter } from "../../shared/app-shell";
import { computeStepperInfo, markStepVisited } from "../../shared/stepper-info";
import type { ClubPairReport, LevelDiff, LevelSummaryRow, LevelUpStatus, MemberReport, PathReport } from "../../shared/types";

refresh();

// Keeps this tab in sync if data is re-extracted or resolution decisions are
// edited from another tab (e.g. Members, Club Review) while this one stays open.
browser.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") refresh();
});

// Wired up once here, not inside refresh() (which can re-run on every
// storage change) — #summarySearch is a static element, so attaching this
// listener inside a re-run function would stack up duplicate listeners.
document.getElementById("summarySearch")!.addEventListener("input", (e) => {
  activeSearchQuery = (e.target as HTMLInputElement).value.trim().toLowerCase();
  renderActiveClub();
});

async function refresh() {
  await markStepVisited("report");
  const stepperInfo = await computeStepperInfo();
  document.getElementById("appShell")!.innerHTML = renderAppShell({ active: "report", info: stepperInfo });
  document.getElementById("stepFooter")!.innerHTML = renderStepFooter("report", stepperInfo);

  const cached = await local.get(["basecampData", "basecampScrapedAt", "easyspeakData", "easyspeakScrapedAt"]);

  if (!cached.basecampData || !cached.easyspeakData) {
    document.getElementById("conflictWarning")!.innerHTML = "";
    document.getElementById("kpiRoot")!.innerHTML = "";
    document.getElementById("clubTabs")!.innerHTML = "";
    document.getElementById("summaryTableRoot")!.innerHTML =
      '<p class="empty-state">Both Basecamp and EasySpeak data are needed to build this report. ' +
      "Click the extension's toolbar icon and run both extractions first.</p>";
    return;
  }

  document.getElementById("reportMeta")!.textContent = formatReportMeta(cached.basecampScrapedAt, cached.easyspeakScrapedAt);

  // Loading persisted resolution decisions here (not just in members.ts) is
  // required, not optional — otherwise this page's Level Summary would
  // silently diverge from what the Member Review view shows.
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

  // Zipped by index: buildLevelSummary(report) produces one group per
  // report.clubPairs entry, in the same order, so a tab can drive both the
  // summary table and the per-club stats line for the same club together.
  const summaryGroups = buildLevelSummary(report);
  const clubSections = report.clubPairs.map((clubPair, index) => ({
    clubKey: summaryGroups[index].clubKey,
    clubName: summaryGroups[index].clubName,
    rows: summaryGroups[index].rows,
    clubPair,
  }));

  renderClubTabs(clubSections);
}

// ---------------------------------------------------------------------------
// Conflict warning banner: contextualized to whichever club tab is active —
// flags that club's pair having no counterpart at all in the other system,
// and/or members left unmatched within it (an unconfirmed fuzzy guess
// counts as unmatched here too, since this page excludes those — see the
// allowFuzzyMemberMatches: false call above).
// ---------------------------------------------------------------------------

function renderConflictWarning(clubPair: ClubPairReport | null) {
  const root = document.getElementById("conflictWarning")!;
  if (!clubPair) {
    root.innerHTML = "";
    return;
  }

  const unmatchedClub = !clubPair.basecampClubId || !clubPair.easyspeakClubId;
  // An orphan-resolved member (matchConfidence "confirmed" with no real
  // counterpart) has already been reviewed and dismissed, so it's excluded
  // here the same way a "both"-presence member is.
  const unmatchedMemberCount = clubPair.members.filter((m) => m.presence !== "both" && m.matchConfidence !== "confirmed").length;

  if (!unmatchedClub && unmatchedMemberCount === 0) {
    root.innerHTML = "";
    return;
  }

  const messages: string[] = [];
  if (unmatchedClub) {
    const missingSide = clubPair.basecampClubId ? "EasySpeak" : "Basecamp";
    messages.push(`This club has no counterpart in ${missingSide}. <a href="club-review.html">Fix in Club Review</a>`);
  }
  if (unmatchedMemberCount > 0) {
    messages.push(
      `${unmatchedMemberCount} member${unmatchedMemberCount === 1 ? "" : "s"} without a match between Basecamp and EasySpeak. ` +
        '<a href="members.html">Fix in Member Review</a>'
    );
  }

  root.innerHTML = `
    <div class="conflict-warning">
      ${warningIconHtml("Conflicts found")}
      ${messages.join(" · ")}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// KPI row: contextualized to whichever club tab is active, shown just above
// "Next Level Summary" — a VPE reviewing one club shouldn't see another
// club's numbers competing for attention.
// ---------------------------------------------------------------------------

interface ReportKpis {
  members: number;
  paths: number;
  readyToLevelUp: number;
}

function computeKpis(clubPair: ClubPairReport): ReportKpis {
  let paths = 0;
  let readyToLevelUp = 0;

  for (const member of clubPair.members) {
    paths += member.paths.filter((p) => !p.nonPathway).length;
    // A pending-review member's numbers aren't a reconciled diff yet (see
    // LevelSummaryRow.pendingReview) — don't count them as "ready".
    if (!needsAction(member) && isMemberReadyForNextLevel(member)) readyToLevelUp += 1;
  }

  return { members: clubPair.members.length, paths, readyToLevelUp };
}

function renderKpiRow(clubPair: ClubPairReport | null) {
  const root = document.getElementById("kpiRoot")!;
  if (!clubPair) {
    root.innerHTML = "";
    return;
  }

  const kpis = computeKpis(clubPair);

  const cards: { label: string; value: number }[] = [
    { label: "Members", value: kpis.members },
    { label: "Paths", value: kpis.paths },
    { label: "Ready to Level Up", value: kpis.readyToLevelUp },
  ];

  root.innerHTML = cards
    .map(
      (c) => `
        <div class="kpi-card">
          <div class="kpi-card__value">${c.value}</div>
          <div class="kpi-card__label">${escapeHtml(c.label)}</div>
        </div>
      `
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Club tabs: each tab drives the per-club stats line and the "Next Level
// Summary" table for the same club together.
// ---------------------------------------------------------------------------

interface SummaryColumn {
  key: keyof LevelSummaryRow;
  label: string;
  colClass: string;
}

const SUMMARY_COLUMNS: SummaryColumn[] = [
  { key: "memberName", label: "Member", colClass: "col-member" },
  { key: "pathName", label: "Path", colClass: "col-path" },
  { key: "currentLevelSortValue", label: "Level", colClass: "col-level" },
  { key: "statusSortRank", label: "Status", colClass: "col-status" },
  { key: "statusDetail", label: "Detail", colClass: "col-detail" },
];

// Small inline SVGs (stroke="currentColor" so each tints to match its badge's
// own text color for free, no extra CSS) — same convention as
// shared/dom-utils.ts's warningIconHtml()/documentIconHtml(), just sized for
// a small badge pill and only ever used on this page, so kept local rather
// than added to that shared file.
const ICON_CHECKMARK = `<svg class="status-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_LIGHTNING = `<svg class="status-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

interface StatusBadgeInfo {
  label: string;
  tone: string;
  icon: string;
  description: string;
}

const STATUS_BADGE: Record<LevelUpStatus, StatusBadgeInfo> = {
  ready: { label: "Ready", tone: "badge-success", icon: ICON_CHECKMARK, description: "All requirements reported, the level can be taken now." },
  "ready-if-reported": {
    label: "Ready if reported",
    tone: "badge-pending",
    icon: ICON_LIGHTNING,
    description: "Done in EasySpeak, just needs reporting in Basecamp to be ready.",
  },
  "in-progress": { label: "On track", tone: "badge-info", icon: "", description: "Still working through the level's speeches." },
  "needs-reporting": {
    label: "Needs reporting",
    tone: "badge-pending",
    icon: "",
    description: "Some speeches done in EasySpeak aren't yet reported in Basecamp.",
  },
  completed: { label: "Completed", tone: "badge-success", icon: "", description: "Path completed." },
  "not-tracked": { label: "Not tracked", tone: "badge-muted", icon: "", description: "Only in EasySpeak, not yet in Basecamp." },
};

interface ClubSection {
  clubKey: string;
  clubName: string | null;
  // All member+path rows for this club, both confirmed and pending-review —
  // split by .pendingReview at render time (see renderActiveClub()).
  rows: LevelSummaryRow[];
  clubPair: ClubPairReport;
}

// Drives one rendered table (sort state, expanded-row state, which DOM root
// it lives in). Two instances below — "Next Level Summary" and "Pending
// review" — share every render/sort/expand function, scoped by rootId so
// the two tables on this page never cross-query each other's DOM.
interface SummaryTableState {
  rootId: string;
  emptyMessage: string;
  rows: LevelSummaryRow[];
  sort: { key: keyof LevelSummaryRow; direction: "asc" | "desc" };
  // Composite `${memberKey}::${pathKey}` key of this table's currently-
  // expanded row, if any — at most one at a time (see the click handler in
  // renderSummaryTable() below) — cleared whenever the active club changes
  // so switching tabs always starts collapsed (see renderClubTabs()'s
  // tab-button click handler below). The detail <tr> is only ever rendered
  // into the DOM for this one row, not toggled via a "collapsed" class on an
  // always-present sibling — that keeps every other row's position in the
  // tbody stable, which .table tbody tr:nth-child(2n) (shared/styles.css)
  // relies on for zebra striping.
  expandedRowKey: string | null;
}

const mainTable: SummaryTableState = {
  rootId: "summaryTableRoot",
  emptyMessage: "No Pathways paths found.",
  rows: [],
  sort: { key: "statusSortRank", direction: "asc" },
  expandedRowKey: null,
};
const pendingTable: SummaryTableState = {
  rootId: "pendingReviewTableRoot",
  emptyMessage: "No members pending review.",
  rows: [],
  sort: { key: "statusSortRank", direction: "asc" },
  expandedRowKey: null,
};

let clubSections: ClubSection[] = [];
let activeClubKey: string | null = null;
let activeSearchQuery = "";

// The active club's members, keyed by memberKey() — lets a Next Level
// Summary row's expanded detail look up its member/path without threading
// the whole MemberReport/PathReport through every sorted row.
let activeMembers: Map<string, MemberReport> = new Map();

function renderClubTabs(sections: ClubSection[]) {
  clubSections = sections;
  mainTable.expandedRowKey = null;
  pendingTable.expandedRowKey = null;
  const tabsRoot = document.getElementById("clubTabs")!;

  if (sections.length === 0) {
    document.getElementById("conflictWarning")!.innerHTML = "";
    document.getElementById("kpiRoot")!.innerHTML = "";
    tabsRoot.innerHTML = "";
    document.getElementById("summaryTableRoot")!.innerHTML = '<p class="empty-state">No clubs found in either data source.</p>';
    document.getElementById("pendingReviewTableRoot")!.innerHTML = "";
    return;
  }

  activeClubKey = sections[0].clubKey;
  tabsRoot.innerHTML = sections
    .map((s) => {
      const unmatched = !s.clubPair.basecampClubId || !s.clubPair.easyspeakClubId;
      const warningIcon = unmatched ? warningIconHtml("No match found between Basecamp and EasySpeak for this club") : "";
      // Only badge a club that actually needs attention — a fully-resolved
      // club showing a "0" badge would just be visual noise.
      const missingCount = s.clubPair.members.filter(needsAction).length;
      const countBadge = missingCount > 0 ? `<span class="tab-count">${missingCount}</span>` : "";
      return `<button class="tab-btn" data-club-key="${s.clubKey}">${warningIcon}${escapeHtml(s.clubName ?? "(unnamed club)")}${countBadge}</button>`;
    })
    .join("");

  tabsRoot.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeClubKey = btn.dataset.clubKey ?? null;
      mainTable.expandedRowKey = null;
      pendingTable.expandedRowKey = null;
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

// Sort state is shared across tabs on purpose (per table) — switching clubs
// shouldn't reset how the VPE has either list sorted.
function renderActiveClub() {
  const section = clubSections.find((s) => s.clubKey === activeClubKey);
  const clubPair = section ? section.clubPair : null;
  activeMembers = new Map((clubPair?.members ?? []).map((m) => [memberKey(m), m]));
  renderConflictWarning(clubPair);
  renderKpiRow(clubPair);
  const rows = (section ? section.rows : []).filter((r) => matchesSearch(r, activeSearchQuery));
  renderSummaryTable(mainTable, rows.filter((r) => !r.pendingReview));
  renderSummaryTable(pendingTable, rows.filter((r) => r.pendingReview));
}

// Matches a row's member or path name — the search box is meant to find "a
// member or a path", and LevelSummaryRow already denormalizes both names
// directly onto the row, so no need to cross-reference MemberReport/PathReport.
function matchesSearch(row: LevelSummaryRow, query: string): boolean {
  if (!query) return true;
  return row.memberName.toLowerCase().includes(query) || row.pathName.toLowerCase().includes(query);
}

// ---------------------------------------------------------------------------
// Next Level Summary: one row per member+path, each clickable to reveal an
// inline detail row (member badges + the level-by-level diff table) beneath
// it — at most one row is expanded at a time; opening another one collapses
// whichever was previously open, so the page never scrolls into a wall of
// stacked detail tables.
// ---------------------------------------------------------------------------

function renderSummaryTable(state: SummaryTableState, rows: LevelSummaryRow[]) {
  state.rows = rows;
  const root = document.getElementById(state.rootId)!;

  if (rows.length === 0) {
    root.innerHTML = `<p class="empty-state">${escapeHtml(state.emptyMessage)}</p>`;
    return;
  }

  const colgroupHtml = SUMMARY_COLUMNS.map((col) => `<col class="${col.colClass}">`).join("");
  const theadHtml = SUMMARY_COLUMNS.map((col) => `<th data-key="${col.key}">${escapeHtml(col.label)}</th>`).join("");
  root.innerHTML = `<table class="table summary"><colgroup>${colgroupHtml}</colgroup><thead><tr>${theadHtml}</tr></thead><tbody></tbody></table>`;

  root.querySelectorAll<HTMLTableCellElement>("th").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key as keyof LevelSummaryRow;
      state.sort = state.sort.key === key ? { key, direction: state.sort.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" };
      updateSummaryHeaders(state);
      renderSummaryBody(state);
    });
  });

  // Delegated once on the (freshly-created) tbody rather than per-row, so a
  // full renderSummaryBody() re-render (sort, re-render after toggling)
  // never needs to re-attach anything.
  root.querySelector("tbody")!.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("tr[data-row-key]");
    if (!row) return;
    const key = row.dataset.rowKey!;
    state.expandedRowKey = state.expandedRowKey === key ? null : key;
    renderSummaryBody(state);
  });

  updateSummaryHeaders(state);
  renderSummaryBody(state);
}

function updateSummaryHeaders(state: SummaryTableState) {
  const root = document.getElementById(state.rootId)!;
  root.querySelectorAll<HTMLTableCellElement>("table.summary th").forEach((th) => {
    const col = SUMMARY_COLUMNS.find((c) => c.key === th.dataset.key)!;
    const isActive = th.dataset.key === state.sort.key;
    const arrow = isActive ? (state.sort.direction === "asc" ? " ▲" : " ▼") : "";
    th.innerHTML = `${escapeHtml(col.label)}${arrow ? `<span class="sort-indicator">${arrow}</span>` : ""}`;
  });
}

function renderSummaryBody(state: SummaryTableState) {
  const root = document.getElementById(state.rootId)!;
  const tbody = root.querySelector("table.summary tbody")!;
  const sorted = [...state.rows].sort((a, b) => compareLevelSummaryRows(a, b, state.sort.key, state.sort.direction));
  tbody.innerHTML = sorted
    .map((row) => {
      const key = rowKey(row);
      // The detail <tr> is only emitted for the expanded row — every other
      // row has no sibling <tr> at all, so .table tbody tr:nth-child(2n)'s
      // plain odd/even striping (shared/styles.css) lines up with the
      // visible rows instead of counting hidden detail rows too.
      const isExpanded = key === state.expandedRowKey;
      return isExpanded ? renderSummaryRow(row, key, isExpanded) + renderDetailRow(row) : renderSummaryRow(row, key, isExpanded);
    })
    .join("");
}

function rowKey(row: LevelSummaryRow): string {
  return `${row.memberKey}::${row.pathKey}`;
}


function renderSummaryRow(row: LevelSummaryRow, key: string, isExpanded: boolean) {
  const muted = row.status === "completed" || row.status === "not-tracked";
  // "ready"/"ready-if-reported" both mean the level's requirements are
  // already satisfied in EasySpeak — the level can be taken (or the report
  // filed) anytime, so flag it in bold.
  const ready = row.status === "ready" || row.status === "ready-if-reported";
  const rowClass = [muted && "muted-row", ready && "ready-row"].filter(Boolean).join(" ");
  // Only the exceptions (Basecamp-only / EasySpeak-only) are actionable —
  // a "both"-presence path renders no badge at all.
  const pathBadge = row.pathPresence === "both" ? "" : ` <span class="badge badge-${row.pathPresence}">${presenceLabel(row.pathPresence)}</span>`;
  // A vector chevron that rotates in place on expand/collapse, rather than
  // swapping between two glyphs — see warningIconHtml() in dom-utils.ts for
  // why this codebase prefers inline SVG over relying on a system emoji/
  // glyph font at small sizes.
  const chevron = `
    <span class="row-chevron${isExpanded ? " expanded" : ""}">
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
    </span>
  `;
  const statusInfo = STATUS_BADGE[row.status];
  return `
    <tr class="${rowClass}" data-row-key="${escapeAttr(key)}">
      <td>${chevron}${escapeHtml(row.memberName)}</td>
      <td>${escapeHtml(row.pathName)}${pathBadge}</td>
      <td>${escapeHtml(row.currentLevelLabel)}</td>
      <td><span class="badge ${statusInfo.tone}" title="${escapeAttr(statusInfo.description)}">${statusInfo.icon}${escapeHtml(statusInfo.label)}</span></td>
      <td>${renderStatusDetail(row.statusDetail)}</td>
    </tr>
  `;
}

// statusDetail's "→ N if reported" clause (see computeLevelSummary() in
// shared/sync/delta.ts) is a projection, not a fact yet — italicized to
// flag that distinction at a glance.
function renderStatusDetail(detail: string): string {
  const arrowIndex = detail.indexOf(" → ");
  if (arrowIndex === -1) return escapeHtml(detail);
  return `${escapeHtml(detail.slice(0, arrowIndex))} → <em>${escapeHtml(detail.slice(arrowIndex + 3))}</em>`;
}

function renderDetailRow(row: LevelSummaryRow): string {
  return `
    <tr class="detail-row">
      <td colspan="${SUMMARY_COLUMNS.length}">${renderRowDetail(row)}</td>
    </tr>
  `;
}

function renderRowDetail(row: LevelSummaryRow): string {
  const member = activeMembers.get(row.memberKey);
  if (!member) return "";
  const path = member.paths.find((p) => p.canonicalKey === row.pathKey);
  if (!path) return "";

  // Presence (Basecamp-only / EasySpeak-only) is already flagged on the
  // summary row itself (see pathBadge in renderSummaryRow) — no need to
  // repeat it as a badge here too.
  const noActivePathNote = member.easyspeakNoActivePath ? '<div class="no-active-path">No active EasySpeak path.</div>' : "";
  const pathsHtml = renderMemberPathsList(member, path.canonicalKey);

  if (path.nonPathway) {
    return `${pathsHtml}${noActivePathNote}<div class="non-pathway-note">Non-Pathways activity, not compared.</div>`;
  }

  return `
    ${pathsHtml}
    ${noActivePathNote}
    ${renderLevelsTable(path)}
  `;
}

// Lists every path this member has, so the level table below is read in the
// context of everything they're working on — not just the row that was
// clicked. The path this detail is currently showing is highlighted.
function renderMemberPathsList(member: MemberReport, activePathKey: string): string {
  if (member.paths.length === 0) return "";
  const items = member.paths
    .map((p) => {
      const label = escapeHtml(p.displayName);
      return p.canonicalKey === activePathKey ? `<strong>${label}</strong>` : label;
    })
    .join(", ");
  return `<div class="detail-paths"><span class="detail-paths-label">Paths:</span> ${items}</div>`;
}

function presenceLabel(presence: string): string {
  if (presence === "both") return "In both";
  if (presence === "basecamp-only") return "Basecamp only";
  return "EasySpeak only";
}

// Every path always has exactly 5 LevelDiff entries (see diffLevels() in
// shared/sync/conflicts.ts), so this fallback only guards against that
// invariant ever drifting rather than being expected to fire in practice.
const NULL_LEVEL_DIFF = (level: number): LevelDiff => ({
  level,
  easyspeak: null,
  basecamp: null,
  easyspeakMissing: null,
  basecampMissing: null,
  discrepancy: null,
  pendingValidation: false,
});

function getLevel(path: PathReport, levelNumber: number): LevelDiff {
  return path.levels.find((l) => l.level === levelNumber) ?? NULL_LEVEL_DIFF(levelNumber);
}

// EasySpeak's Level 5 total already folds in path-completion speeches (it
// has no separate bucket for them), so its merged Level 5 + Path Completion
// cell is cumulated to match how Basecamp splits the two apart — explained
// via a title tooltip on that cell rather than a visible marker.
const LEVEL5_NOTE_TITLE = "Easyspeak Level 5 counts toward both Basecamp Level 5 and Path Completion.";
const APPROVED_CHECK = approvedCheckIconHtml("Approved");

function renderLevelsTable(path: PathReport): string {
  const levels = [1, 2, 3, 4, 5].map((n) => getLevel(path, n));
  return `
    <table class="table levels">
      <thead>
        <tr>
          <th>Source</th>
          <th>Level 1</th><th>Level 2</th><th>Level 3</th><th>Level 4</th>
          <th>Level 5</th>
          <th>Path Completion</th>
        </tr>
      </thead>
      <tbody>
        ${renderBasecampRow(levels, path.pathCompletion)}
        ${renderEasyspeakRow(levels)}
      </tbody>
      <tfoot>
        ${renderDiscrepancyFooterRow(levels)}
      </tfoot>
    </table>
  `;
}

function cellAttr(level: LevelDiff, extraClass?: string): string {
  const classes = [level.pendingValidation ? "pending-cell" : "", extraClass ?? ""].filter(Boolean);
  return classes.length ? ` class="${classes.join(" ")}"` : "";
}

function renderBasecampRow(levels: LevelDiff[], pathCompletion: PathReport["pathCompletion"]): string {
  return `<tr><td>Basecamp</td>${levels.map(basecampCell).join("")}${basecampPathCompletionCell(pathCompletion)}</tr>`;
}

function basecampCell(level: LevelDiff): string {
  const approved = !!level.basecamp?.approved;
  const content = !level.basecamp ? "—" : approved ? APPROVED_CHECK : `${level.basecamp.completed} of ${level.basecamp.total}`;
  return `<td${cellAttr(level, approved ? "check-cell" : undefined)}>${content}</td>`;
}

function basecampPathCompletionCell(pathCompletion: PathReport["pathCompletion"]): string {
  // Never a checkmark: Basecamp's raw Path Completion entry has no `approved`
  // field — completed >= total isn't the same claim as "approved".
  return `<td>${pathCompletion ? `${pathCompletion.completed} of ${pathCompletion.total}` : "—"}</td>`;
}

function renderEasyspeakRow(levels: LevelDiff[]): string {
  const [l1, l2, l3, l4, l5] = levels;
  return `<tr><td>EasySpeak</td>${[l1, l2, l3, l4].map((l) => easyspeakCell(l)).join("")}${easyspeakCell(l5, 2, LEVEL5_NOTE_TITLE)}</tr>`;
}

function easyspeakCell(level: LevelDiff, colspan?: number, title?: string): string {
  const span = colspan ? ` colspan="${colspan}"` : "";
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
  const content = !level.easyspeak ? "—" : level.basecamp?.approved === true ? "" : `${level.easyspeak.done} speeches done`;
  return `<td${cellAttr(level)}${span}${titleAttr}>${content}</td>`;
}

function renderDiscrepancyFooterRow(levels: LevelDiff[]): string {
  const [l1, l2, l3, l4, l5] = levels;
  return `<tr><td>Reporting gap</td>${[l1, l2, l3, l4].map((l) => discrepancyCell(l)).join("")}${discrepancyCell(l5, 2)}</tr>`;
}

function discrepancyCell(level: LevelDiff, colspan?: number): string {
  const span = colspan ? ` colspan="${colspan}"` : "";
  if (!level.basecamp || !level.easyspeak || level.basecamp.approved) return `<td${span}>—</td>`;
  const content = level.discrepancy && level.discrepancy > 0 ? `${level.discrepancy} to report` : "—";
  return `<td${span}>${content}</td>`;
}

// Date-only (no time-of-day) — the exact second either extraction ran isn't
// meaningful to a VPE, just which day the report's data came from.
function formatReportMeta(basecampScrapedAt: number | undefined, easyspeakScrapedAt: number | undefined): string {
  if (!basecampScrapedAt || !easyspeakScrapedAt) return "Report generated with incomplete data — both sources need to be extracted first.";

  const basecampDate = new Date(basecampScrapedAt).toLocaleDateString("en-US");
  const easyspeakDate = new Date(easyspeakScrapedAt).toLocaleDateString("en-US");

  return basecampDate === easyspeakDate
    ? `Report generated with data extracted from Basecamp & EasySpeak the ${basecampDate}`
    : `Report generated with data extracted from Basecamp the ${basecampDate} & EasySpeak the ${easyspeakDate}`;
}
