# Source code review notes (Firefox / AMO)

This archive contains the full source tree used to build the Firefox package submitted to
addons.mozilla.org. To reproduce that build from source:

```
npm i
npm run zip:firefox
```

Requirements: Node.js >= 24 (see `package.json`'s `engines` field).

`npm run zip:firefox` type-checks, builds, and zips the extension for Firefox (Manifest V2) in
one step. The resulting unpacked extension is written to `.output/store/firefox-mv2/`, and the
zip that should match the submitted package is written to
`.output/toastmasters-vpe-assistant-<version>-firefox-store.zip` (`<version>` matches this
package's `package.json` version).

## Notes on addons-linter warnings

Running the submitted zip through addons-linter reports 0 errors and a number of warnings, all in
the built `chunks/*.js` output rather than in this source tree directly. Neither warning category
below reflects a problem with the submitted code; both are explained here so a reviewer doesn't
need to re-derive this from minified output.

**"Unsafe assignment to innerHTML"**: this codebase intentionally renders every extension page
with plain DOM template-literal strings assigned to `.innerHTML` (no framework, no DOM diffing —
see `CLAUDE.md`'s "Architecture" section). Any untrusted content interpolated into those
templates — scraped member names, club names, path names — is passed through
`src/shared/dom-utils.ts`'s `escapeHtml()`/`escapeAttr()` first (`escapeAttr` specifically for
values landing inside an HTML attribute, `escapeHtml` for text-node content). addons-linter's
static analysis flags any `.innerHTML =` assignment it can't prove is a hardcoded string literal;
it has no way to see that the interpolated values were already sanitized earlier in the same
template-literal expression, so it flags the pattern itself rather than a real gap.

**"The Function constructor is eval."**: all of these originate from the bundled `exceljs`
package (this project's only production dependency, used solely to build the `.xlsx` export in
`src/shared/export/workbook.ts`) — none of it is this project's own code. Specifically: one is
`jszip`'s `setImmediate` polyfill fallback branch, which is never taken in practice; several are
the standard lodash "get global root" idiom (`Function('return this')()`) baked into lodash
micro-packages pulled in transitively by `fast-csv` — dead weight here, since `exceljs` requires
its CSV module unconditionally even though this project only ever writes `.xlsx` and never
touches CSV; and one is `regenerator-runtime`'s bootstrap, which only executes if `globalThis` is
undefined, which cannot happen in any supported browser. None of the flagged branches are
reachable in this project's actual usage.

See `CLAUDE.md` at the root of this source tree for a full architecture/build-tooling overview.
