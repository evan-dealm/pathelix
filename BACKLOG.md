# BACKLOG.md — Développements différés

> Éléments identifiés mais non implémentés. Chaque entrée contient le contexte exact pour reprendre sans redécouverte.

---

## D1 — Contrainte de poids cumulé par tournée (PTAC)

**Priorité** : Basse — implémenter uniquement si un client le demande explicitement.

### Contexte

Identifié lors de l'audit métier scierie (2026-06-19, `VERIFICATION_METIERS.md`).

Un grumier (26t ou 44t PTAC) charge plusieurs livraisons bois. Le VRP actuel ne vérifie pas que la somme des poids livrés sur une tournée respecte le PTAC du camion.

### État actuel du code

- `Driver.capacityDimensions.volume` (m³ total) : lu dans `src/lib/vrp/multiCompartment.ts` et `src/lib/vrp/routeCost.ts` — actif
- `Driver.capacityDimensions.nbBennes` : lu dans les mêmes fichiers — actif
- `Driver.vehicleCapacity` : nombre de bennes max — actif
- `Driver.maxBinSizeM3` : taille max benne compatible — vérifié dans HFVRP check (`src/lib/vrp/index.ts` L.124-136)
- `Mission.binSizeM3` : volume m³ d'une benne/livraison — utilisé dans le HFVRP check

**Ce qui a été retiré** : `capacityDimensions.poids` avait été défini dans le type TypeScript (`src/lib/types.ts`) mais n'était jamais lu nulle part dans le VRP. Champ supprimé le 2026-06-19 (code mort).

La contrainte de `capacityDimensions.poids` n'apparaît pas dans le schéma Prisma comme champ dédié — `capacityDimensions` est un champ `Json`. Les données éventuellement stockées sous la clé `poids` dans la DB ne sont pas lues et ne servent à rien.

### Ce qu'il faudrait implémenter

1. **Ajouter `weightKg?: number` sur `Mission`** (Prisma migration) — poids en kg d'une livraison individuelle
2. **Ajouter `ptacKg?: number` sur `Driver`** (Prisma migration) — ou réutiliser `capacityDimensions` avec une clé `poids` réactivée
3. **Dans `multiCompartment.ts`** : ajouter une dimension `weightLoadedKg` dans `LoadState` et une vérification `weightLoadedKg + mission.weightKg > driver.ptacKg`
4. **Dans le VRP ALNS** : s'assurer que les opérateurs de réinsertion respectent la contrainte poids (déjà respecté si `needsDump` est étendu)
5. **Tests VRP** : couvrir le cas route overweight → driver splitting

### Proxy acceptable au démarrage scierie

Utiliser `binSizeM3` comme volume de bois livré (m³) et `maxBinSizeM3` comme charge utile volume du camion. Approximation valable si la flotte n'est pas mixte et si le client accepte la contrainte en m³ plutôt qu'en tonnes.

### Déclencheur d'implémentation

Client qui demande explicitement la conformité PTAC avec des chargements de densités différentes (chêne ~0.7t/m³ ≠ pin ~0.5t/m³) ou flotte mixte grumier/porteur sur les mêmes tournées.

---
