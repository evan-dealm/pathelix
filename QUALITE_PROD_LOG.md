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

## Phase 1 — Isolation multi-tenant structurelle

### Inventaire

`prisma/schema.prisma` : **33 modèles**, dont **29 tenant-scoped** (colonne `tenantId` propre).
4 modèles hors périmètre, chacun pour une raison distincte vérifiée dans le schéma :
- `Tenant` — c'est la racine, pas un enregistrement scopé.
- `ClientSite` — **aucune colonne `tenantId` propre** (liaison many-to-many `Client`↔`Site`,
  scopée uniquement de façon transitive via `clientId`/`siteId`, qui appartiennent chacun à un
  tenant). Voir audit dédié ci-dessous.
- `CustomTrade` — intentionnellement global (métiers personnalisés gérés par le superadmin,
  partagés entre tous les tenants — comportement voulu, pas un oubli).
- Les 4 énumérations ne sont bien sûr pas concernées.

1079 sites d'appel `prisma.<modèle>.<opération>(` recensés sur 102 fichiers non-test
(`grep -rEo "\bprisma\.[a-zA-Z]+\.[a-zA-Z]+\(" src/`). Ordre de grandeur qui dépasse largement
ce qui peut être migré et re-testé un par un, avec la rigueur exigée par la règle 9 (« jamais de
régression »), dans le temps de cette seule session. Décision : construire l'extension
structurelle (le vrai levier), migrer un sous-ensemble réel et prioritaire (zones à risque
historique + modèles centraux), documenter précisément et honnêtement le reste comme travail
restant exploitable par une session future — conformément à la règle 10 (honnêteté) plutôt que
de simuler une migration exhaustive.

### `getTenantDb(tenantId)` — extension Prisma Client (`src/lib/tenantDb.ts`)

Injecte `tenantId` dans `where` (lecture/`update`/`delete`, y compris `findUnique`/`update`/
`delete` par id seul — "extended where" Prisma 7, confirmé fonctionnel en direct, voir plus
bas) et dans `data` à la création (`create`/`createMany`/`upsert`), avec rejet immédiat
(`throw`) si l'appelant fournit explicitement un `tenantId` différent — jamais un cas légitime.
`unscopedPrisma` (alias explicite du client brut) réexporté depuis ce même fichier, nom
canonique pour la liste blanche ESLint (voir plus bas).

**Double preuve** :
1. `src/lib/__tests__/tenantDb.test.ts` — 213 tests, mock du client Prisma sous-jacent
   (`.$extends()` simulé fidèlement à la vraie API runtime, vérifiée contre les types générés
   `src/generated/prisma/runtime/client.d.ts`), boucle sur les 29 modèles tenant-scoped ×
   7 catégories de test (lecture/agrégat, extended-where par id, non-confiance d'un `tenantId`
   fourni par l'appelant, `create`, rejet de `create` avec `tenantId` incohérent, `createMany`,
   `upsert`) + 2 tests de non-régression sur `Tenant`/`CustomTrade` (jamais filtrés) + 1 garde-
   fou (`tenantId` vide → throw synchrone).
2. Script jetable exécuté en direct contre la sandbox via `db-guard.sh` (supprimé après usage,
   pas dans le dépôt) : lecture cross-tenant réelle confirmée renvoyer `null`, `create` avec
   `tenantId` incohérent confirmé lever l'erreur attendue — preuve que le vrai `$extends()` de
   Prisma 7 se comporte exactement comme le mock le prédit, pas seulement en théorie.

### Ce que l'extension ne couvre pas — audité à la main, pas juste documenté

- **Écritures imbriquées** (nested `create`/`update` via une relation) : grep exhaustif
  (`connectOrCreate`, `: { create:`, `: { update:`) sur tout `src/app|lib|workers` → exactement
  2 occurrences, `src/app/api/clients/route.ts:112` et `src/app/api/sites/route.ts:112`, toutes
  deux des écritures imbriquées sur `ClientSite` — qui n'a de toute façon pas de colonne
  `tenantId` (voir ci-dessous). Zéro exposition réelle actuellement.
- **Filtres dans `include`/`select`** (`include: { relation: { where: {...} } }`) : grep sur les
  12 fichiers utilisant `include:` → zéro occurrence de ce pattern dans tout `src/`.
- **`$queryRaw`/`$executeRaw`(`Unsafe`)** : 4 usages dans toute l'app, tous des `SELECT 1` de
  health check (`/api/health`, `/api/ready`, `/api/status`, `/api/superadmin/system-health`),
  aucune donnée tenant impliquée.
- **`ClientSite`** (pas de colonne `tenantId`) : les 8 sites d'appel (`clients/route.ts`,
  `clients/[id]/route.ts` ×2, `sites/route.ts` ×2, `sites/[id]/route.ts` ×2, `site-products/
  route.ts`) vérifiés un par un — chacun valide indépendamment que `clientId`/`siteId` (ou les
  deux) appartiennent bien au tenant courant (`prisma.client.count({where:{id:{in:...},
  tenantId}})` ou équivalent) **avant** toute lecture/écriture `clientSite`. Confirmé sûr partout
  — c'est très probablement la correction déjà appliquée lors de l'audit d'août 2026 pour le bug
  cross-tenant historique sur ce point précis (voir `authentification-securite.md` §4).

### Liste blanche client brut (`unscopedPrisma`) — légitime, pas en attente de migration

Catégories déjà identifiées comme structurellement nécessitant un accès cross-tenant (à
distinguer, dans la suite de cette phase et dans la configuration ESLint, des fichiers qui
restent simplement à migrer) :
- Webhooks (`nessy`/`obd`/`geotab`/`samsara`) : le tenant est résolu **en cherchant** quelle
  intégration activée correspond au secret/clé fourni — par construction cross-tenant tant que
  le tenant n'est pas encore identifié.
- `src/app/api/superadmin/**` (17 fichiers) : accès cross-tenant par conception du rôle.
- `src/workers/auditRetentionWorker.ts`, `recurringMissionsWorker.ts` : traitement batch sur
  tous les tenants.
- `src/lib/superadminAudit.ts` : journalisation superadmin, cross-tenant par nature.
- Health checks (`health`/`ready`/`status`) : aucune donnée tenant, `SELECT 1` seul.
- `src/lib/db.ts`, `src/lib/tenantDb.ts` eux-mêmes (définissent le client).

### Migration des routes — sous-ensemble réel et testé cette session

**Fait** (4 commits, voir `git log` sur cette branche) :
- `src/lib/data/{drivers,missions,exutoires}.ts` — les 3 fichiers qui centralisent l'essentiel
  des lectures/écritures de ces modèles ; migrer ces 3 fichiers protège structurellement tout
  ce qui passe par eux (`drivers/[id]/route.ts`, `missions/[id]/route.ts`, `exutoires/[id]/
  route.ts` n'ont eu **aucune** modification à faire, ils délèguent déjà entièrement).
- `src/app/api/{drivers,missions}/route.ts` — les 2 appels Prisma inline restants (vérification
  de plafond de plan tenant + `archive-all`).
- `src/app/api/vehicles/route.ts` + `vehicles/[id]/route.ts` — migration complète, **et un 4e
  bug cross-tenant réel trouvé et corrigé au passage** (pas cherché spécifiquement, trouvé en
  migrant) : `assignedDriverId` n'a aucune contrainte FK tenant-aware (`Driver.id` est
  globalement unique), donc rien ne vérifiait qu'un id de chauffeur fourni dans le corps de la
  requête appartenait bien au tenant courant avant de lier un véhicule dessus. Corrigé : les
  deux routes vérifient désormais l'appartenance au tenant via `getTenantDb(tenantId).driver.
  findFirst` avant de connecter, 422 sinon.
- `src/lib/permissions.ts` — **délibérément non migré**, documenté inline dans le fichier :
  `hasPermission(userId, role, permission)` filtre uniquement par `userId`, qui vient toujours
  du contexte de requête vérifié par JWT (jamais fourni par le client) ; un `User` appartient à
  exactement un tenant, donc ce filtre ne peut structurellement pas franchir une frontière de
  tenant. Migrer aurait exigé de changer la signature de cette fonction sur ~40 sites d'appel
  pour un gain de défense en profondeur sans faille réelle corrigée — jugé disproportionné.

**Nouveau test réel** : `src/app/api/__tests__/tenant-isolation.test.ts` — 4 tests qui exécutent
les vrais handlers de route (`drivers` GET liste/par id, `vehicles` POST) contre la **vraie**
extension `getTenantDb()` câblée à un faux client Prisma en mémoire (pas un mock de
`getTenantDb` lui-même) : preuve de bout en bout — liste jamais polluée par l'autre tenant, 404
sur lecture cross-tenant par id, et le bug `assignedDriverId` explicitement rejeté (+ cas
positif : assignation intra-tenant toujours acceptée).

**Restant** (89 routes API totales − celles migrées ci-dessus, + quelques fichiers `src/lib`) :
liste exacte reproductible avec `grep -rl "from '@/lib/db'" src/app/api src/lib src/workers
--include="*.ts" | grep -v __tests__` — cette même liste, moins la liste blanche légitime, est
maintenant **gelée dans `.eslintrc.json`** (voir section suivante) comme override explicite
« en attente de migration », donc reproductible aussi en lisant ce fichier directement.
Migration mécanique par fichier (remplacer `prisma.<modèle>` par `getTenantDb(tenantId).
<modèle>`, mettre à jour le mock de test associé), mais chaque fichier doit être vérifié
individuellement pour l'identifiant de tenant réellement en portée à chaque site d'appel — pas
automatisable sans risque de régression silencieuse (deux formes de régression trouvées en le
faisant à la main cette session : un test dont le mock `@/lib/db` ne fournissait pas l'export
nommé `prisma` attendu par `tenantDb.ts`, et un test asserting `where.tenantId` littéralement,
cassé une fois ce filtre déplacé dans l'extension).

### Règle ESLint — accès direct au client brut (`.eslintrc.json`)

`no-restricted-imports` interdit `import ... from '@/lib/db'` partout, avec un message pointant
vers `getTenantDb`/`unscopedPrisma`. Deux groupes d'exceptions, **distincts et non ambigus** :
1. Liste blanche légitime (accès cross-tenant par conception — webhooks, superadmin, workers
   batch, `permissions.ts`, health check) — ne changera jamais.
2. Override « en attente de migration » — la liste exacte des fichiers non encore migrés listée
   ci-dessus. **Doit rétrécir à mesure que Phase 1 continue** ; une régression (fichier migré
   puis quelqu'un réintroduit un import brut) serait immédiatement détectée par lint, puisque
   retirer un fichier de cette liste sans le migrer casse le gate.

Piège rencontré en l'écrivant : les segments de route dynamiques Next.js (`[id]`) contiennent
des crochets littéraux, que `minimatch` (utilisé par ESLint pour les globs `files`) interprète
comme une classe de caractères plutôt que du texte littéral — `src/app/api/clients/[id]/
route.ts` en tant que glob ne matchait jamais le vrai chemin de fichier. Corrigé en remplaçant
le segment `[id]` par un wildcard `*` (matche le même unique segment de chemin, sans ambiguïté
de classe de caractères) — plus simple et plus robuste qu'échapper les crochets (`\\[id\\]`
n'est de toute façon pas un échappement JSON valide dans un fichier `.eslintrc.json`).

### Migration complétée (2026-09-23, session ultérieure)

Les 89 routes restantes de la section précédente + les 6 fichiers `src/lib/` (`audit.ts`,
`data/customTrades.ts`, `delayScoring.ts`, `demandPrediction.ts`, `featureFlags.ts`,
`metricCollector.ts`) ont été migrées, en 8 lots (commits `refactor(security): migrate ... to
getTenantDb`), suivant exactement la méthode mécanique décrite ci-dessus : `prisma.<modèle>` →
`getTenantDb(tenantId).<modèle>`, retrait du `tenantId` désormais redondant dans chaque `where`/
`data`, mise à jour du mock de test associé (`vi.mock('@/lib/db', ...)` → `vi.mock('@/lib/
tenantDb', ...)`), et remplacement des assertions de test qui vérifiaient littéralement
`where.tenantId` par une assertion sur le résultat (le filtre est maintenant structurel, prouvé
par `tenant-isolation.test.ts`, pas un détail d'implémentation par route).

Cas particuliers rencontrés et tranchés au fil de la migration :
- **Clés uniques composées incluant `tenantId`** (`Plan.tenantId_driverId_date`,
  `WeeklyPlan.tenantId_weekStart`, `Integration.tenantId_type`) : le `tenantId` reste explicite
  dans le sélecteur `where` — c'est la forme de la contrainte DB, pas une vérification manuelle à
  retirer.
- **Lookups où le tenant n'est pas encore connu** (recherche par `trackingToken` public, par
  `driverId` avant que la session ne révèle son tenant, webhook `AI_CALLBACK_SECRET`) : restent
  sur `unscopedPrisma`, commentaire inline à chaque site expliquant pourquoi `getTenantDb` ne
  peut pas s'appliquer avant cette étape.
- **Cross-tenant par conception, pas un bug** : `admin/geocoding-audit` (agrégat superadmin par
  tenant) et `benchmark` (moyennes anonymisées inter-tenants du même métier) restent
  entièrement sur `unscopedPrisma` — retirés de la liste "en attente" sans être ajoutés à la
  liste blanche permanente, puisque la règle ESLint ne bloque que l'import direct de
  `@/lib/db`, pas `unscopedPrisma` réexporté depuis `tenantDb.ts`.
- **`$transaction` en tableau mélangeant modèle global et modèle scopé** (`onboarding/route.ts` :
  `Tenant.update` + `TenantSettings.upsert`) : les deux opérations restent sur le même client
  (`unscopedPrisma`), `tenantId` gardé explicite sur `TenantSettings` — Prisma exige que toutes
  les opérations d'un `$transaction([...])` en tableau viennent du même client.

`.eslintrc.json` : la liste "en attente de migration" est maintenant **vide et supprimée** — il
ne reste que la liste blanche permanente (webhooks, `superadmin/**`, health, `permissions.ts`,
`superadminAudit.ts`, 2 workers batch). `grep -rl "from '@/lib/db'" src --include="*.ts" | grep
-v __tests__` ne renvoie plus que ces fichiers-là. Suite verte : `npx tsc --noEmit` (0 erreur),
`npm run lint` (0 warning), `npx vitest run` (215 fichiers / 3867 tests, tous verts) après chaque
lot.

### RLS PostgreSQL — conception évaluée, non implémentée (comme demandé)

Voir section dédiée ajoutée dans `docs/authentification-securite.md` §14 (Phase 9) : faisabilité
avec `@prisma/adapter-pg`, coût perf, plan de migration.

## Phase 2 — Configuration fail-safe

**Constat vérifié avant d'agir (règle 12)** : `src/lib/env.ts` existait déjà (Zod, appelé depuis
`src/instrumentation.ts` au démarrage de Next) — contrairement à ce que le prompt supposait
("s'il n'existe pas déjà"), il existait mais était incomplet : ne validait pas `USE_MOCK_DATA`
du tout, et aucun des 4 workers (`vrpWorker.ts`, `mlProfileWorker.ts`,
`recurringMissionsWorker.ts`, `auditRetentionWorker.ts`) ne l'appelait.

**Fait** :
- `validateEnv()` échoue désormais explicitement (`process.exit(1)`) si `NODE_ENV=production` et
  `USE_MOCK_DATA !== 'false'` (même convention que partout ailleurs dans le code — jamais
  `=== 'true'`). `SESSION_SECRET` absent/< 32 caractères était déjà couvert par le schéma Zod
  existant (vérifié, rien à ajouter).
- `validateEnv()` appelé dans les 4 workers. Piège trouvé en le faisant : `recurringMissionsWorker.
  ts` est aussi importé comme bibliothèque pure (`toRRule`/`RecurrenceRule`) par
  `recurringTemplateBackfill.ts`, dont le test (`recurringTemplateBackfill.test.ts`, zéro mock)
  a immédiatement révélé le problème — un appel `validateEnv()` inconditionnel en haut de fichier
  s'exécutait à l'import, faisait `process.exit(1)` dans l'environnement de test, et faisait
  planter un test sans rapport. Corrigé en réutilisant le garde `isDirectRun`/`isMainEntry` déjà
  présent dans ce fichier (et dans `auditRetentionWorker.ts`, même précaution appliquée par
  cohérence) — `validateEnv()` ne s'exécute que si le fichier est vraiment lancé comme worker
  (`tsx src/workers/xWorker.ts`), jamais au simple import d'un helper. `vrpWorker.ts` et
  `mlProfileWorker.ts` n'ont pas ce garde (aucun autre fichier ne les importe pour un helper,
  vérifié par grep) — cohérent avec leur comportement déjà inconditionnel préexistant.
- **HALT Trackdéchets implémenté en code**, pas seulement en convention/documentation — vérifié
  au préalable qu'aucune garde n'existait dans le code (`grep -rn "HALT"` sur tout
  `src/lib/trackdechets/` et `src/app/api/trackdechets/`/`bsds/` : zéro résultat). `src/lib/
  trackdechets/client.ts` : `getTdApiUrl()` refuse désormais (lève `TdHaltError`, avant tout
  appel réseau) si l'URL résolue pointe vers `api.trackdechets.beta.gouv.fr` (production) sans
  `TRACKDECHETS_HALT_LIFTED=true` explicite. Nouvelle variable ajoutée à `.env.example`, sans
  valeur, commentée, renvoyant vers `docs/deploiement.md` §5. 3 nouveaux tests (bloque en prod
  sans le flag, autorise avec le flag, jamais bloqué sur le sandbox).
- `docs/installation.md` et `scripts/db-guard.sh` : références à `.env.production.local`
  (nom trompeur) remplacées par `.env.sandbox.local`. **Le fichier réel sur disque n'a pas été
  renommé** (règle 8 : ne jamais modifier les fichiers `.env*` existants) — listé comme action
  requise dans le rapport final. `TEST_MANUEL_PROGRESSION.md` contient aussi la référence mais
  est un fichier temporaire déjà prévu pour suppression en Phase 9 après intégration de son
  contenu — non touché ici pour éviter un double traitement.

**Tests ajoutés** : `src/lib/__tests__/env.test.ts` (nouveau, 8 tests — n'existait pas avant),
3 tests HALT dans `src/lib/trackdechets/__tests__/client.test.ts`, mocks `@/lib/env` ajoutés aux
3 tests worker concernés. 214 fichiers / 3847 tests verts.

**Non fait** : le prompt suggère aussi de valider l'environnement "de chaque worker" au sens
large — les scripts `prisma/seed*.ts` et `scripts/*.ts` n'appellent pas `validateEnv()` (hors
périmètre : ce sont des scripts ponctuels passant déjà par `db-guard.sh` pour leur propre garde-
fou dédié, pas des process longue durée comme les 4 workers BullMQ).

## Phase 3 — Interface chauffeur et mode offline (partielle)

### Idempotence

Nouveau modèle Prisma `IdempotencyKey` (`tenantId`, `key`, `route`, `status`, `response` JSON,
`createdAt`, `@@unique([tenantId, key])`) — migration `20260922193350_add_idempotency_key`
créée et appliquée contre la sandbox (`scripts/db-guard.sh npx prisma migrate dev`, jamais
`migrate deploy` — à appliquer en production après sauvegarde, voir rapport final).

`src/lib/idempotency.ts` — `withIdempotency(req, tenantId, route, handler)` : sans en-tête
`Idempotency-Key`, comportement inchangé (transparent pour tout appelant non hors-ligne). Avec
l'en-tête : cherche une réponse déjà enregistrée pour `(tenantId, key)` et la rejoue telle
quelle si trouvée ; sinon exécute le handler, enregistre sa réponse (sauf 5xx — une erreur
serveur doit rester rejouable, pas gelée), avale silencieusement une contrainte unique violée
en cas de course concurrente (la réponse retournée reste correcte, juste pas celle qui sera
rejouée au prochain essai).

Câblé sur les 2 routes réellement utilisées par `enqueueAction()` (vérifié par grep dans
`src/app/driver/[id]/page.tsx` — seules ces 2 routes sont mises en file hors-ligne aujourd'hui,
`incidents`/`mission-comments` sont soumis en ligne directement) :
- `POST /api/driver-status/update` — risque réel avant correctif : rejeu = double `syncMission
  ToERP`, doublon `AuditLog`. Test de bout en bout ajouté (`driver-status-update.test.ts`) :
  même clé deux fois → 1 seul appel ERP/audit log ; deux clés différentes → 2 appels distincts
  (preuve que ce n'est pas juste un no-op global).
- `POST /api/driver-photos` — risque de duplication plus faible par construction (nom de
  fichier déterministe, écriture idempotente de fait), câblé pour cohérence/complétude.

`src/lib/syncQueue.ts` (page) et `public/sw.js` (Service Worker) envoient tous deux l'en-tête
`Idempotency-Key` avec l'id de l'action déjà généré une fois à la mise en file (jamais régénéré
au retry) — même valeur des deux côtés pour la même action.

Purge après 48h via le worker de rétention existant (`auditRetentionWorker.ts`, CRON déjà en
place, étendu plutôt que dupliqué) — `purgeExpiredIdempotencyKeys()`, nouveau, testé.

### Race condition sync-queue (N23) — Web Locks API

**Root cause confirmée dans le code** (pas supposée) : `src/lib/syncQueue.ts` (page,
`flushSyncQueue`) et `public/sw.js` (Service Worker, `flushQueue`) sont deux boucles de flush
**indépendantes** lisant/écrivant la **même** file IndexedDB (`idb-keyval`, store `sync-q:*`) —
rien ne les coordonne. Un déclenchement simultané (message `FORCE_SYNC` de la page + événement
`sync` du SW) peut faire lire et POSTer la même action non encore supprimée par les deux à la
fois.

Corrigé avec la Web Locks API (`navigator.locks`), choisie plutôt qu'une alternative parce
qu'elle est **partagée nativement entre la page et le Service Worker de même origine** — un seul
verrou nommé (`pathelix-offline-sync-queue`) posé des deux côtés suffit, sans mécanisme de
message/coordination explicite à construire. Repli silencieux vers le comportement précédent si
`navigator.locks` est absent (très vieux navigateur). Nouveaux tests dans `syncQueue.test.ts`
prouvant que `navigator.locks.request()` est réellement appelé (pas juste documenté) et que le
repli fonctionne sans lui.

### Non fait dans cette phase (scope trop large pour le temps restant de cette session)

- **Validation E2E réelle B1-B9** (`TEST_MANUEL_PROGRESSION.md` §B, jamais testé à ce jour même
  en session manuelle antérieure) : tournée du jour, transitions de statut avec persistance
  vérifiée en base, upload photo avec rejet de faux type par magic bytes, commentaire/incident/
  scan ticket, mode offline avec coupure réseau réelle (`context.setOffline`) et vérification
  d'absence de doublon en base même en forçant un double envoi. Nécessite un chauffeur et une
  tournée réellement seedés + `next build && next start` + Playwright, dans l'esprit de la
  validation carte MapLibre de la session précédente — un travail de plusieurs heures à lui
  seul, non commencé. **Risque concret de cette lacune** : le correctif idempotence/Web Locks
  ci-dessus est vérifié unitairement (mocks) et son mécanisme de fond (extension Prisma, verrou
  partagé) vérifié en conditions réelles séparément, mais jamais le scénario complet "vraie
  coupure réseau navigateur → vraie file IndexedDB → vrai flush concurrent double" de bout en
  bout.
- **Saisie en langage naturel, repli si Ollama indisponible** : non vérifié cette session (accès
  Ollama non confirmé dans cet environnement, comme documenté par la session de test manuel
  précédente — "Ollama non démarré" déjà noté comme limitation d'environnement, pas un bug).

## Phase 7 — un correctif ciblé (le reste non traité, faute de temps)

Constat du prompt vérifié directement dans le code (pas supposé) : "bulk select inclut Platform
Admin, jamais bulk-suspendre sans déselectionner" (note de la session de test manuel précédente,
C2) — confirmé comme un **vrai bug non corrigé**, pas juste une prudence manuelle. Dans
`src/app/superadmin/page.tsx`, deux autres vues du même fichier filtrent déjà `t.slug !==
'__platform__'`, mais le tableau de l'onglet Tenants (case à cocher "tout sélectionner" +
lignes individuelles) ne le faisait pas — un superadmin cliquant "tout sélectionner" puis
"Suspendre tous" aurait réellement suspendu le tenant plateforme lui-même.

Corrigé : la case "tout sélectionner" ne sélectionne plus que les tenants non-plateforme
(recalcul de la liste sélectionnable, comparaison de longueur ajustée) ; la case à cocher
individuelle du tenant plateforme est désormais désactivée (grisée, `disabled`, tooltip
explicite) — défense en profondeur, pas seulement l'exclusion de la sélection groupée.

**Pas de test de régression ajouté** — `src/app/superadmin/page.tsx` (2163 lignes) n'a aucune
infrastructure de test composant existante à ce jour (seules des routes API superadmin sont
testées) ; construire ce harnais depuis zéro pour un seul correctif ciblé n'a pas été jugé
proportionné au temps restant de cette session. Lacune honnête, pas cachée.

**Reste de la Phase 7, non traité** : worker PDF dédié, confirmation sur "✕ Vider", `MAX_HISTORY`
à 20, notes de planification partagées (`PlanningNote`), persistance des positions OBD via
`DriverPosition`, toast de confirmation sur la purge de cache, indication de portée sur la
recherche superadmin Ctrl+K. Liste complète et détail dans
[docs/problemes-connus.md](docs/problemes-connus.md).
