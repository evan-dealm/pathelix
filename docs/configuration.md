# Pathélix — Configuration

> Toutes les variables d'environnement utilisées par l'application. Aucune vraie valeur ici —
> exemples fictifs uniquement. Fichier à jour : `.env.example` à la racine.
> Vérifié contre le code réel le 2026-09-21.

## Requises

| Variable | Rôle | Exemple |
|----------|------|---------|
| `DATABASE_URL` | Connexion PostgreSQL | `postgresql://pathelix:change-me@localhost:5432/pathelix_fleet` |
| `SESSION_SECRET` | Clé de signature JWT HMAC-SHA256, ≥ 32 caractères | `change-me-min-32-chars-random-string-here` |

## Mode application

| Variable | Défaut | Rôle |
|----------|--------|------|
| `USE_MOCK_DATA` | absent = mock ON | `false` pour activer la vraie DB. **Convention impérative** : le code teste `!== 'false'`, jamais `=== 'true'` — toute nouvelle route doit suivre ce pattern. |
| `FORCE_HTTPS` | `true` | `false` pour désactiver l'en-tête HSTS (dev local uniquement) |
| `NODE_ENV` | — | `production` en prod |

## Base de données

| Variable | Défaut | Rôle |
|----------|--------|------|
| `DB_POOL_SIZE` | 10–20 selon script | Connexions PostgreSQL par processus |

## Redis

| Variable | Défaut | Rôle |
|----------|--------|------|
| `REDIS_URL` | absent = fallback in-memory | URL complète (prioritaire sur host/port) |
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `6379` | Utilisés si `REDIS_URL` absent |
| `REDIS_USERNAME` / `REDIS_PASSWORD` | — | Authentification |
| `REDIS_DB` | `0` | Numéro de base logique |
| `REDIS_TLS` | `false` | TLS |
| `REDIS_DISABLED` | `false` | `true` pour forcer le fallback in-memory même si Redis est joignable |

## Auth / comptes

| Variable | Rôle |
|----------|------|
| `ADMIN_PASSWORD` | Mot de passe admin de seed |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | Pour `npm run db:seed-superadmin` |
| `NEXTAUTH_URL` | Base URL pour les redirections auth (défaut `http://localhost:3000`) |

## Routage

| Variable | Rôle |
|----------|------|
| `VALHALLA_URL` | Instance Valhalla principale |
| `VALHALLA_FALLBACK_URL` | Instance de secours |
| `VALHALLA_TIMEOUT_MS` | Défaut 5000 |
| `VALHALLA_TRAFFIC_TAR_PATH` | Fichier trafic temps réel (optionnel) |
| `OSRM_URL`, `OSRM_TIMEOUT_MS`, `OSRM_MAX_TABLE_SIZE` | Repli routage |
| `ROUTING_API_TYPE` | `trimble` \| `here` \| `generic` (vide = Valhalla seul) |
| `ROUTING_API_KEY`, `ROUTING_API_URL`, `ROUTING_VEHICLE`, `ROUTING_API_TIMEOUT_MS`, `ROUTING_API_MAX_CHUNK` | Config API externe |
| `TRIMBLE_API_URL`, `TRIMBLE_API_KEY` | Trimble Maps spécifique |
| `URBAN_CENTERS_JSON` | Override des centres urbains (bonus trafic VRP), défaut 5 villes Rhône-Alpes codées en dur |
| `DATEX_II_URL` | Données trafic temps réel (optionnel) |

## VRP Worker

| Variable | Défaut | Rôle |
|----------|--------|------|
| `VRP_CONCURRENCY` | 1–2 | Jobs simultanés par worker |
| `VRP_USE_THREADS` | `false` | `true` pour activer les Worker Threads parallèles |
| `VRP_THREAD_CONCURRENCY` | cœurs CPU − 4 | Threads parallèles |
| `VRP_THREAD_TIMEOUT_MS` | 30000 | Timeout par thread |

## Secrets et chiffrement

| Variable | Rôle |
|----------|------|
| `AI_CALLBACK_SECRET` | HMAC callback AI Engine, ≥ 32 chars |
| `TRACKDECHETS_API_URL` | **Toujours l'URL sandbox par défaut** (`https://sandbox.trackdechets.beta.gouv.fr/`) — HALT actif, voir [deploiement.md](deploiement.md) §9. Ne jamais mettre l'URL de production ici sans validation manuelle complète. |
| `TRACKDECHETS_ENCRYPTION_KEY` | AES-256-GCM, 64 hex chars — `openssl rand -hex 32` |
| `TRACKDECHETS_WEBHOOK_SECRET` | HMAC webhook Trackdéchets entrant |
| `INTEGRATION_ENCRYPTION_KEY` | AES-256-GCM pour `Integration.config` (Nessy/OBD/Geotab/Samsara), 64 hex chars |

Les webhooks Nessy/OBD n'utilisent **plus** de secret global côté environnement — chaque
tenant configure son propre secret via `/api/integrations`. `NESSY_WEBHOOK_SECRET` et
`OBD_WEBHOOK_TOKEN` (présents dans `.env.example` pour compatibilité) ne sont plus lus pour
l'authentification — voir [authentification-securite.md](authentification-securite.md).

## Push notifications

| Variable | Rôle |
|----------|------|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` | WebPush |

## IA / LLM

| Variable | Défaut | Rôle |
|----------|--------|------|
| `OLLAMA_URL` | `http://localhost:11434` | LLM local pour saisie mission en langage naturel |
| `OLLAMA_MODEL` | `llama3` | Modèle Ollama |
| `AI_ENGINE_URL` | — | URL de l'AI Engine Python OCR (non orchestré en prod actuellement) |
| `NEXT_PUBLIC_AI_ENGINE_URL` | — | Accès client-side (optionnel) |

## Observabilité

| Variable | Rôle |
|----------|------|
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | Error tracking + source maps |
| `METRICS_TOKEN` | Bearer token pour `/api/metrics/prometheus` (sinon session JWT requise) |
| `OTEL_ENABLED` | `false` par défaut — `true` pour activer l'export OpenTelemetry |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Défaut `http://localhost:4318` |
| `DEBUG_LOGS` | `false` — logs verbeux en production |

## Load shedding & temps réel

| Variable | Défaut | Rôle |
|----------|--------|------|
| `LOAD_MAX_CONCURRENT` | 100 | Requêtes concurrentes avant délestage |
| `LOAD_NORMAL_THRESHOLD` | 50 | Seuil de début de throttling |
| `LOAD_THROTTLE_MS` | 500 | Délai de throttle sous charge |
| `SSE_MAX_CONNECTIONS_PER_TENANT` | 200 en usage réel (`.env.example` documente 50 comme valeur de départ historique — voir note ci-dessous) | Connexions SSE simultanées par tenant |

> **Note** : la valeur par défaut codée dans `.env.example` (50) est la valeur d'origine ;
> elle a été relevée à 200 en usage réel lors du dimensionnement à 150 chauffeurs (voir
> [deploiement.md](deploiement.md) §8) pour éviter un blocage dès le 51e chauffeur connecté —
> mettre `SSE_MAX_CONNECTIONS_PER_TENANT=200` explicitement en production.

## Autres

| Variable | Défaut | Rôle |
|----------|--------|------|
| `GRAFANA_ADMIN_PASSWORD` | `pathelix_admin` (à changer en prod) | Monitoring Grafana |
| `AUDIT_RETENTION_DAYS` | **365** si absente (`src/workers/auditRetentionWorker.ts:11`) | Rétention `AuditLog`, purgée par le CRON quotidien (02:00 UTC). Plusieurs documents antérieurs de ce projet (dont `CLAUDE.md`) mentionnent 90 jours — c'est obsolète, corrigé ici après vérification directe du code. |
