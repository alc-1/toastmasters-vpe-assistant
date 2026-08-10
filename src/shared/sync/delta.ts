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
  BasecampScrape,
  ClubPairReport,
  EasySpeakMemberRow,
  EasySpeakScrape,
  MatchConfidence,
  MemberReport,
  PathReport,
  Presence,
  ReportResult,
  ResolutionData,
  LevelSummaryCore,
  LevelSummaryGroup,
  LevelSummaryRow,
} from "../types";

/**
 * @param meta scrape timestamps, threaded through unchanged into the result.
 * @param resolution persisted name-resolution decisions, see
 *   shared/resolution-store.ts. Omitting this entirely reproduces pure
 *   name-similarity matching, unchanged.
 */
export function buildReport(
  basecampData: BasecampScrape,
  easyspeakData: EasySpeakScrape,
  meta: { basecampScrapedAt?: number | null; easyspeakScrapedAt?: number | null } = {},
  resolution: ResolutionData = {}
): ReportResult {
  const basecampClubs: ClubGroup<BasecampPerson>[] = Object.entries(basecampData).map(([id, club]) => ({
    id,
    name: club.name,
    people: groupBasecampMembers(club.members),
  }));
  const easyspeakClubs: ClubGroup<EasySpeakPerson>[] = Object.entries(easyspeakData).map(([id, club]) => ({
    id,
    name: club.name,
    people: groupEasySpeakMembers(club.members),
  }));

  const clubPairs = matchClubs(basecampClubs, easyspeakClubs, resolution.clubLookup ?? [], resolution.clubRejectedPairs ?? []).map((pair) =>
    buildClubPairReport(pair.basecamp, pair.easyspeak, resolution, pair)
  );

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

export function groupBasecampMembers(members: BasecampMember[]): BasecampPerson[] {
  const byUserId = new Map<number, BasecampPerson>();
  for (const member of members) {
    const userId = member.user.id;
    if (!byUserId.has(userId)) {
      byUserId.set(userId, { userId, name: member.user.name, paths: [] });
    }
    byUserId.get(userId)!.paths.push({
      path_name: member.path_name,
      progression: member.progression,
    });
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

// ---------------------------------------------------------------------------
// Post-match inspectors
// ---------------------------------------------------------------------------

/**
 * Definition backing the Members view's "Path issues" filter: a member with
 * at least one Pathways path orphaned on each side (both sides picked a
 * path the other doesn't have) even though the member link itself is fine —
 * exactly the case a member-scoped path-bind override/orphan-mark exists to
 * fix. Gating on both sides ever having a real (non-nonPathway) candidate —
 * regardless of whether some of those candidates have since been resolved —
 * is what distinguishes a genuine two-sided mismatch from a harmless
 * one-sided leftover (e.g. a member who simply hasn't started an equivalent
 * path on the other system yet, or an easyspeak-only path tagged
 * `completedHistory`, read-only history Basecamp no longer tracks because
 * it's done). Once that gate is satisfied, this stays true until *every*
 * real candidate on *both* sides is individually resolved (`orphaned` or
 * folded into a "both"-presence pair) — resolving only the smaller side
 * must not flip a member with several outstanding items on the other side
 * to "done". A `flagged` candidate (see hasFlaggedPaths()/flagPath()) is
 * excluded from the final "still unresolved" check the same way `orphaned`
 * is, without being removed from the two-sided-mismatch gate itself — so an
 * unrelated flagged path on one side never masks a genuine unresolved
 * mismatch on the other.
 */
export function hasOrphanedPaths(member: { paths?: PathReport[] }): boolean {
  const paths = member.paths ?? [];
  const basecampCandidates = paths.filter((p) => p.presence === "basecamp-only" && !p.nonPathway);
  const easyspeakCandidates = paths.filter((p) => p.presence === "easyspeak-only" && !p.nonPathway && !p.completedHistory);
  if (basecampCandidates.length === 0 || easyspeakCandidates.length === 0) return false;
  return basecampCandidates.some((p) => !p.orphaned && !p.flagged) || easyspeakCandidates.some((p) => !p.orphaned && !p.flagged);
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
  if (member.matchConfidence === "confirmed" || hasPathOverride(member) || hasPathOrphan(member)) tags.push("resolved-manually");
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
  clubMatch: { score?: number | null; confidence?: MatchConfidence } = {}
): ClubPairReport {
  const memberLinks = resolution.memberLinks ?? [];
  const rejectedPairs = resolution.rejectedPairs ?? [];
  const memberOrphans = resolution.memberOrphans ?? [];
  const memberPathOverrides = resolution.memberPathOverrides ?? [];
  const memberPathExclusions = resolution.memberPathExclusions ?? [];
  const memberPathOrphans = resolution.memberPathOrphans ?? [];
  const memberPathFlags = resolution.memberPathFlags ?? [];
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
    const { paths, easyspeakNoActivePath } = matchPaths(
      basecamp,
      easyspeak,
      overridesForMember,
      pathAliasLookup,
      exclusionsForMember,
      pathOrphansForMember,
      flagsForMember
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
    clubMatchForced: clubMatch.confidence === "confirmed",
    members,
  };
}

// ---------------------------------------------------------------------------
// "Next level" summary: one row per member+path (skipping non-Pathways
// paths, which have no Basecamp level structure), with the 4 metrics a VPE
// actually wants to sort/scan by, instead of having to read a full
// level-by-level table per path to work them out by hand.
// ---------------------------------------------------------------------------

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
    };
  }

  let currentLevel = 0;
  for (const level of path.levels) {
    if (level.basecamp?.approved) currentLevel = level.level;
  }

  const completed = currentLevel === 5 && !!path.pathCompletion && path.pathCompletion.completed >= path.pathCompletion.total;
  if (completed) {
    return {
      currentLevel,
      // One rank above a merely-approved Level 5, so "Completed" sorts as
      // more advanced than "Level 5 (Path Completion still pending)" even
      // though both share currentLevel === 5.
      currentLevelSortValue: 6,
      currentLevelLabel: "Completed",
      nextLevelLabel: "—",
      theoreticalMissing: null,
      unreportedInBasecamp: null,
      realMissing: null,
    };
  }

  const currentLevelLabel = `Level ${currentLevel}`;

  if (currentLevel === 5) {
    // Level 5 approved but Path Completion itself isn't done yet — Path
    // Completion has no EasySpeak equivalent to compare against at all.
    const theoreticalMissing = path.pathCompletion?.missing ?? 0;
    return {
      currentLevel,
      currentLevelSortValue: currentLevel,
      currentLevelLabel,
      nextLevelLabel: "Path Completion",
      theoreticalMissing,
      unreportedInBasecamp: 0,
      realMissing: theoreticalMissing,
    };
  }

  const nextLevel = path.levels[currentLevel]; // currentLevel is 0-4 here, levels[] is 0-indexed by level-1
  const theoreticalMissing = nextLevel.basecampMissing ?? 0;
  const unreportedInBasecamp = nextLevel.easyspeak ? Math.max(0, nextLevel.discrepancy ?? 0) : 0;
  const realMissing = Math.max(0, theoreticalMissing - unreportedInBasecamp);

  return {
    currentLevel,
    currentLevelSortValue: currentLevel,
    currentLevelLabel,
    nextLevelLabel: `Level ${currentLevel + 1}`,
    theoreticalMissing,
    unreportedInBasecamp,
    realMissing,
  };
}

/**
 * @returns one group per club (same order as report.clubPairs), each with
 *   one row per member+path (excluding non-Pathways paths and completed
 *   EasySpeak-only history — see PathReport.completedHistory) — grouped
 *   rather than a flat list so the UI can show one club at a time behind
 *   tabs instead of mixing every club's members into a single list.
 */
export function buildLevelSummary(report: ReportResult): LevelSummaryGroup[] {
  return report.clubPairs.map((club, index) => {
    const rows: LevelSummaryRow[] = [];
    for (const member of club.members) {
      for (const path of member.paths) {
        if (path.nonPathway || path.completedHistory) continue;
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

/**
 * A member with at least one Pathways path exactly one level (or Path
 * Completion) away from being reported complete in Basecamp — nothing
 * outstanding once EasySpeak-reported-but-not-yet-approved work is
 * accounted for (realMissing === 0). Exported (not just used internally by
 * countMembersReadyForNextLevel below) so Club Progress's per-club KPI card
 * can reuse the exact same definition scoped to one club's members instead
 * of the whole report.
 */
export function isMemberReadyForNextLevel(member: MemberReport): boolean {
  return member.paths.some((path) => !path.nonPathway && computeLevelSummary(path).realMissing === 0);
}

/**
 * Distinct members (across every club) ready for their next level — see
 * isMemberReadyForNextLevel() above. Backs the popup's vertical-stepper
 * "Club Progress" step: the count a VPE actually wants at a glance, without
 * opening the full Next Level Summary table. Excludes members needsAction()
 * flags as pending review (unmatched identity or an unresolved orphaned
 * path) — same reasoning as buildLevelSummary()'s per-row pendingReview
 * flag: their numbers aren't a reconciled diff yet, so they shouldn't count
 * toward "ready".
 */
export function countMembersReadyForNextLevel(report: ReportResult): number {
  let count = 0;
  for (const club of report.clubPairs) {
    for (const member of club.members) {
      if (!needsAction(member) && isMemberReadyForNextLevel(member)) count += 1;
    }
  }
  return count;
}
