import { sharedColors } from "../tailwind-tokens.js";

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
      // Toastmasters brand system, shared with the extension's own
      // tailwind.config.ts via ../tailwind-tokens.js so both apps' hex
      // values can never independently drift: Loyal Blue navy is primary,
      // Cool Gray is a subtle border/divider tone, Happy Yellow is fill-only
      // (buttons/badges with navy text, or text on a navy background) —
      // never text on a light surface, since it fails WCAG AA there.
      // navy-700/800/900 are pinned to the extension's own
      // --tm-navy/--tm-navy-hover/--tm-navy-active hex values so hover
      // states visually match the product itself.
      colors: {
        ...sharedColors,
      },
    },
  },
  plugins: [],
};
