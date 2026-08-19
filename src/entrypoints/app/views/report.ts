// src/entrypoints/app/views/report.ts
//
// The Club Progress view: reads the already-scraped data straight out of
// browser.storage.local (no live scraping happens here) and hands it to
// buildReport() from shared/sync/delta.ts, then renders the result. Kept
// separate from shared/sync/* so the pure matching/diff logic stays
// browser.*-free and independently testable.

import { approvedCheckIconHtml, escapeAttr, escapeHtml, shortenClubName, warningIconHtml } from "../../../shared/dom-utils";
import { local } from "../../../shared/storage";
import { loadResolutionData } from "../../../shared/resolution-store";
import { getAnonymizeMode } from "../../../shared/settings-store";
import { buildAnonymizationMaps, anonymizeReport } from "../../../shared/anonymize";
import { buildLevelSummary, buildReport, compareLevelSummaryRows, isMemberReadyForNextLevel, memberKey, needsAction } from "../../../shared/sync/delta";
import type { ClubPairReport, LevelDiff, LevelSummaryRow, LevelUpStatus, MemberReport, PathReport } from "../../../shared/types";
import type { ViewModule } from "../../../shared/view";

const SHELL_HTML = `
  <h1 class="page-title">Club Progress</h1>
  <div class="meta" id="reportMeta"></div>
  <div class="anonymize-indicator" id="anonymizeIndicator"></div>

  <div id="clubTabs" class="tabs"></div>
  <div id="conflictWarning" aria-live="polite"></div>
  <div id="kpiRoot" class="kpi-grid"></div>
  <input type="text" id="summarySearch" class="search-input" placeholder="Search by member or path name…">

  <h2 class="section-header section-header--first">Next Level Summary</h2>
  <p class="help-text summary-help-text--wide">
    One row is displayed per member per path. Click a column header to sort (click again to reverse).
    Click a row to reveal its level-by-level detail.
  </p>
  <p class="help-text summary-help-text--narrow">
    One card is displayed per member per path. Click a card to reveal its level-by-level detail.
  </p>
  <div id="summaryTableRoot" class="table-scroll"></div>

  <h2 class="section-header">Pending review</h2>
  <p class="help-text">
    Members whose Basecamp/EasySpeak match still needs a decision in
    <a href="#members">Member Review</a> — numbers here may be incomplete
    until that's resolved, so they're kept separate from Next Level Summary.
  </p>
  <div id="pendingReviewTableRoot" class="table-scroll"></div>
`;

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
  rows: LevelSummaryRow[];
  clubPair: ClubPairReport;
}

interface SummaryTableState {
  rootId: string;
  emptyMessage: string;
  rows: LevelSummaryRow[];
  sort: { key: keyof LevelSummaryRow; direction: "asc" | "desc" };
  expandedRowKey: string | null;
}

const NULL_LEVEL_DIFF = (level: number): LevelDiff => ({
  level,
  easyspeak: null,
  basecamp: null,
  easyspeakMissing: null,
  basecampMissing: null,
  discrepancy: null,
  pendingValidation: false,
});

const LEVEL5_NOTE_TITLE = "Easyspeak Level 5 counts toward both Basecamp Level 5 and Path Completion.";
const APPROVED_CHECK = approvedCheckIconHtml("Approved");

export const reportView: ViewModule = {
  async mount(root) {
    root.innerHTML = SHELL_HTML;

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
    let activeMembers: Map<string, MemberReport> = new Map();

    // Set true by the disposer — see syncData.ts's mount() for the full
    // writeup of why an in-flight async refresh needs this guard.
    let disposed = false;

    function getRoot(id: string): HTMLElement {
      return root.querySelector(`#${id}`) as HTMLElement;
    }

    async function refresh() {
      const cached = await local.get(["basecampData", "basecampScrapedAt", "easyspeakData", "easyspeakScrapedAt"]);
      if (disposed) return;

      if (!cached.basecampData || !cached.easyspeakData) {
        getRoot("anonymizeIndicator").textContent = "";
        getRoot("conflictWarning").innerHTML = "";
        getRoot("kpiRoot").innerHTML = "";
        getRoot("clubTabs").innerHTML = "";
        getRoot("summaryTableRoot").innerHTML =
          '<p class="empty-state">Both Basecamp and EasySpeak data are needed to build this report. ' +
          "Click the extension's toolbar icon and run both extractions first.</p>";
        return;
      }

      getRoot("reportMeta").textContent = formatReportMeta(cached.basecampScrapedAt, cached.easyspeakScrapedAt);

      const resolution = await loadResolutionData();
      if (disposed) return;
      let report = buildReport(
        cached.basecampData,
        cached.easyspeakData,
        { basecampScrapedAt: cached.basecampScrapedAt, easyspeakScrapedAt: cached.easyspeakScrapedAt },
        { ...resolution, allowFuzzyMemberMatches: false }
      );

      const anonymize = await getAnonymizeMode();
      if (disposed) return;
      if (anonymize) report = anonymizeReport(report, buildAnonymizationMaps(report));
      getRoot("anonymizeIndicator").innerHTML = anonymize
        ? '<span class="badge badge-pending" title="Turn off in Global Settings to see real names">Anonymized</span>'
        : "";

      const summaryGroups = buildLevelSummary(report);
      const sections = report.clubPairs.map((clubPair, index) => ({
        clubKey: summaryGroups[index].clubKey,
        clubName: summaryGroups[index].clubName,
        rows: summaryGroups[index].rows,
        clubPair,
      }));

      renderClubTabs(sections);
    }

    function renderConflictWarning(clubPair: ClubPairReport | null) {
      const warningRoot = getRoot("conflictWarning");
      if (!clubPair) {
        warningRoot.innerHTML = "";
        return;
      }

      const unmatchedClub = !clubPair.basecampClubId || !clubPair.easyspeakClubId;
      const unmatchedMemberCount = clubPair.members.filter((m) => m.presence !== "both" && m.matchConfidence !== "confirmed").length;

      if (!unmatchedClub && unmatchedMemberCount === 0) {
        warningRoot.innerHTML = "";
        return;
      }

      const messages: string[] = [];
      if (unmatchedClub) {
        const missingSide = clubPair.basecampClubId ? "EasySpeak" : "Basecamp";
        messages.push(`This club has no counterpart in ${missingSide}. <a href="#clubReview">Fix in Club Review</a>`);
      }
      if (unmatchedMemberCount > 0) {
        messages.push(
          `${unmatchedMemberCount} member${unmatchedMemberCount === 1 ? "" : "s"} without a match between Basecamp and EasySpeak. ` +
            '<a href="#members">Fix in Member Review</a>'
        );
      }

      warningRoot.innerHTML = `
        <div class="conflict-warning">
          ${warningIconHtml("Conflicts found")}
          ${messages.join(" · ")}
        </div>
      `;
    }

    function computeKpis(clubPair: ClubPairReport) {
      let paths = 0;
      let readyToLevelUp = 0;

      for (const member of clubPair.members) {
        paths += member.paths.filter((p) => !p.nonPathway).length;
        if (!needsAction(member) && isMemberReadyForNextLevel(member)) readyToLevelUp += 1;
      }

      return { members: clubPair.members.length, paths, readyToLevelUp };
    }

    function renderKpiRow(clubPair: ClubPairReport | null) {
      const kpiRoot = getRoot("kpiRoot");
      if (!clubPair) {
        kpiRoot.innerHTML = "";
        return;
      }

      const kpis = computeKpis(clubPair);
      const cards: { label: string; value: number }[] = [
        { label: "Members", value: kpis.members },
        { label: "Paths", value: kpis.paths },
        { label: "Ready to Level Up", value: kpis.readyToLevelUp },
      ];

      kpiRoot.innerHTML = cards
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

    function renderClubTabs(sections: ClubSection[]) {
      clubSections = sections;
      mainTable.expandedRowKey = null;
      pendingTable.expandedRowKey = null;
      const tabsRoot = getRoot("clubTabs");

      if (sections.length === 0) {
        getRoot("conflictWarning").innerHTML = "";
        getRoot("kpiRoot").innerHTML = "";
        tabsRoot.innerHTML = "";
        getRoot("summaryTableRoot").innerHTML = '<p class="empty-state">No clubs found in either data source.</p>';
        getRoot("pendingReviewTableRoot").innerHTML = "";
        return;
      }

      activeClubKey = sections[0].clubKey;
      tabsRoot.innerHTML = sections
        .map((s) => {
          const unmatched = !s.clubPair.basecampClubId || !s.clubPair.easyspeakClubId;
          const warningIcon = unmatched ? warningIconHtml("No match found between Basecamp and EasySpeak for this club") : "";
          const missingCount = s.clubPair.members.filter(needsAction).length;
          const countBadge = missingCount > 0 ? `<span class="tab-count">${missingCount}</span>` : "";
          const fullName = s.clubName ?? "(unnamed club)";
          return `<button class="tab-btn" data-club-key="${s.clubKey}" title="${escapeAttr(fullName)}">${warningIcon}${escapeHtml(shortenClubName(fullName))}${countBadge}</button>`;
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
      root.querySelectorAll<HTMLButtonElement>("#clubTabs .tab-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.clubKey === activeClubKey);
      });
    }

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

    function matchesSearch(row: LevelSummaryRow, query: string): boolean {
      if (!query) return true;
      return row.memberName.toLowerCase().includes(query) || row.pathName.toLowerCase().includes(query);
    }

    function renderSummaryTable(state: SummaryTableState, rows: LevelSummaryRow[]) {
      state.rows = rows;
      const tableRoot = getRoot(state.rootId);

      if (rows.length === 0) {
        tableRoot.innerHTML = `<p class="empty-state">${escapeHtml(state.emptyMessage)}</p>`;
        return;
      }

      const colgroupHtml = SUMMARY_COLUMNS.map((col) => `<col class="${col.colClass}">`).join("");
      const theadHtml = SUMMARY_COLUMNS.map((col) => `<th data-key="${col.key}">${escapeHtml(col.label)}</th>`).join("");
      tableRoot.innerHTML = `<table class="data-table summary"><colgroup>${colgroupHtml}</colgroup><thead><tr>${theadHtml}</tr></thead><tbody></tbody></table>`;

      tableRoot.querySelectorAll<HTMLTableCellElement>("th").forEach((th) => {
        th.addEventListener("click", () => {
          const key = th.dataset.key as keyof LevelSummaryRow;
          state.sort = state.sort.key === key ? { key, direction: state.sort.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" };
          updateSummaryHeaders(state);
          renderSummaryBody(state);
        });
      });

      tableRoot.querySelector("tbody")!.addEventListener("click", (event) => {
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
      const tableRoot = getRoot(state.rootId);
      tableRoot.querySelectorAll<HTMLTableCellElement>("table.summary th").forEach((th) => {
        const col = SUMMARY_COLUMNS.find((c) => c.key === th.dataset.key)!;
        const isActive = th.dataset.key === state.sort.key;
        const arrow = isActive ? (state.sort.direction === "asc" ? " ▲" : " ▼") : "";
        th.innerHTML = `${escapeHtml(col.label)}${arrow ? `<span class="sort-indicator">${arrow}</span>` : ""}`;
      });
    }

    function renderSummaryBody(state: SummaryTableState) {
      const tableRoot = getRoot(state.rootId);
      const tbody = tableRoot.querySelector("table.summary tbody")!;
      const sorted = [...state.rows].sort((a, b) => compareLevelSummaryRows(a, b, state.sort.key, state.sort.direction));
      tbody.innerHTML = sorted
        .map((row) => {
          const key = rowKey(row);
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
      const ready = row.status === "ready" || row.status === "ready-if-reported";
      const rowClass = [muted && "muted-row", ready && "ready-row"].filter(Boolean).join(" ");
      const pathBadge = row.pathPresence === "both" ? "" : ` <span class="badge badge-${row.pathPresence}">${presenceLabel(row.pathPresence)}</span>`;
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
          <td>${escapeHtml(row.currentLevelLabel === "Not in Basecamp" ? "-" : row.currentLevelLabel)}</td>
          <td><span class="badge ${statusInfo.tone}" title="${escapeAttr(statusInfo.description)}">${statusInfo.icon}${escapeHtml(statusInfo.label)}</span></td>
          <td>${renderStatusDetail(row.statusDetail)}</td>
        </tr>
      `;
    }

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

    function getLevel(path: PathReport, levelNumber: number): LevelDiff {
      return path.levels.find((l) => l.level === levelNumber) ?? NULL_LEVEL_DIFF(levelNumber);
    }

    function renderLevelsTable(path: PathReport): string {
      const levels = [1, 2, 3, 4, 5].map((n) => getLevel(path, n));
      return `
        <div class="levels-table levels-table--wide">
          <table class="data-table levels">
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
        </div>
        <div class="levels-table levels-table--narrow">
          ${renderLevelsTableNarrow(path, levels)}
        </div>
      `;
    }

    function cellAttr(level: LevelDiff, extraClass?: string): string {
      const classes = [level.pendingValidation ? "pending-cell" : "", extraClass ?? ""].filter(Boolean);
      return classes.length ? ` class="${classes.join(" ")}"` : "";
    }

    function basecampCellContent(level: LevelDiff): { content: string; approved: boolean } {
      const approved = !!level.basecamp?.approved;
      const content = !level.basecamp ? "—" : approved ? APPROVED_CHECK : `${level.basecamp.completed} of ${level.basecamp.total}`;
      return { content, approved };
    }

    function easyspeakCellContent(level: LevelDiff): string {
      return !level.easyspeak ? "—" : level.basecamp?.approved === true ? "" : `${level.easyspeak.done} speeches done`;
    }

    function discrepancyContent(level: LevelDiff): string {
      if (!level.basecamp || !level.easyspeak || level.basecamp.approved) return "—";
      return level.discrepancy && level.discrepancy > 0 ? `${level.discrepancy} to report` : "—";
    }

    function renderBasecampRow(levels: LevelDiff[], pathCompletion: PathReport["pathCompletion"]): string {
      return `<tr><td>Basecamp</td>${levels.map(basecampCell).join("")}${basecampPathCompletionCell(pathCompletion)}</tr>`;
    }

    function basecampCell(level: LevelDiff): string {
      const { content, approved } = basecampCellContent(level);
      return `<td${cellAttr(level, approved ? "check-cell" : undefined)}>${content}</td>`;
    }

    function basecampPathCompletionCell(pathCompletion: PathReport["pathCompletion"]): string {
      return `<td>${pathCompletion ? `${pathCompletion.completed} of ${pathCompletion.total}` : "—"}</td>`;
    }

    function renderEasyspeakRow(levels: LevelDiff[]): string {
      const [l1, l2, l3, l4, l5] = levels;
      return `<tr><td>EasySpeak</td>${[l1, l2, l3, l4].map((l) => easyspeakCell(l)).join("")}${easyspeakCell(l5, 2, LEVEL5_NOTE_TITLE)}</tr>`;
    }

    function easyspeakCell(level: LevelDiff, colspan?: number, title?: string): string {
      const span = colspan ? ` colspan="${colspan}"` : "";
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
      return `<td${cellAttr(level)}${span}${titleAttr}>${easyspeakCellContent(level)}</td>`;
    }

    function renderDiscrepancyFooterRow(levels: LevelDiff[]): string {
      const [l1, l2, l3, l4, l5] = levels;
      return `<tr><td>Reporting gap</td>${[l1, l2, l3, l4].map((l) => discrepancyCell(l)).join("")}${discrepancyCell(l5, 2)}</tr>`;
    }

    function discrepancyCell(level: LevelDiff, colspan?: number): string {
      const span = colspan ? ` colspan="${colspan}"` : "";
      return `<td${span}>${discrepancyContent(level)}</td>`;
    }

    // Phone-width companion to renderLevelsTable(): the same per-level data,
    // transposed to one row per level/path-completion category (readable at
    // ~360-400px) instead of one row per source (unreadable at 7 columns).
    // Reuses the exact same content/approval computations as the wide table
    // above so the two never drift — only the row/column arrangement differs.
    function renderLevelsTableNarrow(path: PathReport, levels: LevelDiff[]): string {
      const bodyRows = [1, 2, 3, 4]
        .map((n) => {
          const level = levels[n - 1];
          const { content: bcContent, approved } = basecampCellContent(level);
          const gap = discrepancyContent(level);
          const esContent = easyspeakCellContent(level);
          const esCombined = gap !== "—" ? `${esContent} · ${gap}` : esContent;
          return `
            <tr>
              <td>Level ${n}</td>
              <td${cellAttr(level, approved ? "check-cell" : undefined)}>${bcContent}</td>
              <td${cellAttr(level)}>${esCombined}</td>
            </tr>
          `;
        })
        .join("");

      // Level 5's EasySpeak cell spans down into the Path Completion row —
      // the vertical equivalent of the wide table's colspan="2" on that same
      // cell — since EasySpeak has no completion metric distinct from Level 5.
      const level5 = levels[4];
      const { content: bc5Content, approved: bc5Approved } = basecampCellContent(level5);
      const gap5 = discrepancyContent(level5);
      const es5Content = easyspeakCellContent(level5);
      const es5Combined = gap5 !== "—" ? `${es5Content} · ${gap5}` : es5Content;

      return `
        <table class="data-table levels-narrow">
          <thead>
            <tr><th>Level</th><th>Basecamp</th><th>EasySpeak</th></tr>
          </thead>
          <tbody>
            ${bodyRows}
            <tr>
              <td>Level 5</td>
              <td${cellAttr(level5, bc5Approved ? "check-cell" : undefined)}>${bc5Content}</td>
              <td${cellAttr(level5)} rowspan="2" title="${escapeAttr(LEVEL5_NOTE_TITLE)}">${es5Combined}</td>
            </tr>
            <tr>
              <td>Path Completion</td>
              ${basecampPathCompletionCell(path.pathCompletion)}
            </tr>
          </tbody>
        </table>
      `;
    }

    function formatReportMeta(basecampScrapedAt: number | undefined, easyspeakScrapedAt: number | undefined): string {
      if (!basecampScrapedAt || !easyspeakScrapedAt) return "Report generated with incomplete data — both sources need to be extracted first.";

      const basecampDate = new Date(basecampScrapedAt).toLocaleDateString("en-US");
      const easyspeakDate = new Date(easyspeakScrapedAt).toLocaleDateString("en-US");

      return basecampDate === easyspeakDate
        ? `Report generated with data extracted from Basecamp & EasySpeak the ${basecampDate}`
        : `Report generated with data extracted from Basecamp the ${basecampDate} & EasySpeak the ${easyspeakDate}`;
    }

    root.querySelector("#summarySearch")!.addEventListener("input", (e) => {
      activeSearchQuery = (e.target as HTMLInputElement).value.trim().toLowerCase();
      renderActiveClub();
    });

    const onStorageChanged = (_changes: unknown, area: string) => {
      if (area === "local") refresh();
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    await refresh();

    return () => {
      disposed = true;
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  },
};
