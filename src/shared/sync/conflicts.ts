// src/shared/sync/conflicts.ts
//
// Name/path/member matching + override logic — the half of the former
// lib/report.js concerned with deciding WHICH Basecamp and EasySpeak records
// pair up, not with what their differences mean. No chrome.* dependency at
// all, same reasoning as the rest of shared/: keeps this usable outside the
// browser (Vitest) and keeps every options page thin DOM glue around it.
//
// Basecamp and EasySpeak agree on nothing structurally: club ids live in
// different id spaces (GUID vs numeric) with no shared key, members have no
// shared id at all, and both club/member/path names are spelled differently
// across the two systems (including French/German localization on
// EasySpeak). So every level of this pipeline (club -> member -> path) is a
// best-effort name-similarity match, not a join.
//
// diffLevel/diffLevels and buildPathCompletion live here rather than in
// delta.ts, even though they compute *differences* — matchPaths() calls them
// directly while deciding path pairs (to populate each pair's `levels`/
// `pathCompletion` fields), and delta.ts is the one importing FROM this
// file, never the reverse. Moving them to delta.ts would create a
// delta -> conflicts -> delta cycle.

import type {
  BasecampProgression,
  ClubLookupEntry,
  ClubOrphan,
  ClubRejectedPair,
  EasySpeakLevel,
  LevelDiff,
  MemberLink,
  MemberOrphan,
  MemberPathCompletion,
  MemberPathExclusion,
  MemberPathFlag,
  MemberPathOrphan,
  MemberPathOverride,
  MatchConfidence,
  MatchSource,
  PathCompletion,
  PathReport,
  RejectedPair,
} from "../types";

export const NAME_MATCH_THRESHOLD = 0.72;

// clubNameScore() is plain Jaccard token-overlap (no edit-distance blending
// like member matching's nameScore()), so this is a conservative, adjustable
// starting point rather than a tuned constant.
export const CLUB_FUZZY_THRESHOLD = 0.5;

// Canonical English Pathways path name -> known alternate spellings (FR/DE)
// that should normalize to it. Entries marked "confirmed" were seen
// verbatim in real scraped data; the rest are unverified best-effort
// translations of the official Pathways titles and have NOT been
// independently checked — review/correct before trusting a cross-language
// match you haven't manually spot-checked.
export const PATH_ALIASES: Record<string, string[]> = {
  "dynamic leadership": ["leadership dynamique", "dynamische fuhrung"], // both confirmed
  "effective coaching": ["coaching efficace", "effektives coaching"],
  "engaging humor": ["humour engageant", "mitreissender humor"],
  "innovative planning": ["planification innovante", "innovative planung"],
  "leadership development": ["developpement du leadership", "fuhrungsentwicklung"],
  "motivational strategies": ["strategies de motivation", "motivationsstrategien"], // FR confirmed
  "persuasive influence": ["influence persuasive", "uberzeugende einflussnahme"],
  "presentation mastery": ["maitrisez vos presentations", "beherrschen von prasentationen"], // both confirmed
  "strategic relationships": ["relations strategiques", "strategische beziehungen"],
  "team collaboration": ["collaboration en equipe", "teamzusammenarbeit"],
  "visionary communication": ["communication visionnaire", "visionare kommunikation"],
};

const NON_PATHWAY_NAMES = new Set(["speechcraft", "distinguished toastmaster", "pathways mentor program"]);

export function buildPathAliasLookup(aliasTable: Record<string, string[]>): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(aliasTable)) {
    lookup.set(canonical, canonical);
    for (const alias of aliases) lookup.set(alias, canonical);
  }
  return lookup;
}

export const PATH_ALIAS_LOOKUP = buildPathAliasLookup(PATH_ALIASES);

// ---------------------------------------------------------------------------
// Grouped person/club shapes — the input this module's matching functions
// consume, produced by shared/sync/delta.ts's groupBasecampMembers()/
// groupEasySpeakMembers() before matchClubs()/matchMembers() ever run.
// ---------------------------------------------------------------------------

export interface BasecampPersonPath {
  path_name: string;
  progression: BasecampProgression;
}

export interface BasecampPerson {
  userId: number;
  name: string;
  paths: BasecampPersonPath[];
}

export interface EasySpeakPersonPath {
  path: string;
  levels: EasySpeakLevel[];
}

export interface EasySpeakPerson {
  memberId: string;
  name: string | null;
  paths: EasySpeakPersonPath[];
}

export interface ClubGroup<P> {
  id: string;
  name: string;
  people: P[];
}

// ---------------------------------------------------------------------------
// Generic greedy 1:1 assignment, shared by club and member matching
// ---------------------------------------------------------------------------

interface Candidate {
  aKey: unknown;
  bKey: unknown;
  score: number | null;
  [key: string]: unknown;
}

/**
 * @param candidates sorted desc by score
 * @param preAssigned persisted decisions (confirmed links, club pins)
 *   claimed before any candidate is considered, so a fresh high-scoring
 *   candidate can never displace them.
 */
function greedyAssign<C extends Candidate>(candidates: C[], preAssigned: C[] = []): C[] {
  const usedA = new Set<unknown>();
  const usedB = new Set<unknown>();
  const assigned: C[] = [];
  for (const candidate of [...preAssigned, ...candidates]) {
    if (usedA.has(candidate.aKey) || usedB.has(candidate.bKey)) continue;
    assigned.push(candidate);
    usedA.add(candidate.aKey);
    usedB.add(candidate.bKey);
  }
  return assigned;
}

// ---------------------------------------------------------------------------
// Club matching
// ---------------------------------------------------------------------------

function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeClubName(name: string): string {
  return stripAccents(name)
    .toLowerCase()
    .replace(/[,.\-–]/g, " ")
    .replace(/\btoastmasters\b/g, " ")
    .replace(/\bclub\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(str: string): Set<string> {
  return new Set(str.split(" ").filter(Boolean));
}

function jaccard(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;
  const intersectionSize = [...setA].filter((token) => setB.has(token)).length;
  const unionSize = new Set([...setA, ...setB]).size;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

export function clubNameScore(nameA: string, nameB: string): number {
  return jaccard(tokenSet(normalizeClubName(nameA)), tokenSet(normalizeClubName(nameB)));
}

export interface ClubMatchPair<BC, ES> {
  basecamp: BC | null;
  easyspeak: ES | null;
  score: number | null;
  confidence: MatchConfidence;
  source: MatchSource;
}

/**
 * @param clubLookup persisted club ID pins — forced 1:1, regardless of name.
 * @param rejectedPairs persisted "known non-match" pairs — excluded from
 *   candidate generation entirely, so they can never resurface as a
 *   suggestion (also how an "exact" match, which has nothing stored to
 *   delete, gets permanently unlinked — see rejectClubPair()).
 * @param allowFuzzy when false (the default — used by delta.ts's buildReport,
 *   consumed by Report/Members), fuzzy-confidence candidates are dropped
 *   from the pool entirely, so an unconfirmed club-name guess never silently
 *   joins two clubs' rosters. Settings' own Club Lookup review table is the
 *   only caller that passes true, mirroring how options/members.ts relies on
 *   matchMembers()'s fuzzy default while options/report.ts opts out.
 * @param orphans persisted "confirmed — this side genuinely has no
 *   counterpart" decisions (e.g. a club not yet using the other tool).
 *   Applied only to whoever is still unassigned after matching/greedy-
 *   assignment runs, so it never blocks a real match: if a genuine
 *   counterpart later appears (e.g. after a re-scrape), it wins the normal
 *   way and the stale orphan record just becomes inert. Mirrors
 *   matchMembers()'s own `orphans` param.
 */
export function matchClubs<BC extends ClubGroup<unknown>, ES extends ClubGroup<unknown>>(
  basecampClubs: BC[],
  easyspeakClubs: ES[],
  clubLookup: ClubLookupEntry[] = [],
  rejectedPairs: ClubRejectedPair[] = [],
  allowFuzzy = false,
  orphans: ClubOrphan[] = []
): ClubMatchPair<BC, ES>[] {
  const bcById = new Map(basecampClubs.map((c) => [c.id, c]));
  const esById = new Map(easyspeakClubs.map((c) => [c.id, c]));

  const preAssigned: (Candidate & { confidence: MatchConfidence; source: MatchSource })[] = [];
  for (const pin of clubLookup) {
    if (bcById.has(pin.basecampClubId) && esById.has(pin.easyspeakClubId)) {
      preAssigned.push({ aKey: pin.basecampClubId, bKey: pin.easyspeakClubId, score: null, confidence: "confirmed", source: pin.source ?? null });
    }
  }

  const rejectedSet = new Set(rejectedPairs.map((r) => `${r.basecampClubId}::${r.easyspeakClubId}`));

  const candidates: (Candidate & { confidence: MatchConfidence; source: MatchSource })[] = [];
  for (const bc of basecampClubs) {
    for (const es of easyspeakClubs) {
      if (rejectedSet.has(`${bc.id}::${es.id}`)) continue;
      const score = clubNameScore(bc.name, es.name);
      if (score === 1) {
        candidates.push({ aKey: bc.id, bKey: es.id, score, confidence: "exact", source: null });
      } else if (allowFuzzy && score >= CLUB_FUZZY_THRESHOLD) {
        candidates.push({ aKey: bc.id, bKey: es.id, score, confidence: "fuzzy", source: null });
      }
    }
  }
  candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const assigned = greedyAssign(candidates, preAssigned);

  const matchedBcIds = new Set(assigned.map((a) => a.aKey));
  const matchedEsIds = new Set(assigned.map((a) => a.bKey));

  const pairs: ClubMatchPair<BC, ES>[] = assigned.map((a) => ({
    basecamp: bcById.get(a.aKey as string) ?? null,
    easyspeak: esById.get(a.bKey as string) ?? null,
    score: a.score,
    confidence: a.confidence,
    source: a.source,
  }));
  const orphanedBcIds = new Set(orphans.filter((o) => o.basecampClubId != null).map((o) => o.basecampClubId));
  const orphanedEsIds = new Set(orphans.filter((o) => o.easyspeakClubId != null).map((o) => o.easyspeakClubId));

  for (const bc of basecampClubs) {
    if (!matchedBcIds.has(bc.id)) {
      const isOrphan = orphanedBcIds.has(bc.id);
      pairs.push({ basecamp: bc, easyspeak: null, score: null, confidence: isOrphan ? "confirmed" : null, source: isOrphan ? "orphan" : null });
    }
  }
  for (const es of easyspeakClubs) {
    if (!matchedEsIds.has(es.id)) {
      const isOrphan = orphanedEsIds.has(es.id);
      pairs.push({ basecamp: null, easyspeak: es, score: null, confidence: isOrphan ? "confirmed" : null, source: isOrphan ? "orphan" : null });
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Member matching (within a matched club pair)
// ---------------------------------------------------------------------------

export function normalizeName(rawName: string): string {
  // Drop everything after a comma first — that's where EasySpeak sticks
  // honorific/designation tails ("Godela U. Bittcher, CC CL DL5").
  let name = rawName.split(",")[0].trim();

  // Then strip trailing level-progress codes like "PM1", "DL3" (can repeat,
  // e.g. "Nigel Thew PM5 PI5" once the comma-tail case doesn't already
  // handle it).
  let tokens = name.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && /^[A-Z]{1,3}\d$/.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  name = tokens.join(" ");

  name = stripAccents(name)
    .toLowerCase()
    .replace(/['’.\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Sort tokens so word order doesn't matter ("Robert O'Riordan" ==
  // "O'Riordan Robert").
  return name.split(" ").filter(Boolean).sort().join(" ");
}

export function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export interface NameScoreResult {
  score: number;
  confidence: "exact" | "fuzzy" | null;
}

export function nameScore(rawA: string, rawB: string): NameScoreResult {
  const a = normalizeName(rawA);
  const b = normalizeName(rawB);
  if (a === b) return { score: 1, confidence: "exact" };

  const jaccardScore = jaccard(tokenSet(a), tokenSet(b));
  const maxLen = Math.max(a.length, b.length) || 1;
  const editSimilarity = 1 - levenshtein(a, b) / maxLen;
  // Weighted toward edit similarity: a single-character typo in one token
  // (e.g. "Schoetzer"/"Schötzer", "Achi"/"Achy") zeroes out that token's
  // Jaccard overlap entirely even though the strings are nearly identical,
  // so a 50/50 blend punishes minor misspellings far more than intended.
  const score = 0.3 * jaccardScore + 0.7 * editSimilarity;
  return { score, confidence: score >= NAME_MATCH_THRESHOLD ? "fuzzy" : null };
}

export interface MemberMatchPair<BC, ES> {
  basecamp: BC | null;
  easyspeak: ES | null;
  confidence: MatchConfidence;
  score: number | null;
  source: MatchSource;
}

/**
 * @param memberLinks persisted confirmed links — forced 1:1, never re-scored.
 * @param rejectedPairs persisted "known non-match" pairs — excluded from
 *   candidate generation entirely, so they can never resurface as a
 *   suggestion.
 * @param allowFuzzy when false, fuzzy-confidence candidates are dropped from
 *   the pool entirely (falling through to the normal leftover handling
 *   below, i.e. reported as unmatched) — used by options/report.ts so an
 *   unconfirmed guess never renders there as if it were a fact. Exact
 *   matches and confirmed links are unaffected either way.
 * @param orphans persisted "confirmed — this side genuinely has no
 *   counterpart" decisions. Applied only to whoever is still unassigned
 *   after matching/greedy-assignment runs, so it never blocks a real match:
 *   if a genuine counterpart later appears (e.g. after a re-scrape), it wins
 *   the normal way and the stale orphan record just becomes inert.
 */
export function matchMembers(
  basecampPeople: BasecampPerson[],
  easyspeakPeople: EasySpeakPerson[],
  memberLinks: MemberLink[] = [],
  rejectedPairs: RejectedPair[] = [],
  allowFuzzy = true,
  orphans: MemberOrphan[] = []
): MemberMatchPair<BasecampPerson, EasySpeakPerson>[] {
  const bcById = new Map(basecampPeople.map((p) => [p.userId, p]));
  const esById = new Map(easyspeakPeople.map((p) => [p.memberId, p]));

  const preAssigned: (Candidate & { confidence: MatchConfidence; source: MatchSource })[] = [];
  for (const link of memberLinks) {
    if (bcById.has(link.basecampUserId) && esById.has(link.easyspeakMemberId)) {
      preAssigned.push({
        aKey: link.basecampUserId,
        bKey: link.easyspeakMemberId,
        score: null,
        confidence: "confirmed",
        source: link.source,
      });
    }
  }

  const rejectedSet = new Set(rejectedPairs.map((r) => `${r.basecampUserId}::${r.easyspeakMemberId}`));

  const candidates: (Candidate & { confidence: MatchConfidence; source: MatchSource })[] = [];
  for (const bc of basecampPeople) {
    for (const es of easyspeakPeople) {
      if (rejectedSet.has(`${bc.userId}::${es.memberId}`)) continue;
      const { score, confidence } = nameScore(bc.name, es.name ?? "");
      if (confidence === "exact" || (confidence === "fuzzy" && allowFuzzy)) {
        candidates.push({ aKey: bc.userId, bKey: es.memberId, score, confidence, source: null });
      }
    }
  }
  candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const assigned = greedyAssign(candidates, preAssigned);

  const matchedBcIds = new Set(assigned.map((a) => a.aKey));
  const matchedEsIds = new Set(assigned.map((a) => a.bKey));

  const pairs: MemberMatchPair<BasecampPerson, EasySpeakPerson>[] = assigned.map((a) => ({
    basecamp: bcById.get(a.aKey as number) ?? null,
    easyspeak: esById.get(a.bKey as string) ?? null,
    confidence: a.confidence,
    score: a.score,
    source: a.source ?? null,
  }));
  const orphanedBcIds = new Set(orphans.filter((o) => o.basecampUserId != null).map((o) => o.basecampUserId));
  const orphanedEsIds = new Set(orphans.filter((o) => o.easyspeakMemberId != null).map((o) => o.easyspeakMemberId));

  for (const bc of basecampPeople) {
    if (!matchedBcIds.has(bc.userId)) {
      const isOrphan = orphanedBcIds.has(bc.userId);
      pairs.push({ basecamp: bc, easyspeak: null, confidence: isOrphan ? "confirmed" : null, score: null, source: isOrphan ? "orphan" : null });
    }
  }
  for (const es of easyspeakPeople) {
    if (!matchedEsIds.has(es.memberId)) {
      const isOrphan = orphanedEsIds.has(es.memberId);
      pairs.push({ basecamp: null, easyspeak: es, confidence: isOrphan ? "confirmed" : null, score: null, source: isOrphan ? "orphan" : null });
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Path matching (within a matched member)
// ---------------------------------------------------------------------------

export interface CanonicalizedPathName {
  key: string;
  nonPathway: boolean;
}

/**
 * @param pathAliasLookup defaults to the hardcoded PATH_ALIASES table;
 *   callers pass the user-editable pathLookup (converted via
 *   buildPathAliasLookup) to override/extend it without touching source.
 */
export function canonicalizePathName(rawPath: string, pathAliasLookup: Map<string, string> = PATH_ALIAS_LOOKUP): CanonicalizedPathName {
  const name = stripAccents(
    rawPath
      .replace(/\s*\(\d{4}(-\d{2})?\)\s*$/, "") // EasySpeak version suffix: (2021-10), (2017)
      .replace(/\s*\(optional\)\s*$/i, "") // EasySpeak "(optional)" suffix, e.g. Pathways Mentor Program
      .replace(/\s*\((French|German)\)\s*$/i, "") // Basecamp language-tag suffix
  )
    .toLowerCase()
    .trim();

  if (NON_PATHWAY_NAMES.has(name)) return { key: name, nonPathway: true };

  const canonical = pathAliasLookup.get(name);
  return { key: canonical ?? name, nonPathway: false };
}

const PATHWAYS_LEVEL_COUNT = 5;

// "No active path" means EasySpeak literally has no path name recorded for
// this member (the mock Carla Mendes case: `path: ""`) — not merely that a
// path's levels compute to all-zero-needed, since that's also exactly how a
// *completed* path reads (see isCompletedEasySpeakHistory below). Using the
// needed-count signal here would make hasNoActivePath swallow a member's
// only EasySpeak path before matchPaths() ever gets a chance to tag it as
// completed history instead of discarding it outright.
function hasNoActivePath(easyspeakPaths: EasySpeakPersonPath[]): boolean {
  return easyspeakPaths.length === 0 || easyspeakPaths.every((p) => !p.path.trim());
}

// Basecamp's live progress extraction only returns a member's currently-
// active path(s) — a path they already completed drops out of Basecamp
// entirely, while EasySpeak keeps the full history. An easyspeak-only path
// whose every level is fully satisfied (`done >= needed`) is that completed
// history showing up with no Basecamp counterpart, not a genuine mismatch a
// human needs to reconcile. This covers both a path EasySpeak reports as
// `needed: 0` everywhere (0 >= 0 still holds) and one with real non-zero
// counts that have all been met. `levels.length > 0` keeps this from ever
// matching a nonPathway path (which always has `levels: []` below).
function isCompletedEasySpeakHistory(es: EasySpeakPersonPath, nonPathway: boolean): boolean {
  return !nonPathway && es.levels.length > 0 && es.levels.every((l) => l.done >= l.needed);
}

function buildPathCompletion(bc: BasecampPersonPath | null): PathCompletion | null {
  const completion = bc?.progression?.["Path Completion"];
  if (!completion) return null;
  return {
    completed: completion.completed,
    total: completion.total,
    missing: Math.max(0, completion.total - completion.completed),
  };
}

export function diffLevel(level: number, esLevel: EasySpeakLevel | null, bcLevel: { completed: number; total: number; approved?: boolean } | null): LevelDiff {
  const easyspeak = esLevel ? { needed: esLevel.needed, done: esLevel.done } : null;
  const basecamp = bcLevel ? { completed: bcLevel.completed, total: bcLevel.total, approved: !!bcLevel.approved } : null;

  const easyspeakMissing = easyspeak ? Math.max(0, easyspeak.needed - easyspeak.done) : null;
  const basecampMissing = basecamp ? Math.max(0, basecamp.total - basecamp.completed) : null;
  const discrepancy = easyspeak && basecamp ? easyspeak.done - basecamp.completed : null;

  // Basecamp is the source of truth for how many speeches a level needs —
  // EasySpeak's own needed-count (esLevel.needed) is never trusted to decide
  // "done". Instead, EasySpeak's done-count is compared against Basecamp's
  // own total: if EasySpeak already has at least as many speeches logged as
  // Basecamp requires, the level is pending validation even before Basecamp
  // catches up, since it's Basecamp's requirement that's authoritative, not
  // EasySpeak's idea of what's needed.
  const basecampDone = basecamp ? basecamp.completed >= basecamp.total : false;
  const easyspeakMeetsBasecampRequirement = basecamp && easyspeak ? easyspeak.done >= basecamp.total : false;
  const pendingValidation = !!(basecamp && !basecamp.approved && (basecampDone || easyspeakMeetsBasecampRequirement));

  return { level, easyspeak, basecamp, easyspeakMissing, basecampMissing, discrepancy, pendingValidation };
}

function diffLevels(esPath: EasySpeakPersonPath | null, bcPath: BasecampPersonPath | null): LevelDiff[] {
  const esByLevel = new Map((esPath?.levels ?? []).map((l) => [l.level, l]));
  const levels: LevelDiff[] = [];
  for (let level = 1; level <= PATHWAYS_LEVEL_COUNT; level++) {
    const es = esByLevel.get(level) ?? null;
    let bcLevel = bcPath?.progression?.[`Level ${level}`] ?? null;
    if (level === PATHWAYS_LEVEL_COUNT) {
      // EasySpeak has no separate "Path Completion" bucket — its Level 5
      // needed/done already counts the path-completion speeches alongside
      // Level 5's own. Basecamp tracks them as two separate progression
      // entries, so they're cumulated here purely for the comparison
      // against EasySpeak's Level 5 (buildPathCompletion() below still
      // reports the raw, un-cumulated Path Completion entry for its own
      // Basecamp-only display). `approved` is carried over from the Level 5
      // entry only — Path Completion has no approval flag of its own.
      const completion = bcPath?.progression?.["Path Completion"] ?? null;
      if (bcLevel || completion) {
        bcLevel = {
          completed: (bcLevel?.completed ?? 0) + (completion?.completed ?? 0),
          total: (bcLevel?.total ?? 0) + (completion?.total ?? 0),
          approved: bcLevel?.approved,
        };
      }
    }
    levels.push(diffLevel(level, es, bcLevel));
  }
  return levels;
}

export interface MatchPathsResult {
  paths: PathReport[];
  easyspeakNoActivePath: boolean;
}

/**
 * @param memberOverrides member-scoped path binds, already pre-filtered by
 *   the caller to this member pair — checked before the global path-name
 *   lookup, and never written back to it.
 * @param pathAliasLookup see canonicalizePathName.
 * @param memberExclusions member-scoped path exclusions, already
 *   pre-filtered by the caller to this member pair — the inverse of an
 *   override: forces a pair that would otherwise auto-match via
 *   canonicalization back into two independently-orphaned entries, so a
 *   wrongly-automatic pairing can be broken and re-resolved manually without
 *   touching the global path-name lookup other members rely on.
 * @param memberPathOrphans member-scoped "confirmed — this side genuinely has
 *   no counterpart" decisions, already pre-filtered by the caller to this
 *   member pair. Tags the matching single-sided PathReport with
 *   `orphaned: true` (never both/overridden entries, which by construction
 *   never reach this check) — see markPathOrphan() in
 *   shared/resolution-store.ts.
 * @param memberPathFlags member-scoped "reviewed, deliberately deferred"
 *   decisions, already pre-filtered by the caller to this member pair. Tags
 *   the matching single-sided PathReport with `flagged: true` — a third,
 *   non-resolving state alongside orphaned — see flagPath() in
 *   shared/resolution-store.ts.
 * @param memberPathCompletions member-scoped "manually marked done" decisions
 *   for an easyspeak-only path, already pre-filtered by the caller to this
 *   member pair. Tags the matching PathReport with `manuallyCompleted: true`
 *   — see markPathCompleted() in shared/resolution-store.ts.
 */
export function matchPaths(
  basecampPerson: BasecampPerson | null,
  easyspeakPerson: EasySpeakPerson | null,
  memberOverrides: MemberPathOverride[] = [],
  pathAliasLookup: Map<string, string> = PATH_ALIAS_LOOKUP,
  memberExclusions: MemberPathExclusion[] = [],
  memberPathOrphans: MemberPathOrphan[] = [],
  memberPathFlags: MemberPathFlag[] = [],
  memberPathCompletions: MemberPathCompletion[] = []
): MatchPathsResult {
  const bcPaths = [...(basecampPerson?.paths ?? [])];
  const esPaths = [...(easyspeakPerson?.paths ?? [])];
  const paths: PathReport[] = [];

  // Overrides are spliced out of both raw lists first so the pair they bind
  // is force-matched and never also runs through normal canonicalization
  // below (which would otherwise treat them as two separate orphaned paths).
  memberOverrides.forEach((override, index) => {
    const bcIndex = bcPaths.findIndex((p) => p.path_name === override.basecampPathName);
    const esIndex = esPaths.findIndex((p) => p.path === override.easyspeakPathLabel);
    if (bcIndex === -1 || esIndex === -1) return;

    const [bc] = bcPaths.splice(bcIndex, 1);
    const [es] = esPaths.splice(esIndex, 1);

    paths.push({
      canonicalKey: `override:${index}`,
      displayName: bc.path_name,
      basecampPathName: bc.path_name,
      easyspeakPathLabel: es.path,
      presence: "both",
      nonPathway: false,
      overridden: true,
      orphaned: false,
      flagged: false,
      completedHistory: false,
      manuallyCompleted: false,
      levels: diffLevels(es, bc),
      pathCompletion: buildPathCompletion(bc),
    });
  });

  const isBasecampOrphaned = (pathName: string) =>
    memberPathOrphans.some((o) => o.basecampPathName === pathName && o.easyspeakPathLabel === null);
  const isEasyspeakOrphaned = (pathLabel: string) =>
    memberPathOrphans.some((o) => o.easyspeakPathLabel === pathLabel && o.basecampPathName === null);
  const isBasecampFlagged = (pathName: string) =>
    memberPathFlags.some((f) => f.basecampPathName === pathName && f.easyspeakPathLabel === null);
  const isEasyspeakFlagged = (pathLabel: string) =>
    memberPathFlags.some((f) => f.easyspeakPathLabel === pathLabel && f.basecampPathName === null);
  const isEasyspeakCompleted = (pathLabel: string) => memberPathCompletions.some((c) => c.easyspeakPathLabel === pathLabel);

  const bcByKey = new Map<string, BasecampPersonPath>();
  for (const p of bcPaths) {
    const { key } = canonicalizePathName(p.path_name, pathAliasLookup);
    bcByKey.set(key, p);
  }

  const esByKey = new Map<string, EasySpeakPersonPath & { nonPathway: boolean }>();
  const noActivePath = easyspeakPerson ? hasNoActivePath(easyspeakPerson.paths) : false;
  if (easyspeakPerson && !noActivePath) {
    for (const p of esPaths) {
      const { key, nonPathway } = canonicalizePathName(p.path, pathAliasLookup);
      esByKey.set(key, { ...p, nonPathway });
    }
  }

  const keys = new Set([...bcByKey.keys(), ...esByKey.keys()]);
  for (const key of keys) {
    const bc = bcByKey.get(key) ?? null;
    const es = esByKey.get(key) ?? null;
    const nonPathway = es?.nonPathway ?? false;

    const excluded =
      !!bc && !!es && memberExclusions.some((ex) => ex.basecampPathName === bc.path_name && ex.easyspeakPathLabel === es.path);

    if (excluded && bc && es) {
      // Force-split back into two independently-orphaned entries instead of
      // the single merged "both" entry canonicalization would otherwise
      // produce — see excludePathMatch() in shared/resolution-store.ts.
      paths.push({
        canonicalKey: `${key}:basecamp`,
        displayName: bc.path_name,
        basecampPathName: bc.path_name,
        easyspeakPathLabel: null,
        presence: "basecamp-only",
        nonPathway: false,
        overridden: false,
        orphaned: isBasecampOrphaned(bc.path_name),
        flagged: isBasecampFlagged(bc.path_name),
        completedHistory: false,
        manuallyCompleted: false,
        levels: diffLevels(null, bc),
        pathCompletion: buildPathCompletion(bc),
      });
      paths.push({
        canonicalKey: `${key}:easyspeak`,
        displayName: es.path,
        basecampPathName: null,
        easyspeakPathLabel: es.path,
        presence: "easyspeak-only",
        nonPathway,
        overridden: false,
        orphaned: isEasyspeakOrphaned(es.path),
        flagged: isEasyspeakFlagged(es.path),
        completedHistory: isCompletedEasySpeakHistory(es, nonPathway),
        manuallyCompleted: isEasyspeakCompleted(es.path),
        levels: nonPathway ? [] : diffLevels(es, null),
        pathCompletion: null,
      });
      continue;
    }

    const presence = bc && es ? "both" : bc ? "basecamp-only" : "easyspeak-only";
    const orphaned =
      presence === "basecamp-only" ? isBasecampOrphaned(bc!.path_name) : presence === "easyspeak-only" ? isEasyspeakOrphaned(es!.path) : false;
    const flagged =
      presence === "basecamp-only" ? isBasecampFlagged(bc!.path_name) : presence === "easyspeak-only" ? isEasyspeakFlagged(es!.path) : false;

    paths.push({
      canonicalKey: key,
      displayName: bc?.path_name ?? es?.path ?? key,
      basecampPathName: bc?.path_name ?? null,
      easyspeakPathLabel: es?.path ?? null,
      presence,
      nonPathway,
      overridden: false,
      orphaned,
      flagged,
      completedHistory: presence === "easyspeak-only" && es ? isCompletedEasySpeakHistory(es, nonPathway) : false,
      manuallyCompleted: presence === "easyspeak-only" && es ? isEasyspeakCompleted(es.path) : false,
      levels: nonPathway ? [] : diffLevels(es, bc),
      pathCompletion: buildPathCompletion(bc),
    });
  }

  return { paths, easyspeakNoActivePath: noActivePath };
}
