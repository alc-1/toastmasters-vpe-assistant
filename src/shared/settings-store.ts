// src/shared/settings-store.ts
//
// Storage I/O for general extension settings — currently just which profile
// (Demo, or one of the three EasySpeak regional deployments) is active. This
// used to be two independent flat settings (mockMode + easyspeakServer);
// they're now derived from the single `activeProfile` key so the two can
// never drift apart, and so shared/storage.ts's profile-scoping (see there)
// has one unambiguous ProfileId to key off of. Unlike
// shared/resolution-store.ts (scoped specifically to member/club/path
// matching decisions), this is a different, unrelated concern from
// matching, so it gets its own file rather than being bolted onto that one.
//
// Used from both the Setup options page (for the two-card + region-dropdown
// UI) AND background/api/basecamp.ts + background/api/easyspeak.ts, since
// the actual decisions that need this (which server URL to hit, whether to
// skip the real scrape entirely) happen in the service worker.

import { local } from "./storage";
import type { EasySpeakServer, EasySpeakServerId, ProfileId } from "./types";

export const EASYSPEAK_SERVERS: EasySpeakServer[] = [
  { id: "tmclub.eu", label: "Continental Europe (tmclub.eu)", region: "Continental Europe" },
  { id: "toastmasterclub.org", label: "UK & Ireland (toastmasterclub.org)", region: "UK & Ireland" },
  { id: "easy-speak.org", label: "Rest of the World (easy-speak.org)", region: "Rest of the World" },
];

export const DEFAULT_EASYSPEAK_SERVER: EasySpeakServerId = "tmclub.eu";

/**
 * Human-readable name for a profile — the EasySpeak deployment's label, or
 * "Demo" / a no-selection fallback. Shared by the Excel export's Metadata
 * sheet (shared/export/export-to-excel.ts) and the Home dashboard's
 * "Club data:" banner line (entrypoints/app/views/dashboard.ts).
 */
export function formatProfileLabel(profileId: ProfileId | null): string {
  if (!profileId) return "No profile selected yet";
  if (profileId === "demo") return "Demo";
  return EASYSPEAK_SERVERS.find((s) => s.id === profileId)?.label ?? profileId;
}

/**
 * Raw stored choice — `null` means the user hasn't picked a profile yet
 * (Setup's required no-default state). Distinguished from
 * resolveActiveProfile()'s defaulted result, which the scrapers need instead
 * (see there).
 */
export async function getActiveProfile(): Promise<ProfileId | null> {
  return (await local.value("activeProfile")) ?? null;
}

export async function setActiveProfile(profileId: ProfileId): Promise<void> {
  const previous = await getActiveProfile();

  const values: { activeProfile: ProfileId; lastEasySpeakRegion?: EasySpeakServerId } = { activeProfile: profileId };
  // Remembered independently of the active profile, so switching into Demo
  // and back to "real" restores the region instead of resetting to the
  // default — see shared/storage.ts's LocalSchema.lastEasySpeakRegion.
  if (profileId !== "demo") values.lastEasySpeakRegion = profileId;
  await local.set(values);

  // Demo is scratch space only, unlike the real (non-demo) profiles: it's
  // wiped on every actual profile change (switching into it, out of it, or
  // between two other profiles) so it never carries data across a switch —
  // every visit to Demo starts fresh. A no-op call (re-picking the
  // already-active profile) doesn't count as "changing profile".
  if (previous !== profileId) {
    await local.clearProfile("demo");
  }
}

/** The Setup page's region-dropdown default — see LocalSchema.lastEasySpeakRegion. */
export async function getLastEasySpeakRegion(): Promise<EasySpeakServerId> {
  return (await local.value("lastEasySpeakRegion")) ?? DEFAULT_EASYSPEAK_SERVER;
}

/**
 * Falls back to the default region if no profile has been chosen yet
 * (defensive against scraping being triggered before ever visiting Setup) —
 * mirrors the exact fallback getEasySpeakServer() has always documented.
 */
export async function resolveActiveProfile(): Promise<ProfileId> {
  return (await getActiveProfile()) ?? DEFAULT_EASYSPEAK_SERVER;
}

/**
 * When true, api/basecamp.ts and api/easyspeak.ts return built-in demo
 * fixtures (shared/mock/mockData.ts) instead of contacting the real
 * network/tab-navigation flows — a Chrome Web Store review workaround (a
 * reviewer can't log into either system) and an onboarding demo.
 */
export async function getMockMode(): Promise<boolean> {
  return (await resolveActiveProfile()) === "demo";
}

/**
 * Falls back to the default if the active profile is Demo or unset
 * (defensive against a future removed/renamed entry, same as before).
 */
export async function getEasySpeakServer(): Promise<EasySpeakServerId> {
  const profileId = await resolveActiveProfile();
  return profileId === "demo" ? DEFAULT_EASYSPEAK_SERVER : profileId;
}

/**
 * Global on/off switch (Global Settings page, reached via the header gear
 * icon — see shared/app-shell.ts) for replacing real member/club names with
 * generic "Member N"/"Club N" labels (see shared/anonymize.ts) across Club
 * Progress, the Excel export, and the Sync Data raw-scrape preview. Not
 * profile-scoped (see LocalSchema.anonymizeMode) and defaults to off.
 */
export async function getAnonymizeMode(): Promise<boolean> {
  return (await local.value("anonymizeMode")) ?? false;
}

export async function setAnonymizeMode(value: boolean): Promise<void> {
  await local.set({ anonymizeMode: value });
}
