// src/shared/settings-store.ts
//
// Storage I/O for general extension settings — which EasySpeak server
// (regional deployment) to scrape, and whether mock/demo mode is on. Unlike
// shared/resolution-store.ts (scoped specifically to member/club/path
// matching decisions), these are different, unrelated concerns from
// matching, so they get their own file rather than being bolted onto that
// one.
//
// Used from both the settings options page (for the dropdown/checkbox UI)
// AND background/api/basecamp.ts + background/api/easyspeak.ts, since the
// actual decisions that need these settings (which server URL to hit,
// whether to skip the real scrape entirely) happen in the service worker.

import { local } from "./storage";
import type { EasySpeakServer, EasySpeakServerId } from "./types";

export const EASYSPEAK_SERVERS: EasySpeakServer[] = [
  { id: "tmclub.eu", label: "Continental Europe (tmclub.eu)", region: "Continental Europe" },
  { id: "toastmasterclub.org", label: "UK & Ireland (toastmasterclub.org)", region: "UK & Ireland" },
  { id: "easy-speak.org", label: "Rest of the World (easy-speak.org)", region: "Rest of the World" },
];

export const DEFAULT_EASYSPEAK_SERVER: EasySpeakServerId = "tmclub.eu";

/**
 * Falls back to the default if unset or if the stored value isn't a known
 * server (defensive against a future removed/renamed entry).
 */
export async function getEasySpeakServer(): Promise<EasySpeakServerId> {
  const easyspeakServer = await local.value("easyspeakServer");
  const isKnown = EASYSPEAK_SERVERS.some((s) => s.id === easyspeakServer);
  return isKnown ? (easyspeakServer as EasySpeakServerId) : DEFAULT_EASYSPEAK_SERVER;
}

export async function setEasySpeakServer(serverId: EasySpeakServerId): Promise<void> {
  if (!EASYSPEAK_SERVERS.some((s) => s.id === serverId)) {
    throw new Error(`Unknown EasySpeak server: ${serverId}`);
  }
  await local.set({ easyspeakServer: serverId });
}

/**
 * When true, api/basecamp.ts and api/easyspeak.ts return built-in demo
 * fixtures (shared/mock/mockData.ts) instead of contacting the real
 * network/tab-navigation flows — a Chrome Web Store review workaround (a
 * reviewer can't log into either system) and an onboarding demo, gated
 * behind a plain runtime setting rather than a rebuild.
 */
export async function getMockMode(): Promise<boolean> {
  return (await local.value("mockMode")) ?? false;
}

export async function setMockMode(enabled: boolean): Promise<void> {
  await local.set({ mockMode: enabled });
}
