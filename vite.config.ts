import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";

// Not import.meta.dirname (Node 20.11+ only) — this repo's toolchain targets
// Node 18, so resolve paths the portable way.
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Read manifest.json via fs rather than a JSON import attribute
// (`with { type: "json" }`) — Node 18's support for that syntax is
// version-sensitive, so a plain readFileSync + JSON.parse sidesteps it.
const manifest = JSON.parse(readFileSync(r("manifest.json"), "utf8"));

export default defineConfig({
  // root: "src" so build output lands at dist/popup/index.html,
  // dist/options/report.html, etc. instead of leaking the src/ prefix into
  // every chrome.runtime.getURL(...) string. See src/shared/pages.ts, the
  // one place that would need to change if this decision is ever reversed.
  root: r("src"),
  publicDir: r("public"), // must be explicit once root != repo root
  build: {
    outDir: r("dist"), // must be explicit once root != repo root
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      input: {
        // popup/index.html is NOT listed here — crxjs picks it up
        // automatically from manifest.json's action.default_popup.
        report: r("src/options/report.html"),
        members: r("src/options/members.html"),
        settings: r("src/options/settings.html"),
        syncData: r("src/options/sync-data.html"),
        clubReview: r("src/options/club-review.html"),
        basecampAuth: r("src/status/basecamp-auth.html"),
        easyspeakDone: r("src/status/easyspeak-done.html"),
        welcome: r("src/welcome/welcome.html"),
      },
    },
  },
  plugins: [crx({ manifest })],
  server: {
    cors: { origin: [/chrome-extension:\/\//] }, // required by @crxjs/vite-plugin's dev server
  },
});
