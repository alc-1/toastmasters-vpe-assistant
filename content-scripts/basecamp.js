// content-scripts/basecamp.js
//
// Injecté sur https://apps.basecamp.toastmasters.org/*
// Récupère, pour chaque club où l'utilisateur connecté est officier "BCM"
// (Basecamp Club Management), la progression Pathways de tous les membres.
//
// L'authentification se fait par cookie de session : comme ce script tourne
// dans le contexte de la page (isolated world), le fetch() hérite
// automatiquement des cookies déjà posés par le navigateur pour ce domaine.

const API_ROOT = "https://basecamp.toastmasters.org/api";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SCRAPE_BASECAMP") {
    scrapeAllClubs()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    // Indique à Chrome qu'on répondra de façon asynchrone.
    return true;
  }
});

/**
 * Point d'entrée : liste les clubs "BCM" de l'utilisateur, puis récupère
 * la progression complète de chaque club.
 * @returns {Promise<Record<string, {name: string, members: object[]}>>}
 */
async function scrapeAllClubs() {
  const roles = await fetchJson(`${API_ROOT}/members/roles`);

  if (!Array.isArray(roles)) {
    throw new Error("Réponse inattendue de /api/members/roles (pas un tableau).");
  }

  const bcmClubs = roles.filter((club) =>
    (club.roles || []).some((role) => role.is_bcm)
  );

  if (bcmClubs.length === 0) {
    throw new Error(
      "Aucun club avec un rôle BCM trouvé pour ce compte. Es-tu bien connecté avec le bon compte ?"
    );
  }

  const result = {};
  for (const club of bcmClubs) {
    result[club.uuid] = {
      name: club.name,
      members: await fetchClubProgressPaginated(club.uuid),
    };
  }
  return result;
}

/**
 * Récupère toutes les pages de progression pour un club donné.
 * @param {string} uuid
 * @returns {Promise<object[]>}
 */
async function fetchClubProgressPaginated(uuid) {
  let url = `${API_ROOT}/bcm/progress/?club=${uuid}&page=1`;
  const members = [];
  let safety = 0;

  while (url) {
    // Garde-fou : évite une boucle infinie si l'API renvoie un "next"
    // qui boucle sur lui-même (ne devrait pas arriver, mais coûte peu).
    safety += 1;
    if (safety > 200) {
      throw new Error(`Trop de pages pour le club ${uuid} (>200) — arrêt de sécurité.`);
    }

    const data = await fetchJson(url);
    if (!Array.isArray(data.results)) {
      throw new Error(`Réponse inattendue pour ${url} (pas de champ "results").`);
    }
    members.push(...data.results);
    url = data.next;
  }

  return members;
}

/**
 * fetch() + parsing JSON avec gestion d'erreur explicite (statut HTTP, etc.)
 * @param {string} url
 */
async function fetchJson(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Non authentifié (${res.status}) sur ${url}. Reconnecte-toi sur Basecamp Toastmasters puis réessaie.`
      );
    }
    throw new Error(`${res.status} ${res.statusText} sur ${url}`);
  }
  return res.json();
}
