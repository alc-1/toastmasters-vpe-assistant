// src/entrypoints/app/views/members.ts
//
// The Member Review view: loads basecampData/easyspeakData straight from
// browser.storage.local (same as report — no live scraping happens here),
// combines it with the persisted resolution decisions from
// shared/resolution-store.ts, and renders one spreadsheet-style table per
// club. Every write action (confirm/reject/link/bind) persists immediately
// via shared/resolution-store.ts, then calls refresh(), which re-reads
// storage and rebuilds the whole report.

import { approvedCheckIconHtml, escapeAttr, escapeHtml, shortenClubName, warningIconHtml } from "../../../shared/dom-utils";
import { local } from "../../../shared/storage";
import {
  confirmMemberLink,
  excludePathMatch,
  flagPath,
  loadResolutionData,
  markMemberOrphan,
  markPathCompleted,
  markPathOrphan,
  rejectMemberPair,
  removeMemberPathOverride,
  setMemberPathOverride,
  unflagPath,
  unlinkMember,
  unmarkMemberOrphan,
  unmarkPathCompleted,
  unmarkPathOrphan,
} from "../../../shared/resolution-store";
import { buildReport, classifyMember, memberKey, needsAction } from "../../../shared/sync/delta";
import { getAnonymizeMode } from "../../../shared/settings-store";
import type { BasecampOverviewScrape, BasecampScrape, ClubPairReport, EasySpeakScrape, MemberReport, PathReport } from "../../../shared/types";
import type { ViewModule } from "../../../shared/view";

function shellHtml(): string {
  return `
  <h1 class="page-title">${escapeHtml(i18n.t("members.page.title.title"))}</h1>
  <div class="meta" id="pageMeta"></div>

  <div id="conflictWarning" aria-live="polite"></div>
  <div id="clubTabs" class="tabs tabs-border" role="tablist"></div>
  <div id="filterChips" class="toolbar"></div>
  <input type="text" id="memberSearch" class="input input-sm w-full lg:max-w-[280px] mb-3 block" placeholder="${escapeAttr(i18n.t("report.toolbar.search.placeholder"))}">
  <div id="membersRoot"></div>
`;
}

interface FilterDef {
  key: string;
  label: string;
}

function filterDefs(): FilterDef[] {
  return [
    { key: "todo", label: i18n.t("members.filter.todo.label") },
    { key: "flagged", label: i18n.t("members.filter.flagged.label") },
    { key: "resolved-manually", label: i18n.t("members.filter.resolvedManually.label") },
    { key: "all", label: i18n.t("members.filter.all.label") },
  ];
}

interface ClubSection {
  clubKey: string;
  clubName: string;
  clubPair: ClubPairReport;
}

// Acknowledged one-sided clubs sort after every regular club (nothing left
// to review there), alphabetically within each group — same convention as
// clubReview.ts's own clubSortName()/sortClubPairs().
function sortClubSections(sections: ClubSection[]): void {
  sections.sort((a, b) => {
    if (a.clubPair.clubOrphaned !== b.clubPair.clubOrphaned) return a.clubPair.clubOrphaned ? 1 : -1;
    return a.clubName.localeCompare(b.clubName, undefined, { sensitivity: "base" });
  });
}

interface Candidate {
  id: string | number;
  name: string;
}

export const membersView: ViewModule = {
  async mount(root) {
    root.innerHTML = shellHtml();

    let basecampData: BasecampScrape | null = null;
    let easyspeakData: EasySpeakScrape | null = null;
    let basecampCompletedPaths: BasecampOverviewScrape = {};
    let basecampScrapedAt: number | undefined;
    let easyspeakScrapedAt: number | undefined;

    let clubSections: ClubSection[] = [];
    let activeClubKey: string | null = null;
    let activeFilter = "todo";
    let activeSearchQuery = "";

    // Fresh per mount — navigating away and back naturally collapses
    // previously-expanded rows, matching the old per-page-load behavior.
    const expandedMemberKeys = new Set<string>();

    // Set true by the disposer — see syncData.ts's mount() for the full
    // writeup of why an in-flight async refresh needs this guard.
    let disposed = false;

    function getRoot(id: string): HTMLElement {
      return root.querySelector(`#${id}`) as HTMLElement;
    }

    async function init() {
      // Anonymize Mode replaces every real name with a generic label, so
      // name-based matching (this view's whole purpose) can't be done while
      // it's on.
      const anonymize = await getAnonymizeMode();
      if (disposed) return;
      if (anonymize) {
        getRoot("conflictWarning").innerHTML = "";
        getRoot("clubTabs").innerHTML = "";
        getRoot("filterChips").innerHTML = "";
        getRoot("membersRoot").innerHTML = `<p class="empty-state">${i18n.t("members.emptyState.privacyModeOn.sentence")}</p>`;
        return;
      }

      const cached = await local.get(["basecampData", "basecampScrapedAt", "basecampCompletedPaths", "easyspeakData", "easyspeakScrapedAt"]);
      if (disposed) return;

      if (!cached.basecampData || !cached.easyspeakData) {
        getRoot("conflictWarning").innerHTML = "";
        getRoot("clubTabs").innerHTML = "";
        getRoot("filterChips").innerHTML = "";
        getRoot("membersRoot").innerHTML = `<p class="empty-state">${escapeHtml(i18n.t("members.emptyState.needsBothSources.body"))}</p>`;
        return;
      }

      basecampData = cached.basecampData;
      easyspeakData = cached.easyspeakData;
      basecampCompletedPaths = cached.basecampCompletedPaths ?? {};
      basecampScrapedAt = cached.basecampScrapedAt;
      easyspeakScrapedAt = cached.easyspeakScrapedAt;

      getRoot("pageMeta").textContent = i18n.t("members.page.meta.sentence", [formatDate(basecampScrapedAt), formatDate(easyspeakScrapedAt)]);

      await refresh();
    }

    async function refresh() {
      const resolution = await loadResolutionData();
      if (disposed) return;
      const report = buildReport(basecampData!, easyspeakData!, { basecampScrapedAt, easyspeakScrapedAt }, resolution, basecampCompletedPaths);

      clubSections = report.clubPairs.map((clubPair, index) => ({
        clubKey: `club-${index}`,
        clubName: clubPair.basecampClubName ?? clubPair.easyspeakClubName ?? i18n.t("report.clubTab.unnamed.label"),
        clubPair,
      }));
      sortClubSections(clubSections);

      if (!clubSections.some((s) => s.clubKey === activeClubKey)) {
        activeClubKey = clubSections[0]?.clubKey ?? null;
      }

      renderClubMatchWarning();
      renderClubTabs();
      renderActiveClub();
    }

    function renderClubMatchWarning() {
      const warningRoot = getRoot("conflictWarning");
      const unmatchedClubs = clubSections.filter(
        (s) => (!s.clubPair.basecampClubId || !s.clubPair.easyspeakClubId) && !s.clubPair.clubOrphaned
      );

      if (unmatchedClubs.length === 0) {
        warningRoot.innerHTML = "";
        return;
      }

      const names = unmatchedClubs.map((s) => escapeHtml(s.clubName)).join(", ");
      warningRoot.innerHTML = `
        <div role="alert" class="alert alert-warning alert-soft mb-4 text-base">
          ${warningIconHtml(i18n.t("members.clubWarning.unmatchedClub.tooltip"))}
          ${i18n.t("members.clubWarning.sentence.count", unmatchedClubs.length, [String(unmatchedClubs.length), names])}
        </div>
      `;
    }

    function renderClubTabs() {
      const tabsRoot = getRoot("clubTabs");

      if (clubSections.length === 0) {
        getRoot("conflictWarning").innerHTML = "";
        tabsRoot.innerHTML = "";
        getRoot("membersRoot").innerHTML = `<p class="empty-state">${escapeHtml(i18n.t("report.emptyState.noClubs.body"))}</p>`;
        return;
      }

      tabsRoot.innerHTML = clubSections
        .map((s) => {
          const unmatchedClub = (!s.clubPair.basecampClubId || !s.clubPair.easyspeakClubId) && !s.clubPair.clubOrphaned;
          const warningIcon = unmatchedClub ? warningIconHtml(i18n.t("report.clubTab.noMatch.tooltip")) : "";
          const missingCount = s.clubPair.members.filter(needsAction).length;
          const countBadge = s.clubPair.clubOrphaned
            ? `<span class="tab-badge">${escapeHtml(i18n.t("report.clubTab.oneSided.label"))}</span>`
            : missingCount > 0
              ? `<span class="tab-count">${missingCount}</span>`
              : "";
          return `<button class="tab${s.clubKey === activeClubKey ? " tab-active" : ""}" data-club-key="${s.clubKey}" title="${escapeAttr(s.clubName)}">${warningIcon}${escapeHtml(shortenClubName(s.clubName))}${countBadge}</button>`;
        })
        .join("");

      tabsRoot.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeClubKey = btn.dataset.clubKey ?? null;
          renderClubTabs();
          renderActiveClub();
        });
      });
    }

    function renderFilterChips(members: MemberReport[]) {
      const chipsRoot = getRoot("filterChips");
      chipsRoot.innerHTML = filterDefs().map((f) => {
        const count = members.filter((m) => matchesFilter(m, f.key)).length;
        return `<button class="chip${f.key === activeFilter ? " active" : ""}" data-filter="${f.key}">${escapeHtml(f.label)} <span class="chip-count">${count}</span></button>`;
      }).join("");

      chipsRoot.querySelectorAll<HTMLButtonElement>(".chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeFilter = btn.dataset.filter ?? "all";
          renderActiveClub();
        });
      });
    }

    function matchesFilter(member: MemberReport, filterKey: string): boolean {
      if (filterKey === "all") return true;
      if (filterKey === "todo") return needsAction(member);
      return classifyMember(member).includes(filterKey);
    }

    function matchesSearch(member: MemberReport, query: string): boolean {
      if (!query) return true;
      const names = [member.basecampName, member.easyspeakName, member.name];
      if (names.some((n) => n?.toLowerCase().includes(query))) return true;
      return member.paths.some((p) => [p.displayName, p.basecampPathName, p.easyspeakPathLabel].some((n) => n?.toLowerCase().includes(query)));
    }

    function sortName(member: MemberReport): string {
      return member.basecampName ?? member.easyspeakName ?? member.name ?? "(unnamed)";
    }

    function sortRank(member: MemberReport): number {
      if (member.matchConfidence === "fuzzy") return 0;
      if (member.presence !== "both" && member.matchConfidence !== "confirmed") return 1;
      if (member.hasOrphanedPaths) return 2;
      return 3;
    }

    function compareMembers(a: MemberReport, b: MemberReport): number {
      const aRank = sortRank(a);
      const bRank = sortRank(b);
      if (aRank !== bRank) return aRank - bRank;
      const aHasBasecampName = a.basecampName != null;
      const bHasBasecampName = b.basecampName != null;
      if (aHasBasecampName !== bHasBasecampName) return aHasBasecampName ? -1 : 1;
      return sortName(b).localeCompare(sortName(a), undefined, { sensitivity: "base" });
    }

    function findMemberByKey(key: string): MemberReport | null {
      const section = clubSections.find((s) => s.clubKey === activeClubKey);
      return section?.clubPair.members.find((m) => memberKey(m) === key) ?? null;
    }

    function buildCandidatePools(clubPair: ClubPairReport): { easyspeakOnly: Candidate[]; basecampOnly: Candidate[] } {
      const easyspeakOnly = clubPair.members
        .filter((m) => m.presence === "easyspeak-only")
        .map((m) => ({ id: m.easyspeakMemberId!, name: m.easyspeakName ?? m.name }));
      const basecampOnly = clubPair.members
        .filter((m) => m.presence === "basecamp-only")
        .map((m) => ({ id: m.basecampUserId!, name: m.basecampName ?? m.name }));
      return { easyspeakOnly, basecampOnly };
    }

    function getCandidatesForMember(member: MemberReport): Candidate[] {
      const section = clubSections.find((s) => s.clubKey === activeClubKey)!;
      const { easyspeakOnly, basecampOnly } = buildCandidatePools(section.clubPair);
      return member.presence === "basecamp-only" ? easyspeakOnly : basecampOnly;
    }

    function candidateOptionValue(candidate: Candidate): string {
      return `${candidate.name} (#${candidate.id})`;
    }

    function parseCandidateSelection(inputValue: string, candidates: Candidate[]): Candidate | null {
      const match = /\(#(.+)\)\s*$/.exec(inputValue.trim());
      if (!match) return null;
      const id = match[1];
      return candidates.find((c) => String(c.id) === id) ?? null;
    }

    function renderActiveClub() {
      const section = clubSections.find((s) => s.clubKey === activeClubKey);
      const membersRoot = getRoot("membersRoot");
      if (!section) {
        getRoot("filterChips").innerHTML = "";
        membersRoot.innerHTML = "";
        return;
      }

      // An acknowledged one-sided club has no counterpart club to match its
      // members against at all — every member would render permanently
      // "Unmatched" with nothing actionable to do about it, so member
      // review is disabled entirely for it rather than showing a dead table.
      if (section.clubPair.clubOrphaned) {
        getRoot("filterChips").innerHTML = "";
        const side = section.clubPair.basecampClubId ? i18n.t("export.type.basecamp.label") : i18n.t("export.type.easyspeak.label");
        membersRoot.innerHTML = `
          <div role="alert" class="alert alert-info alert-soft mb-4 text-base">
            ${approvedCheckIconHtml(i18n.t("report.conflictWarning.orphanedClub.tooltip"))}
            ${i18n.t("members.emptyState.orphanedClub.sentence", [side])}
          </div>
        `;
        return;
      }

      renderFilterChips(section.clubPair.members);
      membersRoot.innerHTML = renderClubMembers(section.clubPair);
      attachRowHandlers();
    }

    function renderClubMembers(clubPair: ClubPairReport): string {
      const filtered = clubPair.members.filter((m) => matchesFilter(m, activeFilter) && matchesSearch(m, activeSearchQuery));
      const sorted = [...filtered].sort(compareMembers);
      const pools = buildCandidatePools(clubPair);

      if (sorted.length === 0) {
        return `<p class="empty-state">${escapeHtml(i18n.t("members.emptyState.noFilterMatch.body"))}</p>`;
      }

      const rows = sorted.map((member) => renderMemberRows(member, pools)).join("");
      const cards = sorted.map((member) => renderMemberCard(member, pools)).join("");

      // Dual render: a spreadsheet-style <table> on desktop (≥lg), a card list
      // on narrower widths. Both carry the same data-* attributes, so
      // attachRowHandlers()'s querySelectorAll over #membersRoot binds
      // whichever is on screen. onLink()/onLinkInputChange() scope with
      // closest("tr, .member-card") so the search field works in both.
      return `
        <table class="data-table members hidden lg:table">
          <thead>
            <tr>
              <th>${escapeHtml(i18n.t("members.table.basecampName.label"))}</th>
              <th>${escapeHtml(i18n.t("members.table.easyspeakName.label"))}</th>
              <th>${escapeHtml(i18n.t("members.table.memberLink.label"))}</th>
              <th>${escapeHtml(i18n.t("members.table.pathBind.label"))}</th>
              <th>${escapeHtml(i18n.t("members.table.actions.label"))}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="member-cards flex flex-col gap-2 lg:hidden">${cards}</div>
      `;
    }

    function renderMemberCard(member: MemberReport, pools: { easyspeakOnly: Candidate[]; basecampOnly: Candidate[] }): string {
      const key = memberKey(member);
      const clean = !needsAction(member);
      const expanded = hasReviewablePaths(member) && expandedMemberKeys.has(key);
      return `
        <div class="member-card rounded-md border border-base-300 bg-base-100 p-3 flex flex-col gap-1.5${clean ? " opacity-70" : ""}">
          <div class="flex flex-wrap items-center justify-end gap-1.5">
            ${renderLinkStatusCell(member)}
            ${renderPathBindCell(member)}
          </div>
          <div class="text-sm font-semibold">${renderNameCell(member, "basecamp", pools)}</div>
          <div class="text-sm text-tm-gray-600">${renderNameCell(member, "easyspeak", pools)}</div>
          <div class="actions flex flex-wrap justify-end gap-1.5 mt-1">${renderActionsCell(member)}</div>
          ${expanded ? `<div class="mt-1 pt-2 border-t border-base-300" data-row-detail>${renderPathBindDetail(member)}</div>` : ""}
        </div>
      `;
    }

    function hasReviewablePaths(member: MemberReport): boolean {
      return member.presence === "both" && member.paths.some((p) => !p.nonPathway);
    }

    function renderMemberRows(member: MemberReport, pools: { easyspeakOnly: Candidate[]; basecampOnly: Candidate[] }): string {
      const key = memberKey(member);
      const clean = !needsAction(member);

      const mainRow = `
        <tr class="${clean ? "muted-row" : ""}">
          <td>${renderNameCell(member, "basecamp", pools)}</td>
          <td>${renderNameCell(member, "easyspeak", pools)}</td>
          <td>${renderLinkStatusCell(member)}</td>
          <td>${renderPathBindCell(member)}</td>
          <td class="actions">${renderActionsCell(member)}</td>
        </tr>
      `;

      if (!hasReviewablePaths(member)) return mainRow;
      if (!expandedMemberKeys.has(key)) return mainRow;

      const detailRow = `
        <tr class="detail-row">
          <td colspan="5">${renderPathBindDetail(member)}</td>
        </tr>
      `;
      return mainRow + detailRow;
    }

    function renderNameCell(member: MemberReport, side: "basecamp" | "easyspeak", pools: { easyspeakOnly: Candidate[]; basecampOnly: Candidate[] }): string {
      const label = side === "easyspeak" ? i18n.t("export.type.easyspeak.label") : i18n.t("export.type.basecamp.label");
      // Mobile-only prefix (hidden on desktop via CSS) — see styles.css's
      // Member Review mobile card section for why this is real markup
      // rather than a ::before/attr(data-label) pseudo-element like Club
      // Review's own mobile cards use: the interactive-search branch below
      // needs its wrapper split apart via display:contents on mobile, and a
      // pseudo-element on a display:contents box becomes its own unplaced
      // grid item, which a plain text node sidesteps entirely.
      const labelPrefix = `<span class="member-name-label">${label}: </span>`;

      const name = side === "easyspeak" ? member.easyspeakName : member.basecampName;
      if (name) return `<span class="name-header">${labelPrefix}${escapeHtml(name)}</span>`;

      if (member.matchConfidence === "confirmed" && member.matchSource === "orphan") {
        return `<span class="name-header">${labelPrefix}<span class="cell-detail muted-text">${escapeHtml(i18n.t("members.nameCell.noCounterpart.label"))}</span><span class="not-linked-label">${escapeHtml(i18n.t("members.nameCell.notLinked.label"))}</span></span>`;
      }

      const candidates = side === "easyspeak" ? pools.easyspeakOnly : pools.basecampOnly;
      if (candidates.length === 0) {
        return `<span class="name-header">${labelPrefix}<span class="cell-detail muted-text">${escapeHtml(i18n.t("members.nameCell.noCandidates.label"))}</span><span class="not-linked-label">${escapeHtml(i18n.t("members.nameCell.notLinked.label"))}</span></span>`;
      }

      const key = memberKey(member);
      const options = candidates.map((c) => `<option value="${escapeAttr(String(c.id))}">${escapeHtml(c.name)}</option>`).join("");
      const placeholder =
        side === "easyspeak" ? i18n.t("members.nameCell.selectPlaceholderEasyspeak.label") : i18n.t("members.nameCell.selectPlaceholderBasecamp.label");
      return (
        `<span class="name-header">${labelPrefix}<span class="not-linked-label">${escapeHtml(i18n.t("members.nameCell.notLinked.label"))}</span></span>` +
        `<select class="select select-xs link-search appearance-none" data-role="link-input" data-member-key="${key}" aria-label="${escapeAttr(i18n.t("members.nameCell.selectAriaLabel.sentence", [label]))}">` +
        `<option value="" disabled selected>${escapeHtml(placeholder)}</option>` +
        options +
        `</select>`
      );
    }

    function renderLinkStatusCell(member: MemberReport): string {
      if (member.matchConfidence === "confirmed") {
        const sourceLabel =
          member.matchSource === "manual-search"
            ? i18n.t("members.linkStatus.manualSearch.tooltip")
            : member.matchSource === "orphan"
              ? i18n.t("members.linkStatus.orphanSource.tooltip")
              : i18n.t("members.linkStatus.confirmedSuggestion.tooltip");
        return `<span class="badge badge-soft badge-info" title="${escapeAttr(sourceLabel)}">${escapeHtml(i18n.t("members.linkStatus.resolvedManually.label"))}</span>`;
      }
      if (member.presence !== "both")
        return `<span class="badge badge-soft badge-error">${escapeHtml(i18n.t("clubReview.status.unmatched.label"))}</span>`;
      if (member.matchConfidence === "fuzzy") {
        const score = member.matchScore != null ? member.matchScore.toFixed(2) : i18n.t("common.cell.empty.label");
        return `<span class="badge badge-soft badge-warning" title="${escapeAttr(i18n.t("clubReview.status.suggested.matchScore", [score]))}">${escapeHtml(i18n.t("clubReview.status.suggested.label"))}</span>`;
      }
      return `<span class="badge badge-soft badge-success">${escapeHtml(i18n.t("clubReview.status.exact.label"))}</span>`;
    }

    function renderPathBindCell(member: MemberReport): string {
      const bound = member.paths.filter((p) => p.overridden);
      const orphaned = member.paths.filter((p) => p.orphaned);
      const flagged = member.paths.filter((p) => p.flagged);
      const completed = member.paths.filter((p) => p.manuallyCompleted || p.confirmedCompleted);
      if (bound.length > 0 || orphaned.length > 0) {
        const titleParts = [
          ...bound.map((p) => i18n.t("members.pathBindCell.boundPair.sentence", [p.basecampPathName ?? "", p.easyspeakPathLabel ?? ""])),
          ...orphaned.map((p) => i18n.t("members.pathBindCell.markedOrphan.sentence", [p.displayName])),
          ...flagged.map((p) => i18n.t("members.pathBindCell.flaggedReview.sentence", [p.displayName])),
          ...completed.map((p) =>
            p.confirmedCompleted
              ? i18n.t("members.pathBindCell.completedPair.sentence", [p.basecampCompletedName ?? "", p.easyspeakPathLabel ?? ""])
              : i18n.t("members.pathBindCell.completed.sentence", [p.displayName]),
          ),
        ];
        const label = bound.length > 0 && orphaned.length === 0 ? i18n.t("members.pathBindCell.bound.label") : i18n.t("members.pathBindCell.resolved.label");
        return `<span class="badge badge-soft badge-info" title="${escapeAttr(titleParts.join("; "))}">${label}</span>`;
      }
      if (flagged.length > 0) {
        const titleParts = flagged.map((p) => i18n.t("members.pathBindCell.flaggedReview.sentence", [p.displayName]));
        return `<span class="badge badge-soft badge-warning" title="${escapeAttr(titleParts.join("; "))}">${escapeHtml(i18n.t("members.pathBindCell.flagged.label"))}</span>`;
      }
      if (completed.length > 0) {
        const titleParts = completed.map((p) =>
          p.confirmedCompleted
            ? i18n.t("members.pathBindCell.completedPair.sentence", [p.basecampCompletedName ?? "", p.easyspeakPathLabel ?? ""])
            : i18n.t("members.pathBindCell.completed.sentence", [p.displayName]),
        );
        return `<span class="badge badge-soft badge-info" title="${escapeAttr(titleParts.join("; "))}">${escapeHtml(i18n.t("members.pathBindCell.completedBadge.label"))}</span>`;
      }
      if (!member.hasOrphanedPaths) return `<span class="muted-text">${escapeHtml(i18n.t("common.cell.empty.label"))}</span>`;
      return `<span class="badge badge-soft badge-error">${escapeHtml(i18n.t("members.pathBindCell.pathIssue.label"))}</span>`;
    }

    function renderActionsCell(member: MemberReport): string {
      const key = memberKey(member);
      const buttons: string[] = [];

      if (member.presence === "both" && member.matchConfidence === "fuzzy") {
        buttons.push(`<button class="btn btn-primary btn-sm" data-action="confirm" data-member-key="${key}">${escapeHtml(i18n.t("clubReview.action.confirm.button"))}</button>`);
        buttons.push(`<button class="btn btn-secondary btn-sm" data-action="reject" data-member-key="${key}">${escapeHtml(i18n.t("clubReview.action.reject.button"))}</button>`);
      }

      if (member.presence === "both" && member.matchConfidence !== "fuzzy") {
        const title = i18n.t(
          member.matchConfidence === "exact" ? "members.action.unlinkTooltipExact" : "members.action.unlinkTooltipOther",
        );
        buttons.push(`<button class="btn btn-secondary btn-sm" data-action="unlink" data-member-key="${key}" title="${escapeAttr(title)}">${escapeHtml(i18n.t("clubReview.action.unlink.button"))}</button>`);
      }

      if (member.presence !== "both") {
        if (member.matchConfidence === "confirmed" && member.matchSource === "orphan") {
          buttons.push(
            `<button class="btn btn-secondary btn-sm" data-action="unorphan" data-member-key="${key}" title="${escapeAttr(i18n.t("members.action.unmarkOrphanTooltip"))}">${escapeHtml(i18n.t("members.action.unmarkOrphan"))}</button>`,
          );
        } else {
          buttons.push(`<button class="btn btn-primary btn-sm" data-action="link" data-member-key="${key}" disabled>${escapeHtml(i18n.t("members.action.linkSelected"))}</button>`);
          buttons.push(
            `<button class="btn btn-secondary btn-sm" data-action="mark-orphan" data-member-key="${key}" title="${escapeAttr(i18n.t("members.action.markOrphanTooltip"))}">${escapeHtml(i18n.t("members.action.markOrphan"))}</button>`,
          );
        }
      }

      if (hasReviewablePaths(member)) {
        const expanded = expandedMemberKeys.has(key);
        const label = member.hasOrphanedPaths
          ? i18n.t(expanded ? "members.action.hidePathIssue" : "members.action.reviewPathIssue")
          : i18n.t(expanded ? "members.action.hidePaths" : "members.action.reviewPaths");
        const pathIssueAttr = member.hasOrphanedPaths ? ' data-path-issue="true"' : "";
        buttons.push(`<button class="btn btn-secondary btn-sm" data-action="toggle-paths" data-member-key="${key}"${pathIssueAttr}>${escapeHtml(label)}</button>`);
      }

      return buttons.join("") || `<span class="muted-text">${escapeHtml(i18n.t("common.cell.empty.label"))}</span>`;
    }

    function getBcOrphans(member: MemberReport): PathReport[] {
      return member.paths.filter((p) => p.presence === "basecamp-only" && !p.nonPathway && !p.orphaned && !p.flagged);
    }

    function getEsOrphans(member: MemberReport): PathReport[] {
      return member.paths.filter(
        (p) => p.presence === "easyspeak-only" && !p.nonPathway && !p.orphaned && !p.flagged && !p.manuallyCompleted && !p.confirmedCompleted
      );
    }

    function bcOrphanCandidates(member: MemberReport): Candidate[] {
      return getBcOrphans(member).map((p, index) => ({ id: index, name: p.basecampPathName ?? "" }));
    }

    function pathSpeechesDone(path: PathReport): number {
      return path.levels.reduce((sum, level) => sum + (level.easyspeak?.done ?? 0), 0);
    }

    function renderPathBindDetail(member: MemberReport): string {
      const key = memberKey(member);
      const realPaths = member.paths.filter((p) => !p.nonPathway);
      const matchedPaths = realPaths.filter((p) => p.presence === "both");
      const resolvedOrphans = realPaths.filter((p) => p.orphaned);
      const flaggedPaths = realPaths.filter((p) => p.flagged);
      const bcOrphans = getBcOrphans(member);
      const esOrphans = getEsOrphans(member);
      const esConfirmedCompleted = realPaths.filter((p) => p.presence === "easyspeak-only" && !p.orphaned && !p.flagged && p.confirmedCompleted);
      // confirmedCompleted takes priority so a path Basecamp now confirms
      // (even if it was previously manually marked) renders exactly once.
      const esManuallyCompleted = realPaths.filter(
        (p) => p.presence === "easyspeak-only" && !p.orphaned && !p.flagged && p.manuallyCompleted && !p.confirmedCompleted
      );

      const sections: string[] = [];

      if (matchedPaths.length > 0) {
        sections.push(
          matchedPaths
            .map((p) => {
              const statusLabel = p.overridden ? i18n.t("members.pathBind.boundManually.label") : i18n.t("members.pathBind.matchedAutomatically.label");
              const action = p.overridden
                ? `<button class="btn btn-secondary btn-sm" data-action="unbind-path" data-member-key="${key}" data-bc-path="${escapeAttr(p.basecampPathName ?? "")}" data-es-path="${escapeAttr(p.easyspeakPathLabel ?? "")}">${escapeHtml(i18n.t("members.pathBind.unbind.button"))}</button>`
                : `<button class="btn btn-secondary btn-sm" data-action="force-unbind-path" data-member-key="${key}" data-bc-path="${escapeAttr(p.basecampPathName ?? "")}" data-es-path="${escapeAttr(p.easyspeakPathLabel ?? "")}" title="${escapeAttr(i18n.t("members.pathBind.forceUnbind.tooltip"))}">${escapeHtml(i18n.t("members.pathBind.forceUnbind.button"))}</button>`;
              return `
                <div class="path-pair-row">
                  <span><strong>${escapeHtml(p.basecampPathName ?? "")}</strong> &harr; ${escapeHtml(p.easyspeakPathLabel ?? "")}</span>
                  <span class="muted-text">${escapeHtml(statusLabel)}</span>
                  ${action}
                </div>
              `;
            })
            .join("")
        );
      }

      const sideLabelHtml = (side: "basecamp" | "easyspeak") =>
        escapeHtml(i18n.t("members.pathBind.sideLabel.sentence", [side === "basecamp" ? i18n.t("export.type.basecamp.label") : i18n.t("export.type.easyspeak.label")]));

      if (resolvedOrphans.length > 0) {
        sections.push(
          resolvedOrphans
            .map((p) => {
              const side = p.presence === "basecamp-only" ? "basecamp" : "easyspeak";
              const pathName = side === "basecamp" ? (p.basecampPathName ?? "") : (p.easyspeakPathLabel ?? "");
              return `
                <div class="path-pair-row">
                  <span><strong>${sideLabelHtml(side)}</strong> ${escapeHtml(pathName)}</span>
                  <span class="muted-text">${escapeHtml(i18n.t("members.pathBind.resolvedAsOrphan.label"))}</span>
                  <button class="btn btn-secondary btn-sm" data-action="unmark-path-orphan" data-member-key="${key}" data-side="${side}" data-path="${escapeAttr(pathName)}">${escapeHtml(i18n.t("members.pathBind.unmarkOrphanButton.button"))}</button>
                </div>
              `;
            })
            .join("")
        );
      }

      if (flaggedPaths.length > 0) {
        sections.push(
          flaggedPaths
            .map((p) => {
              const side = p.presence === "basecamp-only" ? "basecamp" : "easyspeak";
              const pathName = side === "basecamp" ? (p.basecampPathName ?? "") : (p.easyspeakPathLabel ?? "");
              return `
                <div class="path-pair-row">
                  <span><strong>${sideLabelHtml(side)}</strong> ${escapeHtml(pathName)}</span>
                  <span class="muted-text">${escapeHtml(i18n.t("members.pathBind.flaggedForReview.label"))}</span>
                  <button class="btn btn-secondary btn-sm" data-action="unflag-path" data-member-key="${key}" data-side="${side}" data-path="${escapeAttr(pathName)}">${escapeHtml(i18n.t("members.pathBind.unflag.button"))}</button>
                </div>
              `;
            })
            .join("")
        );
      }

      if (esOrphans.length > 0) {
        const pathDatalistId = `dl-path-${key}`;
        const candidates = bcOrphanCandidates(member);
        const pathDatalist =
          candidates.length > 0
            ? `<datalist id="${pathDatalistId}">${candidates.map((c) => `<option value="${escapeAttr(candidateOptionValue(c))}">`).join("")}</datalist>`
            : "";
        sections.push(
          pathDatalist +
            esOrphans
              .map((esPath, esIndex) => {
                const bindControls =
                  candidates.length > 0
                    ? `<span>&harr;</span>
                     <input type="text" class="input input-xs link-search" list="${pathDatalistId}" data-role="path-bind-input" data-member-key="${key}" placeholder="${escapeAttr(i18n.t("members.pathBind.searchBasecampPaths.placeholder"))}" aria-label="${escapeAttr(i18n.t("members.pathBind.bindAriaLabel.label"))}" autocomplete="off">
                     <button class="btn btn-primary btn-sm" data-action="bind-path" data-member-key="${key}" data-es-index="${esIndex}" disabled>${escapeHtml(i18n.t("members.pathBind.bind.button"))}</button>`
                    : "";
                const done = pathSpeechesDone(esPath);
                return `
                <div class="path-pair-row">
                  <span><strong>${sideLabelHtml("easyspeak")}</strong> ${escapeHtml(esPath.easyspeakPathLabel ?? "")}</span>
                  <span class="muted-text">${escapeHtml(i18n.t("members.pathBind.speechesDone.count", done))}</span>
                  ${bindControls}
                  <button class="btn btn-secondary btn-sm" data-action="mark-path-completed" data-member-key="${key}" data-path="${escapeAttr(esPath.easyspeakPathLabel ?? "")}">${escapeHtml(i18n.t("members.pathBind.markCompleted.button"))}</button>
                  <button class="btn btn-secondary btn-sm" data-action="mark-path-orphan" data-member-key="${key}" data-side="easyspeak" data-path="${escapeAttr(esPath.easyspeakPathLabel ?? "")}">${escapeHtml(i18n.t("members.action.markOrphan"))}</button>
                  <button class="btn btn-secondary btn-sm" data-action="flag-path" data-member-key="${key}" data-side="easyspeak" data-path="${escapeAttr(esPath.easyspeakPathLabel ?? "")}">${escapeHtml(i18n.t("members.pathBind.flagForLater.button"))}</button>
                </div>
              `;
              })
              .join("")
        );
      }

      if (bcOrphans.length > 0) {
        sections.push(
          bcOrphans
            .map(
              (bcPath) => `
                <div class="path-pair-row" title="${escapeAttr(i18n.t("members.pathBind.bcOrphanTooltip"))}">
                  <span><strong>${sideLabelHtml("basecamp")}</strong> ${escapeHtml(bcPath.basecampPathName ?? "")}</span>
                  <span class="muted-text">${escapeHtml(i18n.t("members.pathBind.noCounterpartFound.label"))}</span>
                </div>
              `
            )
            .join("")
        );
      }

      if (esManuallyCompleted.length > 0) {
        sections.push(
          esManuallyCompleted
            .map(
              (esPath) => `
                <div class="path-pair-row">
                  <span><strong>${sideLabelHtml("easyspeak")}</strong> ${escapeHtml(esPath.easyspeakPathLabel ?? "")}</span>
                  <span class="muted-text">${escapeHtml(i18n.t("members.pathBind.completedLabel.label"))}</span>
                  <button class="btn btn-secondary btn-sm" data-action="unmark-path-completed" data-member-key="${key}" data-path="${escapeAttr(esPath.easyspeakPathLabel ?? "")}">${escapeHtml(i18n.t("members.pathBind.unmarkCompleted.button"))}</button>
                </div>
              `
            )
            .join("")
        );
      }

      if (esConfirmedCompleted.length > 0) {
        sections.push(
          esConfirmedCompleted
            .map(
              (esPath) => `
                <div class="path-pair-row" title="${escapeAttr(i18n.t("members.pathBind.confirmedByBasecampTooltip"))}">
                  <span><strong>${escapeHtml(esPath.basecampCompletedName ?? "")}</strong> &harr; ${escapeHtml(esPath.easyspeakPathLabel ?? "")}</span>
                  <span class="muted-text">${escapeHtml(i18n.t("members.pathBind.completedConfirmedByBasecamp.label"))}</span>
                </div>
              `
            )
            .join("")
        );
      }

      if (sections.length === 0) {
        return `<p class="muted-text">${escapeHtml(i18n.t("members.emptyState.noPathsToReview.body"))}</p>`;
      }

      const helpText = `<p class="help-text">${escapeHtml(i18n.t("members.pathBind.help.body"))}</p>`;
      return helpText + sections.join("");
    }

    function attachRowHandlers() {
      const membersRoot = getRoot("membersRoot");

      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="confirm"]').forEach((btn) => {
        btn.addEventListener("click", () => onConfirm(btn.dataset.memberKey!));
      });
      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="reject"]').forEach((btn) => {
        btn.addEventListener("click", () => onReject(btn.dataset.memberKey!));
      });
      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="unlink"]').forEach((btn) => {
        btn.addEventListener("click", () => onUnlink(btn.dataset.memberKey!));
      });
      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="mark-orphan"]').forEach((btn) => {
        btn.addEventListener("click", () => onMarkOrphan(btn.dataset.memberKey!));
      });
      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="unorphan"]').forEach((btn) => {
        btn.addEventListener("click", () => onUnmarkOrphan(btn.dataset.memberKey!));
      });
      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="toggle-paths"]').forEach((btn) => {
        btn.addEventListener("click", () => onTogglePaths(btn.dataset.memberKey!));
      });
      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="bind-path"]').forEach((btn) => {
        btn.addEventListener("click", () => onBindPath(btn));
      });
      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="mark-path-orphan"]').forEach((btn) => {
        btn.addEventListener("click", () => onMarkPathOrphan(btn));
      });
      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="unmark-path-orphan"]').forEach((btn) => {
        btn.addEventListener("click", () => onUnmarkPathOrphan(btn));
      });
      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="flag-path"]').forEach((btn) => {
        btn.addEventListener("click", () => onFlagPath(btn));
      });
      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="unflag-path"]').forEach((btn) => {
        btn.addEventListener("click", () => onUnflagPath(btn));
      });
      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="mark-path-completed"]').forEach((btn) => {
        btn.addEventListener("click", () => onMarkPathCompleted(btn));
      });
      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="unmark-path-completed"]').forEach((btn) => {
        btn.addEventListener("click", () => onUnmarkPathCompleted(btn));
      });
      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="unbind-path"]').forEach((btn) => {
        btn.addEventListener("click", () => onUnbindPath(btn));
      });
      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="force-unbind-path"]').forEach((btn) => {
        btn.addEventListener("click", () => onForceUnbindPath(btn));
      });
      membersRoot.querySelectorAll<HTMLSelectElement>('[data-role="link-input"]').forEach((select) => {
        select.addEventListener("change", () => onLinkInputChange(select));
      });
      membersRoot.querySelectorAll<HTMLButtonElement>('[data-action="link"]').forEach((btn) => {
        btn.addEventListener("click", () => onLink(btn));
      });
      membersRoot.querySelectorAll<HTMLInputElement>('[data-role="path-bind-input"]').forEach((input) => {
        input.addEventListener("input", () => onPathBindInputChange(input));
      });
    }

    async function onConfirm(key: string) {
      const member = findMemberByKey(key);
      if (!member) return;
      await confirmMemberLink(member.basecampUserId!, member.easyspeakMemberId!, "fuzzy-confirmed");
      await refresh();
    }

    async function onReject(key: string) {
      const member = findMemberByKey(key);
      if (!member) return;
      await rejectMemberPair(member.basecampUserId!, member.easyspeakMemberId!);
      await refresh();
    }

    async function onUnlink(key: string) {
      const member = findMemberByKey(key);
      if (!member) return;
      if (member.matchConfidence === "exact") {
        await rejectMemberPair(member.basecampUserId!, member.easyspeakMemberId!);
      } else {
        await unlinkMember(member.basecampUserId!, member.easyspeakMemberId!);
      }
      await refresh();
    }

    async function onMarkOrphan(key: string) {
      const member = findMemberByKey(key);
      if (!member) return;
      await markMemberOrphan(member.basecampUserId, member.easyspeakMemberId);
      await refresh();
    }

    async function onUnmarkOrphan(key: string) {
      const member = findMemberByKey(key);
      if (!member) return;
      await unmarkMemberOrphan(member.basecampUserId, member.easyspeakMemberId);
      await refresh();
    }

    function onTogglePaths(key: string) {
      if (expandedMemberKeys.has(key)) expandedMemberKeys.delete(key);
      else expandedMemberKeys.add(key);
      renderActiveClub();
    }

    async function onBindPath(btn: HTMLButtonElement) {
      const key = btn.dataset.memberKey!;
      const esIndex = Number(btn.dataset.esIndex);
      const member = findMemberByKey(key);
      if (!member) return;

      const bcOrphans = getBcOrphans(member);
      const esOrphans = getEsOrphans(member);
      const esPath = esOrphans[esIndex];
      const input = btn.closest(".path-pair-row")!.querySelector<HTMLInputElement>('[data-role="path-bind-input"]')!;
      const match = parseCandidateSelection(input.value, bcOrphanCandidates(member));
      const bcPath = match ? bcOrphans[Number(match.id)] : undefined;
      if (!bcPath || !esPath) return;

      await setMemberPathOverride(member.basecampUserId!, member.easyspeakMemberId!, bcPath.basecampPathName!, esPath.easyspeakPathLabel!);
      expandedMemberKeys.delete(key);
      await refresh();
    }

    function onPathBindInputChange(input: HTMLInputElement) {
      const member = findMemberByKey(input.dataset.memberKey!);
      const row = input.closest(".path-pair-row")!;
      const bindBtn = row.querySelector<HTMLButtonElement>('[data-action="bind-path"]');
      if (!member || !bindBtn) return;
      bindBtn.disabled = !parseCandidateSelection(input.value, bcOrphanCandidates(member));
    }

    async function onMarkPathOrphan(btn: HTMLButtonElement) {
      const member = findMemberByKey(btn.dataset.memberKey!);
      if (!member) return;
      const side = btn.dataset.side as "basecamp" | "easyspeak";
      const path = btn.dataset.path!;
      await markPathOrphan(member.basecampUserId!, member.easyspeakMemberId!, side === "basecamp" ? path : null, side === "easyspeak" ? path : null);
      await refresh();
    }

    async function onUnmarkPathOrphan(btn: HTMLButtonElement) {
      const member = findMemberByKey(btn.dataset.memberKey!);
      if (!member) return;
      const side = btn.dataset.side as "basecamp" | "easyspeak";
      const path = btn.dataset.path!;
      await unmarkPathOrphan(member.basecampUserId!, member.easyspeakMemberId!, side === "basecamp" ? path : null, side === "easyspeak" ? path : null);
      await refresh();
    }

    async function onFlagPath(btn: HTMLButtonElement) {
      const member = findMemberByKey(btn.dataset.memberKey!);
      if (!member) return;
      const side = btn.dataset.side as "basecamp" | "easyspeak";
      const path = btn.dataset.path!;
      await flagPath(member.basecampUserId!, member.easyspeakMemberId!, side === "basecamp" ? path : null, side === "easyspeak" ? path : null);
      await refresh();
    }

    async function onUnflagPath(btn: HTMLButtonElement) {
      const member = findMemberByKey(btn.dataset.memberKey!);
      if (!member) return;
      const side = btn.dataset.side as "basecamp" | "easyspeak";
      const path = btn.dataset.path!;
      await unflagPath(member.basecampUserId!, member.easyspeakMemberId!, side === "basecamp" ? path : null, side === "easyspeak" ? path : null);
      await refresh();
    }

    async function onMarkPathCompleted(btn: HTMLButtonElement) {
      const member = findMemberByKey(btn.dataset.memberKey!);
      if (!member) return;
      await markPathCompleted(member.basecampUserId!, member.easyspeakMemberId!, btn.dataset.path!);
      await refresh();
    }

    async function onUnmarkPathCompleted(btn: HTMLButtonElement) {
      const member = findMemberByKey(btn.dataset.memberKey!);
      if (!member) return;
      await unmarkPathCompleted(member.basecampUserId!, member.easyspeakMemberId!, btn.dataset.path!);
      await refresh();
    }

    async function onUnbindPath(btn: HTMLButtonElement) {
      const member = findMemberByKey(btn.dataset.memberKey!);
      if (!member) return;
      await removeMemberPathOverride(member.basecampUserId!, member.easyspeakMemberId!, btn.dataset.bcPath!, btn.dataset.esPath!);
      await refresh();
    }

    async function onForceUnbindPath(btn: HTMLButtonElement) {
      const member = findMemberByKey(btn.dataset.memberKey!);
      if (!member) return;
      await excludePathMatch(member.basecampUserId!, member.easyspeakMemberId!, btn.dataset.bcPath!, btn.dataset.esPath!);
      await refresh();
    }

    function onLinkInputChange(select: HTMLSelectElement) {
      const member = findMemberByKey(select.dataset.memberKey!);
      const row = select.closest("tr, .member-card")!;
      const linkBtn = row.querySelector<HTMLButtonElement>('[data-action="link"]');
      if (!member || !linkBtn) return;
      linkBtn.disabled = !select.value;
    }

    async function onLink(btn: HTMLButtonElement) {
      const member = findMemberByKey(btn.dataset.memberKey!);
      if (!member) return;
      const row = btn.closest("tr, .member-card")!;
      const select = row.querySelector<HTMLSelectElement>('[data-role="link-input"]')!;
      const candidates = getCandidatesForMember(member);
      const match = candidates.find((c) => String(c.id) === select.value);
      if (!match) return;

      const basecampUserId = member.presence === "basecamp-only" ? member.basecampUserId! : (match.id as number);
      const easyspeakMemberId = member.presence === "easyspeak-only" ? member.easyspeakMemberId! : String(match.id);
      await confirmMemberLink(basecampUserId, easyspeakMemberId, "manual-search");
      await refresh();
    }

    function formatDate(timestamp: number | undefined): string {
      return timestamp ? new Date(timestamp).toLocaleString() : i18n.t("syncData.panel.date.never.label");
    }

    root.querySelector("#memberSearch")!.addEventListener("input", (e) => {
      activeSearchQuery = (e.target as HTMLInputElement).value.trim().toLowerCase();
      renderActiveClub();
    });

    // Must call init(), not refresh(): basecampData/easyspeakData are only
    // cached into module state inside init(), and refresh() alone would
    // keep rendering against a stale snapshot forever.
    const onStorageChanged = (_changes: unknown, area: string) => {
      if (area === "local") init();
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    await init();

    return () => {
      disposed = true;
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  },
};
