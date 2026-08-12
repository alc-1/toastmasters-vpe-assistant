// src/shared/resolution-store.ts
//
// Storage I/O for the 6 persisted name-resolution keys (memberLinks,
// memberRejectedPairs, clubLookup, pathLookup, memberPathOverrides,
// memberPathExclusions). Unlike shared/sync/*, this file is legitimately
// browser.*-dependent (pure storage I/O), so it isn't Vitest-testable — same
// as background/api/*.ts. Used from the three options pages (report,
// members, settings) — never from background/, since none of this needs the
// service worker.
//
// Every write is an upsert enforcing a 1:1 invariant where applicable
// (confirming/pinning a pair first strips any prior record touching either
// id), so re-running an action never produces duplicate/conflicting rows.

import { local } from "./storage";
import { buildPathAliasLookup, PATH_ALIASES } from "./sync/conflicts";
import type {
  ClubLookupEntry,
  ClubRejectedPair,
  MemberLink,
  MemberOrphan,
  MemberPathExclusion,
  MemberPathFlag,
  MemberPathOrphan,
  MemberPathOverride,
  MatchSource,
  PathLookup,
  RejectedPair,
  ResolutionData,
} from "./types";

/**
 * Reads all 9 keys and shapes them into exactly what buildReport()'s
 * (shared/sync/delta.ts) 4th "resolution" param expects.
 */
export async function loadResolutionData(): Promise<Required<Omit<ResolutionData, "allowFuzzyMemberMatches">>> {
  const stored = await local.get([
    "memberLinks",
    "memberRejectedPairs",
    "clubLookup",
    "clubRejectedPairs",
    "memberOrphans",
    "pathLookup",
    "memberPathOverrides",
    "memberPathExclusions",
    "memberPathOrphans",
    "memberPathFlags",
  ]);
  const pathLookup = await ensurePathLookupSeeded(stored.pathLookup);

  return {
    memberLinks: stored.memberLinks ?? [],
    rejectedPairs: stored.memberRejectedPairs ?? [],
    clubLookup: stored.clubLookup ?? [],
    clubRejectedPairs: stored.clubRejectedPairs ?? [],
    memberOrphans: stored.memberOrphans ?? [],
    memberPathOverrides: stored.memberPathOverrides ?? [],
    memberPathExclusions: stored.memberPathExclusions ?? [],
    memberPathOrphans: stored.memberPathOrphans ?? [],
    memberPathFlags: stored.memberPathFlags ?? [],
    pathAliasLookup: buildPathAliasLookup(pathLookup),
  };
}

/**
 * The Settings page's raw, editable form of the path lookup (canonical name
 * -> alias list), seeded from the hardcoded PATH_ALIASES the first time it's
 * read so the already-verified aliases don't regress.
 */
export async function getPathLookup(): Promise<PathLookup> {
  const pathLookup = await local.value("pathLookup");
  return ensurePathLookupSeeded(pathLookup);
}

async function ensurePathLookupSeeded(pathLookup: PathLookup | undefined): Promise<PathLookup> {
  if (pathLookup && Object.keys(pathLookup).length > 0) return pathLookup;
  await local.set({ pathLookup: PATH_ALIASES });
  return PATH_ALIASES;
}

export async function getClubLookup(): Promise<ClubLookupEntry[]> {
  const clubLookup = await local.value("clubLookup");
  return clubLookup ?? [];
}

export async function confirmMemberLink(basecampUserId: number, easyspeakMemberId: string, source: MatchSource): Promise<void> {
  const memberLinks = await local.value("memberLinks");
  const filtered = (memberLinks ?? []).filter(
    (link) => link.basecampUserId !== basecampUserId && link.easyspeakMemberId !== easyspeakMemberId
  );
  const entry: MemberLink = { basecampUserId, easyspeakMemberId, source, confirmedAt: Date.now() };
  filtered.push(entry);
  await local.set({ memberLinks: filtered });
}

/**
 * The "Unlink" action for a manually-confirmed member — frees both sides to
 * be re-matched/re-linked from scratch on the next refresh. Does NOT reject
 * the pair, so an exact/fuzzy re-match can still recur; pair it with
 * rejectMemberPair() if that's also wanted.
 */
export async function unlinkMember(basecampUserId: number, easyspeakMemberId: string): Promise<void> {
  const memberLinks = await local.value("memberLinks");
  const filtered = (memberLinks ?? []).filter(
    (link) => !(link.basecampUserId === basecampUserId && link.easyspeakMemberId === easyspeakMemberId)
  );
  await local.set({ memberLinks: filtered });
}

export async function rejectMemberPair(basecampUserId: number, easyspeakMemberId: string): Promise<void> {
  const memberRejectedPairs = await local.value("memberRejectedPairs");
  const existing = memberRejectedPairs ?? [];
  const alreadyRejected = existing.some((r) => r.basecampUserId === basecampUserId && r.easyspeakMemberId === easyspeakMemberId);
  if (alreadyRejected) return;
  const entry: RejectedPair = { basecampUserId, easyspeakMemberId, rejectedAt: Date.now() };
  await local.set({ memberRejectedPairs: [...existing, entry] });
}

/**
 * Confirms a one-sided member (basecampUserId XOR easyspeakMemberId is
 * non-null — whichever side actually has data) genuinely has no counterpart,
 * so it stops counting as outstanding work everywhere (Members' "To
 * do"/unmatched counts, Report's "Missing Matches" KPI and conflict banner).
 */
export async function markMemberOrphan(basecampUserId: number | null, easyspeakMemberId: string | null): Promise<void> {
  const memberOrphans = await local.value("memberOrphans");
  const existing = memberOrphans ?? [];
  const already = existing.some((o) => o.basecampUserId === basecampUserId && o.easyspeakMemberId === easyspeakMemberId);
  if (already) return;
  const entry: MemberOrphan = { basecampUserId, easyspeakMemberId, orphanedAt: Date.now() };
  await local.set({ memberOrphans: [...existing, entry] });
}

/** The "Unmark orphan" action — returns the member to the normal unmatched state. */
export async function unmarkMemberOrphan(basecampUserId: number | null, easyspeakMemberId: string | null): Promise<void> {
  const memberOrphans = await local.value("memberOrphans");
  const filtered = (memberOrphans ?? []).filter((o) => !(o.basecampUserId === basecampUserId && o.easyspeakMemberId === easyspeakMemberId));
  await local.set({ memberOrphans: filtered });
}

/**
 * @param basecampPathName raw, verbatim member.path_name
 * @param easyspeakPathLabel raw, verbatim member.path
 */
export async function setMemberPathOverride(
  basecampUserId: number,
  easyspeakMemberId: string,
  basecampPathName: string,
  easyspeakPathLabel: string
): Promise<void> {
  const memberPathOverrides = await local.value("memberPathOverrides");
  const filtered = (memberPathOverrides ?? []).filter(
    (o) =>
      !(
        o.basecampUserId === basecampUserId &&
        o.easyspeakMemberId === easyspeakMemberId &&
        o.basecampPathName === basecampPathName &&
        o.easyspeakPathLabel === easyspeakPathLabel
      )
  );
  const entry: MemberPathOverride = { basecampUserId, easyspeakMemberId, basecampPathName, easyspeakPathLabel, boundAt: Date.now() };
  filtered.push(entry);
  await local.set({ memberPathOverrides: filtered });
}

/**
 * The "Unbind" action for a manually-bound path pair — removes the override
 * so the pair goes back through normal canonicalization (may re-match
 * automatically if the names happen to canonicalize the same, or fall back
 * to orphaned again if not).
 */
export async function removeMemberPathOverride(
  basecampUserId: number,
  easyspeakMemberId: string,
  basecampPathName: string,
  easyspeakPathLabel: string
): Promise<void> {
  const memberPathOverrides = await local.value("memberPathOverrides");
  const filtered = (memberPathOverrides ?? []).filter(
    (o) =>
      !(
        o.basecampUserId === basecampUserId &&
        o.easyspeakMemberId === easyspeakMemberId &&
        o.basecampPathName === basecampPathName &&
        o.easyspeakPathLabel === easyspeakPathLabel
      )
  );
  await local.set({ memberPathOverrides: filtered });
}

/**
 * The "Force unbind" action for a path pair that matched *automatically*
 * (via canonicalization, not an override) — there's nothing to delete for
 * an automatic match, so this instead records a member-scoped exclusion
 * that keeps this specific pair from being auto-paired again, splitting it
 * back into two independently-orphaned paths the user can then resolve
 * manually (bind to something else, or leave as orphan). Member-scoped, not
 * global — doesn't touch pathLookup or affect any other member.
 * @param basecampPathName raw, verbatim member.path_name
 * @param easyspeakPathLabel raw, verbatim member.path
 */
export async function excludePathMatch(
  basecampUserId: number,
  easyspeakMemberId: string,
  basecampPathName: string,
  easyspeakPathLabel: string
): Promise<void> {
  const memberPathExclusions = await local.value("memberPathExclusions");
  const existing = memberPathExclusions ?? [];
  const alreadyExcluded = existing.some(
    (e) =>
      e.basecampUserId === basecampUserId &&
      e.easyspeakMemberId === easyspeakMemberId &&
      e.basecampPathName === basecampPathName &&
      e.easyspeakPathLabel === easyspeakPathLabel
  );
  if (alreadyExcluded) return;
  const entry: MemberPathExclusion = { basecampUserId, easyspeakMemberId, basecampPathName, easyspeakPathLabel, excludedAt: Date.now() };
  await local.set({ memberPathExclusions: [...existing, entry] });
}

/**
 * Confirms a single-sided path (basecampPathName XOR easyspeakPathLabel is
 * non-null — whichever side actually has the path) genuinely has no
 * counterpart for this member, so it stops counting toward
 * hasOrphanedPaths() — the path-level counterpart of markMemberOrphan().
 */
export async function markPathOrphan(
  basecampUserId: number,
  easyspeakMemberId: string,
  basecampPathName: string | null,
  easyspeakPathLabel: string | null
): Promise<void> {
  const memberPathOrphans = await local.value("memberPathOrphans");
  const existing = memberPathOrphans ?? [];
  const already = existing.some(
    (o) =>
      o.basecampUserId === basecampUserId &&
      o.easyspeakMemberId === easyspeakMemberId &&
      o.basecampPathName === basecampPathName &&
      o.easyspeakPathLabel === easyspeakPathLabel
  );
  if (already) return;
  const entry: MemberPathOrphan = { basecampUserId, easyspeakMemberId, basecampPathName, easyspeakPathLabel, orphanedAt: Date.now() };
  await local.set({ memberPathOrphans: [...existing, entry] });
}

/** The "Unmark orphan" action — returns the path to the normal orphan/bind-picker state. */
export async function unmarkPathOrphan(
  basecampUserId: number,
  easyspeakMemberId: string,
  basecampPathName: string | null,
  easyspeakPathLabel: string | null
): Promise<void> {
  const memberPathOrphans = await local.value("memberPathOrphans");
  const filtered = (memberPathOrphans ?? []).filter(
    (o) =>
      !(
        o.basecampUserId === basecampUserId &&
        o.easyspeakMemberId === easyspeakMemberId &&
        o.basecampPathName === basecampPathName &&
        o.easyspeakPathLabel === easyspeakPathLabel
      )
  );
  await local.set({ memberPathOrphans: filtered });
}

/**
 * Confirms a single-sided path (basecampPathName XOR easyspeakPathLabel is
 * non-null) has been reviewed but deliberately left unresolved — neither
 * bound nor a genuine orphan yet (e.g. the member looks mid-transition
 * between paths). Unlike markPathOrphan(), this is NOT a resolution: it
 * stops the path counting toward hasOrphanedPaths()/"To do" (same effect as
 * an orphan mark) but does not tag the member "resolved-manually" — see
 * hasFlaggedPaths()/classifyMember() in shared/sync/delta.ts.
 */
export async function flagPath(
  basecampUserId: number,
  easyspeakMemberId: string,
  basecampPathName: string | null,
  easyspeakPathLabel: string | null
): Promise<void> {
  const memberPathFlags = await local.value("memberPathFlags");
  const existing = memberPathFlags ?? [];
  const already = existing.some(
    (f) =>
      f.basecampUserId === basecampUserId &&
      f.easyspeakMemberId === easyspeakMemberId &&
      f.basecampPathName === basecampPathName &&
      f.easyspeakPathLabel === easyspeakPathLabel
  );
  if (already) return;
  const entry: MemberPathFlag = { basecampUserId, easyspeakMemberId, basecampPathName, easyspeakPathLabel, flaggedAt: Date.now() };
  await local.set({ memberPathFlags: [...existing, entry] });
}

/** The "Unflag" action — returns the path to the normal orphan/bind-picker state. */
export async function unflagPath(
  basecampUserId: number,
  easyspeakMemberId: string,
  basecampPathName: string | null,
  easyspeakPathLabel: string | null
): Promise<void> {
  const memberPathFlags = await local.value("memberPathFlags");
  const filtered = (memberPathFlags ?? []).filter(
    (f) =>
      !(
        f.basecampUserId === basecampUserId &&
        f.easyspeakMemberId === easyspeakMemberId &&
        f.basecampPathName === basecampPathName &&
        f.easyspeakPathLabel === easyspeakPathLabel
      )
  );
  await local.set({ memberPathFlags: filtered });
}

/** @param basecampClubName / easyspeakClubName denormalized, for Settings display only */
export async function pinClub(
  basecampClubId: string,
  easyspeakClubId: string,
  basecampClubName: string,
  easyspeakClubName: string,
  source: MatchSource = "manual-search"
): Promise<void> {
  const clubLookup = await local.value("clubLookup");
  const filtered = (clubLookup ?? []).filter((pin) => pin.basecampClubId !== basecampClubId && pin.easyspeakClubId !== easyspeakClubId);
  const entry: ClubLookupEntry = { basecampClubId, easyspeakClubId, basecampClubName, easyspeakClubName, source };
  filtered.push(entry);
  await local.set({ clubLookup: filtered });
}

export async function removeClubPin(basecampClubId: string): Promise<void> {
  const clubLookup = await local.value("clubLookup");
  const filtered = (clubLookup ?? []).filter((pin) => pin.basecampClubId !== basecampClubId);
  await local.set({ clubLookup: filtered });
}

export async function getClubRejectedPairs(): Promise<ClubRejectedPair[]> {
  const pairs = await local.value("clubRejectedPairs");
  return pairs ?? [];
}

/**
 * The "Unlink" action for a club pairing that has nothing stored to delete —
 * an "exact" name match, like a member's, is recomputed fresh every call, so
 * rejecting the pair is the only way to keep it from immediately re-matching.
 * Also doubles as the persisted "Not this one" for a fuzzy club suggestion.
 */
export async function rejectClubPair(basecampClubId: string, easyspeakClubId: string): Promise<void> {
  const clubRejectedPairs = await local.value("clubRejectedPairs");
  const existing = clubRejectedPairs ?? [];
  const alreadyRejected = existing.some((r) => r.basecampClubId === basecampClubId && r.easyspeakClubId === easyspeakClubId);
  if (alreadyRejected) return;
  const entry: ClubRejectedPair = { basecampClubId, easyspeakClubId, rejectedAt: Date.now() };
  await local.set({ clubRejectedPairs: [...existing, entry] });
}

/**
 * Replaces the full alias list for a canonical path name (Settings' "edit"
 * action) — creates the canonical entry if it doesn't exist yet.
 */
export async function setPathAliases(canonicalName: string, aliases: string[]): Promise<void> {
  const pathLookup = await getPathLookup();
  pathLookup[canonicalName] = aliases;
  await local.set({ pathLookup });
}

export async function deletePathCanonical(canonicalName: string): Promise<void> {
  const pathLookup = await getPathLookup();
  delete pathLookup[canonicalName];
  await local.set({ pathLookup });
}
