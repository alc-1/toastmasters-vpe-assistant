// src/shared/i18n-pure.ts
//
// A local, browser-free i18n instance for the handful of shared modules that
// are pure, zero-browser.*-dependency, and directly unit-tested by Vitest —
// shared/sync/delta.ts, shared/export/rows.ts, shared/backup.ts,
// shared/stepper-info.ts, shared/anonymize.ts (see CLAUDE.md's
// "Internationalization (i18n)" section for the full list and rationale).
//
// Every other user-facing string in this codebase goes through the
// WXT-auto-imported `i18n.t()` (from #i18n, backed by @wxt-dev/i18n's
// createI18n()) — but that function is a thin wrapper around
// browser.i18n.getMessage(), confirmed by reading @wxt-dev/i18n's own source
// (node_modules/@wxt-dev/i18n/dist/index.mjs): it only resolves messages
// inside a real, loaded browser extension, against the native
// _locales/<lang>/messages.json the @wxt-dev/i18n WXT module generates at
// build/dev time. vitest.config.ts deliberately never loads a live WXT/Vite
// build (its own comment: WXT's plugin "expects a manifest, a file writer,
// and an extension build environment Vitest doesn't provide"), so nothing
// Vitest imports directly can depend on #i18n/browser.i18n.getMessage()
// existing at all — confirmed there is no in-memory/Node-only message
// resolution path anywhere in @wxt-dev/i18n; its documented "non-WXT custom
// build integration" (parseMessagesFile/generateChromeMessagesFile) only
// covers *generating* a real _locales/*/messages.json for a non-WXT bundler
// to ship — it still requires a real extension runtime to actually resolve
// messages, so it doesn't solve the Vitest problem either.
//
// t() here replicates createI18n()'s exact resolution algorithm (key lookup,
// " | "-joined plural-variant selection, $N positional substitution, {name}
// named substitution) against src/locales/generated/<lang>.pure-generated.json
// — plain JSON files (scripts/generate-i18n-pure-messages.ts, regenerated from
// the same src/locales/*.yml files the real #i18n path reads) that are safe to
// import from Node (Vitest) and from a Vite browser bundle alike, unlike
// anything from @wxt-dev/i18n/build itself (which statically imports
// node:fs/promises and would break a browser bundle).
//
// LOCALE SELECTION: reads `browser.i18n.getUILanguage()` — guarded behind
// `typeof browser !== "undefined"`, so this stays a no-op (falls back to the
// default locale, "en") under Vitest, where nothing auto-imports `browser` and
// the bare identifier is simply unbound. `typeof` is the one operator that
// never throws on an unbound identifier, so this check is safe with or
// without WXT's build-time auto-import having run. Inside a real built
// extension, WXT's usual auto-import (the same mechanism every other
// `browser.*` call site in this codebase relies on — see CLAUDE.md's
// Architecture section) resolves `browser` to the real WebExtension API, and
// `getUILanguage()` returns the browser's actual UI language, so this file
// ends up matching the exact same locale the ambient `i18n.t()` path already
// resolves to via native browser.i18n.getMessage() — no separate preference
// to keep in sync. Deliberately NOT using `navigator.language`: unlike
// `browser.i18n.getUILanguage()`, Node itself exposes a global `navigator`
// (since Node 21) whose `.language` reflects the host machine's OS locale —
// that would make this module's output depend on whatever machine/CI runner
// Vitest happens to run on, breaking the "pure" guarantee these 5 modules'
// tests rely on.
//
// Deliberately untyped on `key` (plain string, not a generated key union) —
// unlike #i18n's compile-time-checked keys, this trades that safety for
// guaranteed compatibility everywhere; a typo here only surfaces at runtime
// (a console.warn, same as createI18n()'s own missing-key behavior) or via
// the Vitest assertions already covering these 5 modules' output.

import enMessages from "../locales/generated/en.pure-generated.json";
import frMessages from "../locales/generated/fr.pure-generated.json";

type ChromeMessage = { message: string };
type SupportedLocale = "en" | "fr";

const DEFAULT_LOCALE: SupportedLocale = "en";

// One literal entry per src/locales/<lang>.yml file — unlike the generation
// script above (which discovers locale files automatically), a static import
// can't be built from a directory listing, so adding a third locale means
// adding its import + a line here too.
const MESSAGES: Record<SupportedLocale, Record<string, ChromeMessage>> = {
  en: enMessages as Record<string, ChromeMessage>,
  fr: frMessages as Record<string, ChromeMessage>,
};

let cachedLocale: SupportedLocale | undefined;

function resolveLocale(): SupportedLocale {
  if (cachedLocale) return cachedLocale;
  let uiLanguage: string | undefined;
  if (typeof browser !== "undefined" && typeof browser.i18n?.getUILanguage === "function") {
    uiLanguage = browser.i18n.getUILanguage();
  }
  const primary = uiLanguage?.split(/[-_]/)[0]?.toLowerCase();
  cachedLocale = primary != null && primary in MESSAGES ? (primary as SupportedLocale) : DEFAULT_LOCALE;
  return cachedLocale;
}

const NAMED_SUBSTITUTION_RE = /\{([A-Za-z0-9_]+)\}/g;

function applyNamedSubstitutions(message: string, substitutions: Record<string, string | number>): string {
  return message.replace(NAMED_SUBSTITUTION_RE, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(substitutions, key) ? String(substitutions[key]) : match,
  );
}

function applyPositionalSubstitutions(message: string, substitutions: string[]): string {
  return substitutions.reduce((text, sub, i) => text.replaceAll(`$${i + 1}`, sub), message);
}

function isNamedSubstitutions(value: unknown): value is Record<string, string | number> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

/**
 * PURE. Mirrors @wxt-dev/i18n's createI18n().t() call shape:
 *   t("some.key")
 *   t("some.count.key", count)                 // pluralized, numeric-keyed in en.yml
 *   t("some.key", ["substituted value"])        // positional $1/$2/...
 *   t("some.key", { name: "Ada" })              // named {name}
 *   t("some.count.key", count, ["extra"])       // plural + positional together
 */
export function t(
  key: string,
  ...args: Array<number | string[] | Record<string, string | number> | undefined>
): string {
  let sub: string[] | undefined;
  let namedSub: Record<string, string | number> | undefined;
  let count: number | undefined;

  args.forEach((arg, i) => {
    if (arg == null) {
      // skip
    } else if (typeof arg === "number") {
      count = arg;
    } else if (Array.isArray(arg)) {
      sub = arg;
    } else if (isNamedSubstitutions(arg)) {
      namedSub = arg;
    } else {
      throw new Error(`[i18n-pure] Unknown argument at index ${i} for key "${key}".`);
    }
  });

  if (count != null && sub == null) sub = [String(count)];

  const locale = resolveLocale();
  const dictKey = key.replaceAll(".", "_");
  // Falls back to the default locale for a key missing from a non-default
  // one — mirrors native browser.i18n.getMessage()'s own default_locale
  // fallback, so a translation file lagging behind a newly-added en.yml key
  // degrades to English rather than to a blank string.
  const entry = MESSAGES[locale][dictKey] ?? (locale !== DEFAULT_LOCALE ? MESSAGES[DEFAULT_LOCALE][dictKey] : undefined);
  let message = entry?.message;
  if (message == null) {
    console.warn(`[i18n-pure] Message not found: "${key}"`);
    message = "";
  }

  if (count != null) {
    const plural = message.split(" | ");
    switch (plural.length) {
      case 1:
        message = plural[0];
        break;
      case 2:
        message = plural[count === 1 ? 0 : 1];
        break;
      case 3:
        message = plural[count === 0 || count === 1 ? count : 2];
        break;
      default:
        throw new Error(`[i18n-pure] Unknown plural formatting for key "${key}".`);
    }
  }

  if (sub?.length) message = applyPositionalSubstitutions(message, sub);
  return namedSub == null ? message : applyNamedSubstitutions(message, namedSub);
}
