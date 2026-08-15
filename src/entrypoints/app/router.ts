// src/entrypoints/app/router.ts
//
// Pure hash-fragment resolution for the merged app — no server, so hash
// routing avoids any rewrite/proxy need and lets plain <a href="#members">
// tags work via the browser's native hashchange event with no click
// handler needed. Kept separate from main.ts (the actual navigate()/mount
// driver) since this part is pure and worth reasoning about independently.

import type { AppRoute } from "../../shared/pages";
import type { StepperInfo } from "../../shared/app-shell";

const VALID_ROUTES: AppRoute[] = ["setup", "syncData", "clubReview", "members", "report", "globalSettings"];

function isAppRoute(value: string): value is AppRoute {
  return (VALID_ROUTES as string[]).includes(value);
}

/**
 * Resolves a raw `location.hash` into a route: an empty or unrecognized
 * hash defaults to "setup" (the wizard's first step); a recognized but
 * currently-disabled wizard step (e.g. a bookmarked #report saved before
 * setup was finished) is redirected back to "setup" too — globalSettings
 * is never gated, since it isn't one of the five wizard steps.
 */
export function resolveRoute(rawHash: string, info: StepperInfo | null): AppRoute {
  const key = rawHash.replace(/^#/, "");
  const route = isAppRoute(key) ? key : "setup";
  if (route === "globalSettings") return route;
  if (info?.[route]?.disabled) return "setup";
  return route;
}
