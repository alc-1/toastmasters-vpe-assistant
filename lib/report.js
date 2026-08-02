// lib/report.js
//
// Pure logic that cross-references already-scraped Basecamp and EasySpeak
// data (see lib/basecamp-api.js and lib/easyspeak-api.js for how that data
// is produced) to build a per-member comparison report. No chrome.*
// dependency at all — same reasoning as lib/easyspeak-parser.js: this keeps
// it usable outside the browser (e.g. `require`d from a throwaway Node
// script against example/data/*.json) and keeps report/report.js, the only
// caller, as thin DOM/storage glue around it.
//
// Basecamp and EasySpeak agree on nothing structurally: club ids live in
// different id spaces (GUID vs numeric) with no shared key, members have no
// shared id at all, and both club/member/path names are spelled differently
// across the two systems (including French/German localization on
// EasySpeak). So every level of this pipeline (club -> member -> path) is a
// best-effort name-similarity match, not a join.

const NAME_MATCH_THRESHOLD = 0.72;

// Canonical English Pathways path name -> known alternate spellings (FR/DE)
// that should normalize to it. Entries marked "confirmed" were seen
// verbatim in real scraped data; the rest are unverified best-effort
// translations of the official Pathways titles and have NOT been
// independently checked — review/correct before trusting a cross-language
// match you haven't manually spot-checked.
const PATH_ALIASES = {
  "dynamic leadership": ["leadership dynamique", "dynamische fuhrung"], // both confirmed
  "effective coaching": ["coaching efficace", "effektives coaching"],
  "engaging humor": ["humour engageant", "mitreissender humor"],
  "innovative planning": ["planification innovante", "innovative planung"],
  "leadership development": ["developpement du leadership", "fuhrungsentwicklung"],
  "motivational strategies": ["strategies de motivation", "motivationsstrategien"], // FR confirmed
  "persuasive influence": ["influence persuasive", "uberzeugende einflussnahme"],
  "presentation mastery": ["maitrisez vos presentations", "beherrschen von prasentationen"], // both confirmed
  "strategic relationships": ["relations strategiques", "strategische beziehungen"],
  "team collaboration": ["collaboration en equipe", "teamzusammenarbeit"],
  "visionary communication": ["communication visionnaire", "visionare kommunikation"],
};

const NON_PATHWAY_NAMES = new Set([
  "speechcraft",
  "distinguished toastmaster",
  "pathways mentor program",
]);

const PATH_ALIAS_LOOKUP = buildPathAliasLookup(PATH_ALIASES);

/**
 * @param {Record<string, {name: string, members: object[]}>} basecampData
 * @param {Record<string, {name: string, members: object[]}>} easyspeakData
 * @param {{basecampScrapedAt?: number|null, easyspeakScrapedAt?: number|null}} [meta]
 * @param {{clubLookup?: object[], memberLinks?: object[], rejectedPairs?: object[], memberPathOverrides?: object[], memberPathExclusions?: object[], pathAliasLookup?: Map<string,string>, allowFuzzyMemberMatches?: boolean}} [resolution]
 *   persisted name-resolution decisions, see lib/resolution-store.js. Omitting
 *   this entirely reproduces pure name-similarity matching, unchanged.
 * @returns {object} ReportResult, see CLAUDE.md for the documented shape.
 */
function buildReport(basecampData, easyspeakData, meta = {}, resolution = {}) {
  const basecampClubs = Object.entries(basecampData).map(([id, club]) => ({
    id,
    name: club.name,
    people: groupBasecampMembers(club.members),
  }));
  const easyspeakClubs = Object.entries(easyspeakData).map(([id, club]) => ({
    id,
    name: club.name,
    people: groupEasySpeakMembers(club.members),
  }));

  const clubPairs = matchClubs(basecampClubs, easyspeakClubs, resolution.clubLookup ?? []).map((pair) =>
    buildClubPairReport(pair.basecamp, pair.easyspeak, resolution, pair)
  );

  return {
    meta: {
      basecampScrapedAt: meta.basecampScrapedAt ?? null,
      easyspeakScrapedAt: meta.easyspeakScrapedAt ?? null,
    },
    clubPairs,
  };
}

// ---------------------------------------------------------------------------
// Per-club member grouping (one row per member x path -> one entry per person)
// ---------------------------------------------------------------------------

function groupBasecampMembers(members) {
  const byUserId = new Map();
  for (const member of members) {
    const userId = member.user.id;
    if (!byUserId.has(userId)) {
      byUserId.set(userId, { userId, name: member.user.name, paths: [] });
    }
    byUserId.get(userId).paths.push({
      path_name: member.path_name,
      progression: member.progression,
    });
  }
  return Array.from(byUserId.values());
}

function groupEasySpeakMembers(members) {
  const byMemberId = new Map();
  for (const member of members) {
    if (!byMemberId.has(member.memberId)) {
      byMemberId.set(member.memberId, { memberId: member.memberId, name: null, paths: [] });
    }
    const person = byMemberId.get(member.memberId);
    // EasySpeak repeats "''" as a placeholder name on every row after a
    // multi-path member's first — only trust a row's name when it's real.
    if (!person.name && member.name && member.name !== "''") {
      person.name = member.name;
    }
    person.paths.push({ path: member.path, levels: member.levels });
  }
  for (const person of byMemberId.values()) {
    if (!person.name) person.name = `EasySpeak member ${person.memberId}`;
  }
  return Array.from(byMemberId.values());
}

// ---------------------------------------------------------------------------
// Generic greedy 1:1 assignment, shared by club and member matching
// ---------------------------------------------------------------------------

/**
 * @param {{aKey: any, bKey: any, score: number}[]} candidates sorted desc by score
 * @param {{aKey: any, bKey: any, score: number}[]} [preAssigned] persisted
 *   decisions (confirmed links, club pins) claimed before any candidate is
 *   considered, so a fresh high-scoring candidate can never displace them.
 * @returns {{aKey: any, bKey: any, score: number}[]}
 */
function greedyAssign(candidates, preAssigned = []) {
  const usedA = new Set();
  const usedB = new Set();
  const assigned = [];
  for (const candidate of [...preAssigned, ...candidates]) {
    if (usedA.has(candidate.aKey) || usedB.has(candidate.bKey)) continue;
    assigned.push(candidate);
    usedA.add(candidate.aKey);
    usedB.add(candidate.bKey);
  }
  return assigned;
}

// ---------------------------------------------------------------------------
// Club matching
// ---------------------------------------------------------------------------

function stripAccents(str) {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeClubName(name) {
  return stripAccents(name)
    .toLowerCase()
    .replace(/[,.\-–]/g, " ")
    .replace(/\btoastmasters\b/g, " ")
    .replace(/\bclub\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(str) {
  return new Set(str.split(" ").filter(Boolean));
}

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  const intersectionSize = [...setA].filter((token) => setB.has(token)).length;
  const unionSize = new Set([...setA, ...setB]).size;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

function clubNameScore(nameA, nameB) {
  return jaccard(tokenSet(normalizeClubName(nameA)), tokenSet(normalizeClubName(nameB)));
}

/**
 * @param {{id: string, name: string, people: object[]}[]} basecampClubs
 * @param {{id: string, name: string, people: object[]}[]} easyspeakClubs
 * @param {{basecampClubId: string, easyspeakClubId: string}[]} [clubLookup]
 *   persisted club ID pins — forced 1:1, regardless of name. Absent an entry
 *   here, two clubs only auto-match on an exact normalized-name match (no
 *   fuzzy/partial-similarity auto-matching — there's no "suggested club"
 *   review UI anywhere to resolve a wrong guess, unlike members).
 * @returns {{basecamp: object|null, easyspeak: object|null, score: number|null, forced: boolean}[]}
 */
function matchClubs(basecampClubs, easyspeakClubs, clubLookup = []) {
  const bcById = new Map(basecampClubs.map((c) => [c.id, c]));
  const esById = new Map(easyspeakClubs.map((c) => [c.id, c]));

  const preAssigned = [];
  for (const pin of clubLookup) {
    if (bcById.has(pin.basecampClubId) && esById.has(pin.easyspeakClubId)) {
      preAssigned.push({ aKey: pin.basecampClubId, bKey: pin.easyspeakClubId, score: null, forced: true });
    }
  }

  const candidates = [];
  for (const bc of basecampClubs) {
    for (const es of easyspeakClubs) {
      const score = clubNameScore(bc.name, es.name);
      // Exact normalized-name match only (score === 1, i.e. identical token
      // sets) — no fuzzy/partial-similarity auto-matching for clubs.
      if (score === 1) {
        candidates.push({ aKey: bc.id, bKey: es.id, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const assigned = greedyAssign(candidates, preAssigned);

  const matchedBcIds = new Set(assigned.map((a) => a.aKey));
  const matchedEsIds = new Set(assigned.map((a) => a.bKey));

  const pairs = assigned.map((a) => ({
    basecamp: bcById.get(a.aKey),
    easyspeak: esById.get(a.bKey),
    score: a.score,
    forced: !!a.forced,
  }));
  for (const bc of basecampClubs) {
    if (!matchedBcIds.has(bc.id)) pairs.push({ basecamp: bc, easyspeak: null, score: null, forced: false });
  }
  for (const es of easyspeakClubs) {
    if (!matchedEsIds.has(es.id)) pairs.push({ basecamp: null, easyspeak: es, score: null, forced: false });
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Member matching (within a matched club pair)
// ---------------------------------------------------------------------------

function normalizeName(rawName) {
  // Drop everything after a comma first — that's where EasySpeak sticks
  // honorific/designation tails ("Godela U. Bittcher, CC CL DL5").
  let name = rawName.split(",")[0].trim();

  // Then strip trailing level-progress codes like "PM1", "DL3" (can repeat,
  // e.g. "Nigel Thew PM5 PI5" once the comma-tail case doesn't already
  // handle it).
  let tokens = name.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && /^[A-Z]{1,3}\d$/.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  name = tokens.join(" ");

  name = stripAccents(name)
    .toLowerCase()
    .replace(/['’.\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Sort tokens so word order doesn't matter ("Robert O'Riordan" ==
  // "O'Riordan Robert").
  return name.split(" ").filter(Boolean).sort().join(" ");
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * @returns {{score: number, confidence: "exact"|"fuzzy"|null}}
 */
function nameScore(rawA, rawB) {
  const a = normalizeName(rawA);
  const b = normalizeName(rawB);
  if (a === b) return { score: 1, confidence: "exact" };

  const jaccardScore = jaccard(tokenSet(a), tokenSet(b));
  const maxLen = Math.max(a.length, b.length) || 1;
  const editSimilarity = 1 - levenshtein(a, b) / maxLen;
  // Weighted toward edit similarity: a single-character typo in one token
  // (e.g. "Schoetzer"/"Schötzer", "Achi"/"Achy") zeroes out that token's
  // Jaccard overlap entirely even though the strings are nearly identical,
  // so a 50/50 blend punishes minor misspellings far more than intended.
  const score = 0.3 * jaccardScore + 0.7 * editSimilarity;
  return { score, confidence: score >= NAME_MATCH_THRESHOLD ? "fuzzy" : null };
}

/**
 * @param {object[]} basecampPeople
 * @param {object[]} easyspeakPeople
 * @param {{basecampUserId: number, easyspeakMemberId: string}[]} [memberLinks]
 *   persisted confirmed links — forced 1:1, never re-scored.
 * @param {{basecampUserId: number, easyspeakMemberId: string}[]} [rejectedPairs]
 *   persisted "known non-match" pairs — excluded from candidate generation
 *   entirely, so they can never resurface as a suggestion.
 * @param {boolean} [allowFuzzy] when false, fuzzy-confidence candidates are
 *   dropped from the pool entirely (falling through to the normal leftover
 *   handling below, i.e. reported as unmatched) — used by report/report.js
 *   so an unconfirmed guess never renders there as if it were a fact.
 *   Exact matches and confirmed links are unaffected either way.
 * @returns {{basecamp: object|null, easyspeak: object|null, confidence: "confirmed"|"exact"|"fuzzy"|null, score: number|null, source: "fuzzy-confirmed"|"manual-search"|null}[]}
 */
function matchMembers(basecampPeople, easyspeakPeople, memberLinks = [], rejectedPairs = [], allowFuzzy = true) {
  const bcById = new Map(basecampPeople.map((p) => [p.userId, p]));
  const esById = new Map(easyspeakPeople.map((p) => [p.memberId, p]));

  const preAssigned = [];
  for (const link of memberLinks) {
    if (bcById.has(link.basecampUserId) && esById.has(link.easyspeakMemberId)) {
      preAssigned.push({
        aKey: link.basecampUserId,
        bKey: link.easyspeakMemberId,
        score: null,
        confidence: "confirmed",
        source: link.source,
      });
    }
  }

  const rejectedSet = new Set(rejectedPairs.map((r) => `${r.basecampUserId}::${r.easyspeakMemberId}`));

  const candidates = [];
  for (const bc of basecampPeople) {
    for (const es of easyspeakPeople) {
      if (rejectedSet.has(`${bc.userId}::${es.memberId}`)) continue;
      const { score, confidence } = nameScore(bc.name, es.name);
      if (confidence === "exact" || (confidence === "fuzzy" && allowFuzzy)) {
        candidates.push({ aKey: bc.userId, bKey: es.memberId, score, confidence });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const assigned = greedyAssign(candidates, preAssigned);

  const matchedBcIds = new Set(assigned.map((a) => a.aKey));
  const matchedEsIds = new Set(assigned.map((a) => a.bKey));

  const pairs = assigned.map((a) => ({
    basecamp: bcById.get(a.aKey),
    easyspeak: esById.get(a.bKey),
    confidence: a.confidence,
    score: a.score,
    source: a.source ?? null,
  }));
  for (const bc of basecampPeople) {
    if (!matchedBcIds.has(bc.userId)) {
      pairs.push({ basecamp: bc, easyspeak: null, confidence: null, score: null, source: null });
    }
  }
  for (const es of easyspeakPeople) {
    if (!matchedEsIds.has(es.memberId)) {
      pairs.push({ basecamp: null, easyspeak: es, confidence: null, score: null, source: null });
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Path matching (within a matched member)
// ---------------------------------------------------------------------------

function buildPathAliasLookup(aliasTable) {
  const lookup = new Map();
  for (const [canonical, aliases] of Object.entries(aliasTable)) {
    lookup.set(canonical, canonical);
    for (const alias of aliases) lookup.set(alias, canonical);
  }
  return lookup;
}

/**
 * @param {string} rawPath
 * @param {Map<string,string>} [pathAliasLookup] defaults to the hardcoded
 *   PATH_ALIASES table; callers pass the user-editable pathLookup (converted
 *   via buildPathAliasLookup) to override/extend it without touching source.
 * @returns {{key: string, nonPathway: boolean}}
 */
function canonicalizePathName(rawPath, pathAliasLookup = PATH_ALIAS_LOOKUP) {
  const name = stripAccents(
    rawPath
      .replace(/\s*\(\d{4}(-\d{2})?\)\s*$/, "") // EasySpeak version suffix: (2021-10), (2017)
      .replace(/\s*\(optional\)\s*$/i, "") // EasySpeak "(optional)" suffix, e.g. Pathways Mentor Program
      .replace(/\s*\((French|German)\)\s*$/i, "") // Basecamp language-tag suffix
  )
    .toLowerCase()
    .trim();

  if (NON_PATHWAY_NAMES.has(name)) return { key: name, nonPathway: true };

  const canonical = pathAliasLookup.get(name);
  return { key: canonical ?? name, nonPathway: false };
}

const PATHWAYS_LEVEL_COUNT = 5;

function hasNoActivePath(easyspeakPaths) {
  return (
    easyspeakPaths.length === 0 ||
    easyspeakPaths.every((p) => p.levels.every((level) => level.needed === 0))
  );
}

/**
 * @param {object|null} basecampPerson
 * @param {object|null} easyspeakPerson
 * @param {{basecampPathName: string, easyspeakPathLabel: string}[]} [memberOverrides]
 *   member-scoped path binds, already pre-filtered by the caller to this
 *   member pair — checked before the global path-name lookup, and never
 *   written back to it.
 * @param {Map<string,string>} [pathAliasLookup] see canonicalizePathName.
 * @param {{basecampPathName: string, easyspeakPathLabel: string}[]} [memberExclusions]
 *   member-scoped path exclusions, already pre-filtered by the caller to
 *   this member pair — the inverse of an override: forces a pair that
 *   would otherwise auto-match via canonicalization back into two
 *   independently-orphaned entries, so a wrongly-automatic pairing can be
 *   broken and re-resolved manually without touching the global path-name
 *   lookup other members rely on.
 * @returns {object[]} PathReport[]
 */
function matchPaths(basecampPerson, easyspeakPerson, memberOverrides = [], pathAliasLookup = PATH_ALIAS_LOOKUP, memberExclusions = []) {
  const bcPaths = [...(basecampPerson?.paths ?? [])];
  const esPaths = [...(easyspeakPerson?.paths ?? [])];
  const paths = [];

  // Overrides are spliced out of both raw lists first so the pair they bind
  // is force-matched and never also runs through normal canonicalization
  // below (which would otherwise treat them as two separate orphaned paths).
  memberOverrides.forEach((override, index) => {
    const bcIndex = bcPaths.findIndex((p) => p.path_name === override.basecampPathName);
    const esIndex = esPaths.findIndex((p) => p.path === override.easyspeakPathLabel);
    if (bcIndex === -1 || esIndex === -1) return;

    const [bc] = bcPaths.splice(bcIndex, 1);
    const [es] = esPaths.splice(esIndex, 1);

    paths.push({
      canonicalKey: `override:${index}`,
      displayName: bc.path_name,
      basecampPathName: bc.path_name,
      easyspeakPathLabel: es.path,
      presence: "both",
      nonPathway: false,
      overridden: true,
      levels: diffLevels(es, bc),
      pathCompletion: buildPathCompletion(bc),
    });
  });

  const bcByKey = new Map();
  for (const p of bcPaths) {
    const { key } = canonicalizePathName(p.path_name, pathAliasLookup);
    bcByKey.set(key, p);
  }

  const esByKey = new Map();
  const noActivePath = easyspeakPerson ? hasNoActivePath(easyspeakPerson.paths) : false;
  if (easyspeakPerson && !noActivePath) {
    for (const p of esPaths) {
      const { key, nonPathway } = canonicalizePathName(p.path, pathAliasLookup);
      esByKey.set(key, { ...p, nonPathway });
    }
  }

  const keys = new Set([...bcByKey.keys(), ...esByKey.keys()]);
  for (const key of keys) {
    const bc = bcByKey.get(key) ?? null;
    const es = esByKey.get(key) ?? null;
    const nonPathway = es?.nonPathway ?? false;

    const excluded =
      bc &&
      es &&
      memberExclusions.some((ex) => ex.basecampPathName === bc.path_name && ex.easyspeakPathLabel === es.path);

    if (excluded) {
      // Force-split back into two independently-orphaned entries instead of
      // the single merged "both" entry canonicalization would otherwise
      // produce — see excludePathMatch() in lib/resolution-store.js.
      paths.push({
        canonicalKey: `${key}:basecamp`,
        displayName: bc.path_name,
        basecampPathName: bc.path_name,
        easyspeakPathLabel: null,
        presence: "basecamp-only",
        nonPathway: false,
        overridden: false,
        levels: diffLevels(null, bc),
        pathCompletion: buildPathCompletion(bc),
      });
      paths.push({
        canonicalKey: `${key}:easyspeak`,
        displayName: es.path,
        basecampPathName: null,
        easyspeakPathLabel: es.path,
        presence: "easyspeak-only",
        nonPathway,
        overridden: false,
        levels: nonPathway ? [] : diffLevels(es, null),
        pathCompletion: null,
      });
      continue;
    }

    const presence = bc && es ? "both" : bc ? "basecamp-only" : "easyspeak-only";

    paths.push({
      canonicalKey: key,
      displayName: bc?.path_name ?? es?.path ?? key,
      basecampPathName: bc?.path_name ?? null,
      easyspeakPathLabel: es?.path ?? null,
      presence,
      nonPathway,
      overridden: false,
      levels: nonPathway ? [] : diffLevels(es, bc),
      pathCompletion: buildPathCompletion(bc),
    });
  }

  return { paths, easyspeakNoActivePath: noActivePath };
}

/**
 * Definition backing the Members view's "Path issues" filter: a member with
 * at least one Pathways path orphaned on each side (both sides picked a
 * path the other doesn't have) even though the member link itself is fine —
 * exactly the case a member-scoped path-bind override exists to fix.
 * @param {{paths: object[]}} member
 * @returns {boolean}
 */
function hasOrphanedPaths(member) {
  const paths = member.paths ?? [];
  const hasBasecampOrphan = paths.some((p) => p.presence === "basecamp-only" && !p.nonPathway);
  const hasEasyspeakOrphan = paths.some((p) => p.presence === "easyspeak-only" && !p.nonPathway);
  return hasBasecampOrphan && hasEasyspeakOrphan;
}

/**
 * A member-scoped path-bind override took effect for this member (see the
 * `overridden` tag `matchPaths()` sets on a spliced-out forced pair). Once
 * bound, the path itself no longer shows up under hasOrphanedPaths() (it's
 * "both"-presence now), so this is the only remaining signal that a manual
 * correction happened here — used to still surface it as a manual link
 * even when the member identity itself matched automatically (e.g. an
 * exact name match whose paths needed a manual bind).
 * @param {{paths: object[]}} member
 * @returns {boolean}
 */
function hasPathOverride(member) {
  return (member.paths ?? []).some((p) => p.overridden);
}

function buildPathCompletion(bc) {
  const completion = bc?.progression?.["Path Completion"];
  if (!completion) return null;
  return {
    completed: completion.completed,
    total: completion.total,
    missing: Math.max(0, completion.total - completion.completed),
  };
}

// ---------------------------------------------------------------------------
// Level diff
// ---------------------------------------------------------------------------

/**
 * @param {{levels: {level:number, needed:number, done:number}[]}|null} esPath
 * @param {{progression: object}|null} bcPath
 * @returns {object[]} LevelDiff[]
 */
function diffLevels(esPath, bcPath) {
  const esByLevel = new Map((esPath?.levels ?? []).map((l) => [l.level, l]));
  const levels = [];
  for (let level = 1; level <= PATHWAYS_LEVEL_COUNT; level++) {
    const es = esByLevel.get(level) ?? null;
    const bcLevel = bcPath?.progression?.[`Level ${level}`] ?? null;
    levels.push(diffLevel(level, es, bcLevel));
  }
  return levels;
}

function diffLevel(level, esLevel, bcLevel) {
  const easyspeak = esLevel ? { needed: esLevel.needed, done: esLevel.done } : null;
  const basecamp = bcLevel
    ? { completed: bcLevel.completed, total: bcLevel.total, approved: !!bcLevel.approved }
    : null;

  const easyspeakMissing = easyspeak ? Math.max(0, easyspeak.needed - easyspeak.done) : null;
  const basecampMissing = basecamp ? Math.max(0, basecamp.total - basecamp.completed) : null;
  const discrepancy = easyspeak && basecamp ? easyspeak.done - basecamp.completed : null;

  const easyspeakDone = easyspeak ? easyspeak.done >= easyspeak.needed : false;
  const basecampDone = basecamp ? basecamp.completed >= basecamp.total : false;
  const pendingValidation = !!(basecamp && !basecamp.approved && (basecampDone || easyspeakDone));

  return { level, easyspeak, basecamp, easyspeakMissing, basecampMissing, discrepancy, pendingValidation };
}

// ---------------------------------------------------------------------------
// Club pair assembly
// ---------------------------------------------------------------------------

/**
 * @param {object|null} basecampClub
 * @param {object|null} easyspeakClub
 * @param {{memberLinks?: object[], rejectedPairs?: object[], memberPathOverrides?: object[], memberPathExclusions?: object[], pathAliasLookup?: Map<string,string>, allowFuzzyMemberMatches?: boolean}} [resolution]
 *   `allowFuzzyMemberMatches` defaults to true (Members view); report/report.js
 *   passes false so an unconfirmed guess never renders there as a fact.
 * @param {{score?: number|null, forced?: boolean}} [clubMatch] this pair's
 *   entry from matchClubs(), so the club's own match score/forced flag
 *   doesn't need to be recomputed here.
 */
function buildClubPairReport(basecampClub, easyspeakClub, resolution = {}, clubMatch = {}) {
  const memberLinks = resolution.memberLinks ?? [];
  const rejectedPairs = resolution.rejectedPairs ?? [];
  const memberPathOverrides = resolution.memberPathOverrides ?? [];
  const memberPathExclusions = resolution.memberPathExclusions ?? [];
  const pathAliasLookup = resolution.pathAliasLookup ?? PATH_ALIAS_LOOKUP;
  const allowFuzzy = resolution.allowFuzzyMemberMatches ?? true;

  const memberMatches = matchMembers(basecampClub?.people ?? [], easyspeakClub?.people ?? [], memberLinks, rejectedPairs, allowFuzzy);

  const members = memberMatches.map(({ basecamp, easyspeak, confidence, score, source }) => {
    const presence = basecamp && easyspeak ? "both" : basecamp ? "basecamp-only" : "easyspeak-only";
    const overridesForMember = memberPathOverrides.filter(
      (o) => o.basecampUserId === basecamp?.userId && o.easyspeakMemberId === easyspeak?.memberId
    );
    const exclusionsForMember = memberPathExclusions.filter(
      (e) => e.basecampUserId === basecamp?.userId && e.easyspeakMemberId === easyspeak?.memberId
    );
    const { paths, easyspeakNoActivePath } = matchPaths(basecamp, easyspeak, overridesForMember, pathAliasLookup, exclusionsForMember);
    const member = {
      basecampUserId: basecamp?.userId ?? null,
      easyspeakMemberId: easyspeak?.memberId ?? null,
      name: basecamp?.name ?? easyspeak?.name,
      basecampName: basecamp?.name ?? null,
      easyspeakName: easyspeak?.name ?? null,
      presence,
      matchConfidence: confidence,
      matchScore: score,
      // Only meaningful when matchConfidence === "confirmed" — which
      // memberLinks source produced this link, so the UI can tell "the
      // user manually searched and linked this" apart from "the user just
      // approved an algorithmic suggestion."
      matchSource: source ?? null,
      easyspeakNoActivePath,
      paths,
    };
    member.hasOrphanedPaths = hasOrphanedPaths(member);
    return member;
  });

  return {
    basecampClubId: basecampClub?.id ?? null,
    basecampClubName: basecampClub?.name ?? null,
    easyspeakClubId: easyspeakClub?.id ?? null,
    easyspeakClubName: easyspeakClub?.name ?? null,
    matchScore: clubMatch.score ?? null,
    clubMatchForced: !!clubMatch.forced,
    members,
  };
}

// ---------------------------------------------------------------------------
// CSV export: flattens a ReportResult into one row per level (long format),
// so every fact is independently sortable/filterable in a spreadsheet —
// the HTML view's collapsible-cards-per-member shape can't do that.
// ---------------------------------------------------------------------------

const CSV_HEADERS = [
  "Basecamp Club",
  "EasySpeak Club",
  "Club Match %",
  "Member Name",
  "Basecamp User Id",
  "EasySpeak Member Id",
  "Member Presence",
  "Match Confidence",
  "Match Score",
  "Path",
  "Path Presence",
  "Non-Pathway",
  "Level",
  "EasySpeak Done",
  "EasySpeak Needed",
  "Basecamp Completed",
  "Basecamp Total",
  "Basecamp Approved",
  "Missing (EasySpeak)",
  "Missing (Basecamp)",
  "Discrepancy",
  "Pending Validation",
  "Notes",
];

// Placeholder for every column between "Match Score" and "Notes" (Path
// through Pending Validation) when a row has no path/level data at all.
const CSV_EMPTY_PATH_FIELDS = new Array(CSV_HEADERS.length - 9 - 1).fill("");

// Placeholder for every column between "Non-Pathway" and "Notes" (Level
// through Pending Validation) when a path row has no level data (nonPathway).
const CSV_EMPTY_LEVEL_FIELDS = new Array(CSV_HEADERS.length - 12 - 1).fill("");

/**
 * @param {object} report ReportResult (see buildReport)
 * @returns {(string|number)[][]} header row followed by one data row per level
 */
function reportToRows(report) {
  const rows = [CSV_HEADERS];

  for (const club of report.clubPairs) {
    for (const member of club.members) {
      const memberBase = [
        club.basecampClubName ?? "",
        club.easyspeakClubName ?? "",
        club.matchScore != null ? Math.round(club.matchScore * 100) : "",
        member.name,
        member.basecampUserId ?? "",
        member.easyspeakMemberId ?? "",
        member.presence,
        member.matchConfidence ?? "",
        member.matchScore != null ? Number(member.matchScore.toFixed(2)) : "",
      ];

      if (member.paths.length === 0) {
        rows.push([
          ...memberBase,
          ...CSV_EMPTY_PATH_FIELDS,
          member.easyspeakNoActivePath ? "No active EasySpeak path" : "No paths found",
        ]);
        continue;
      }

      for (const path of member.paths) {
        const pathBase = [...memberBase, path.displayName, path.presence, path.nonPathway ? "Yes" : "No"];

        if (path.nonPathway) {
          rows.push([...pathBase, ...CSV_EMPTY_LEVEL_FIELDS, "Non-Pathways activity, not compared"]);
          continue;
        }

        for (const level of path.levels) {
          rows.push([
            ...pathBase,
            level.level,
            level.easyspeak?.done ?? "",
            level.easyspeak?.needed ?? "",
            level.basecamp?.completed ?? "",
            level.basecamp?.total ?? "",
            level.basecamp ? (level.basecamp.approved ? "Yes" : "No") : "",
            level.easyspeakMissing ?? "",
            level.basecampMissing ?? "",
            level.discrepancy ?? "",
            level.pendingValidation ? "Yes" : "No",
            "",
          ]);
        }

        if (path.pathCompletion) {
          rows.push([
            ...pathBase,
            "Path Completion",
            "",
            "",
            path.pathCompletion.completed,
            path.pathCompletion.total,
            "",
            "",
            path.pathCompletion.missing,
            "",
            "",
            "Basecamp-only, no EasySpeak equivalent",
          ]);
        }
      }

      if (member.easyspeakNoActivePath) {
        rows.push([...memberBase, ...CSV_EMPTY_PATH_FIELDS, "No active EasySpeak path"]);
      }
    }
  }

  return rows;
}

/**
 * @param {(string|number)[][]} rows header row followed by data rows
 * @returns {string} RFC-4180-ish CSV text (CRLF line endings)
 */
function toCsv(rows) {
  const escapeField = (value) => {
    const str = value == null ? "" : String(value);
    return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  return rows.map((row) => row.map(escapeField).join(",")).join("\r\n");
}

// ---------------------------------------------------------------------------
// "Next level" summary: one row per member+path (skipping non-Pathways
// paths, which have no Basecamp level structure), with the 4 metrics a VPE
// actually wants to sort/scan by, instead of having to read a full
// level-by-level table per path to work them out by hand.
// ---------------------------------------------------------------------------

/**
 * @param {object} path PathReport (see buildReport)
 * @returns {{
 *   currentLevel: number|null, currentLevelLabel: string, nextLevelLabel: string,
 *   theoreticalMissing: number|null, unreportedInBasecamp: number|null, realMissing: number|null,
 * }}
 */
function computeLevelSummary(path) {
  if (path.presence === "easyspeak-only") {
    return {
      currentLevel: null,
      currentLevelSortValue: null,
      currentLevelLabel: "Not in Basecamp",
      nextLevelLabel: "—",
      theoreticalMissing: null,
      unreportedInBasecamp: null,
      realMissing: null,
    };
  }

  let currentLevel = 0;
  for (const level of path.levels) {
    if (level.basecamp?.approved) currentLevel = level.level;
  }

  const completed = currentLevel === 5 && path.pathCompletion && path.pathCompletion.completed >= path.pathCompletion.total;
  if (completed) {
    return {
      currentLevel,
      // One rank above a merely-approved Level 5, so "Completed" sorts as
      // more advanced than "Level 5 (Path Completion still pending)" even
      // though both share currentLevel === 5.
      currentLevelSortValue: 6,
      currentLevelLabel: "Completed",
      nextLevelLabel: "—",
      theoreticalMissing: null,
      unreportedInBasecamp: null,
      realMissing: null,
    };
  }

  const currentLevelLabel = currentLevel === 0 ? "Not started" : `Level ${currentLevel}`;

  if (currentLevel === 5) {
    // Level 5 approved but Path Completion itself isn't done yet — Path
    // Completion has no EasySpeak equivalent to compare against at all.
    const theoreticalMissing = path.pathCompletion?.missing ?? 0;
    return {
      currentLevel,
      currentLevelSortValue: currentLevel,
      currentLevelLabel,
      nextLevelLabel: "Path Completion",
      theoreticalMissing,
      unreportedInBasecamp: 0,
      realMissing: theoreticalMissing,
    };
  }

  const nextLevel = path.levels[currentLevel]; // currentLevel is 0-4 here, levels[] is 0-indexed by level-1
  const theoreticalMissing = nextLevel.basecampMissing ?? 0;
  const unreportedInBasecamp = nextLevel.easyspeak ? Math.max(0, nextLevel.discrepancy) : 0;
  const realMissing = Math.max(0, theoreticalMissing - unreportedInBasecamp);

  return {
    currentLevel,
    currentLevelSortValue: currentLevel,
    currentLevelLabel,
    nextLevelLabel: `Level ${currentLevel + 1}`,
    theoreticalMissing,
    unreportedInBasecamp,
    realMissing,
  };
}

/**
 * @param {object} report ReportResult (see buildReport)
 * @returns {{clubKey: string, clubName: string, rows: object[]}[]} one group
 *   per club (same order as report.clubPairs), each with one row per
 *   member+path (excluding non-Pathways paths) — grouped rather than a flat
 *   list so the UI can show one club at a time behind tabs instead of
 *   mixing every club's members into a single list.
 */
function buildLevelSummary(report) {
  return report.clubPairs.map((club, index) => {
    const rows = [];
    for (const member of club.members) {
      for (const path of member.paths) {
        if (path.nonPathway) continue;
        rows.push({
          memberName: member.name,
          memberPresence: member.presence,
          matchConfidence: member.matchConfidence,
          pathName: path.displayName,
          pathPresence: path.presence,
          ...computeLevelSummary(path),
        });
      }
    }
    return {
      clubKey: `club-${index}`,
      clubName: club.basecampClubName ?? club.easyspeakClubName,
      rows,
    };
  });
}

// Exposed as globals: loaded via a plain <script> tag in report/report.html
// (no bundler, no ES modules — see CLAUDE.md conventions), and via
// module.exports for standalone Node/jsdom-style verification against
// example/data/*.json outside the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildReport,
    normalizeClubName,
    clubNameScore,
    matchClubs,
    normalizeName,
    levenshtein,
    nameScore,
    matchMembers,
    canonicalizePathName,
    matchPaths,
    hasOrphanedPaths,
    hasPathOverride,
    buildPathAliasLookup,
    PATH_ALIASES,
    diffLevel,
    reportToRows,
    toCsv,
    computeLevelSummary,
    buildLevelSummary,
  };
}
