# AUDIT_BUGS.md — Audit exhaustif août 2026

Contexte : audit complet demandé le 2026-08-12, mené après l'audit pré-pilote déjà exhaustif de
juillet 2026 (`AUDIT_TRACKING.md`, 120 routes + 11 pages auditées, 14 bugs corrigés avec tests de
régression, 3411 tests). Cet audit ne repart pas de zéro sur ce que juillet a déjà couvert et
testé — il vérifie les invariants critiques sur TOUT le code sans se fier aveuglément au tableau
de juillet, et couvre en profondeur tout ce qui a été ajouté depuis (composants UI, imageUtils,
ml-accuracy, load-tests, offline e2e).

Méthode : 6 agents de lecture en parallèle, partitionnés par sous-système (VRP/ML, auth/isolation
tenant, routes API/Zod, webhooks/offline/SSE, frontend, data/Prisma/workers), chacun lisant
l'intégralité de son périmètre ligne par ligne. Un agent (auth/tenant) a dépassé son périmètre
assigné et corrigé un bug de son propre chef (B7 ci-dessous) au lieu de se limiter à l'audit —
son correctif a été vérifié indépendamment (lint/typecheck/tests ciblés + suite complète) avant
d'être conservé.

Légende sévérité : 🔴 critique · 🟠 majeure · 🟡 mineure
Légende confiance : CONFIRMÉ (chemin de code tracé) · À VÉRIFIER (suspect, pas tracé à 100%)
Statut : `à corriger` → `corrigé + testé` (avec commit) ou `accepté tel quel` (si non actionnable
sans décision produit) ou `à valider par l'utilisateur` (touche à une zone sensible type
Trackdéchets HALT ou nécessite un arbitrage architecture que je ne peux pas trancher seul).

---

## 🔴 Critique

### C1 — Fonctionnalité de scan de ticket de pesée structurellement inaccessible
- **Fichiers** : `src/app/driver/[id]/page.tsx:298-302,344`, `src/components/driver/ScanTicketButton.tsx:24`
- **Catégorie** : logique métier
- **Confiance** : CONFIRMÉ (tracé via la logique de dérivation d'état ; non rejoué en navigateur)
- **Description** : `currentMission = realMissions.find(m => statuses[m.id] !== 'done')`.
  `ScanTicketButton` n'affiche son UI de scan que si `status === 'done'` pour la mission qu'on lui
  passe. Mais le composant ne reçoit jamais que `currentMission` — et à l'instant où le statut
  d'une mission passe à `'done'`, `currentMission` est recalculé sur la mission suivante non-done
  (ou `null` → écran "Journée terminée", qui n'affiche pas non plus le bouton). Les deux
  conditions (`currentMission === X` et `statuses[X] === 'done'`) sont mutuellement exclusives par
  construction. La vue liste (`showAll`) n'affiche pas non plus `ScanTicketButton`.
- **Impact** : la fonctionnalité OCR de ticket de pesée (missions VIDER → `/api/ai/ocr` →
  `/api/ai/jobs/[id]`) est **inutilisable** par un chauffeur via le flux prévu. Aucun test ne le
  détecte : `ScanTicketButton.test.tsx` teste le composant isolément en lui passant directement
  `status='done'`, sans jamais reproduire l'interaction avec le parent qui ne produit jamais cette
  combinaison.
- **Correction proposée** : découpler l'UI de scan de `currentMission` — suivre un id distinct
  "mission en attente de scan ticket" au lieu de dériver purement de `currentMission`, ou afficher
  le bouton dans une sous-étape de complétion avant de passer à la mission suivante.
- **Statut** : ✅ **corrigé + testé**. Ajout d'un état `pendingScanMissionId` détecté via un
  `useEffect` qui diffuse les transitions de statut (ancien statut ≠ 'done', nouveau statut ===
  'done', type === 'VIDER') — indépendant de `currentMission`. Un écran intermédiaire
  "Vidage terminé" affiche désormais `ScanTicketButton` pour la mission qui vient d'être
  complétée, avec un bouton "Continuer" pour reprendre le flux normal. Test de régression ajouté
  (`scanTicketFlow.test.tsx`) qui échouait avant le correctif (le flux sautait directement à la
  mission suivante) et passe après.
  Note technique : une première tentative (lire un flag positionné à l'intérieur du updater
  `setStatuses` juste après l'appel) s'est avérée incorrecte — React n'exécute pas forcément
  l'updater de façon synchrone au moment de l'appel, donc le flag n'était pas encore posé au
  moment de la lecture. D'où le passage à un `useEffect` qui réagit à `statuses` une fois le
  re-render effectif, seule approche fiable ici.

---

## 🟠 Majeures

### M1 — Missions synthétiques VIDER/PAUSE créables par un utilisateur
- **Fichiers** : `src/lib/schemas.ts` (`MissionSchema.type`), `src/app/api/missions/route.ts`,
  `src/app/api/import/route.ts`
- **Catégorie** : logique métier / incohérence de données
- **Confiance** : CONFIRMÉ
- **Description** : `MissionSchema.type` accepte les 10 valeurs de l'enum, y compris `VIDER` et
  `PAUSE`. `POST /api/missions` et `POST /api/import` laissent créer une vraie ligne `Mission`
  persistée avec `type: 'VIDER'` ou `'PAUSE'`. Or ces deux types sont censés être générés
  uniquement par le moteur VRP (`formatSolution.ts` les marque `isSynthetic: true` en mémoire — un
  champ qui n'existe même pas sur le modèle Prisma persisté). Aucun garde-fou ne rejette une
  création utilisateur de ces types.
- **Scénario concret** : `POST /api/missions {"type":"VIDER","date":"2026-08-20",...}` → 201,
  ligne `Mission` réelle créée, sans lien exutoire obligatoire.
- **Impact** : pollue les entrées de planification VRP, fausse le suivi de capacité/comptage de
  vidages, le reporting CO2, et les statistiques par type de mission de `/api/superadmin/ml-accuracy`.
- **Correction proposée** : `.refine()` sur `MissionSchema` rejetant `type` ∈ `['VIDER','PAUSE']`
  avec message explicite ; même contrôle dans la boucle de validation ligne-par-ligne de l'import.
- **Statut** : ✅ **corrigé + testé**. `MissionSchema` (POST) et nouveau `MissionUpdateSchema`
  (PUT, remplace l'ancien `MissionSchema.partial()`) rejettent `type` ∈ `['VIDER','PAUSE']` via
  `.refine()`. Import bulk (`/api/import`) rejette aussi ces types ligne par ligne avec message
  explicite. Tests ajoutés : `schemas.test.ts` (4 tests), `routes-import-clients-history.test.ts`
  (1 test).

### M2 — Suppression permanente d'abonnements push valides sur erreur transitoire
- **Fichier** : `src/lib/webPush.ts:46-54`, appelant `src/app/api/push/notify/route.ts:43-53`
- **Catégorie** : fiabilité (edge case) / incohérence de données
- **Confiance** : CONFIRMÉ
- **Description** : `sendPushNotification` retourne `false` aussi bien pour un abonnement
  réellement expiré (410/404) que pour toute autre erreur (500 du service push, timeout, 429,
  erreur payload) — même valeur de retour. L'appelant traite tout `false` comme "expiré" et
  supprime l'abonnement en base.
- **Impact** : un pic de latence ou une panne temporaire du service push entraîne la suppression
  définitive d'abonnements valides — le chauffeur ne reçoit plus rien sans savoir pourquoi.
- **Correction proposée** : remonter le statusCode réel (`{ ok: boolean, expired: boolean }` au
  lieu d'un simple booléen), ne supprimer que si `expired === true`.
- **Statut** : ✅ **corrigé + testé**. `sendPushNotification` retourne désormais
  `{ ok, expired }` ; `expired` n'est `true` que sur 410/404 confirmé par le service push. La
  route `/api/push/notify` ne supprime que les abonnements `expired`, et remonte `failed`
  (total, y compris transitoires) séparément de la suppression. `broadcastToTenant` avait le
  même bug par ricochet (son tableau `expired[]` reposait sur `Promise.allSettled` + rejet, alors
  que `sendPushNotification` ne rejette jamais — `expired[]` était donc toujours vide,
  silencieusement ; corrigé au passage, aucun appelant actuel n'utilisait ce champ donc aucune
  régression fonctionnelle, juste une correction de dette). Tests ajoutés/mis à jour :
  `webPush.test.ts` (nouveaux cas 500 vs 410/404, `broadcastToTenant.expired[]`),
  `push-predictions-routing.test.ts` (nouveau test : échec transitoire ne supprime pas
  l'abonnement).

### M3 — Isolation tenant absente à l'écriture des positions GPS OBD/Geotab/Samsara
- **Fichiers** : `src/app/api/webhooks/obd/route.ts`, `src/app/api/webhooks/geotab/route.ts:88-104`,
  `src/app/api/webhooks/samsara/route.ts:86-105`, `src/lib/obdStore.ts:30-56`
- **Catégorie** : sécurité / incohérence de données
- **Confiance** : CONFIRMÉ (comportement) — sévérité/traitement à discuter, peut être un choix
  produit assumé (matériel OBD non multi-tenant par nature)
- **Description** : `recordOBDReading()` écrit dans une Map globale indexée uniquement par
  `driverId`, sans vérifier que ce `driverId` appartient au tenant résolu par la requête. Le
  webhook OBD n'a qu'un secret global unique (`OBD_WEBHOOK_TOKEN`) sans résolution de tenant du
  tout.
- **Impact** : falsification possible de position/vitesse d'un chauffeur d'un autre tenant par
  quiconque connaît le token OBD ou contrôle une intégration Geotab/Samsara mal configurée. La
  lecture reste bien filtrée par tenant (`driver-position/route.ts`) — c'est l'écriture qui fuit.
- **Correction proposée** : pour Geotab/Samsara, valider `driverId ∈ getTenantDriverIds(tenantId)`
  avant `recordOBDReading`. Pour OBD, scoper par tenant ou documenter le risque comme assumé.
- **Statut** : à valider par l'utilisateur (choix produit avant correction — voir résumé final)

### M4 — Aucune isolation par tentative/template dans le worker de missions récurrentes
- **Fichier** : `src/workers/recurringMissionsWorker.ts:57-111`
- **Catégorie** : fiabilité
- **Confiance** : CONFIRMÉ
- **Description** : pas de try/catch autour de `prisma.mission.create` par occurrence (seul le
  parsing RRule est gardé). Une exception sur UN template (FK stale, contrainte) fait échouer tout
  le job BullMQ, pour tous les tenants. Pas de `attempts`/`backoff` sur `queue.add` → pas de retry
  automatique, prochaine chance = CRON du lendemain (jusqu'à 24h de blocage silencieux).
- **Impact** : un template défaillant bloque la génération de missions récurrentes pour TOUS les
  tenants jusqu'à 24h.
- **Correction proposée** : try/catch par occurrence, logger + continuer sur échec au lieu de
  propager.
- **Statut** : ✅ **corrigé + testé**. `findFirst`+`create` par occurrence encapsulés dans un
  try/catch, compteur `errors` ajouté (loggé + retourné), la boucle continue sur les autres
  occurrences/templates/tenants. Fonction exportée pour test unitaire direct (elle ne l'était
  pas). Bug annexe trouvé en écrivant le test : contrairement à `auditRetentionWorker.ts`, ce
  worker appelait `main()` sans garde `isDirectRun` — donc le simple fait d'importer le module
  (à des fins de test) tentait de démarrer une vraie connexion Redis/BullMQ. Ajouté le même garde
  `isDirectRun` que `auditRetentionWorker.ts` (pattern déjà établi dans le repo, copié à
  l'identique). Nouveau fichier de test `recurringMissionsWorker.test.ts` (5 tests, le worker
  n'avait aucun test avant).

### M5 — Registre `_customTrades` jamais peuplé — fonctionnalité "trade personnalisé" non fonctionnelle
- **Fichier** : `src/lib/trades.ts:231-254`, `src/app/api/superadmin/trades/route.ts:74-84`
- **Catégorie** : logique métier / incohérence de données
- **Confiance** : CONFIRMÉ
- **Description** : `registerCustomTrade()` n'est appelé nulle part dans le code (0 call site hors
  définition). `POST /api/superadmin/trades` persiste un `CustomTrade` en base sans jamais
  synchroniser le registre en mémoire utilisé par `getTradeConfig()`.
- **Impact** : tout tenant assigné à un trade personnalisé tombe silencieusement sur
  `DEFAULT_TRADE` — mauvais vocabulaire UI, mauvais filtrage de types de mission, aucune erreur
  visible. Fonctionnalité entièrement cassée en pratique. Non couvert par
  `tradeSystem.test.ts` (ne teste que les 6 trades intégrés).
- **Correction proposée** : charger tous les `CustomTrade` et appeler `registerCustomTrade` au
  démarrage serveur, resynchroniser sur POST/PUT/DELETE. Note : approche en mémoire process-local
  ne se propage pas en déploiement multi-instance — envisager un cache DB/Redis plutôt qu'une Map
  locale si scaling horizontal prévu.
- **Statut** : ✅ **corrigé côté serveur + testé** — ⚠️ **gap restant côté navigateur, documenté
  ci-dessous, non corrigé dans cette passe**.
  - Nouveau module `src/lib/data/customTrades.ts` (server-only, importe Prisma — ne peut pas
    vivre dans `trades.ts` qui est aussi importé côté client) : `loadCustomTradesFromDb()`
    (chargement complet), `syncCustomTradeRegistered/Unregistered()` (sync ciblée).
  - `src/instrumentation.ts` (hook Next.js officiel "au démarrage serveur", déjà utilisé pour
    Sentry/telemetry) appelle `loadCustomTradesFromDb()` — couvre le cas redémarrage serveur.
  - `POST`/`PUT`/`DELETE /api/superadmin/trades[/[id]]` appellent
    `syncCustomTradeRegistered`/`syncCustomTradeUnregistered` juste après l'écriture DB — le
    trade est utilisable immédiatement, sans attendre un redémarrage.
  - `TradeConfig.id` élargi de `TradeId` (union fermée des 6 métiers intégrés) à `TradeId |
    string` — un trade personnalisé n'a jamais pu avoir un `id` valide dans l'ancien type
    (incohérence latente, jamais détectée car `registerCustomTrade` n'était jamais appelé).
  - Corrigé au passage : `TradeProvider.tsx` avait sa PROPRE vérification `tradeId in TRADES`
    (métiers intégrés uniquement) au lieu de déléguer à `getTradeConfig` — même bug, occurrence
    indépendante, dans le seul composant qui l'exerçait vraiment côté client.
  - **Ce qui n'est PAS corrigé (limitation connue, hors périmètre de cette correction)** : le
    Map `_customTrades` est en mémoire, process-local. Il est maintenant correctement peuplé
    **côté serveur** (routes API, moteur VRP, workers) — c'est là que se trouvait l'impact métier
    réel (filtrage des types de mission, stats ML, planification VRP). Mais **le navigateur a son
    propre process JS** : `_customTrades` y est TOUJOURS vide, donc tout composant client qui
    appelle `getMissionTypeLabel`/`getMissionTypeIcon`/`getTradeConfig` directement (ex:
    `driver/[id]/page.tsx`) continue d'afficher le vocabulaire par défaut (pas celui du métier
    personnalisé) pour un tenant en métier personnalisé — un souci cosmétique (mauvaise
    icône/libellé affiché), pas fonctionnel. Une correction complète nécessite un canal pour faire
    parvenir la config du métier personnalisé jusqu'au bundle client (nouvel endpoint public +
    injection via `TradeProvider` avec les données déjà chargées côté serveur) — travail plus
    large, volontairement laissé de côté ici plutôt que bâclé.
  - Tests ajoutés : `customTrades.test.ts` (8, nouveau module), `trades.test.ts` (+7, registre
    jamais testé avant), `superadmin-trades-systemhealth.test.ts` (+1),
    `superadmin-trades-obd.test.ts` (+2).

### M6 — Fuite tenant potentielle via `planningStore` persisté (IndexedDB) non nettoyé
- **Fichier** : `src/stores/planningStore.ts:753-816`, `src/app/admin/page.tsx:569-571`,
  `src/app/superadmin/page.tsx:1447`
- **Catégorie** : sécurité / incohérence de données
- **Confiance** : CONFIRMÉ (mécanisme) — exploitabilité réelle dépend de la validation
  serveur du couple driverId/tenantId sur `POST /api/plans` (à vérifier, cf. item lié M-schema
  ci-dessous)
- **Description** : `plans`/`startTimes`/`speeds`/`unavailable`/`lockedPlans` sont persistés en
  IndexedDB sous une clé fixe (`pathelix-planning-store`), filtrés seulement par ancienneté (7j),
  jamais par tenantId, jamais vidés au logout ni au changement d'impersonation superadmin.
- **Scénario** : superadmin impersonne tenant A, édite le planning (écrit des entrées `plans`
  clés par driverId de A) → sort → impersonne tenant B (reload complet) → `plans` réhydraté
  contient encore les entrées de A ; `debouncedSyncAllForDate`/`copyPlansToDate`/
  `clearAllPlansForDate` itèrent `Object.entries(state.plans)` **sans filtrer par tenant**, match
  seulement par suffixe de date.
- **Correction proposée** : `usePlanningStore.persist.clearStorage()` au logout et à
  l'entrée/sortie d'impersonation ; ou scoper la clé de persistance par tenantId.
- **Note associée** : le champ `templates` du store est mort (aucun composant ne le lit,
  `TemplatesTab.tsx` fetch sa propre copie) — à nettoyer en Phase 4.
- **Statut** : ✅ **corrigé + testé (partiellement)**.
  - `usePlanningStore.persist.clearStorage()` ajouté à 4 points : logout admin
    (`admin/page.tsx`), logout superadmin (`superadmin/page.tsx`), **entrée** en impersonation
    (`superadmin/page.tsx::impersonate()`, avant la redirection) et **sortie** d'impersonation
    (`ImpersonationBanner.tsx::exitImpersonation()`, sur les deux chemins succès/échec).
  - Test complet ajouté pour `ImpersonationBanner.tsx` (4 tests, composant jusque-là non testé) :
    bannière absente si pas d'impersonation, présente sinon, `clearStorage()` appelé avant
    navigation sur sortie (succès ET échec de l'appel API).
  - **Limite honnête** : `admin/page.tsx` et `superadmin/page.tsx` n'ont **aucune couverture de
    test au niveau composant** (0 fichier `.test.tsx`, vérifié — seule couverture existante :
    e2e Playwright). Ajouter un harnais RTL complet pour ces deux fichiers (1000+ et 2000+
    lignes) uniquement pour ce changement de 2 lignes chacun aurait été disproportionné. Ces deux
    ajouts sont donc vérifiés par typecheck + build réussis + revue de code, pas par un test
    automatisé dédié — à noter comme dette de test préexistante (Phase 4 / follow-up), pas
    introduite par cette correction.
  - Vérification croisée `POST /api/plans` (mentionnée dans la correction proposée) : reportée —
    voir item séparé si un scénario d'exploitation concret est trouvé lors de la Phase 3.

### M7 — `compactRoutes()`/`forceAssignP1()` sans deadline interne (VRP)
- **Fichier** : `src/lib/vrp/index.ts:304-310,447-513,515-616`
- **Catégorie** : fiabilité (edge case) / performance
- **Confiance** : À VÉRIFIER (mécanisme plausible, non reproduit en conditions réelles)
- **Description** : contrairement à `threeOptOnWorstRoutes`/`ejectionChainSearch` qui reçoivent
  une `deadline` explicite, ces deux étapes n'ont aucune borne temporelle — seule protection : cap
  `best.routes.length <= 200`. `compactRoutes` fait une triple boucle sans borne sur
  `targetRoute.missions.length`.
- **Impact** : `timeBudgetMs` peut être dépassé sans limite par ces deux étapes précises — candidat
  plausible supplémentaire pour l'incident CPU serveur mentionné comme "non reproduit" dans
  `AUDIT_TRACKING.md` de juillet.
- **Correction proposée** : passer une `deadline` calculée à `compactRoutes()`/`forceAssignP1()`,
  vérifier `Date.now() < deadline` dans leurs boucles, sortir proprement si dépassée.
- **Statut** : ✅ **corrigé + testé**. Les deux fonctions acceptent désormais un `deadline?:
  number`, avec un budget dédié calculé dans `runVRP` (`startTs + timeBudgetMs - 400` pour
  `compactRoutes`, `- 200` pour `forceAssignP1`, cohérent avec le pattern décroissant déjà en
  place pour `threeOptDeadline`/`ejDeadline`). `compactRoutes` sort proprement (`break`) si le
  délai est dépassé — pure optimisation, sans danger à l'écourter. `forceAssignP1` reste TOUJOURS
  appelée (missions P1 prioritaires, ne doivent jamais être silencieusement ignorées) mais, une
  fois le délai dépassé, saute directement la recherche coûteuse par position/coût et va au
  fallback pas cher (déjà corrigé par M10, respecte ALLER_RETOUR quand possible + warning sinon).
  Les deux fonctions exportées (seules de ce fichier, avec un commentaire expliquant pourquoi) —
  forcer ces chemins de façon fiable via le pipeline public `runVRP` aurait nécessité de
  contourner soit l'aléatoire seedé de l'ALNS, soit un vrai minutage horloge réelle, sans
  garantie ; un appel direct avec une `deadline` déjà dépassée est déterministe. Tests ajoutés
  (`compactRoutes.test.ts`, nouveau fichier, 3 tests, dont 1 vérifié en échouant sans le
  correctif ; `forceAssignP1.test.ts` +1 test) : compaction normale quand il reste du temps,
  aucune action si le délai est déjà dépassé, mission P1 quand même placée (fallback) si le délai
  est dépassé.

### M8 — Collision de hash 32 bits dans le cache haversine (`distanceCache.ts`)
- **Fichier** : `src/lib/vrp/distanceCache.ts:17-32,34-59`
- **Catégorie** : fiabilité (edge case) / incohérence de données
- **Confiance** : CONFIRMÉ (mathématiquement quasi certain à l'échelle du pilote), impact amorti
  par la nature heuristique du VRP
- **Description** : `_key()` hache 4 coordonnées en un entier 32 bits (espace ≈4.3 milliards) sans
  stocker les coordonnées d'origine ni vérifier de collision. Avec `_CACHE_MAX = 500_000`, le
  paradoxe des anniversaires rend une collision quasi certaine bien avant ce plafond (>60% dès
  ~100k entrées uniques). Un run à l'échelle du pilote (150 chauffeurs × 1500 missions) génère
  largement assez de paires uniques pour atteindre cette zone.
- **Impact** : distance haversine incorrecte utilisée silencieusement pour une paire de points au
  hasard — pas de crash, dégradation locale de tournée possible, corruption silencieuse de données
  cœur de métier.
- **Correction proposée** : clé composite string `${x1},${y1},${x2},${y2}` au lieu d'un hash int32,
  ou garder le hash + vérifier l'égalité des coordonnées d'origine en cas de hit.
- **Statut** : à corriger (Phase 2) — nécessite suite de tests VRP complète avant/après

### M9 — Unité incohérente dans le rééquilibrage de secteurs (VRP)
- **Fichier** : `src/lib/vrp/sector.ts::rebalanceSectors()` lignes ~338-405
- **Catégorie** : incohérence de données
- **Confiance** : CONFIRMÉ
- **Description** : `loads[]` est calculé en minutes de travail/chauffeur (`sectorWorkload()`),
  mais après un transfert réussi, `loads[si]`/`loads[sj]` sont réécrits en NOMBRE de
  missions/chauffeur (`.length / drivers`) — les comparaisons suivantes dans la même passe
  (`loads[si] <= meanLoad * 1.15`) mélangent alors deux unités différentes jusqu'à la passe
  suivante.
- **Impact** : dégrade silencieusement l'équilibrage de charge entre secteurs (>20 chauffeurs),
  pas de crash.
- **Correction proposée** : recalculer `loads[]` via `sectorWorkload()` après chaque transfert.
- **Statut** : ✅ **corrigé + testé**. `loads[si]`/`loads[sj]` recalculés via `sectorWorkload()`
  après chaque transfert, cohérent avec le reste de la fonction.
  **Effet de bord découvert pendant la correction** : rendre `loads[]` correct expose un risque
  d'oscillation préexistant — l'heuristique de dimensionnement de transfert (quelques lignes plus
  bas) dépasse fréquemment le seuil individuel du destinataire (elle optimise l'écart total de la
  paire, pas le plafond du destinataire) ; un secteur venant de recevoir un transfert complet
  pouvait donc se re-déclencher immédiatement comme "surchargé" et tout redonner à sa source dans
  la même passe, neutralisant la passe entière. Sous l'ancien bug, l'unité incohérente (nombre de
  missions au lieu de minutes) empêchait accidentellement ce re-déclenchement — corriger l'unité
  sans rien d'autre aurait donc pu dégrader certains cas réels (mieux respecter les unités, mais
  neutraliser des rééquilibrages légitimes). Ajout d'un garde-fou minimal : un secteur qui vient
  de RECEVOIR un transfert dans la passe en cours ne peut plus être réévalué comme SOURCE avant
  la passe suivante (`receivedThisPass`). Vérifié empiriquement (probe scripts, supprimés) sur
  plusieurs scénarios avant de figer le correctif — l'estimation à la main s'est révélée peu
  fiable à cause de cette même heuristique de dimensionnement, d'où le recours à des scripts
  exécutables plutôt qu'un calcul théorique.
  Tests ajoutés (`sector.test.ts`, +2, tous deux vérifiés en échouant sans le(s) correctif(s)) :
  un secteur peu chargé en nombre mais lourd en minutes est correctement exclu comme cible ; un
  transfert ne fait plus l'aller-retour vers sa source dans la même passe.

### M10 — `forceAssignP1` peut violer l'invariant ALLER_RETOUR sans avertissement
- **Fichier** : `src/lib/vrp/index.ts::forceAssignP1()` lignes ~595-604
- **Catégorie** : logique métier
- **Confiance** : CONFIRMÉ
- **Description** : le fallback final (aucune route compatible HFVRP+ALLER_RETOUR) force
  l'insertion dans la route la moins chargée sans revérifier `isAllerRetourCompatible` — qui
  impose qu'une mission ALLER_RETOUR soit seule sur sa route. Le fallback équivalent dans
  `formatSolution.ts::buildInitialSolution` (lignes 218-231), lui, respecte cette contrainte —
  seul `forceAssignP1` a le trou.
- **Impact** : en flotte pleine + mission P1 non assignable normalement, l'invariant métier peut
  être cassé silencieusement, sans warning remonté au dispatcher.
- **Correction proposée** : dans le fallback, préférer une route passant
  `isAllerRetourCompatible` ; à défaut, pousser un warning dans `result.warnings`.
- **Statut** : ✅ **corrigé + testé**. Le fallback essaie d'abord une route respectant
  `isAllerRetourCompatible` (charge minimale parmi celles-ci) ; seulement si aucune n'existe,
  force sur la route la moins chargée ET pousse un warning explicite (sévérité `warning`,
  mentionne l'id de la mission) dans le tableau `warnings` (déjà existant : `hfvrpWarnings`,
  fusionné dans `result.warnings` par l'appelant). `forceAssignP1` exporté (seule fonction interne
  de ce fichier à l'être) spécifiquement pour permettre un test direct de ce fallback — le forcer
  de façon fiable via le pipeline public `runVRP` aurait nécessité de contourner l'aléatoire
  seedé de la recherche ALNS, sans garantie. Tests ajoutés (`forceAssignP1.test.ts`, nouveau
  fichier, 4 tests, un vérifié en échouant sans le correctif) : route vide respectée sans warning
  quand disponible ; mission forcée + warning explicite quand aucune route ne respecte
  ALLER_RETOUR ; pas de crash si `warnings` omis.

### M11 — Divergence `syncQueue.ts`/`sw.js` sur le comptage des erreurs réseau
- **Fichiers** : `src/lib/syncQueue.ts:82-85`, `public/sw.js:100-102`
- **Catégorie** : logique métier / fiabilité (edge case)
- **Confiance** : CONFIRMÉ
- **Description** : sur erreur réseau générique (`catch`, pas de réponse serveur), `syncQueue.ts`
  incrémentait `retryCount` puis `break` ; `sw.js` faisait `break` seul sans incrémenter (déjà le
  comportement voulu côté service worker : ne pas compter une absence de réseau comme un rejet
  serveur).
- **Scénario concret** : chauffeur en zone blanche prolongée qui rouvre l'app en premier plan à
  plusieurs reprises pendant qu'il est hors ligne → `retryCount` montait à chaque flush premier-plan
  sans réseau (contrairement au flush arrière-plan) → suppression définitive de l'action après 5
  tentatives, sans jamais avoir été rejetée par le serveur.
- **Impact** : perte silencieuse de données de tournée (statut mission, preuve de livraison) pour
  un chauffeur en zone de mauvaise couverture — exactement le scénario que l'offline est censé
  protéger.
- **Correction proposée** : aligner `syncQueue.ts` sur `sw.js` — ne pas incrémenter `retryCount`
  sur erreur réseau générique, seulement sur un vrai rejet HTTP (4xx/5xx).
- **Statut** : ✅ **corrigé + testé** — commit à suivre. Correctif appliqué et vérifié
  indépendamment (lint clean, typecheck clean, 23/23 tests syncQueue.test.ts, suite complète en
  cours de re-vérification). Test de régression ajouté :
  `syncQueue.test.ts` — "does NOT increment retryCount on network error".

### M12 — Nessy webhook : secret HMAC global + tenantId fourni par l'appelant
- **Fichiers** : `src/app/api/webhooks/nessy/route.ts:41-90`, `src/services/nessy.ts:15-16`
- **Catégorie** : sécurité
- **Confiance** : À VÉRIFIER — dépend d'une hypothèse d'architecture non tranchable seul
- **Description** : `NESSY_WEBHOOK_SECRET` est une variable globale unique au déploiement (pas de
  secret par tenant). Le tenant ciblé est déterminé par le header `x-tenant-id`, fourni tel quel
  par l'appelant (exempté du strip middleware — documenté comme intentionnel dans CLAUDE.md). La
  route vérifie seulement que le tenant existe, pas qu'il est autorisé par la signature HMAC.
- **Scénario concret** : toute entité connaissant `NESSY_WEBHOOK_SECRET` peut forger une signature
  valide pour un payload avec `x-tenant-id: <n'importe quel tenant existant>` et injecter des
  missions dans n'importe quel tenant.
- **Comparaison** : `geotab`/`samsara` dérivent CORRECTEMENT le tenant en matchant la
  clé/token déchiffré par intégration — jamais depuis un header client (pattern sûr). `obd`
  utilise le même modèle que Nessy (secret global + ID fourni par l'appelant).
- **Impact** : dépend du modèle opérationnel réel — si le secret Nessy est censé être connu
  individuellement par tenant, c'est une fuite d'isolation critique ; si Nessy est un partenaire
  amont unique de confiance plateforme (secret jamais exposé à un tenant), le design est
  défendable. **Je ne peux pas trancher sans confirmation humaine.**
- **Correction proposée (si secret partagé confirmé problématique)** : secret HMAC par tenant
  (`NessyIntegration.webhookSecret` chiffré, pattern déjà utilisé pour Geotab/Samsara).
- **Statut** : à valider par l'utilisateur avant toute correction (question produit, pas bug pur)

---

## 🟡 Mineures

### N1 — `!oi === undefined` : garde-fou mort par précédence d'opérateur (VRP)
- **Fichier** : `src/lib/vrp/externalRoutingApi.ts:138`
- **Confiance** : CONFIRMÉ
- **Description** : `!oi` (booléen) évalué avant `===`, condition toujours fausse — le garde ne se
  déclenche jamais. Masqué par le try/catch englobant (fallback Valhalla/haversine).
- **Correction** : `if (oi === undefined) continue`.
- **Statut** : ✅ **corrigé + testé**. Test ajouté (`externalRoutingApi.test.ts`, +1, vérifié en
  échouant sans le correctif) : une ligne `RouteMatrixResults` en trop par rapport aux origines
  demandées (réponse API malformée/surdimensionnée) est ignorée proprement au lieu de faire
  planter `dist[undefined][...]`, capturé par le try/catch englobant qui aurait sinon jeté toute
  la matrice valide et forcé un repli OSRM/haversine inutile.

### N2 — `x-tenant-trade` non strippé du header entrant (middleware)
- **Fichier** : `src/middleware.ts:114-119,146`
- **Confiance** : CONFIRMÉ (impact réel actuellement nul)
- **Description** : contrairement à `x-user-id`/`x-user-role`/`x-tenant-id`, `x-tenant-trade`
  n'est jamais strippé en amont. Si `session.trade` est falsy, un header fourni par le client
  traverse intact. Vérifié par grep : aucune route ne lit `trade` du contexte pour une décision
  métier (toutes relisent `tenant.trade` en base) — risque latent seulement (futur développeur
  qui ferait confiance à ce champ en pensant qu'il est aussi fiable que tenantId/role).
- **Correction** : `requestHeaders.delete('x-tenant-trade')` dans le bloc de strip.
- **Statut** : à corriger (Phase 2, trivial, defense-in-depth)

### N3 — Divergence de regex tenantId entre `session.ts` et `context.ts`
- **Fichiers** : `src/lib/session.ts:134`, `src/lib/data/context.ts:6`
- **Confiance** : À VÉRIFIER (pas de scénario d'exploitation actuel — tous les tenantId réels sont
  des cuid() ou seeds préfixés longs, jamais assez courts pour déclencher la divergence)
- **Description** : `session.ts` valide `/^[a-zA-Z0-9_-]+$/` (1-64 car.) ; `context.ts` valide
  `/^[a-z0-9][a-z0-9_\-]{5,}$/i` (min 6 car.). Même classe de bug que le fix de juillet
  (tenantId avec underscore rejeté) — latent, pas actuellement déclenchable.
- **Correction** : extraire une regex partagée exportée depuis `context.ts`, réutilisée dans
  `session.ts`.
- **Statut** : à corriger (Phase 2, defense-in-depth)

### N4 — Cache de suspension tenant non partagé entre instances
- **Fichier** : `src/lib/data/context.ts:44-91`
- **Confiance** : À VÉRIFIER (dépend de la topologie de déploiement — mono-instance probable pour
  le pilote selon les notes de juillet, non confirmé ici)
- **Description** : `_suspensionCache` est une Map en mémoire locale au process, TTL 60s.
  `invalidateSuspensionCache()` n'invalide que le process qui traite la requête de suspension. En
  multi-instance, un tenant suspendu garde l'accès sur les autres instances jusqu'à 60s.
- **Correction** : si multi-instance prévu, publier l'invalidation via Redis pub/sub (déjà utilisé
  pour SSE). Si mono-instance confirmé, documenter la limite et classer "accepté tel quel".
- **Statut** : à valider par l'utilisateur (dépend de la topologie de déploiement prévue)

### N5 — `advanceStatus` : effets de bord dans un updater React (non pur)
- **Fichier** : `src/app/driver/[id]/page.tsx:226-265`
- **Confiance** : CONFIRMÉ (violation du contrat React) — impact prod probablement nul (pas de
  StrictMode visible en prod)
- **Description** : `setStatuses(prev => {...})` contient des effets de bord (localStorage,
  géolocalisation, enqueueAction, setTimeout) — en React 18 StrictMode (dev only), les updaters
  sont invoqués deux fois, doublant potentiellement ces effets.
- **Correction** : sortir les effets de bord de l'updater, les exécuter après `setStatuses`.
- **Statut** : ✅ **accepté tel quel, non corrigé** — décision motivée :
  1. Vérifié : `next.config.mjs` ne configure pas `reactStrictMode`, et de toute façon le
     double-invocation StrictMode ne se produit QUE sous `next dev`, jamais dans un build/serveur
     de production (`next build`/`next start`). Impact réel en production : **nul, confirmé**, pas
     juste "probablement nul".
  2. Tentative de correction "propre" (sortir les effets vers un `useEffect` réagissant à
     `statuses`) tracée en détail : entre en collision avec l'hydratation initiale depuis
     `localStorage` (useEffect ligne ~182-188) — un effet générique sur tout changement de
     `statuses` déclencherait des resynchronisations parasites vers le serveur à chaque
     rechargement de page (statuts déjà synchronisés renvoyés comme si "nouveaux"), avec ordre
     d'exécution ref/closure délicat à garantir correct sans risque de régression fonctionnelle
     réelle (perte ou double envoi de statuts).
  3. Étant donné un risque de régression réel identifié contre un bénéfice confirmé nul en
     production, corriger cet item violerait la règle "ne jamais casser l'existant" pour un gain
     uniquement esthétique/dev. Laissé tel quel, documenté honnêtement plutôt que corrigé à la
     hâte.

### N6 — `Tooltip.tsx` : timer non nettoyé au démontage
- **Fichier** : `src/components/ui/Tooltip.tsx:15-22`
- **Confiance** : CONFIRMÉ
- **Description** : `show()` programme `setVisible(true)` via `setTimeout(200ms)` sans cleanup au
  démontage. Composant démonté pendant le délai → `setVisible` appelé sur composant démonté.
- **Correction** : `useEffect(() => () => clearTimeout(timerRef.current), [])`.
- **Statut** : à corriger (Phase 2, trivial)

### N7 — `DRIVER_SELECT` sur-fetch (jointures inutiles)
- **Fichier** : `src/lib/data/drivers.ts:19,21`
- **Confiance** : CONFIRMÉ
- **Description** : `startingExutoire: { select: {...} }` jamais lu par `prismaRowToDriver` ;
  `vehicles: { where: {...}, take: 1 }` sans `select` imbriqué ramène toutes les colonnes
  scalaires de `Vehicle` alors que le mapper n'en consomme que 6.
- **Correction** : retirer le join `startingExutoire` inutilisé, ajouter un `select` imbriqué sur
  `vehicles` limité aux 6 champs utilisés.
- **Statut** : à corriger (Phase 2, trivial, perf)

### N8 — Ejection chain search : calcul mort dans une boucle chaude (VRP)
- **Fichier** : `src/lib/vrp/operators.ts::ejectionChainSearch()` lignes ~1449-1463
- **Confiance** : À VÉRIFIER
- **Description** : `routeJChain.missions` calculé une première fois via `.filter()` (résultat
  jeté), puis écrasé. Gaspillage CPU dans une boucle imbriquée sous budget-temps serré, pas un bug
  de correction.
- **Statut** : à corriger si simple (Phase 2) sinon reporté Phase 4 (dette technique)

### N9 — `getJ7Date()` : mélange UTC/heure locale (VRP worker)
- **Fichier** : `src/workers/vrpWorker.ts::getJ7Date()` lignes 29-33
- **Confiance** : À VÉRIFIER (dépend du `TZ` du process de déploiement, non confirmé ici)
- **Description** : `new Date(dateStr)` parse en UTC minuit, `.setDate(d.getDate()-7)` mute en
  heure locale du process — décalage possible d'un jour si `TZ` ≠ UTC.
- **Correction** : utiliser exclusivement des opérations UTC (`setUTCDate` etc.) ou confirmer
  `TZ=UTC` fixé en déploiement.
- **Statut** : à vérifier en Phase 3 (config déploiement), corriger par prudence en Phase 2

### N10 — `catch {}` silencieux sur calibrage ML (VRP index.ts)
- **Fichier** : `src/lib/vrp/index.ts` lignes ~110-112, ~163-166
- **Confiance** : CONFIRMÉ
- **Description** : `applyMLCoefficients`/`loadFamiliarity` avalent les erreurs sans log, alors
  que `createLogger` est déjà importé dans ce fichier.
- **Correction** : logger l'erreur en `warn` avant de continuer en dégradé.
- **Statut** : à corriger (Phase 2, trivial, observabilité)

### N11 — Mutation de l'objet `options` fourni par l'appelant (VRP index.ts)
- **Fichier** : `src/lib/vrp/index.ts` ligne ~105
- **Confiance** : À VÉRIFIER (pas de trigger identifié actuellement)
- **Description** : `options.defaultSpeedKmh = Math.round(...)` mute l'objet appelant au lieu
  d'une copie locale. Fragile si `options` était un jour réutilisé par l'appelant.
- **Statut** : à corriger si trivial (Phase 2) sinon Phase 4

### N12 — `estimatedDurationMin` non protégé contre `undefined` (formatSolution.ts)
- **Fichier** : `src/lib/vrp/formatSolution.ts::formatSolutionForAPI()` ligne 354
- **Confiance** : À VÉRIFIER (dépend si le champ peut réellement être undefined à ce point du
  pipeline — le schema Zod le rend obligatoire à la création, mais à confirmer pour tout chemin
  interne)
- **Description** : addition sans `?? 0`/`Math.max(0, ...)`, contrairement à `routeCost.ts` qui
  protège systématiquement. Risque de `NaN` dans les horaires affichés au chauffeur si jamais
  undefined.
- **Statut** : à corriger par prudence (Phase 2, trivial)

### N13 — `DEFAULT_URBAN_CENTERS` codé en dur (région Rhône-Alpes)
- **Fichier** : `src/lib/algorithm.ts:75-81`
- **Confiance** : À VÉRIFIER (question produit — dépend des tenants ciblés)
- **Description** : 5 villes Rhône-Alpes en dur pour le bonus trafic directionnel. Override
  possible via `URBAN_CENTERS_JSON` mais une seule variable globale, pas par-tenant.
- **Statut** : accepté tel quel (config existante suffisante pour le pilote) — à noter pour
  évolution future si expansion hors région

### N14 — `isHfvrpCompatible` ne contrôle que le volume, jamais hazmat/gabarit comme contrainte dure
- **Fichier** : `src/lib/vrp/hfvrp.ts`
- **Confiance** : question produit, pas un bug (rien à violer — `Mission` n'a pas de champ
  hazmat/gabarit requis)
- **Statut** : accepté tel quel — à confirmer avec le produit si c'est voulu

### N15 — `.find()` avec erreur non catchée dans le prédicat (Geotab/Samsara)
- **Fichiers** : `src/app/api/webhooks/geotab/route.ts:59-62`, `webhooks/samsara/route.ts:68-71`,
  `src/lib/configCrypto.ts:47`
- **Confiance** : À VÉRIFIER (dépend de la probabilité de mauvaise config `INTEGRATION_ENCRYPTION_KEY`
  en prod)
- **Description** : si la clé de chiffrement est absente/invalide, `getKey()` throw dans le
  callback `.find()`, non catché localement → 500 générique sans log applicatif clair.
- **Correction** : wrapper le `.find()` dans un try/catch avec log explicite.
- **Statut** : à corriger si trivial (Phase 2)

### N16 — Fuite de timing théorique sur `.find()` avec comparaison constant-time (Geotab/Samsara)
- **Fichiers** : `src/app/api/webhooks/geotab/route.ts:59-63`, `webhooks/samsara/route.ts:68-72`
- **Confiance** : À VÉRIFIER (risque quasi nul)
- **Description** : chaque comparaison individuelle est `timingSafeEqual`, mais `.find()` s'arrête
  au premier match — fuite de timing théorique sur la position dans la liste, pas sur le secret
  lui-même.
- **Statut** : accepté tel quel (risque négligeable)

### N17 — Head-of-line blocking dans `flushSyncQueue` sur échec persistant
- **Fichiers** : `src/lib/syncQueue.ts:59-86`, `public/sw.js:77-103`
- **Confiance** : À VÉRIFIER — probablement un choix de conception voulu (éviter de spammer un
  serveur en panne)
- **Description** : la boucle `break` (pas `continue`) dès la première action en échec — les
  actions suivantes, même valides, ne sont pas tentées ce cycle.
- **Statut** : à valider par l'utilisateur (compromis de conception, pas un bug)

### N18 — Détection de doublon fragile dans le worker de missions récurrentes
- **Fichier** : `src/workers/recurringMissionsWorker.ts:75-84`
- **Confiance** : À VÉRIFIER
- **Description** : heuristique de dédup sur `tenantId+date+address+type+clientName` plutôt qu'un
  lien stable (`generatedFromTemplateId`). Deux templates partageant cette signature : un des deux
  silencieusement ignoré ; une mission manuelle avec la même signature supprime la génération
  auto du jour.
- **Correction proposée** : ajouter un champ `generatedFromTemplateId` sur `Mission`.
- **Statut** : à corriger si simple (Phase 2) sinon reporté (nécessite migration schema)

### N19 — Modèles avec `driverId` sans relation Prisma (pas de FK)
- **Fichier** : `prisma/schema.prisma` — `FuelRecord.driverId`, `DeliveryProof.driverId`,
  `InterventionMetric.driverId`, `PushSubscription.driverId`
- **Confiance** : À VÉRIFIER — dépend si chaque route d'écriture valide déjà le tenant du
  driverId manuellement (hors périmètre de cette entrée, à croiser avec l'audit routes)
- **Description** : contrairement à `Plan.driverId`/`Vehicle.assignedDriverId` (FK avec
  `@relation`), ces 4 champs sont de simples colonnes indexées sans intégrité référentielle DB.
- **Statut** : à vérifier en Phase 2 (croiser avec validation applicative des routes concernées)

### N21 — Test flaky : `crypto.test.ts` "throws on tampered ciphertext" (~6% échec)
- **Fichier** : `src/lib/trackdechets/__tests__/crypto.test.ts:42-46`
- **Catégorie** : dette technique (fiabilité de la suite de tests, pas du code produit)
- **Confiance** : CONFIRMÉ — trouvé par accident pendant la vérification de M2 (suite complète,
  1 échec sur ~3430 tests), isolé et reproduit la cause racine
- **Description** : le test altérait `encryptedToken` (hex) via `.replace(/a/g, 'b')`. Pour un
  texte clair court, la chaîne hex (~44 car.) a une probabilité non négligeable (~6%, calcul :
  `(15/16)^44`) de ne contenir AUCUN caractère `'a'` — dans ce cas le "payload altéré" est
  strictement identique à l'original, le déchiffrement réussit, et l'assertion `toThrow()` échoue
  de façon intermittente selon l'IV aléatoire du run.
- **Impact** : faux échec CI occasionnel, aucun risque produit (le code de chiffrement lui-même
  est correct — c'est uniquement le test qui était mal construit).
- **Correction** : ✅ **corrigé**. Remplacé par une altération déterministe (bascule du dernier
  caractère hex vers une valeur garantie différente), qui échoue systématiquement le round-trip
  quel que soit le contenu. Vérifié stable sur 15 exécutions consécutives après correction.
- **Statut** : ✅ corrigé + vérifié (pas de nouveau test ajouté — le test existant est maintenant
  fiable, c'était bien lui la source du problème)

### N20 — `ClientSite` sans `tenantId` propre
- **Fichier** : `prisma/schema.prisma:186-196`
- **Confiance** : À VÉRIFIER
- **Description** : pas de colonne `tenantId`, seulement `clientId`/`siteId`. Fine tant que tout
  accès passe par un `Client`/`Site` déjà vérifié tenant — à confirmer qu'aucun lookup direct par
  id brut n'existe.
- **Statut** : à vérifier en Phase 2

---

## Vérifié conforme — pas de bug trouvé

- Auth HMAC Nessy/Trackdéchets, Bearer OBD, API-key Geotab/Samsara : toutes constant-time.
- Rate limiting 200/min/IP présent sur les 5 webhooks (y compris OBD/Geotab/Samsara, non
  documentés dans `AUDIT_TRACKING.md` mais bien protégés).
- Dédoublonnage Nessy par hash SHA-256 fonctionnel.
- Round-trip chiffrement/déchiffrement Trackdéchets (AES-256-GCM) correct, échec propre sur
  mauvaise clé/altération. **HALT Trackdéchets non touché, rien ne nécessite de le lever.**
- SSE : limite de connexions par tenant fonctionnelle, fallback Redis→polling propre, snapshot
  correct à la reconnexion.
- Fix retryCount 4xx de juillet toujours en place (cf. M11 pour la divergence réseau spécifique,
  déjà corrigée).
- `EXUTOIRE_LIST_SELECT`/mapper (fix juillet) : toujours correct, classe de bug non répliquée sur
  `missions.ts` (mapper dégrade proprement via `?? undefined`, pas de `requireString`-style
  assert).
- `prisma/migrations/20260619131108_sync_schema/migration.sql` : sûr (nouvelles tables uniquement,
  1 `ADD COLUMN NOT NULL DEFAULT false` non bloquant).
- `src/lib/db.ts`, `src/lib/logger.ts`, `src/lib/types.ts` : rien à signaler.
- Aucun `dangerouslySetInnerHTML` dans tout `src/` (grep exhaustif).
- Aucune route ne contourne `getRequestContext()` via lecture directe de header (sauf Nessy,
  documenté en M12 — exemption intentionnelle).
- `USE_MOCK_DATA` : toutes les occurrences utilisent `!== 'false'` (pattern correct partout).
- `EmptyState.tsx`, `OnboardingGuide.tsx` (a11y correcte — role/aria-modal/aria-labelledby),
  `imageUtils.ts` (fallback sûr), `ml-accuracy/route.ts` (gated superadmin, pas de div/0),
  `ErrorBoundary.tsx` (conforme au fix de juillet).
- 3 boucliers ML qualité CONFIRMÉS présents et actifs : seuils d'échantillons min, `safeCoeff()`
  borné [0.3, 3.0], filtre `isReliable`/`rejectReason`.
- `distanceCache.ts`/`valhallaMatrix.ts` non scopés par tenantId : intentionnel et correct (caches
  géographiques purs, pas de donnée métier tenant-spécifique).
- `mlProfileWorker.ts`, `metricCollector.ts` : aucun bug trouvé.

## Couverture non exhaustive — zones nécessitant un passage complémentaire

- `src/lib/vrp/mvAlns.ts`, `operators.ts` : non relus ligne à ligne en intégralité (couverts par
  grep ciblé + suite de tests VRP verte).
- ~30 fichiers sous `src/components/admin/**` (MissionForm, DriverForm, modals, timeline) : lus
  via grep ciblé (XSS, trust client-side), pas ligne par ligne intégralement.
- `src/app/api/optimize/route.ts`, `[jobId]`, `live`, `resequence`, `plans/p1-risk`,
  `drivers/compliance` : pas atteints par le fork routes API (budget épuisé) — lecture ciblée
  complémentaire faite en Phase 2 avant correction de M1/M4/M5.

---

## Résumé Phase 1

| # | Titre | Sévérité | Statut initial |
|---|---|---|---|
| C1 | Scan ticket pesée inaccessible | 🔴 critique | ✅ corrigé + testé |
| M1 | VIDER/PAUSE créables par utilisateur | 🟠 majeure | ✅ corrigé + testé |
| M2 | Suppression abonnements push sur erreur transitoire | 🟠 majeure | ✅ corrigé + testé |
| N21 | Test flaky `crypto.test.ts` (tamper ~6% échec) | 🟡 mineure | ✅ corrigé (trouvé pendant vérif. M2) |
| M3 | Isolation tenant absente positions OBD/Geotab/Samsara | 🟠 majeure | à valider utilisateur |
| M4 | Worker missions récurrentes sans isolation d'erreur | 🟠 majeure | ✅ corrigé + testé |
| M5 | Custom trades jamais enregistrés | 🟠 majeure | ✅ corrigé serveur + testé (⚠️ gap client documenté) |
| M6 | planningStore IndexedDB non nettoyé (fuite tenant) | 🟠 majeure | ✅ corrigé + testé (gap couverture admin/superadmin page.tsx documenté) |
| M7 | compactRoutes/forceAssignP1 sans deadline | 🟠 majeure | ✅ corrigé + testé |
| M8 | Collision hash 32 bits cache haversine | 🟠 majeure | à corriger |
| M9 | Unité incohérente rebalanceSectors | 🟠 majeure | ✅ corrigé + testé (garde-fou oscillation ajouté) |
| M10 | forceAssignP1 peut violer invariant ALLER_RETOUR | 🟠 majeure | ✅ corrigé + testé |
| M11 | Divergence syncQueue/sw.js erreurs réseau | 🟠 majeure | ✅ corrigé + testé |
| M12 | Nessy secret global + tenantId appelant | 🟠 majeure | à valider utilisateur |
| N1 | `!oi === undefined` garde mort (externalRoutingApi) | 🟡 mineure | ✅ corrigé + testé |
| N5 | advanceStatus effets de bord dans updater | 🟡 mineure | accepté tel quel (StrictMode = dev only, jamais en prod ; risque réel de régression identifié dans la correction "propre") |
| N2-N20 (reste) | Voir détail | 🟡 mineure | mix corrigé/à corriger/accepté/à valider |

**0 faux positif identifié comme tel dans cette synthèse** — tout ce qui reste incertain est
explicitement marqué "à vérifier" ou "à valider par l'utilisateur" plutôt que présenté comme
confirmé.

*(Phase 1 terminée. Passage en Phase 2 : corrections critique → majeures → mineures, une par une,
avec test de régression et suite complète à chaque étape, sauf items "à valider par l'utilisateur"
qui sont documentés mais non corrigés sans arbitrage produit/architecture.)*
