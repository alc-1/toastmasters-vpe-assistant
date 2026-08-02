// src/shared/settings-store.ts
//
// Storage I/O for general extension settings — currently just which
// EasySpeak server (regional deployment) to scrape. Unlike
// shared/resolution-store.ts (scoped specifically to member/club/path
// matching decisions), this is a different, unrelated concern, so it gets
// its own file rather than a 7th key bolted onto that one.
//
// Used from both the settings options page (for the dropdown UI) AND
// background/api/easyspeak.ts, since the URL construction that needs the
// chosen server happens in the service worker.

import { local } from "./storage";
import type { EasySpeakServer, EasySpeakServerId } from "./types";

export const EASYSPEAK_SERVERS: EasySpeakServer[] = [
  { id: "tmclub.eu", label: "Continental Europe (tmclub.eu)" },
  { id: "toastmasterclub.org", label: "UK & Ireland (toastmasterclub.org)" },
  { id: "easy-speak.org", label: "Rest of the World (easy-speak.org)" },
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
