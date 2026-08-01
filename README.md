# Toastmasters VPE Tracker — MVP (Basecamp uniquement)

Extension Chrome (Manifest V3) qui extrait, pour les clubs où l'utilisateur
connecté est officier "BCM", la progression Pathways de tous les membres via
l'API interne de **Basecamp Toastmasters** (`basecamp.toastmasters.org`).

Portée de ce MVP : **extraction et stockage local uniquement**. Pas encore de
comparaison avec EasySpeak, pas encore de rapport de delta — ce sont les
prochaines étapes.

## Installation (mode développeur)

1. Ouvrir `chrome://extensions`
2. Activer le "Mode développeur" (en haut à droite)
3. Cliquer sur "Charger l'extension non empaquetée"
4. Sélectionner le dossier `toastmasters-vpe-tracker/`

## Utilisation

1. Se connecter normalement sur `https://apps.basecamp.toastmasters.org/`
2. Rester sur cet onglet, cliquer sur l'icône de l'extension
3. Cliquer sur "Extraire les données Basecamp"
4. Le popup affiche un résumé (clubs + nombre d'entrées) et les données
   brutes en JSON, repliables sous "Données brutes"

Les données sont stockées dans `chrome.storage.local` sous les clés
`basecampData` (objet indexé par UUID de club) et `basecampScrapedAt`
(timestamp de la dernière extraction). Elles persistent entre les ouvertures
du popup mais restent locales à ce navigateur.

## Structure du projet

```
toastmasters-vpe-tracker/
├── manifest.json                  # Manifest V3, host_permissions + content script
├── background.js                  # Service worker (vide pour l'instant, prêt pour la suite)
├── content-scripts/
│   └── basecamp.js                # Toute la logique de scraping Basecamp
└── popup/
    ├── popup.html                 # UI du MVP
    └── popup.js                   # Déclenche le scraping, affiche le résultat
```

## Comment ça marche

- Le content script est injecté automatiquement sur toute page
  `apps.basecamp.toastmasters.org`.
- Il écoute les messages `{type: "SCRAPE_BASECAMP"}` envoyés par le popup.
- Au déclenchement :
  1. `GET /api/members/roles` → liste des clubs, filtrés sur les rôles
     `is_bcm: true`
  2. Pour chaque club, pagination complète de
     `GET /api/bcm/progress/?club={uuid}&page=N` en suivant le champ `next`
     jusqu'à `null`
- L'authentification est purement par cookie de session : comme le fetch part
  du contexte de la page (même origine), le cookie est envoyé automatiquement
  avec `credentials: "include"`. Aucune extraction manuelle de cookie n'est
  nécessaire.

## Limites connues du MVP

- Pas de gestion du cas où un membre suit plusieurs paths en parallèle au-delà
  de ce que l'API retourne déjà (à vérifier avec de vraies données multi-path)
- Pas de rafraîchissement automatique / planifié (déclenchement manuel via le
  bouton uniquement)
- Pas d'icônes définies dans le manifest (Chrome affichera une icône par
  défaut — cosmétique, à ajouter plus tard)
- Aucune donnée EasySpeak pour l'instant : le calcul de delta n'est pas encore
  possible

## Prochaines étapes

1. Reproduire la même approche (DevTools → endpoints → content script) côté
   EasySpeak
2. Définir la logique de rapprochement des membres entre les deux systèmes
   (pas d'ID commun a priori — probablement un matching par nom normalisé)
3. Construire le calcul de delta et le rapport consolidé dans le popup ou une
   page dédiée
