# Pathélix — Exploitation & Déploiement

> Installation, tests, build, déploiement, runbook d'incidents, limitations connues.
> Vérifiée contre le code source réel (août 2026). Architecture : [TECHNICAL.md](TECHNICAL.md). Variables d'environnement complètes : [API.md](API.md).

---

## 1. Prérequis

| Composant | Version minimale |
|-----------|-----------------|
| Node.js | ≥ 18.17 |
| npm | ≥ 10 |
| PostgreSQL | 16 |
| Redis | 7 (optionnel — fallback in-memory) |
| Valhalla | Auto-hébergé (optionnel — fallback haversine) |

---

## 2. Installation

> **Nom du dossier vs nom du package** : le dossier local du dépôt est `projet_clem`, le package npm est `"pathelix"` dans `package.json`. Renommer le dossier nécessiterait de mettre à jour les scripts CI et tout bind-mount Docker par chemin absolu — le nom du package npm est correct tel quel.

```bash
git clone <repo>
cd projet_clem
npm install
npx prisma generate
```

Copier `.env.example` vers `.env` et renseigner au minimum `DATABASE_URL` et `SESSION_SECRET`. Liste complète des variables : [API.md](API.md#5-variables-denvironnement).

---

## 3. Démarrage

```bash
npm run dev              # Next.js sur :3000
npm run worker           # Worker BullMQ VRP (processus séparé)
npm run worker:ml        # Worker ML nocturne (optionnel)
npm run worker:recurring # Worker missions récurrentes (optionnel)
```

Ordre recommandé : PostgreSQL → Redis → Next.js → Worker VRP → Worker ML → Valhalla (optionnel).

### Premier démarrage

```bash
npx prisma migrate dev
npm run db:seed                # Données de test réalistes
npm run db:seed-superadmin     # Requiert SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD
```

---

## 4. Base de données

```bash
npx prisma migrate dev       # Dev : crée + applique la migration
npx prisma migrate deploy    # Prod : applique les migrations existantes
npx prisma migrate status
npx prisma generate
npx prisma studio            # GUI
```

**Règle impérative** : toujours sauvegarder avant une migration en production.

```bash
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
npx prisma migrate deploy
```

### Seeds disponibles

| Commande | Usage |
|----------|-------|
| `npm run db:seed` | Données réalistes multi-tenant |
| `npm run db:seed-massive` | Volume important (tests de charge) |
| `npm run db:seed-superadmin` | Compte superadmin uniquement |
| `npm run db:backfill-template-links` | Backfill `Mission.generatedFromTemplateId` sur les données existantes |

### CRON automatiques

| Job | Heure | Origine |
|-----|-------|---------|
| Coefficients ML | 02:30 | `mlProfileWorker.ts` |
| Rétention audit (> 90 jours) | Démarré par | `vrpWorker.ts` |
| Sauvegarde PostgreSQL | 02:00 recommandé | `scripts/backup-pg.sh` (à planifier via cron système) |

---

## 5. Tests

```bash
npm run test           # Vitest — run unique
npm run test:watch     # Mode watch
npm run test:coverage  # Avec couverture
npx playwright test    # E2E (serveur :3000 requis)
```

### État actuel

- **199 fichiers**, **~3 535 tests unitaires**, 100% verts
- **31 specs E2E** Playwright (`e2e/*.spec.ts`)

### Règles impératives

- Ne jamais skipper, désactiver ou commenter un test pour avancer
- Ne jamais baisser un seuil de couverture
- `src/lib/vrp/` jamais modifié sans validation complète de sa suite de tests existante

### E2E — root causes réelles des échecs historiques (résolu, 15 août 2026)

Les échecs `navigateToTab()` observés sur plusieurs sessions et longtemps attribués à de la
"pression mémoire" avaient en réalité deux causes de code distinctes, aucune des deux liée à la
mémoire :

1. **`src/providers/DataProvider.tsx`** calculait la date du jour avec les composants **locaux**
   de `Date` (`getFullYear/getMonth/getDate`), alors que tout le reste de l'app
   (`src/lib/dateUtils.ts`, `e2e/global-setup.ts`) utilise **UTC** (`toISOString()`). Près de
   minuit local, les deux dates divergent d'un jour entier : l'app allait chercher les missions
   du mauvais jour, l'onglet Missions s'affichait normalement mais montrait "Aucune mission" —
   pas un bug de clic, un bug de date. Corrigé (DataProvider passé en UTC).
2. **15 sites d'appel** dans `accessibility.spec.ts`, `dashboard-advanced.spec.ts`,
   `error-handling.spec.ts` et `responsive.spec.ts` appelaient `navigateToTab()` avec le libellé
   affiché à l'écran (`'Dashboard'`, `'Chauffeurs'`) au lieu de la clé `AppTab` en minuscules
   attendue. Le clic sur le bouton fonctionnait par accident, mais le sélecteur CSS
   `#tabpanel-{tabName}` est sensible à la casse et tous les id réels sont en minuscules — la
   vérification de panel échouait donc systématiquement, indépendamment de toute charge machine.
   `navigateToTab()` résout maintenant la clé canonique quelle que soit la casse utilisée par
   l'appelant.

**Caractéristique machine réelle et distincte, confirmée** : sur cette machine de développement
Windows, `next dev` (mode dev, compilation à la demande) voit son processus grossir à 5+ Go de
heap au bout de ~50-60 tests E2E séquentiels dans une même durée de vie de serveur, ce qui peut
dégrader/bloquer le serveur. **Confirmé spécifique au mode dev** : la même charge de test (72
tests, incluant le point de blocage observé en mode dev) exécutée contre un build de production
(`next build && next start`) a gardé le processus serveur à ~365 Mo, sans dégradation — aucun
rapport avec le comportement en production. Mitigation en mode dev : redémarrer le serveur entre
petits lots de fichiers plutôt qu'un run complet en une seule vie de serveur.

---

## 6. Build de production

```bash
npm run lint        # 0 erreur
npm run typecheck   # 0 erreur TypeScript strict
npm run build
npm audit --audit-level=critical   # 0 vulnérabilité critique
```

### CI gates obligatoires (ordre)

```
1. npm run lint        → 0 erreur
2. npm run typecheck   → 0 erreur
3. npm run test        → 100% vert
4. npm run build       → succès
5. npm audit --audit-level=critical → 0 critique
```

Aucun merge ni déploiement avant que les 5 gates soient verts.

### État de l'audit de sécurité des dépendances (août 2026)

`npm audit` : **0 high/critical**, 3 findings résiduels tous individuellement vérifiés non exploitables dans ce codebase :

| Paquet | Sévérité | Pourquoi non exploitable ici |
|--------|----------|-------------------------------|
| `esbuild` (via `vite`, dépendance de `vitest`) | low | La faille exige que le serveur de dev **Vite** tourne et accepte des requêtes. Pathélix utilise le serveur de dev **Next.js** — Vite n'est utilisé que comme moteur de transform interne à `vitest run` (mode `node`, jamais de serveur HTTP exposé). |
| `uuid` (via `exceljs`) | moderate | La faille exige qu'un buffer soit explicitement passé en paramètre à `uuidv4()`. Le seul call site d'`exceljs` qui utilise `uuid` l'appelle sans aucun argument. Le correctif suggéré (downgrade `exceljs` 4→3, breaking) introduirait plus de risque que la faille elle-même. |
| `exceljs` | moderate | Voir ligne `uuid` ci-dessus — même finding, deux entrées npm audit pour la même chaîne de dépendance. |

`postcss` et `sharp` sont forcés à leurs versions patchées via `overrides` dans `package.json` (détail : TECHNICAL.md §11) — ceci ferme les 3 CVE high qui étaient auparavant attribuées à `next` par transitivité, **sans** bump de version de Next.js.

---

## 7. Déploiement

```bash
docker-compose -f docker-compose.vps.yml up -d
```

### Variables d'environnement production (différences vs dev)

```env
USE_MOCK_DATA=false
NODE_ENV=production
FORCE_HTTPS=true
SESSION_SECRET=<secret-32-chars-unique-prod>
DATABASE_URL=<connexion-prod>
REDIS_URL=<redis-prod>
SENTRY_DSN=<dsn-prod>
TRACKDECHETS_API_URL=https://sandbox.trackdechets.beta.gouv.fr/   # HALT actif — voir §9
```

Seuls les ports 80/443 sont exposés sur Internet (reverse proxy Caddy/Nginx → Next.js). PostgreSQL (5432), Redis (6379), Valhalla (8002) restent sur le bridge Docker interne uniquement.

### Mise à jour de l'application

```bash
git pull
npm install
npx prisma migrate deploy    # si changement de schéma
npm run build
pm2 restart pathelix         # ou: docker compose restart app
```

---

## 8. Dimensionnement serveur

Architecture mono-serveur cloud dédié — tous les services (Next.js, PostgreSQL, Redis, Valhalla, Worker VRP) communiquent via un bridge Docker interne (< 1ms), pas de cluster distribué. Implication directe : les caches in-memory (rate limiting fallback, suspension tenant, etc.) sont **par process** — une bascule multi-instance nécessiterait un mécanisme d'invalidation partagé (Redis pub/sub) qui n'existe pas aujourd'hui. Accepté comme hypothèse de conception pour le pilote actuel.

| Chauffeurs | RAM totale min | CPU min |
|-----------|---------------|---------|
| ≤ 20 | 16 Go | 8 cœurs |
| ≤ 50 | 32 Go | 14 cœurs |
| ≤ 150 | 45 Go | 22 cœurs |
| ≤ 300 | 64 Go | 44 cœurs |
| ≤ 500 | 100 Go | 68 cœurs |
| ≤ 1 000 | 150 Go | 90+ cœurs |

RAM Worker VRP : `secteurs × 400 Mo + 2 Go`. `VRP_THREAD_CONCURRENCY = cœurs totaux − 4`. Valhalla : 4–12 Go au démarrage (France complète OSM), 15–30 min de premier démarrage.

Le système ML (statistique, Node.js) ne requiert **aucun GPU**. Un GPU ne devient nécessaire que si l'AI Engine OCR (voir TECHNICAL.md §9) est orchestré en production.

### Dimensionnement validé à 150 chauffeurs (analyse de code path, juin 2026)

Correctifs déjà appliqués suite à ce dimensionnement :

- `SSE_MAX_CONNECTIONS_PER_TENANT` relevé de 50 (bloquant dès le 51e chauffeur connecté) à 200 par défaut
- `GET/POST /api/driver-position` : cache des IDs chauffeurs par tenant (TTL 60s) — élimine les requêtes DB répétées de validation d'existence sous forte fréquence d'ingestion GPS

Points à confirmer sur infrastructure de production réelle (non prouvables en dev) : latences absolues, saturation du pool Prisma à charge soutenue, comportement Redis Pub/Sub SSE à 150+ connexions simultanées, performance de la matrice Valhalla à cette échelle. Scripts de charge disponibles : `load-tests/scenarios/` (k6), lancés via `bash load-tests/run-all.sh`.

---

## 9. HALT Trackdéchets

**HALT ACTIF.** Aucun appel API Trackdéchets en production sans validation manuelle préalable de la checklist ci-dessous.

```env
# Sandbox (défaut — HALT actif)
TRACKDECHETS_API_URL=https://sandbox.trackdechets.beta.gouv.fr/
# Production (lever le HALT uniquement après validation complète)
TRACKDECHETS_API_URL=https://api.trackdechets.beta.gouv.fr/
```

### Sécurité du token (déjà vérifiée en code)

Token stocké chiffré AES-256-GCM (`TrackdechetsAccount.encryptedToken`), déchiffré en mémoire uniquement, jamais loggué, jamais renvoyé par une route (`GET /api/trackdechets/accounts` ne retourne que `{configured, accountId}`). Signature webhook HMAC-SHA256 (`TRACKDECHETS_WEBHOOK_SECRET`).

### Procédure de validation manuelle avant de lever le HALT

**Prérequis** : compte test sur `sandbox.trackdechets.beta.gouv.fr`, token API personnel, deux établissements SIRET fictifs (émetteur + destinataire).

```bash
USE_MOCK_DATA=false
TRACKDECHETS_API_URL=https://sandbox.trackdechets.beta.gouv.fr/
TRACKDECHETS_ENCRYPTION_KEY=<64 hex chars>
TRACKDECHETS_WEBHOOK_SECRET=<secret webhook>
```

1. **Configurer le compte** : `POST /api/trackdechets/accounts { token }` → `200 { ok: true, accountId }`
2. **Créer un BSD** : `POST /api/bsds { emitter, recipient, wasteDetails }` → `201 { bsdId, tdId, status: "DRAFT" }`. Vérifier son apparition dans l'UI sandbox TD.
3. **Test champ manquant** : signer un BSD sans `wasteDetails.name`/`quantity` → `422` avec liste de champs manquants, **aucun appel TD effectué**, BSD toujours `DRAFT` en DB.
4. **Signer producteur** : compléter les champs requis, `POST /api/bsds/[id]/sign { signatureType: "PRODUCER" }` → `200`, statut passé à `SIGNED_BY_PRODUCER` (vérifié dans l'UI sandbox TD).
5. **Acteur non inscrit** : SIRET syntaxiquement valide mais non enregistré sur TD → création `201` (DRAFT), signature → `502 { error: "Erreur Trackdéchets: ..." }` — la mission Pathélix n'est **pas bloquée**, le BSD reste dans son état précédent.
6. **Webhook statut** : simuler un webhook signé HMAC (`POST /api/webhooks/trackdechets`) → `200 { ok: true }`, vérifier que `bsd.status` change en DB.

### Critère de levée du HALT

Validation humaine des 6 étapes ci-dessus sur le sandbox réel, **plus** confirmation que `TRACKDECHETS_API_URL` pointe vers la prod, que les établissements réels sont inscrits, et que le log d'audit (Sentry) est actif.

---

## 10. Limitations connues (pilote actuel)

Limites acceptées consciemment pour le périmètre actuel du pilote. À retraiter explicitement avant d'étendre le périmètre décrit ci-dessous — pas des bugs, des décisions de conception documentées.

| Limitation | Fichier | À retraiter avant |
|---|---|---|
| Cache de suspension tenant en mémoire, pas partagé multi-instance | `src/lib/data/context.ts` (`_suspensionCache`) | Toute bascule vers plusieurs instances applicatives (voir §8) |
| Centres urbains codés en dur (bonus trafic VRP) — 5 villes Rhône-Alpes | `src/lib/algorithm.ts` | Onboarding d'un tenant hors région Rhône-Alpes/Genève (override existe : `URBAN_CENTERS_JSON`, mais liste globale unique) |
| Pas de contrainte hazmat/gabarit dans le VRP | `src/lib/vrp/hfvrp.ts` | Onboarding d'un tenant BTP/hazmat en usage intensif réel |
| Pas de contrainte PTAC (poids cumulé tournée) | `src/lib/vrp/multiCompartment.ts` | Client demandant explicitement la conformité PTAC avec densités variables ou flotte mixte — détail technique dans TECHNICAL.md §7 |
| Multi-langue non câblé (infrastructure présente, 100% FR hardcodé) | `next-intl` installé, `useTranslations()` non utilisé | Lancement hors France |
| HALT Trackdéchets actif | — | Voir §9 |
| Next.js 16 non appliqué (middleware→proxy juge trop risqué avant pleine échelle prod) | Branche `next-16-major-bump` conservée non mergée | Chantier dédié post-pilote — voir §11 |

---

## 11. Chantiers différés identifiés

### Migration Next.js 16

Évaluée et **volontairement différée**, pas bloquée par un problème technique non résolu. Sur la branche `next-16-major-bump` (conservée, non mergée) : `tsc --noEmit`, la suite de tests complète et `next build` passent tous sans modification. Le seul point d'attention est que `next build` marque `src/middleware.ts` comme déprécié au profit d'une nouvelle convention `proxy` (un codemod de migration existe : `npx @next/codemod@canary middleware-to-proxy .`). `middleware.ts` étant le fichier qui porte l'isolation tenant, l'auth et le RBAC (TECHNICAL.md §3), cette migration mérite une revue humaine dédiée plutôt qu'un renommage autonome — d'autant que les 3 CVE qui auraient pu la motiver sont déjà fermées autrement (§6). À faire quand le pilote sera en production à pleine échelle, comme chantier isolé avec sa propre revue.

### Contrainte PTAC dans le VRP

Voir §10 et TECHNICAL.md §7 pour le détail technique. Déclencheur : demande client explicite.

### Copilot planificateur / OCR ticket de pesée en production

Voir TECHNICAL.md §9. Code Next.js et modèle DB déjà en place pour l'OCR ; reste à orchestrer le worker Python (`ai-engine/`) en déploiement (`docker-compose.ai.yml` à créer, runtime NVIDIA à configurer).

---

## 12. Runbook d'incidents

### Redis indisponible

**Symptômes** : VRP en synchrone (plus lent), SSE indisponible/polling, rate limiting non partagé.

```bash
redis-cli -u $REDIS_URL ping       # → PONG si sain
docker compose restart redis
```

### Worker VRP absent

**Symptômes** : `/api/optimize` retourne `mode: "sync"` (200 au lieu de 202).

```bash
docker compose ps worker
docker compose restart worker
```

### PostgreSQL indisponible

**Symptômes** : toutes les routes API retournent 500, health check `status: "outage"`.

```bash
npx prisma migrate status
docker compose restart postgres
```

### Valhalla indisponible

**Symptômes** : VRP fonctionne (repli haversine automatique), qualité de tournée dégradée.

```bash
curl http://localhost:8002/status
docker compose restart valhalla
```

### Forte charge file VRP

**Symptômes** : réponse lente sur `/api/optimize`, métrique `vrp.enqueued` élevée (`GET /api/metrics`).

```bash
docker compose up -d --scale worker=3
```

### Next.js ne démarre pas

Causes fréquentes : `DATABASE_URL` manquant/invalide, client Prisma non généré (`npx prisma generate`), port 3000 occupé.

---

## 13. Opérations courantes

```bash
# Sauvegarder puis migrer
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
npx prisma migrate deploy

# Restaurer
psql $DATABASE_URL < backup_20260101_020000.sql

# Purger les logs d'audit (superadmin uniquement)
curl -X DELETE "https://app.pathelix.fr/api/audit?from=2025-01-01&to=2025-12-31&confirm=true" \
  -H "Cookie: session=<token_superadmin>"

# Invalider le cache de routage Valhalla
redis-cli -u $REDIS_URL --scan --pattern "valhalla:matrix:*" | xargs redis-cli del

# Créer le compte superadmin
SUPERADMIN_EMAIL=admin@pathelix.fr SUPERADMIN_PASSWORD=... npm run db:seed-superadmin

# Maturité ML d'un tenant
GET /api/superadmin/ml-status
→ { tenantId, phase: "mature|intermediate|learning|beginner", observationCount, activeCoefficients }
```

### Monitoring

| Endpoint | Usage | Fréquence recommandée |
|----------|-------|----------------------|
| `GET /api/health` | DB + Redis + queue + circuit breakers | 30s |
| `GET /api/metrics` | Latence P50/P95/P99 | À la demande |
| `GET /api/metrics/prometheus` | Scrape Prometheus | 15s |
| `GET /api/superadmin/system-health` | Vue multi-tenant consolidée | 5 min |

### Alertes recommandées

| Condition | Sévérité | Action |
|-----------|---------|--------|
| `/api/health` ≠ 200 | Critique | Vérifier conteneurs DB et Redis |
| File VRP > 10 jobs en attente | Avertissement | Vérifier conteneur Worker VRP |
| RAM PostgreSQL > 90% | Avertissement | Augmenter `shared_buffers` ou RAM |
| Disque > 85% | Avertissement | Nettoyer logs, archiver photos |
| Temps optimisation VRP > 120s | Avertissement | Vérifier dimensionnement (§8) |
