# Algorithme VRP & Système ML — Pathélix

> Référence technique pour la maintenance et l'évolution du moteur d'optimisation.
> Source : `src/lib/vrp/` (21 fichiers). Point d'entrée : `src/lib/vrp/index.ts`.

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Chaîne de routage (4 niveaux)](#2-chaîne-de-routage-4-niveaux)
3. [Formulation du problème](#3-formulation-du-problème)
4. [Pipeline 7 étapes](#4-pipeline-7-étapes)
5. [MV-ALNS v6 — Algorithme central](#5-mv-alns-v6--algorithme-central)
6. [Décomposition en secteurs (grandes flottes)](#6-décomposition-en-secteurs-grandes-flottes)
7. [Modèle de coût](#7-modèle-de-coût)
8. [Post-optimisation (étapes 5–6)](#8-post-optimisation-étapes-56)
9. [Formatage de la solution (étape 7)](#9-formatage-de-la-solution-étape-7)
10. [Ré-optimisation en temps réel](#10-ré-optimisation-en-temps-réel)
11. [Système ML (3 phases)](#11-système-ml-3-phases)
12. [Familiarité Chauffeur × Site](#12-familiarité-chauffeur--site)
13. [Performances & limites](#13-performances--limites)
14. [Glossaire](#14-glossaire)

---

## 1. Vue d'ensemble

Le moteur VRP prend en entrée des missions brutes, des chauffeurs et des exutoires, et produit des tournées journalières ordonnées en 5 à 30 secondes.

```
Entrée
  • Missions (adresse, durée, fenêtre horaire, priorité, contenance benne m³)
  • Chauffeurs (dépôt, véhicule, disponibilité, historique ML)
  • Exutoires (sites de vidage : horaires, types de déchets acceptés)
        │
        ▼
Pipeline 7 étapes (src/lib/vrp/index.ts)
        │
        ▼
Sortie
  • Tournées ordonnées par chauffeur avec horodatages estimés
  • VIDER (vidage) et PAUSE (pauses réglementaires) insérés automatiquement
  • Avertissements pour les contraintes infaisables
  • Score de robustesse CVaR + statistiques multi-objectifs
```

---

## 2. Chaîne de routage (4 niveaux)

Tout le code VRP appelle `realDistanceKm()` / `realDurationMin()` depuis `src/lib/vrp/realDistance.ts` — la source est résolue une seule fois par exécution.

| Priorité | Source | Activation | Qualité |
|----------|--------|------------|---------|
| **4 (meilleure)** | API externe (Trimble Maps, HERE, générique) | `ROUTING_API_TYPE` + `ROUTING_API_KEY` | Données PL certifiées, trafic en temps réel |
| **3** | Valhalla auto-hébergé | `VALHALLA_URL` | Profil véhicule dynamique par requête |
| **2** | OSRM auto-hébergé | `OSRM_URL` | Profil PL statique, durées en flux libre |
| **1 (repli)** | Haversine × tortuosité | Toujours disponible | Estimation géométrique |

**Profil Valhalla** — chaque requête inclut les dimensions exactes du véhicule :
```json
{ "costing": "truck", "costing_options": { "truck": {
  "weight": 26.0, "height": 4.0, "width": 2.55, "length": 12.0,
  "axle_count": 3, "hazmat": false
}}}
```

**Facteurs de tortuosité Haversine :**

| Distance | Facteur |
|----------|---------|
| < 5 km (urbain) | × 1,50 |
| < 20 km (péri-urbain) | × 1,35 |
| ≥ 20 km (autoroute) | × 1,20 |

**Matrice de distances** — construite une fois en début d'exécution (toutes missions + dépôts + exutoires). Consultée en O(1) pendant l'ALNS. Les blocs de ≤ 80 points sont envoyés en parallèle (max 4 requêtes simultanées). Matrice mise en cache Redis 24h, indexée par hash de coordonnées + profil véhicule.

**Modèle de trafic PL** — table de 1 440 entrées (une par minute de la journée) applique une correction par rapport au flux libre :
- 08:00–08:30 pointe du matin : × 1,10 max
- 17:30–18:30 pointe du soir : × 1,08
- Nuit : × 0,90 | Samedi : × 0,85

---

## 3. Formulation du problème

Pathélix résout une variante combinée du problème de tournées de véhicules :

| Variante | Description |
|---------|-------------|
| **VRPTW** | Fenêtres horaires — chaque mission a une plage [au plus tôt, au plus tard] |
| **HFVRP** | Flotte hétérogène — les véhicules ont des capacités max de benne différentes (m³) |
| **VRPB** | Retours — les échanges de bennes imposent une visite à l'exutoire entre deux clients |
| **MDVRP** | Multi-dépôt — les chauffeurs partent de dépôts différents |

**Fonction multi-objectifs** (somme pondérée, ajustable par le planificateur via des curseurs) :

| Objectif | Description |
|----------|-------------|
| Distance | Km totaux parcourus |
| Ponctualité | Violations des fenêtres horaires |
| Équilibre | Variance des durées de tournée |
| Stabilité | Préférence pour les chauffeurs renvoyés sur les sites familiers |

---

## 4. Pipeline 7 étapes

`src/lib/vrp/index.ts`

```
Entrée brute
    │
    ▼  Étape 0 — Démarrage à chaud (warmStart.ts)
       buildWarmStartFromReference() — même jour de la semaine précédente (J-7)
    │
    ▼  Étape 1 — Application des coefficients ML (metricCollector.ts → mlProfileWorker.ts)
       applyMLCoefficients() — ajuste les durées de mission avec les données terrain réelles
    │
    ▼  Étape 2 — Filtrage HFVRP (hfvrp.ts)
       binSizeM3 ≤ maxBinSizeM3 — les missions incompatibles génèrent des avertissements, pas des erreurs
    │
    ▼  Étape 3 — Construction du CostContext (valhallaMatrix.ts / osrmMatrix.ts)
       Matrice de routage + pondérations planificateur + horaires exutoires
    │
    ┌──────────────────────┬──────────────────────┐
    │  ≤ 20 chauffeurs     │  > 20 chauffeurs     │
    ▼                      ▼                      │
ALNS direct          sector.ts : K-means++ 4D     │
                     → ALNS par secteur            │
                     (Worker Threads parallèles)   │
    └──────────────────────┘
    │
    ▼  Étape 5 — Post-optimisation (operators.ts)
       3-opt, chaînes d'éjection, compactage, regroupement déchets
       Optionnel : front de Pareto (paretoFront.ts) + CVaR (stochastic.ts)
    │
    ▼  Étape 6 — Affectation forcée des missions P1
       Missions P1 non affectées → chauffeur le plus proche, insertion à moindre surcoût
    │
    ▼  Étape 7 — Formatage de la solution (formatSolution.ts)
       VIDER/PAUSE synthétiques, sequenceOrder, precomputedTravelMin, statistiques
```

---

## 5. MV-ALNS v6 — Algorithme central

`src/lib/vrp/mvAlns.ts`

### Boucle Destruction–Réparation

```
Solution courante
      │
      ▼  DESTRUCTION — supprime 20–25 % des missions des tournées
      │  (7 opérateurs, sélectionnés par bandit adaptatif)
      ▼  RÉPARATION — réinsère les missions supprimées
      │  (4 opérateurs)
      ▼  ACCEPTATION ?
         Meilleure → toujours acceptée
         Légèrement moins bonne → acceptée probabilistiquement (recuit simulé)
         Bien moins bonne → rejetée
      │
      └─ Répéter jusqu'à épuisement du budget temps
```

### 7 opérateurs de destruction

| Opérateur | Stratégie | Idéal pour |
|-----------|----------|------------|
| `destroyRandom` | Suppression aléatoire | Diversification générale |
| `destroyWorst` | Supprime les missions les plus coûteuses | Amélioration locale |
| `destroyCluster` | Supprime les missions géographiquement proches | Regroupement géographique |
| `destroyRelated` | Supprime les missions similaires (position + fenêtre + type) | Échanges pertinents |
| `destroyWorstRoutes` | Supprime les tournées complètes les moins efficaces | Réduction du nombre de véhicules |
| `destroyString` | Supprime un segment consécutif d'une tournée | Réorganisation locale |
| `destroyViolated` | Supprime les violations de fenêtres, les P1 en retard, les dépassements | Réparation de contraintes |

### 4 opérateurs de réparation

| Opérateur | Stratégie |
|-----------|----------|
| `repairGreedy` | Chaque mission insérée au coût immédiat minimal |
| `repairRegret2` | Priorité aux missions avec peu de bonnes options d'insertion (horizon regret-2) |
| `repairRegret3` | Horizon regret-3 |
| `repairRegret5` | Horizon regret-5 |

### Bandit adaptatif (28 bras = 7 × 4)

Chaque bras (paire destruction + réparation) dispose d'un score dynamique basé sur : amélioration cumulée, vitesse d'exécution, diversité introduite. Biais de probabilité initial selon le type d'instance :
- Beaucoup de fenêtres horaires serrées → favorise `destroyViolated` + `destroyWorst`
- Géographiquement dense → favorise `destroyCluster` + `destroyRelated`

### Recuit simulé

3 modes de température adaptatifs :
- **Plateau** (aucune amélioration depuis longtemps) → refroidissement accéléré × 0,80
- **Amélioration** (nouveau meilleur trouvé) → réchauffage × 1,15 (exploration du voisinage)
- **Normal** → refroidissement standard

### Pool élite

Maintient les meilleures solutions trouvées. Taille : `max(10, 3 × log₂(missions))`.
Une solution n'est admise que si elle diffère d'au moins 8 % de distance de Hamming des élites existantes.

### Mise à l'échelle automatique

| Missions | Itérations | Ratio de destruction |
|----------|------------|----------------------|
| > 10 000 | 200 | 15 % |
| > 5 000 | 300 | 20 % |
| > 1 000 | 400 | 22 % |
| ≤ 1 000 | 500 | 25 % |

Budget temps : 1 seconde pour 100 missions, borné entre [15s, 120s].

### Recherche locale intra/inter-tournée (`operators.ts`)

| Opérateur | Portée |
|-----------|--------|
| `intraRoute2Opt` | Inverse un segment dans une même tournée (bits d'exclusion : réduction 80–90 % des évaluations) |
| `intraRouteOrOpt` | Déplace un groupe dans une même tournée |
| `crossRouteOrOpt` | Déplace un segment entre tournées |
| `crossRoute2Opt` | 2-opt* entre deux tournées |
| `relocateSearch` | Déplace une mission entre tournées |
| `swapSearch` | Échange deux missions entre tournées |
| `ejectionChainSearch` | Réinsertions en cascade sur plusieurs tournées (profondeur 3) |
| `perturbDoubleBridge` | Perturbation à 4 arêtes pour sortir des minima locaux |

### Marges de suffixe — faisabilité d'insertion en O(1)

`src/lib/vrp/insertionCache.ts` — précalcule une passe arrière sur chaque tournée : pour chaque position, quelle est la marge temporelle maximale disponible jusqu'à la fin de la tournée ? La vérification de faisabilité d'insertion devient alors O(1) au lieu de O(n).

---

## 6. Décomposition en secteurs (grandes flottes)

`src/lib/vrp/sector.ts`, `src/lib/vrp/sectorWorker.ts`, `src/lib/vrp/threadPool.ts`

Déclenchée à partir de 20 chauffeurs. Découpe le problème en sous-problèmes de taille cible, chacun résolu par ALNS indépendamment.

### Métrique de distance K-means++ 4D

```
distance(mission_a, mission_b) =
  1,0 × (distance_géographique)²
+ 0,3 × (écart_centre_fenêtre_horaire / 1440)²
+ 0,2 × (écart_taille_benne / 40)²
```

La dimension fenêtre horaire empêche toutes les missions tôt le matin de se regrouper dans un seul secteur.

### Tailles de secteur cibles

| Nombre de chauffeurs | Taille cible | Raison |
|---------------------|--------------|--------|
| ≤ 50 | 15 | Gérable pour l'ALNS |
| ≤ 150 | 12 | Équilibre qualité/vitesse |
| ≤ 300 | 8 | Grandes instances |
| ≤ 600 | 6 | Très grandes instances |
| > 600 | 5 | Flottes massives |

### Parallélisme

`VRP_USE_THREADS=true` exécute les secteurs dans des Worker Threads Node.js isolés. Gain mesuré : **×3–×4** pour les instances > 200 chauffeurs.

`VRP_THREAD_CONCURRENCY` = cœurs disponibles − 4 (réservés pour l'OS + App + Redis + Postgres).

Après l'optimisation par secteur, une phase Or-opt inter-secteurs échange des missions entre secteurs voisins pour corriger les artefacts de la décomposition.

---

## 7. Modèle de coût

`src/lib/vrp/routeCost.ts`

### Coût total de la solution

```
coût_total = Σ(coûts_tournées)
           + 50 × nombre_véhicules_actifs        (coût fixe par véhicule)
           + 0,8 × CV(heures_de_travail)         (pénalité de déséquilibre de charge)
```

`CV` = coefficient de variation des heures de travail entre tournées.

### Pénalités de tournée

| Événement | Pénalité | Formule |
|-----------|---------|---------|
| Dépassement (> 10h) | 30 000 (fixe) + 300/min | Très élevé — forte dissuasion |
| Visite exutoire fermé | 800 | — |
| Violation fenêtre horaire | quadratique | `retardMin × 2 + retardMin² / 30` |
| Violation fenêtre P1 | quadratique (plus stricte) | `retardMin × 3 + retardMin² / 20` |
| Longue journée (> 9h) | 20/min | Pénalise avant le seuil de dépassement |
| Pause déjeuner manquée | 80 | Aucune pause entre 12h00 et 13h30 |

### Conformité réglementaire CE 561/2006

| Règle | Valeur |
|-------|--------|
| Temps de travail max/jour | 600 min (10h) |
| Conduite max/jour | 540 min (9h) |
| Conduite continue max | 270 min (4h30) avant pause obligatoire |
| Durée de la pause obligatoire | 45 min |
| Repos journalier minimum | 660 min (11h) |
| Max hebdomadaire | 2 880 min (48h) |

---

## 8. Post-optimisation (étapes 5–6)

`src/lib/vrp/paretoFront.ts`, `src/lib/vrp/stochastic.ts`

### Étape 5 — Post-optimisation

| Passe | Description | Désactivée quand |
|-------|-------------|------------------|
| 3-opt | Recombine 3 arêtes sur les 5 tournées les plus coûteuses | > 500 tournées |
| Chaînes d'éjection (profondeur 3) | Réinsertions en cascade entre tournées | > 200 tournées |
| Compactage de tournées | Fusionne les tournées sous-chargées pour réduire le nombre de véhicules | > 200 tournées |
| Regroupement déchets | Groupe les missions par type de déchet dans chaque tournée pour réduire les aller-retours à l'exutoire | Toujours actif |

### Étape 5b — Front de Pareto (optionnel, `options.usePareto = true`)

Ajoute ~50 % au temps de calcul. Trois exécutions ALNS avec des pondérations différentes :

| Exécution | Priorité | Objectif |
|-----------|----------|---------|
| Exécution 1 | Pondérations utilisateur | Solution équilibrée (par défaut) |
| Exécution 2 | Distance × 3 | Km minimaux / économie carburant maximale |
| Exécution 3 | Équilibre × 3 | Durées de tournée égales |

Le tri non-dominé (`filterParetoFront`) sélectionne la meilleure selon les pondérations du planificateur. Front complet exposé dans `stats.paretoFront`.

### Score de robustesse CVaR

5 scénarios stochastiques évalués (nominal, optimiste, légèrement pessimiste, fortement pessimiste, pire cas). **CVaR** = coût moyen des 30 % pires scénarios. Retourné dans `stats.cvarScore`. Un CVaR proche du coût nominal indique une solution robuste.

### Étape 6 — Affectation forcée des missions P1

Missions P1 non affectées après optimisation :
1. Trouver le chauffeur géographiquement le plus proche
2. Insérer à la position de moindre surcoût
3. Un léger dépassement est autorisé — la mission P1 est toujours placée

---

## 9. Formatage de la solution (étape 7)

`src/lib/vrp/formatSolution.ts`

**Insertion synthétique de VIDER** — logique multi-compartiments : visite à l'exutoire déclenchée quand :
- le nombre de bennes atteint le maximum du véhicule (ex. 2 bennes), OU
- le volume total chargé (m³) dépasse la capacité volumétrique du véhicule

**Insertion synthétique de PAUSE** — pauses réglementaires (45 min après 4h30 de conduite) insérées aux positions optimales.

**`sequenceOrder`** — index séquentiel de la mission dans sa tournée.

**`precomputedTravelMin`** — temps de trajet côté serveur pour chaque mission, stocké sur l'objet mission. Le client affiche les plannings depuis ce champ sans recalcul, garantissant la cohérence avec les durées de l'algorithme.

**Statistiques générées** : distance totale, heures de travail par chauffeur, comptes de missions, coût estimé (carburant + km), score CVaR, décomposition multi-objectifs, front de Pareto si activé.

---

## 10. Ré-optimisation en temps réel

Même pipeline, paramètres différents :

| Paramètre | Standard | Temps réel |
|-----------|----------|------------|
| Point de départ | Dépôt | Position GPS actuelle |
| Heure de départ | 07:00 | Heure courante |
| Missions exclues | Aucune | `done`, `started`, `arrived` (verrouillées) |
| Budget temps | 15–120 s | 10 s max |
| Mode | Asynchrone (BullMQ) | Synchrone (résultat immédiat) |
| Poids ponctualité | Configurable | Élevé (les missions restantes ont des délais serrés) |

Cas d'usage : camion en panne (redistribuer les missions restantes), embouteillage (recalculer depuis la position bloquée), urgence P1 (insérer dans la tournée la plus proche).

---

## 11. Système ML (3 phases)

### Phase 1 — Collecte (temps réel)

`src/lib/metricCollector.ts`

Quand un chauffeur marque une mission comme terminée, trois durées réelles sont enregistrées :
- Temps de trajet : `(arrivée − départ)`
- Temps de manœuvre : `(début_travail − arrivée)`
- Temps d'intervention : `(fin − début_travail)`

**3 boucliers qualité** rejettent les données non fiables :
1. Clic trop rapide (< 10s entre deux étapes) → REJETÉ
2. Durée aberrante (> 4× la durée attendue) → REJETÉ
3. GPS incohérent (0 min de trajet mais delta GPS > 10 km) → REJETÉ

Les enregistrements valides sont stockés dans `InterventionMetric` avec `isReliable=true` et un `confidenceScore` [0, 1].

### Phase 2 — Calcul des coefficients (nuit à 02:00)

`src/workers/mlProfileWorker.ts`

Pour chaque tenant actif, charge toutes les métriques fiables et calcule les coefficients par portée :

| Portée | Observations min |
|--------|-----------------|
| Global (tenant) | ≥ 30 |
| Par type de mission | ≥ 15 |
| Par chauffeur | ≥ 20 |
| Par site | ≥ 10 |

Méthode : médiane tronquée P10–P90 (élimine les 10 % les plus rapides et les 10 % les plus lents avant le calcul de la médiane — robuste aux valeurs aberrantes).

Stocké dans `TenantMLProfile`.

### Phase 3 — Application (avant chaque optimisation)

`src/lib/vrp/index.ts` → `applyMLCoefficients()`

Hiérarchie des coefficients (du plus précis au plus général) :

```
1. chauffeur + type de mission  → ex. 0,85 (chauffeur pose les bennes rapidement)
2. site + type de mission       → ex. 1,40 (site difficile d'accès)
3. chauffeur (tous types)       → ex. 0,92
4. type de mission (tous)       → ex. 1,10
5. global tenant                → ex. 1,05
6. aucun                        → 1,00 (pas de correction)
```

Correction appliquée uniquement si delta > 5 % (sinon bruit statistique). Borné entre [0,3 ; 3,0].

### Cycle de maturité

| Phase | Observations fiables | Corrections disponibles |
|-------|---------------------|------------------------|
| Débutant | 0 | Aucune (tous coefficients = 1,0) |
| Apprentissage | 30–150 | Global uniquement |
| Intermédiaire | 150–500 | Par type + quelques chauffeurs/sites |
| Mature | 500+ | Complet par chauffeur × par site × par type |

Avec 5 chauffeurs et 20 missions/jour → ~100 métriques/semaine → maturité complète en ~5 semaines.

---

## 12. Familiarité Chauffeur × Site

Un bonus de coût négatif encourage la réaffectation des chauffeurs sur les sites qu'ils connaissent.

### Formule

```
si visites < 5 : pas de bonus (données insuffisantes)
bonus = -min(15, log₂(visites) × 2,5) × poidsStabilité
```

| Visites (30 derniers jours) | Bonus de coût |
|-----------------------------|---------------|
| 5 | −5,8 |
| 10 | −8,3 |
| 20 | −10,8 |
| ≥ 50 | −15,0 (plafonné) |

La courbe logarithmique assure une montée rapide puis un plateau — empêche qu'un chauffeur monopolise un site au détriment de l'équilibre des tournées.

Le planificateur contrôle l'intensité via un curseur Stabilité [0–100 %] :
- 100 % : bonus plein actif → forte préférence pour les habitudes
- 0 % : bonus désactivé → historique complètement ignoré

---

## 13. Performances & limites

### Benchmarks

| Instance | Chauffeurs | Missions | Temps typique |
|----------|-----------|---------|---------------|
| Petite | 2 | 10 | < 5 s |
| Moyenne | 5–10 | 50–100 | 5–15 s |
| Grande | 20–50 | 200–500 | 15–30 s |
| Très grande | 100+ | 1 000+ | 30–120 s |
| Maximum supporté | 1 000 | 50 000 | Variable (parallélisé) |

Qualité de solution : typiquement dans les **1–3 %** de l'optimum théorique sur les instances de référence.

### Limites connues

| Limite | Détail |
|--------|--------|
| Couverture cartographique | France via Valhalla (~4 Go de tuiles). Repli OSRM limité à Rhône-Alpes (~6 Go RAM) |
| Concurrence | Un job VRP à la fois par worker (`VRP_CONCURRENCY=1`). Le parallélisme est interne via les secteurs (`VRP_USE_THREADS`) |
| RAM Valhalla | 4–12 Go (France complète) |
| Planification multi-jours | Le planning hebdomadaire optimise lun.–ven. via `POST /api/weekly-plan` (API uniquement, pas d'UI) |
| Pareto | Désactivé par défaut (`options.usePareto=true` requis) — ajoute ~50 % au temps de calcul |

### Variables d'environnement

| Variable | Rôle |
|----------|------|
| `VALHALLA_URL` | Moteur de routage Valhalla |
| `OSRM_URL` | Repli OSRM |
| `ROUTING_API_TYPE` | `trimble` / `here` / `generic` |
| `ROUTING_API_KEY` | Clé API de routage externe |
| `VRP_USE_THREADS` | `true` pour activer le parallélisme Worker Thread |
| `VRP_THREAD_CONCURRENCY` | Nombre de threads secteur parallèles (défaut : cœurs CPU − 4) |
| `VRP_CONCURRENCY` | Nombre max de jobs VRP simultanés par worker (défaut : 1) |

---

## 14. Glossaire

| Terme | Définition |
|-------|-----------|
| **ALNS** | Adaptive Large Neighborhood Search — méta-heuristique centrale |
| **Bandit adaptatif** | Mécanisme d'apprentissage en ligne sélectionnant les meilleures combinaisons d'opérateurs |
| **CVaR** | Conditional Value at Risk — coût moyen des 30 % pires scénarios stochastiques |
| **CostContext** | Structure de données centrale partagée par tous les composants de l'algorithme |
| **Destruction / Réparation** | Opérateurs ALNS : supprime un sous-ensemble de la solution puis la reconstruit |
| **Chaîne d'éjection** | Cascade de réinsertions sur plusieurs tournées |
| **Pool élite** | Ensemble des meilleures solutions trouvées pendant l'optimisation |
| **Exutoire** | Site de vidage (déchetterie, centre de tri) où les bennes sont déposées |
| **HFVRP** | Heterogeneous Fleet VRP — flotte de véhicules à capacités mixtes |
| **Haversine** | Formule de distance orthodromique entre coordonnées GPS |
| **K-means++** | Algorithme de clustering avec initialisation améliorée des centroïdes |
| **MLD** | Multi-Level Dijkstra — algorithme de routage exact utilisé par OSRM |
| **MV-ALNS** | Multi-Vehicle ALNS — la variante multi-véhicule implémentée ici |
| **Or-opt** | Opérateur qui déplace une chaîne de missions dans/entre les tournées |
| **OSRM** | Open Source Routing Machine — repli de routage |
| **Front de Pareto** | Ensemble de solutions non dominées : A domine B si meilleur sur tous les objectifs |
| **Recuit simulé** | Acceptation probabiliste de solutions légèrement moins bonnes pour sortir des minima locaux |
| **Marges de suffixe** | Marges temporelles arrière précalculées permettant des vérifications de faisabilité d'insertion en O(1) |
| **Tenant** | Une entreprise cliente sur la plateforme SaaS (données complètement isolées) |
| **Valhalla** | Moteur de routage principal — profil véhicule dynamique par requête (poids, hauteur, largeur, longueur, essieux, matières dangereuses) |
| **Démarrage à chaud** | Initialise l'optimisation depuis le plan du même jour de la semaine précédente (J-7) pour démarrer près de l'optimum |
| **VRPTW** | VRP avec fenêtres horaires |
| **Worker Thread** | Thread Node.js isolé pour le calcul parallèle des secteurs |
