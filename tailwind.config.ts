import type { Config } from "tailwindcss";

// Design tokens ported from src/shared/styles.css's `:root` block (the
// hand-written custom-property system this file replaces). Colors that
// already exist in landing/tailwind.config.js (a separate, unrelated Vite+
// React build) reuse the exact same hex values on purpose, so the extension
// and the marketing site never visually drift apart — but this config is
// NOT copied wholesale from there: landing/'s config is missing --info/
// --info-bg, --disabled-bg, --border, and the three text-gray steps, all of
// which this app's component classes (badges, buttons, borders) depend on.
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
        navy: {
          50: "#eef5f9",
          100: "#d9e9f1",
          200: "#b3d3e3",
          300: "#85b6cf",
          400: "#4f92b3",
          500: "#2a7297",
          600: "#0f5a82",
          700: "#004165", // --tm-navy / --primary
          800: "#003654", // --tm-navy-hover / --primary-hover
          900: "#002e47", // --tm-navy-active / --primary-active
          950: "#001a29",
        },
        yellow: {
          accent: "#f2df74", // --tm-yellow — app-header__title only, nowhere else
          "accent-hover": "#ecd257",
        },
        silver: {
          DEFAULT: "#a9b2b1", // --tm-silver
          light: "#e2e8f0",
        },
        surface: {
          DEFAULT: "#ffffff", // --surface
          alt: "#f7f8fa", // --surface-alt
        },
        border: {
          DEFAULT: "#e2e8f0", // --border — a distinct semantic token from silver.light despite the shared hex
        },
        success: {
          DEFAULT: "#2e7d32", // --success
          bg: "#e6f4ea", // --success-bg
        },
        warning: {
          DEFAULT: "#d97706", // --warning
          text: "#92400e", // --warning-text — darkened variant for AA-safe small bold text on --warning-bg
          bg: "#fef3e2", // --warning-bg
        },
        danger: {
          DEFAULT: "#c62828", // --danger
          bg: "#fdecea", // --danger-bg
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
