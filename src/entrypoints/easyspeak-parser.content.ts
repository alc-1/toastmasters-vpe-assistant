// src/entrypoints/easyspeak-parser.content.ts
//
// Injected via browser.scripting.executeScript into a real, navigated
// EasySpeak tab (tmclub.eu/etc. — an external page, not an extension page).
// `registration: "runtime"` means this is never auto-injected by a manifest
// match rule — background/api/easyspeak.ts injects it on demand by its
// stable built path (content-scripts/easyspeak-parser.js, hardcoded there;
// see that file's PARSER_FILE constant).
//
// WXT bundles every content-script entrypoint as a plain IIFE — main() below
// runs to completion synchronously (the framework's own async wrapper around
// it still executes main()'s entire synchronous body before yielding at its
// first await), so the globalThis assignment is guaranteed to have happened
// by the time background/api/easyspeak.ts's first executeScript() call
// resolves — the same guarantee the old crxjs `?iife`-import workaround
// existed to provide. The second executeScript() call there invokes one of
// these globals by name.

import { parseLevelCell, parseMemberchart, parseProfileLinks } from "../shared/parsers/easyspeak-parser";

export default defineContentScript({
  registration: "runtime",
  matches: [],
  main() {
    Object.assign(globalThis, { parseProfileLinks, parseMemberchart, parseLevelCell });
  },
});
