# Pathélix — Problèmes connus

> Consolidé le 2026-09-22 depuis `TEST_MANUEL_PROGRESSION.md` (fichier de session temporaire,
> supprimé après cette intégration) et la mission "mise en qualité production" du même jour.
> Mis à jour le 2026-09-23 après la session "fais TOUT" (Phases 6-8 + test manuel driver) —
> voir `QUALITE_PROD_LOG.md` pour le détail. Liste des points **non corrigés**, volontairement —
> les bugs déjà corrigés sont dans `CLAUDE.md` "What was audited and fixed" et
> `AUDIT_LOG.md`/`QUALITE_PROD_LOG.md`, pas ici.

## Gaps fonctionnels (pas des bugs — fonctionnalité incomplète)

### Gating UI des permissions granulaires — partiel

Sur 11 permissions configurables par utilisateur, 8 ont désormais un vrai gating d'interface :
navigation admin gatée par permission en plus du rôle (7 onglets : drivers, vehicles, exutoires,
templates, users, telematics, settings) pour la nav, `optimize` (weekly-plan, déjà en place) côté
backend + frontend, et `manage_missions` a un exemple de bouton de mutation gaté
(`MissionsTab` "+ Nouvelle mission" via `<PermissionGate>`). **Reste non traité** :
`view_costs`/`view_reports` (onglets accessibles mais sans gating client — backend correctement
protégé, donc UX trompeuse seulement, pas une faille), et une couverture exhaustive de tous les
boutons de mutation restants (le pattern `<PermissionGate>` existe désormais dans
`src/components/admin/PermissionGate.tsx`, à répliquer partout où une action de mutation existe).
Voir [authentification-securite.md](authentification-securite.md) §5.

## Isolation multi-tenant — migration structurelle terminée (Phase 1)

`getTenantDb()` (extension Prisma, voir [authentification-securite.md](authentification-securite.md)
§13) couvre désormais tous les fichiers migrés listés dans `QUALITE_PROD_LOG.md` "Phase 1" —
migration close. RLS PostgreSQL évalué, non implémenté (§14 du même document).

## Notes mineures (faible priorité, non corrigées)

- Historique : le bouton "Sauvegarder la tournée actuelle" dépend de `planDate` (état partagé
  Dashboard/Historique), pas de `browseDate` (navigation propre à l'onglet Historique) — 3
  notions de "date courante" coexistent dans l'app (`tourDate`, `planDate`, `browseDate`), sans
  date unique faisant autorité. Décision produit à trancher, pas un bug au sens strict.

## Chantiers différés (décision produit, pas un bug technique)

- **Migration Next.js 16** (`middleware` → `proxy`) : évaluée, différée volontairement — revue
  humaine dédiée recommandée (`middleware.ts` porte l'isolation tenant/auth/RBAC). Voir
  [deploiement.md](deploiement.md) §4.
- **Contrainte PTAC dans le VRP** : le VRP ne vérifie pas la somme des poids livrés contre le
  PTAC du véhicule. Déclencheur : demande client explicite flotte mixte.
- **Copilote/OCR ticket de pesée en production** : code et modèle DB déjà en place, worker
  Python (`ai-engine/`) pas encore orchestré en déploiement.

## Non vérifié cette session (ni les précédentes) — pas nécessairement un bug

Sections du test manuel jamais parcourues de bout en bout : flux commentaire/incident/scan-ticket,
mode hors-ligne avec coupure réseau navigateur réelle (`context.setOffline`/Playwright — l'anti-
doublon `IdempotencyKey` a été vérifié au niveau HTTP par rejeu direct d'une requête identique,
mais jamais dans le scénario complet "vraie coupure réseau → vraie file IndexedDB → vrai flush
concurrent double"), 3e tenant sur un secteur autre que Collecte/BTP (onboarding), flux
Trackdéchets complet (HALT actif, jamais levé donc jamais testé de bout en bout), prédictions ML
(localisation/affichage), pages publiques (`/`, `/help`, `/status`, `/tracking`, `/api-docs`),
mesures de performance dédiées (temps de chargement, taille des payloads). À couvrir dans une
session de test manuel dédiée si nécessaire avant un pilote à plus grande échelle.

Vérifié cette session (2026-09-23) en conditions réelles (app + worker + sandbox DB, pas de
mocks) : statuts de mission (persistance confirmée dans `Plan.statuses` en base après clic réel),
anti-doublon `IdempotencyKey` au niveau HTTP (rejeu d'une requête identique avec le même
`Idempotency-Key` → réponse strictement identique, aucune deuxième ligne `AuditLog` créée), et
upload photo — qui a révélé et corrigé un vrai bug de sécurité (`/api/driver-photos` acceptait
n'importe quel contenu tant que le préfixe `data:image/...` déclaré était présent, sans vérifier
les octets réels). Détail du correctif dans `QUALITE_PROD_LOG.md` Phase 11.
