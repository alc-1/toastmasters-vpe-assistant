// scripts/generate-i18n-pure-messages.ts
//
// Regenerates src/locales/generated/<lang>.pure-generated.json from every
// src/locales/<lang>.yml file (currently en.yml and fr.yml — any further
// src/locales/*.yml added later is picked up automatically by this script,
// with no changes needed here; shared/i18n-pure.ts's own locale list is the
// one place that still needs a literal addition, see that file).
//
// Why this exists: @wxt-dev/i18n's own runtime (createI18n()'s t(), reached via
// the WXT-auto-imported `#i18n`) is a thin wrapper around browser.i18n.getMessage()
// — it only resolves messages inside a real, loaded browser extension, reading the
// native src/../_locales/<lang>/messages.json the @wxt-dev/i18n/module WXT module
// generates automatically at build/dev time. That's fine for every view/background/
// static-page call site, but a handful of shared modules (see shared/i18n-pure.ts)
// are pure, browser-free, and unit-tested directly by Vitest (which never loads a
// live WXT/Vite build) — they can't depend on browser.i18n existing at all.
//
// This script reuses @wxt-dev/i18n's own parser (parseMessagesFile) and its own
// "compile to the native Chrome messages.json shape" step (generateChromeMessages —
// the exact same transform the WXT module itself runs to produce _locales/*/messages.json),
// then writes that shape out as a plain JSON file per locale. shared/i18n-pure.ts
// imports those JSON files directly (a normal module import, safe in Node, Vitest,
// and a Vite browser bundle alike) and replicates createI18n()'s own key-lookup/
// pluralization/substitution algorithm against them, without ever touching
// browser.i18n or node:fs at runtime. Same source YAML files, same compiled shape,
// two independent readers.
//
// Regeneration is wired the same two ways as scripts/generate-changelog-json.ts:
// chained into postinstall/dev/build*/zip* (package.json), and into wxt.config.ts's
// build:before hook for callers that invoke wxt directly.

import { argv } from "node:process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateChromeMessages, parseMessagesFile } from "@wxt-dev/i18n/build";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

export async function generateI18nPureMessages(repoRoot: string = REPO_ROOT): Promise<void> {
  const localesDir = `${repoRoot}/src/locales`;
  const localeFiles = readdirSync(localesDir).filter((f) => f.endsWith(".yml"));

  // Deliberately NOT written directly into src/locales/ — the @wxt-dev/i18n
  // WXT module globs that directory (src/locales/*.{yml,json,...}) for
  // locale files, and a plain flat-key JSON file there gets misidentified as
  // an (unsupported) locale named "<lang>.pure-generated", producing a build
  // warning. src/locales/generated/ is one level deeper, outside that glob.
  mkdirSync(`${localesDir}/generated`, { recursive: true });

  for (const file of localeFiles) {
    const locale = file.slice(0, -".yml".length);
    const parsed = await parseMessagesFile(`${localesDir}/${file}`);
    const messages = generateChromeMessages(parsed);
    writeFileSync(`${localesDir}/generated/${locale}.pure-generated.json`, JSON.stringify(messages, null, 2) + "\n");
  }
}

// Only self-run when invoked directly (`node scripts/generate-i18n-pure-messages.ts`,
// as postinstall and the npm scripts do) — not when imported by wxt.config.ts's
// build:before hook, which calls generateI18nPureMessages() itself.
if (fileURLToPath(import.meta.url) === argv[1]) {
  await generateI18nPureMessages();
}
