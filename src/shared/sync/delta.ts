// src/shared/sync/delta.ts
//
// Computes the delta between the two systems: groups raw scrape rows into
// one entry per person, hands them to shared/sync/conflicts.ts to decide
// which records pair up, then works out what each pair's differences mean
// (missing speeches, discrepancies, pending-validation flags, "next level"
// summaries, CSV export). No chrome.* dependency — same reasoning as
// conflicts.ts.

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

function groupBasecampMembers(members: BasecampMember[]): BasecampPerson[] {
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

function groupEasySpeakMembers(members: EasySpeakMemberRow[]): EasySpeakPerson[] {
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

// ---------------------------------------------------------------------------
// Post-match inspectors
// ---------------------------------------------------------------------------

/**
 * Definition backing the Members view's "Path issues" filter: a member with
 * at least one Pathways path orphaned on each side (both sides picked a
 * path the other doesn't have) even though the member link itself is fine —
 * exactly the case a member-scoped path-bind override exists to fix.
 */
export function hasOrphanedPaths(member: { paths?: PathReport[] }): boolean {
  const paths = member.paths ?? [];
  const hasBasecampOrphan = paths.some((p) => p.presence === "basecamp-only" && !p.nonPathway);
  const hasEasyspeakOrphan = paths.some((p) => p.presence === "easyspeak-only" && !p.nonPathway);
  return hasBasecampOrphan && hasEasyspeakOrphan;
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
  const memberPathOverrides = resolution.memberPathOverrides ?? [];
  const memberPathExclusions = resolution.memberPathExclusions ?? [];
  const pathAliasLookup = resolution.pathAliasLookup ?? PATH_ALIAS_LOOKUP;
  const allowFuzzy = resolution.allowFuzzyMemberMatches ?? true;

  const memberMatches = matchMembers(basecampClub?.people ?? [], easyspeakClub?.people ?? [], memberLinks, rejectedPairs, allowFuzzy);

  const members: MemberReport[] = memberMatches.map(({ basecamp, easyspeak, confidence, score, source }) => {
    const presence: Presence = basecamp && easyspeak ? "both" : basecamp ? "basecamp-only" : "easyspeak-only";
    const overridesForMember = memberPathOverrides.filter(
      (o) => o.basecampUserId === basecamp?.userId && o.easyspeakMemberId === easyspeak?.memberId
    );
    const exclusionsForMember = memberPathExclusions.filter(
      (e) => e.basecampUserId === basecamp?.userId && e.easyspeakMemberId === easyspeak?.memberId
    );
    const { paths, easyspeakNoActivePath } = matchPaths(basecamp, easyspeak, overridesForMember, pathAliasLookup, exclusionsForMember);
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
// CSV export: flattens a ReportResult into one row per level (long format),
// so every fact is independently sortable/filterable in a spreadsheet —
// the HTML view's collapsible-cards-per-member shape can't do that.
// ---------------------------------------------------------------------------

const CSV_HEADERS = [
  "Basecamp Club",
  "EasySpeak Club",
  "Club Match %",
  "Member Name",
  "Basecamp User Id",
  "EasySpeak Member Id",
  "Member Presence",
  "Match Confidence",
  "Match Score",
  "Path",
  "Path Presence",
  "Non-Pathway",
  "Level",
  "EasySpeak Done",
  "EasySpeak Needed",
  "Basecamp Completed",
  "Basecamp Total",
  "Basecamp Approved",
  "Missing (EasySpeak)",
  "Missing (Basecamp)",
  "Discrepancy",
  "Pending Validation",
  "Notes",
];

// Placeholder for every column between "Match Score" and "Notes" (Path
// through Pending Validation) when a row has no path/level data at all.
const CSV_EMPTY_PATH_FIELDS = new Array(CSV_HEADERS.length - 9 - 1).fill("");

// Placeholder for every column between "Non-Pathway" and "Notes" (Level
// through Pending Validation) when a path row has no level data (nonPathway).
const CSV_EMPTY_LEVEL_FIELDS = new Array(CSV_HEADERS.length - 12 - 1).fill("");

export type CsvRow = (string | number)[];

export function reportToRows(report: ReportResult): CsvRow[] {
  const rows: CsvRow[] = [CSV_HEADERS];

  for (const club of report.clubPairs) {
    for (const member of club.members) {
      const memberBase: CsvRow = [
        club.basecampClubName ?? "",
        club.easyspeakClubName ?? "",
        club.matchScore != null ? Math.round(club.matchScore * 100) : "",
        member.name,
        member.basecampUserId ?? "",
        member.easyspeakMemberId ?? "",
        member.presence,
        member.matchConfidence ?? "",
        member.matchScore != null ? Number(member.matchScore.toFixed(2)) : "",
      ];

      if (member.paths.length === 0) {
        rows.push([...memberBase, ...CSV_EMPTY_PATH_FIELDS, member.easyspeakNoActivePath ? "No active EasySpeak path" : "No paths found"]);
        continue;
      }

      for (const path of member.paths) {
        const pathBase: CsvRow = [...memberBase, path.displayName, path.presence, path.nonPathway ? "Yes" : "No"];

        if (path.nonPathway) {
          rows.push([...pathBase, ...CSV_EMPTY_LEVEL_FIELDS, "Non-Pathways activity, not compared"]);
          continue;
        }

        for (const level of path.levels) {
          rows.push([
            ...pathBase,
            level.level,
            level.easyspeak?.done ?? "",
            level.easyspeak?.needed ?? "",
            level.basecamp?.completed ?? "",
            level.basecamp?.total ?? "",
            level.basecamp ? (level.basecamp.approved ? "Yes" : "No") : "",
            level.easyspeakMissing ?? "",
            level.basecampMissing ?? "",
            level.discrepancy ?? "",
            level.pendingValidation ? "Yes" : "No",
            "",
          ]);
        }

        if (path.pathCompletion) {
          rows.push([
            ...pathBase,
            "Path Completion",
            "",
            "",
            path.pathCompletion.completed,
            path.pathCompletion.total,
            "",
            "",
            path.pathCompletion.missing,
            "",
            "",
            "Basecamp-only, no EasySpeak equivalent",
          ]);
        }
      }

      if (member.easyspeakNoActivePath) {
        rows.push([...memberBase, ...CSV_EMPTY_PATH_FIELDS, "No active EasySpeak path"]);
      }
    }
  }

  return rows;
}

export function toCsv(rows: CsvRow[]): string {
  const escapeField = (value: string | number) => {
    const str = value == null ? "" : String(value);
    return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  return rows.map((row) => row.map(escapeField).join(",")).join("\r\n");
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

  const currentLevelLabel = currentLevel === 0 ? "Not started" : `Level ${currentLevel}`;

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
 *   one row per member+path (excluding non-Pathways paths) — grouped rather
 *   than a flat list so the UI can show one club at a time behind tabs
 *   instead of mixing every club's members into a single list.
 */
export function buildLevelSummary(report: ReportResult): LevelSummaryGroup[] {
  return report.clubPairs.map((club, index) => {
    const rows: LevelSummaryRow[] = [];
    for (const member of club.members) {
      for (const path of member.paths) {
        if (path.nonPathway) continue;
        rows.push({
          memberName: member.name,
          memberPresence: member.presence,
          matchConfidence: member.matchConfidence,
          pathName: path.displayName,
          pathPresence: path.presence,
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
