// src/shared/sync/delta.ts
//
// Computes the delta between the two systems: groups raw scrape rows into
// one entry per person, hands them to shared/sync/conflicts.ts to decide
// which records pair up, then works out what each pair's differences mean
// (missing speeches, discrepancies, pending-validation flags, "next level"
// summaries). No chrome.* dependency — same reasoning as conflicts.ts.

import {
  matchClubs,
  matchMembers,
  matchPaths,
  PATH_ALIAS_LOOKUP,
  type BasecampPerson,
  type ClubGroup,
  type EasySpeakPerson,
} from "./conflicts";
import type {
  BasecampMember,
  BasecampOverviewMember,
  BasecampOverviewScrape,
  BasecampScrape,
  ClubCentralScrape,
  ClubPairReport,
  EasySpeakMemberRow,
  EasySpeakScrape,
  MatchConfidence,
  MatchSource,
  MemberReport,
  PathReport,
  Presence,
  ReportResult,
  ResolutionData,
  LevelSummaryCore,
  LevelSummaryGroup,
  LevelSummaryRow,
  LevelUpStatus,
} from "../types";

/**
 * @param meta scrape timestamps, threaded through unchanged into the result.
 * @param resolution persisted name-resolution decisions, see
 *   shared/resolution-store.ts. Omitting this entirely reproduces pure
 *   name-similarity matching, unchanged.
 * @param basecampCompletedPaths GET /api/bcm/member/overview/ data (see
 *   background/api/basecamp.ts), keyed by the same club uuid as
 *   basecampData — feeds PathReport.confirmedCompleted. Omitting this
 *   reproduces the pre-existing behavior (no confirmed-completed paths).
 */
export function buildReport(
  basecampData: BasecampScrape,
  easyspeakData: EasySpeakScrape,
  meta: { basecampScrapedAt?: number | null; easyspeakScrapedAt?: number | null } = {},
  resolution: ResolutionData = {},
  basecampCompletedPaths: BasecampOverviewScrape = {}
): ReportResult {
  const basecampClubs: ClubGroup<BasecampPerson>[] = Object.entries(basecampData).map(([id, club]) => ({
    id,
    name: club.name,
    people: groupBasecampMembers(club.members, basecampCompletedPaths[id]?.members ?? []),
  }));
  const easyspeakClubs: ClubGroup<EasySpeakPerson>[] = Object.entries(easyspeakData).map(([id, club]) => ({
    id,
    name: club.name,
    people: groupEasySpeakMembers(club.members),
  }));

  const clubPairs = matchClubs(
    basecampClubs,
    easyspeakClubs,
    resolution.clubLookup ?? [],
    resolution.clubRejectedPairs ?? [],
    false,
    resolution.clubOrphans ?? []
  ).map((pair) => buildClubPairReport(pair.basecamp, pair.easyspeak, resolution, pair));

  return {
    meta: {
      basecampScrapedAt: meta.basecampScrapedAt ?? null,
      easyspeakScrapedAt: meta.easyspeakScrapedAt ?? null,
    },
    clubPairs,
  };
}

// ---------------------------------------------------------------------------
// Per-club member grouping (one row per member x path -> one entry per person)
// ---------------------------------------------------------------------------

/**
 * @param overviewMembers this club's GET /api/bcm/member/overview/ rows (see
 *   BasecampOverviewMember) — attaches each person's completed_paths list,
 *   defaulting to [] for anyone with no overview entry (e.g. absent from
 *   that endpoint's response for some reason).
 */
export function groupBasecampMembers(members: BasecampMember[], overviewMembers: BasecampOverviewMember[] = []): BasecampPerson[] {
  const byUserId = new Map<number, BasecampPerson>();
  for (const member of members) {
    const userId = member.user.id;
    if (!byUserId.has(userId)) {
      byUserId.set(userId, { userId, name: member.user.name, paths: [], completedPaths: [] });
    }
    byUserId.get(userId)!.paths.push({
      path_name: member.path_name,
      progression: member.progression,
    });
  }
  const completedByUserId = new Map(overviewMembers.map((m) => [m.user.id, m.completed_paths]));
  for (const [userId, person] of byUserId) {
    person.completedPaths = completedByUserId.get(userId) ?? [];
  }
  return Array.from(byUserId.values());
}

export function groupEasySpeakMembers(members: EasySpeakMemberRow[]): EasySpeakPerson[] {
  const byMemberId = new Map<string, EasySpeakPerson>();
  for (const member of members) {
    const memberId = member.memberId ?? "";
    if (!byMemberId.has(memberId)) {
      byMemberId.set(memberId, { memberId, name: null, paths: [] });
    }
    const person = byMemberId.get(memberId)!;
    // EasySpeak repeats "''" as a placeholder name on every row after a
    // multi-path member's first — only trust a row's name when it's real.
    if (!person.name && member.name && member.name !== "''") {
      person.name = member.name;
    }
    person.paths.push({ path: member.path, levels: member.levels });
  }
  for (const person of byMemberId.values()) {
    if (!person.name) person.name = `EasySpeak member ${person.memberId}`;
  }
  return Array.from(byMemberId.values());
}

/** Distinct-member (not member×path row) count across every club in a raw
 *  Basecamp scrape — used by the Sync Data cards/completion summary, which
 *  need a per-source count before the other source (and thus buildReport())
 *  is available. */
export function countBasecampMembers(data: BasecampScrape): number {
  return Object.values(data).reduce((sum, club) => sum + groupBasecampMembers(club.members).length, 0);
}

/** EasySpeak counterpart to countBasecampMembers() above. */
export function countEasySpeakMembers(data: EasySpeakScrape): number {
  return Object.values(data).reduce((sum, club) => sum + groupEasySpeakMembers(club.members).length, 0);
}

/** Club Central counterpart — its rows are already one-per-member, so this
 *  is a plain sum. (Club Central data never enters buildReport(); this lives
 *  here only so the Sync Data cards import all three counts from one place.) */
export function countClubCentralMembers(data: ClubCentralScrape): number {
  return Object.values(data).reduce((sum, club) => sum + club.members.length, 0);
}

// ---------------------------------------------------------------------------
// Post-match inspectors
// ---------------------------------------------------------------------------

/**
 * Definition backing the Members view's "Path issues" filter: a member whose
 * *identity* is already matched (`presence === "both"`) but who still has
 * at least one *EasySpeak-only* Pathways path that isn't yet resolved
 * (`orphaned`/`flagged`/`manuallyCompleted`/`confirmedCompleted`) — the side
 * `renderPathBindDetail()` actually gives a VPE actions for (bind, mark
 * orphan, flag, mark completed). A Basecamp-only leftover with nothing on
 * the EasySpeak side is deliberately *not* itself actionable — the member
 * simply hasn't logged an equivalent path in EasySpeak yet, which
 * `renderPathBindDetail()`'s own "doesn't block Club Progress" note reflects
 * by rendering it with no action buttons at all — so it's excluded here.
 * This intentionally does *not* require a Basecamp-only candidate to also
 * exist: an EasySpeak-only path with no Basecamp counterpart at all is
 * exactly as actionable as one that's mismatched against a specific
 * Basecamp-only path (e.g. a name-alias gap, or a path never registered in
 * Basecamp) — previously this was only flagged when a Basecamp-only
 * candidate happened to exist too, silently hiding the one-sided case from
 * "To do" even though it was fully reviewable from "All".
 *
 * The `presence === "both"` gate matters separately from the path-level
 * check above: every path belonging to a member whose *identity* itself is
 * still one-sided (unmatched, or identity-resolved via markMemberOrphan())
 * is necessarily "easyspeak-only" too (there's no Basecamp person to pair
 * against at all) — without this gate, a member the VPE already resolved by
 * marking their whole identity as an Orphan would immediately reopen as a
 * "path issue" with no way to close it (there's no counterpart identity left
 * to bind or mark-orphan at the path level). That case is fully handled by
 * matchConfidence/isMemberResolved instead; this function only judges
 * mismatches *within* an already-matched pair.
 *
 * Once true, this stays true until *every* real EasySpeak-only candidate is
 * individually resolved (`orphaned`/`flagged`/`manuallyCompleted`, or folded
 * into a "both"-presence pair via a bind) — resolving only one of several
 * still leaves the rest outstanding. A `flagged` candidate (see
 * hasFlaggedPaths()/flagPath()) is excluded from this "still unresolved"
 * check the same way `orphaned` is.
 */
export function hasOrphanedPaths(member: { presence: Presence; paths?: PathReport[] }): boolean {
  if (member.presence !== "both") return false;
  const paths = member.paths ?? [];
  const easyspeakCandidates = paths.filter(
    (p) => p.presence === "easyspeak-only" && !p.nonPathway && !p.manuallyCompleted && !p.confirmedCompleted
  );
  return easyspeakCandidates.some((p) => !p.orphaned && !p.flagged);
}

/**
 * A member-scoped path-bind override took effect for this member (see the
 * `overridden` tag matchPaths() sets on a spliced-out forced pair). Once
 * bound, the path itself no longer shows up under hasOrphanedPaths() (it's
 * "both"-presence now), so this is the only remaining signal that a manual
 * correction happened here — used to still surface it as a manual link even
 * when the member identity itself matched automatically (e.g. an exact name
 * match whose paths needed a manual bind).
 */
export function hasPathOverride(member: { paths?: PathReport[] }): boolean {
  return (member.paths ?? []).some((p) => p.overridden);
}

/**
 * A member-scoped path orphan resolution took effect for this member (see
 * the `orphaned` tag matchPaths() sets — the path-level counterpart of
 * hasPathOverride()/`overridden`). Kept separate from hasPathOverride since
 * they're different resolutions with different undo actions (Unbind vs.
 * Unmark orphan).
 */
export function hasPathOrphan(member: { paths?: PathReport[] }): boolean {
  return (member.paths ?? []).some((p) => p.orphaned);
}

/**
 * A member-scoped path flag took effect for this member (see the `flagged`
 * tag matchPaths() sets — see flagPath() in shared/resolution-store.ts). The
 * third, deliberately non-resolving counterpart to hasPathOverride()/
 * hasPathOrphan(): unlike those two, this does NOT feed classifyMember()'s
 * "resolved-manually" tag — flagging is explicitly a deferral, not a
 * resolution, so it gets its own "flagged" tag instead.
 */
export function hasFlaggedPaths(member: { paths?: PathReport[] }): boolean {
  return (member.paths ?? []).some((p) => p.flagged);
}

/**
 * A member-scoped "Mark as completed" took effect for this member (see the
 * `manuallyCompleted` tag matchPaths() sets — set by markPathCompleted() in
 * shared/resolution-store.ts). A genuine resolution like hasPathOverride()/
 * hasPathOrphan(), not a deferral like hasFlaggedPaths(), so it feeds
 * classifyMember()'s "resolved-manually" tag the same way those two do.
 */
export function hasManuallyCompletedPaths(member: { paths?: PathReport[] }): boolean {
  return (member.paths ?? []).some((p) => p.manuallyCompleted);
}

/**
 * The predicate behind the popup's quick "Matches: X/Y" stat
 * (popup/index.ts): a member counts once its identity is *settled* —
 * matchConfidence "exact" (certain, automatic) or "confirmed" (human-
 * verified: a linked pair or an explicit Orphan resolution) — AND it has no
 * unresolved path issues left (hasOrphanedPaths). A "fuzzy" suggestion is
 * deliberately excluded: it's still an unreviewed algorithmic guess, not a
 * settled match, so it shouldn't read as "done" any more than a plain
 * unmatched (null-confidence) member would. A settled identity with an
 * outstanding path issue still isn't "done" either, so it's excluded until
 * that's bound or marked orphan too.
 */
export function isMemberResolved(member: { matchConfidence: MatchConfidence; hasOrphanedPaths: boolean }): boolean {
  return (member.matchConfidence === "exact" || member.matchConfidence === "confirmed") && !member.hasOrphanedPaths;
}

export interface MatchSummary {
  matched: number;
  total: number;
}

export function computeMatchSummary(report: ReportResult): MatchSummary {
  let matched = 0;
  let total = 0;
  for (const club of report.clubPairs) {
    for (const member of club.members) {
      total += 1;
      if (isMemberResolved(member)) matched += 1;
    }
  }
  return { matched, total };
}

/**
 * Stable per-member key for correlating a MemberReport across re-renders/
 * re-sorts (e.g. Member Review's row lookups, Club Progress's Next Level
 * Summary row-to-detail mapping) — a member always has at least one of the
 * two ids, so the composite stays unique even for a one-sided (unmatched)
 * member.
 */
export function memberKey(member: { basecampUserId: number | string | null; easyspeakMemberId: number | string | null }): string {
  return `${member.basecampUserId ?? "x"}::${member.easyspeakMemberId ?? "x"}`;
}

/**
 * Tags describing what, if anything, still needs a human decision for this
 * member — not mutually exclusive (see Member Review's "Path issues"/
 * "Linked manually" chips, which both read off this same classification).
 */
export function classifyMember(member: MemberReport): string[] {
  const tags: string[] = [];
  if (member.matchConfidence === "fuzzy") tags.push("suggested");
  if (member.presence !== "both" && member.matchConfidence !== "confirmed") tags.push("unmatched");
  if (member.hasOrphanedPaths) tags.push("path-issues");
  if (hasFlaggedPaths(member)) tags.push("flagged");
  if (member.matchConfidence === "confirmed" || hasPathOverride(member) || hasPathOrphan(member) || hasManuallyCompletedPaths(member))
    tags.push("resolved-manually");
  return tags;
}

/** A member with an unresolved suggestion, an unmatched side, or a path issue — the set both Member Review's "To do" filter and Club Progress's per-club tab badge count. */
export function needsAction(member: MemberReport): boolean {
  const tags = classifyMember(member);
  return tags.includes("suggested") || tags.includes("unmatched") || tags.includes("path-issues");
}

// ---------------------------------------------------------------------------
// Club pair assembly
// ---------------------------------------------------------------------------

/**
 * @param clubMatch this pair's entry from matchClubs(), so the club's own
 *   match score/forced flag doesn't need to be recomputed here.
 */
function buildClubPairReport(
  basecampClub: ClubGroup<BasecampPerson> | null,
  easyspeakClub: ClubGroup<EasySpeakPerson> | null,
  resolution: ResolutionData = {},
  clubMatch: { score?: number | null; confidence?: MatchConfidence; source?: MatchSource } = {}
): ClubPairReport {
  const memberLinks = resolution.memberLinks ?? [];
  const rejectedPairs = resolution.rejectedPairs ?? [];
  const memberOrphans = resolution.memberOrphans ?? [];
  const memberPathOverrides = resolution.memberPathOverrides ?? [];
  const memberPathExclusions = resolution.memberPathExclusions ?? [];
  const memberPathOrphans = resolution.memberPathOrphans ?? [];
  const memberPathFlags = resolution.memberPathFlags ?? [];
  const memberPathCompletions = resolution.memberPathCompletions ?? [];
  const pathAliasLookup = resolution.pathAliasLookup ?? PATH_ALIAS_LOOKUP;
  const allowFuzzy = resolution.allowFuzzyMemberMatches ?? true;

  const memberMatches = matchMembers(basecampClub?.people ?? [], easyspeakClub?.people ?? [], memberLinks, rejectedPairs, allowFuzzy, memberOrphans);

  const members: MemberReport[] = memberMatches.map(({ basecamp, easyspeak, confidence, score, source }) => {
    const presence: Presence = basecamp && easyspeak ? "both" : basecamp ? "basecamp-only" : "easyspeak-only";
    const overridesForMember = memberPathOverrides.filter(
      (o) => o.basecampUserId === basecamp?.userId && o.easyspeakMemberId === easyspeak?.memberId
    );
    const exclusionsForMember = memberPathExclusions.filter(
      (e) => e.basecampUserId === basecamp?.userId && e.easyspeakMemberId === easyspeak?.memberId
    );
    const pathOrphansForMember = memberPathOrphans.filter(
      (o) => o.basecampUserId === basecamp?.userId && o.easyspeakMemberId === easyspeak?.memberId
    );
    const flagsForMember = memberPathFlags.filter(
      (f) => f.basecampUserId === basecamp?.userId && f.easyspeakMemberId === easyspeak?.memberId
    );
    const completionsForMember = memberPathCompletions.filter(
      (c) => c.basecampUserId === basecamp?.userId && c.easyspeakMemberId === easyspeak?.memberId
    );
    const { paths, easyspeakNoActivePath } = matchPaths(
      basecamp,
      easyspeak,
      overridesForMember,
      pathAliasLookup,
      exclusionsForMember,
      pathOrphansForMember,
      flagsForMember,
      completionsForMember
    );
    const member: MemberReport = {
      basecampUserId: basecamp?.userId ?? null,
      easyspeakMemberId: easyspeak?.memberId ?? null,
      name: basecamp?.name ?? easyspeak?.name ?? "(unnamed)",
      basecampName: basecamp?.name ?? null,
      easyspeakName: easyspeak?.name ?? null,
      presence,
      matchConfidence: confidence,
      matchScore: score,
      // Only meaningful when matchConfidence === "confirmed" — which
      // memberLinks source produced this link, so the UI can tell "the
      // user manually searched and linked this" apart from "the user just
      // approved an algorithmic suggestion."
      matchSource: source ?? null,
      easyspeakNoActivePath,
      paths,
      hasOrphanedPaths: false,
    };
    member.hasOrphanedPaths = hasOrphanedPaths(member);
    return member;
  });

  return {
    basecampClubId: basecampClub?.id ?? null,
    basecampClubName: basecampClub?.name ?? null,
    easyspeakClubId: easyspeakClub?.id ?? null,
    easyspeakClubName: easyspeakClub?.name ?? null,
    matchScore: clubMatch.score ?? null,
    clubMatchForced: clubMatch.confidence === "confirmed" && clubMatch.source !== "orphan",
    clubOrphaned: clubMatch.source === "orphan",
    members,
  };
}

// ---------------------------------------------------------------------------
// "Next level" summary: one row per member+path (skipping non-Pathways
// paths, which have no Basecamp level structure), with the 4 metrics a VPE
// actually wants to sort/scan by, instead of having to read a full
// level-by-level table per path to work them out by hand.
// ---------------------------------------------------------------------------

function speechWord(n: number): string {
  return n === 1 ? "speech" : "speeches";
}

// Rank order backing LevelSummaryCore.statusSortRank — the default (asc) sort
// order for the Status column.
const STATUS_SORT_RANK: Record<LevelUpStatus, number> = {
  ready: 0,
  "ready-if-reported": 1,
  "needs-reporting": 2,
  "in-progress": 3,
  "not-tracked": 4,
  completed: 5,
};

export function computeLevelSummary(path: PathReport): LevelSummaryCore {
  if (path.presence === "easyspeak-only") {
    return {
      currentLevel: null,
      currentLevelSortValue: null,
      currentLevelLabel: "Not in Basecamp",
      nextLevelLabel: "—",
      theoreticalMissing: null,
      unreportedInBasecamp: null,
      realMissing: null,
      status: "not-tracked",
      statusDetail: "Only in EasySpeak, not yet in Basecamp",
      statusSortRank: STATUS_SORT_RANK["not-tracked"],
    };
  }

  let highestApprovedLevel = 0;
  for (const level of path.levels) {
    if (level.basecamp?.approved) highestApprovedLevel = level.level;
  }
  // The level the member is currently working on — the first one not yet
  // approved (capped at 5). This is what the Next Level Summary's "Level"
  // column names; every "missing"/status field below is already computed
  // against it.
  const workingLevel = Math.min(highestApprovedLevel + 1, 5);

  const completed =
    highestApprovedLevel === 5 && !!path.pathCompletion && path.pathCompletion.completed >= path.pathCompletion.total;
  if (completed) {
    return {
      currentLevel: 5,
      // Above both a plain Level 5 in progress (5) and a Level 5 with only
      // Path Completion pending (5.5), so a finished path always sorts last.
      currentLevelSortValue: 6,
      currentLevelLabel: "Completed",
      nextLevelLabel: "—",
      theoreticalMissing: null,
      unreportedInBasecamp: null,
      realMissing: null,
      status: "completed",
      statusDetail: "Path completed",
      statusSortRank: STATUS_SORT_RANK.completed,
    };
  }

  const currentLevelLabel = `Level ${workingLevel}`;

  if (highestApprovedLevel === 5) {
    // Level 5 approved but Path Completion itself isn't done yet — Path
    // Completion has no EasySpeak equivalent to compare against at all, so
    // there's no discrepancy/pendingValidation data to check here; status
    // can only ever be "ready" or "in-progress".
    const theoreticalMissing = path.pathCompletion?.missing ?? 0;
    const status: LevelUpStatus = theoreticalMissing === 0 ? "ready" : "in-progress";
    const statusDetail =
      theoreticalMissing === 0 ? "All requirements reported" : `${theoreticalMissing} ${speechWord(theoreticalMissing)} remaining`;
    return {
      currentLevel: 5,
      // Half a rank above a main-branch row whose workingLevel is also 5, so
      // "Level 5 (Path Completion still pending)" sorts as more advanced —
      // same rationale as "Completed" sitting at 6.
      currentLevelSortValue: 5.5,
      currentLevelLabel,
      nextLevelLabel: "Path Completion",
      theoreticalMissing,
      unreportedInBasecamp: 0,
      realMissing: theoreticalMissing,
      status,
      statusDetail,
      statusSortRank: STATUS_SORT_RANK[status],
    };
  }

  const nextLevel = path.levels[highestApprovedLevel]; // highestApprovedLevel is 0-4 here, levels[] is 0-indexed by level-1
  const theoreticalMissing = nextLevel.basecampMissing ?? 0;
  const unreportedInBasecamp = nextLevel.easyspeak ? Math.max(0, nextLevel.discrepancy ?? 0) : 0;
  const realMissing = Math.max(0, theoreticalMissing - unreportedInBasecamp);

  // Precedence: the reporting-gap cases are checked first; plain
  // progress/ready are the fallback.
  let status: LevelUpStatus;
  if (unreportedInBasecamp > 0) {
    status = realMissing === 0 ? "ready-if-reported" : "needs-reporting";
  } else if (theoreticalMissing === 0) {
    status = "ready";
  } else {
    status = "in-progress";
  }

  // Detail always leads with the official Basecamp-only gap
  // (theoreticalMissing); when some of that gap is only unreported (not
  // actually still to do), a second clause shows what's left once it's
  // reported.
  const statusDetail =
    status === "ready"
      ? "All requirements reported"
      : unreportedInBasecamp > 0
        ? `${theoreticalMissing} ${speechWord(theoreticalMissing)} remaining → ${realMissing} if reported`
        : `${theoreticalMissing} ${speechWord(theoreticalMissing)} remaining`;

  return {
    currentLevel: workingLevel,
    currentLevelSortValue: workingLevel,
    currentLevelLabel,
    nextLevelLabel: workingLevel < 5 ? `Level ${workingLevel + 1}` : "Path Completion",
    theoreticalMissing,
    unreportedInBasecamp,
    realMissing,
    status,
    statusDetail,
    statusSortRank: STATUS_SORT_RANK[status],
  };
}

/**
 * @returns one group per club (same order as report.clubPairs), each with
 *   one row per member+path (excluding non-Pathways paths, and manually- or
 *   Basecamp-confirmed-completed paths — see
 *   PathReport.manuallyCompleted/confirmedCompleted) — grouped rather than a
 *   flat list so the UI can show one club at a time behind tabs instead of
 *   mixing every club's members into a single list.
 */
export function buildLevelSummary(report: ReportResult): LevelSummaryGroup[] {
  return report.clubPairs.map((club, index) => {
    const rows: LevelSummaryRow[] = [];
    for (const member of club.members) {
      for (const path of member.paths) {
        if (path.nonPathway || path.manuallyCompleted || path.confirmedCompleted) continue;
        rows.push({
          memberKey: memberKey(member),
          pathKey: path.canonicalKey,
          memberName: member.name,
          memberPresence: member.presence,
          matchConfidence: member.matchConfidence,
          pathName: path.displayName,
          pathPresence: path.presence,
          pendingReview: needsAction(member),
          ...computeLevelSummary(path),
        });
      }
    }
    return {
      clubKey: `club-${index}`,
      clubName: club.basecampClubName ?? club.easyspeakClubName,
      rows,
    };
  });
}

// Both-presence rows first, then Basecamp-only, then EasySpeak-only — fixed
// regardless of the column sort/direction the VPE picks in the Next Level
// Summary table, since scanning by "is this actionable in both systems"
// comes before anything else.
const PATH_PRESENCE_RANK: Record<Presence, number> = { both: 0, "basecamp-only": 1, "easyspeak-only": 2 };

/**
 * Comparator backing Club Progress's "Next Level Summary" table sort:
 * groups rows by pathPresence (both, then Basecamp-only, then
 * EasySpeak-only) ahead of whichever column/direction the user picked, so
 * that grouping stays stable no matter how the table is otherwise sorted.
 * Nulls in the picked column (e.g. "Not in Basecamp"/"Completed" rows with
 * no speech counts to compare) always sort last within their presence
 * group, regardless of ascending/descending — they're "not applicable", not
 * a real ranking value.
 */
export function compareLevelSummaryRows(a: LevelSummaryRow, b: LevelSummaryRow, key: keyof LevelSummaryRow, direction: "asc" | "desc"): number {
  const presenceCmp = PATH_PRESENCE_RANK[a.pathPresence] - PATH_PRESENCE_RANK[b.pathPresence];
  if (presenceCmp !== 0) return presenceCmp;

  const av = a[key];
  const bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;

  const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
  if (cmp !== 0) return direction === "asc" ? cmp : -cmp;

  // Sorting by Status: rows tied on status get a fixed, status-specific
  // secondary order (not the raw statusDetail text, which would sort
  // alphabetically) — always applied the same way regardless of the
  // Status column's own asc/desc toggle, same as the presence grouping
  // above.
  if (key === "statusSortRank") {
    if (a.status === "needs-reporting" && b.status === "needs-reporting") {
      return (a.realMissing ?? 0) - (b.realMissing ?? 0);
    }
    if (a.status === "in-progress" && b.status === "in-progress") {
      return (a.realMissing ?? 0) - (b.realMissing ?? 0);
    }
  }

  return 0;
}

/**
 * A member with at least one Pathways path exactly one level (or Path
 * Completion) away from being reported complete in Basecamp — nothing
 * outstanding once EasySpeak-reported-but-not-yet-approved work is
 * accounted for (realMissing === 0). Used by Club Progress's per-club
 * "Ready to Level Up" KPI card (report.ts) and its Next Level Summary rows.
 */
export function isMemberReadyForNextLevel(member: MemberReport): boolean {
  return member.paths.some((path) => !path.nonPathway && computeLevelSummary(path).realMissing === 0);
}
