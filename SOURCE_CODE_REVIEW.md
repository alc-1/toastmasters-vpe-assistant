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

See `CLAUDE.md` at the root of this source tree for a full architecture/build-tooling overview.
