// src/shared/types.ts
//
// Domain type catalog for the extension. Ported from JSDoc shapes previously
// scattered across lib/report.js, lib/basecamp-api.js, lib/easyspeak-api.js,
// lib/easyspeak-parser.js, and lib/resolution-store.js. Raw upstream API
// payloads (Basecamp's /api/members/roles, /api/bcm/progress/ pages) are
// deliberately loose (`unknown`, narrowed once at the fetch boundary) — the
// shapes below are the ones that matter as contracts between modules.

// ---------------------------------------------------------------------------
// Basecamp raw scrape shapes
// ---------------------------------------------------------------------------

export interface BasecampProgressionEntry {
  completed: number;
  total: number;
  /** Only meaningful on "Level N" entries — absent/unused on "Path Completion". */
  approved?: boolean;
}

/** Keyed "Level 1".."Level 5" and "Path Completion". */
export type BasecampProgression = Record<string, BasecampProgressionEntry>;

export interface BasecampUser {
  id: number;
  name: string;
  // profile_image, member_photo_url, email are stripped by
  // stripUnneededUserFields() before this ever reaches storage.
  [key: string]: unknown;
}

/** One member x path row, as stored (post stripUnneededUserFields). */
export interface BasecampMember {
  user: BasecampUser;
  path_name: string;
  progression: BasecampProgression;
  [key: string]: unknown;
}

export interface BasecampClubScrape {
  name: string;
  members: BasecampMember[];
}

export type BasecampScrape = Record<string /* club uuid */, BasecampClubScrape>;

// ---------------------------------------------------------------------------
// EasySpeak raw scrape + parser I/O shapes
// ---------------------------------------------------------------------------

export interface EasySpeakLevel {
  level: number;
  needed: number;
  done: number;
}

export interface EasySpeakMemberRow {
  memberId: string | null;
  name: string;
  path: string;
  levels: EasySpeakLevel[];
}

export interface EasySpeakClubScrape {
  name: string;
  members: EasySpeakMemberRow[];
}

export type EasySpeakScrape = Record<string /* club id */, EasySpeakClubScrape>;

export interface ProfileClub {
  id: string;
  name: string;
}

export interface ProfileParseResult {
  clubs: ProfileClub[];
}

export interface MemberchartParseResult {
  members: EasySpeakMemberRow[];
}

export interface LevelCellCounts {
  needed: number;
  done: number;
}

// ---------------------------------------------------------------------------
// Report / delta domain (see shared/sync/conflicts.ts + shared/sync/delta.ts)
// ---------------------------------------------------------------------------

export type Presence = "both" | "basecamp-only" | "easyspeak-only";
export type MatchConfidence = "confirmed" | "exact" | "fuzzy" | null;
export type MatchSource = "fuzzy-confirmed" | "manual-search" | "orphan" | null;

export interface PathCompletion {
  completed: number;
  total: number;
  missing: number;
}

export interface LevelDiff {
  level: number;
  easyspeak: { needed: number; done: number } | null;
  basecamp: { completed: number; total: number; approved: boolean } | null;
  easyspeakMissing: number | null;
  basecampMissing: number | null;
  discrepancy: number | null;
  pendingValidation: boolean;
}

export interface PathReport {
  canonicalKey: string;
  displayName: string;
  basecampPathName: string | null;
  easyspeakPathLabel: string | null;
  presence: Presence;
  nonPathway: boolean;
  overridden: boolean;
  orphaned: boolean;
  levels: LevelDiff[];
  pathCompletion: PathCompletion | null;
}

export interface MemberReport {
  basecampUserId: number | null;
  easyspeakMemberId: string | null;
  name: string;
  basecampName: string | null;
  easyspeakName: string | null;
  presence: Presence;
  matchConfidence: MatchConfidence;
  matchScore: number | null;
  matchSource: MatchSource;
  easyspeakNoActivePath: boolean;
  paths: PathReport[];
  hasOrphanedPaths: boolean;
}

export interface ClubPairReport {
  basecampClubId: string | null;
  basecampClubName: string | null;
  easyspeakClubId: string | null;
  easyspeakClubName: string | null;
  matchScore: number | null;
  clubMatchForced: boolean;
  members: MemberReport[];
}

export interface ReportMeta {
  basecampScrapedAt: number | null;
  easyspeakScrapedAt: number | null;
}

export interface ReportResult {
  meta: ReportMeta;
  clubPairs: ClubPairReport[];
}

export interface LevelSummaryCore {
  currentLevel: number | null;
  currentLevelSortValue: number | null;
  currentLevelLabel: string;
  nextLevelLabel: string;
  theoreticalMissing: number | null;
  unreportedInBasecamp: number | null;
  realMissing: number | null;
}

export interface LevelSummaryRow extends LevelSummaryCore {
  // Composite keys (see memberKey() / PathReport.canonicalKey in
  // shared/sync/delta.ts) letting the UI trace a row back to its source
  // MemberReport/PathReport after the table has been sorted.
  memberKey: string;
  pathKey: string;
  memberName: string;
  memberPresence: Presence;
  matchConfidence: MatchConfidence;
  pathName: string;
  pathPresence: Presence;
}

export interface LevelSummaryGroup {
  clubKey: string;
  clubName: string | null;
  rows: LevelSummaryRow[];
}

// ---------------------------------------------------------------------------
// Persisted resolution records (see shared/resolution-store.ts)
// ---------------------------------------------------------------------------

export interface MemberLink {
  basecampUserId: number;
  easyspeakMemberId: string;
  source: MatchSource;
  confirmedAt: number;
}

export interface RejectedPair {
  basecampUserId: number;
  easyspeakMemberId: string;
  rejectedAt: number;
}

/** Exactly one of the two ids is non-null — the side that does have data. */
export interface MemberOrphan {
  basecampUserId: number | null;
  easyspeakMemberId: string | null;
  orphanedAt: number;
}

export interface ClubRejectedPair {
  basecampClubId: string;
  easyspeakClubId: string;
  rejectedAt: number;
}

export interface ClubLookupEntry {
  basecampClubId: string;
  easyspeakClubId: string;
  /** Denormalized, for the Settings page's display only. */
  basecampClubName: string;
  easyspeakClubName: string;
  /** How this pin was created — absent on pins persisted before this field existed. */
  source?: MatchSource;
}

/** Canonical path name -> alternate spellings. */
export type PathLookup = Record<string, string[]>;

export interface MemberPathOverride {
  basecampUserId: number;
  easyspeakMemberId: string;
  basecampPathName: string;
  easyspeakPathLabel: string;
  boundAt: number;
}

export interface MemberPathExclusion {
  basecampUserId: number;
  easyspeakMemberId: string;
  basecampPathName: string;
  easyspeakPathLabel: string;
  excludedAt: number;
}

/** Exactly one of basecampPathName/easyspeakPathLabel is set — the side being marked orphan. */
export interface MemberPathOrphan {
  basecampUserId: number;
  easyspeakMemberId: string;
  basecampPathName: string | null;
  easyspeakPathLabel: string | null;
  orphanedAt: number;
}

/** Exactly buildReport()'s 4th param shape — omitting it entirely reproduces
 * plain automatic matching, unchanged. */
export interface ResolutionData {
  memberLinks?: MemberLink[];
  rejectedPairs?: RejectedPair[];
  clubLookup?: ClubLookupEntry[];
  clubRejectedPairs?: ClubRejectedPair[];
  memberOrphans?: MemberOrphan[];
  memberPathOverrides?: MemberPathOverride[];
  memberPathExclusions?: MemberPathExclusion[];
  memberPathOrphans?: MemberPathOrphan[];
  pathAliasLookup?: Map<string, string>;
  /** Default true (Members view). report.ts passes false so an unconfirmed
   * fuzzy guess never renders there as if it were a fact. */
  allowFuzzyMemberMatches?: boolean;
}

// ---------------------------------------------------------------------------
// Settings / icon state
// ---------------------------------------------------------------------------

export type EasySpeakServerId = "tmclub.eu" | "toastmasterclub.org" | "easy-speak.org";

export interface EasySpeakServer {
  id: EasySpeakServerId;
  label: string;
  /** Plain region name with no URL — e.g. "Continental Europe" — for
   *  contexts (like the stepper's info line) that shouldn't show the raw
   *  server id/URL. `label` stays the fuller "Region (url)" form used in
   *  the Setup dropdown. */
  region: string;
}

/**
 * Which "workspace" is active — Demo data, or one of the three EasySpeak
 * regional deployments (see shared/settings-store.ts's EASYSPEAK_SERVERS).
 * Selects which profile-scoped bucket shared/storage.ts's `local` reads/
 * writes (see PROFILE_SCOPED_KEYS there) — switching this never erases
 * another profile's data.
 */
export type ProfileId = "demo" | EasySpeakServerId;

export type SourceKey = "basecamp" | "easyspeak";
export type SourceStatus = "idle" | "loading" | "success" | "error";
export type IconStatuses = Record<SourceKey, SourceStatus>;

// Incremental progress for a still-running scrape, written to
// chrome.storage.session (see shared/storage.ts's SessionSchema) so a page
// can render live updates. clubsTotal/currentClubIndex are real counts
// (Basecamp's /api/members/roles response gives the full club list
// upfront); currentClubMembersTotal comes from the current club's own
// /api/bcm/progress/ response ("count", present on every page) so it's a
// real "N out of M" fraction, not an estimate — null only in the brief
// window between starting a new club and that club's first page arriving.
export interface ScrapeProgress {
  currentClubIndex: number; // 1-based
  clubsTotal: number;
  currentClubName: string;
  currentClubMembersFetched: number;
  currentClubMembersTotal: number | null;
}
export type ScrapeProgressState = Record<SourceKey, ScrapeProgress | null>;

// ---------------------------------------------------------------------------
// Messaging (popup/options -> background service worker)
// ---------------------------------------------------------------------------

export type ScrapeEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

// The shape api/basecamp.ts's scrapeAllClubs() and api/easyspeak.ts's
// scrapeAllEasySpeakClubs() both already have — background/messaging.ts's
// runScrape() only ever needs this much of either module to bracket a
// scrape with icon-state updates, which is what lets each module swap in
// shared/mock/mockData.ts fixtures internally (see getMockMode()) without
// messaging.ts or any UI page needing to know.
export type ScrapeFn<T> = () => Promise<T>;

export type Request = { type: "SCRAPE_BASECAMP" } | { type: "SCRAPE_EASYSPEAK" } | { type: "POPUP_OPENED" };

// NB: POPUP_OPENED deliberately returns a bare IconStatuses, not the
// {ok,data} envelope the two scrape messages use — an existing
// inconsistency, preserved here rather than silently "fixed".
export type ResponseFor<M extends Request> = M extends { type: "SCRAPE_BASECAMP" }
  ? ScrapeEnvelope<BasecampScrape>
  : M extends { type: "SCRAPE_EASYSPEAK" }
    ? ScrapeEnvelope<EasySpeakScrape>
    : M extends { type: "POPUP_OPENED" }
      ? IconStatuses
      : never;
