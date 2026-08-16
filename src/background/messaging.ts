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
 *
 * Returns the same envelope it passes to sendResponse — Chrome's onMessage
 * only ever looks at the sendResponse call, but Firefox's native promise-based
 * messaging uses *this function's own resolved value* as the actual response,
 * independent of sendResponse (see registerMessageHandlers() below for why
 * the caller returns this promise directly). Resolving to `void` here — as
 * the original version did — meant Firefox delivered `undefined` as every
 * scrape's response, discarding whatever sendResponse had actually sent.
 */
async function runScrape<T>(source: SourceKey, scrapeFn: ScrapeFn<T>, sendResponse: (response: ScrapeEnvelope<T>) => void): Promise<ScrapeEnvelope<T>> {
  await setSourceStatus(source, "loading");
  try {
    const data = await scrapeFn();
    await setSourceStatus(source, "success");
    const envelope: ScrapeEnvelope<T> = { ok: true, data };
    sendResponse(envelope);
    return envelope;
  } catch (err) {
    await setSourceStatus(source, "error");
    const envelope: ScrapeEnvelope<T> = { ok: false, error: err instanceof Error ? err.message : String(err) };
    sendResponse(envelope);
    return envelope;
  } finally {
    // Clears any in-progress progress reading (see scrapeAllClubs()) once
    // the scrape ends, success or failure — a no-op for EasySpeak, which
    // never writes one.
    await clearScrapeProgress(source);
  }
}

export function registerMessageHandlers(): void {
  browser.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
    // Returning the pending promise itself (rather than the bare literal
    // `true`) is what Chrome's onMessage docs call "indicating an async
    // response" too — a Promise is just as truthy as `true`, so Chrome's
    // behavior is unchanged (it still only looks at sendResponse for the
    // actual payload). Firefox additionally uses the returned Promise itself
    // to track the pending response; returning a disconnected `true` while
    // calling sendResponse from a separate, unreturned promise chain is what
    // produced Firefox's "Promised response from onMessage listener went out
    // of scope" error — Firefox's tracking has nothing to hold onto once the
    // listener call itself returns.
    if (message?.type === "SCRAPE_BASECAMP") {
      return runScrape<BasecampScrape>("basecamp", scrapeAllClubs, sendResponse);
    }

    if (message?.type === "SCRAPE_EASYSPEAK") {
      return runScrape<EasySpeakScrape>("easyspeak", scrapeAllEasySpeakClubs, sendResponse);
    }

    if (message?.type === "POPUP_OPENED") {
      // Same reasoning as runScrape() above: sendResponse(statuses) is for
      // Chrome, but the returned promise must itself resolve to `statuses`
      // (not to whatever sendResponse() returns, which is nothing) since
      // that's what Firefox actually delivers as the response.
      return acknowledgeIconStatuses().then((statuses) => {
        sendResponse(statuses);
        return statuses;
      });
    }

    return undefined;
  });
}
