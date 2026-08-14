// src/entrypoints/members/main.ts
//
// DOM glue for the member-matching workflow: loads basecampData/easyspeakData
// straight from browser.storage.local (same as report — no live scraping
// happens here), combines it with the persisted resolution decisions from
// shared/resolution-store.ts, and renders one spreadsheet-style table per
// club. Every write action (confirm/reject/link/bind) persists immediately
// via shared/resolution-store.ts, then calls refresh(), which re-reads
// storage and rebuilds the whole report — simplest and most robust way to
// keep the table consistent with match-recompute side effects (e.g.
// rejecting a suggestion frees up its other-side member into its own
// separate "unmatched" row), matching the rest of this codebase's
// rebuild-and-reassign-innerHTML rendering style.

import { escapeAttr, escapeHtml, warningIconHtml } from "../../shared/dom-utils";
import { local } from "../../shared/storage";
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
} from "../../shared/resolution-store";
import { buildReport, classifyMember, memberKey, needsAction } from "../../shared/sync/delta";
import { renderAppShell, renderStepFooter } from "../../shared/app-shell";
import { computeStepperInfo, markStepVisited } from "../../shared/stepper-info";
import type { BasecampScrape, ClubPairReport, EasySpeakScrape, MemberReport, PathReport } from "../../shared/types";

interface FilterDef {
  key: string;
  label: string;
}

const FILTERS: FilterDef[] = [
  { key: "todo", label: "To do" },
  { key: "flagged", label: "Flagged" },
  { key: "resolved-manually", label: "Resolved manually" },
  { key: "all", label: "All" },
];

let basecampData: BasecampScrape | null = null;
let easyspeakData: EasySpeakScrape | null = null;
let basecampScrapedAt: number | undefined;
let easyspeakScrapedAt: number | undefined;

interface ClubSection {
  clubKey: string;
  clubName: string;
  clubPair: ClubPairReport;
}

let clubSections: ClubSection[] = [];
let activeClubKey: string | null = null;
let activeFilter = "todo";

// Persists across refresh() calls (but not page reloads) so expanding a
// path-issue row survives an unrelated action elsewhere in the table.
const expandedMemberKeys = new Set<string>();

init();

// Keeps this tab in sync if data is re-extracted or resolution decisions are
// edited from another tab (e.g. Club Review) while this one stays open — must
// call init(), not refresh(): basecampData/easyspeakData are only cached
// into module state inside init(), and refresh() alone would keep rendering
// against that stale snapshot forever.
browser.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") init();
});

async function init() {
  await markStepVisited("members");
  const stepperInfo = await computeStepperInfo();
  document.getElementById("appShell")!.innerHTML = renderAppShell({ active: "members", info: stepperInfo });
  document.getElementById("stepFooter")!.innerHTML = renderStepFooter("members", stepperInfo);

  const cached = await local.get(["basecampData", "basecampScrapedAt", "easyspeakData", "easyspeakScrapedAt"]);

  if (!cached.basecampData || !cached.easyspeakData) {
    document.getElementById("conflictWarning")!.innerHTML = "";
    document.getElementById("clubTabs")!.innerHTML = "";
    document.getElementById("filterChips")!.innerHTML = "";
    document.getElementById("membersRoot")!.innerHTML =
      '<p class="empty-state">Both Basecamp and EasySpeak data are needed to review matches. ' +
      "Click the extension's toolbar icon and run both extractions first.</p>";
    return;
  }

  basecampData = cached.basecampData;
  easyspeakData = cached.easyspeakData;
  basecampScrapedAt = cached.basecampScrapedAt;
  easyspeakScrapedAt = cached.easyspeakScrapedAt;

  document.getElementById("pageMeta")!.textContent =
    `Basecamp last extracted: ${formatDate(basecampScrapedAt)} — ` + `EasySpeak last extracted: ${formatDate(easyspeakScrapedAt)}`;

  await refresh();
}

async function refresh() {
  const resolution = await loadResolutionData();
  const report = buildReport(basecampData!, easyspeakData!, { basecampScrapedAt, easyspeakScrapedAt }, resolution);

  clubSections = report.clubPairs.map((clubPair, index) => ({
    clubKey: `club-${index}`,
    clubName: clubPair.basecampClubName ?? clubPair.easyspeakClubName ?? "(unnamed club)",
    clubPair,
  }));

  if (!clubSections.some((s) => s.clubKey === activeClubKey)) {
    activeClubKey = clubSections[0]?.clubKey ?? null;
  }

  renderClubMatchWarning();
  renderClubTabs();
  renderActiveClub();
}

// ---------------------------------------------------------------------------
// Club-match warning: a club with no counterpart at all in the other system
// can't be member-matched properly (there's nothing on the other side to
// match against), so this points the user at Club Review before they spend
// time reviewing members in a club that isn't even paired up yet.
// ---------------------------------------------------------------------------

function renderClubMatchWarning() {
  const root = document.getElementById("conflictWarning")!;
  const unmatchedClubs = clubSections.filter((s) => !s.clubPair.basecampClubId || !s.clubPair.easyspeakClubId);

  if (unmatchedClubs.length === 0) {
    root.innerHTML = "";
    return;
  }

  root.innerHTML = `
    <div class="conflict-warning">
      ${warningIconHtml("Unmatched club")}
      ${unmatchedClubs.length} club${unmatchedClubs.length === 1 ? "" : "s"} (${unmatchedClubs
        .map((s) => escapeHtml(s.clubName))
        .join(", ")}) ${unmatchedClubs.length === 1 ? "has" : "have"} no match between Basecamp and
      EasySpeak. Member matching can't work properly for a club until its name is resolved —
      it's best to <a href="club-review.html">fix club matches in Club Review</a> first.
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Club tabs / filter chips
// ---------------------------------------------------------------------------

function renderClubTabs() {
  const tabsRoot = document.getElementById("clubTabs")!;

  if (clubSections.length === 0) {
    document.getElementById("conflictWarning")!.innerHTML = "";
    tabsRoot.innerHTML = "";
    document.getElementById("membersRoot")!.innerHTML = '<p class="empty-state">No clubs found in either data source.</p>';
    return;
  }

  tabsRoot.innerHTML = clubSections
    .map((s) => {
      const unmatchedClub = !s.clubPair.basecampClubId || !s.clubPair.easyspeakClubId;
      const warningIcon = unmatchedClub ? warningIconHtml("No match found between Basecamp and EasySpeak for this club") : "";
      // Only badge a club that actually needs attention — a fully-resolved
      // club showing a "0" badge would just be visual noise.
      const missingCount = s.clubPair.members.filter(needsAction).length;
      const countBadge = missingCount > 0 ? `<span class="tab-count">${missingCount}</span>` : "";
      return `<button class="tab-btn${s.clubKey === activeClubKey ? " active" : ""}" data-club-key="${s.clubKey}">${warningIcon}${escapeHtml(s.clubName)}${countBadge}</button>`;
    })
    .join("");

  tabsRoot.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeClubKey = btn.dataset.clubKey ?? null;
      renderClubTabs();
      renderActiveClub();
    });
  });
}

// Counts are scoped to the currently active club (same as the table itself)
// — switching clubs re-renders these via renderActiveClub().
function renderFilterChips(members: MemberReport[]) {
  const root = document.getElementById("filterChips")!;
  root.innerHTML = FILTERS.map((f) => {
    const count = members.filter((m) => matchesFilter(m, f.key)).length;
    return `<button class="chip${f.key === activeFilter ? " active" : ""}" data-filter="${f.key}">${escapeHtml(f.label)} <span class="chip-count">${count}</span></button>`;
  }).join("");

  root.querySelectorAll<HTMLButtonElement>(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter ?? "all";
      renderActiveClub();
    });
  });
}

// ---------------------------------------------------------------------------
// Classification / sorting
// ---------------------------------------------------------------------------

// Not mutually exclusive — a member can carry more than one tag at once
// (e.g. a manually-confirmed link that still has an unresolved path issue
// shows under both "Path issues" and "Resolved manually", so each chip gives
// an accurate view of everything that still needs — or already got — a
// fix). There's no tag at all for a plain automatic match with nothing to
// flag; "All" is how you see those.
//
function matchesFilter(member: MemberReport, filterKey: string): boolean {
  if (filterKey === "all") return true;
  if (filterKey === "todo") return needsAction(member);
  return classifyMember(member).includes(filterKey);
}

// Basecamp is the source of truth, so it's the primary sort key — falling
// back to the EasySpeak name only for an easyspeak-only member with no
// Basecamp counterpart to sort by.
function sortName(member: MemberReport): string {
  return member.basecampName ?? member.easyspeakName ?? member.name ?? "(unnamed)";
}

// Ranks a member by how urgent/easy its outstanding action is, cheapest
// first: a suggestion just needs a Confirm click, an unmatched member needs
// a manual search, and an unmatched path needs the most involved review —
// everything already resolved (or with nothing to flag) sinks to the
// bottom. Mirrors classifyMember()'s own tag precedence.
function sortRank(member: MemberReport): number {
  if (member.matchConfidence === "fuzzy") return 0;
  if (member.presence !== "both" && member.matchConfidence !== "confirmed") return 1;
  if (member.hasOrphanedPaths) return 2;
  return 3;
}

// Each rank group above is sorted independently, by Basecamp name
// descending (falling back to the EasySpeak name for an easyspeak-only
// member — see sortName()).
function compareMembers(a: MemberReport, b: MemberReport): number {
  const aRank = sortRank(a);
  const bRank = sortRank(b);
  if (aRank !== bRank) return aRank - bRank;
  return sortName(b).localeCompare(sortName(a), undefined, { sensitivity: "base" });
}

function findMemberByKey(key: string): MemberReport | null {
  const section = clubSections.find((s) => s.clubKey === activeClubKey);
  return section?.clubPair.members.find((m) => memberKey(m) === key) ?? null;
}

// ---------------------------------------------------------------------------
// Candidate pools for the type-ahead search (manual link / re-link)
// ---------------------------------------------------------------------------

interface Candidate {
  id: string | number;
  name: string;
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

// A <datalist> option's value is plain text, so the candidate's id is
// embedded as a "(#id)" suffix to disambiguate same-named candidates and to
// resolve a typed/selected value back to an id without a second lookup UI.
function candidateOptionValue(candidate: Candidate): string {
  return `${candidate.name} (#${candidate.id})`;
}

function parseCandidateSelection(inputValue: string, candidates: Candidate[]): Candidate | null {
  const match = /\(#(.+)\)\s*$/.exec(inputValue.trim());
  if (!match) return null;
  const id = match[1];
  return candidates.find((c) => String(c.id) === id) ?? null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderActiveClub() {
  const section = clubSections.find((s) => s.clubKey === activeClubKey);
  const root = document.getElementById("membersRoot")!;
  if (!section) {
    document.getElementById("filterChips")!.innerHTML = "";
    root.innerHTML = "";
    return;
  }
  renderFilterChips(section.clubPair.members);
  root.innerHTML = renderClubMembers(section.clubPair);
  attachRowHandlers();
}

function renderClubMembers(clubPair: ClubPairReport): string {
  const matchNote = buildClubMatchNote(clubPair);
  const filtered = clubPair.members.filter((m) => matchesFilter(m, activeFilter));
  const sorted = [...filtered].sort(compareMembers);
  const pools = buildCandidatePools(clubPair);

  if (sorted.length === 0) {
    return `<div class="club-summary">${matchNote}</div><p class="empty-state">No members match this filter.</p>`;
  }

  const datalists = `
    <datalist id="dl-es-${activeClubKey}">
      ${pools.easyspeakOnly.map((c) => `<option value="${escapeAttr(candidateOptionValue(c))}">`).join("")}
    </datalist>
    <datalist id="dl-bc-${activeClubKey}">
      ${pools.basecampOnly.map((c) => `<option value="${escapeAttr(candidateOptionValue(c))}">`).join("")}
    </datalist>
  `;

  const rows = sorted.map((member) => renderMemberRows(member, pools)).join("");

  return `
    <div class="club-summary">${matchNote}</div>
    ${datalists}
    <table class="table members">
      <thead>
        <tr>
          <th>Basecamp name</th>
          <th>EasySpeak name</th>
          <th>Member link</th>
          <th>Path bind</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildClubMatchNote(clubPair: ClubPairReport): string {
  const { basecampClubName, easyspeakClubName, matchScore, clubMatchForced, members } = clubPair;
  let note: string;
  if (basecampClubName && easyspeakClubName) {
    const scoreText = clubMatchForced ? "pinned in Setup" : `match ${Math.round((matchScore ?? 0) * 100)}%`;
    note = `${escapeHtml(basecampClubName)} / ${escapeHtml(easyspeakClubName)} — ${scoreText}`;
  } else if (basecampClubName) {
    note = `${escapeHtml(basecampClubName)} (no EasySpeak counterpart found)`;
  } else {
    note = `${escapeHtml(easyspeakClubName ?? "")} (no Basecamp counterpart found)`;
  }
  const todo = members.filter(needsAction).length;
  return `${note} · ${members.length} member(s), ${todo} need review`;
}

// A member is worth expanding for path review whenever it's actually
// linked and has at least one real (non-nonPathway) Pathways path to show
// — covers orphaned paths needing a bind, manually-bound paths that can be
// unbound, and automatically-matched paths that can be force-unbound.
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

  // Only emit the detail <tr> when actually expanded (renderActiveClub()
  // does a full re-render on every toggle, see onTogglePaths()) — an
  // always-present-but-hidden sibling row would throw off .table tbody
  // tr:nth-child(2n)'s zebra striping (shared/styles.css) for every row
  // after it.
  if (!expandedMemberKeys.has(key)) return mainRow;

  const detailRow = `
    <tr class="detail-row">
      <td colspan="5">${renderPathBindDetail(member)}</td>
    </tr>
  `;
  return mainRow + detailRow;
}

function renderNameCell(member: MemberReport, side: "basecamp" | "easyspeak", pools: { easyspeakOnly: Candidate[]; basecampOnly: Candidate[] }): string {
  const name = side === "easyspeak" ? member.easyspeakName : member.basecampName;
  if (name) return escapeHtml(name);

  if (member.matchConfidence === "confirmed" && member.matchSource === "orphan") {
    return '<span class="muted-text">No counterpart (resolved)</span>';
  }

  const candidates = side === "easyspeak" ? pools.easyspeakOnly : pools.basecampOnly;
  if (candidates.length === 0) return '<span class="muted-text">No unmatched candidates</span>';

  const datalistId = side === "easyspeak" ? `dl-es-${activeClubKey}` : `dl-bc-${activeClubKey}`;
  const key = memberKey(member);
  const label = side === "easyspeak" ? "EasySpeak" : "Basecamp";
  return `<input type="text" class="link-search" list="${datalistId}" data-role="link-input" data-member-key="${key}" placeholder="Search ${label} members…" aria-label="Search ${label} members to link" autocomplete="off">`;
}

function renderLinkStatusCell(member: MemberReport): string {
  // Checked before the presence check below so an orphan-resolved one-sided
  // member (matchConfidence "confirmed", no real counterpart) shows as
  // resolved rather than falling into the "Unmatched" branch.
  if (member.matchConfidence === "confirmed") {
    const sourceLabel =
      member.matchSource === "manual-search"
        ? "linked via manual search"
        : member.matchSource === "orphan"
          ? "marked as having no counterpart"
          : "confirmed from a suggested match";
    return `<span class="badge badge-confirmed" title="${escapeAttr(sourceLabel)}">Resolved manually</span>`;
  }
  if (member.presence !== "both") return '<span class="badge badge-unmatched">Unmatched</span>';
  if (member.matchConfidence === "fuzzy") {
    const score = member.matchScore != null ? member.matchScore.toFixed(2) : "—";
    return `<span class="badge badge-fuzzy" title="match score: ${score}">Suggested</span>`;
  }
  return '<span class="badge badge-exact">Exact</span>';
}

function renderPathBindCell(member: MemberReport): string {
  const bound = member.paths.filter((p) => p.overridden);
  const orphaned = member.paths.filter((p) => p.orphaned);
  const flagged = member.paths.filter((p) => p.flagged);
  const completed = member.paths.filter((p) => p.manuallyCompleted);
  if (bound.length > 0 || orphaned.length > 0) {
    const titleParts = [
      ...bound.map((p) => `${p.basecampPathName} ↔ ${p.easyspeakPathLabel}`),
      ...orphaned.map((p) => `${p.displayName} (marked as orphan)`),
      ...flagged.map((p) => `${p.displayName} (flagged for later review)`),
      ...completed.map((p) => `${p.displayName} (completed)`),
    ];
    const label = bound.length > 0 && orphaned.length === 0 ? "Bound" : "Resolved";
    return `<span class="badge badge-confirmed" title="${escapeAttr(titleParts.join("; "))}">${label}</span>`;
  }
  if (flagged.length > 0) {
    const titleParts = flagged.map((p) => `${p.displayName} (flagged for later review)`);
    return `<span class="badge badge-flagged" title="${escapeAttr(titleParts.join("; "))}">Flagged</span>`;
  }
  if (completed.length > 0) {
    const titleParts = completed.map((p) => `${p.displayName} (completed)`);
    return `<span class="badge badge-confirmed" title="${escapeAttr(titleParts.join("; "))}">Completed</span>`;
  }
  if (!member.hasOrphanedPaths) return '<span class="muted-text">—</span>';
  return '<span class="badge badge-path-issue">Path issue</span>';
}

function renderActionsCell(member: MemberReport): string {
  const key = memberKey(member);
  const buttons: string[] = [];

  if (member.presence === "both" && member.matchConfidence === "fuzzy") {
    buttons.push(`<button data-action="confirm" data-member-key="${key}">Confirm</button>`);
    buttons.push(`<button class="secondary" data-action="reject" data-member-key="${key}">Not this one</button>`);
  }

  if (member.presence === "both" && member.matchConfidence !== "fuzzy") {
    // "Unlink" always frees the pairing to be re-matched/re-linked, but
    // what that means differs by how the link was made: a confirmed link
    // is just a stored decision to delete, while an exact match is derived
    // fresh every time and has nothing to delete — so unlinking it instead
    // records a rejection, forcing it out of auto-matching so it stays
    // unmatched (and thus re-resolvable) rather than snapping right back.
    const title =
      member.matchConfidence === "exact"
        ? "Excludes this pairing so it won't auto-match again, and marks both members as unmatched so you can find the correct match manually."
        : "Removes this confirmed link so the pairing can be re-matched or re-linked.";
    buttons.push(`<button class="secondary" data-action="unlink" data-member-key="${key}" title="${escapeAttr(title)}">Unlink</button>`);
  }

  if (member.presence !== "both") {
    if (member.matchConfidence === "confirmed" && member.matchSource === "orphan") {
      buttons.push(
        `<button class="secondary" data-action="unorphan" data-member-key="${key}" title="Returns this member to Unmatched so it can be linked or re-resolved.">Unmark orphan</button>`
      );
    } else {
      buttons.push(`<button data-action="link" data-member-key="${key}" disabled>Link</button>`);
      buttons.push(
        `<button class="secondary" data-action="mark-orphan" data-member-key="${key}" title="Marks this as having no counterpart in the other system, so it stops showing as needing review.">Mark as orphan</button>`
      );
    }
  }

  if (hasReviewablePaths(member)) {
    const expanded = expandedMemberKeys.has(key);
    const label = member.hasOrphanedPaths ? (expanded ? "Hide path issue" : "Review path issue") : expanded ? "Hide paths" : "Review paths";
    buttons.push(`<button class="secondary" data-action="toggle-paths" data-member-key="${key}">${label}</button>`);
  }

  return buttons.join("") || '<span class="muted-text">—</span>';
}

// Shared by renderPathBindDetail(), onBindPath(), and onPathBindInputChange()
// so all three agree on exactly which paths are bindable — completedHistory
// and manuallyCompleted EasySpeak-only paths are excluded from esOrphans
// entirely: Basecamp's live extraction never returns a completed path, so
// there's genuinely nothing to bind it to, and offering it as a bind
// candidate is exactly what invites a wrong pairing against an unrelated
// active path. They get their own read-only/actionable sections instead.
function getBcOrphans(member: MemberReport): PathReport[] {
  return member.paths.filter((p) => p.presence === "basecamp-only" && !p.nonPathway && !p.orphaned && !p.flagged);
}

function getEsOrphans(member: MemberReport): PathReport[] {
  return member.paths.filter(
    (p) => p.presence === "easyspeak-only" && !p.nonPathway && !p.orphaned && !p.flagged && !p.completedHistory && !p.manuallyCompleted
  );
}

// The bind picker's candidate pool, id-keyed by position in getBcOrphans()'s
// result — same "(#id)" type-ahead convention as candidateOptionValue()/
// parseCandidateSelection() use for member-name linking. The picker itself
// lives on the EasySpeak-only rows (Basecamp is the source of truth, so an
// EasySpeak path is what gets bound to a Basecamp one, not the reverse).
function bcOrphanCandidates(member: MemberReport): Candidate[] {
  return getBcOrphans(member).map((p, index) => ({ id: index, name: p.basecampPathName ?? "" }));
}

function renderPathBindDetail(member: MemberReport): string {
  const key = memberKey(member);
  const realPaths = member.paths.filter((p) => !p.nonPathway);
  const matchedPaths = realPaths.filter((p) => p.presence === "both");
  const resolvedOrphans = realPaths.filter((p) => p.orphaned);
  const flaggedPaths = realPaths.filter((p) => p.flagged);
  const bcOrphans = getBcOrphans(member);
  const esOrphans = getEsOrphans(member);
  const esCompletedHistory = realPaths.filter((p) => p.presence === "easyspeak-only" && !p.orphaned && p.completedHistory);
  const esManuallyCompleted = realPaths.filter((p) => p.presence === "easyspeak-only" && !p.orphaned && !p.flagged && p.manuallyCompleted);

  const sections: string[] = [];

  if (matchedPaths.length > 0) {
    sections.push(
      matchedPaths
        .map((p) => {
          const statusLabel = p.overridden ? "Bound manually" : "Matched automatically";
          const action = p.overridden
            ? `<button class="secondary" data-action="unbind-path" data-member-key="${key}" data-bc-path="${escapeAttr(p.basecampPathName ?? "")}" data-es-path="${escapeAttr(p.easyspeakPathLabel ?? "")}">Unbind</button>`
            : `<button class="secondary" data-action="force-unbind-path" data-member-key="${key}" data-bc-path="${escapeAttr(p.basecampPathName ?? "")}" data-es-path="${escapeAttr(p.easyspeakPathLabel ?? "")}" title="Splits this pair back into two unmatched paths so you can bind it differently or leave it as an orphan.">Force unbind</button>`;
          return `
            <div class="path-pair-row">
              <span><strong>${escapeHtml(p.basecampPathName ?? "")}</strong> &harr; ${escapeHtml(p.easyspeakPathLabel ?? "")}</span>
              <span class="muted-text">${statusLabel}</span>
              ${action}
            </div>
          `;
        })
        .join("")
    );
  }

  if (resolvedOrphans.length > 0) {
    sections.push(
      resolvedOrphans
        .map((p) => {
          const side = p.presence === "basecamp-only" ? "basecamp" : "easyspeak";
          const sideLabel = side === "basecamp" ? "Basecamp" : "EasySpeak";
          const pathName = side === "basecamp" ? (p.basecampPathName ?? "") : (p.easyspeakPathLabel ?? "");
          return `
            <div class="path-pair-row">
              <span><strong>${sideLabel}:</strong> ${escapeHtml(pathName)}</span>
              <span class="muted-text">Resolved as orphan</span>
              <button class="secondary" data-action="unmark-path-orphan" data-member-key="${key}" data-side="${side}" data-path="${escapeAttr(pathName)}">Unmark orphan</button>
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
          const sideLabel = side === "basecamp" ? "Basecamp" : "EasySpeak";
          const pathName = side === "basecamp" ? (p.basecampPathName ?? "") : (p.easyspeakPathLabel ?? "");
          return `
            <div class="path-pair-row">
              <span><strong>${sideLabel}:</strong> ${escapeHtml(pathName)}</span>
              <span class="muted-text">Flagged for later review</span>
              <button class="secondary" data-action="unflag-path" data-member-key="${key}" data-side="${side}" data-path="${escapeAttr(pathName)}">Unflag</button>
            </div>
          `;
        })
        .join("")
    );
  }

  if (esOrphans.length > 0) {
    // A blank type-ahead (mirrors renderNameCell()'s member-search input,
    // see candidateOptionValue()/parseCandidateSelection()) instead of a
    // <select> — a plain <select> with no placeholder option implicitly
    // selects its first entry, letting "Bind for this member only" bind the
    // wrong pair if clicked without an explicit choice.
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
                 <input type="text" class="link-search" list="${pathDatalistId}" data-role="path-bind-input" data-member-key="${key}" placeholder="Search Basecamp paths…" aria-label="Choose a path to bind this member's orphaned path to" autocomplete="off">
                 <button data-action="bind-path" data-member-key="${key}" data-es-index="${esIndex}" disabled>Bind for this member only</button>`
                : "";
            return `
            <div class="path-pair-row">
              <span><strong>EasySpeak:</strong> ${escapeHtml(esPath.easyspeakPathLabel ?? "")}</span>
              ${bindControls}
              <button class="secondary" data-action="mark-path-orphan" data-member-key="${key}" data-side="easyspeak" data-path="${escapeAttr(esPath.easyspeakPathLabel ?? "")}">Mark as orphan</button>
              <button class="secondary" data-action="flag-path" data-member-key="${key}" data-side="easyspeak" data-path="${escapeAttr(esPath.easyspeakPathLabel ?? "")}">Flag for later</button>
              <button class="secondary" data-action="mark-path-completed" data-member-key="${key}" data-path="${escapeAttr(esPath.easyspeakPathLabel ?? "")}">Mark as completed</button>
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
            <div class="path-pair-row">
              <span><strong>Basecamp:</strong> ${escapeHtml(bcPath.basecampPathName ?? "")}</span>
              <button class="secondary" data-action="flag-path" data-member-key="${key}" data-side="basecamp" data-path="${escapeAttr(bcPath.basecampPathName ?? "")}">Flag for later</button>
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
              <span><strong>EasySpeak:</strong> ${escapeHtml(esPath.easyspeakPathLabel ?? "")}</span>
              <span class="muted-text">Completed</span>
              <button class="secondary" data-action="unmark-path-completed" data-member-key="${key}" data-path="${escapeAttr(esPath.easyspeakPathLabel ?? "")}">Unmark completed</button>
            </div>
          `
        )
        .join("")
    );
  }

  if (esCompletedHistory.length > 0) {
    sections.push(
      esCompletedHistory
        .map(
          (esPath) => `
            <div class="path-pair-row" title="Basecamp only tracks currently-active paths, so a completed one has no live counterpart to bind to.">
              <span><strong>EasySpeak:</strong> ${escapeHtml(esPath.easyspeakPathLabel ?? "")}</span>
              <span class="muted-text">Completed (not tracked in Basecamp)</span>
            </div>
          `
        )
        .join("")
    );
  }

  if (sections.length === 0) {
    return '<p class="muted-text">No Pathways paths to review.</p>';
  }

  const helpText =
    '<p class="help-text">Bind pairs a path across systems for this member only; Mark as orphan confirms a path genuinely has no counterpart; Flag for later defers the decision without counting it as resolved; Mark as completed confirms an EasySpeak-only path is already done and hides it from Club Progress; Force unbind splits an automatic pair apart so you can rebind it differently.</p>';
  return helpText + sections.join("");
}

// ---------------------------------------------------------------------------
// Event wiring / handlers
// ---------------------------------------------------------------------------

function attachRowHandlers() {
  const root = document.getElementById("membersRoot")!;

  root.querySelectorAll<HTMLButtonElement>('[data-action="confirm"]').forEach((btn) => {
    btn.addEventListener("click", () => onConfirm(btn.dataset.memberKey!));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="reject"]').forEach((btn) => {
    btn.addEventListener("click", () => onReject(btn.dataset.memberKey!));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="unlink"]').forEach((btn) => {
    btn.addEventListener("click", () => onUnlink(btn.dataset.memberKey!));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="mark-orphan"]').forEach((btn) => {
    btn.addEventListener("click", () => onMarkOrphan(btn.dataset.memberKey!));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="unorphan"]').forEach((btn) => {
    btn.addEventListener("click", () => onUnmarkOrphan(btn.dataset.memberKey!));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="toggle-paths"]').forEach((btn) => {
    btn.addEventListener("click", () => onTogglePaths(btn.dataset.memberKey!));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="bind-path"]').forEach((btn) => {
    btn.addEventListener("click", () => onBindPath(btn));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="mark-path-orphan"]').forEach((btn) => {
    btn.addEventListener("click", () => onMarkPathOrphan(btn));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="unmark-path-orphan"]').forEach((btn) => {
    btn.addEventListener("click", () => onUnmarkPathOrphan(btn));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="flag-path"]').forEach((btn) => {
    btn.addEventListener("click", () => onFlagPath(btn));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="unflag-path"]').forEach((btn) => {
    btn.addEventListener("click", () => onUnflagPath(btn));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="mark-path-completed"]').forEach((btn) => {
    btn.addEventListener("click", () => onMarkPathCompleted(btn));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="unmark-path-completed"]').forEach((btn) => {
    btn.addEventListener("click", () => onUnmarkPathCompleted(btn));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="unbind-path"]').forEach((btn) => {
    btn.addEventListener("click", () => onUnbindPath(btn));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="force-unbind-path"]').forEach((btn) => {
    btn.addEventListener("click", () => onForceUnbindPath(btn));
  });
  root.querySelectorAll<HTMLInputElement>('[data-role="link-input"]').forEach((input) => {
    input.addEventListener("input", () => onLinkInputChange(input));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="link"]').forEach((btn) => {
    btn.addEventListener("click", () => onLink(btn));
  });
  root.querySelectorAll<HTMLInputElement>('[data-role="path-bind-input"]').forEach((input) => {
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
  // An exact match is recomputed fresh every time (nothing stored to
  // delete), so the only way to actually unlink it is to reject the pair —
  // otherwise it would just reappear as "Exact" again on the next refresh.
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

function onLinkInputChange(input: HTMLInputElement) {
  const member = findMemberByKey(input.dataset.memberKey!);
  const row = input.closest("tr")!;
  const linkBtn = row.querySelector<HTMLButtonElement>('[data-action="link"]');
  if (!member || !linkBtn) return;
  const candidates = getCandidatesForMember(member);
  linkBtn.disabled = !parseCandidateSelection(input.value, candidates);
}

async function onLink(btn: HTMLButtonElement) {
  const member = findMemberByKey(btn.dataset.memberKey!);
  if (!member) return;
  const row = btn.closest("tr")!;
  const input = row.querySelector<HTMLInputElement>('[data-role="link-input"]')!;
  const candidates = getCandidatesForMember(member);
  const match = parseCandidateSelection(input.value, candidates);
  if (!match) return;

  const basecampUserId = member.presence === "basecamp-only" ? member.basecampUserId! : (match.id as number);
  const easyspeakMemberId = member.presence === "easyspeak-only" ? member.easyspeakMemberId! : String(match.id);
  await confirmMemberLink(basecampUserId, easyspeakMemberId, "manual-search");
  await refresh();
}

function formatDate(timestamp: number | undefined): string {
  return timestamp ? new Date(timestamp).toLocaleString("en-US") : "never";
}
