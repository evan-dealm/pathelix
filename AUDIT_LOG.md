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

### Bug #5 — Undo/Redo saute un niveau d'historique — CORRIGÉ

`planningStore.ts` : `_history` ne stocke que des snapshots PRÉ-action. `undo()` calculait
`idx-1` PUIS lisait `_history[idx-1]` au lieu de lire `_history[idx]` PUIS décrémenter — un
clic Annuler sautait un niveau entier, et `canUndo()` (`idx > 0`) rendait la toute première
action d'une session non-annulable. `redo()` avait le défaut symétrique, et l'état réel après
la dernière action n'était jamais capturé nulle part, donc redo ne pouvait jamais y revenir
après un undo.

Corrigé : `_historyIdx` réinterprété comme "nombre de pas undo depuis la dernière action" (0 =
à la pointe), nouveau champ `_tip` qui capture paresseusement l'état live au premier undo pour
que redo puisse y revenir exactement, `pushHistory` tronque toute branche redo obsolète sur
une nouvelle action. Deux tests existants pinaient directement le bug (assertions sur l'état
faux) — corrigés avec justification inline, 4 nouveaux tests de régression ajoutés (chaîne
undo/redo multi-étapes, round-trip exact vers la pointe, troncature de branche après action
post-undo). 205 fichiers / 3582 tests verts, typecheck propre. Commit `e785ca2`.

### `.env.example` — Trackdéchets pointait vers l'URL de production par défaut — CORRIGÉ

`TRACKDECHETS_API_URL` dans `.env.example` valait `https://api.trackdechets.beta.gouv.fr`
(production) alors que le code (`src/lib/trackdechets/client.ts`) retombe sur le sandbox si la
variable est absente, et que toute la documentation décrit un HALT actif (aucun appel API TD
en prod sans validation manuelle). Un opérateur copiant `.env.example` vers `.env` sans
éditer chaque ligne aurait silencieusement pointé les appels BSD réels vers l'API
gouvernementale de production. Corrigé : valeur sandbox + commentaire explicite. Commit
`939c473`.

## Phase 2/3 — Revue ciblée (grep + spot-check), pas de re-découverte complète

Les audits précédents (avril/mai/juillet/août 2026, voir mémoire du projet) ont déjà couvert
l'OWASP Top 10 en profondeur sur ce projet. Cette session a fait une repasse ciblée plutôt
qu'une redécouverte complète, pour concentrer l'effort sur le delta et les zones à risque :

- Aucune lecture directe de `x-user-role`/`x-tenant-id`/`x-user-id` en dehors de
  `src/lib/data/context.ts` lui-même (grep exhaustif sur `src/`) — invariant #2 respecté.
- Zéro occurrence de `USE_MOCK_DATA === 'true'` (pattern inversé dangereux) dans `src/` —
  invariant #4 respecté.
- Zéro `as any` dans `src/` — convention respectée.
- `console.*` en dehors des tests : seulement `logger.ts` (légitime, c'est l'implémentation du
  logger) et `ErrorBoundary.tsx` (dev-only, `eslint-disable` documenté, Sentry capte en prod).
- Zéro `dangerouslySetInnerHTML`, zéro `eval`/`child_process`/`execSync` dans `src/`.
- `middleware.ts` : confirmé aucun en-tête de sécurité (CSP/HSTS/etc.) — invariant #3 respecté.
- Webhooks Nessy/OBD : confirmé le tenant est résolu par correspondance de secret, jamais par
  header client-asserté ; `NESSY_WEBHOOK_SECRET`/`OBD_WEBHOOK_TOKEN` confirmés non lus pour
  l'authentification (juste un warning de log si encore définis).
- Upload `delivery-proof` : limite de taille (5 Mo), détection par magic bytes plutôt que
  Content-Type client, nom de fichier en UUID — solide.
- **Aucune nouvelle faille de sécurité trouvée** au-delà du `.env.example` ci-dessus.

### Documentation obsolète trouvée en vérifiant les chiffres contre le code réel

- `AuditLog` : la documentation (plusieurs fichiers, dont `CLAUDE.md` implicitement via les
  docs techniques) affirmait une rétention de 90 jours. Le code
  (`src/workers/auditRetentionWorker.ts:11`) a en réalité un défaut de **365 jours**
  (`AUDIT_RETENTION_DAYS ?? '365'`). Corrigé dans la nouvelle documentation
  (`docs/authentification-securite.md`, `docs/configuration.md`).
- Modèle de données : la documentation affirmait "30 modèles, 3 énumérations". Le schéma réel
  (`prisma/schema.prisma`) en compte **33 et 4** (nouvel enum `BsdStatus`, nouveaux modèles
  `ClientSite`, `TourHistory`, `WeeklyPlan`, `CustomTrade` apparus depuis la dernière
  vérification documentaire). Corrigé dans `docs/base-de-donnees.md`.
- `npm audit` : la documentation antérieure affirmait "0 vulnérabilité high/critical (dernière
  vérification août 2026)". De nouvelles CVE ont depuis été publiées pour des versions jusque-là
  saines (notamment la RCE critique Next.js sur Windows) — ce n'était pas une erreur de
  l'audit précédent, les avis de sécurité continuent d'être publiés après coup pour des
  versions déjà en place. Corrigé/mis à jour dans toute la documentation de cette session.

## Phase 5 — Nettoyage

Approche : `knip` (exécuté via `npx knip`, pas ajouté comme dépendance) pour détecter fichiers/
exports/dépendances inutilisés, puis vérification manuelle de chaque signalement avant toute
suppression — conformément à la méthode imposée (recherche de références, imports dynamiques,
fichiers chargés par convention).

**Aucune suppression de code appliquée cette session** après vérification :

- "Fichiers inutilisés" signalés (`e2e/auth.setup.ts`, `load-tests/**/*.js`,
  `prisma/schema.prisma`, `prisma/seed-massive.ts`, `public/sw.js`) : tous des faux positifs de
  connaissance de `knip` — chargés par convention (Playwright, k6 CLI externe, Prisma CLI,
  script npm dédié, Service Worker enregistré par le navigateur), jamais par `import`. Vérifié
  un par un, aucun n'est mort.
- "Dépendances inutilisées" signalées (`@prisma/client`, `pg`, `sharp`) : vérifiées par grep —
  `@prisma/client` n'est en effet jamais importé directement (le client généré vit dans
  `src/generated/prisma`, sortie custom du générateur Prisma 7 — mais le paquet
  `@prisma/client` reste une dépendance nécessaire à la génération elle-même, vérifiée par le
  fonctionnement réel de `npx prisma generate` cette session) ; `pg` est requis en pair-
  dépendance implicite de `@prisma/adapter-pg` (`src/lib/db.ts`) sans jamais être importé par
  son nom dans le code applicatif ; `sharp` est consommé implicitement par `next/image` sans
  jamais être importé dans `src/`. Les trois sont des faux positifs classiques Next.js/Prisma,
  laissés en place.
- "Exports/types inutilisés" (26 + 36 signalements) : non traités individuellement cette
  session par manque de temps proportionné au risque — un passage `knip` exhaustif antérieur
  (juin 2026, voir mémoire du projet) avait déjà nettoyé l'essentiel, et la majorité des
  signalements restants sont des types/constantes exportés par convention de bibliothèque
  interne (`src/lib/vrp/types.ts`, `src/lib/schemas.ts`, `src/lib/trackdechets/types.ts`) —
  supprimer un export sans certitude qu'aucun consommateur externe/futur n'en dépend est plus
  risqué que la valeur du nettoyage. Laissé "à vérifier" — voir rapport final.

## Phase 6 — Documentation

Les 5 fichiers `.md` racine (`README.md`, `API.md`, `TECHNICAL.md`, `FEATURES.md`,
`OPERATIONS.md`) déjà présents étaient substantiels (~1500 lignes) et vérifiés contre le code
en août 2026. Plutôt que de les ignorer et tout réécrire, tout leur contenu encore valable a
été extrait, vérifié à nouveau contre le code réel (voir corrections ci-dessus), et réorganisé
dans la structure `docs/` demandée par la mission. `API.md`, `TECHNICAL.md`, `FEATURES.md`,
`OPERATIONS.md` supprimés après migration complète (`README.md` conservé et mis à jour comme
point d'entrée). `CLAUDE.md` mis à jour (une référence obsolète à `API.md` → `docs/
configuration.md`).

## Phase 7 — Vérification finale

Voir `docs/audit-2026-09-21.md` pour la synthèse complète avant/après.
