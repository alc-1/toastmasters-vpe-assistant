// src/background/scrape-progress.ts
//
// Tracks incremental progress for a still-running scrape, written to
// browser.storage.session (see shared/storage.ts's SessionSchema) so an open
// Sync Data page can render live updates via browser.storage.onChanged.
// Kept separate from icon-state.ts: that file's docblock is specific to
// icon animation/setInterval ownership — progress tracking is an unrelated
// concern that just happens to share the same storage area.

import { session } from "../shared/storage";
import type { ScrapeProgress, ScrapeProgressState, SourceKey } from "../shared/types";

async function getState(): Promise<ScrapeProgressState> {
  const state = await session.value("scrapeProgress");
  return state || { basecamp: null, easyspeak: null };
}

export async function setScrapeProgress(source: SourceKey, progress: ScrapeProgress): Promise<void> {
  const state = await getState();
  state[source] = progress;
  await session.set({ scrapeProgress: state });
}

export async function clearScrapeProgress(source: SourceKey): Promise<void> {
  const state = await getState();
  state[source] = null;
  await session.set({ scrapeProgress: state });
}
