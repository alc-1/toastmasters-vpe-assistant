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

// Opposing diagonal arrows for the Expand All / Collapse All controls
// (Lucide maximize-2 / minimize-2). Defined before shellHtml() so the toolbar
// markup there can interpolate them.
const ICON_EXPAND = `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
const ICON_COLLAPSE = `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;

function shellHtml(): string {
  return `
  <h1 class="page-title">${escapeHtml(i18n.t("report.page.title.title"))}</h1>
  <div class="meta" id="reportMeta"></div>
  <div class="anonymize-indicator" id="anonymizeIndicator"></div>

  <div id="clubTabs" class="tabs tabs-border" role="tablist"></div>
  <div id="conflictWarning" aria-live="polite"></div>
  <div id="kpiRoot" class="kpi-grid"></div>

  <h2 class="section-header section-header--first">${escapeHtml(i18n.t("report.section.nextLevelSummary.title"))}</h2>
  <p class="help-text summary-help-text--wide">
    ${escapeHtml(i18n.t("report.section.nextLevelSummary.helpWide"))}
  </p>
  <p class="help-text summary-help-text--narrow">
    ${escapeHtml(i18n.t("report.section.nextLevelSummary.helpNarrow"))}
  </p>

  <div class="summary-toolbar">
    <input type="text" id="summarySearch" class="input input-sm summary-toolbar__search" placeholder="${escapeAttr(i18n.t("report.toolbar.search.placeholder"))}">
    <div class="summary-expand-controls">
      <button type="button" class="btn btn-sm btn-secondary" data-expand-all>${ICON_EXPAND}${escapeHtml(i18n.t("report.toolbar.expandAll.button"))}</button>
      <button type="button" class="btn btn-sm btn-secondary" data-collapse-all>${ICON_COLLAPSE}${escapeHtml(i18n.t("report.toolbar.collapseAll.button"))}</button>
    </div>
  </div>
  <div id="summaryTableRoot"></div>

  <div id="pendingReviewSection">
    <h2 class="section-header">${escapeHtml(i18n.t("report.section.pendingReview.title"))}</h2>
    <p class="help-text">
      ${i18n.t("report.section.pendingReview.help")}
    </p>
    <div id="pendingReviewTableRoot"></div>
  </div>
`;
}

interface SummaryColumn {
  key: keyof LevelSummaryRow;
  label: string;
  colClass: string;
}

function summaryColumns(): SummaryColumn[] {
  return [
    { key: "memberName", label: i18n.t("report.column.member.label"), colClass: "col-member" },
    { key: "pathName", label: i18n.t("report.column.path.label"), colClass: "col-path" },
    { key: "currentLevelSortValue", label: i18n.t("report.column.level.label"), colClass: "col-level" },
    { key: "statusSortRank", label: i18n.t("report.column.status.label"), colClass: "col-status" },
    { key: "statusDetail", label: i18n.t("report.column.detail.label"), colClass: "col-detail" },
  ];
}

const ICON_CHECKMARK = `<svg class="status-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_LIGHTNING = `<svg class="status-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

interface StatusBadgeInfo {
  label: string;
  tone: string;
  icon: string;
  description: string;
}

function statusBadges(): Record<LevelUpStatus, StatusBadgeInfo> {
  return {
    ready: {
      label: i18n.t("report.status.ready.label"),
      tone: "badge-soft badge-success",
      icon: ICON_CHECKMARK,
      description: i18n.t("report.status.ready.description"),
    },
    "ready-if-reported": {
      label: i18n.t("report.status.readyIfReported.label"),
      tone: "badge-soft badge-warning",
      icon: ICON_LIGHTNING,
      description: i18n.t("report.status.readyIfReported.description"),
    },
    "in-progress": {
      label: i18n.t("report.status.inProgress.label"),
      tone: "badge-soft badge-info",
      icon: "",
      description: i18n.t("report.status.inProgress.description"),
    },
    "needs-reporting": {
      label: i18n.t("report.status.needsReporting.label"),
      tone: "badge-soft badge-warning",
      icon: "",
      description: i18n.t("report.status.needsReporting.description"),
    },
    completed: {
      label: i18n.t("report.status.completed.label"),
      tone: "badge-soft badge-success",
      icon: "",
      description: i18n.t("report.status.completed.description"),
    },
    "not-tracked": {
      label: i18n.t("report.status.notTracked.label"),
      tone: "badge-soft",
      icon: "",
      description: i18n.t("report.status.notTracked.description"),
    },
  };
}

interface ClubSection {
  clubKey: string;
  clubName: string | null;
  rows: LevelSummaryRow[];
  clubPair: ClubPairReport;
}

// Acknowledged one-sided clubs sort after every regular club (nothing left
// to review there), alphabetically within each group — same convention as
// clubReview.ts's own clubSortName()/sortClubPairs().
function sortClubSections(sections: { clubName: string | null; clubPair: ClubPairReport }[]): void {
  sections.sort((a, b) => {
    if (a.clubPair.clubOrphaned !== b.clubPair.clubOrphaned) return a.clubPair.clubOrphaned ? 1 : -1;
    return (a.clubName ?? "").localeCompare(b.clubName ?? "", undefined, { sensitivity: "base" });
  });
}

interface SummaryTableState {
  rootId: string;
  emptyMessage: string;
  rows: LevelSummaryRow[];
  sort: { key: keyof LevelSummaryRow; direction: "asc" | "desc" };
  expandedRowKeys: Set<string>;
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

function level5NoteTitle(): string {
  return i18n.t("report.level5Note.tooltip");
}
function approvedCheck(): string {
  return approvedCheckIconHtml(i18n.t("report.approvedCheck.tooltip"));
}

export const reportView: ViewModule = {
  async mount(root) {
    root.innerHTML = shellHtml();

    const mainTable: SummaryTableState = {
      rootId: "summaryTableRoot",
      emptyMessage: i18n.t("report.emptyState.noPaths.body"),
      rows: [],
      sort: { key: "statusSortRank", direction: "asc" },
      expandedRowKeys: new Set<string>(),
    };
    const pendingTable: SummaryTableState = {
      rootId: "pendingReviewTableRoot",
      emptyMessage: i18n.t("report.emptyState.noPendingReview.body"),
      rows: [],
      sort: { key: "statusSortRank", direction: "asc" },
      expandedRowKeys: new Set<string>(),
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
      const cached = await local.get(["basecampData", "basecampScrapedAt", "basecampCompletedPaths", "easyspeakData", "easyspeakScrapedAt"]);
      if (disposed) return;

      if (!cached.basecampData) {
        getRoot("anonymizeIndicator").textContent = "";
        getRoot("conflictWarning").innerHTML = "";
        getRoot("kpiRoot").innerHTML = "";
        getRoot("clubTabs").innerHTML = "";
        getRoot("summaryTableRoot").innerHTML = `<p class="empty-state">${escapeHtml(i18n.t("report.emptyState.needsBasecamp.body"))}</p>`;
        (root.querySelector("#pendingReviewSection") as HTMLElement).style.display = "none";
        setToolbarVisible(false);
        return;
      }
      (root.querySelector("#pendingReviewSection") as HTMLElement).style.display = "";

      getRoot("reportMeta").textContent = formatReportMeta(cached.basecampScrapedAt, cached.easyspeakScrapedAt);

      const resolution = await loadResolutionData();
      if (disposed) return;
      let report = buildReport(
        cached.basecampData,
        cached.easyspeakData ?? {},
        { basecampScrapedAt: cached.basecampScrapedAt, easyspeakScrapedAt: cached.easyspeakScrapedAt },
        { ...resolution, allowFuzzyMemberMatches: false },
        cached.basecampCompletedPaths ?? {}
      );

      const anonymize = await getAnonymizeMode();
      if (disposed) return;
      if (anonymize) report = anonymizeReport(report, buildAnonymizationMaps(report));
      getRoot("anonymizeIndicator").innerHTML = anonymize
        ? `<span class="badge badge-soft badge-warning" title="${escapeAttr(i18n.t("report.anonymizeIndicator.tooltip"))}">${escapeHtml(i18n.t("report.anonymizeIndicator.label"))}</span>`
        : "";

      const summaryGroups = buildLevelSummary(report);
      const sections = report.clubPairs.map((clubPair, index) => ({
        clubKey: summaryGroups[index].clubKey,
        clubName: summaryGroups[index].clubName,
        rows: summaryGroups[index].rows,
        clubPair,
      }));
      sortClubSections(sections);

      renderClubTabs(sections);
    }

    function renderConflictWarning(clubPair: ClubPairReport | null) {
      const warningRoot = getRoot("conflictWarning");
      if (!clubPair) {
        warningRoot.innerHTML = "";
        return;
      }

      // An acknowledged one-sided club has no counterpart to match members
      // against at all, so every one of its members is inevitably
      // presence !== "both" — the usual "N members without a match ... Fix
      // in Member Review" message below would be both guaranteed to fire and
      // not actionable there. Explain the situation instead.
      if (clubPair.clubOrphaned) {
        const side = clubPair.basecampClubId ? i18n.t("export.type.basecamp.label") : i18n.t("export.type.easyspeak.label");
        warningRoot.innerHTML = `
          <div role="alert" class="alert alert-info alert-soft mb-4 text-base">
            ${approvedCheckIconHtml(i18n.t("report.conflictWarning.orphanedClub.tooltip"))}
            ${i18n.t("report.conflictWarning.orphanedClub.sentence", [side])}
          </div>
        `;
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
        const missingSide = clubPair.basecampClubId ? i18n.t("export.type.easyspeak.label") : i18n.t("export.type.basecamp.label");
        messages.push(i18n.t("report.conflictWarning.clubNoCounterpart.sentence", [missingSide]));
      }
      if (unmatchedMemberCount > 0) {
        messages.push(i18n.t("report.conflictWarning.membersUnmatched.count", unmatchedMemberCount));
      }

      warningRoot.innerHTML = `
        <div role="alert" class="alert alert-warning alert-soft mb-4 text-base">
          ${warningIconHtml(i18n.t("report.conflictWarning.conflictsFound.tooltip"))}
          <div class="flex flex-col gap-1">
            ${messages.map((m) => `<div>${m}</div>`).join("")}
          </div>
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
        { label: i18n.t("report.kpi.members.label"), value: kpis.members },
        { label: i18n.t("report.kpi.paths.label"), value: kpis.paths },
        { label: i18n.t("report.kpi.readyToLevelUp.label"), value: kpis.readyToLevelUp },
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

    function setToolbarVisible(visible: boolean) {
      (root.querySelector(".summary-toolbar") as HTMLElement).style.display = visible ? "" : "none";
    }

    function renderClubTabs(sections: ClubSection[]) {
      clubSections = sections;
      mainTable.expandedRowKeys.clear();
      pendingTable.expandedRowKeys.clear();
      const tabsRoot = getRoot("clubTabs");

      if (sections.length === 0) {
        getRoot("conflictWarning").innerHTML = "";
        getRoot("kpiRoot").innerHTML = "";
        tabsRoot.innerHTML = "";
        getRoot("summaryTableRoot").innerHTML = `<p class="empty-state">${escapeHtml(i18n.t("report.emptyState.noClubs.body"))}</p>`;
        getRoot("pendingReviewTableRoot").innerHTML = "";
        (root.querySelector("#pendingReviewSection") as HTMLElement).style.display = "none";
        setToolbarVisible(false);
        return;
      }
      setToolbarVisible(true);

      activeClubKey = sections[0].clubKey;
      tabsRoot.innerHTML = sections
        .map((s) => {
          const unmatched = (!s.clubPair.basecampClubId || !s.clubPair.easyspeakClubId) && !s.clubPair.clubOrphaned;
          const warningIcon = unmatched ? warningIconHtml(i18n.t("report.clubTab.noMatch.tooltip")) : "";
          const missingCount = s.clubPair.members.filter(needsAction).length;
          const countBadge = s.clubPair.clubOrphaned
            ? `<span class="tab-badge">${escapeHtml(i18n.t("report.clubTab.oneSided.label"))}</span>`
            : missingCount > 0
              ? `<span class="tab-count">${missingCount}</span>`
              : "";
          const fullName = s.clubName ?? i18n.t("report.clubTab.unnamed.label");
          return `<button class="tab" data-club-key="${s.clubKey}" title="${escapeAttr(fullName)}">${warningIcon}${escapeHtml(shortenClubName(fullName))}${countBadge}</button>`;
        })
        .join("");

      tabsRoot.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeClubKey = btn.dataset.clubKey ?? null;
          mainTable.expandedRowKeys.clear();
          pendingTable.expandedRowKeys.clear();
          updateActiveTab();
          renderActiveClub();
        });
      });

      updateActiveTab();
      renderActiveClub();
    }

    function updateActiveTab() {
      root.querySelectorAll<HTMLButtonElement>("#clubTabs .tab").forEach((btn) => {
        btn.classList.toggle("tab-active", btn.dataset.clubKey === activeClubKey);
      });
    }

    function renderActiveClub() {
      const section = clubSections.find((s) => s.clubKey === activeClubKey);
      const clubPair = section ? section.clubPair : null;
      activeMembers = new Map((clubPair?.members ?? []).map((m) => [memberKey(m), m]));
      renderConflictWarning(clubPair);
      renderKpiRow(clubPair);
      const rows = (section ? section.rows : []).filter((r) => matchesSearch(r, activeSearchQuery));
      const pendingRows = rows.filter((r) => r.pendingReview);
      renderSummaryTable(mainTable, rows.filter((r) => !r.pendingReview));
      renderSummaryTable(pendingTable, pendingRows);
      (root.querySelector("#pendingReviewSection") as HTMLElement).style.display = pendingRows.length === 0 ? "none" : "";
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
        updateExpandControls(state);
        return;
      }

      // Dual render: a sortable <table> on desktop (≥lg), a tap-to-expand card
      // list on narrower widths. renderSummaryBody() fills both; the expand
      // toggle is bound to each container (both recreated on this call, so no
      // listener leak). Sorting is desktop-only — the card list just follows
      // whatever sort the table is in.
      const colgroupHtml = summaryColumns().map((col) => `<col class="${col.colClass}">`).join("");
      const theadHtml = summaryColumns().map((col) => `<th data-key="${col.key}">${escapeHtml(col.label)}</th>`).join("");
      tableRoot.innerHTML = `
        <table class="data-table summary hidden lg:table"><colgroup>${colgroupHtml}</colgroup><thead><tr>${theadHtml}</tr></thead><tbody></tbody></table>
        <div class="summary-cards flex flex-col gap-2 lg:hidden"></div>
      `;

      tableRoot.querySelectorAll<HTMLTableCellElement>("th").forEach((th) => {
        th.addEventListener("click", () => {
          const key = th.dataset.key as keyof LevelSummaryRow;
          state.sort = state.sort.key === key ? { key, direction: state.sort.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" };
          updateSummaryHeaders(state);
          renderSummaryBody(state);
        });
      });

      const toggleExpand = (event: Event) => {
        const target = event.target as HTMLElement;
        // A click inside an already-expanded row/card's detail must not collapse it.
        if (target.closest("[data-row-detail]")) return;
        const el = target.closest<HTMLElement>("[data-row-key]");
        if (!el) return;
        const key = el.dataset.rowKey!;
        if (state.expandedRowKeys.has(key)) state.expandedRowKeys.delete(key);
        else state.expandedRowKeys.add(key);
        // Toggle classes on the live nodes (rather than re-rendering) so the
        // grid-height + chevron CSS transitions actually fire.
        syncExpandedClasses(state);
      };
      tableRoot.querySelector("tbody")!.addEventListener("click", toggleExpand);
      tableRoot.querySelector(".summary-cards")!.addEventListener("click", toggleExpand);

      updateSummaryHeaders(state);
      renderSummaryBody(state);
    }

    function updateSummaryHeaders(state: SummaryTableState) {
      const tableRoot = getRoot(state.rootId);
      tableRoot.querySelectorAll<HTMLTableCellElement>("table.summary th").forEach((th) => {
        const col = summaryColumns().find((c) => c.key === th.dataset.key)!;
        const isActive = th.dataset.key === state.sort.key;
        const arrow = isActive ? (state.sort.direction === "asc" ? " ▲" : " ▼") : "";
        th.innerHTML = `${escapeHtml(col.label)}${arrow ? `<span class="sort-indicator">${arrow}</span>` : ""}`;
      });
    }

    function renderSummaryBody(state: SummaryTableState) {
      const tableRoot = getRoot(state.rootId);
      const sorted = [...state.rows].sort((a, b) => compareLevelSummaryRows(a, b, state.sort.key, state.sort.direction));

      const tbody = tableRoot.querySelector("table.summary tbody");
      if (tbody) {
        // Detail rows are now always emitted (collapsed to zero height via CSS)
        // so a toggle can animate. That interleaves hidden <tr>s between the
        // visible ones, breaking `nth-child(2n)` zebra striping — hence the
        // explicit `row-stripe` parity class on every other visible row.
        tbody.innerHTML = sorted
          .map((row, i) => {
            const key = rowKey(row);
            const isExpanded = state.expandedRowKeys.has(key);
            return renderSummaryRow(row, key, isExpanded, i % 2 === 1) + renderDetailRow(row, isExpanded);
          })
          .join("");
      }

      const cardsRoot = tableRoot.querySelector(".summary-cards");
      if (cardsRoot) {
        cardsRoot.innerHTML = sorted.map((row) => renderSummaryCard(row, rowKey(row), state.expandedRowKeys.has(rowKey(row)))).join("");
      }

      updateExpandControls(state);
    }

    // Disable "Expand All" once every row is open and "Collapse All" once every
    // row is closed, so neither button is offered when it would be a no-op. The
    // controls live in the shell toolbar and drive only the main summary table.
    function updateExpandControls(state: SummaryTableState) {
      if (state !== mainTable) return;
      const expandAllBtn = root.querySelector<HTMLButtonElement>(".summary-toolbar [data-expand-all]");
      const collapseAllBtn = root.querySelector<HTMLButtonElement>(".summary-toolbar [data-collapse-all]");
      if (!expandAllBtn || !collapseAllBtn) return;
      const expandedCount = state.rows.filter((row) => state.expandedRowKeys.has(rowKey(row))).length;
      expandAllBtn.disabled = state.rows.length === 0 || expandedCount === state.rows.length;
      collapseAllBtn.disabled = expandedCount === 0;
    }

    // Flip the `expanded` class on already-rendered nodes to match
    // state.expandedRowKeys — used by the single-row toggle and the
    // Expand All / Collapse All controls so the CSS transitions fire
    // (a full re-render would paint the end state with no animation).
    function syncExpandedClasses(state: SummaryTableState) {
      const tableRoot = getRoot(state.rootId);

      tableRoot.querySelectorAll<HTMLElement>("table.summary tbody tr[data-row-key]").forEach((tr) => {
        const expanded = state.expandedRowKeys.has(tr.dataset.rowKey!);
        tr.querySelector(".row-chevron")?.classList.toggle("expanded", expanded);
        const detail = tr.nextElementSibling;
        if (detail?.classList.contains("detail-row")) detail.classList.toggle("expanded", expanded);
      });

      tableRoot.querySelectorAll<HTMLElement>(".summary-card[data-row-key]").forEach((card) => {
        const expanded = state.expandedRowKeys.has(card.dataset.rowKey!);
        card.querySelector(".row-chevron")?.classList.toggle("expanded", expanded);
        card.querySelector(".card-detail-inner")?.classList.toggle("expanded", expanded);
      });

      updateExpandControls(state);
    }

    function renderSummaryCard(row: LevelSummaryRow, key: string, isExpanded: boolean): string {
      const muted = row.status === "completed" || row.status === "not-tracked";
      const ready = row.status === "ready" || row.status === "ready-if-reported";
      const pathBadge = row.pathPresence === "both" ? "" : ` <span class="badge ${presenceBadgeClass(row.pathPresence)}">${presenceLabel(row.pathPresence)}</span>`;
      const levelLabel = row.currentLevelLabel === i18n.t("report.levelSummary.notInBasecamp.label") ? i18n.t("common.cell.empty.label") : row.currentLevelLabel;
      const statusInfo = statusBadges()[row.status];
      return `
        <div class="summary-card rounded-md border border-base-300 bg-base-100 p-3${muted ? " opacity-70 italic" : ""}${ready ? " font-bold" : ""}" data-row-key="${escapeAttr(key)}" title="${escapeAttr(i18n.t("report.row.expandTooltip.tooltip"))}">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-semibold">${escapeHtml(row.memberName)}</div>
              <div class="text-sm text-tm-gray-600 font-normal">${escapeHtml(row.pathName)}${pathBadge} · ${escapeHtml(String(levelLabel))}</div>
            </div>
            <div class="shrink-0 flex flex-col items-end gap-1">
              <span class="badge ${statusInfo.tone}" title="${escapeAttr(statusInfo.description)}">${statusInfo.icon}${escapeHtml(statusInfo.label)}</span>
              <span class="row-chevron${isExpanded ? " expanded" : ""}">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
              </span>
            </div>
          </div>
          <div class="mt-2 pt-2 border-t border-base-300 text-xs font-normal not-italic">${renderStatusDetail(row.statusDetail)}</div>
          <div class="card-detail-inner${isExpanded ? " expanded" : ""} font-normal not-italic" data-row-detail><div>${renderRowDetail(row)}</div></div>
        </div>
      `;
    }

    function rowKey(row: LevelSummaryRow): string {
      return `${row.memberKey}::${row.pathKey}`;
    }

    function renderSummaryRow(row: LevelSummaryRow, key: string, isExpanded: boolean, stripe: boolean) {
      const muted = row.status === "completed" || row.status === "not-tracked";
      const ready = row.status === "ready" || row.status === "ready-if-reported";
      const rowClass = [muted && "muted-row", ready && "ready-row", stripe && "row-stripe"].filter(Boolean).join(" ");
      const pathBadge = row.pathPresence === "both" ? "" : ` <span class="badge ${presenceBadgeClass(row.pathPresence)}">${presenceLabel(row.pathPresence)}</span>`;
      const chevron = `
        <span class="row-chevron${isExpanded ? " expanded" : ""}">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
        </span>
      `;
      const statusInfo = statusBadges()[row.status];
      return `
        <tr class="${rowClass}" data-row-key="${escapeAttr(key)}" title="${escapeAttr(i18n.t("report.row.expandTooltip.tooltip"))}">
          <td>${chevron}${escapeHtml(row.memberName)}</td>
          <td>${escapeHtml(row.pathName)}${pathBadge}</td>
          <td>${escapeHtml(row.currentLevelLabel === i18n.t("report.levelSummary.notInBasecamp.label") ? "-" : row.currentLevelLabel)}</td>
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

    function renderDetailRow(row: LevelSummaryRow, isExpanded: boolean): string {
      return `
        <tr class="detail-row${isExpanded ? " expanded" : ""}">
          <td colspan="${summaryColumns().length}"><div class="detail-row-inner" data-row-detail><div>${renderRowDetail(row)}</div></div></td>
        </tr>
      `;
    }

    function renderRowDetail(row: LevelSummaryRow): string {
      const member = activeMembers.get(row.memberKey);
      if (!member) return "";
      const path = member.paths.find((p) => p.canonicalKey === row.pathKey);
      if (!path) return "";

      const noActivePathNote = member.easyspeakNoActivePath
        ? `<div class="no-active-path">${escapeHtml(i18n.t("report.detail.noActivePath.body"))}</div>`
        : "";
      const pathsHtml = renderMemberPathsList(member, path.canonicalKey);

      if (path.nonPathway) {
        return `${pathsHtml}${noActivePathNote}<div class="non-pathway-note">${escapeHtml(i18n.t("report.detail.nonPathway.body"))}</div>`;
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
      return `<div class="detail-paths"><span class="detail-paths-label">${escapeHtml(i18n.t("report.detail.pathsLabel.label"))}</span> ${items}</div>`;
    }

    function presenceLabel(presence: string): string {
      if (presence === "both") return i18n.t("report.presence.both.label");
      if (presence === "basecamp-only") return i18n.t("report.presence.basecampOnly.label");
      return i18n.t("report.presence.easyspeakOnly.label");
    }

    function presenceBadgeClass(presence: string): string {
      return presence === "basecamp-only" ? "badge-soft badge-warning" : "badge-soft badge-info";
    }

    function getLevel(path: PathReport, levelNumber: number): LevelDiff {
      return path.levels.find((l) => l.level === levelNumber) ?? NULL_LEVEL_DIFF(levelNumber);
    }

    // Used both to render the dash AND (in renderLevelsTableNarrow below) as
    // the sentinel value discrepancyContent()'s callers compare against — a
    // single function keeps both sides consistent regardless of locale,
    // rather than a hardcoded "—" literal at the comparison site.
    function emptyDash(): string {
      return i18n.t("common.cell.empty.label");
    }

    function renderLevelsTable(path: PathReport): string {
      const levels = [1, 2, 3, 4, 5].map((n) => getLevel(path, n));
      return `
        <div class="levels-table levels-table--wide">
          <table class="data-table levels">
            <thead>
              <tr>
                <th>${escapeHtml(i18n.t("report.levelsTable.source.label"))}</th>
                <th>${escapeHtml(i18n.t("report.levelsTable.level.sentence", ["1"]))}</th><th>${escapeHtml(i18n.t("report.levelsTable.level.sentence", ["2"]))}</th><th>${escapeHtml(i18n.t("report.levelsTable.level.sentence", ["3"]))}</th><th>${escapeHtml(i18n.t("report.levelsTable.level.sentence", ["4"]))}</th>
                <th>${escapeHtml(i18n.t("report.levelsTable.level.sentence", ["5"]))}</th>
                <th>${escapeHtml(i18n.t("report.levelsTable.pathCompletion.label"))}</th>
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
      const content = !level.basecamp
        ? emptyDash()
        : approved
          ? approvedCheck()
          : i18n.t("report.levelsTable.of.sentence", [String(level.basecamp.completed), String(level.basecamp.total)]);
      return { content, approved };
    }

    function easyspeakCellContent(level: LevelDiff): string {
      return !level.easyspeak
        ? emptyDash()
        : level.basecamp?.approved === true
          ? ""
          : i18n.t("report.levelsTable.speechesDone.sentence", [String(level.easyspeak.done)]);
    }

    function discrepancyContent(level: LevelDiff): string {
      if (!level.basecamp || !level.easyspeak || level.basecamp.approved) return emptyDash();
      return level.discrepancy && level.discrepancy > 0
        ? i18n.t("report.levelsTable.toReport.sentence", [String(level.discrepancy)])
        : emptyDash();
    }

    function renderBasecampRow(levels: LevelDiff[], pathCompletion: PathReport["pathCompletion"]): string {
      return `<tr><td>${escapeHtml(i18n.t("report.levelsTable.basecamp.label"))}</td>${levels.map(basecampCell).join("")}${basecampPathCompletionCell(pathCompletion)}</tr>`;
    }

    function basecampCell(level: LevelDiff): string {
      const { content, approved } = basecampCellContent(level);
      return `<td${cellAttr(level, approved ? "check-cell" : undefined)}>${content}</td>`;
    }

    function basecampPathCompletionCell(pathCompletion: PathReport["pathCompletion"]): string {
      return `<td>${pathCompletion ? i18n.t("report.levelsTable.of.sentence", [String(pathCompletion.completed), String(pathCompletion.total)]) : emptyDash()}</td>`;
    }

    function renderEasyspeakRow(levels: LevelDiff[]): string {
      const [l1, l2, l3, l4, l5] = levels;
      return `<tr><td>${escapeHtml(i18n.t("report.levelsTable.easyspeak.label"))}</td>${[l1, l2, l3, l4].map((l) => easyspeakCell(l)).join("")}${easyspeakCell(l5, 2, level5NoteTitle())}</tr>`;
    }

    function easyspeakCell(level: LevelDiff, colspan?: number, title?: string): string {
      const span = colspan ? ` colspan="${colspan}"` : "";
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
      return `<td${cellAttr(level)}${span}${titleAttr}>${easyspeakCellContent(level)}</td>`;
    }

    function renderDiscrepancyFooterRow(levels: LevelDiff[]): string {
      const [l1, l2, l3, l4, l5] = levels;
      return `<tr><td>${escapeHtml(i18n.t("report.levelsTable.reportingGap.label"))}</td>${[l1, l2, l3, l4].map((l) => discrepancyCell(l)).join("")}${discrepancyCell(l5, 2)}</tr>`;
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
          const esCombined = gap !== emptyDash() ? `${esContent} · ${gap}` : esContent;
          return `
            <tr>
              <td>${escapeHtml(i18n.t("report.levelsTable.level.sentence", [String(n)]))}</td>
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
      const es5Combined = gap5 !== emptyDash() ? `${es5Content} · ${gap5}` : es5Content;

      return `
        <table class="data-table levels-narrow">
          <thead>
            <tr><th>${escapeHtml(i18n.t("report.column.level.label"))}</th><th>${escapeHtml(i18n.t("report.levelsTable.basecamp.label"))}</th><th>${escapeHtml(i18n.t("report.levelsTable.easyspeak.label"))}</th></tr>
          </thead>
          <tbody>
            ${bodyRows}
            <tr>
              <td>${escapeHtml(i18n.t("report.levelsTable.level.sentence", ["5"]))}</td>
              <td${cellAttr(level5, bc5Approved ? "check-cell" : undefined)}>${bc5Content}</td>
              <td${cellAttr(level5)} rowspan="2" title="${escapeAttr(level5NoteTitle())}">${es5Combined}</td>
            </tr>
            <tr>
              <td>${escapeHtml(i18n.t("report.levelsTable.pathCompletion.label"))}</td>
              ${basecampPathCompletionCell(path.pathCompletion)}
            </tr>
          </tbody>
        </table>
      `;
    }

    function formatReportMeta(basecampScrapedAt: number | undefined, easyspeakScrapedAt: number | undefined): string {
      if (!basecampScrapedAt) return i18n.t("report.meta.incomplete.body");

      const basecampDate = new Date(basecampScrapedAt).toLocaleDateString();
      if (!easyspeakScrapedAt) return i18n.t("report.meta.basecampOnly.sentence", [basecampDate]);

      const easyspeakDate = new Date(easyspeakScrapedAt).toLocaleDateString();

      return basecampDate === easyspeakDate
        ? i18n.t("report.meta.sameDay.sentence", [basecampDate])
        : i18n.t("report.meta.differentDays.sentence", [basecampDate, easyspeakDate]);
    }

    root.querySelector("#summarySearch")!.addEventListener("input", (e) => {
      activeSearchQuery = (e.target as HTMLInputElement).value.trim().toLowerCase();
      renderActiveClub();
    });

    // Shell-toolbar Expand All / Collapse All — drive the main summary table.
    root.querySelector<HTMLButtonElement>(".summary-toolbar [data-expand-all]")!.addEventListener("click", () => {
      mainTable.expandedRowKeys = new Set(mainTable.rows.map(rowKey));
      syncExpandedClasses(mainTable);
    });
    root.querySelector<HTMLButtonElement>(".summary-toolbar [data-collapse-all]")!.addEventListener("click", () => {
      mainTable.expandedRowKeys.clear();
      syncExpandedClasses(mainTable);
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
