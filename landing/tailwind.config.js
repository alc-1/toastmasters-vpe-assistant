/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      colors: {
        // Toastmasters brand system, carried over from src/shared/styles.css:
        // Loyal Blue navy is primary, Cool Gray is a subtle border/divider
        // tone, Happy Yellow is fill-only (buttons/badges with navy text, or
        // text on a navy background) — never text on a light surface, since
        // it fails WCAG AA there. navy-700/800/900 are pinned to the
        // extension's own --tm-navy/--tm-navy-hover/--tm-navy-active hex
        // values so hover states visually match the product itself.
        navy: {
          50: "#eef5f9",
          100: "#d9e9f1",
          200: "#b3d3e3",
          300: "#85b6cf",
          400: "#4f92b3",
          500: "#2a7297",
          600: "#0f5a82",
          700: "#004165",
          800: "#003654",
          900: "#002e47",
          950: "#001a29",
        },
        yellow: {
          accent: "#f2df74",
          "accent-hover": "#ecd257",
        },
        silver: {
          DEFAULT: "#a9b2b1",
          light: "#e2e8f0",
        },
        surface: {
          DEFAULT: "#ffffff",
          alt: "#f7f8fa",
        },
        success: {
          DEFAULT: "#2e7d32",
          bg: "#e6f4ea",
        },
        warning: {
          DEFAULT: "#d97706",
          text: "#92400e",
          bg: "#fef3e2",
        },
        danger: {
          DEFAULT: "#c62828",
          bg: "#fdecea",
        },
      },
    },
  },
  plugins: [],
};
