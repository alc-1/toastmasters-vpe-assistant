// src/shared/mock/mockData.ts
//
// Fixture data for mock/demo mode (shared/settings-store.ts's getMockMode(),
// true when the active profile is "demo" — see setActiveProfile(), called
// from the Setup page). When mock mode is on, api/basecamp.ts and
// api/easyspeak.ts return the fixtures below
// instead of contacting the real network/tab-navigation flows — useful both
// as a Chrome Web Store review workaround (a reviewer can't log into either
// system) and as an onboarding demo. Everything downstream (popup, the
// Comparison Report, the Members review page) reads this exactly like a real
// scrape, so nothing here is UI-aware.
//
// Fully fabricated: no real names, emails, or club data. One club-sized
// roster (12 members per side, 15 distinct name strings across both) so the
// demo feels like a real club rather than a handful of toy rows. Each member
// below is deliberately built to hit one specific case worth showing off in
// the Comparison Report / Members review UI — see the per-member comments.
// Two members (Marcus Webb, Sofia Alvarez) exist on only one side, and one
// pair (Nathaniel Brooks / Nate B) is intentionally two *separate* people as
// far as the matching algorithm is concerned, even though the names are
// meant to read as "could plausibly be the same person" to a human skimming
// the unmatched list.

import type { BasecampScrape, EasySpeakScrape } from "../types";

const CLUB_NAME = "Metro Toastmasters";
const BASECAMP_CLUB_UUID = "11111111-1111-1111-1111-111111111111";
const EASYSPEAK_CLUB_ID = "101";

export const MOCK_BASECAMP_DATA: BasecampScrape = {
  [BASECAMP_CLUB_UUID]: {
    name: CLUB_NAME,
    members: [
      {
        // Exact name match + identical path name on both sides -> the path
        // canonicalizes and binds automatically, no manual intervention
        // needed anywhere.
        user: { id: 2001, name: "Alice Johnson" },
        path_name: "Dynamic Leadership",
        progression: {
          "Level 1": { completed: 2, total: 2, approved: true },
          "Level 2": { completed: 2, total: 2, approved: true },
          "Level 3": { completed: 1, total: 4, approved: false },
          "Level 4": { completed: 0, total: 4, approved: false },
          "Level 5": { completed: 0, total: 2, approved: false },
          "Path Completion": { completed: 0, total: 1 },
        },
      },
      {
        // Clean exact match, further along (Level 3 approved) — plain
        // club-roster filler, nothing special to flag.
        user: { id: 2002, name: "Frank Delgado" },
        path_name: "Visionary Communication",
        progression: {
          "Level 1": { completed: 2, total: 2, approved: true },
          "Level 2": { completed: 2, total: 2, approved: true },
          "Level 3": { completed: 4, total: 4, approved: true },
          "Level 4": { completed: 0, total: 4, approved: false },
          "Level 5": { completed: 0, total: 2, approved: false },
          "Path Completion": { completed: 0, total: 1 },
        },
      },
      {
        // Clean exact match, just getting started — plain club-roster
        // filler.
        user: { id: 2003, name: "Grace Kim" },
        path_name: "Presentation Mastery",
        progression: {
          "Level 1": { completed: 1, total: 2, approved: false },
          "Level 2": { completed: 0, total: 2, approved: false },
          "Level 3": { completed: 0, total: 4, approved: false },
          "Level 4": { completed: 0, total: 4, approved: false },
          "Level 5": { completed: 0, total: 2, approved: false },
          "Path Completion": { completed: 0, total: 1 },
        },
      },
      {
        // Clean exact match, near the end of the path — plain club-roster
        // filler.
        user: { id: 2004, name: "Henry O'Sullivan" },
        path_name: "Motivational Strategies",
        progression: {
          "Level 1": { completed: 2, total: 2, approved: true },
          "Level 2": { completed: 2, total: 2, approved: true },
          "Level 3": { completed: 4, total: 4, approved: true },
          "Level 4": { completed: 4, total: 4, approved: true },
          "Level 5": { completed: 1, total: 2, approved: false },
          "Path Completion": { completed: 0, total: 1 },
        },
      },
      {
        // Clean exact match — plain club-roster filler.
        user: { id: 2005, name: "Isabel Rossi" },
        path_name: "Leadership Development",
        progression: {
          "Level 1": { completed: 2, total: 2, approved: true },
          "Level 2": { completed: 1, total: 2, approved: false },
          "Level 3": { completed: 0, total: 4, approved: false },
          "Level 4": { completed: 0, total: 4, approved: false },
          "Level 5": { completed: 0, total: 2, approved: false },
          "Path Completion": { completed: 0, total: 1 },
        },
      },
      {
        // Exact name match, but picked a DIFFERENT path than the one
        // recorded for them on EasySpeak (see MOCK_EASYSPEAK_DATA below) —
        // neither path is an alias of the other, so both sides end up
        // orphaned for this member (hasOrphanedPaths) until a VPE manually
        // binds them via a member-scoped path override.
        user: { id: 2006, name: "Ben Carter" },
        path_name: "Innovative Planning",
        progression: {
          "Level 1": { completed: 2, total: 2, approved: true },
          "Level 2": { completed: 1, total: 4, approved: false },
          "Level 3": { completed: 0, total: 4, approved: false },
          "Level 4": { completed: 0, total: 4, approved: false },
          "Level 5": { completed: 0, total: 2, approved: false },
          "Path Completion": { completed: 0, total: 1 },
        },
      },
      {
        // Exact name match; EasySpeak reports no active path for this
        // member at all (see MOCK_EASYSPEAK_DATA below) -> easyspeakNoActivePath.
        user: { id: 2007, name: "Carla Mendes" },
        path_name: "Team Collaboration",
        progression: {
          "Level 1": { completed: 2, total: 2, approved: true },
          "Level 2": { completed: 2, total: 2, approved: true },
          "Level 3": { completed: 1, total: 4, approved: false },
          "Level 4": { completed: 0, total: 4, approved: false },
          "Level 5": { completed: 0, total: 2, approved: false },
          "Path Completion": { completed: 0, total: 1 },
        },
      },
      {
        // Spelled "Diane Ostrowsky" on EasySpeak — close enough to clear the
        // fuzzy-match threshold, demoing a suggested (not automatic) match
        // in the Members review page.
        user: { id: 2008, name: "Diane Ostrowski" },
        path_name: "Effective Coaching",
        progression: {
          "Level 1": { completed: 2, total: 2, approved: true },
          "Level 2": { completed: 1, total: 3, approved: false },
          "Level 3": { completed: 0, total: 4, approved: false },
          "Level 4": { completed: 0, total: 4, approved: false },
          "Level 5": { completed: 0, total: 2, approved: false },
          "Path Completion": { completed: 0, total: 1 },
        },
      },
      {
        // Recorded as "Nate B" on EasySpeak (see MOCK_EASYSPEAK_DATA below)
        // — different enough that no automatic candidate is ever generated
        // (not even fuzzy), so this needs a manual search-and-link in the
        // Members review page.
        user: { id: 2009, name: "Nathaniel Brooks" },
        path_name: "Team Collaboration",
        progression: {
          "Level 1": { completed: 2, total: 2, approved: true },
          "Level 2": { completed: 0, total: 2, approved: false },
          "Level 3": { completed: 0, total: 4, approved: false },
          "Level 4": { completed: 0, total: 4, approved: false },
          "Level 5": { completed: 0, total: 2, approved: false },
          "Path Completion": { completed: 0, total: 1 },
        },
      },
      {
        // No EasySpeak counterpart at all — demos a "basecamp-only" member
        // row.
        user: { id: 2010, name: "Marcus Webb" },
        path_name: "Persuasive Influence",
        progression: {
          "Level 1": { completed: 2, total: 2, approved: true },
          "Level 2": { completed: 1, total: 3, approved: false },
          "Level 3": { completed: 0, total: 4, approved: false },
          "Level 4": { completed: 0, total: 4, approved: false },
          "Level 5": { completed: 0, total: 2, approved: false },
          "Path Completion": { completed: 0, total: 1 },
        },
      },
      {
        // Exact match. EasySpeak (see below) already shows 3 of the 4
        // Level 2 speeches done even though Basecamp has only 1 completed —
        // speeches given but not yet logged/approved in Basecamp
        // ("unreported speeches"). Real work still remains either way
        // (realMissing > 0), unlike Priya Chandrasekaran below.
        user: { id: 2011, name: "Owen Fitzgerald" },
        path_name: "Dynamic Leadership",
        progression: {
          "Level 1": { completed: 2, total: 2, approved: true },
          "Level 2": { completed: 1, total: 4, approved: false },
          "Level 3": { completed: 0, total: 4, approved: false },
          "Level 4": { completed: 0, total: 4, approved: false },
          "Level 5": { completed: 0, total: 2, approved: false },
          "Path Completion": { completed: 0, total: 1 },
        },
      },
      {
        // Exact match. Basecamp says 2 more Level 2 speeches are needed
        // ("To next level" > 0), but EasySpeak (see below) shows all 4
        // already done -> the unreported speeches fully cover what's
        // missing on paper, so the *real* remaining count is 0.
        user: { id: 2012, name: "Priya Chandrasekaran" },
        path_name: "Presentation Mastery",
        progression: {
          "Level 1": { completed: 2, total: 2, approved: true },
          "Level 2": { completed: 2, total: 4, approved: false },
          "Level 3": { completed: 0, total: 4, approved: false },
          "Level 4": { completed: 0, total: 4, approved: false },
          "Level 5": { completed: 0, total: 2, approved: false },
          "Path Completion": { completed: 0, total: 1 },
        },
      },
    ],
  },
};

export const MOCK_EASYSPEAK_DATA: EasySpeakScrape = {
  [EASYSPEAK_CLUB_ID]: {
    name: CLUB_NAME,
    members: [
      {
        memberId: "3001",
        name: "Alice Johnson",
        path: "Dynamic Leadership",
        levels: [
          { level: 1, needed: 2, done: 2 },
          { level: 2, needed: 2, done: 2 },
          { level: 3, needed: 4, done: 1 },
          { level: 4, needed: 4, done: 0 },
          { level: 5, needed: 2, done: 0 },
        ],
      },
      {
        memberId: "3002",
        name: "Frank Delgado",
        path: "Visionary Communication",
        levels: [
          { level: 1, needed: 2, done: 2 },
          { level: 2, needed: 2, done: 2 },
          { level: 3, needed: 4, done: 4 },
          { level: 4, needed: 4, done: 0 },
          { level: 5, needed: 2, done: 0 },
        ],
      },
      {
        memberId: "3003",
        name: "Grace Kim",
        path: "Presentation Mastery",
        levels: [
          { level: 1, needed: 2, done: 1 },
          { level: 2, needed: 2, done: 0 },
          { level: 3, needed: 4, done: 0 },
          { level: 4, needed: 4, done: 0 },
          { level: 5, needed: 2, done: 0 },
        ],
      },
      {
        memberId: "3004",
        name: "Henry O'Sullivan",
        path: "Motivational Strategies",
        levels: [
          { level: 1, needed: 2, done: 2 },
          { level: 2, needed: 2, done: 2 },
          { level: 3, needed: 4, done: 4 },
          { level: 4, needed: 4, done: 4 },
          { level: 5, needed: 2, done: 1 },
        ],
      },
      {
        memberId: "3005",
        name: "Isabel Rossi",
        path: "Leadership Development",
        levels: [
          { level: 1, needed: 2, done: 2 },
          { level: 2, needed: 2, done: 1 },
          { level: 3, needed: 4, done: 0 },
          { level: 4, needed: 4, done: 0 },
          { level: 5, needed: 2, done: 0 },
        ],
      },
      {
        // Different path than Basecamp's "Innovative Planning" for the same
        // person -> orphaned on both sides until manually bound.
        memberId: "3006",
        name: "Ben Carter",
        path: "Strategic Relationships",
        levels: [
          { level: 1, needed: 2, done: 2 },
          { level: 2, needed: 3, done: 0 },
          { level: 3, needed: 4, done: 0 },
          { level: 4, needed: 4, done: 0 },
          { level: 5, needed: 2, done: 0 },
        ],
      },
      {
        // No active path recorded -> hasNoActivePath()/easyspeakNoActivePath.
        memberId: "3007",
        name: "Carla Mendes",
        path: "",
        levels: [],
      },
      {
        // Spelled differently from Basecamp's "Diane Ostrowski" on purpose —
        // close enough to be suggested as a fuzzy match, not auto-linked.
        memberId: "3008",
        name: "Diane Ostrowsky",
        path: "Effective Coaching",
        levels: [
          { level: 1, needed: 2, done: 2 },
          { level: 2, needed: 3, done: 1 },
          { level: 3, needed: 4, done: 0 },
          { level: 4, needed: 4, done: 0 },
          { level: 5, needed: 2, done: 0 },
        ],
      },
      {
        // Different enough from Basecamp's "Nathaniel Brooks" that no
        // candidate is generated at all — needs a manual search-and-link.
        memberId: "3009",
        name: "Nate B",
        path: "Team Collaboration",
        levels: [
          { level: 1, needed: 2, done: 2 },
          { level: 2, needed: 2, done: 0 },
          { level: 3, needed: 4, done: 0 },
          { level: 4, needed: 4, done: 0 },
          { level: 5, needed: 2, done: 0 },
        ],
      },
      {
        // No Basecamp counterpart at all — demos an "easyspeak-only" member
        // row.
        memberId: "3010",
        name: "Sofia Alvarez",
        path: "Engaging Humor",
        levels: [
          { level: 1, needed: 2, done: 1 },
          { level: 2, needed: 3, done: 0 },
          { level: 3, needed: 4, done: 0 },
          { level: 4, needed: 4, done: 0 },
          { level: 5, needed: 2, done: 0 },
        ],
      },
      {
        // 3 of 4 Level 2 speeches already done vs. Basecamp's 1 —
        // unreported speeches, but real work still remains (realMissing > 0).
        memberId: "3011",
        name: "Owen Fitzgerald",
        path: "Dynamic Leadership",
        levels: [
          { level: 1, needed: 2, done: 2 },
          { level: 2, needed: 4, done: 3 },
          { level: 3, needed: 4, done: 0 },
          { level: 4, needed: 4, done: 0 },
          { level: 5, needed: 2, done: 0 },
        ],
      },
      {
        // All 4 Level 2 speeches already done vs. Basecamp's 2 — fully
        // covers what Basecamp says is still missing, so realMissing hits 0
        // even though Basecamp's own "to next level" count is still > 0.
        memberId: "3012",
        name: "Priya Chandrasekaran",
        path: "Presentation Mastery",
        levels: [
          { level: 1, needed: 2, done: 2 },
          { level: 2, needed: 4, done: 4 },
          { level: 3, needed: 4, done: 0 },
          { level: 4, needed: 4, done: 0 },
          { level: 5, needed: 2, done: 0 },
        ],
      },
    ],
  },
};
