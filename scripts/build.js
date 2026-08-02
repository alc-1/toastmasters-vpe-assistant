// scripts/build.js
//
// Copy-based build: no bundler, no transpilation — every runtime file lands
// in dist/ byte-for-byte, preserving the classic-script/importScripts
// loading model this MV3 extension relies on (see CLAUDE.md's "no
// transpilation/bundling" convention). Allowlist-copy rather than a denylist
// so a stray test/dev file can never accidentally ship inside dist/.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const ENTRIES = [
  "manifest.json",
  "background.js",
  "icons",
  "lib",
  "members",
  "popup",
  "report",
  "settings",
  "status",
];

function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  for (const entry of ENTRIES) {
    fs.cpSync(path.join(ROOT, entry), path.join(DIST, entry), { recursive: true });
  }
  console.log(`Built dist/ (${ENTRIES.length} entries).`);
}

build();

if (process.argv.includes("--watch")) {
  console.log("Watching for changes...");
  for (const entry of ENTRIES) {
    const entryPath = path.join(ROOT, entry);
    fs.watch(entryPath, { recursive: true }, () => build());
  }
}
