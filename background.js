// background.js
//
// MVP : pas de logique métier ici pour l'instant. Le popup communique
// directement avec le content script de l'onglet actif.
// Ce fichier sert de point d'ancrage pour la suite :
//   - planification (chrome.alarms) d'un scraping périodique
//   - centralisation du stockage EasySpeak + Basecamp
//   - calcul du delta une fois les deux sources branchées

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Toastmasters VPE Tracker] Extension installée.");
});
