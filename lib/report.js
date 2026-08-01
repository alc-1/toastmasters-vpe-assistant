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

const CLUB_MATCH_THRESHOLD = 0.5;
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
 * @returns {object} ReportResult, see plan/CLAUDE.md for the documented shape.
 */
function buildReport(basecampData, easyspeakData, meta = {}) {
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

  const clubPairs = matchClubs(basecampClubs, easyspeakClubs).map((pair) =>
    buildClubPairReport(pair.basecamp, pair.easyspeak)
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
 * @returns {{aKey: any, bKey: any, score: number}[]}
 */
function greedyAssign(candidates) {
  const usedA = new Set();
  const usedB = new Set();
  const assigned = [];
  for (const candidate of candidates) {
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
 * @returns {{basecamp: object|null, easyspeak: object|null, score: number|null}[]}
 */
function matchClubs(basecampClubs, easyspeakClubs) {
  const candidates = [];
  for (const bc of basecampClubs) {
    for (const es of easyspeakClubs) {
      const score = clubNameScore(bc.name, es.name);
      if (score >= CLUB_MATCH_THRESHOLD) {
        candidates.push({ aKey: bc.id, bKey: es.id, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const assigned = greedyAssign(candidates);

  const matchedBcIds = new Set(assigned.map((a) => a.aKey));
  const matchedEsIds = new Set(assigned.map((a) => a.bKey));
  const bcById = new Map(basecampClubs.map((c) => [c.id, c]));
  const esById = new Map(easyspeakClubs.map((c) => [c.id, c]));

  const pairs = assigned.map((a) => ({
    basecamp: bcById.get(a.aKey),
    easyspeak: esById.get(a.bKey),
    score: a.score,
  }));
  for (const bc of basecampClubs) {
    if (!matchedBcIds.has(bc.id)) pairs.push({ basecamp: bc, easyspeak: null, score: null });
  }
  for (const es of easyspeakClubs) {
    if (!matchedEsIds.has(es.id)) pairs.push({ basecamp: null, easyspeak: es, score: null });
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
 * @returns {{basecamp: object|null, easyspeak: object|null, confidence: "exact"|"fuzzy"|null, score: number|null}[]}
 */
function matchMembers(basecampPeople, easyspeakPeople) {
  const candidates = [];
  for (const bc of basecampPeople) {
    for (const es of easyspeakPeople) {
      const { score, confidence } = nameScore(bc.name, es.name);
      if (confidence) candidates.push({ aKey: bc.userId, bKey: es.memberId, score, confidence });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const assigned = greedyAssign(candidates);

  const matchedBcIds = new Set(assigned.map((a) => a.aKey));
  const matchedEsIds = new Set(assigned.map((a) => a.bKey));
  const bcById = new Map(basecampPeople.map((p) => [p.userId, p]));
  const esById = new Map(easyspeakPeople.map((p) => [p.memberId, p]));

  const pairs = assigned.map((a) => ({
    basecamp: bcById.get(a.aKey),
    easyspeak: esById.get(a.bKey),
    confidence: a.confidence,
    score: a.score,
  }));
  for (const bc of basecampPeople) {
    if (!matchedBcIds.has(bc.userId)) {
      pairs.push({ basecamp: bc, easyspeak: null, confidence: null, score: null });
    }
  }
  for (const es of easyspeakPeople) {
    if (!matchedEsIds.has(es.memberId)) {
      pairs.push({ basecamp: null, easyspeak: es, confidence: null, score: null });
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
 * @returns {{key: string, nonPathway: boolean}}
 */
function canonicalizePathName(rawPath) {
  const name = stripAccents(
    rawPath
      .replace(/\s*\(\d{4}(-\d{2})?\)\s*$/, "") // EasySpeak version suffix: (2021-10), (2017)
      .replace(/\s*\(optional\)\s*$/i, "") // EasySpeak "(optional)" suffix, e.g. Pathways Mentor Program
      .replace(/\s*\((French|German)\)\s*$/i, "") // Basecamp language-tag suffix
  )
    .toLowerCase()
    .trim();

  if (NON_PATHWAY_NAMES.has(name)) return { key: name, nonPathway: true };

  const canonical = PATH_ALIAS_LOOKUP.get(name);
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
 * @returns {object[]} PathReport[]
 */
function matchPaths(basecampPerson, easyspeakPerson) {
  const bcByKey = new Map();
  for (const p of basecampPerson?.paths ?? []) {
    const { key } = canonicalizePathName(p.path_name);
    bcByKey.set(key, p);
  }

  const esByKey = new Map();
  const noActivePath = easyspeakPerson ? hasNoActivePath(easyspeakPerson.paths) : false;
  if (easyspeakPerson && !noActivePath) {
    for (const p of easyspeakPerson.paths) {
      const { key, nonPathway } = canonicalizePathName(p.path);
      esByKey.set(key, { ...p, nonPathway });
    }
  }

  const keys = new Set([...bcByKey.keys(), ...esByKey.keys()]);
  const paths = [];
  for (const key of keys) {
    const bc = bcByKey.get(key) ?? null;
    const es = esByKey.get(key) ?? null;
    const nonPathway = es?.nonPathway ?? false;
    const presence = bc && es ? "both" : bc ? "basecamp-only" : "easyspeak-only";

    paths.push({
      canonicalKey: key,
      displayName: bc?.path_name ?? es?.path ?? key,
      basecampPathName: bc?.path_name ?? null,
      easyspeakPathLabel: es?.path ?? null,
      presence,
      nonPathway,
      levels: nonPathway ? [] : diffLevels(es, bc),
      pathCompletion: buildPathCompletion(bc),
    });
  }

  return { paths, easyspeakNoActivePath: noActivePath };
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

function buildClubPairReport(basecampClub, easyspeakClub) {
  const memberMatches = matchMembers(basecampClub?.people ?? [], easyspeakClub?.people ?? []);

  const members = memberMatches.map(({ basecamp, easyspeak, confidence, score }) => {
    const presence = basecamp && easyspeak ? "both" : basecamp ? "basecamp-only" : "easyspeak-only";
    const { paths, easyspeakNoActivePath } = matchPaths(basecamp, easyspeak);
    return {
      basecampUserId: basecamp?.userId ?? null,
      easyspeakMemberId: easyspeak?.memberId ?? null,
      name: basecamp?.name ?? easyspeak?.name,
      presence,
      matchConfidence: confidence,
      matchScore: score,
      easyspeakNoActivePath,
      paths,
    };
  });

  return {
    basecampClubId: basecampClub?.id ?? null,
    basecampClubName: basecampClub?.name ?? null,
    easyspeakClubId: easyspeakClub?.id ?? null,
    easyspeakClubName: easyspeakClub?.name ?? null,
    matchScore: basecampClub && easyspeakClub ? clubNameScore(basecampClub.name, easyspeakClub.name) : null,
    members,
  };
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
    diffLevel,
  };
}
