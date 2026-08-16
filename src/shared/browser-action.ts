// src/shared/browser-action.ts
//
// browser.action (the MV3 name, used uniformly elsewhere in this codebase) is
// only aliased onto Firefox's MV2 browser.browserAction natively from Firefox
// 128 onward — WXT does not polyfill this itself. On an older Firefox,
// browser.action is simply undefined, and any call through it throws
// immediately. Every actionApi.* call in this codebase (background/icon-state.ts,
// shared/update-store.ts, background/api/update-checker.ts) must go through
// this fallback instead of `browser.action` directly.

export const actionApi: typeof browser.action = browser.action ?? (browser as unknown as { browserAction: typeof browser.action }).browserAction;
