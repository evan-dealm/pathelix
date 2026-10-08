# Pathélix — Dimensionnement des serveurs

Audit technique du code (application + site vitrine) et ressources nécessaires pour l'héberger en
production, de 5 à 1 000 chauffeurs. Document purement technique : **aucun prix, aucun hébergeur,
aucune offre commerciale**.

- Date : 8 octobre 2026 — branche `feat/qualite-production`.
- Méthode : lecture du code et de la configuration (`docker-compose.yml`, `Dockerfile*`,
  `.env.example`, `src/`, `prisma/schema.prisma`, `ai-engine/`, `load-tests/`), puis mesures
  locales non destructives (§9).
- Aucun fichier de l'application ou du site n'a été modifié. Ce document est le seul fichier créé.

Chaque chiffre porte une étiquette :
**[M]** mesuré pendant cet audit · **[C]** lu dans le code ou la configuration ·
**[E]** estimation calculée à partir de [M]/[C] et d'une hypothèse · **[NV]** non vérifié.

---

## 1. Synthèse

1. **Un seul VPS suffit jusqu'à 100 chauffeurs** (et reste possible, sans marge, jusqu'à 250).
   À partir de 250 chauffeurs, séparer les données (PostgreSQL + Redis) du reste ; à partir de
   500, trois rôles de serveurs ; à 1 000, sept serveurs en configuration recommandée.
2. **Le plancher est élevé et presque indépendant du nombre de chauffeurs** : la pile compte
   11 services (application, PostgreSQL, Redis, Valhalla, 6 workers, reverse proxy). Entre 5 et
   20 chauffeurs, la configuration est quasiment la même : 4 vCPU / 12 Go est le minimum réaliste
   avec un Valhalla régional.
3. **Valhalla (routage poids-lourds) est le premier consommateur de RAM**, pas l'application :
   3,9 Go atteints sur une limite de 4 Go avec la seule région Rhône-Alpes [M]. France entière :
   12 à 24 Go [E].
4. **L'optimiseur VRP coûte peu en mémoire et beaucoup moins de CPU que ne le dit
   `OPERATIONS.md` §4** : un calcul occupe **1 cœur** pendant son budget de temps (10 à 60 s) et
   **120 à 250 Mo** de RAM, de 5 à 1 000 chauffeurs [M]. Il se dimensionne en *nombre de
   réplicas* (calculs simultanés), pas en cœurs par calcul.
5. **La matrice de distances routières réelles ne passe pas à l'échelle telle que codée** :
   au-delà d'environ 130 à 180 points par optimisation (10 à 20 chauffeurs dans une même
   organisation), elle dépasse son budget de 20 s et le calcul retombe sur des distances à vol
   d'oiseau corrigées [M]. C'est une limite logicielle : du matériel plus rapide la repousse, il
   ne la supprime pas (§6.2).
6. **Le stockage de fichiers (photos) domine le disque** : environ 0,75 Go par chauffeur et par an
   [E], contre 0,05 Go pour la base. Au-delà de 100 chauffeurs, stockage objet compatible S3
   (déjà pris en charge par le code).
7. **Le réseau n'est jamais le facteur limitant** : 1 000 chauffeurs représentent quelques Mbit/s
   en pointe et environ 200 à 280 Go par mois [E].

---

## 2. Ce que le code fait tourner

### 2.1 Services (`docker-compose.yml`)

| Service | Rôle | Limite mémoire du compose [C] | Charge dominante |
|---|---|---|---|
| `app` | Next.js 15.5 (sortie `standalone`) : interface, ~200 routes API, **et site vitrine** | 2 Go | CPU mono-thread par process Node |
| `postgres` | PostgreSQL 16, 65 modèles | 1 Go (`shared_buffers` 256 Mo, `max_connections` 100) | Écritures GPS, lectures planning |
| `redis` | Files BullMQ, cache des matrices (24 h), pub/sub temps réel, limites de débit | `maxmemory` 512 Mo, `noeviction`, AOF | RAM |
| `valhalla` | Routage poids-lourds, tuiles OSM Rhône-Alpes par défaut | 4 Go | RAM + CPU pendant les matrices |
| `worker` | Optimisations VRP asynchrones (`VRP_CONCURRENCY=1`) | 4 Go | 1 cœur à 100 % par calcul |
| `worker-pdf` | Feuilles de route, rapports, documents commerciaux (`PDF_CONCURRENCY=2`) | 1 Go | CPU ponctuel |
| `worker-ml` | Recalcul nocturne des coefficients (03:00), pool de 5 connexions | — | Ponctuel |
| `worker-recurring` | Missions récurrentes (quotidien) | — | Ponctuel |
| `worker-retention` | Purge quotidienne (02:00) : audit, GPS, clés d'idempotence, jobs OCR | — | E/S base ponctuelles |
| `worker-business` | Webhooks sortants toutes les 30 s, contrôles quotidiens (06:00) | — | Faible |
| `ai-engine` (profil `ocr`, optionnel) | OCR des tickets de pesée, Tesseract CPU, 1 process | 1 Go | CPU ponctuel |
| Prometheus + Grafana (`docker-compose.monitoring.yml`, optionnel) | Supervision, rétention 30 j | — | Disque |

Non fourni par le compose et **indispensable** : un reverse proxy TLS (Caddy ou Nginx) devant `app`.

### 2.2 Le site vitrine

Le site (`src/app/(site)/`, 17 fichiers de page, routes à paramètres figées par
`dynamicParams = false`) est **servi par le même process Next.js** que l'application. Ses pages
sont statiques, générées au build. Seul le formulaire de contact écrit en base
(`/api/demo-requests`) et envoie un e-mail si SMTP est configuré. Il n'a donc **aucun serveur
propre** : son coût est du CPU de rendu/compression sur `app` et de la bande passante
(`public/` pèse 43 Mo [M], page d'accueil 178 ko de HTML avant compression [M]).

### 2.3 Ce qui génère la charge (lu dans le code)

| Source | Fréquence [C] | Effet |
|---|---|---|
| Position GPS de l'application chauffeur | 1 `POST /api/driver-position` toutes les 30 s par chauffeur | 1 `INSERT` par envoi dans `DriverPosition` (5 index) |
| File hors ligne du chauffeur | Vérifiée toutes les 15 s, **n'émet une requête que si une action attend** | Négligeable au repos |
| Carte exploitant | `GET /api/driver-position?history=0` toutes les 15 s par écran | 1 requête SQL « dernière position par chauffeur » |
| Rafraîchissement exploitant (`DataProvider`) | Toutes les 120 s : **toutes** les pages de `/api/drivers` et `/api/missions` du jour (100 lignes par page) | Croît avec la taille de l'organisation |
| Temps réel (`/api/sse/driver-status`) | 1 connexion longue par écran exploitant, **1 connexion Redis dédiée par connexion SSE**, plafond 200 par organisation et par process | À chaque changement de statut, chaque connexion relit l'instantané du jour en base |
| Onglet Télématique | Toutes les 30 s, avec historique de vitesse | Agrégation SQL de la journée |
| Cloche de notifications | Toutes les 60 s (onglet visible) | Faible |
| Suivi client public (`/track/[token]`) | Toutes les 30 s par page ouverte | Faible |
| Photos / justificatifs | Compressées dans le navigateur (1 280 px, JPEG 0,75), 5 Mo max par requête | Disque ou stockage objet |
| Optimisation de tournées | À la demande ; quota par minute selon le plan (2 / 10 / 30) | 1 cœur pendant 2 à 120 s |
| Limites globales | 600 req/min par utilisateur, 300 req/min par IP anonyme ; délestage à 200 optimisations concurrentes | Bornent les abus, pas le dimensionnement |

---

## 3. Hypothèses de charge

Toutes sont des hypothèses de l'audit **[E]**, à remplacer par vos chiffres réels dès qu'ils existent.

| # | Hypothèse | Valeur retenue | Sensibilité |
|---|---|---|---|
| H1 | Missions par chauffeur et par jour | 8 | Le banc d'essai a tourné à 10 ; l'optimiseur en a placé 5 à 7 sur des instances synthétiques |
| H2 | Jours travaillés par an | 250 | Linéaire sur base et fichiers |
| H3 | Chauffeurs connectés en même temps | 90 % de l'effectif | — |
| H4 | Utilisateurs de bureau (exploitants, admins) | 1 pour 7 chauffeurs, 2 au minimum, 70 % simultanés | Pèse sur le temps réel et le rafraîchissement |
| H5 | Durée de suivi GPS par jour | 9 h, soit 1 080 positions par chauffeur | Les boîtiers télématiques (Geotab, Samsara, OBD) peuvent émettre plus souvent |
| H6 | Photos | 1,5 par mission, 250 ko l'unité | Facteur 2 à 3 possible dans les deux sens |
| H7 | Répartition | « N chauffeurs » = total de la plateforme, réparti en organisations de 10 à 20 chauffeurs | **Une seule organisation de N chauffeurs** est le pire cas pour l'optimiseur et le temps réel : traité à part (§6, §11.4) |
| H8 | Couverture Valhalla | Une région jusqu'à 50 chauffeurs, France entière à partir de 100 | ±8 à 20 Go de RAM |

### Charge résultante par scénario

| Chauffeurs | Missions / jour | Missions / an | Utilisateurs simultanés (chauffeurs + bureau) | Positions GPS / jour | Requêtes/s en journée (moyenne → pointe) |
|---:|---:|---:|---:|---:|---:|
| 5 | 40 | 10 000 | ≈ 7 (5 + 2) | 5 400 | < 1 → 3 |
| 10 | 80 | 20 000 | ≈ 12 (9 + 3) | 10 800 | ≈ 1 → 4 |
| 20 | 160 | 40 000 | ≈ 22 (18 + 4) | 21 600 | ≈ 1,5 → 6 |
| 50 | 400 | 100 000 | ≈ 50 (45 + 6) | 54 000 | ≈ 3 → 12 |
| 100 | 800 | 200 000 | ≈ 100 (90 + 10) | 108 000 | ≈ 6 → 25 |
| 250 | 2 000 | 500 000 | ≈ 250 (225 + 25) | 270 000 | ≈ 15 → 60 |
| 500 | 4 000 | 1 000 000 | ≈ 500 (450 + 50) | 540 000 | ≈ 30 → 120 |
| 1 000 | 8 000 | 2 000 000 | ≈ 1 000 (900 + 100) | 1 080 000 | ≈ 60 → 250 |

Repère de capacité : un process Next.js sert 340 à 400 requêtes/s sur une route simple avec accès
base, et 240 pages/s du site vitrine [M] (poste de développement). En usage mixte, retenir
**≈ 100 requêtes/s par process** [E] comme valeur prudente.

---

## 4. Tableau comparatif — trois niveaux par scénario

Ressources **totales** de la plateforme (tous services du §2.1 compris, hors OCR et hors LLM
local). Valhalla régional jusqu'à 50 chauffeurs, France entière à partir de 100 (H8).

- **Minimum** : fonctionne correctement, peu de marge ; une optimisation ralentit le reste.
- **Recommandé** : usage professionnel, marge sur les pointes de planification.
- **Confortable** : pics, croissance d'un an, redondance à partir de 500.

| Chauffeurs | Minimum (vCPU / RAM / SSD) | Recommandé (vCPU / RAM / SSD) | Confortable (vCPU / RAM / SSD) | Serveurs (min → recommandé → confortable) |
|---:|---|---|---|---|
| 5 | 4 / 12 Go / 60 Go | 4 / 16 Go / 80 Go | 8 / 24 Go / 120 Go | 1 VPS |
| 10 | 4 / 12 Go / 60 Go | 6 / 16 Go / 80 Go | 8 / 24 Go / 160 Go | 1 VPS |
| 20 | 4 / 12 Go / 80 Go | 8 / 16 Go / 120 Go | 8 / 32 Go / 200 Go | 1 VPS |
| 50 | 6 / 16 Go / 120 Go | 8 / 24 Go / 160 Go | 12 / 32 Go / 300 Go | 1 VPS |
| 100 | 8 / 24 Go / 200 Go | 12 / 32 Go / 300 Go | 16 / 48 Go / 500 Go | 1 → 1 → 2 |
| 250 | 8 / 32 Go / 200 Go + objet | 16 / 48 Go / 360 Go + objet | 24 / 64 Go / 560 Go + objet | 1 → 2 → 3 |
| 500 | 12 / 48 Go / 360 Go + objet | 24 / 64 Go / 530 Go + objet | 32 / 96 Go / 920 Go + objet | 2 → 3 → 5 |
| 1 000 | 24 / 64 Go / 700 Go + objet | 40 / 112 Go / 1 000 Go + objet | 64 / 192 Go / 1 700 Go + objet | 3 → 7 → 9 |

« + objet » : fichiers déposés sur un stockage compatible S3 (`STORAGE_DRIVER=s3`), volumes au §7.
Le SSD indiqué est alors la somme des disques des serveurs, hors fichiers.

Ajustements :

| Variante | Effet sur la RAM | Effet sur le disque |
|---|---|---|
| Sans Valhalla local (API de routage externe via `ROUTING_API_*`, ou vol d'oiseau corrigé) | − 4 Go (région) / − 12 à 16 Go (France) | − 5 Go / − 40 Go |
| Valhalla France entière sur un scénario ≤ 50 chauffeurs | + 8 à 12 Go | + 35 Go |
| OCR des tickets (`--profile ocr`) | + 1 Go, + 1 vCPU en pointe | + 0,5 Go |
| Supervision Prometheus + Grafana sur le même serveur | + 1 Go | + 5 à 10 Go |
| LLM local pour la saisie en texte libre (`OLLAMA_URL`, optionnel) | + 8 Go au moins [NV] | + 5 à 10 Go [NV] |

Écart avec `OPERATIONS.md` §4 : ce tableau-là annonce 16 Go / 8 cœurs pour 20 chauffeurs et
150 Go / 90 cœurs pour 1 000, avec la règle « worker VRP = secteurs × 400 Mo + 2 Go ». Les mesures
de cet audit (§9.1) ne retrouvent pas ces besoins : le worker VRP est resté sous 250 Mo sans
threads et sous 430 Mo avec. Les chiffres ci-dessus s'appuient sur les mesures.

---

## 5. Détail par composant et par scénario

### 5.1 PostgreSQL

| Chauffeurs | vCPU | RAM | `shared_buffers` | `max_connections` | Taille de base (an 1 → +/an) [E] | Remarques |
|---:|---:|---:|---:|---:|---|---|
| 5 | 1 | 1 Go | 256 Mo | 100 | 1,3 Go → + 0,15 Go | Réglages du compose suffisants |
| 10 | 1 | 1 Go | 256 Mo | 100 | 1,5 Go → + 0,3 Go | Idem |
| 20 | 1 | 2 Go | 512 Mo | 100 | 2 Go → + 0,6 Go | Relever la limite mémoire du conteneur |
| 50 | 2 | 4 Go | 1 Go | 100 | 3,5 Go → + 1,5 Go | |
| 100 | 2 | 8 Go | 2 Go | 100 | 6 Go → + 3 Go | |
| 250 | 4 | 16 Go | 4 Go | 200 | 13,5 Go → + 7,5 Go | Serveur dédié recommandé, NVMe |
| 500 | 4 à 8 | 24 à 32 Go | 6 à 8 Go | 200 + pooler | 26 Go → + 15 Go | PgBouncer dès 2 instances d'application |
| 1 000 | 8 à 12 | 32 à 48 Go | 8 à 12 Go | 300 + pooler | 51 Go → + 30 Go | Réplica de secours recommandée |

Formule de taille [E] : `1 Go + chauffeurs × (0,02 Go de GPS en régime établi + 0,03 Go par an)`.

- **GPS** : 1 080 lignes par chauffeur et par jour, environ 0,65 ko par ligne index compris
  (5 index sur `DriverPosition` ; 176 Mo d'index observés sur la base de test [M], taille par
  ligne déduite [E]). Purge à 30 jours (`POSITION_RETENTION_DAYS`) : le volume se stabilise
  autour de 20 Mo par chauffeur. À 1 000 chauffeurs, c'est la plus grosse table (≈ 20 Go) et
  33 insertions/s en continu — sans difficulté pour PostgreSQL sur NVMe.
- **Audit** : ≈ 1 ko par ligne [M], conservé 365 jours.
- **Connexions** [C] : chaque process `app` ouvre jusqu'à `DB_POOL_SIZE` connexions (20 par défaut
  dans le code, 10 dans `.env.example`), le worker VRP 3, le worker ML 5, et les workers
  récurrences / rétention / business utilisent le pool par défaut (jusqu'à 20 chacun, 1 à 2 en
  pratique). Avec une instance d'application, le plafond théorique approche déjà les 100 du
  compose ; à partir de deux instances, il faut relever `max_connections` ou placer un pooler.
- **Sauvegardes** : `scripts/backup-pg.sh` garde 7 dumps compressés sur le serveur ; prévoir
  ≈ 2 × la taille de la base en local, plus une copie hors serveur.
- **Non couvert par le code** : pas de partitionnement de `DriverPosition`, pas de réplication.
  Au-delà de 1 000 chauffeurs ou avec de la télématique à haute fréquence, ce sera le premier
  chantier base de données.

### 5.2 Redis

| Chauffeurs | RAM (`maxmemory`) | vCPU | Disque (AOF) | Connexions simultanées [E] |
|---:|---:|---:|---:|---:|
| 5 à 20 | 256 à 512 Mo | 0,5 | 1 Go | 20 à 30 |
| 50 | 512 Mo | 0,5 | 2 Go | ≈ 35 |
| 100 | 1 Go | 1 | 3 Go | ≈ 45 |
| 250 | 2 Go | 1 | 6 Go | ≈ 70 |
| 500 | 4 Go | 1 à 2 | 12 Go | ≈ 110 |
| 1 000 | 4 à 8 Go | 2 | 16 à 24 Go | ≈ 180 |

- Au repos : 13 Mo, 146 clés [M].
- **`maxmemory-policy noeviction` est obligatoire** [C] (BullMQ perd des jobs sinon). Conséquence :
  quand Redis est plein, les écritures échouent et l'optimisation retombe en mode synchrone
  dans le process web. Il faut donc de la marge, pas un réglage au plus juste.
- **Cache des matrices** [C] : une entrée par jeu de points distinct, conservée 24 h, en JSON.
  Taille ≈ 38 octets × (nombre de points)² [E] : 0,3 Mo pour 85 points, 1,1 Mo pour 170, 6 Mo
  pour 410, 25 Mo pour 810. Chaque ré-optimisation après ajout d'une mission crée une nouvelle
  entrée.
- **Résultats d'optimisation** [C] : BullMQ garde les 200 derniers résultats. Taille mesurée d'un
  résultat [M] : 23 ko (50 missions), 94 ko (200), 444 ko (1 000), 2,2 Mo (5 000), 4,4 Mo
  (10 000) ; les données d'entrée du job ont un poids comparable. Pour des organisations de 10 à
  20 chauffeurs : 20 à 40 Mo au total. Pour une organisation unique de 1 000 chauffeurs : jusqu'à
  ≈ 2 Go.
- **Connexions** : 1 abonné Redis par connexion SSE ouverte, 2 à 3 par worker BullMQ, quelques-unes
  par process d'application. Très en dessous des limites par défaut de Redis.

### 5.3 Workers

| Chauffeurs | Worker VRP (réplicas × `VRP_CONCURRENCY`) | Worker PDF | ML · récurrences · rétention · business | RAM totale workers [E] |
|---:|---|---|---|---:|
| 5 à 50 | 1 × 1 | 1 (`PDF_CONCURRENCY=2`) | 1 de chaque | 2,5 Go |
| 100 | 1 à 2 × 1 | 1 (2) | 1 de chaque | 3 à 4 Go |
| 250 | 2 × 1 | 1 (2) | 1 de chaque | 4,5 Go |
| 500 | 3 à 4 × 1 | 1 (4) ou 2 (2) | 1 de chaque | 6 à 8 Go |
| 1 000 | 4 à 6 × 1 (8 en confortable) | 2 à 3 (2) | 1 de chaque | 9 à 14 Go |

- **Worker VRP** : 1 vCPU et 1 à 1,5 Go par réplica (mesuré : 120 à 250 Mo pour le calcul, le
  reste est la marge du runtime et de la matrice). Monter en charge avec
  `docker compose up -d --scale worker=N`, **pas** avec `VRP_CONCURRENCY` : le calcul est du
  JavaScript synchrone sur un seul thread, deux jobs dans le même process se partagent le même cœur.
- `VRP_USE_THREADS=true` : laisser à `false`. Mesuré [M] : 2 à 3 fois plus de CPU, 300 à 430 Mo de
  RAM, **même durée** (le calcul est borné par son budget de temps) et pas plus de missions placées.
- **Nombre de réplicas** [E] : il suit le nombre d'optimisations *simultanées*. Avec 5 à 10
  optimisations par organisation et par jour, concentrées sur deux fenêtres de planification, et
  12 à 15 s par calcul : ≈ 1,5 calcul simultané pour 100 organisations. La file absorbe les
  pointes (attente = un budget de calcul). Alerte existante : file > 10 jobs.
- **Worker PDF** : rendu `@react-pdf` synchrone, donc là aussi des réplicas plutôt que de la
  concurrence. Non mesuré [NV].
- **Workers planifiés** (ML, récurrences, rétention, business) : un seul exemplaire de chacun,
  quel que soit le scénario ; ≈ 200 à 250 Mo par process [E, NV]. Le worker ML relit les
  métriques de toutes les organisations chaque nuit : charge en base croissante, hors heures
  ouvrées.

### 5.4 Application (Next.js)

| Chauffeurs | Instances `app` | vCPU par instance | RAM par instance | Répartiteur de charge |
|---:|---:|---:|---:|---|
| 5 à 20 | 1 | 1 à 2 | 2 Go | Non (reverse proxy seul) |
| 50 | 1 (2 en confortable) | 2 | 2 Go | Non / oui |
| 100 | 1 à 2 | 2 | 2 à 3 Go | À partir de 2 |
| 250 | 2 | 2 | 3 Go | Oui |
| 500 | 2 à 3 | 2 à 4 | 3 à 4 Go | Oui |
| 1 000 | 3 à 4 | 4 | 4 Go | Oui |

- Mémoire d'un process [M] : 146 Mo de résident au repos sur l'instance locale déjà lancée,
  430 Mo juste après démarrage d'une instance de production, **1,1 Go après une minute de charge
  soutenue**. La limite de 2 Go du compose est juste ; prévoir 2 à 4 Go.
- **Pourquoi deux instances dès le niveau « Recommandé » à partir de 50 à 100 chauffeurs** : quatre
  routes exécutent l'optimiseur *dans le process web* et bloquent sa boucle d'événements [C] —
  ré-optimisation en cours de journée (`/api/optimize/live`, jusqu'à 10 s), re-séquencement (2 s),
  simulation (deux calculs), planning hebdomadaire (60 s par défaut, 300 s au maximum), plus le
  repli synchrone de `/api/optimize` (15 s) quand Redis ou le worker est absent. Pendant ce temps,
  l'instance ne répond à personne d'autre.
- **Conditions du multi-instance** [C] : Redis obligatoire ; fichiers sur stockage objet ou volume
  partagé (le volume local `photo_storage` n'est pas partagé entre serveurs) ; métriques
  Prometheus à collecter par instance ; plafond SSE de 200 connexions par organisation *et par
  instance* ; le répartiteur doit laisser passer les connexions longues sans mise en tampon.

---

## 6. Ressources des algorithmes d'optimisation

### 6.1 Recherche MV-ALNS (`src/lib/vrp/`)

Budget de temps fixé par `/api/optimize` selon le nombre de missions [C] : 2 s (< 20), 5 s (< 50),
10 s (< 200), 15 s (≥ 200), puis 1 s par tranche de 200 missions au-delà de 3 000, plafonné à 120 s.

| Chauffeurs (une seule organisation) | Missions testées | Budget [C] | Durée réelle [M] | CPU [M] | RAM maximale du process [M] |
|---:|---:|---:|---:|---:|---:|
| 5 | 50 | 10 s | 9,5 s | 1 cœur | 118 Mo |
| 10 | 100 | 10 s | 9,7 s | 1 cœur | 121 Mo |
| 20 | 200 | 15 s | 17,2 s | 1 cœur | 156 Mo |
| 50 | 500 | 15 s | 16,9 s | 1 cœur | 161 Mo |
| 100 | 1 000 | 15 s | 17,6 s | 1 cœur | 177 Mo |
| 250 | 2 500 | 15 s | 17,2 s | 1 cœur | 164 Mo |
| 500 | 5 000 | 25 s | 27,1 s | 1 cœur | 242 Mo |
| 1 000 | 10 000 | 50 s | 60,1 s | 1 cœur | 247 Mo |

Conséquences pour le choix du matériel :

- La durée est fixée par le budget, pas par la machine. Une machine plus rapide ne raccourcit pas
  le calcul : elle **améliore la qualité des tournées** trouvées dans le même temps. Ce qui compte
  est la **vitesse d'un cœur** (fréquence, cœurs dédiés non partagés), pas le nombre de cœurs.
- Le dépassement de budget mesuré atteint + 20 % à 10 000 missions.
- La décomposition en secteurs s'active au-delà de 20 chauffeurs [C] ; elle est séquentielle par
  défaut et le reste sans perte (voir §5.3 sur les threads).
- À ajouter à la RAM du worker quand une matrice routière est construite : 8 octets × (points)²
  [C] — 6,5 Mo pour 900 points, 40 Mo pour 2 250, 650 Mo pour 9 000.
- **Non vérifié** : la qualité des tournées à grande échelle. Sur les instances synthétiques de
  ce banc (10 missions par chauffeur, rayon élargi), la part de missions placées baisse quand la
  taille augmente. Ces instances ne sont pas représentatives d'une exploitation réelle ; pour une
  organisation unique de plus de 250 chauffeurs, prévoir un essai sur données réelles et
  éventuellement un budget plus long (le schéma accepte jusqu'à 300 s).

### 6.2 Matrice de distances (Valhalla)

Fonctionnement [C] : une matrice globale est construite **avant** la recherche, par blocs de
45 × 45 points, 4 blocs en parallèle, budget total de 20 s (`VALHALLA_MATRIX_BUDGET_MS`). Budget
dépassé ou erreur : les blocs restants sont remplis à vol d'oiseau, le disjoncteur coupe Valhalla
une minute, et la matrice dégradée n'est pas mise en cache.

Mesures [M] (profil poids-lourd, région Rhône-Alpes, conteneur limité à 4 Go, poste de
développement — §9.2) :

- un bloc 45 × 45 : 2,2 à 3,5 s à chaud, jusqu'à 8 à 11 s à froid ;
- 16 blocs à 4 en parallèle : **28,7 s**, donc hors budget ;
- mémoire du conteneur : 0,5 Go au repos, **3,9 Go sur 4 Go** après quelques matrices.

| Chauffeurs dans une même organisation | Points (missions + dépôts + exutoires) | Blocs à calculer | Durée estimée sur le matériel testé [E] | Tient dans les 20 s ? |
|---:|---:|---:|---:|---|
| 5 | ≈ 46 | 4 | 3 à 6 s | Oui |
| 10 | ≈ 85 | 4 | 3 à 6 s | Oui |
| 20 | ≈ 170 | 16 | ≈ 29 s [M] | Non sur le matériel testé |
| 50 | ≈ 410 | 100 | ≈ 1 à 3 min | Non |
| 100 | ≈ 810 | 324 | ≈ 4 à 10 min | Non |
| 250 et plus | ≥ 2 000 | ≥ 2 025 | > 25 min | Non |

Lecture :

- Pour une plateforme faite de **nombreuses petites organisations** (H7), chaque optimisation reste
  sous ≈ 180 points : Valhalla remplit son rôle, et son dimensionnement suit le nombre
  d'optimisations simultanées (jusqu'à 4 cœurs par matrice en construction).
- Pour une **organisation de plus de 15 à 20 chauffeurs**, la matrice routière réelle ne tient
  pas dans le budget tel que le code est réglé. Leviers sans modification de code : serveur
  Valhalla plus rapide et mieux doté en RAM, `VALHALLA_MATRIX_BUDGET_MS` plus long, API de routage
  externe (`ROUTING_API_TYPE`), ou accepter le vol d'oiseau corrigé par `valhallaFactor` (1,60).
  Le plafond de 4 blocs en parallèle est une constante du code : ajouter des cœurs à Valhalla
  au-delà de 4 à 8 n'accélère pas une matrice isolée.
- **Non vérifié** : le temps par bloc sur un serveur Linux dédié avec suffisamment de RAM. Il est
  vraisemblablement meilleur que sur le poste testé (conteneur à sa limite mémoire). À mesurer en
  premier sur l'infrastructure cible.

Ressources Valhalla :

| Couverture | RAM | vCPU | Disque | Statut |
|---|---:|---:|---:|---|
| Une région (Rhône-Alpes) | 4 Go minimum, 6 à 8 Go recommandé | 2 à 4 | 3,3 Go mesurés (extrait 517 Mo, archive de tuiles 483 Mo, tuiles décompressées) | [M] |
| France entière | 12 Go minimum, 16 à 24 Go recommandé | 4 à 8 | 30 à 40 Go | [E] par proportion avec la région mesurée, [NV] |
| Construction initiale des tuiles | Pic supérieur au fonctionnement courant ; 15 à 30 min pour une région (`OPERATIONS.md`) | 4 (`--mjolnir-concurrency 4`) | Espace temporaire en plus | [C] / [NV] pour la France |

Aucun GPU n'est utilisé par le code, à aucun endroit.

---

## 7. Stockage

| Chauffeurs | Système + images Docker | Tuiles Valhalla | Base an 1 (+ sauvegardes locales) | Fichiers an 1 [E] | Emplacement conseillé des fichiers |
|---:|---:|---:|---:|---:|---|
| 5 | 25 Go | 5 Go | 1,3 Go (+ 3) | 4 Go | Disque local |
| 10 | 25 Go | 5 Go | 1,5 Go (+ 3) | 7,5 Go | Disque local |
| 20 | 25 Go | 5 Go | 2 Go (+ 4) | 15 Go | Disque local |
| 50 | 25 Go | 5 Go | 3,5 Go (+ 7) | 38 Go | Disque local |
| 100 | 25 Go | 40 Go | 6 Go (+ 12) | 75 Go | Local ou objet |
| 250 | 25 Go par serveur | 40 Go | 13,5 Go (+ 27) | 190 Go | Stockage objet |
| 500 | 25 Go par serveur | 40 Go | 26 Go (+ 52) | 375 Go | Stockage objet |
| 1 000 | 25 Go par serveur | 40 Go | 51 Go (+ 100) | 750 Go | Stockage objet |

- **Images Docker** [M] : application 2,61 Go, workers 2,41 Go (une image pour les six), Valhalla
  0,9 Go, PostgreSQL 0,4 Go, OCR 0,42 Go, Redis 0,06 Go. Prévoir 2 à 3 fois ce volume pendant une
  mise à jour (anciennes couches, cache de build).
- **Fichiers** : ≈ 3 Mo par chauffeur et par jour (H6), soit ≈ 0,75 Go par an. **Le worker de
  rétention ne purge pas les fichiers** [C] (seulement audit, GPS, clés d'idempotence, jobs OCR) :
  le volume croît sans plafond et se cumule d'une année sur l'autre.
- **Type de disque** : SSD partout. NVMe pour PostgreSQL à partir de 250 chauffeurs, et pour
  Valhalla, qui lit ses tuiles par projection mémoire.
- **Sauvegardes hors serveur** : à prévoir en plus (base + fichiers). Non compté ci-dessus.

---

## 8. Réseau

| Chauffeurs | Débit soutenu en journée [E] | Pointe [E] | Trafic mensuel [E] | Lien conseillé |
|---:|---:|---:|---:|---|
| 5 | < 0,1 Mbit/s | 5 Mbit/s | 5 à 10 Go | 100 Mbit/s |
| 10 | < 0,1 Mbit/s | 5 Mbit/s | 7 à 12 Go | 100 Mbit/s |
| 20 | 0,1 Mbit/s | 10 Mbit/s | 10 à 15 Go | 100 Mbit/s |
| 50 | 0,2 Mbit/s | 10 Mbit/s | 15 à 25 Go | 100 Mbit/s |
| 100 | 0,4 Mbit/s | 20 Mbit/s | 25 à 40 Go | 100 Mbit/s |
| 250 | 1 Mbit/s | 30 Mbit/s | 55 à 80 Go | 100 Mbit/s à 1 Gbit/s |
| 500 | 2 Mbit/s | 50 Mbit/s | 110 à 150 Go | 1 Gbit/s |
| 1 000 | 4 Mbit/s | 100 Mbit/s | 200 à 280 Go | 1 Gbit/s |

- Par chauffeur et par mois [E] : ≈ 40 Mo de GPS (1,7 ko par envoi aller-retour, d'après les
  résultats k6 du dépôt), ≈ 65 Mo de photos montantes, ≈ 15 Mo d'application et d'actions,
  ≈ 20 Mo de part des écrans exploitants. Soit ≈ 0,15 à 0,2 Go.
- Site vitrine : 5 à 30 Go par mois pour un trafic B2B modeste [E, NV].
- **Les fonds de carte ne passent pas par le serveur** [C] : tuiles servies directement au
  navigateur par OpenFreeMap (ou MapTiler). Même chose pour le géocodage.
- Entre serveurs (à partir de 250 chauffeurs) : réseau privé à faible latence entre application,
  PostgreSQL, Redis et Valhalla. Les matrices Valhalla font ≈ 125 ko par bloc [M].
- Trafic sortant du serveur : SMTP, notifications push, webhooks et ERP configurés par les
  clients, Sentry, téléchargement initial des données OSM (0,5 Go pour une région).
- **Ports** : `docker-compose.yml` publie sur l'hôte 5432 (PostgreSQL), 6379 (Redis), 8002
  (Valhalla) et 3000 (application). Un pare-feu doit n'ouvrir que 80/443 vers Internet.

---

## 9. Mesures réalisées

Poste de développement : Windows 11, 16 processeurs logiques, Node 24 ; PostgreSQL, Redis et
Valhalla dans Docker Desktop (machine virtuelle de 7,6 Go). **Ordres de grandeur, pas des
engagements** : un serveur Linux dédié se comportera différemment. Aucune mesure n'a écrit dans
une base ; les lectures ont porté sur la base de test `manualtest_sandbox_never_prod`.

### 9.1 Optimiseur VRP

Un calcul par process, instances synthétiques à graine fixe (générateur de
`scripts/vrp-bench/instances.ts`, dépôts répartis), sans base, sans Redis, distances à vol d'oiseau,
budget identique à la production. Résultats sans threads au §6.1. Avec
`VRP_USE_THREADS=true` et 8 threads :

| Chauffeurs × missions | Durée | Temps CPU cumulé | RAM maximale | Missions placées (sans threads → avec) |
|---|---:|---:|---:|---|
| 100 × 1 000 | 17,8 s | 38 s | 429 Mo | 489 → 466 |
| 250 × 2 500 | 17,2 s | 50 s | 300 Mo | 941 → 886 |
| 500 × 5 000 | 28,2 s | 90 s | 304 Mo | 1 603 → 1 545 |
| 1 000 × 10 000 | 54,2 s | 173 s | 288 Mo | 2 858 → 2 731 |

### 9.2 Valhalla

Requêtes `sources_to_targets` en lecture, profil poids-lourd identique à celui du code, points
aléatoires dans un rayon de 25 km autour de Grenoble. Bloc 45 × 45 séquentiel à chaud : 2 452,
2 171, 3 124, 8 370, 5 704 ms. Bloc 12 × 12 : 216 à 404 ms. 16 blocs 45 × 45 à 4 en parallèle :
28 671 ms. Mémoire du conteneur : 491 Mo avant, 3,9 Go après (limite 4 Go).

### 9.3 Application

Seconde instance de production lancée sur un autre port (base de test, limites de débit levées),
50 connexions concurrentes pendant 15 s, requêtes GET uniquement, puis arrêtée.

| Cible | Requêtes/s | p50 | p95 | Taille |
|---|---:|---:|---:|---:|
| Page d'accueil du site | 240 | 190 ms | 353 ms | 178 ko |
| `/api/ready` (aller-retour base) | 342 | 117 ms | 313 ms | 0,1 ko |
| `/api/ready`, 200 connexions | 405 | 457 ms | 753 ms | 0,1 ko |
| `/login` | 136 | 336 ms | 484 ms | 26 ko |

Mémoire résidente du process : 430 Mo au démarrage, 609 Mo, 785 Mo, 961 Mo puis 1 093 Mo au fil
des quatre séries. CPU : 1,1 à 1,9 cœur occupé pendant les séries.

Latences sous 50 connexions sur un seul process, générateur de charge sur la même machine : elles
bornent le débit, pas le temps de réponse en usage normal.

### 9.4 Conteneurs et base

Au repos : PostgreSQL 61 Mo, Redis 20 Mo (13 Mo de données, 146 clés, 4 clients). Volumes : base
942 Mo, tuiles Valhalla 3,29 Go. Index de `DriverPosition` sur la base de test : 176 Mo.
Ligne d'audit : ≈ 1 ko. Plan de tournée : 1,2 ko de JSON pour 7 étapes en moyenne.

### 9.5 Mesures antérieures du dépôt (non rejouées)

`OPERATIONS.md` §4, 7 octobre 2026, build de production, 150 chauffeurs émettant toutes les 10 s
(3 fois le rythme réel) : envoi de position p95 15 ms, carte exploitant p95 114 ms, historique de
vitesse p95 128 ms, liste des missions p95 64 ms, création de mission p95 38 ms, aucune erreur
serveur. Non couverts : connexions SSE, saturation du pool de connexions en charge soutenue.

---

## 10. Configurations détaillées par scénario

Abréviations — **App** : `app` + reverse proxy. **Calcul** : workers VRP + Valhalla.
**Tâches** : PDF, ML, récurrences, rétention, business. **Données** : PostgreSQL + Redis.

### 5, 10 et 20 chauffeurs — un seul VPS

| Niveau | 5 chauffeurs | 10 chauffeurs | 20 chauffeurs |
|---|---|---|---|
| Minimum | 4 vCPU / 12 Go / 60 Go | 4 vCPU / 12 Go / 60 Go | 4 vCPU / 12 Go / 80 Go |
| Recommandé | 4 vCPU / 16 Go / 80 Go | 6 vCPU / 16 Go / 80 Go | 8 vCPU / 16 Go / 120 Go |
| Confortable | 8 vCPU / 24 Go / 120 Go | 8 vCPU / 24 Go / 160 Go | 8 vCPU / 32 Go / 200 Go |

Répartition type sur 12 Go [E] : Valhalla régional 4 Go, application 2 Go, workers 2,5 Go,
PostgreSQL 1 Go, Redis 0,5 Go, système et proxy 1 Go, marge 1 Go.
Réglages : ceux du compose, 1 worker VRP, 1 instance d'application, fichiers sur disque local.
À 20 chauffeurs, passer PostgreSQL à 2 Go (`shared_buffers` 512 Mo).
8 Go de RAM ne suffisent que sans Valhalla local.

### 50 chauffeurs — un seul VPS

| Niveau | Configuration | Particularités |
|---|---|---|
| Minimum | 6 vCPU / 16 Go / 120 Go | 1 instance d'application, 1 worker VRP |
| Recommandé | 8 vCPU / 24 Go / 160 Go | PostgreSQL 4 Go ; Valhalla 6 Go |
| Confortable | 12 vCPU / 32 Go / 300 Go | 2 instances d'application derrière le proxy ; supervision sur le même serveur |

### 100 chauffeurs — un VPS, deux en confortable

| Niveau | Configuration | Particularités |
|---|---|---|
| Minimum | 1 VPS : 8 vCPU / 24 Go / 200 Go | Valhalla France à 12 Go, sans marge |
| Recommandé | 1 VPS : 12 vCPU / 32 Go / 300 Go | 2 workers VRP, PostgreSQL 8 Go, Redis 1 Go |
| Confortable | **App + Calcul + Tâches** : 12 vCPU / 32 Go / 200 Go · **Données** : 4 vCPU / 16 Go / 300 Go NVMe | Fichiers sur stockage objet ; 2 instances d'application |

### 250 chauffeurs

| Niveau | Serveurs | Détail |
|---|---|---|
| Minimum | 1 | 8 vCPU / 32 Go / 200 Go + stockage objet. Tout sur un serveur : possible, mais une panne arrête tout et une optimisation lourde se ressent |
| Recommandé | 2 | **App + Calcul + Tâches** : 12 vCPU / 32 Go / 160 Go (2 instances d'application, 2 workers VRP, Valhalla France 12 à 16 Go) · **Données** : 4 vCPU / 16 Go / 200 Go NVMe |
| Confortable | 3 | **App + Tâches** : 8 vCPU / 16 Go / 120 Go · **Calcul** : 8 vCPU / 24 Go / 140 Go (3 workers VRP, Valhalla) · **Données** : 8 vCPU / 24 Go / 300 Go NVMe |

### 500 chauffeurs

| Niveau | Serveurs | Détail |
|---|---|---|
| Minimum | 2 | **App + Calcul + Tâches** : 8 vCPU / 32 Go / 160 Go · **Données** : 4 vCPU / 16 Go / 200 Go NVMe |
| Recommandé | 3 | **App + Tâches** : 8 vCPU / 16 Go / 120 Go (2 à 3 instances) · **Calcul** : 8 vCPU / 24 Go / 160 Go (4 workers VRP, Valhalla France) · **Données** : 8 vCPU / 24 Go / 250 Go NVMe (PostgreSQL 16 à 20 Go, Redis 4 Go, pooler) |
| Confortable | 5 | **App** × 2 : 4 vCPU / 8 Go / 80 Go chacun, derrière répartiteur · **Calcul** : 12 vCPU / 32 Go / 160 Go · **Données** : 8 vCPU / 32 Go / 300 Go NVMe · **Réplica PostgreSQL** : 4 vCPU / 16 Go / 300 Go NVMe |

### 1 000 chauffeurs

| Niveau | Serveurs | Détail |
|---|---|---|
| Minimum | 3 | **App + Tâches** : 8 vCPU / 16 Go / 150 Go (3 instances) · **Calcul** : 8 vCPU / 24 Go / 150 Go (4 workers VRP, Valhalla France) · **Données** : 8 vCPU / 24 Go / 400 Go NVMe |
| Recommandé | 7 | **App** × 3 : 4 vCPU / 8 Go / 80 Go chacun · **Workers** : 8 vCPU / 16 Go / 100 Go (6 VRP, 2 PDF, tâches planifiées) · **Valhalla** : 8 vCPU / 24 Go / 100 Go NVMe · **PostgreSQL** : 8 vCPU / 32 Go / 400 Go NVMe · **Redis + supervision** : 4 vCPU / 16 Go / 160 Go |
| Confortable | 9 | **App** × 3 : 4 vCPU / 8 Go / 80 Go chacun · **Workers** × 2 : 8 vCPU / 16 Go / 100 Go chacun · **Valhalla** : 8 vCPU / 32 Go / 100 Go NVMe · **PostgreSQL primaire** : 12 vCPU / 48 Go / 500 Go NVMe · **Réplica PostgreSQL** : 8 vCPU / 32 Go / 500 Go NVMe · **Redis + supervision** : 8 vCPU / 24 Go / 160 Go |

---

## 11. Architecture recommandée et évolution

### 11.1 Schéma cible

```
                         Internet (80/443)
                                │
                  Reverse proxy TLS / répartiteur
                                │
              ┌─────────────────┼─────────────────┐
           app #1            app #2  …          app #n       ← sans état si Redis + stockage objet
              └───────┬─────────┴─────────┬───────┘
                      │   réseau privé    │
        ┌─────────────┼───────────┬───────┴────────┬───────────────┐
   PostgreSQL       Redis      Valhalla      workers VRP × N    PDF · ML · récurrences
   (+ réplica)   (noeviction)  (tuiles)      (1 cœur chacun)    rétention · business
        │
   Sauvegardes hors serveur            Stockage objet S3 (photos, signatures, PDF)
```

Jusqu'à 100 chauffeurs, tout ce schéma tient sur un VPS avec `docker compose`.

### 11.2 Ordre de séparation quand la charge monte

1. **Fichiers vers le stockage objet** (`STORAGE_DRIVER=s3`) : libère le disque, et c'est le
   préalable à toute seconde instance d'application.
2. **PostgreSQL + Redis sur leur serveur** (≈ 250 chauffeurs) : isole les données du CPU de
   calcul, simplifie les sauvegardes.
3. **Workers VRP + Valhalla sur un serveur de calcul** (≈ 500 chauffeurs) : les pointes
   d'optimisation ne touchent plus l'interface.
4. **Plusieurs instances d'application derrière un répartiteur** : nécessite Redis et un pooler
   de connexions PostgreSQL.
5. **Réplica PostgreSQL**, puis partitionnement de la table GPS (≥ 1 000 chauffeurs ; non prévu
   dans le code actuel).

### 11.3 Ce qui évolue bien, ce qui coince

| Sujet | Évolution | Limite à connaître |
|---|---|---|
| Application | Horizontale, sans état avec Redis | SSE : 200 connexions par organisation et par instance ; routes d'optimisation synchrones bloquantes |
| Workers VRP | Horizontale, linéaire (1 cœur par réplica) | Aucune tant que Redis tient |
| Valhalla | Verticale (RAM) ; plusieurs instances possibles derrière un répartiteur | 4 blocs en parallèle et 20 s par matrice dans le code |
| PostgreSQL | Verticale d'abord | Pas de réplication ni de partitionnement prévus ; GPS = plus grosse table |
| Redis | Verticale | `noeviction` : plein = écritures refusées ; cache de matrices et résultats BullMQ non bornés en taille |
| Fichiers | Illimitée en stockage objet | Aucune purge automatique |

### 11.4 Cas particulier : une seule organisation de grande taille

Les tableaux supposent de nombreuses organisations de 10 à 20 chauffeurs (H7). Si un seul client
porte plusieurs centaines de chauffeurs, trois points du code changent d'échelle [C] :

- chaque écran exploitant recharge toutes les 120 s la totalité des chauffeurs et des missions du
  jour, page par page (≈ 90 requêtes par écran pour 1 000 chauffeurs) ;
- chaque changement de statut d'un chauffeur fait relire l'instantané complet du jour par
  *chaque* connexion SSE de l'organisation ;
- la matrice routière ne se construit plus dans son budget (§6.2), et les résultats
  d'optimisation conservés dans Redis pèsent plusieurs Mo chacun (§5.2).

Dans ce cas, prendre le niveau « Confortable » du scénario et le valider par un test de charge
(`load-tests/`) sur l'infrastructure réelle avant mise en service.

---

## 12. Services supplémentaires

| Service | Nécessité | Ressource serveur | Source |
|---|---|---|---|
| Reverse proxy TLS (Caddy ou Nginx) | **Obligatoire**, absent du compose | < 0,5 vCPU, 100 à 200 Mo | `OPERATIONS.md` §1 |
| Nom de domaine + certificats | Obligatoire (HSTS actif, `NEXT_PUBLIC_SITE_URL` lu au build) | — | `next.config.mjs` |
| Stockage des sauvegardes hors serveur | Obligatoire en pratique | 2 à 4 × la taille de la base + fichiers | `scripts/backup-pg.sh` |
| Serveur SMTP (externe) | Requis pour devis, factures, invitations, relances, demandes de démo | Aucune | `SMTP_URL` |
| Stockage objet compatible S3 | Optionnel ≤ 100 chauffeurs, recommandé au-delà, requis en multi-instance | Voir §7 | `STORAGE_DRIVER` |
| Supervision Prometheus + Grafana | Recommandé | 1 vCPU, 1 Go, 5 à 10 Go | `docker-compose.monitoring.yml` |
| Sentry | Recommandé (service externe ou auto-hébergé) | Aucune si externe | `SENTRY_DSN` |
| Notifications push (VAPID) | Optionnel | Aucune (services des navigateurs) | `VAPID_*` |
| OCR des tickets de pesée | Optionnel | 1 vCPU, 1 Go ; file limitée à 200 | `ai-engine/` |
| API de routage externe (Trimble, HERE, générique) | Optionnel ; remplace ou complète Valhalla | Aucune | `ROUTING_API_*` |
| Fonds de carte (OpenFreeMap ou MapTiler) | Externe, appelé par le navigateur | Aucune | `next.config.mjs` (CSP) |
| Géocodage (API Adresse, Nominatim) | Externe | Aucune | CSP |
| Télématique (Geotab, Samsara, OBD, Nessy) | Optionnel, webhooks entrants | Écritures GPS supplémentaires | `/api/webhooks/*` |
| Trackdéchets | Externe, bloqué par défaut dans le code | Aucune | `OPERATIONS.md` §8 |
| LLM local (saisie en texte libre) | Optionnel ; un lecteur déterministe existe sans lui | Non dimensionné ici | `OLLAMA_URL` |
| Pooler de connexions (PgBouncer) | À partir de 2 instances d'application | < 0,5 vCPU, 100 Mo | §5.1 |

---

## 13. Limites de cet audit

**Hypothèses non mesurées** : H1 à H8 (§3), dont le nombre de missions par chauffeur, le ratio
d'utilisateurs de bureau et le volume de photos. Les volumes de stockage et de trafic en découlent
directement.

**Non vérifié** :

- comportement sur un serveur Linux dédié (toutes les mesures viennent d'un poste Windows avec
  Docker Desktop) ;
- Valhalla France entière : RAM, disque, durée de construction des tuiles, temps par bloc de matrice ;
- connexions SSE en nombre (les tests k6 du dépôt ne tiennent pas un flux ouvert) ;
- saturation du pool de connexions PostgreSQL en charge soutenue ;
- charge authentifiée réelle pendant cet audit : seules des requêtes GET publiques ont été
  rejouées ; les latences des routes métier viennent de `OPERATIONS.md` ;
- workers PDF, ML, récurrences, rétention et business : mémoire et CPU estimés, non mesurés ;
- mémoire nécessaire au **build** des images (`next build`) : à prévoir sur une machine de build
  ou en CI plutôt que sur un petit VPS ;
- qualité des tournées pour une organisation unique de plus de 250 chauffeurs.

**À mesurer en premier sur l'infrastructure cible** :

1. le temps d'un bloc de matrice Valhalla 45 × 45 (il décide si le routage réel est utilisable
   pour vos tailles d'organisation) ;
2. `load-tests/run-all.sh` sur une base de test, avec le nombre de chauffeurs visé ;
3. la mémoire du conteneur `app` après une journée d'usage réel ;
4. une restauration complète de sauvegarde.



PATHÉLIX — Tableau des serveurs OVHcloud selon le nombre de chauffeurs
Voici le tableau récapitulatif des configurations OVHcloud envisagées pour héberger ton SaaS PATHÉLIX, de 5 à 1 000 chauffeurs.
Chauffeurs	Missions/jour	Serveur OVHcloud	Nb serveurs	CPU total	RAM totale	Prix TTC/mois
5	40	VPS-4	1	8 vCore	24 Go	23,95 €
10	80	VPS-4	1	8 vCore	24 Go	23,95 €
20	160	VPS-4	1	8 vCore	24 Go	23,95 €
50	400	VPS-4	1	8 vCore	24 Go	23,95 €
100	800	RISE-S	1	8 cœurs / 16 threads	64 Go	77,99 €
250	2 000	RISE-S + VPS-4	2	8 cœurs + 8 vCore	88 Go	101,94 €
500	4 000	RISE-M + 2 VPS-4	3	12 cœurs + 16 vCore	112 Go	167,89 €
1 000	8 000	RISE-M + 6 VPS-4	7	12 cœurs + 48 vCore	208 Go	263,69 €
Tarifs indicatifs des offres précédemment identifiées, à reconfirmer chez OVHcloud. CPU physiques et vCore ne sont pas équivalents. Les configurations à partir de 100 chauffeurs sont des propositions à tester, et non des capacités garanties.Stockage et coût par chauffeur
Chauffeurs	Stockage OVH envisagé	Coût mensuel/chauffeur	Coût annuel serveurs
5	200 Go NVMe	4,79 €	287,40 €
10	200 Go NVMe	2,40 €	287,40 €
20	200 Go NVMe	1,20 €	287,40 €
50	200 Go NVMe	0,48 €	287,40 €
100	2 × 512 Go	0,78 €	935,88 €
250	2 × 512 Go + 200 Go	0,41 €	1 223,28 €
500	2 × 512 Go + 400 Go	0,34 €	2 014,68 €
1 000	2 × 512 Go + 1 200 Go	0,26 €	3 164,28 €
Les capacités de stockage sont les capacités brutes annoncées, avant RAID éventuel. Les prix n'incluent pas les sauvegardes externes, le stockage S3, les e-mails, les frais d'installation ou la maintenance.
Pour commencer, je retiendrais le VPS-4 à 23,95 € TTC/mois, avec 8 vCore, 24 Go de RAM et 200 Go NVMe, pour tester PATHÉLIX avec 5 à 50 chauffeurs.