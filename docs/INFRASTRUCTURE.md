# Infrastructure — Pathélix

> Architecture de déploiement, dimensionnement, exploitation et runbook d'incidents.

---

## Table des matières

1. [Vue d'ensemble de l'architecture](#1-vue-densemble-de-larchitecture)
2. [Dimensionnement des composants](#2-dimensionnement-des-composants)
3. [Exemples de dimensionnement](#3-exemples-de-dimensionnement)
4. [Réseau & latence](#4-réseau--latence)
5. [Stockage](#5-stockage)
6. [Sécurité](#6-sécurité)
7. [Disponibilité & sauvegardes](#7-disponibilité--sauvegardes)
8. [Monitoring](#8-monitoring)
9. [Ordre de démarrage](#9-ordre-de-démarrage)
10. [Runbook d'incidents](#10-runbook-dincidents)
11. [Opérations courantes](#11-opérations-courantes)

---

## 1. Vue d'ensemble de l'architecture

Pathélix fonctionne sur un **serveur cloud dédié unique**. Tous les services communiquent via un réseau bridge Docker interne — aucun tunnel VPN, aucune dépendance à une machine physique.

```
Internet (HTTPS)
      │
      ▼
┌────────────────────────────────────────────────────────────┐
│  SERVEUR CLOUD DÉDIÉ                                       │
│                                                            │
│  ┌───────────┐  ┌────────────┐  ┌───────┐                 │
│  │  Next.js  │  │ PostgreSQL │  │ Redis │                 │
│  └─────┬─────┘  └─────┬──────┘  └───┬───┘                 │
│        │               │             │                     │
│        └───────────────┴─────────────┘                     │
│                        │ Réseau bridge Docker              │
│        ┌───────────────┼─────────────┐                     │
│        │               │             │                     │
│  ┌─────▼─────┐  ┌──────▼─────┐  ┌───▼────────┐           │
│  │  Valhalla │  │ Worker VRP │  │ AI Engine  │           │
│  │ (OSM RAM) │  │ (opt ALNS) │  │ (OCR, GPU) │           │
│  └───────────┘  └────────────┘  └────────────┘           │
│                                                            │
│  Seuls les ports 80/443 sont exposés sur Internet          │
└────────────────────────────────────────────────────────────┘
```

### Flux de données

1. Les utilisateurs se connectent en HTTPS via le reverse proxy (Caddy/Nginx)
2. Déclenchement d'une optimisation → Next.js enfile un job BullMQ dans Redis
3. Le Worker VRP interroge Redis (bridge Docker, sous la milliseconde), récupère le job
4. Le Worker appelle Valhalla pour les distances PL réelles (bridge Docker)
5. Le Worker écrit le résultat dans Redis → Next.js le retourne à l'utilisateur via SSE

### Ports exposés

| Port | Service | Exposé sur Internet ? |
|------|---------|----------------------|
| 80 / 443 | Application web (reverse proxy) | Oui (HTTPS uniquement) |
| 5432 | PostgreSQL | Non (bridge Docker uniquement) |
| 6379 | Redis | Non (bridge Docker uniquement) |
| 8002 | Valhalla | Non (bridge Docker uniquement) |

---

## 2. Dimensionnement des composants

Cette section est la référence principale pour la planification de capacité. Faites correspondre votre nombre de chauffeurs aux besoins en RAM, CPU, stockage et GPU **avant** de provisionner un serveur.

### Application Next.js

| Métrique | Valeur |
|----------|--------|
| RAM | 512 Mo + 50 Mo × connexions SSE simultanées |
| CPU | 1–2 cœurs |
| Connexions SSE max | 50 par tenant (`SSE_MAX_CONNECTIONS_PER_TENANT`) |

### PostgreSQL

| Métrique | Valeur |
|----------|--------|
| RAM | `shared_buffers` = 25 % de la RAM disponible, min 512 Mo |
| `work_mem` | 32–64 Mo |
| Stockage | ~500 Mo par tenant par an (missions, plans, métriques ML, audit) |
| Pool de connexions | 20 connexions (défaut Prisma, `DB_POOL_SIZE`) |

### Redis

| Métrique | Valeur |
|----------|--------|
| RAM | ~50 Mo par tenant actif + cache de routage (~200 Mo pour 5 tenants) |
| Politique | `allkeys-lru`, max 512 Mo–2 Go |

### Valhalla (routage PL principal)

| Métrique | Valeur |
|----------|--------|
| RAM au démarrage | **4–12 Go** (France, tuiles OSM complètes) |
| Premier démarrage | 15–30 min (construction des tuiles depuis `france-latest.osm.pbf`) |
| CPU | 2–4 cœurs |
| Découpage matrice | Auto si > 80 points (max 4 requêtes parallèles) |

### OSRM (repli routage PL)

| Métrique | Valeur |
|----------|--------|
| RAM au démarrage | **6 Go** (Rhône-Alpes, chargé intégralement via algorithme MLD) |
| Profil | Statique (`truck.lua`, 26t, hauteur 4m, largeur 2,55m) |
| `--max-table-size` | 1 000 points par requête Table API |

### Worker VRP — table de décomposition en secteurs

Le moteur VRP découpe les grandes flottes en secteurs parallèles. Chaque secteur nécessite ~400 Mo de RAM et un thread CPU dédié. Utilisez cette table pour dimensionner le serveur avant le déploiement.

| Chauffeurs | Taille de secteur cible | Secteurs | **RAM Worker** | **Threads CPU** |
|-----------|------------------------|---------|----------------|-----------------|
| ≤ 20 | Pas de décomposition | 1 | **2 Go** | **1** |
| ≤ 50 | 15 | 3–4 | **3 Go** | **4** |
| ≤ 150 | 12 | 8–13 | **7 Go** | **10** |
| ≤ 300 | 8 | 25–38 | **17 Go** | **28** |
| ≤ 600 | 6 | 50–100 | **42 Go** | **48** |
| ≤ 1 000 | 5 | 120–200 | **82 Go** | **64+** |

Formule : `RAM Worker = secteurs × 400 Mo + 2 Go overhead` | `VRP_THREAD_CONCURRENCY = cœurs totaux − 4`

Temps de calcul : ~1s par 100 missions, borné entre [15s, 120s].

### AI Engine (OCR)

| Composant | VRAM GPU | RAM CPU | Latence |
|-----------|----------|---------|---------|
| Donut OCR | ~3 Go | 2 Go | 2–5s par ticket |
| Llama 3 8B Q4 (Ollama, futur) | ~6 Go | 4 Go | 5–15s par requête |
| Les deux chargés | ~9 Go | 6 Go | Le Model Manager sérialise l'usage VRAM |

**Exigence GPU : 12 Go VRAM minimum.** Sans GPU, les modules IA sont désactivés — toutes les autres fonctionnalités restent opérationnelles.

---

## 3. Exemples de dimensionnement

### Petite : 1 entreprise / 20 chauffeurs / 200 missions/jour

| Service | RAM | CPU |
|---------|-----|-----|
| Next.js + PostgreSQL + Redis | 4 Go | 2 cœurs |
| Valhalla | 6 Go | 2 cœurs |
| Worker VRP | 2 Go | 2 cœurs |
| Overhead système | 4 Go | 2 cœurs |
| **Total** | **16 Go** | **8 cœurs** |

Adapté à un serveur cloud d'entrée de gamme (ex. VPS 16 Go / 8 cœurs). Aucun GPU requis.

---

### Moyenne : 5 entreprises / 500 chauffeurs / 10 000 missions/jour

| Service | RAM | CPU | Stockage |
|---------|-----|-----|---------|
| Next.js | 3 Go | 2 cœurs | — |
| PostgreSQL | 8 Go | 4 cœurs | 50 Go SSD |
| Redis | 2 Go | 1 cœur | — |
| Valhalla | 8 Go | 8 cœurs | 4 Go |
| Worker VRP | 18 Go | 28 cœurs | — |
| AI Engine + Ollama | 8 Go | 2 cœurs | 10 Go modèles |
| Overhead système | 17 Go | 3 cœurs | — |
| **Total** | **64 Go** | **48 cœurs** | **100 Go NVMe** |

GPU : 12 Go VRAM (optionnel — modules IA désactivés sans GPU).

---

### Grande : 20 entreprises / 2 000 chauffeurs / 50 000 missions/jour

| Service | RAM | CPU |
|---------|-----|-----|
| Next.js | 4 Go | 4 cœurs |
| PostgreSQL | 16 Go | 8 cœurs |
| Redis | 4 Go | 2 cœurs |
| Valhalla | 16 Go | 8 cœurs |
| Worker VRP | 42 Go | 48 cœurs |
| AI Engine | 10 Go | 2 cœurs + GPU 12 Go |
| Overhead système | 36 Go | 8 cœurs |
| **Total** | **128 Go** | **80 cœurs + GPU** |

L'optimisation VRP séquentielle sur 20 tenants prend environ 5 à 8 minutes au total.

---

## 4. Réseau & latence

Toutes les communications inter-services passent par le bridge Docker. La latence entre services est inférieure à la milliseconde — pas de surcoût VPN, pas d'aller-retour Internet.

```
Navigateur ──HTTPS──▶ Reverse proxy ──▶ Next.js
                                           │
                                 Bridge Docker (< 1 ms)
                                           │
                           ┌───────────────┼──────────────┐
                           ▼               ▼              ▼
                        Redis         PostgreSQL       Valhalla
                           ▲
                           │
                        Worker VRP
```

### Bande passante requise (externe uniquement)

| Direction | Débit de pointe | Cas d'usage |
|-----------|----------------|-------------|
| Client → Serveur | ~100 Ko/s par utilisateur | HTTPS, flux SSE |
| Serveur → Stockage | ~500 Ko/s | Upload sauvegarde nocturne (S3) |
| Serveur → Geofabrik | ~500 Mo/mois | Rafraîchissement mensuel des tuiles OSM |

Une liaison datacenter standard à 1 Gbps est plus que suffisante.

---

## 5. Stockage

| Données | Taille / tenant / an |
|---------|---------------------|
| Base de données | ~500 Mo |
| Photos terrain | ~2 Go (5 Ko/photo × 1 000/jour × 365) |
| Tickets OCR | ~500 Mo |
| Logs applicatifs | ~1 Go (rotation 30 jours) |
| Tuiles Valhalla | 3–4 Go (fixe, partagé entre tous les tenants) |
| Modèles IA | 10 Go (fixe, partagé entre tous les tenants) |
| **5 tenants / an** | **~25 Go** (hors tuiles Valhalla et modèles) |

Stockage NVMe recommandé pour le chargement des tuiles Valhalla et les écritures intensives PostgreSQL.

---

## 6. Sécurité

| Couche | Mesure |
|--------|--------|
| Transport | HTTPS obligatoire — certificat TLS automatique via reverse proxy |
| Authentification | JWT HMAC-SHA256, cookies `HttpOnly` / `Secure` / `SameSite=Strict` |
| Base de données | Jamais exposée sur Internet — bridge Docker uniquement |
| Redis | Mot de passe requis, bridge Docker uniquement |
| Clés API | Hash SHA-256 stocké (jamais en clair), scopes granulaires |
| Webhooks | Signature HMAC-SHA256 vérifiée sur chaque payload entrant |
| SSH | Clés uniquement, connexion root désactivée |
| Pare-feu | Ports 80/443 uniquement — tous les autres ports fermés sur Internet |

---

## 7. Disponibilité & sauvegardes

### Sauvegardes PostgreSQL

| Paramètre | Valeur |
|-----------|--------|
| Fréquence | Nuit à 02:00 |
| Rétention | 30 jours |
| Méthode | `pg_dump` compressé (gzip) |
| Destination | Bucket S3-compatible distant ou serveur secondaire |
| Test de restauration | Mensuel |

Objectifs SLO : RPO < 1h (archivage WAL vers S3), RTO < 4h (`pg_basebackup` quotidien).

### Jobs CRON

| Job | Planification | Commande |
|-----|--------------|---------|
| Sauvegarde PostgreSQL | 02:00 | `pg_dump + gzip + upload` |
| Coefficients ML | 02:30 | `tsx src/workers/mlProfileWorker.ts` |
| Nettoyage logs | 03:00 | Rotation, suppression des entrées > 30 jours |
| Mise à jour tuiles Valhalla | Mensuel | Re-téléchargement Geofabrik + retraitement |

### Mode dégradé

| Panne | Impact | Comportement |
|-------|--------|-------------|
| Redis hors service | Cache de routage perdu, pas de BullMQ asynchrone | VRP synchrone dans Next.js, SSE interroge toutes les 2s |
| Valhalla/OSRM hors service | Pas de distances PL réelles | Repli haversine géométrique |
| Worker VRP hors service | Pas d'optimisation asynchrone | VRP synchrone dans Next.js (plus lent, même résultat) |
| PostgreSQL hors service | Toutes les API retournent 500 | `status: "outage"`, reprise automatique au redémarrage |
| GPU hors service | Pas d'OCR / Copilot | Toutes les autres fonctionnalités restent opérationnelles |

---

## 8. Monitoring

### Endpoints de santé

| Endpoint | Rôle | Fréquence de vérification |
|----------|------|--------------------------|
| `GET /api/health` | DB + Redis + queue + circuit breakers | Toutes les 30s |
| `GET /api/metrics` | Latence P50/P95/P99, compteurs de requêtes | À la demande |
| `GET /api/superadmin/system-health` | Vue multi-tenant consolidée | Tableau de bord superadmin |
| `GET /api/superadmin/ml-status` | Maturité des coefficients ML par tenant | Tableau de bord superadmin |

### Alertes recommandées

| Condition | Sévérité | Action |
|-----------|---------|--------|
| `/api/health` ≠ 200 | Critique | Vérifier les conteneurs DB et Redis |
| File VRP > 10 jobs en attente | Avertissement | Vérifier le conteneur Worker VRP |
| RAM PostgreSQL > 90 % | Avertissement | Augmenter `shared_buffers` ou la RAM du serveur |
| Disque > 85 % | Avertissement | Nettoyer les logs, archiver ou supprimer les anciennes photos |
| Temps d'optimisation VRP > 120s | Avertissement | Trop de secteurs — vérifier le nombre de chauffeurs vs dimensionnement ([Section 2](#2-dimensionnement-des-composants)) |

---

## 9. Ordre de démarrage

Démarrer les services dans cet ordre pour éviter les erreurs de connexion au boot :

1. **PostgreSQL** — doit être sain avant que Prisma se connecte
2. **Redis** — BullMQ, SSE, rate limiting ; mode dégradé si absent, pas de crash
3. **Next.js** (`npm run dev` ou conteneur `ef-nextjs`)
4. **Worker VRP** (`npm run worker` ou conteneur `ef-worker`)
5. **Worker ML** (`npm run worker:ml` — optionnel, CRON nocturne)
6. **Valhalla** (routage — repli haversine si absent)
7. **AI Engine** (conteneur `ef-ai-engine` — optionnel, GPU requis)

### Commandes de démarrage

```bash
# Développement local
npm run dev           # Next.js sur :3000
npm run worker        # Worker BullMQ VRP
npm run worker:ml     # Worker ML (optionnel)

# Production (serveur cloud)
docker-compose -f docker-compose.vps.yml up -d
docker-compose -f docker-compose.ai.yml up -d   # AI Engine (optionnel, GPU requis)
```

---

## 10. Runbook d'incidents

### Redis indisponible

**Symptômes :** le VRP s'exécute en synchrone (plus lent), SSE indisponible, le rate limiting bascule en mémoire locale (non partagé entre instances).

```bash
redis-cli -u $REDIS_URL ping   # → PONG si sain
docker restart ef-redis
```

### Worker VRP absent

**Symptômes :** `/api/optimize` retourne `mode: "sync"` (200 au lieu de 202) ; les logs affichent `"Exécution VRP directe"`.

```bash
docker ps | grep worker
docker restart ef-worker
```

### PostgreSQL indisponible

**Symptômes :** toutes les routes API retournent 500 ; le health check affiche `status: "outage"`.

```bash
npx prisma migrate status
docker restart ef-postgres
```

### Valhalla indisponible

**Symptômes :** résultat VRP dégradé (repli haversine) ; les logs affichent `"Valhalla matrix failed, falling back to haversine"`. L'optimisation continue.

```bash
curl http://localhost:8002/status
docker restart ef-valhalla
```

### Forte charge sur la file VRP

**Symptômes :** réponse lente sur `/api/optimize`, métrique `vrp.enqueued` élevée dans `/api/metrics`.

1. Vérifier les workers actifs : `GET /api/health` → `services.VRP Queue.workers`
2. Mise à l'échelle horizontale : `docker-compose scale ef-worker=3`
3. Si persistant : vérifier le dimensionnement du serveur par rapport au nombre de chauffeurs dans la [Section 2](#2-dimensionnement-des-composants)

---

## 11. Opérations courantes

### Migration de base de données

```bash
# Sauvegarder d'abord
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

npx prisma migrate deploy
npx prisma migrate status
```

### Purger les logs d'audit

```bash
curl -X DELETE "https://app.pathelix.fr/api/audit?from=2025-01-01&to=2025-12-31&confirm=true" \
  -H "Cookie: session=..."
```

### Invalider le cache Redis Valhalla

```bash
redis-cli -u $REDIS_URL --scan --pattern "valhalla:matrix:*" | xargs redis-cli del
```

### Créer le compte superadmin

```bash
npm run db:seed-superadmin
# Requiert : SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD dans l'environnement
```

### Cache des permissions

Les permissions utilisateurs sont mises en cache pendant 60 secondes (`src/lib/permissions.ts`). Les modifications se propagent automatiquement après expiration du TTL. Pas d'endpoint de purge manuelle.



Chauffeurs,Ce qu'il faut (Ressources réelles estimées),La machine OVH idéale,Coût estimé (HT / mois)
50,~14 cœurs CPU / ~32 Go RAM / 1x GPU (12 Go+)VRP : 4 threads / 3 Go RAMBase + IA : 10 cœurs / 25 Go RAM,"Instance Cloud PCI GPU(ex: 14 vCPUs, 45 Go RAM, 1x NVIDIA Tesla)(Note : L'instance L4 à 680€ est overkill ici)",~ 450 €
150,~22 cœurs CPU / ~45 Go RAM / 1x GPU (12 Go+)VRP : 10 threads / 7 Go RAMBase + IA : 12 cœurs / 35 Go RAM,"Instance Cloud L4(22 vCPUs, 90 Go RAM, 1x NVIDIA L4 24 Go)",~ 680 €
300,~44 cœurs CPU / ~64 Go RAM / 1x GPU (12 Go+)VRP : 28 threads / 17 Go RAMBase + IA : 16 cœurs / 45 Go RAM,"Serveur Dédié ADV-GPU(AMD EPYC 24 cœurs / 48 threads, 128 Go RAM ECC, 1x GPU NVIDIA)",~ 950 € à 1 100 €
500,~68 cœurs CPU / ~100 Go RAM / 1x GPU (12 Go+)VRP : 48 threads / 42 Go RAMBase + IA : 20 cœurs / 55 Go RAM,"Serveur Dédié HGR-GPU(AMD EPYC 32 cœurs / 64 threads, 256 Go RAM ECC, 1x GPU NVIDIA)",~ 1 300 € à 1 600 €
1000,~90+ cœurs CPU / ~150 Go RAM / 1x GPU (12 Go+)VRP : 64+ threads / 82 Go RAMBase + IA : 24 cœurs / 65 Go RAM,"Serveur Dédié SCALE-GPU(Dual AMD EPYC 64 cœurs / 128 threads, 512 Go RAM ECC, 1x GPU NVIDIA)",~ 1 900 € à 2 500 €