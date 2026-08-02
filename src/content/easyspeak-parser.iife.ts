// src/content/easyspeak-parser.iife.ts
//
// Injected via chrome.scripting.executeScript into a real, navigated
// EasySpeak tab (tmclub.eu/etc. — an external page, not an extension page).
// Must be imported in background/api/easyspeak.ts as:
//
//   import parserFile from "../../content/easyspeak-parser.iife.ts?iife";
//   await chrome.scripting.executeScript({ target, files: [parserFile] });
//
// The `?iife` import query (not the default `?script` query) is load-bearing:
// @crxjs/vite-plugin's default `?script` loader is an async IIFE that does
// `await import(...)` internally, so chrome.scripting.executeScript()'s
// promise resolves once that *outer* synchronous wrapper returns — BEFORE
// the imported module body (and thus the globals this file assigns) has
// actually run. The second executeScript() call (which invokes
// window.parseProfileLinks/etc. by name) would then race the first and
// intermittently fail with "not a function". `?iife` instead bundles a
// plain classic script that runs to completion synchronously, so the
// globals are guaranteed to exist the moment the first executeScript() call
// resolves — the same guarantee the old unbundled lib/easyspeak-parser.js
// file provided for free. See CLAUDE.md for the full writeup.

import { parseLevelCell, parseMemberchart, parseProfileLinks } from "../shared/parsers/easyspeak-parser";

Object.assign(globalThis, { parseProfileLinks, parseMemberchart, parseLevelCell });
