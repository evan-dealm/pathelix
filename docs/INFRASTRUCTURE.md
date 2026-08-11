# Infrastructure — Pathélix

> Architecture de déploiement, dimensionnement, exploitation et runbook d'incidents.[cite: 25]
> Mise à jour : Juin 2026 (Intégration OVHcloud, Projections de coûts & Stratégie Zéro Perte)[cite: 25]

---

## Table des matières

1. [Vue d'ensemble de l'architecture](#1-vue-densemble-de-larchitecture)[cite: 25]
2. [Dimensionnement par composant](#2-dimensionnement-par-composant)[cite: 25]
3. [Projections de coûts par palier de chauffeurs](#3-projections-de-coûts-par-palier-de-chauffeurs)[cite: 25]
4. [Recommandations Matérielles OVH (Juin 2026)](#4-recommandations-matérielles-ovh-juin-2026)[cite: 25]
5. [Réseau & latence](#5-réseau--latence)[cite: 25]
6. [Stockage & Sécurité des données (Zéro Perte)](#6-stockage--sécurité-des-données-zéro-perte)[cite: 25]
7. [Sécurité réseau et applicative](#7-sécurité-réseau-et-applicative)[cite: 25]
8. [Disponibilité & sauvegardes](#8-disponibilité--sauvegardes)[cite: 25]
9. [Monitoring](#9-monitoring)[cite: 25]
10. [Ordre de démarrage](#10-ordre-de-démarrage)[cite: 25]
11. [Runbook d'incidents](#11-runbook-dincidents)[cite: 25]
12. [Opérations courantes](#12-opérations-courantes)[cite: 25]

---

## 1. Vue d'ensemble de l'architecture

Pathélix fonctionne sur un serveur cloud dédié unique.[cite: 25] Tous les services communiquent via un réseau bridge Docker interne — aucun tunnel VPN, aucune dépendance à un cluster externe complexe.[cite: 25]

    Internet (HTTPS)
          │
          ▼
    ┌────────────────────────────────────────────────────────────┐
    │  SERVEUR DÉDIÉ (OVH)                                       │
    │                                                            │
    │  ┌───────────┐  ┌────────────┐  ┌───────┐                  │
    │  │  Next.js  │  │ PostgreSQL │  │ Redis │                  │
    │  └─────┬─────┘  └─────┬──────┘  └───┬───┘                  │
    │        │               │             │                     │
    │        └───────────────┴─────────────┘                     │
    │                        │ Réseau bridge Docker (< 1 ms)     │
    │        ┌───────────────┼─────────────┐                     │
    │        │               │             │                     │
    │  ┌─────▼─────┐  ┌──────▼─────┐  ┌───▼────────┐             │
    │  │  Valhalla │  │ Worker VRP │  │ AI Engine  │             │
    │  │ (OSM RAM) │  │ (opt ALNS) │  │ (OCR, GPU) │             │
    │  └───────────┘  └────────────┘  └────────────┘             │
    │                                                            │
    │  Seuls les ports 80/443 sont exposés sur Internet          │
    └────────────────────────────────────────────────────────────┘

### Flux de données

1. Les utilisateurs se connectent en HTTPS via le reverse proxy (Caddy/Nginx).[cite: 25]
2. Déclenchement d'une optimisation → Next.js enfile un job BullMQ dans Redis.[cite: 25]
3. Le Worker VRP interroge Redis (bridge Docker, sous la milliseconde), récupère le job.[cite: 25]
4. Le Worker appelle Valhalla pour les distances PL réelles (bridge Docker).[cite: 25]
5. Le Worker écrit le résultat dans Redis → Next.js le retourne à l'utilisateur via SSE.[cite: 25]

---

## 2. Dimensionnement par composant

Cette section est la référence pour la planification de capacité.[cite: 25]

### Application Next.js & Base de données
* Next.js : 512 Mo + 50 Mo × connexions SSE simultanées. Max 50 connexions par tenant par défaut.[cite: 25]
* PostgreSQL : shared_buffers = 25 % de la RAM disponible. Pool de connexions (Prisma) = 20 par défaut.[cite: 25]

### Moteurs de calcul (Valhalla & VRP)
* Valhalla : 4 à 12 Go de RAM au démarrage pour la France complète.[cite: 25]
* Worker VRP : Le moteur VRP découpe les grandes flottes en secteurs parallèles. Chaque secteur nécessite ~400 Mo de RAM et un thread CPU dédié.[cite: 25]

### AI Engine (Roadmap Future)
* Donut OCR : ~3 Go VRAM (GPU).[cite: 25]
* Copilot (Llama 3 8B) : ~6 Go VRAM (GPU).[cite: 25]
* Note : L'IA est optionnelle. Sans GPU, l'application et le Machine Learning classique (statistique) fonctionnent parfaitement sur CPU.[cite: 25]

---

## 3. Projections de coûts par palier de chauffeurs

Ce tableau présente les estimations de coûts d'infrastructure matérielle selon la taille de la flotte. L'Option CPU est recommandée pour la mise en production actuelle, l'Option GPU est requise uniquement si la roadmap IA (OCR/Copilot) est activée.[cite: 8, 25]

| Chauffeurs | Missions / jour | Ressources Minimales | Prix estimé "CPU Pur" (Prod. Actuelle) | Prix estimé "Serveur GPU" (Roadmap IA) |
| :--- | :--- | :--- | :--- | :--- |
| **50** | ~ 500 | 14 cœurs / 32 Go RAM | **~ 100 € à 150 € HT / mois** | **~ 450 € HT / mois** |
| **130** | ~ 1 300 | 22 cœurs / 45 Go RAM | **~ 150 € à 200 € HT / mois** | **~ 680 € HT / mois** |
| **200** | ~ 2 000 | 44 cœurs / 64 Go RAM | **~ 290 € à 300 € HT / mois** | **~ 950 € à 1 100 € HT / mois** |
| **300** | ~ 3 000 | 44 cœurs / 64 Go RAM | **~ 290 € à 300 € HT / mois** | **~ 950 € à 1 100 € HT / mois** |
| **400** | ~ 4 000 | 68 cœurs / 100 Go RAM | **~ 450 € à 500 € HT / mois** | **~ 1 300 € à 1 600 € HT / mois** |
| **500** | ~ 5 000 | 68 cœurs / 100 Go RAM | **~ 450 € à 500 € HT / mois** | **~ 1 300 € à 1 600 € HT / mois** |

*(Note : Quel que soit le palier, la stratégie "Zéro Perte" expliquée à la section 6 ajoute seulement environ 3 € à 5 € HT/mois pour le stockage des sauvegardes externes).*[cite: 25]

---

## 4. Recommandations Matérielles OVH (Juin 2026)

Pour une flotte cible de 200 à 300 chauffeurs, l'infrastructure nécessite au minimum 44 threads CPU et 64 Go de RAM.[cite: 25] Voici les configurations recommandées chez OVHcloud :[cite: 25]

### Option A : Le Lancement Idéal (CPU uniquement)
C'est la configuration recommandée pour la mise en production immédiate. Elle encaisse largement la charge du VRP et du Machine Learning sans payer pour un GPU non utilisé.[cite: 25]
* Modèle : OVH Advance-5 (ou RISE-XL selon région)[cite: 25]
* CPU : AMD EPYC (24 cœurs physiques / 48 threads)[cite: 25]
* RAM : 128 Go DDR5 ECC[cite: 25]
* Stockage : 2x 1.92 To NVMe (Configuré en Soft RAID 1)[cite: 25]
* Tarif estimé : ~ 290 € à 300 € HT / mois[cite: 25]

### Option B : Prêt pour l'IA (GPU inclus)
À choisir uniquement lorsque les modules d'Intelligence Artificielle (OCR, Copilot) seront déployés.[cite: 25]
* Modèle : OVH Serveur Dédié ADV-GPU[cite: 25]
* CPU : AMD EPYC (24 cœurs / 48 threads)[cite: 25]
* RAM : 128 Go DDR5 ECC[cite: 25]
* GPU : 1x NVIDIA L4 (24 Go VRAM)[cite: 25]
* Stockage : 2x 1.92 To NVMe (Soft RAID 1)[cite: 25]
* Tarif estimé : ~ 950 € à 1 100 € HT / mois[cite: 25]

---

## 5. Réseau & latence

Toutes les communications inter-services passent par le bridge Docker.[cite: 25] La latence entre services est inférieure à la milliseconde — pas de surcoût VPN.[cite: 25]
Une liaison datacenter standard à 1 Gbps (fournie par défaut sur les dédiés OVH) est plus que suffisante pour le trafic HTTPS entrant/sortant et les flux SSE.[cite: 25]

---

## 6. Stockage & Sécurité des données (Zéro Perte)

Le stockage est le point critique d'un SaaS B2B. Pathélix exige une architecture résiliente à deux niveaux.[cite: 25]

### Niveau 1 : Résilience Matérielle (RAID 1)
Tous les serveurs dédiés OVH recommandés sont fournis avec deux disques NVMe identiques.[cite: 25]
* Configuration obligatoire : Lors de l'installation de l'OS via l'interface OVH, choisir Soft RAID 1.[cite: 25]
* Principe : Les disques sont en "miroir". Chaque donnée est écrite simultanément sur les deux disques NVMe.[cite: 25]
* Bénéfice : Si un disque dur physique lâche, le serveur continue de fonctionner sans une seule seconde d'interruption.[cite: 25]

### Niveau 2 : Résilience Logique (Object Storage S3)
Le RAID 1 ne protège pas contre la suppression accidentelle (erreur humaine) ou la destruction du serveur (incendie du datacenter).[cite: 25]
* Solution : Utilisation de l'Object Storage S3 d'OVH (hébergé dans un datacenter géographiquement distant).[cite: 25]
* Coût : Très faible (~ 0,01 € / Go / mois). Pour Pathélix, cela représente environ 3 € à 5 € HT / mois.[cite: 25]

---

## 7. Sécurité réseau et applicative

| Couche | Mesure |
|--------|--------|
| Transport | HTTPS obligatoire (certificat TLS auto via reverse proxy Caddy/Nginx) |[cite: 25]
| Authentification | JWT HMAC-SHA256, cookies `HttpOnly` / `Secure` / `SameSite=Strict` |[cite: 25]
| Base de données | Jamais exposée sur Internet — bridge Docker uniquement |[cite: 25]
| Clés API | Hash SHA-256 stocké (jamais en clair), scopes granulaires |[cite: 25]
| Pare-feu | Ports 80/443 uniquement. Le port 22 (SSH) restreint par IP si possible. |[cite: 25]

---

## 8. Disponibilité & sauvegardes

L'architecture de sauvegarde de Pathélix est codée pour garantir un RPO (Perte de Données Maximale) < 1h.[cite: 25]

### Processus de sauvegarde vers OVH S3

1. Sauvegarde complète (Nuit) :
   * Un CRON exécute le script `scripts/backup-pg.sh` tous les jours à 02h00.[cite: 25]
   * Ce script réalise un `pg_dump`, compresse la base de données, et l'envoie sur le bucket S3 OVH.[cite: 25]
2. Sauvegarde continue (WAL Archiving) :
   * PostgreSQL est configuré pour envoyer ses journaux de transactions (WAL) en continu vers le bucket S3.[cite: 25]
   * Permet la restauration "Point-in-Time" : en cas de crash à 15h00, la base peut être restaurée exactement dans l'état de 14h59.[cite: 25]
3. Rétention : Les archives sur le S3 sont purgées automatiquement après 30 jours.[cite: 25]

---

## 9. Monitoring

### Endpoints de santé intégrés

| Endpoint | Rôle | Fréquence de vérification |
|----------|------|--------------------------|
| `GET /api/health` | Statut DB, Redis, Queue VRP, Circuit breakers | Toutes les 30s |[cite: 25]
| `GET /api/metrics` | Latence P50/P95/P99, compteurs de requêtes | À la demande |[cite: 25]
| `GET /api/superadmin/system-health` | Vue multi-tenant consolidée | Via l'interface Superadmin |[cite: 25]

Alertes recommandées :
* `/api/health` ≠ 200 (Critique : vérifier conteneurs DB/Redis).[cite: 25]
* File VRP > 10 jobs en attente (Avertissement : vérifier conteneur Worker).[cite: 25]
* RAM PostgreSQL > 90 % de la RAM système.[cite: 25]

---

## 10. Ordre de démarrage

Pour éviter les erreurs de connexion au boot, démarrer les services dans cet ordre via Docker Compose :[cite: 25]

1. PostgreSQL — Doit être sain avant que Prisma se connecte.[cite: 25]
2. Redis — Gère BullMQ, SSE, rate limiting.[cite: 25]
3. Next.js (`app`) — L'application web principale.[cite: 25]
4. Worker VRP (`worker`) — Le consommateur de la file d'optimisation.[cite: 25]
5. Valhalla (`valhalla`) — Moteur de routage.[cite: 25]

    # Production (serveur cloud)
    docker compose up -d

---

## 11. Runbook d'incidents

### Redis indisponible
Symptômes : VRP s'exécute en mode synchrone (plus lent), SSE indisponible.[cite: 25]
    docker compose restart redis

### Worker VRP absent
Symptômes : `/api/optimize` retourne `mode: "sync"` au lieu d'asynchrone.[cite: 25]
    docker compose restart worker

### PostgreSQL indisponible
Symptômes : Toutes les routes API retournent 500, health check `outage`.[cite: 25]
    docker compose restart postgres

### Forte charge sur la file VRP
Symptômes : Métrique `vrp.enqueued` élevée.[cite: 25]
1. Vérifier les workers actifs : `GET /api/health`.[cite: 25]
2. Mise à l'échelle si ressources dispo : `docker compose up -d --scale worker=2`.[cite: 25]

---

## 12. Opérations courantes

### Migration de base de données
    # L'outil prisma s'exécute dans le conteneur app
    docker compose exec app npx prisma migrate deploy

### Purger les logs d'audit
Réservé au rôle superadmin via API :[cite: 25]
    curl -X DELETE "https://<domaine>/api/audit?from=2026-01-01&to=2026-12-31&confirm=true" -H "Cookie: session=..."

### Invalider le cache de routage (Valhalla)
    docker compose exec redis redis-cli --scan --pattern "valhalla:matrix:*" | xargs -r docker compose exec redis redis-cli del