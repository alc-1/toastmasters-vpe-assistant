// src/shared/resolution-store.ts
//
// Storage I/O for the 6 persisted name-resolution keys (memberLinks,
// memberRejectedPairs, clubLookup, pathLookup, memberPathOverrides,
// memberPathExclusions). Unlike shared/sync/*, this file is legitimately
// chrome.*-dependent (pure storage I/O), so it isn't Vitest-testable — same
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
  MemberLink,
  MemberPathExclusion,
  MemberPathOverride,
  MatchSource,
  PathLookup,
  RejectedPair,
  ResolutionData,
} from "./types";

/**
 * Reads all 6 keys and shapes them into exactly what buildReport()'s
 * (shared/sync/delta.ts) 4th "resolution" param expects.
 */
export async function loadResolutionData(): Promise<Required<Omit<ResolutionData, "allowFuzzyMemberMatches">>> {
  const stored = await local.get([
    "memberLinks",
    "memberRejectedPairs",
    "clubLookup",
    "pathLookup",
    "memberPathOverrides",
    "memberPathExclusions",
  ]);
  const pathLookup = await ensurePathLookupSeeded(stored.pathLookup);

  return {
    memberLinks: stored.memberLinks ?? [],
    rejectedPairs: stored.memberRejectedPairs ?? [],
    clubLookup: stored.clubLookup ?? [],
    memberPathOverrides: stored.memberPathOverrides ?? [],
    memberPathExclusions: stored.memberPathExclusions ?? [],
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

/** @param basecampClubName / easyspeakClubName denormalized, for Settings display only */
export async function pinClub(
  basecampClubId: string,
  easyspeakClubId: string,
  basecampClubName: string,
  easyspeakClubName: string
): Promise<void> {
  const clubLookup = await local.value("clubLookup");
  const filtered = (clubLookup ?? []).filter((pin) => pin.basecampClubId !== basecampClubId && pin.easyspeakClubId !== easyspeakClubId);
  const entry: ClubLookupEntry = { basecampClubId, easyspeakClubId, basecampClubName, easyspeakClubName };
  filtered.push(entry);
  await local.set({ clubLookup: filtered });
}

export async function removeClubPin(basecampClubId: string): Promise<void> {
  const clubLookup = await local.value("clubLookup");
  const filtered = (clubLookup ?? []).filter((pin) => pin.basecampClubId !== basecampClubId);
  await local.set({ clubLookup: filtered });
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
