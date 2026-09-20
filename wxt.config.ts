import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";
import { generateChangelogJson } from "./scripts/generate-changelog-json";
import { generateI18nPureMessages } from "./scripts/generate-i18n-pure-messages";

// Two release targets share this one config: "store" (the Chrome Web Store /
// AMO submission candidate) and "preview" (for testers, outside either
// store) — selected via `--mode store`/`--mode preview` (see package.json's
// scripts), mirroring the old vite.config.ts's mode switch. Combined with
// `-b chrome`/`-b firefox`, that's 4 build combinations; outDirTemplate keeps
// them in separate directories (WXT's default template only varies by
// dev-vs-not, which would otherwise let a --mode preview build silently
// overwrite a --mode store build for the same browser).
export default defineConfig({
  srcDir: "src",
  outDirTemplate: "{{mode}}/{{browser}}-mv{{manifestVersion}}",

  // @wxt-dev/i18n: reads src/locales/en.yml (manifest.default_locale below),
  // auto-generates the native _locales/en/messages.json + the #i18n
  // auto-import's typed structure. See CLAUDE.md's "Internationalization
  // (i18n)" section for the full story, including why a handful of pure/
  // Vitest-tested shared modules use a separate local i18n instance
  // (shared/i18n-pure.ts) instead of #i18n.
  modules: ["@wxt-dev/i18n/module"],

  // Tailwind CSS v4 is wired in as a Vite plugin (v4's official integration —
  // there is no tailwind.config.ts / postcss.config.js anymore; theme + the
  // daisyUI plugin live in src/shared/styles.css). WXT merges this into its
  // own Vite config for every entrypoint's build.
  vite: () => ({
    plugins: [tailwindcss()],
  }),

  hooks: {
    // Regenerate public/changelog.json from CHANGELOG.md before every build.
    // 'build:before' fires for `wxt build`, `wxt zip`, and `wxt dev`, so this
    // covers any caller that invokes wxt directly and bypasses the npm-script
    // chain — e.g. a `wxt zip` run after cut-release.ts has promoted
    // CHANGELOG.md's [Unreleased] section, which otherwise ships a
    // changelog.json missing the just-cut version (the v1.2.0 release bug).
    // `wxt prepare` (postinstall) stays covered by its own explicit call: the
    // file must exist on disk before prepare scans public/ for the PublicPath
    // type on a fresh clone.
    "build:before": async () => {
      generateChangelogJson();
      await generateI18nPureMessages();
    },
  },

  manifest: ({ mode, browser }) => {
    const isPreview = mode === "preview";

    // __MSG_x__ is the native WebExtension i18n placeholder mechanism —
    // resolved from the generated _locales/en/messages.json (itself
    // generated from src/locales/en.yml by the @wxt-dev/i18n module above)
    // at load time, keyed by the message's dot-path with dots replaced by
    // underscores. Native substitution has no runtime templating, so the
    // store/preview variants are two separate, self-contained message keys
    // rather than one key plus a JS-side suffix — the store variant reuses
    // common.brand.title.label/common.tagline.default.body (the same
    // strings the welcome/popup pages show) since it's identical text; only
    // the preview variant needed its own manifest.* entries.
    const name = isPreview ? "__MSG_manifest_name_preview_label__" : "__MSG_common_brand_title_label__";
    const description = isPreview ? "__MSG_manifest_description_preview_label__" : "__MSG_common_tagline_default_body__";

    const icons = {
      16: "icons/default/16.png",
      32: "icons/default/32.png",
      48: "icons/default/48.png",
      128: "icons/default/128.png",
    };

    return {
      default_locale: "en",
      name,
      description,

      permissions: ["storage", "scripting", ...(isPreview ? ["alarms", "notifications"] : [])],

      host_permissions: [
        "https://basecamp.toastmasters.org/*",
        "https://apps.basecamp.toastmasters.org/*",
        "https://tmclub.eu/*",
        "https://toastmasterclub.org/*",
        "https://easy-speak.org/*",
        "https://www.toastmasters.org/*",
        ...(isPreview ? ["https://api.github.com/*"] : []),
      ],

      icons,
      action: {
        default_icon: icons,
        default_title: name,
      },

      // Required for AMO submission (listed) — placeholder id.
      // .github/workflows/release.yml's publish-firefox-store job submits this
      // build to AMO automatically (gated behind the firefox-addon-store GitHub
      // Environment), but this ID must be replaced with the real gecko ID AMO
      // assigns once the maintainer creates the listing by hand — and
      // secrets.FIREFOX_EXTENSION_ID kept in sync with it — before that job can
      // succeed for real.
      // data_collection_permissions is Mozilla's data-collection-consent requirement (mzl.la/firefox-builtin-data-consent);
      // "none" is accurate since nothing is transmitted off-device — revisit if that ever changes.
      // `gecko_android` is what opts the extension in to Firefox for Android on
      // AMO — without this key present, AMO never offers the add-on for Android
      // regardless of whether the code would run there. Same 128.0 floor as
      // desktop (general extension support on Firefox for Android landed in
      // Fenix 120; our own CSS/`browser.action` needs push it to 128 anyway).
      // The mobile UI has no toolbar area — the popup opens from the ⋮ menu and
      // the merged app runs as a normal tab — so the tab-navigation scrape flows
      // still work, but this pathway is only manually verifiable on a real
      // Android device/emulator (the e2e suite is Chromium-desktop only).
      browser_specific_settings:
        browser === "firefox"
          ? {
              gecko: {
                id: "vpe-assistant@toastmasters-vpe-assistant.app",
                data_collection_permissions: { required: ["none"] },
                // Tailwind v4's generated CSS uses @property and color-mix(),
                // supported from Firefox 128 — which the extension already
                // effectively requires (browser.action aliasing lands in 128,
                // and the UI uses :has() from 121).
                strict_min_version: "128.0",
              },
              gecko_android: {
                strict_min_version: "128.0",
              },
            }
          : undefined,
    };
  },
});
