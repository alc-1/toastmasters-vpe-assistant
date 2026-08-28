// scripts/cut-release.ts
//
// Usage: node scripts/cut-release.ts <patch|minor|major>
//
// Called from .github/workflows/release.yml's existing manual bump step (the
// workflow_dispatch patch/minor/major dropdown is untouched — this just
// replaces what used to be a bare `npm version ...` call). Bumps the version
// and promotes CHANGELOG.md's "## [Unreleased]" section to a dated heading
// in the same process, before returning — so release.yml's single existing
// `git commit` step always captures both files together, never one without
// the other.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { promoteUnreleased } from "./changelog.ts";

const BUMPS = ["patch", "minor", "major"] as const;
type Bump = (typeof BUMPS)[number];

function isBump(value: string | undefined): value is Bump {
  return !!value && (BUMPS as readonly string[]).includes(value);
}

function readVersion(): string {
  return JSON.parse(readFileSync("package.json", "utf8")).version;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function main(): void {
  const bump = process.argv[2];
  if (!isBump(bump)) {
    throw new Error(`cut-release: expected one of ${BUMPS.join("/")}, got "${bump ?? ""}"`);
  }

  // execSync (always shell-based) rather than execFileSync — on Windows,
  // "npm" resolves to a .cmd shim that execFileSync can't invoke without
  // going through a shell (ENOENT otherwise), and execFileSync's own
  // shell:true option is deprecated (Node's DEP0190) when combined with an
  // args array. `bump` is validated against a fixed enum above, so
  // interpolating it into the command string carries no injection risk.
  execSync(`npm version ${bump} --no-git-tag-version`, { stdio: "inherit" });
  const version = readVersion();

  const changelog = readFileSync("CHANGELOG.md", "utf8");
  writeFileSync("CHANGELOG.md", promoteUnreleased(changelog, version, todayIsoDate()));

  console.log(`cut-release: bumped to v${version} and promoted CHANGELOG.md's Unreleased section.`);
}

main();
