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

**Reste de la Phase 7 à ce point de la session précédente** : worker PDF dédié, confirmation sur
"✕ Vider", `MAX_HISTORY` à 20, notes de planification partagées (`PlanningNote`), persistance des
positions OBD via `DriverPosition`, toast de confirmation sur la purge de cache, indication de
portée sur la recherche superadmin Ctrl+K. Tout traité dans la session suivante — voir Phases 6-10
ci-dessous.

## Phase 6 — Gating UI des permissions granulaires (partiel)

Constat vérifié dans le code (pas supposé) : sur 11 permissions configurables par utilisateur, une
seule (`optimize`) avait un vrai gating d'interface. La navigation admin (`NAV_ITEMS` dans
`src/app/admin/page.tsx`) était gatée uniquement par **rôle** (`adminOnly`), rendant 7 des 11
permissions totalement inertes pour un dispatcher — accordées côté `UserPermission` mais sans
aucun effet visible, l'onglet restant simplement absent du menu.

Corrigé : nouveau composant `src/components/admin/PermissionGate.tsx` (render-prop, calcule
`allowed`/`title` à partir de `hasPerm(permissions, perm)`, réutilisable sur n'importe quel bouton
de mutation) + `PERMISSION_LABELS` pour des tooltips explicites en français. `NAV_ITEMS` étendu
d'un champ `permission?: string`, filtre de nav changé de `!item.adminOnly || isAdmin` à
`!item.adminOnly || isAdmin || (item.permission && hasPerm(permissions, item.permission))` — 7
onglets (drivers, vehicles, exutoires, templates, users, telematics, settings) + weekly-plan
(`optimize`, déjà protégé côté backend, désormais aussi côté nav) rendus accessibles à un
dispatcher disposant de la permission correspondante. Exemple de gating d'un bouton de mutation
appliqué à `MissionsTab` ("+ Nouvelle mission"), à répliquer sur les autres actions de mutation.

**Explicitement pas traité** dans cette phase, honnêtement scopé plutôt que deviné :
`view_costs`/`view_reports` (onglets accessibles mais sans gating client — le backend reste
protégé, donc UX trompeuse seulement, pas une faille), et une couverture exhaustive de tous les
boutons de mutation restants au-delà de l'exemple `MissionsTab`. Voir
[docs/problemes-connus.md](docs/problemes-connus.md).

## Phase 7 (suite) — worker PDF dédié, télémétrie DriverPosition, PlanningNote partagée

### Génération PDF — root cause confirmée et corrigée

500 systématique sur `/api/tours/pdf`/`/api/reports/pdf`, cause déjà identifiée en Phase 7 initiale
(dual package hazard React entre le bundle webpack de la route et l'instance ESM propre de
`@react-pdf/renderer`). Corrigé en déplaçant le rendu PDF hors du process Next, dans un worker
BullMQ dédié (`src/workers/pdfWorker.ts`, `src/lib/queue/pdfQueue.ts`) sur le modèle de
`vrpWorker.ts`/`vrpQueue.ts` — un process séparé n'a par construction qu'une seule instance de
React, donc plus de collision possible.

Le worker n'a pas pu être lancé via `tsx` comme les autres workers : `tsx`'s resolveTsPaths (hook
de résolution des alias `@/`) retombe sur la résolution CJS de Node pour **toute** résolution dans
le process dès qu'un "paths" tsconfig existe — y compris au fond de la chaîne de dépendances de
`@react-pdf/renderer`, où `@react-pdf/hyphenate` ne déclare qu'une condition d'export "import"
(ESM pur), donc la résolution CJS échoue avec `ERR_PACKAGE_PATH_NOT_EXPORTED` avant même que le
code du worker ne s'exécute. Trois tentatives infirmées (renommage `.mts`, loader `node --import
tsx/esm`, tsconfig isolé sans "paths") avant la solution retenue : `esbuild` bundle le worker
directement (résout les alias `@/` et inline le code applicatif au moment du build, en laissant les
vrais paquets npm en imports externes `--packages=external` pour que le résolveur ESM natif de
Node s'en charge correctement à l'exécution). `npm run worker:pdf` = `build:worker:pdf &&
node dist/workers/pdfWorker.mjs`. Vérifié en conditions réelles (pas seulement supposé) : app +
worker + sandbox DB réellement lancés, PDF réellement généré et téléchargé, magic bytes confirmés
via `file`.

### Positions chauffeur jamais persistées en base

Aucune des 4 voies d'ingestion GPS (webhooks OBD/Geotab/Samsara + `/api/driver-position`) n'écrivait
jamais dans le modèle `DriverPosition` malgré son existence en base — la donnée transitait sans
être conservée, contredisant la note "Non fait" de `docs/problemes-connus.md` (OBD) qui sous-
estimait en fait la portée réelle du problème (les 3 autres voies non plus). Corrigé avec
`src/lib/driverPositionPersist.ts` (`persistDriverPositions`, appelé en `void` fire-and-forget
depuis les 4 points d'ingestion pour ne jamais bloquer la réponse HTTP sur l'écriture télémétrie).
En creusant, un import dynamique de `@/lib/db` dans `/api/driver-position/route.ts`
(`(await import('@/lib/db')).default`) échappait au gate ESLint `no-restricted-imports` — celui-ci
ne détecte que les imports statiques. Corrigé (remplacé par `getTenantDb`), **gap réel dans le
gate lui-même resté ouvert** : un futur import dynamique similaire passerait toujours inaperçu.

### Notes de planification jamais partagées entre dispatchers

`localStorage` uniquement (`pathelix_plan_notes`), aucune table Prisma — chaque dispatcher avait sa
propre copie locale silencieuse. Corrigé : nouveau modèle `PlanningNote` (migration
`20260923081622_add_planning_note`), route `src/app/api/planning-notes/route.ts` (GET/PUT, Zod,
concurrence optimiste par comparaison d'`updatedAt` attendu, 409 si divergence), et migration
automatique d'une éventuelle note `localStorage` existante vers la base au premier chargement dans
`BottomPanel.tsx` (clé de migration dédiée pour ne jamais rejouer deux fois).

### Trois correctifs UI mineurs

`MAX_HISTORY` (undo/redo) porté de 5 à 20 ; confirmation ajoutée avant "✕ Vider" (Modal, action
destructive) dans `ToursTab` ; indication de portée ajoutée sur la recherche superadmin Ctrl+K
(placeholder + hint quand hors de l'onglet Tenants). Le toast de purge de cache était déjà présent
malgré la note contraire — vérifié en code, pas supposé, avant de le retirer de la liste.

## Phase 8 — `npm audit`

`npm audit fix --force` proposait un downgrade `prisma@6.19.3` et `exceljs@<3.5.0` — régressions
réelles, refusées. Corrigé par overrides ciblés dans `package.json` (`deepmerge-ts`, `mysql2`,
`uuid` imbriqué sous `exceljs`/`xcode`) plutôt qu'un downgrade des paquets eux-mêmes. 0
vulnérabilité de production restante ; une modérée dev-only documentée comme compromis conscient.

Un hook de revue de sécurité automatique a signalé ce diff comme risque CRITICAL de dépendance
malveillante, affirmant l'ajout d'une entrée `sql-escaper` inexistante et une syntaxe d'override
imbriqué "incorrecte". Vérifié et infirmé : aucune trace de `sql-escaper` dans le diff réel (c'est
une dépendance transitive légitime de `mysql2`, visible seulement dans le lockfile), et les
overrides imbriqués sont la syntaxe npm documentée standard. **Faux positif d'un outil
automatique**, pas un vrai risque — consigné ici pour traçabilité, pas caché.

## Phase 9 — documentation

`CLAUDE.md` : compteur de modèles Prisma corrigé (34 → 35 après l'ajout de `PlanningNote`).
`docs/base-de-donnees.md` : compteur et changelog mis à jour, ligne `PlanningNote (N)` ajoutée au
diagramme. Ce fichier (`QUALITE_PROD_LOG.md`) et `docs/problemes-connus.md` mis à jour en Phase 10
plutôt qu'ici, après le test manuel E2E qui a suivi.

## Phase 10 — test manuel E2E interface chauffeur (partiel) + bug réel trouvé et corrigé

Connexion réelle via le formulaire `/login` (mot de passe sandbox réinitialisé pour le compte de
test existant `alice.e2etest@fleetmap-e2e.test`, créé lors du test manuel de session précédente),
chargement d'une vraie tournée peuplée (2 missions, "Client E2E Un"). L'a11y snapshot de la page a
révélé un avertissement visible pour chaque mission : `exutoire lié introuvable`, alors qu'une
requête SQL directe (`psql`) a confirmé que l'exutoire (`Centre E2E`) existe bien dans le tenant.

**Root cause** : `calcTour()` (`src/lib/algorithm.ts`) prend un paramètre optionnel `exutoires`
pour résoudre `linkedExutoireId` (avertissement + routage horaires d'ouverture/temps de trajet
vers l'exutoire). `src/app/driver/[id]/page.tsx` ne le récupérait jamais (aucune référence à
"exutoire" dans tout le fichier) et appelait `calcTour()` sans ce 6e argument — contrairement à
`ToursTab.tsx` côté admin, qui fait bien le fetch et le passe. Conséquence double : le faux
avertissement pour toute mission ayant réellement un exutoire lié, **et** le routage réel de la
tournée du chauffeur (temps de trajet, horaires) divergeant silencieusement de ce que le dispatch
avait planifié.

Corrigé sans élargir la surface exposée au rôle chauffeur : `/api/exutoires` est protégé
admin-only par le middleware (`ADMIN_ONLY_PATTERNS`), donc plutôt que d'ouvrir cette route au rôle
`driver`, les exutoires du tenant sont désormais inclus directement dans la réponse de
`/api/driver-plan/[id]` (déjà scopée tenant + chauffeur propriétaire), avec un `getAllExutoires`
tenant-scopé ajouté en parallèle des autres requêtes existantes. Vérifié en conditions réelles :
rebuild + redémarrage du serveur sandbox, avertissement disparu, distance totale de tournée passée
de 3 km à 25 km (le trajet vers l'exutoire est désormais réellement calculé). 2 nouveaux tests
ajoutés à `driver-list-plan-tracking.test.ts` (réponse vide et réponse peuplée). Suite complète
(3900 tests) et lint/typecheck relancés après coup — tous verts.

**Reste non couvert par ce test manuel à ce point** : flux commentaire/incident/scan-ticket, mode
offline avec coupure réseau réelle (le correctif idempotence `IdempotencyKey` d'une session
précédente est désormais vérifié au niveau HTTP — voir Phase 11 — mais jamais avec une vraie
coupure réseau navigateur). Transitions de statut et upload photo couverts dans la foulée — voir
Phase 11 ci-dessous.

## Phase 11 — transitions de statut, anti-doublon HTTP, et un vrai bug de sécurité trouvé + corrigé

Poursuite directe du test manuel de Phase 10, sur la même session chauffeur déjà authentifiée.

### Transition de statut — persistance vérifiée en base

Clic réel sur "Démarrer le trajet" dans le navigateur → `Plan.statuses` interrogé directement en
base (`psql`) après le clic : `{"<missionId>": {"status": "en_route", "en_routeAt": "..."}}`
confirmé présent. Le flux complet (geolocation → `enqueueAction` → sync queue → `POST
/api/driver-status/update`) fonctionne de bout en bout, pas seulement au niveau unitaire.

### Anti-doublon `IdempotencyKey` — vérifié par rejeu HTTP réel

Connexion via `curl` (mot de passe sandbox du compte de test réinitialisé pour l'occasion) pour
obtenir un vrai cookie de session, puis deux `POST /api/driver-status/update` identiques avec le
même en-tête `Idempotency-Key` : la 2e requête a renvoyé une réponse strictement identique (même
`timestamp`) sans créer de 2e ligne `AuditLog` pour la même mission — confirmé par comptage direct
en base avant/après. Vérifie réellement le mécanisme décrit en Phase 3 (Web Locks +
`IdempotencyKey`), au niveau HTTP plutôt qu'unitaire (mocks). La coupure réseau navigateur réelle
(`context.setOffline` Playwright) reste non testée — seul le rejeu HTTP direct l'est.

### Upload photo — vrai bug de sécurité trouvé et corrigé

En construisant un test légitime de rejet magic-byte pour `/api/driver-photos`, découverte que le
rejet **n'existait pas du tout** : la route ne validait que le préfixe MIME déclaré dans le data
URL (`data:image/jpeg;base64,...`) par une regex, jamais le contenu réel des octets décodés, avant
de les écrire directement dans un dossier servi statiquement
(`public/uploads/photos/<id>.jpg`). Confirmé en conditions réelles (pas supposé) : un payload texte
brut étiqueté `image/jpeg` a été accepté (200), écrit sur disque, et confirmé par `file` comme
"ASCII text" plutôt qu'une image — exactement le scénario d'upload de fichier non restreint
(OWASP).

`/api/delivery-proof` avait déjà le bon pattern (vérification des magic bytes JPEG/PNG sur le
buffer décodé avant écriture) — appliqué le même principe à `/api/driver-photos`, étendu aux 2
autres types déjà acceptés par cette route (GIF, WEBP). Rejette désormais avec 422 avant toute
écriture (mock ou disque) si les octets décodés ne correspondent à aucune signature d'image
acceptée. Revérifié en conditions réelles après correctif : le même payload malveillant est
maintenant rejeté (422), une vraie image PNG 1×1 est toujours acceptée (200). 2 nouveaux tests de
régression dans `driver-photos.test.ts` (mode mock et mode réel), suite complète (3902 tests) +
lint + typecheck relancés — tous verts.

`public/uploads/` était non suivi et non ignoré par git — ajouté à `.gitignore` (contenu généré à
l'exécution, comme le dossier d'upload `delivery-proof` existant).

**Reste non couvert, faute de temps dans cette session** : flux commentaire/incident/scan-ticket,
mode offline avec coupure réseau navigateur réelle. Détail dans
[docs/problemes-connus.md](docs/problemes-connus.md).
