// src/shared/anonymize.ts
//
// Pure name-scrubbing transform for "Anonymize Mode" (see
// shared/settings-store.ts's getAnonymizeMode()/setAnonymizeMode()) — no
// browser.* dependency, same category as shared/sync/*, so it's
// Vitest-testable and usable from both entrypoint pages and
// shared/export/export-to-excel.ts.
//
// Numbering is sequential per club, in report.clubPairs order: "Club 1",
// "Club 2"... and, within each club, "Member 1", "Member 2"... (reset per
// club). A member's name/basecampName/easyspeakName all collapse to the same
// label, and a club's basecampClubName/easyspeakClubName collapse to the
// same label too — so the same person/club reads identically on both sides.

import { memberKey } from "./sync/delta";
import type { BasecampScrape, ClubPairReport, EasySpeakScrape, MemberReport, ReportResult } from "./types";

const FALLBACK_CLUB_LABEL = "Unknown club";
const FALLBACK_MEMBER_LABEL = "Unknown member";

export interface AnonymizationMaps {
  clubLabelByPairKey: Map<string, string>;
  memberLabelByMemberKey: Map<string, string>;
  clubLabelByBasecampId: Map<string, string>;
  clubLabelByEasyspeakId: Map<string, string>;
  memberLabelByBasecampUserId: Map<number, string>;
  memberLabelByEasyspeakMemberId: Map<string, string>;
}

function clubPairKey(basecampClubId: string | null, easyspeakClubId: string | null): string {
  return `${basecampClubId ?? "x"}::${easyspeakClubId ?? "x"}`;
}

/**
 * Walks report.clubPairs once, assigning "Club N"/"Member N" labels in
 * order. Produces both report-keyed lookups (used to anonymize a
 * ReportResult itself) and raw-id-keyed lookups (used to anonymize the raw
 * BasecampScrape/EasySpeakScrape objects, which don't carry memberKey()-
 * shaped composite keys).
 */
export function buildAnonymizationMaps(report: ReportResult): AnonymizationMaps {
  const maps: AnonymizationMaps = {
    clubLabelByPairKey: new Map(),
    memberLabelByMemberKey: new Map(),
    clubLabelByBasecampId: new Map(),
    clubLabelByEasyspeakId: new Map(),
    memberLabelByBasecampUserId: new Map(),
    memberLabelByEasyspeakMemberId: new Map(),
  };

  report.clubPairs.forEach((pair, clubIndex) => {
    const clubLabel = `Club ${clubIndex + 1}`;
    maps.clubLabelByPairKey.set(clubPairKey(pair.basecampClubId, pair.easyspeakClubId), clubLabel);
    if (pair.basecampClubId != null) maps.clubLabelByBasecampId.set(pair.basecampClubId, clubLabel);
    if (pair.easyspeakClubId != null) maps.clubLabelByEasyspeakId.set(pair.easyspeakClubId, clubLabel);

    pair.members.forEach((member, memberIndex) => {
      const memberLabel = `Member ${memberIndex + 1}`;
      maps.memberLabelByMemberKey.set(memberKey(member), memberLabel);
      if (member.basecampUserId != null) maps.memberLabelByBasecampUserId.set(member.basecampUserId, memberLabel);
      if (member.easyspeakMemberId != null) maps.memberLabelByEasyspeakMemberId.set(member.easyspeakMemberId, memberLabel);
    });
  });

  return maps;
}

export function anonymizeReport(report: ReportResult, maps: AnonymizationMaps): ReportResult {
  return {
    meta: report.meta,
    clubPairs: report.clubPairs.map((pair) => anonymizeClubPair(pair, maps)),
  };
}

function anonymizeClubPair(pair: ClubPairReport, maps: AnonymizationMaps): ClubPairReport {
  const clubLabel = maps.clubLabelByPairKey.get(clubPairKey(pair.basecampClubId, pair.easyspeakClubId)) ?? FALLBACK_CLUB_LABEL;
  return {
    ...pair,
    basecampClubName: pair.basecampClubId != null ? clubLabel : pair.basecampClubName,
    easyspeakClubName: pair.easyspeakClubId != null ? clubLabel : pair.easyspeakClubName,
    members: pair.members.map((member) => anonymizeMember(member, maps)),
  };
}

function anonymizeMember(member: MemberReport, maps: AnonymizationMaps): MemberReport {
  const label = maps.memberLabelByMemberKey.get(memberKey(member)) ?? FALLBACK_MEMBER_LABEL;
  return {
    ...member,
    name: label,
    basecampName: member.basecampUserId != null ? label : member.basecampName,
    easyspeakName: member.easyspeakMemberId != null ? label : member.easyspeakName,
  };
}

// ---------------------------------------------------------------------------
// Raw scrape anonymization — used both by the Excel export (with `maps`
// derived from the matched ReportResult, so labels agree with Club
// Progress/the export's own Aggregated & Matches sheets) and by the Sync
// Data "View details" raw preview (without `maps` — a single just-scraped
// source has no matched report to derive labels from yet, so it self-numbers
// from its own club/member order instead; those labels aren't guaranteed to
// match the export/Club Progress numbering for the same person, an accepted
// simplification for that low-stakes "did the scrape work" debug view).
//
// Both raw scrape shapes store one row per member×path (not deduped by user
// id — see shared/types.ts), so a member with several paths must still map
// to the exact same label across all of their rows within a club; the
// self-numbering branch tracks that with a per-club Map so a repeat id reuses
// its first-assigned label rather than incrementing again.
// ---------------------------------------------------------------------------

export function anonymizeBasecampScrape(data: BasecampScrape, maps?: AnonymizationMaps): BasecampScrape {
  const out: BasecampScrape = {};
  Object.entries(data).forEach(([clubId, club], clubIndex) => {
    const clubLabel = maps ? (maps.clubLabelByBasecampId.get(clubId) ?? FALLBACK_CLUB_LABEL) : `Club ${clubIndex + 1}`;
    const seen = new Map<number, string>();
    let nextMemberIndex = 1;
    out[clubId] = {
      name: clubLabel,
      members: club.members.map((member) => {
        const userId = member.user.id;
        let label = maps ? maps.memberLabelByBasecampUserId.get(userId) : seen.get(userId);
        if (!label) {
          label = maps ? FALLBACK_MEMBER_LABEL : `Member ${nextMemberIndex++}`;
          if (!maps) seen.set(userId, label);
        }
        return { ...member, user: { ...member.user, name: label } };
      }),
    };
  });
  return out;
}

export function anonymizeEasySpeakScrape(data: EasySpeakScrape, maps?: AnonymizationMaps): EasySpeakScrape {
  const out: EasySpeakScrape = {};
  Object.entries(data).forEach(([clubId, club], clubIndex) => {
    const clubLabel = maps ? (maps.clubLabelByEasyspeakId.get(clubId) ?? FALLBACK_CLUB_LABEL) : `Club ${clubIndex + 1}`;
    const seen = new Map<string, string>();
    let nextMemberIndex = 1;
    out[clubId] = {
      name: clubLabel,
      members: club.members.map((member) => {
        const id = member.memberId ?? "";
        let label = maps ? maps.memberLabelByEasyspeakMemberId.get(id) : seen.get(id);
        if (!label) {
          label = maps ? FALLBACK_MEMBER_LABEL : `Member ${nextMemberIndex++}`;
          if (!maps) seen.set(id, label);
        }
        return { ...member, name: label };
      }),
    };
  });
  return out;
}
