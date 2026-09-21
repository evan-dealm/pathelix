# AUDIT_LOG.md — Audit complet Pathélix (2026-09-21)

Branche : `audit/complet-2026-09-21`, créée depuis `master` après commit snapshot `7237178`
(TEST_MANUEL_PROGRESSION.md, fichier de progression d'une session de test manuel antérieure
non terminée — conservé tel quel, contient 3 bugs déjà identifiés non corrigés réutilisés
ci-dessous plutôt que re-découverts).

Contexte : ce projet a déjà subi plusieurs audits complets (avril 2026, mai 2026 sécurité,
juillet 2026 pré-pilote, août 2026 4-phases → 26 commits/3491 tests, session de test manuel
août 2026 → 11 bugs UI↔API). Cette session part de cet état plutôt que de tout re-découvrir
depuis zéro — se concentre sur : delta depuis le dernier audit, items déjà documentés comme
non corrigés, et une repasse sécurité/dépendances à jour.

## Phase 0 — État de référence

- Stack confirmée : Next.js 15.5 App Router, TypeScript 5.9 strict, Prisma 7 + PostgreSQL 16,
  Zustand, TanStack Query 5, Tailwind 3, Leaflet, Zod 4, BullMQ+Redis, Valhalla/OSRM, Sentry,
  next-intl, Vitest, Playwright.
- `node_modules` déjà présent, pas de réinstallation nécessaire (npm 11.9.0, node 24.14.0).
- `npm run typecheck` → **0 erreur**.
- `npm run lint` (`next lint`) → **0 warning/erreur**. Note : `next lint` déprécié (retrait
  Next 16), migration recommandée vers ESLint CLI (`npx @next/codemod@canary
  next-lint-to-eslint-cli .`) — non fait cette session (pas de régression fonctionnelle, pure
  dette outillage), à planifier avant la montée vers Next 16.
- `npm run test` → **199 fichiers, 3523 tests, tous verts**, aucun échec. (Logs WARN/ERROR
  visibles dans la sortie sont des tests volontaires de chemins d'erreur — SASL password
  factice, déchiffrement Trackdéchets invalide, etc. — pas des échecs.)
- `npm run build` → build production **réussi** après les correctifs de dépendances ci-dessous
  (voir Phase 3).

## Phase 3 — Sécurité (dépendances, fait en premier vu la gravité)

`npm audit --production` initial : **14 vulnérabilités (1 critique, 9 hautes, 4 modérées)**.

**CRITIQUE corrigée immédiatement** : `next` < 15.5.24/15.6.x — RCE non authentifiée sur
serveurs **hébergés Windows** (GHSA-p293-qw3h-jr36) + RCE via Image Optimization API sur
fichiers AVIF (dépend de `sharp` vulnérable). Cet environnement de dev tourne sous Windows —
gravité directement applicable, corrigée en priorité absolue.

`npm audit fix` (sans `--force`, aucun changement breaking) → next passé à **15.5.25**,
`sharp`, `browserslist`, `baseline-browser-mapping`, `fast-uri`, `js-yaml`, `fflate` mis à
jour. `package.json` inchangé (range `^15.5.18` couvrait déjà le patch) ; seul
`package-lock.json` a bougé. Build + tests + typecheck reconfirmés verts après coup.

Restant après fix non-breaking (**10 vulnérabilités : 1 basse, 5 modérées, 4 hautes**), toutes
nécessitant `--force` avec downgrade breaking — évaluées et **volontairement non appliquées** :
- `deepmerge-ts`/`mysql2` (haute) — dépendances transitives de l'outillage CLI `prisma`
  (`@prisma/config`), pas du runtime de l'app. `--force` installerait `prisma@6.19.3`, un
  **downgrade** depuis Prisma 7 — violerait l'invariant stack du projet pour corriger une
  vulnérabilité d'un outil CLI dev, jamais exposé en prod. `mysql2` n'est même pas utilisé
  (app 100% PostgreSQL) — c'est une dépendance morte du tooling Prisma. Non corrigé, risque
  résiduel nul en pratique.
- `uuid` < 11.1.1 (modérée) — via `exceljs` (export Excel, utilisé en prod). `--force`
  downgrade `exceljs` vers 3.4.0 (breaking, perte de fonctionnalités d'export). La faille
  (absence de vérification de bornes sur un buffer fourni explicitement) ne s'applique pas à
  l'usage fait ici (génération interne, jamais de buffer utilisateur passé à `uuid`). Non
  corrigé, risque résiduel très faible — à réévaluer si `exceljs` publie un correctif non
  breaking.
- `@vitest/mocker`/`esbuild` (modérée/haute, "arbitrary file read" côté **serveur de dev**
  uniquement) — dépendances de test (`vitest`), jamais présentes en build de production.
  `--force` bump vers `vitest@5` = breaking change de l'outillage de test en fin d'audit,
  risque de régression des 3523 tests pour un correctif qui ne s'applique qu'au poste dev
  local. Reporté à une session dédiée à la montée de version Vitest 5.

**Action utilisateur requise** : aucune rotation de secret nécessaire pour ces correctifs (pas
de faille de credentials). Montée Vitest 5 et éventuel remplacement d'`exceljs` à planifier
séparément.

## Phase 1/2 — Bugs repris de la session de test manuel (TEST_MANUEL_PROGRESSION.md)

Voir section dédiée plus bas au fur et à mesure des corrections.
