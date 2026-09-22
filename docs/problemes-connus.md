# Pathélix — Problèmes connus

> Consolidé le 2026-09-22 depuis `TEST_MANUEL_PROGRESSION.md` (fichier de session temporaire,
> supprimé après cette intégration) et la mission "mise en qualité production" du même jour.
> Liste des points **non corrigés**, volontairement — les bugs déjà corrigés (undo/redo, dates
> Missions/Tournées/Statistiques/Chauffeurs, bannière GOD MODE, onglet Audit, race condition
> N23) sont dans `CLAUDE.md` "What was audited and fixed" et `AUDIT_LOG.md`/`QUALITE_PROD_LOG.md`,
> pas ici.

## Fonctionnalités cassées

### Génération PDF (`/api/tours/pdf`, probablement `/api/reports/pdf`)

500 systématique. Root cause confirmée : `@react-pdf/reconciler` est un package ESM pur, Next
l'externalise côté serveur, il charge donc sa propre instance de React — différente de celle
bundlée par webpack pour le route handler. Les éléments React créés par l'une échouent
`isValidElement` dans l'autre (dual package hazard). Solutions tentées et **infirmées** :
`serverExternalPackages`, externaliser seulement les packages bas-niveau (fontkit, pdfkit) —
build OK mais même erreur. Externaliser `react`/`react-dom` casse le build entièrement. Nécessite
une vraie refonte architecturale — déplacer le rendu PDF hors du process serveur Next (worker
BullMQ dédié, sur le modèle de `src/workers/vrpWorker.ts`) ou changer de bibliothèque. Prévu en
Phase 7 de la mission "mise en qualité production" (2026-09-22) — **non traité**, faute de temps
dans cette session. Voir [deploiement.md](deploiement.md) §4.

## Gaps fonctionnels (pas des bugs — fonctionnalité incomplète)

### Notes de planification jamais partagées entre dispatchers

`localStorage` uniquement (`pathelix_plan_notes`), aucune table Prisma. Chaque dispatcher a sa
propre copie locale silencieuse, sans indication à l'écran que ce n'est pas partagé. Corriger
demande un nouveau modèle `PlanningNote` + route API Zod + contrôle de concurrence optimiste sur
`updatedAt` + migration automatique d'une éventuelle note `localStorage` existante — prévu en
Phase 7 de la mission "mise en qualité production", **non traité**.

### Gating UI des permissions granulaires incomplet

Sur 11 permissions configurables par utilisateur, 1 seule (`optimize`) a un vrai gating
d'interface (bouton désactivé + tooltip). La navigation admin est gatée uniquement par **rôle**
(`adminOnly` sur `NAV_ITEMS`) — 9 onglets sur 13+ sont inaccessibles à tout dispatcher quelle que
soit la permission accordée, rendant 7 des 11 permissions totalement inertes pour ce rôle. 3
autres (`manage_missions`, `view_reports`, `view_costs`) ciblent des onglets accessibles mais
sans gating client — **le backend reste correctement protégé** (vérifié en code), donc UX
trompeuse, pas une faille de sécurité. Correspondance permission→onglet complète, hook
`usePermission`/`<PermissionGate>` à généraliser sur chaque action de mutation : prévu en Phase 6
de la mission "mise en qualité production", **non traité**. Voir
[authentification-securite.md](authentification-securite.md) §5.

## Isolation multi-tenant — migration structurelle partielle

`getTenantDb()` (extension Prisma, voir [authentification-securite.md](authentification-securite.md)
§13) est en place et couvre les modèles centraux (Driver, Mission, Exutoire, Vehicle) mais pas
encore les ~59 fichiers restants listés dans `.eslintrc.json` (override "en attente de
migration") — voir `QUALITE_PROD_LOG.md` "Phase 1" pour la liste exacte et la méthode de
poursuite. RLS PostgreSQL évalué, non implémenté (§14 du même document).

## Notes mineures (faible priorité, non corrigées)

- SuperAdmin Dashboard : champ "Rechercher... Ctrl+K" ne filtre que l'onglet Tenants — no-op
  silencieux sur les autres écrans (Ctrl+K fonctionne, juste scope limité sans l'indiquer).
- SuperAdmin Tenants : bouton "Cache" (purge Redis) ne montre aucun toast de confirmation
  (fonctionne, juste silencieux visuellement).
- Historique : le bouton "Sauvegarder la tournée actuelle" dépend de `planDate` (état partagé
  Dashboard/Historique), pas de `browseDate` (navigation propre à l'onglet Historique) — 3
  notions de "date courante" coexistent dans l'app (`tourDate`, `planDate`, `browseDate`), sans
  date unique faisant autorité. Décision produit à trancher, pas un bug au sens strict.
- Tournées : "✕ Vider" (vide toutes les tournées du jour, action destructive) n'affiche aucune
  boîte de confirmation avant d'agir — fonctionnellement correct côté données, mais risque UX
  réel vu l'ampleur de l'action.
- Undo/Redo : `MAX_HISTORY` à 5, jamais monté à 20 malgré la recommandation (impact mémoire à
  vérifier avec un plan réaliste de 150 chauffeurs avant de le faire).
- OBD : positions stockées en mémoire (`obdStore`), perdues au redémarrage — pas persistées via
  `DriverPosition` comme Geotab/Samsara.

## Chantiers différés (décision produit, pas un bug technique)

- **Migration Next.js 16** (`middleware` → `proxy`) : évaluée, différée volontairement — revue
  humaine dédiée recommandée (`middleware.ts` porte l'isolation tenant/auth/RBAC). Voir
  [deploiement.md](deploiement.md) §4.
- **Contrainte PTAC dans le VRP** : le VRP ne vérifie pas la somme des poids livrés contre le
  PTAC du véhicule. Déclencheur : demande client explicite flotte mixte.
- **Copilote/OCR ticket de pesée en production** : code et modèle DB déjà en place, worker
  Python (`ai-engine/`) pas encore orchestré en déploiement.

## Non vérifié cette session (ni la précédente) — pas nécessairement un bug

Sections du test manuel jamais parcourues : 3e tenant sur un secteur autre que Collecte/BTP
(onboarding), flux Trackdéchets complet (HALT actif, jamais levé donc jamais testé de bout en
bout), prédictions ML (localisation/affichage), pages publiques (`/`, `/help`, `/status`,
`/tracking`, `/api-docs`), mesures de performance dédiées (temps de chargement, taille des
payloads). À couvrir dans une session de test manuel dédiée si nécessaire avant un pilote à plus
grande échelle.
