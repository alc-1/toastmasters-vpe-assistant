// lib/resolution-store.js
//
// Storage I/O for the 6 persisted name-resolution keys in chrome.storage.local
// (memberLinks, memberRejectedPairs, clubLookup, pathLookup,
// memberPathOverrides, memberPathExclusions). Unlike
// lib/report.js/lib/easyspeak-parser.js, this file is legitimately
// chrome.*-dependent (it's pure storage I/O) so it isn't Node/module.exports-
// able — same as lib/basecamp-api.js and lib/easyspeak-api.js. Loaded via a
// plain <script> tag (after lib/report.js, for
// PATH_ALIASES/buildPathAliasLookup) in members.html, settings.html, and
// report.html — never importScripts'd into background.js, since none of
// this needs the service worker.
//
// Every write is an upsert enforcing a 1:1 invariant where applicable
// (confirming/pinning a pair first strips any prior record touching either
// id), so re-running an action never produces duplicate/conflicting rows.

const RESOLUTION_KEYS = [
  "memberLinks",
  "memberRejectedPairs",
  "clubLookup",
  "pathLookup",
  "memberPathOverrides",
  "memberPathExclusions",
];

/**
 * Reads all 6 keys and shapes them into exactly what lib/report.js's
 * buildReport()/buildClubPairReport() 4th "resolution" param expects.
 * @returns {Promise<{memberLinks: object[], rejectedPairs: object[], clubLookup: object[], memberPathOverrides: object[], memberPathExclusions: object[], pathAliasLookup: Map<string,string>}>}
 */
async function loadResolutionData() {
  const stored = await chrome.storage.local.get(RESOLUTION_KEYS);
  const pathLookup = await ensurePathLookupSeeded(stored.pathLookup);

  return {
    memberLinks: stored.memberLinks ?? [],
    rejectedPairs: stored.memberRejectedPairs ?? [],
    clubLookup: stored.clubLookup ?? [],
    memberPathOverrides: stored.memberPathOverrides ?? [],
    memberPathExclusions: stored.memberPathExclusions ?? [],
    pathAliasLookup: buildPathAliasLookup(pathLookup),
  };
}

/**
 * The Settings page's raw, editable form of the path lookup (canonical name
 * -> alias list), seeded from the hardcoded PATH_ALIASES the first time it's
 * read so the already-verified aliases don't regress.
 * @returns {Promise<Record<string,string[]>>}
 */
async function getPathLookup() {
  const { pathLookup } = await chrome.storage.local.get(["pathLookup"]);
  return ensurePathLookupSeeded(pathLookup);
}

async function ensurePathLookupSeeded(pathLookup) {
  if (pathLookup && Object.keys(pathLookup).length > 0) return pathLookup;
  await chrome.storage.local.set({ pathLookup: PATH_ALIASES });
  return PATH_ALIASES;
}

/** @returns {Promise<object[]>} */
async function getClubLookup() {
  const { clubLookup } = await chrome.storage.local.get(["clubLookup"]);
  return clubLookup ?? [];
}

/**
 * @param {number} basecampUserId
 * @param {string} easyspeakMemberId
 * @param {"fuzzy-confirmed"|"manual-search"} source
 */
async function confirmMemberLink(basecampUserId, easyspeakMemberId, source) {
  const { memberLinks } = await chrome.storage.local.get(["memberLinks"]);
  const filtered = (memberLinks ?? []).filter(
    (link) => link.basecampUserId !== basecampUserId && link.easyspeakMemberId !== easyspeakMemberId
  );
  filtered.push({ basecampUserId, easyspeakMemberId, source, confirmedAt: Date.now() });
  await chrome.storage.local.set({ memberLinks: filtered });
}

/**
 * Removes a confirmed link (the "Unlink" action for a manually-confirmed
 * member) — frees both sides to be re-matched/re-linked from scratch on the
 * next refresh. Does NOT reject the pair, so an exact/fuzzy re-match can
 * still recur; pair that with rejectMemberPair() if that's also wanted.
 * @param {number} basecampUserId
 * @param {string} easyspeakMemberId
 */
async function unlinkMember(basecampUserId, easyspeakMemberId) {
  const { memberLinks } = await chrome.storage.local.get(["memberLinks"]);
  const filtered = (memberLinks ?? []).filter(
    (link) => !(link.basecampUserId === basecampUserId && link.easyspeakMemberId === easyspeakMemberId)
  );
  await chrome.storage.local.set({ memberLinks: filtered });
}

/**
 * @param {number} basecampUserId
 * @param {string} easyspeakMemberId
 */
async function rejectMemberPair(basecampUserId, easyspeakMemberId) {
  const { memberRejectedPairs } = await chrome.storage.local.get(["memberRejectedPairs"]);
  const existing = memberRejectedPairs ?? [];
  const alreadyRejected = existing.some(
    (r) => r.basecampUserId === basecampUserId && r.easyspeakMemberId === easyspeakMemberId
  );
  if (alreadyRejected) return;
  existing.push({ basecampUserId, easyspeakMemberId, rejectedAt: Date.now() });
  await chrome.storage.local.set({ memberRejectedPairs: existing });
}

/**
 * @param {number} basecampUserId
 * @param {string} easyspeakMemberId
 * @param {string} basecampPathName raw, verbatim member.path_name
 * @param {string} easyspeakPathLabel raw, verbatim member.path
 */
async function setMemberPathOverride(basecampUserId, easyspeakMemberId, basecampPathName, easyspeakPathLabel) {
  const { memberPathOverrides } = await chrome.storage.local.get(["memberPathOverrides"]);
  const filtered = (memberPathOverrides ?? []).filter(
    (o) =>
      !(
        o.basecampUserId === basecampUserId &&
        o.easyspeakMemberId === easyspeakMemberId &&
        o.basecampPathName === basecampPathName &&
        o.easyspeakPathLabel === easyspeakPathLabel
      )
  );
  filtered.push({ basecampUserId, easyspeakMemberId, basecampPathName, easyspeakPathLabel, boundAt: Date.now() });
  await chrome.storage.local.set({ memberPathOverrides: filtered });
}

/**
 * The "Unbind" action for a manually-bound path pair — removes the override
 * so the pair goes back through normal canonicalization (may re-match
 * automatically if the names happen to canonicalize the same, or fall back
 * to orphaned again if not).
 * @param {number} basecampUserId
 * @param {string} easyspeakMemberId
 * @param {string} basecampPathName
 * @param {string} easyspeakPathLabel
 */
async function removeMemberPathOverride(basecampUserId, easyspeakMemberId, basecampPathName, easyspeakPathLabel) {
  const { memberPathOverrides } = await chrome.storage.local.get(["memberPathOverrides"]);
  const filtered = (memberPathOverrides ?? []).filter(
    (o) =>
      !(
        o.basecampUserId === basecampUserId &&
        o.easyspeakMemberId === easyspeakMemberId &&
        o.basecampPathName === basecampPathName &&
        o.easyspeakPathLabel === easyspeakPathLabel
      )
  );
  await chrome.storage.local.set({ memberPathOverrides: filtered });
}

/**
 * The "Force unbind" action for a path pair that matched *automatically*
 * (via canonicalization, not an override) — there's nothing to delete for
 * an automatic match, so this instead records a member-scoped exclusion
 * that keeps this specific pair from being auto-paired again, splitting it
 * back into two independently-orphaned paths the user can then resolve
 * manually (bind to something else, or leave as orphan). Member-scoped, not
 * global — doesn't touch pathLookup or affect any other member.
 * @param {number} basecampUserId
 * @param {string} easyspeakMemberId
 * @param {string} basecampPathName raw, verbatim member.path_name
 * @param {string} easyspeakPathLabel raw, verbatim member.path
 */
async function excludePathMatch(basecampUserId, easyspeakMemberId, basecampPathName, easyspeakPathLabel) {
  const { memberPathExclusions } = await chrome.storage.local.get(["memberPathExclusions"]);
  const existing = memberPathExclusions ?? [];
  const alreadyExcluded = existing.some(
    (e) =>
      e.basecampUserId === basecampUserId &&
      e.easyspeakMemberId === easyspeakMemberId &&
      e.basecampPathName === basecampPathName &&
      e.easyspeakPathLabel === easyspeakPathLabel
  );
  if (alreadyExcluded) return;
  existing.push({ basecampUserId, easyspeakMemberId, basecampPathName, easyspeakPathLabel, excludedAt: Date.now() });
  await chrome.storage.local.set({ memberPathExclusions: existing });
}

/**
 * @param {string} basecampClubId
 * @param {string} easyspeakClubId
 * @param {string} basecampClubName denormalized, for Settings display only
 * @param {string} easyspeakClubName denormalized, for Settings display only
 */
async function pinClub(basecampClubId, easyspeakClubId, basecampClubName, easyspeakClubName) {
  const { clubLookup } = await chrome.storage.local.get(["clubLookup"]);
  const filtered = (clubLookup ?? []).filter(
    (pin) => pin.basecampClubId !== basecampClubId && pin.easyspeakClubId !== easyspeakClubId
  );
  filtered.push({ basecampClubId, easyspeakClubId, basecampClubName, easyspeakClubName });
  await chrome.storage.local.set({ clubLookup: filtered });
}

/** @param {string} basecampClubId */
async function removeClubPin(basecampClubId) {
  const { clubLookup } = await chrome.storage.local.get(["clubLookup"]);
  const filtered = (clubLookup ?? []).filter((pin) => pin.basecampClubId !== basecampClubId);
  await chrome.storage.local.set({ clubLookup: filtered });
}

/**
 * Replaces the full alias list for a canonical path name (Settings' "edit"
 * action) — creates the canonical entry if it doesn't exist yet.
 * @param {string} canonicalName
 * @param {string[]} aliases
 */
async function setPathAliases(canonicalName, aliases) {
  const pathLookup = await getPathLookup();
  pathLookup[canonicalName] = aliases;
  await chrome.storage.local.set({ pathLookup });
}

/** @param {string} canonicalName */
async function deletePathCanonical(canonicalName) {
  const pathLookup = await getPathLookup();
  delete pathLookup[canonicalName];
  await chrome.storage.local.set({ pathLookup });
}
