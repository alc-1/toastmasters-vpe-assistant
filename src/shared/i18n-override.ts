// src/shared/i18n-override.ts
//
// Lets a user override the extension's display language independent of the
// browser's own UI language, via Global Settings' "Interface Language" card
// (entrypoints/app/views/globalSettings.ts). Native WebExtension i18n
// (browser.i18n.getMessage(), which the ambient #i18n's i18n.t() wraps — see
// shared/i18n-pure.ts's header comment) has no API to change locale at
// runtime — it always reflects the browser's own UI language — so this
// works instead by monkey-patching #i18n's own singleton object in place:
// `#i18n` (@wxt-dev/i18n's createI18n()) is one plain `{ t }` object per JS
// module graph, and every ambient `i18n.t(...)` call site in this codebase
// holds a reference to that SAME object (ES module singleton semantics), so
// replacing its `.t` property once, early, transparently redirects every
// existing call site to consult the stored preference first — no need to
// touch each one individually.
//
// A JS module graph is per JS CONTEXT, not shared extension-wide — the
// background service worker, the merged app tab, the popup, and each static
// interstitial page all load #i18n independently. initLocaleOverride() must
// therefore run once per context, before any i18n.t()/applyI18n() call in
// that context — see the call sites in entrypoints/background.ts,
// entrypoints/app/main.ts, entrypoints/popup/main.ts, and the static
// interstitial pages' main.ts files.

import { resolveMessage } from "./i18n-pure";
import { getPreferredLocale } from "./settings-store";
import type { LocalePreference } from "./types";

let currentPreference: LocalePreference = "system";
let patched = false;

// #i18n's generated type only exposes `t` for calling, not reassigning —
// this alias is exactly what lets us bypass that and swap the implementation.
type AnyI18nT = (key: any, ...args: any[]) => string;

function patchAmbientT(): void {
  if (patched) return;
  patched = true;

  const nativeT = i18n.t as AnyI18nT;
  (i18n as unknown as { t: AnyI18nT }).t = (key, ...args) => {
    // "system" (the default, and the only option before this feature
    // existed) keeps using the browser's own UI language exactly as before.
    if (currentPreference === "system") return nativeT(key, ...args);
    return resolveMessage(currentPreference, key, ...args);
  };
}

/**
 * Call once per JS context, before any i18n.t()/applyI18n() use in that
 * context. Reads the persisted preference, patches the ambient i18n.t
 * accordingly, and keeps an in-memory copy fresh via storage.onChanged so a
 * later change (e.g. made from a different tab) is picked up without this
 * needing to be called again in an already-running context.
 */
export async function initLocaleOverride(): Promise<void> {
  currentPreference = await getPreferredLocale();
  patchAmbientT();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "preferredLocale" in changes) {
      currentPreference = (changes.preferredLocale.newValue as LocalePreference | undefined) ?? "system";
    }
  });
}
