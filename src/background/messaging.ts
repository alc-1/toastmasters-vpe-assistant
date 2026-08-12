// src/background/messaging.ts
//
// Handles messages from the popup/options UI. Registers the single
// browser.runtime.onMessage listener for the background entrypoint and
// brackets each scrape with icon-state status updates (see icon-state.ts) so
// the toolbar icon stays correct regardless of whether the popup that
// triggered the scrape is still open to receive the response (EasySpeak's
// tab-focus steal closes it almost immediately — see background/api/easyspeak.ts).

import { scrapeAllClubs } from "./api/basecamp";
import { scrapeAllEasySpeakClubs } from "./api/easyspeak";
import { acknowledgeIconStatuses, setSourceStatus } from "./icon-state";
import { clearScrapeProgress } from "./scrape-progress";
import type { BasecampScrape, EasySpeakScrape, Request, ScrapeEnvelope, ScrapeFn, SourceKey } from "../shared/types";

/**
 * Runs a scrape function, following its loading/success/error status (and
 * therefore the toolbar icon) throughout, regardless of whether the popup
 * that sent the triggering message is still around to receive sendResponse.
 */
async function runScrape<T>(source: SourceKey, scrapeFn: ScrapeFn<T>, sendResponse: (response: ScrapeEnvelope<T>) => void): Promise<void> {
  await setSourceStatus(source, "loading");
  try {
    const data = await scrapeFn();
    await setSourceStatus(source, "success");
    sendResponse({ ok: true, data });
  } catch (err) {
    await setSourceStatus(source, "error");
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    // Clears any in-progress progress reading (see scrapeAllClubs()) once
    // the scrape ends, success or failure — a no-op for EasySpeak, which
    // never writes one.
    await clearScrapeProgress(source);
  }
}

export function registerMessageHandlers(): void {
  browser.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
    if (message?.type === "SCRAPE_BASECAMP") {
      runScrape<BasecampScrape>("basecamp", scrapeAllClubs, sendResponse);
      // Tells the browser we'll respond asynchronously.
      return true;
    }

    if (message?.type === "SCRAPE_EASYSPEAK") {
      runScrape<EasySpeakScrape>("easyspeak", scrapeAllEasySpeakClubs, sendResponse);
      return true;
    }

    if (message?.type === "POPUP_OPENED") {
      acknowledgeIconStatuses().then(sendResponse);
      return true;
    }

    return undefined;
  });
}
