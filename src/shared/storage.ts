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

import type {
  BasecampScrape,
  ClubLookupEntry,
  ClubRejectedPair,
  EasySpeakScrape,
  EasySpeakServerId,
  IconStatuses,
  MemberLink,
  MemberPathExclusion,
  MemberPathOverride,
  PathLookup,
  RejectedPair,
} from "./types";

export interface LocalSchema {
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
  pathLookup: PathLookup;
  memberPathOverrides: MemberPathOverride[];
  memberPathExclusions: MemberPathExclusion[];
  easyspeakServer: EasySpeakServerId;
  mockMode: boolean;
}

export interface SessionSchema {
  iconStatus: IconStatuses;
}

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

export const local = area<LocalSchema>(() => chrome.storage.local);
export const session = area<SessionSchema>(() => chrome.storage.session);
