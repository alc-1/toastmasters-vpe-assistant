import { defineConfig } from "wxt";
import { generateChangelogJson } from "./scripts/generate-changelog-json";

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
    "build:before": () => generateChangelogJson(),
  },

  manifest: ({ mode, browser }) => {
    const isPreview = mode === "preview";
    const titleSuffix = isPreview ? " (Preview)" : "";

    const icons = {
      16: "icons/default/16.png",
      32: "icons/default/32.png",
      48: "icons/default/48.png",
      128: "icons/default/128.png",
    };

    return {
      name: `Toastmasters VPE Assistant${titleSuffix}`,
      description:
        "Get a clear view of your club’s progress by bringing EasySpeak and Basecamp data together in one place." +
        (isPreview ? " Preview build for testers — not the Chrome Web Store version." : ""),

      permissions: ["storage", "scripting", ...(isPreview ? ["alarms", "notifications"] : [])],

      host_permissions: [
        "https://basecamp.toastmasters.org/*",
        "https://apps.basecamp.toastmasters.org/*",
        "https://tmclub.eu/*",
        "https://toastmasterclub.org/*",
        "https://easy-speak.org/*",
        ...(isPreview ? ["https://api.github.com/*"] : []),
      ],

      icons,
      action: {
        default_icon: icons,
        default_title: `Toastmasters VPE Assistant${titleSuffix}`,
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
      browser_specific_settings:
        browser === "firefox"
          ? {
              gecko: {
                id: "vpe-assistant@toastmasters-vpe-assistant.app",
                data_collection_permissions: { required: ["none"] },
              },
            }
          : undefined,
    };
  },
});
