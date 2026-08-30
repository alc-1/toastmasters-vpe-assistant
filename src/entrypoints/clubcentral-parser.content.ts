// src/entrypoints/clubcentral-parser.content.ts
//
// Runtime-registered content script (registration: "runtime" — never
// auto-injected by a manifest match rule) that exposes the pure Club Central
// parsing functions as globals on the target tab, for background/api/
// clubcentral.ts to invoke via browser.scripting. WXT bundles this as a
// plain IIFE at the stable, predictable path
// "/content-scripts/clubcentral-parser.js" (no content hash). main()'s
// synchronous body runs to completion before the wrapper's first await, so
// the globals are guaranteed present by the time the injecting executeScript
// call resolves — see easyspeak-parser.content.ts for the full rationale.

import { normalizePaymentStatus, parseClubList, parseRoster } from "../shared/parsers/clubcentral-parser";

export default defineContentScript({
  registration: "runtime",
  matches: [],
  main() {
    Object.assign(globalThis, { parseClubList, parseRoster, normalizePaymentStatus });
  },
});
