# Pathélix — Exploitation

Déploiement, configuration, workers, supervision, incidents, sauvegardes, procédure Trackdéchets.
Vérifié contre le code et par déploiement réel des images Docker (octobre 2026).

## 1. Ce qui tourne en production

`docker-compose.yml` décrit l'ensemble, sur un serveur unique :

| Service | Rôle | Critique ? |
|---|---|---|
| `app` | Next.js (UI + API). Applique les migrations au démarrage (`prisma migrate deploy`) | oui |
| `postgres` | Données | oui |
| `redis` | Files BullMQ, cache de matrices, pub/sub temps réel, rate limiting partagé | non — repli en mémoire |
| `valhalla` | Routage poids-lourds (tuiles OSM Rhône-Alpes par défaut) | non — repli haversine |
| `worker` | Optimisations VRP asynchrones | non — repli synchrone (plafonné à 15 s) |
| `worker-pdf` | Feuilles de route et rapport mensuel en PDF | oui pour les PDF (503 sinon) |
| `worker-ml` | Recalcul nocturne des coefficients de durée (03:00, `ML_PROFILE_CRON`) | non |
| `worker-recurring` | Génère les missions des modèles récurrents | oui si modèles utilisés |
| `worker-retention` | Purge quotidienne (02:00) : audit, positions GPS, clés d'idempotence, jobs IA expirés | oui à terme (volumétrie) |

Seuls 80/443 sont exposés, via un reverse proxy (Caddy/Nginx) devant `app`. Postgres, Redis et
Valhalla restent sur le réseau Docker interne. `docker-compose.monitoring.yml` ajoute
Prometheus + Grafana.

Les cinq workers partagent une image (`Dockerfile.worker`) et le même environnement (ancre
`x-worker-env`). Chaque process appelle `validateEnv()` au démarrage et **refuse de démarrer en
production** sans `SESSION_SECRET` (≥ 32 caractères) ni `USE_MOCK_DATA=false`.

## 2. Déployer

```bash
cp .env.example .env            # renseigner au minimum DB_PASSWORD, SESSION_SECRET
docker compose build
docker compose up -d
docker compose ps               # tous "healthy" ; Valhalla met 15–30 min au premier démarrage
npm run db:seed-superadmin      # une fois, avec SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD
```

Mise à jour : `git pull && docker compose build && docker compose up -d` — les migrations
s'appliquent au démarrage de `app`. **Sauvegarder avant** toute mise à jour avec migration (§7).

Gates avant tout déploiement : `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`,
`npm audit --omit=dev --audit-level=critical`.

### Points vérifiés à connaître

- Les secrets ne sont pas nécessaires au **build** de l'image ; ils le sont au démarrage.
- Les en-têtes de sécurité (`next.config.mjs`) sont figés **au build** dans la sortie standalone :
  `FORCE_HTTPS=false` (désactive HSTS) doit être positionné au moment du `docker compose build`,
  pas seulement au runtime. En production, laisser HSTS actif.
- Fichiers déposés (photos, signatures) : `UPLOAD_DIR=/app/uploads`, volume `photo_storage`.
- Redis doit tourner en `maxmemory-policy noeviction` (exigence BullMQ : une politique LRU peut
  évincer des jobs en attente). C'est le réglage du compose ; vérifier toute instance Redis
  externe ou de développement (`redis-cli config get maxmemory-policy`).
- `/api/ready` (sonde de disponibilité) ne dépend que de PostgreSQL : une panne Redis ne retire
  pas l'application du load balancer. `/api/health` donne l'état détaillé.

## 3. Configuration

Référence complète et commentée : `.env.example`. Essentiel :

| Variable | Rôle |
|---|---|
| `DATABASE_URL`, `SESSION_SECRET` | Requis. Secret ≥ 32 caractères, unique par environnement |
| `USE_MOCK_DATA` | `false` en production (mock actif sinon — le code teste `!== 'false'`) |
| `REDIS_URL` | Optionnel ; absent = repli en mémoire (mono-instance uniquement) |
| `VALHALLA_URL`, `VALHALLA_MATRIX_BUDGET_MS` | Routage ; au-delà du budget (20 s), repli haversine |
| `ROUTING_API_TYPE/KEY/URL` | API de routage externe (Trimble, HERE, générique), prioritaire sur Valhalla |
| `RATE_LIMIT_USER_PER_MIN` (600), `RATE_LIMIT_IP_PER_MIN` (300) | Limitation globale : par utilisateur connecté, par IP pour l'anonyme |
| `TRUSTED_PROXY_COUNT` | Proxies de confiance devant l'app (défaut 1) — détermine l'IP client pour le rate limiting |
| `INTEGRATION_ENCRYPTION_KEY`, `TRACKDECHETS_ENCRYPTION_KEY` | AES-256-GCM, 64 caractères hex (`openssl rand -hex 32`) |
| `OUTBOUND_ALLOWED_HOSTS` | Hôtes privés autorisés pour webhooks/ERP sortants (vide = aucun, protection SSRF) |
| `AUDIT_RETENTION_DAYS` (365), `POSITION_RETENTION_DAYS` (30) | Rétention |
| `VRP_CONCURRENCY`, `VRP_USE_THREADS`, `VRP_THREAD_CONCURRENCY` | Parallélisme de l'optimiseur |
| `SSE_MAX_CONNECTIONS_PER_TENANT` | 200 (validé à 150 chauffeurs) |
| `VAPID_*` | Notifications push |
| `SENTRY_DSN`, `METRICS_TOKEN`, `OTEL_ENABLED` | Observabilité |

Les webhooks entrants (Nessy, OBD, Geotab, Samsara) n'utilisent **aucun** secret global : chaque
organisation configure le sien dans Paramètres → Intégrations. `NESSY_WEBHOOK_SECRET` et
`OBD_WEBHOOK_TOKEN` sont ignorés.

## 4. Dimensionnement

| Chauffeurs | RAM min | CPU min |
|---|---|---|
| ≤ 20 | 16 Go | 8 cœurs |
| ≤ 50 | 32 Go | 14 cœurs |
| ≤ 150 | 45 Go | 22 cœurs |
| ≤ 300 | 64 Go | 44 cœurs |
| ≤ 1 000 | 150 Go | 90+ cœurs |

Worker VRP : `secteurs × 400 Mo + 2 Go`. Valhalla : 4–12 Go (France entière). Aucun GPU requis
(le GPU ne sert qu'à l'AI Engine OCR, non orchestré).

**Tests de charge (k6)** — sur une base de test, jamais sur des données réelles :

```bash
npx tsx --tsconfig tsconfig.json load-tests/seed.ts        # organisation « load-test » : 150 chauffeurs, une session chacun
BASE_URL=https://<hôte> bash load-tests/run-all.sh          # positions GPS + écrans exploitants, puis missions
npx tsx --tsconfig tsconfig.json load-tests/seed.ts --clean
```

Chaque utilisateur simulé a sa propre session : l'application limite les requêtes par utilisateur
(600/min), un cookie partagé mesurerait le limiteur. Le seed refuse une base qui n'est pas une
base de test, sauf `LOADTEST_DB=<nom>` explicite, et doit partager le `SESSION_SECRET` de l'instance.

Mesure de référence (7 oct. 2026 — build de production, **un poste de développement**, PostgreSQL
et Redis locaux ; ordre de grandeur, pas un engagement) : 150 chauffeurs envoyant leur position
toutes les 10 s (3 × le rythme réel), chaque envoi écrit en base : p95 15 ms, 0 erreur ; carte
des exploitants p95 114 ms ; historique de vitesse de la flotte p95 128 ms ; liste des missions
p95 64 ms ; création de mission p95 38 ms ; aucune erreur serveur. Une organisation est limitée à
100 écritures de missions par minute (au-delà : 429 ; les chargements en masse passent par
l'import). Non couvert par k6 : les connexions SSE (le client ne tient pas un flux ouvert). À
confirmer sur l'infrastructure réelle : saturation du pool Prisma en charge soutenue, Redis
pub/sub au-delà de 150 connexions SSE.

## 5. Supervision

| Point | Usage |
|---|---|
| `GET /api/ready` | Sonde load balancer / orchestrateur (DB uniquement) |
| `GET /api/health` | DB, Redis, profondeur de file VRP, circuit breakers, Valhalla |
| `GET /api/metrics/prometheus` | Scrape Prometheus (`Authorization: Bearer $METRICS_TOKEN`) |
| `GET /api/superadmin/system-health` | Vue consolidée multi-organisations (superadmin) |

Alertes recommandées : `/api/ready` ≠ 200 (critique) ; file VRP > 10 jobs (worker absent ou sous-
dimensionné) ; disque > 85 % (photos, WAL) ; optimisation > 120 s.

## 6. Incidents

| Symptôme | Cause probable | Action |
|---|---|---|
| Toutes les API en 500, `/api/ready` 503 | PostgreSQL | `docker compose logs postgres`, `docker compose restart postgres` |
| `/api/optimize` répond `mode: "sync"` | Redis ou worker VRP absent | `docker compose ps worker redis` ; relancer |
| Optimisations lentes, qualité de tournée en baisse, `routingSource: haversine` | Valhalla indisponible (le circuit breaker coupe après échecs répétés) | `curl http://valhalla:8002/status`, relancer `valhalla` |
| PDF « Service de génération PDF indisponible » | `worker-pdf` arrêté | `docker compose restart worker-pdf` |
| Scan de ticket « Service OCR indisponible » | Redis absent, file OCR pleine (200) ou AI Engine non déployé | Vérifier Redis ; l'AI Engine n'est pas orchestré par défaut |
| Missions récurrentes absentes | `worker-recurring` arrêté | relancer ; il rattrape au démarrage |
| Forte charge VRP | — | `docker compose up -d --scale worker=3` |
| Matrices de distance suspectes après changement de réseau routier | Cache Redis 24 h | `redis-cli --scan --pattern 'valhalla:matrix:*' \| xargs redis-cli del` |

Un mot de passe réinitialisé, un changement de rôle ou une suppression d'utilisateur révoque ses
sessions immédiatement sur l'instance qui traite la requête, sous 30 s ailleurs. Une clé API
révoquée : idem.

## 7. Sauvegardes

**Base de données** — `scripts/backup-pg.sh`, en cron quotidien :

```bash
0 2 * * * /opt/pathelix/scripts/backup-pg.sh >> /var/log/pathelix-backup.log 2>&1
```

Produit `pathelix_AAAA-MM-JJ_HHMM.dump` (format `pg_dump` compressé) dans `BACKUP_DIR`
(défaut `/var/backups/pathelix`), conserve `BACKUP_KEEP` jours (défaut 7). Le fichier ne prend son
nom qu'une fois le dump terminé et relu : un dump interrompu ne laisse rien qui ressemble à une
sauvegarde, et le script sort en erreur (à surveiller dans le journal du cron). Les outils
PostgreSQL sont pris sur l'hôte s'ils y sont, sinon dans le conteneur `postgres` du compose —
rien à installer sur un déploiement Docker. La base visée est `DATABASE_URL` ; une valeur exportée
l'emporte sur `.env`. **Copier les sauvegardes hors du serveur** (le script ne le fait pas).

**Restauration** — arrêter l'application et les workers, puis :

```bash
docker compose stop app worker worker-pdf worker-ml worker-recurring worker-retention worker-business
./scripts/restore-pg.sh /var/backups/pathelix/pathelix_2026-10-07_0200.dump   # demande le nom de la base
npx prisma migrate deploy        # si la sauvegarde est plus ancienne que le code
docker compose start app worker worker-pdf worker-ml worker-recurring worker-retention worker-business
```

La sauvegarde est chargée dans une base neuve, en une transaction ; la base en service n'est
renommée (`<base>_avant_<date>`, conservée) qu'une fois ce chargement réussi, et la base restaurée
prend son nom. Un fichier tronqué ou un chargement en échec ne modifie rien. Pour annuler :
renommer les deux bases dans l'autre sens ; supprimer `<base>_avant_<date>` une fois la
restauration validée. Le compte PostgreSQL doit pouvoir créer et renommer des bases (c'est le cas
du compte du compose ; sur une base managée, utiliser la restauration du fournisseur).

Procédure vérifiée sur une base réelle (64 tables, index, contraintes et historique des migrations
identiques après restauration ; base endommagée remplacée et conservée de côté ; refus d'un fichier
tronqué). **À rejouer sur votre infrastructure avant la mise en service**, puis périodiquement :
une sauvegarde jamais restaurée n'en est pas une.

**Fichiers** (photos, signatures, bons, PDF de factures) — ils ne sont pas dans la base :
`STORAGE_DRIVER=local` → sauvegarder le volume `photo_storage` (`UPLOAD_DIR`) en même temps que la
base ; `STORAGE_DRIVER=s3` → activer le versionnement et la réplication du bucket.

Toujours faire une sauvegarde avant une mise à jour comportant une migration.

Données personnelles : positions GPS purgées après `POSITION_RETENTION_DAYS`, journal d'audit après
`AUDIT_RETENTION_DAYS`.

## 8. Trackdéchets — HALT

**Aucun appel à l'API de production Trackdéchets** tant que la procédure ci-dessous n'est pas
validée par un humain. Le blocage est dans le code : une URL de production sans
`TRACKDECHETS_HALT_LIFTED=true` lève `TdHaltError`. Par défaut, `TRACKDECHETS_API_URL` pointe le
sandbox.

Procédure sur `sandbox.trackdechets.beta.gouv.fr` (compte test, token personnel, deux SIRET fictifs) :

1. `POST /api/trackdechets/accounts { token }` → 200.
2. `POST /api/bsds` → 201, BSD `DRAFT`, visible dans l'interface sandbox.
3. Signature sans `wasteDetails.name`/`quantity` → 422 listant les champs, **aucun** appel TD.
4. Champs complétés, `POST /api/bsds/[id]/sign { signatureType: "PRODUCER" }` → 200, `SIGNED_BY_PRODUCER`.
5. SIRET valide non inscrit sur TD → création 201, signature 502 ; la mission Pathélix n'est pas bloquée.
6. Webhook signé HMAC → 200, statut mis à jour en base.

Levée du HALT : ces 6 étapes validées, établissements réels inscrits, Sentry actif, puis
`TRACKDECHETS_API_URL` de production **et** `TRACKDECHETS_HALT_LIFTED=true`.

## 9. Chantiers connus

- **Next.js 16** (`middleware` → `proxy`) : compile et passe les tests sur une branche dédiée ;
  différé car `middleware.ts` porte l'auth et l'isolation — à faire avec une revue dédiée.
  `next lint` est déprécié (migration : `npx @next/codemod@canary next-lint-to-eslint-cli .`).
- **AI Engine OCR** (`ai-engine/`, Python, GPU) : code en place, pas de service de déploiement.
- **PTAC** : l'optimiseur contraint le volume des bennes, pas le poids total transporté.
- **Dépendances** : `npm audit --omit=dev` signale une chaîne modérée via `swagger-ui-react`
  (`remarkable`/`argparse`/`sprintf-js`, déni de service sur du markdown) ; elle ne traite que
  notre propre spécification OpenAPI. Seule « correction » proposée : revenir à la v3 — refusé.
- **Multi-instance** : possible **avec Redis** — limites de débit, verrouillage de compte,
  alertes d'incident, invalidation des caches (sessions, permissions, clés API, suspension,
  drapeaux, intégrations, webhooks, métiers personnalisés) et positions GPS sont partagés entre
  instances. Restent par process : le plafond de 200 connexions SSE par organisation (donc
  200 × instances) et les métriques Prometheus (à collecter sur chaque instance). Sans Redis,
  tout est en mémoire : un seul serveur.

## 10. Développement local

```bash
npm install && npx prisma generate
cp .env.example .env        # DATABASE_URL, SESSION_SECRET, USE_MOCK_DATA=false pour une vraie base
npx prisma migrate dev && npm run db:seed
npm run dev                 # :3000
npm run worker              # + worker:pdf, worker:ml, worker:recurring, worker:retention au besoin
```

`npm run worker:ml -- --once` lance un recalcul ML ponctuel. Pour un test manuel, utiliser une
base dédiée et `scripts/db-guard.sh` (refuse d'écrire si la base ne porte pas le marqueur
sandbox). Les tests E2E (`npx playwright test`) sont fiables contre un build de production
(`next build && next start`) : en mode dev, le serveur grossit en mémoire au fil d'un long run.
