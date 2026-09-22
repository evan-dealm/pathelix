# Mise en qualité production Pathélix (pré-pilote) — journal

Branche `feat/qualite-production`, créée depuis `master` après merge fast-forward local
(non poussé) de `feat/migration-maplibre` (4 commits, session précédente : correctifs carte
MapLibre — icônes emoji, versionnement worker, couverture E2E LiveTrackingMap). `master` était
en retard sur cette branche mais sans divergence (fast-forward pur, aucun commit perdu).

## Prérequis — vérifiés avant tout travail

- `git status` propre sur `master` avant création de branche : oui (après le merge FF).
- `master` contient les commits `feat/migration-maplibre` : oui (`git merge-base --is-ancestor`
  confirmé, fast-forward `7237178` → `6ac469a`).
- Bloqueur trouvé et résolu avec l'utilisateur (une seule question posée, comme autorisé par la
  règle QUESTIONS pour lever un prérequis non rempli avant démarrage) : `feat/migration-
  maplibre` n'était PAS mergée dans `master` au tout début de cette session. Option choisie par
  l'utilisateur : merge fast-forward local (pas de push), puis démarrage normal.
- Lint/typecheck/tests/build sur `master` post-merge : voir Étape 0 ci-dessous.

## Étape 0 — État de référence (2026-09-22)

| Mesure | Valeur |
|---|---|
| `npm run lint` (`next lint`) | 0 warning/erreur |
| `npx tsc --noEmit` | 0 erreur |
| Tests (`npx vitest run`, sans env sandbox — voir piège ci-dessous) | **211 fichiers / 3619 tests**, tous verts |
| Build production (`NODE_ENV=production npm run build`) | Succès (warnings bénins pré-existants : cache webpack `next-intl`, module optionnel `@opentelemetry/winston-transport` manquant — aucun des deux n'affecte le build) |
| `npm audit --production` | **6 vulnérabilités : 0 critique, 4 hautes, 2 modérées** — correspond exactement à `docs/audit-2026-09-21.md`. Détail : `deepmerge-ts`/`mysql2` (hautes, transitif outillage CLI Prisma, downgrade `prisma@6.19.3` refusé), `uuid` (modérée, via `exceljs`, downgrade breaking refusé). Voir Phase 8. |
| Modèles Prisma | **33 modèles, 4 énumérations** réels (`grep -c "^model "` / `"^enum "` sur `prisma/schema.prisma`) — confirme `docs/base-de-donnees.md`, **infirme** `CLAUDE.md` (indiquait encore "30 models, 3 enums" au moment de la lecture — sera corrigé en Phase 9, après les migrations de cette mission qui ajouteront des modèles) |
| Tenants `pathelix_fleet` (réel, lecture seule) | **2** : `Pathélix` (`pathelix-massive`), `Excoffier Test` (`excoffier-test`) — référence pour le contrôle final |
| Sandbox `manualtest_sandbox_never_prod` | Reconfirmée joignable après redémarrage des conteneurs Docker (`postgres`/`redis`/`valhalla` étaient arrêtés — tués par une purge mémoire système pendant la session précédente, relancés via `docker compose up -d`) |
| `scripts/db-guard.sh` | Revérifié : bloque `DATABASE_URL` absente (exit 1), bloque `DATABASE_URL` pointant explicitement vers `pathelix_fleet` (exit 1), laisse passer la sandbox (exit 0, echo explicite du nom de base) |

**Piège trouvé en vérifiant l'état de référence** : lancer `npx vitest run` après avoir sourcé
`.manualtest/env.sh` (qui exporte `USE_MOCK_DATA=false` pour les besoins du test manuel/E2E)
casse silencieusement tous les tests unitaires "mock mode" (20 tests, 10 fichiers, ex.
`trackdechets-accounts.test.ts`, `bsds.test.ts`, `history-status.test.ts`) — ils testent
explicitement le comportement par défaut (`USE_MOCK_DATA !== 'false'`), qui n'est alors plus le
cas. Déjà rencontré et diagnostiqué en fin de session précédente (voir
`MIGRATION_MAPLIBRE_LOG.md`). Confirmé de nouveau ici en lançant la suite avec les variables
`.manualtest/env.sh` explicitement désexportées (`env -u DATABASE_URL -u USE_MOCK_DATA ...`) —
211/211 fichiers verts. **Leçon consolidée** : ne jamais sourcer `.manualtest/env.sh` avant
`npx vitest run` ; il n'a de raison d'être sourcé que pour le serveur applicatif lui-même
(`npm run dev`/`npm run build && npm run start`) ou les scripts DB-écriture passant par
`db-guard.sh`.

## Constats du prompt vérifiés contre le code réel (avant action, règle 12)

À vérifier au fil de chaque phase, consigné dans la section de la phase concernée plutôt qu'ici
en bloc — évite un double-constat périmé si le code change entre-temps pendant la mission.

## Phases

Voir sections ci-dessous, une par phase, ajoutées au fur et à mesure.
