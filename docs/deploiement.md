# Pathélix — Déploiement

> Build, déploiement, runbook d'incidents, dimensionnement, HALT Trackdéchets. Vérifié contre
> le code réel le 2026-09-21.

## 1. Build de production

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

### État de l'audit de sécurité des dépendances (2026-09-21)

`npm audit --production` a trouvé **14 vulnérabilités dont 1 critique** (RCE non authentifiée
Next.js sur serveurs Windows, GHSA-p293-qw3h-jr36 — directement applicable, cet environnement
de développement est Windows). `npm audit fix` (sans `--force`, aucun changement breaking) a
tout corrigé sauf 10 résiduelles :

| Paquet | Sévérité | Pourquoi non corrigé |
|--------|----------|----------------------|
| `deepmerge-ts` / `mysql2` | haute | Dépendances transitives de l'outillage CLI `prisma` (`@prisma/config`). `--force` installerait `prisma@6.19.3`, un **downgrade** depuis Prisma 7. `mysql2` n'est même pas utilisé (app 100% PostgreSQL). |
| `uuid` (via `exceljs`) | modérée | `--force` downgrade `exceljs` 4→3 (breaking, perte de fonctionnalités d'export). La faille exige qu'un buffer soit explicitement passé à `uuid`, jamais le cas dans ce codebase. |
| `@vitest/mocker` / `esbuild` (via `vitest`) | modérée/haute | Dev-only (jamais dans le build de production). `--force` bump `vitest@5`, breaking change de l'outillage de test. L'esbuild finding exige en plus que le **serveur de dev Vite** tourne, ce que ce projet n'utilise jamais (Next.js a son propre serveur de dev). |

Détail complet, raisonnement et prochaines étapes : `AUDIT_LOG.md` à la racine.

## 2. Déploiement

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
TRACKDECHETS_API_URL=https://sandbox.trackdechets.beta.gouv.fr/   # HALT actif — voir §5
```

Seuls les ports 80/443 sont exposés sur Internet (reverse proxy Caddy/Nginx → Next.js).
PostgreSQL (5432), Redis (6379), Valhalla (8002) restent sur le bridge Docker interne
uniquement.

### Mise à jour de l'application

```bash
git pull
npm install
npx prisma migrate deploy    # si changement de schéma
npm run build
pm2 restart pathelix         # ou: docker compose restart app
```

## 3. Dimensionnement serveur

Architecture mono-serveur cloud dédié — voir [architecture.md](architecture.md) §2.

| Chauffeurs | RAM totale min | CPU min |
|-----------|---------------|---------|
| ≤ 20 | 16 Go | 8 cœurs |
| ≤ 50 | 32 Go | 14 cœurs |
| ≤ 150 | 45 Go | 22 cœurs |
| ≤ 300 | 64 Go | 44 cœurs |
| ≤ 500 | 100 Go | 68 cœurs |
| ≤ 1 000 | 150 Go | 90+ cœurs |

RAM Worker VRP : `secteurs × 400 Mo + 2 Go`. `VRP_THREAD_CONCURRENCY = cœurs totaux − 4`.
Valhalla : 4–12 Go au démarrage (France complète OSM), 15–30 min de premier démarrage. Le
système ML (statistique, Node.js) ne requiert **aucun GPU** — un GPU ne devient nécessaire que
si l'AI Engine OCR est orchestré en production (voir [fonctionnalites.md](fonctionnalites.md)).

### Dimensionnement validé à 150 chauffeurs (juin 2026)

- `SSE_MAX_CONNECTIONS_PER_TENANT` relevé de 50 (bloquant dès le 51e chauffeur connecté) à 200
- `GET/POST /api/driver-position` : cache des IDs chauffeurs par tenant (TTL 60s)

Points à confirmer sur infrastructure de production réelle : latences absolues, saturation du
pool Prisma à charge soutenue, comportement Redis Pub/Sub SSE à 150+ connexions simultanées.
Scripts de charge : `load-tests/scenarios/` (k6), lancés via `bash load-tests/run-all.sh`.

## 4. Chantiers différés identifiés

### Migration Next.js 16

Évaluée et **volontairement différée**, pas bloquée par un problème technique non résolu.
`tsc --noEmit`, la suite de tests et `next build` passent tous sous Next 16 (branche
`next-16-major-bump`, non mergée). Le seul point d'attention : `next build` marque
`src/middleware.ts` comme déprécié au profit d'une nouvelle convention `proxy` (codemod
existant : `npx @next/codemod@canary middleware-to-proxy .`). `middleware.ts` portant
l'isolation tenant, l'auth et le RBAC, cette migration mérite une revue humaine dédiée plutôt
qu'un renommage autonome — d'autant que les CVE qui auraient pu la motiver sont déjà fermées
par ailleurs (patch npm audit du 2026-09-21, §1). À faire quand le pilote sera en production à
pleine échelle, comme chantier isolé.

### Migration ESLint (next lint déprécié)

`next lint` affiche un avertissement de dépréciation (retrait Next 16). Migration :
`npx @next/codemod@canary next-lint-to-eslint-cli .`. Sans urgence (0 impact fonctionnel), à
faire avant ou pendant la migration Next 16 ci-dessus.

### Contrainte PTAC dans le VRP

Le VRP ne vérifie pas la somme des poids livrés sur une tournée contre le PTAC du véhicule
(seul `binSizeM3` est contraint). Déclencheur : demande client explicite avec flotte mixte ou
densités variables.

### Copilot planificateur / OCR ticket de pesée en production

Code Next.js et modèle DB déjà en place pour l'OCR ; reste à orchestrer le worker Python
(`ai-engine/`) en déploiement (`docker-compose.ai.yml` à créer, runtime NVIDIA à configurer).

### Génération PDF cassée en production

`@react-pdf/renderer` charge sa propre instance React sous le bundler serveur Next.js (dual
package hazard), causant une erreur React #31 sur tout appel à `/api/tours/pdf` et
probablement `/api/reports/pdf`. Nécessite de déplacer le rendu PDF hors du process serveur
Next (worker dédié type `vrpWorker.ts`) ou de changer de bibliothèque. Voir
[tests.md](tests.md) §6.

## 5. HALT Trackdéchets

**HALT ACTIF.** Aucun appel API Trackdéchets en production sans validation manuelle préalable
de la checklist ci-dessous.

```env
# Sandbox (défaut — HALT actif)
TRACKDECHETS_API_URL=https://sandbox.trackdechets.beta.gouv.fr/
# Production (lever le HALT uniquement après validation complète)
TRACKDECHETS_API_URL=https://api.trackdechets.beta.gouv.fr/
```

### Sécurité du token (déjà vérifiée en code)

Token stocké chiffré AES-256-GCM (`TrackdechetsAccount.encryptedToken`), déchiffré en mémoire
uniquement, jamais loggué, jamais renvoyé par une route. Signature webhook HMAC-SHA256
(`TRACKDECHETS_WEBHOOK_SECRET`).

### Procédure de validation manuelle avant de lever le HALT

**Prérequis** : compte test sur `sandbox.trackdechets.beta.gouv.fr`, token API personnel, deux
établissements SIRET fictifs (émetteur + destinataire).

1. **Configurer le compte** : `POST /api/trackdechets/accounts { token }` → `200 { ok: true,
   accountId }`
2. **Créer un BSD** : `POST /api/bsds { emitter, recipient, wasteDetails }` → `201 { bsdId,
   tdId, status: "DRAFT" }`. Vérifier son apparition dans l'UI sandbox TD.
3. **Test champ manquant** : signer un BSD sans `wasteDetails.name`/`quantity` → `422` avec
   liste de champs manquants, **aucun appel TD effectué**, BSD toujours `DRAFT` en DB.
4. **Signer producteur** : compléter les champs requis, `POST /api/bsds/[id]/sign
   { signatureType: "PRODUCER" }` → `200`, statut passé à `SIGNED_BY_PRODUCER`.
5. **Acteur non inscrit** : SIRET syntaxiquement valide mais non enregistré sur TD → création
   `201` (DRAFT), signature → `502 { error: ... }` — la mission Pathélix n'est **pas** bloquée.
6. **Webhook statut** : simuler un webhook signé HMAC → `200 { ok: true }`, vérifier que
   `bsd.status` change en DB.

### Critère de levée du HALT

Validation humaine des 6 étapes ci-dessus sur le sandbox réel, **plus** confirmation que
`TRACKDECHETS_API_URL` pointe vers la prod, que les établissements réels sont inscrits, et que
le log d'audit (Sentry) est actif.

## 6. Runbook d'incidents

### Redis indisponible

Symptômes : VRP en synchrone (plus lent), SSE indisponible/polling, rate limiting non partagé.

```bash
redis-cli -u $REDIS_URL ping       # → PONG si sain
docker compose restart redis
```

### Worker VRP absent

Symptômes : `/api/optimize` retourne `mode: "sync"` (200 au lieu de 202).

```bash
docker compose ps worker
docker compose restart worker
```

### PostgreSQL indisponible

Symptômes : toutes les routes API retournent 500, health check `status: "outage"`.

```bash
npx prisma migrate status
docker compose restart postgres
```

### Valhalla indisponible

Symptômes : VRP fonctionne (repli haversine automatique), qualité de tournée dégradée.

```bash
curl http://localhost:8002/status
docker compose restart valhalla
```

### Forte charge file VRP

Symptômes : réponse lente sur `/api/optimize`, métrique `vrp.enqueued` élevée.

```bash
docker compose up -d --scale worker=3
```

## 7. Opérations courantes

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
| Temps optimisation VRP > 120s | Avertissement | Vérifier dimensionnement (§3) |
