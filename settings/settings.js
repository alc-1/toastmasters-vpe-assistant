// settings/settings.js
//
// DOM glue for the club/path name lookup editors. Club/path lookups are
// small, low-cardinality tables edited rarely (near-once per club, or when
// a new Pathways path/localization spelling shows up) — unlike
// members/members.js there's no live-recompute-and-rerender loop tied to
// matching; each section just re-reads its own storage after a write.

let basecampData = null;
let easyspeakData = null;

init();

async function init() {
  const cached = await chrome.storage.local.get(["basecampData", "easyspeakData"]);
  basecampData = cached.basecampData ?? null;
  easyspeakData = cached.easyspeakData ?? null;

  await refreshClubLookup();
  await refreshPathLookup();
}

// ---------------------------------------------------------------------------
// Club name lookup
// ---------------------------------------------------------------------------

async function refreshClubLookup() {
  const clubLookup = await getClubLookup();
  document.getElementById("clubLookupRoot").innerHTML = renderClubLookupSection(clubLookup);
  attachClubLookupHandlers();
}

function renderClubLookupSection(clubLookup) {
  const rows = clubLookup
    .map(
      (pin) => `
      <tr>
        <td>${escapeHtml(pin.basecampClubName)}</td>
        <td>${escapeHtml(pin.easyspeakClubName)}</td>
        <td><button class="secondary" data-action="remove-club-pin" data-basecamp-club-id="${escapeAttr(pin.basecampClubId)}">Remove</button></td>
      </tr>
    `
    )
    .join("");

  const table = clubLookup.length
    ? `<table class="lookup"><thead><tr><th>Basecamp club</th><th>EasySpeak club</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="empty-state">No club pins yet — clubs are only matched automatically on an exact name match.</p>';

  return `${table}${renderClubAddForm(clubLookup)}`;
}

function renderClubAddForm(clubLookup) {
  if (!basecampData || !easyspeakData) {
    return '<p class="empty-state">Extract both Basecamp and EasySpeak data first to add a club pin.</p>';
  }

  const pinnedBcIds = new Set(clubLookup.map((p) => p.basecampClubId));
  const pinnedEsIds = new Set(clubLookup.map((p) => p.easyspeakClubId));

  const bcOptions = Object.entries(basecampData)
    .filter(([id]) => !pinnedBcIds.has(id))
    .map(([id, club]) => `<option value="${escapeAttr(id)}">${escapeHtml(club.name)}</option>`)
    .join("");
  const esOptions = Object.entries(easyspeakData)
    .filter(([id]) => !pinnedEsIds.has(id))
    .map(([id, club]) => `<option value="${escapeAttr(id)}">${escapeHtml(club.name)}</option>`)
    .join("");

  if (!bcOptions || !esOptions) {
    return '<p class="empty-state">All clubs are already pinned.</p>';
  }

  return `
    <div class="add-form">
      <select id="newClubPinBc">${bcOptions}</select>
      <span>&harr;</span>
      <select id="newClubPinEs">${esOptions}</select>
      <button data-action="add-club-pin">Add mapping</button>
    </div>
  `;
}

function attachClubLookupHandlers() {
  const root = document.getElementById("clubLookupRoot");
  root.querySelectorAll('[data-action="remove-club-pin"]').forEach((btn) => {
    btn.addEventListener("click", () => onRemoveClubPin(btn.dataset.basecampClubId));
  });
  const addBtn = root.querySelector('[data-action="add-club-pin"]');
  if (addBtn) addBtn.addEventListener("click", onAddClubPin);
}

async function onRemoveClubPin(basecampClubId) {
  await removeClubPin(basecampClubId);
  await refreshClubLookup();
}

async function onAddClubPin() {
  const bcId = document.getElementById("newClubPinBc").value;
  const esId = document.getElementById("newClubPinEs").value;
  const bcName = basecampData[bcId]?.name ?? bcId;
  const esName = easyspeakData[esId]?.name ?? esId;
  await pinClub(bcId, esId, bcName, esName);
  await refreshClubLookup();
}

// ---------------------------------------------------------------------------
// Path name lookup
// ---------------------------------------------------------------------------

async function refreshPathLookup() {
  const pathLookup = await getPathLookup();
  document.getElementById("pathLookupRoot").innerHTML = renderPathLookupSection(pathLookup);
  attachPathLookupHandlers();
}

function renderPathLookupSection(pathLookup) {
  const rows = Object.entries(pathLookup)
    .map(
      ([canonical, aliases]) => `
      <tr data-canonical="${escapeAttr(canonical)}">
        <td>${escapeHtml(canonical)}</td>
        <td><input type="text" data-role="alias-input" value="${escapeAttr(aliases.join(", "))}"></td>
        <td>
          <button class="secondary" data-action="save-aliases">Save</button>
          <button class="secondary" data-action="delete-canonical">Delete</button>
        </td>
      </tr>
    `
    )
    .join("");

  const table = rows
    ? `<table class="lookup"><thead><tr><th>Canonical path name</th><th>Alternate spellings (comma-separated)</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="empty-state">No path aliases configured.</p>';

  return `
    ${table}
    <div class="add-form">
      <input type="text" id="newPathCanonical" placeholder="New canonical path name (lowercase)">
      <button data-action="add-canonical">Add path</button>
    </div>
  `;
}

function attachPathLookupHandlers() {
  const root = document.getElementById("pathLookupRoot");

  root.querySelectorAll('[data-action="save-aliases"]').forEach((btn) => {
    btn.addEventListener("click", () => onSaveAliases(btn));
  });
  root.querySelectorAll('[data-action="delete-canonical"]').forEach((btn) => {
    btn.addEventListener("click", () => onDeleteCanonical(btn));
  });
  const addBtn = root.querySelector('[data-action="add-canonical"]');
  if (addBtn) addBtn.addEventListener("click", onAddCanonical);
}

async function onSaveAliases(btn) {
  const row = btn.closest("tr");
  const canonical = row.dataset.canonical;
  const input = row.querySelector('[data-role="alias-input"]');
  const aliases = input.value
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  await setPathAliases(canonical, aliases);
  await refreshPathLookup();
}

async function onDeleteCanonical(btn) {
  const row = btn.closest("tr");
  await deletePathCanonical(row.dataset.canonical);
  await refreshPathLookup();
}

async function onAddCanonical() {
  const input = document.getElementById("newPathCanonical");
  // canonicalizePathName() lowercases the raw path before this table is
  // consulted, so a mixed-case canonical key here would just never match.
  const name = input.value.trim().toLowerCase();
  if (!name) return;
  await setPathAliases(name, []);
  await refreshPathLookup();
}
