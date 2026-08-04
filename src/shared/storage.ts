// src/shared/storage.ts
//
// Typed wrapper around chrome.storage.local / chrome.storage.session. The
// schema interfaces below ARE the key registry — no chrome.storage.* call
// should exist anywhere outside this file, and no storage key string should
// exist anywhere else in the codebase. That makes "keys must not change"
// (existing users' data depends on them) a compile-time property rather than
// a code-review convention.
//
// chrome.storage.session (not .local) is used for iconStatus specifically so
// a stuck "loading"/"error" status can never survive a browser restart and
// permanently disable a toolbar button — see background/icon-state.ts.
//
// Every LocalSchema key EXCEPT `activeProfile` itself is "profile-scoped":
// transparently stored under a `profile:<id>:<key>` real storage key,
// resolved against whichever ProfileId (shared/types.ts) is currently active
// (shared/settings-store.ts's getActiveProfile()/setActiveProfile() is the
// public API for reading/changing it — this file only owns the scoping
// mechanics). This is what lets a user flip between Demo and their real
// club data (or between regions) without one overwriting the other — every
// call site below (`local.get`/`value`/`set`/`remove`) keeps its existing,
// unqualified key names; only the *real* underlying storage key changes.

import type {
  BasecampScrape,
  ClubLookupEntry,
  ClubRejectedPair,
  EasySpeakScrape,
  EasySpeakServerId,
  IconStatuses,
  MemberLink,
  MemberOrphan,
  MemberPathExclusion,
  MemberPathOrphan,
  MemberPathOverride,
  PathLookup,
  ProfileId,
  RejectedPair,
} from "./types";

export interface LocalSchema {
  /** Not profile-scoped — this is what selects the scope for every other key. */
  activeProfile: ProfileId;
  // Not profile-scoped, deliberately: this is a plain UI preference (which
  // region the Setup page's dropdown defaults to), not "data" — it must
  // survive switching the active profile to "demo" and back, otherwise
  // toggling into Demo for a quick look and back would forget which real
  // region the user had picked, a regression from the pre-profile behavior
  // where mockMode/easyspeakServer were fully independent settings. See
  // shared/settings-store.ts's setActiveProfile()/getLastEasySpeakRegion().
  lastEasySpeakRegion: EasySpeakServerId;
  basecampData: BasecampScrape;
  basecampScrapedAt: number;
  easyspeakData: EasySpeakScrape;
  easyspeakScrapedAt: number;
  memberLinks: MemberLink[];
  // NB: stored under this name, exposed in-memory as `rejectedPairs` by
  // resolution-store.ts's loadResolutionData() — a pre-existing naming
  // mismatch, kept intentionally (renaming the key would silently orphan
  // every existing user's rejected pairs).
  memberRejectedPairs: RejectedPair[];
  clubLookup: ClubLookupEntry[];
  clubRejectedPairs: ClubRejectedPair[];
  memberOrphans: MemberOrphan[];
  pathLookup: PathLookup;
  memberPathOverrides: MemberPathOverride[];
  memberPathExclusions: MemberPathExclusion[];
  memberPathOrphans: MemberPathOrphan[];
}

export interface SessionSchema {
  iconStatus: IconStatuses;
}

// Every LocalSchema key except `activeProfile` — kept as a literal list
// (rather than derived from LocalSchema at runtime, which TS can't do)
// so adding a new profile-scoped key is a one-line, hard-to-miss addition.
const PROFILE_SCOPED_KEYS = [
  "basecampData",
  "basecampScrapedAt",
  "easyspeakData",
  "easyspeakScrapedAt",
  "memberLinks",
  "memberRejectedPairs",
  "clubLookup",
  "clubRejectedPairs",
  "memberOrphans",
  "pathLookup",
  "memberPathOverrides",
  "memberPathExclusions",
  "memberPathOrphans",
] as const satisfies readonly (keyof LocalSchema)[];

type ProfileScopedKey = (typeof PROFILE_SCOPED_KEYS)[number];

// Duplicates shared/settings-store.ts's DEFAULT_EASYSPEAK_SERVER value
// deliberately: this file can't import settings-store.ts (which already
// imports `local` from here — that would invert the dependency direction
// and cycle). Used only as the scoping fallback when no profile has been
// chosen yet, mirroring the exact default getEasySpeakServer() has always
// documented, so scraping before ever visiting Setup keeps working exactly
// as it did before profiles existed.
const DEFAULT_PROFILE_ID: ProfileId = "tmclub.eu";

function isProfileScoped(key: string): key is ProfileScopedKey {
  return (PROFILE_SCOPED_KEYS as readonly string[]).includes(key);
}

function toRealKey(key: string, profileId: ProfileId): string {
  return isProfileScoped(key) ? `profile:${profileId}:${key}` : key;
}

// ---------------------------------------------------------------------------
// One-time legacy-data migration: pre-profile installs stored everything
// under the bare key names now reserved for PROFILE_SCOPED_KEYS, plus two
// flat settings (`mockMode`, `easyspeakServer`) that together identified
// which "profile" the data belonged to (see shared/settings-store.ts, which
// now derives both from `activeProfile` instead of storing them directly).
// Runs at most once per JS context (memoized) and is idempotent across
// contexts: guarded by `activeProfile` already being set.
// ---------------------------------------------------------------------------

let migrated: Promise<void> | null = null;

function ensureMigrated(): Promise<void> {
  if (!migrated) migrated = migrateLegacyData();
  return migrated;
}

async function migrateLegacyData(): Promise<void> {
  const current = await chrome.storage.local.get("activeProfile");
  if (current.activeProfile) return; // already migrated, or a fresh install that already chose a profile

  const legacyKeys = [...PROFILE_SCOPED_KEYS, "mockMode", "easyspeakServer"];
  const legacy = await chrome.storage.local.get(legacyKeys);

  const hasLegacyData = PROFILE_SCOPED_KEYS.some((key) => legacy[key] !== undefined);
  if (!hasLegacyData && legacy.mockMode === undefined && legacy.easyspeakServer === undefined) {
    return; // fresh install — nothing to migrate; leave activeProfile unset (Setup's "no choice made yet" state)
  }

  const profileId: ProfileId =
    legacy.mockMode === true ? "demo" : ((legacy.easyspeakServer as ProfileId | undefined) ?? DEFAULT_PROFILE_ID);

  const toWrite: Record<string, unknown> = { activeProfile: profileId };
  // Preserved regardless of which profile the data derived into (even a
  // demo user may have previously configured a real region) — see
  // LocalSchema's lastEasySpeakRegion comment.
  if (legacy.easyspeakServer !== undefined) toWrite.lastEasySpeakRegion = legacy.easyspeakServer;
  const toRemove: string[] = ["mockMode", "easyspeakServer"];
  for (const key of PROFILE_SCOPED_KEYS) {
    if (legacy[key] !== undefined) {
      toWrite[toRealKey(key, profileId)] = legacy[key];
      toRemove.push(key);
    }
  }

  // Write the new keys before removing the old ones, so a crash mid-migration
  // leaves (at worst) harmless orphaned legacy keys rather than losing data.
  await chrome.storage.local.set(toWrite);
  await chrome.storage.local.remove(toRemove);
}

async function resolveEffectiveProfileId(): Promise<ProfileId> {
  await ensureMigrated();
  const { activeProfile } = await chrome.storage.local.get("activeProfile");
  return (activeProfile as ProfileId | undefined) ?? DEFAULT_PROFILE_ID;
}

async function getForProfile<K extends keyof LocalSchema & string>(
  profileId: ProfileId,
  keys: K[]
): Promise<Partial<Pick<LocalSchema, K>>> {
  if (keys.length === 0) return {};
  const realKeys = keys.map((key) => toRealKey(key, profileId));
  const raw = await chrome.storage.local.get(realKeys);
  const out: Partial<Record<string, unknown>> = {};
  keys.forEach((key, i) => {
    const real = realKeys[i];
    if (real in raw) out[key] = raw[real];
  });
  return out as Partial<Pick<LocalSchema, K>>;
}

async function setForProfileImpl(profileId: ProfileId, values: Partial<LocalSchema>): Promise<void> {
  const toWrite: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    toWrite[toRealKey(key, profileId)] = value;
  }
  await chrome.storage.local.set(toWrite);
}

export const local = {
  async get<K extends keyof LocalSchema & string>(keys: K[]): Promise<Partial<Pick<LocalSchema, K>>> {
    const profileId = await resolveEffectiveProfileId();
    return getForProfile(profileId, keys);
  },
  async value<K extends keyof LocalSchema & string>(key: K): Promise<LocalSchema[K] | undefined> {
    const result = await local.get([key]);
    return result[key];
  },
  async set(values: Partial<LocalSchema>): Promise<void> {
    const profileId = await resolveEffectiveProfileId();
    await setForProfileImpl(profileId, values);
  },
  async remove(keys: (keyof LocalSchema & string)[]): Promise<void> {
    const profileId = await resolveEffectiveProfileId();
    await chrome.storage.local.remove(keys.map((key) => toRealKey(key, profileId)));
  },
  /**
   * Writes into an EXPLICIT profile's bucket rather than resolving the
   * ambient active one. Needed by background/api/basecamp.ts and
   * background/api/easyspeak.ts: each captures the active profile once, at
   * the start of a scrape, and must keep writing to that same profile even
   * if the user switches Setup's active profile in another tab while the
   * scrape (which can take a minute or two) is still running — an ambient
   * `local.set()` at write time would otherwise silently write the result
   * into whichever profile happens to be active when the scrape *finishes*.
   */
  async setForProfile(profileId: ProfileId, values: Partial<LocalSchema>): Promise<void> {
    await ensureMigrated();
    await setForProfileImpl(profileId, values);
  },
  /**
   * Wipes every profile-scoped key for one specific profile (not
   * `activeProfile`/`lastEasySpeakRegion`, which aren't profile-scoped —
   * see LocalSchema). Used by shared/settings-store.ts's setActiveProfile()
   * to keep the Demo profile scratch-only: it's cleared on every profile
   * change so it never carries data across a switch, unlike the real
   * (non-demo) profiles.
   */
  async clearProfile(profileId: ProfileId): Promise<void> {
    await ensureMigrated();
    const realKeys = PROFILE_SCOPED_KEYS.map((key) => toRealKey(key, profileId));
    await chrome.storage.local.remove(realKeys);
  },
};

function area<S extends object>(getArea: () => chrome.storage.StorageArea) {
  return {
    async get<K extends keyof S & string>(keys: K[]): Promise<Partial<Pick<S, K>>> {
      return (await getArea().get(keys)) as Partial<Pick<S, K>>;
    },
    async value<K extends keyof S & string>(key: K): Promise<S[K] | undefined> {
      const result = await getArea().get(key);
      return result[key] as S[K] | undefined;
    },
    async set(values: Partial<S>): Promise<void> {
      await getArea().set(values);
    },
    async remove(keys: (keyof S & string)[]): Promise<void> {
      await getArea().remove(keys);
    },
  };
}

export const session = area<SessionSchema>(() => chrome.storage.session);
