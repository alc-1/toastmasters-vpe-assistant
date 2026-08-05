import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Deployed via .github/workflows/deploy-pages.yml (build artifact uploaded
// straight to GitHub Pages) — build output is not committed to the repo,
// so this uses Vite's default outDir (landing/dist).
export default defineConfig({
  plugins: [react()],
  base: "./",
});
