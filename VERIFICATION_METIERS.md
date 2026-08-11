# VERIFICATION_METIERS.md — Audit parcours métiers

> Date : 2026-06-19 | Gates : lint ✓ · typecheck ✓ · tests 3389/3389 ✓

---

## PARTIE 1 — COLLECTE_RECYCLAGE

### Vocabulaire — cohérent ✅

| Champ | Valeur |
|-------|--------|
| driver / drivers | Chauffeur / Chauffeurs |
| vehicle / vehicles | Camion / Camions |
| mission / missions | Mission / Missions |
| exutoire / exutoires | Exutoire / Exutoires |
| depot | Dépôt |
| client | Client |
| binSize | Taille benne |
| wasteType | Type de déchet |
| optimize / collect | Optimiser / Collecter |

### Types de mission — adaptés ✅

Tous les 10 types activés : POSER · RETIRER · ECHANGER · VIDER · PAUSE · CHARGER_IMMEDIAT · DEPLACER · TASSER · EXPEDIER · ALLER_RETOUR

- TASSER et ALLER_RETOUR uniques à ce métier (absents des 5 autres — vérifié par test)
- VIDER = "Vidage", TASSER = "Tassage" — labels métier corrects
- POSER = "Pose" (distinct de "Livraison" de distribution)

### Corrections appliquées ✅

**MissionsTab.tsx** (4 violations hardcodées corrigées) :
- `placeholder="Rechercher client, adresse, chauffeur…"` → `vocab.driver`
- `— Chauffeur —` (select assignation) → `vocab.driver`
- `Client / Exutoire` (colonne) → `Client / {vocab.exutoire}`
- `Déchets / Benne` (colonne) → `{vocab.wasteType} / {vocab.binSize}`

**MissionForm.tsx** (5 violations corrigées) :
- `label="3. Produit (matiere + benne)"` → `vocab.wasteType + vocab.binSize`
- `Exutoire: {name}` (produit sélectionné) → `vocab.exutoire`
- `label="Matiere"` → `vocab.wasteType`
- `label="Materiel / Benne"` → `vocab.binSize`
- `label="Exutoire…"` + `-- Aucun exutoire --` → `vocab.exutoire`

**admin/page.tsx** (9 violations corrigées) :
- Nav sidebar : `chauffeurs` → `vocab.drivers.toLowerCase()`
- Header breadcrumb : `chauffeurs` → `vocab.drivers.toLowerCase()`
- Dashboard stat : `Chauffeurs avec plan` → `${vocab.drivers} avec plan`
- Toasts : "Chauffeur mis à jour / créé / supprimé / non sauvegardé" → `vocab.driver`
- Confirm dialog : "Supprimer ce chauffeur" → `vocab.driver`
- DriverForm titles : "Nouveau chauffeur / Modifier le chauffeur" → `vocab.driver`
- Audit checks (×3) : messages `chauffeur(s)` → `vocab.driver/drivers`

### Tests

**`src/lib/__tests__/tradeAudit.test.ts`** — 31 tests verts (28 initiaux + 3 nouveaux C1/C2/C3)
**`src/app/api/__tests__/history-status.test.ts`** — 19 tests verts (GET driver-status corrigé avec session cookie)

---

## PARTIE 2 — SCIERIE / LIVRAISON DE BOIS

### Recommandation : **BTP_LOCATION** ✅

### Ajustements config C1/C2/C3 — **appliqués** ✅

Modifiés dans `src/lib/trades.ts` (`TRADES.btp_location.vocabulary`) :

| # | Champ | Avant | Après |
|---|-------|-------|-------|
| C1 | `mission` / `missions` | "Intervention" / "Interventions" | **"Livraison" / "Livraisons"** |
| C2 | `client` | "Chantier" | **"Client"** |
| C3 | `binSize` | "Équipement" | **"Référence produit"** |

> Note : BTP_LOCATION est maintenant orienté livraison. Si un prospect BTP pur signe (avec intervention = maintenance sur chantier), créer un trade custom `btp_pur` dérivé avec `mission: "Intervention"`.

### Vocabulaire BTP_LOCATION après corrections ✅

| Champ | Valeur |
|-------|--------|
| driver / drivers | Chauffeur / Chauffeurs |
| vehicle / vehicles | Camion / Camions |
| mission / missions | Livraison / Livraisons ✅ |
| exutoire / exutoires | Dépôt matériel / Dépôts matériel |
| depot | Base |
| client | Client ✅ |
| binSize | Référence produit ✅ |
| wasteType | Type de matériel |
| POSER label | "Livraison" |
| RETIRER label | "Récupération" |
| VIDER label | "Retour dépôt" |

---

### Analyse D1 — Contrainte poids camion (PTAC)

**Résultat : manque réel, mais non bloquant pour le démarrage.**

#### Ce qui existe déjà

- `Driver.vehicleCapacity` (entier) : nombre de bennes que le camion peut emporter — utilisé dans `multiCompartment.ts` pour compter les RETIRER/ECHANGER chargés
- `Driver.maxBinSizeM3` (volume m³) : taille max de benne compatible — utilisé dans le check HFVRP (`mission.binSizeM3 <= driver.maxBinSizeM3`) pour rejeter les missions incompatibles au chargement
- `Driver.capacityDimensions.volume` (m³ total) : volume cumulatif max — utilisé dans `multiCompartment.ts` pour déclencher les vidages
- `Driver.capacityDimensions.poids` (number) : **champ défini dans le type TypeScript mais jamais lu nulle part dans le moteur VRP** — champ mort

#### Ce qui manque pour scierie

Le VRP gère la capacité en nombre de bennes et en m³, logique pensée pour la collecte rotative (RETIRER + aller au VIDER + RETIRER à nouveau). Pour la livraison de bois :

- Il n'existe pas de contrainte `poids de la charge livrée ≤ PTAC du camion` sur l'ensemble de la route
- Il n'existe pas de champ `weightKg` sur Mission (poids d'une livraison individuelle)
- Le check binSizeM3 peut servir de proxy si le client saisit le volume en m³ de bois, mais volume ≠ tonnes (densité variable selon l'essence : chêne ~0,7t/m³, pin ~0,5t/m³)
- Pour un grumier 26t ou 44t multi-essaims, le vrai risque est le dépassement PTAC, pas le volume

**Action nécessaire si dépassement PTAC est un enjeu légal** : ajouter `weightKg` sur `Mission` (Prisma migration) et activer `Driver.capacityDimensions.poids` dans le VRP. **Pas toucher VRP sans accord.** À inscrire en backlog.

**Pour le démarrage scierie** : utiliser `binSizeM3` comme volume de bois livré (m³) et `maxBinSizeM3` comme charge utile volume du camion. Approximation acceptable si la flotte n'est pas mixte et si le client accepte la contrainte en m³.

---

### Analyse D4 — Preuve de livraison signée

**Résultat : fonctionnalité existante couvre les besoins scierie. Pas de développement nécessaire.**

#### Ce qui existe déjà

- Modèle Prisma `DeliveryProof` : `photoUrl`, `signatureUrl`, `notes` (texte libre), `capturedAt`
- Route `POST /api/delivery-proof` : accepte multipart form avec `photo` (JPEG/PNG), `signature` (JPEG/PNG), `notes`, liée à `missionId`
- Route `GET /api/missions/[id]/proof` : récupération de la preuve
- Interface driver UI : capture photo + signature canvas + notes

#### Adéquation scierie

Un bon de livraison (BL) de bois est un document commercial standard (pas réglementaire, contrairement au BSDD déchet). Il contient : client, adresse, référence produit (essence + longueur), quantité (m³ ou stères), numéro BL.

Ces données sont **déjà dans la mission** :
- Client → `mission.clientName`
- Adresse → `mission.address`
- Référence produit → `mission.binSize` (= "Référence produit" après C3)
- Quantité → `mission.binSizeM3` + `mission.wasteTypeLabel`

Le champ `notes` du `DeliveryProof` suffit pour que le chauffeur note toute précision (numéro BL, réserves). La photo du déchargement + signature client couvrent le besoin.

**Ce qui serait "nice to have"** (pas développement, config PDF) : générer un PDF pré-rempli depuis les champs mission avec le label "Bon de livraison" plutôt que "Preuve de livraison". Si une route d'export PDF du proof existe déjà, c'est un changement de template/libellé uniquement.

**Pas de besoin réglementaire wood-tracking** (pas d'équivalent BSDD pour le bois non-PEFC/FSC en France sur ce type de livraison).

---

## Résumé gates

| Gate | Statut |
|------|--------|
| TypeScript strict (`tsc --noEmit`) | ✅ 0 erreurs |
| Vitest (188 fichiers, 3389 tests) | ✅ 100% vert |
| VRP intact | ✅ non touché |
| Modifications lourdes sans accord | ✅ aucune |

### Fichiers modifiés (session complète)

| Fichier | Nature |
|---------|--------|
| `src/lib/trades.ts` | C1/C2/C3 : mission→"Livraison", client→"Client", binSize→"Référence produit" |
| `src/lib/__tests__/tradeAudit.test.ts` | 31 tests audit métiers (nouveau + mises à jour C1/C2/C3) |
| `src/lib/__tests__/trades.test.ts` | Assertions btp_location mises à jour |
| `src/components/admin/tabs/MissionsTab.tsx` | Vocabulaire `vocab.*` (4 fixes) |
| `src/components/admin/MissionForm.tsx` | Vocabulaire `vocab.*` (5 fixes) |
| `src/app/admin/page.tsx` | Vocabulaire `vocab.*` (9 fixes) |
| `src/app/api/__tests__/history-status.test.ts` | Tests GET driver-status (auth cookie) |

### Décisions restantes

| # | Sujet | Complexité | Recommandation |
|---|-------|-----------|---------------|
| D1 | Contrainte poids PTAC camion | Fort (migration + VRP) | Backlog — proxy m³ suffisant au démarrage |
| D4 | PDF "Bon de livraison" pré-rempli | Config (template PDF) | Config si route export PDF existe, sinon mineur |
| — | Trade custom `btp_pur` si prospect BTP pur | Config uniquement | Créer quand besoin confirmé |
