import type { Config } from "tailwindcss";
import { sharedColors } from "./tailwind-tokens.js";

// The single source of truth for every design-token value in this app.
// src/shared/styles.css's `:root` block resolves its custom properties from
// here via Tailwind's theme() CSS function rather than restating literals,
// so per-page <style> blocks that still consume var(--*) directly stay in
// sync automatically. The brand color palette itself (navy/yellow/silver/
// surface/success/warning/danger) lives in ./tailwind-tokens.js, shared with
// landing/tailwind.config.js (a separate, unrelated Vite+React build), so
// the extension and the marketing site never hand-copy the same hex values
// independently — but this config layers its own extras on top that
// tailwind-tokens.js does NOT cover: --info/--info-bg, --disabled-bg,
// --border, and the three text-gray steps, all of which this app's
// component classes (badges, buttons, borders) depend on and landing has no
// use for.
//
// tm-gray is intentionally namespaced rather than extending Tailwind's own
// `gray` scale: overriding only 3 of Tailwind's default gray steps (900/700/
// 600) would leave the untouched steps (50/100/.../800/950) as Tailwind's
// stock grays sitting right next to brand-specific ones — a confusing
// partial collision. Same reasoning for `space-*`: --space-5/--space-6
// (24px/32px) do NOT match Tailwind's default spacing.5/spacing.6 (20px/
// 24px), so reusing bare numeric keys would be silently wrong for two of
// the six steps.
export default {
  content: ["./src/**/*.html", "./src/**/*.ts"],
  // Preflight (Tailwind's base-layer browser-default reset) is deliberately
  // OFF: it zeroes margins/padding on every heading/paragraph/list element
  // and strips native form-control styling app-wide, not just on the pages
  // this migration touches directly — a much bigger blast radius than the
  // component classes being ported. This codebase already has its own
  // minimal reset (see styles.css's `body` rule) and many pages still rely
  // on browser defaults for elements this migration doesn't touch yet.
  // Disabling Preflight while adopting Tailwind into an already-styled app
  // is the standard, documented pattern for exactly this situation.
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        ...sharedColors,
        border: {
          DEFAULT: "#e2e8f0", // --border — a distinct semantic token from silver.light despite the shared hex
        },
        info: {
          DEFAULT: "#004165", // --info (alias of navy-700 in the old token system)
          bg: "#e3ecf3", // --info-bg
        },
        disabled: {
          DEFAULT: "#aaaaaa", // --disabled-bg
        },
        "tm-gray": {
          900: "#222222", // --gray-900 — body text
          700: "#444444", // --gray-700 — secondary-btn text, inactive tabs
          600: "#666666", // --gray-600 — the one "muted but AA-readable" text color
        },
        // Home dashboard feature-tile icon badges only — one accent per tile.
        // Namespaced (not bare `indigo`/`slate`) for the same reason as
        // `tm-gray` above: they'd otherwise shadow only the DEFAULT/bg keys of
        // Tailwind's stock same-named scales, a confusing partial collision.
        // Only .DEFAULT (icon glyph) + .bg (badge fill) are consumed, via
        // styles.css's :root --tile-* tokens.
        "tile-indigo": { DEFAULT: "#4f46e5", bg: "#eef2ff" },
        "tile-emerald": { DEFAULT: "#047857", bg: "#ecfdf5" },
        "tile-amber": { DEFAULT: "#b45309", bg: "#fffbeb" },
        "tile-slate": { DEFAULT: "#475569", bg: "#f1f5f9" },
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "sans-serif"],
      },
      fontSize: {
        xs: "11px", // --text-xs
        sm: "12px", // --text-sm
        base: "13px", // --text-base
        md: "15px", // --text-md
        lg: "16px", // --text-lg
        xl: "20px", // --text-xl
      },
      spacing: {
        "space-1": "4px",
        "space-2": "8px",
        "space-3": "12px",
        "space-4": "16px",
        "space-5": "24px",
        "space-6": "32px",
      },
      borderRadius: {
        sm: "4px", // --radius-sm — inputs
        md: "8px", // --radius-md — buttons, boxes, banners, cards
        pill: "999px", // --radius-pill — badges, chips, count badges
      },
    },
  },
  plugins: [],
} satisfies Config;
