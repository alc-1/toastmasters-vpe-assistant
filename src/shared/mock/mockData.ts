// src/shared/mock/mockData.ts
//
// Scaffold for a future demo/mock mode (useful for a Chrome Web Store review
// workaround and as an onboarding demo) — not wired up anywhere yet.
// Intended usage once implemented: api/basecamp.ts and api/easyspeak.ts
// would check MOCK_MODE and, if true, return these fixtures instead of
// hitting the real network/tab-navigation flows, so the UI layer never needs
// to know whether it's looking at real or demo data.

import type { BasecampScrape, EasySpeakScrape } from "../types";

/** Flip to true (and fill in the fixtures below) to enable demo mode. Not wired up yet. */
export const MOCK_MODE = false;

export const MOCK_BASECAMP_DATA: BasecampScrape | null = null;

export const MOCK_EASYSPEAK_DATA: EasySpeakScrape | null = null;
