import { defineConfig } from "vitest/config";

// Deliberately NOT merging/importing vite.config.ts here — loading the
// crx() plugin during a test run breaks, since it expects a manifest, a
// file writer, and an extension environment Vitest doesn't provide.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["dist/**", "example/**", "node_modules/**"],
  },
});
