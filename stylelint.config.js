// stylelint.config.js
//
// Scoped to src/shared/styles.css only for this first pass (see package.
// json's lint:css script) — per-page inline <style> blocks embedded in
// .html files would need postcss-html syntax support, a bigger addition
// left for later rather than bundled into this first pass.
//
// stylelint-config-standard's opinions on selector naming, blank-line
// spacing, and modern color-function/hex-length notation don't match this
// file's established, intentional conventions (BEM-style __/-- class names
// throughout; declarations grouped without a blank line between them within
// a rule) — reformatting 1400+ lines of already-shipped, visually-verified
// CSS to satisfy a linter's stylistic taste isn't the goal here, so those
// specific rules are disabled below rather than the file being rewritten to
// fit them. This still leaves stylelint catching genuine mistakes: invalid
// values, duplicate properties, unknown properties/at-rules (typos),
// unclosed blocks, etc.
export default {
  extends: "stylelint-config-standard",
  rules: {
    "at-rule-no-unknown": [
      true,
      {
        // Tailwind v4 CSS-first + daisyUI plugin directives, plus the v3-era
        // ones still valid in v4.
        ignoreAtRules: [
          "tailwind",
          "apply",
          "layer",
          "screen",
          "variants",
          "responsive",
          "theme",
          "plugin",
          "config",
          "source",
          "utility",
          "variant",
          "custom-variant",
          "reference",
        ],
      },
    ],
    "import-notation": null, // @import "tailwindcss"; (string form required by Tailwind v4)
    "at-rule-empty-line-before": null, // @plugin/@theme blocks sit grouped in the preamble
    "value-keyword-case": ["lower", { ignoreProperties: ["font-family", "--font-sans"] }], // BlinkMacSystemFont etc. keep their case
    "selector-class-pattern": null, // BEM (__/--) naming throughout, not stylelint's default kebab-case-only
    "selector-id-pattern": null, // element ids are camelCase throughout this codebase (#popupStepperRoot, etc.)
    "declaration-empty-line-before": null, // this file groups declarations with no blank line within a rule
    "comment-empty-line-before": null, // comments sit directly above the rule/declaration they describe
    "custom-property-empty-line-before": null,
    "color-function-notation": null, // rgba(...) legacy notation used throughout on purpose
    "color-function-alias-notation": null,
    "alpha-value-notation": null,
    "color-hex-length": null, // #ffffff kept full-length for readability/grep-ability
    "media-feature-range-notation": null,
    // Flags cascade-order concerns on already-shipped, visually-verified
    // rules; reordering to satisfy it risks changing which rule wins for a
    // given element, not worth the regression risk for a lint-only pass.
    "no-descending-specificity": null,
  },
};
