// tailwind-tokens.js
//
// Shared Toastmasters brand color palette, imported by both the extension's
// tailwind.config.ts (root) and landing/tailwind.config.js — previously each
// config hand-copied the same hex values independently, with no guarantee
// they'd stay in sync. This file covers only the subset both apps actually
// share; each config still layers its own extra tokens on top (the
// extension needs --info/--disabled/--border/tm-gray for its badges/buttons/
// borders; landing needs its own extended font stack) rather than everything
// living here.
export const sharedColors = {
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
};
