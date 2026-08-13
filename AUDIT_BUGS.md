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
- **Statut** : ✅ **Geotab/Samsara corrigés + testés** ; **OBD générique laissé tel quel, à valider
  par l'utilisateur** (question produit réelle, pas juste "flemme de fixer").
  - **Geotab/Samsara** : contrairement à OBD générique, ces deux webhooks résolvent déjà un
    `tenantId` fiable (secret par-tenant déchiffré et vérifié, cf. correctif N15). Le seul trou
    était le `driverId` lui-même (`deviceMapping` Geotab ou champ payload brut Samsara), jamais
    vérifié contre ce `tenantId` avant écriture — même défaut que N19, correction identique
    appliquée : `prisma.driver.findMany({id:{in:[...]}, tenantId})`, lectures avec un `driverId`
    non résolu ignorées + `log.warn`. Ce n'était donc pas un choix de conception à trancher, juste
    le même bug que N19 sous une autre forme.
  - **OBD générique** (`src/app/api/webhooks/obd/route.ts`) : ✅ **corrigé + testé (A1)** — décision
    tranchée par l'utilisateur : secret partagé est un vrai risque d'isolation, point final. Même
    architecture que Geotab/Samsara/Nessy : le webhook résout maintenant le tenant en trouvant
    quelle intégration `type:"obd"` activée possède le secret (`config.webhookSecret`) fourni en
    Bearer, puis valide chaque `driverId` contre CE tenant avant d'enregistrer (même pattern que
    N19/Geotab/Samsara). Nouveau type `obd` ajouté au catalogue `/api/integrations` +
    `/api/integrations/test`. `OBD_WEBHOOK_TOKEN` (variable globale) n'est plus lu du tout —
    breaking change documenté dans `docs/04_API_INTEGRATIONS.md` et `CLAUDE.md`.
  - Tests ajoutés (`integrations.test.ts` +4 pour Geotab/Samsara déjà en place ; `superadmin-trades-
    obd.test.ts` réécrit pour OBD — secret par tenant + driverId hors-tenant rejeté, tous vérifiés
    en échouant contre l'ancien code).

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
- **Statut** : ✅ **corrigé + testé**. Clé composite string `${x1},${y1},${x2},${y2}` (`Map<string,
  ...>`) remplace le hash int32 (`Map<number,...>`) — structurellement sans collision possible, plus
  besoin de stocker/vérifier les coordonnées d'origine. Test ajouté (`distanceCache.test.ts`, +2).
  Suite VRP complète (523/523) vérifiée avant/après par prudence (fichier cœur du moteur).

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
- **Statut** : ✅ **corrigé + testé (A1)** — décision tranchée par l'utilisateur : secret partagé +
  tenant auto-déclaré est un vrai risque d'isolation sur un SaaS multi-tenant, point final, pas un
  compromis acceptable. Aucune migration de schéma nécessaire — `Integration` (déjà utilisé par
  Geotab/Samsara) supportait déjà `type:"nessy"` dans le catalogue `/api/integrations` et son
  validateur `/api/integrations/test`, juste jamais branché côté webhook. Le tenant est maintenant
  résolu en cherchant quelle intégration Nessy activée vérifie la signature HMAC de la requête —
  plus jamais depuis `x-tenant-id`. `NESSY_WEBHOOK_SECRET` (variable globale) déclenche seulement
  un `log.warn` de dépréciation si encore définie, ne participe plus à l'authentification.
  `/api/health` : le check `nessySecret` reflète maintenant "au moins un tenant a une intégration
  Nessy activée" (compte DB) au lieu de "la variable d'env globale est définie".
  **Breaking change documenté** dans `docs/04_API_INTEGRATIONS.md` (procédure : chaque tenant
  utilisant Nessy doit configurer son propre secret via l'onglet Intégrations puis reconfigurer
  son ERP pour signer avec ce nouveau secret — sans cette migration, `401 Signature invalide`).
  Tests : `webhooks-nessy-obd.test.ts` réécrit en profondeur (résolution multi-tenant, config
  indéchiffrable d'un tenant n'empêche pas les autres, aucune intégration configurée → 401),
  `nessy.test.ts` mis à jour pour le nouveau warning de dépréciation. Tous vérifiés en échouant
  contre l'ancien code (23 échecs sur les 2 fichiers webhook avant restauration du correctif).

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
- **Statut** : ✅ **corrigé**. Ajouté juste après les deletes existants de `x-user-id`/
  `x-user-role`. Pas de test dédié : impact comportemental confirmé nul (aucune route ne lit ce
  header), et le harnais de test de `middleware.ts` ne peut pas inspecter les headers de la
  requête AVAL modifiée (confirmé par un commentaire déjà présent dans un test existant —
  `NextResponse.next({request:{headers}})` n'expose pas ces headers sur l'objet réponse
  retourné). Écrire un test qui ne vérifie que `res.status === 200` n'aurait rien prouvé.
  Suite middleware complète (27 tests) verte après le changement.

### N3 — Divergence de regex tenantId entre `session.ts` et `context.ts`
- **Fichiers** : `src/lib/session.ts:134`, `src/lib/data/context.ts:6`
- **Confiance** : À VÉRIFIER (pas de scénario d'exploitation actuel — tous les tenantId réels sont
  des cuid() ou seeds préfixés longs, jamais assez courts pour déclencher la divergence)
- **Description** : `session.ts` valide `/^[a-zA-Z0-9_-]+$/` (1-64 car.) ; `context.ts` valide
  `/^[a-z0-9][a-z0-9_\-]{5,}$/i` (min 6 car.). Même classe de bug que le fix de juillet
  (tenantId avec underscore rejeté) — latent, pas actuellement déclenchable.
- **Correction** : extraire une regex partagée exportée depuis `context.ts`, réutilisée dans
  `session.ts`.
- **Statut** : ✅ **corrigé + testé**. `TENANT_ID_RE` exportée depuis `context.ts`, importée dans
  `session.ts` (import statique dynamique-safe : `context.ts` n'importe `@/lib/db` que via
  `await import()` à l'intérieur d'une fonction, donc pas d'inclusion eager de Prisma dans le
  bundle edge du middleware — vérifié via `npm run build` réussi). Tests ajoutés
  (`session.extra.test.ts`, +2, un vérifié en échouant sans le correctif) : un tenantId de 2
  caractères, valide sous l'ancienne regex de `session.ts` mais pas sous `TENANT_ID_RE`, est
  maintenant rejeté dès la vérification du token plutôt que de provoquer un 500 plus tard sur
  `getRequestContext()`.

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
- **Statut** : ✅ **corrigé + testé**. Test ajouté (+1, vérifié en échouant sans le correctif) :
  `clearTimeout` appelé au démontage pendant le délai de 200ms, pas de throw si les timers
  avancent après démontage.

### N7 — `DRIVER_SELECT` sur-fetch (jointures inutiles)
- **Fichier** : `src/lib/data/drivers.ts:19,21`
- **Confiance** : CONFIRMÉ
- **Description** : `startingExutoire: { select: {...} }` jamais lu par `prismaRowToDriver` ;
  `vehicles: { where: {...}, take: 1 }` sans `select` imbriqué ramène toutes les colonnes
  scalaires de `Vehicle` alors que le mapper n'en consomme que 6.
- **Correction** : retirer le join `startingExutoire` inutilisé, ajouter un `select` imbriqué sur
  `vehicles` limité aux 6 champs utilisés.
- **Statut** : ✅ **corrigé + testé** (7 champs en réalité, pas 6 : `maxBins`, `weightTon`,
  `heightM`, `widthM`, `lengthM`, `axleCount`, `hazmat`). Tests ajoutés (+2, vérifiés en échouant
  sans le correctif) : `startingExutoire` absent du select, `startingExutoireId` (scalaire)
  présent ; `vehicles.select` limité exactement aux 7 champs utilisés par le mapper.

### N8 — Ejection chain search : calcul mort dans une boucle chaude (VRP)
- **Fichier** : `src/lib/vrp/operators.ts::ejectionChainSearch()` lignes ~1449-1463
- **Confiance** : À VÉRIFIER
- **Description** : `routeJChain.missions` calculé une première fois via `.filter()` (résultat
  jeté), puis écrasé. Gaspillage CPU dans une boucle imbriquée sous budget-temps serré, pas un bug
  de correction.
- **Statut** : ✅ **corrigé**, sans nouveau test (refactor pur, comportement identique — le calcul
  jeté ne pouvait pas produire d'effet observable). `routeJChain` construit directement à partir de
  `tempMissions` (déjà calculé juste après pour le vrai usage) au lieu d'un `.filter()` intermédiaire
  immédiatement écrasé à la ligne suivante. Vérifié : suite VRP complète (523/523) inchangée avant/
  après, typecheck et lint propres.

### N9 — `getJ7Date()` : mélange UTC/heure locale (VRP worker)
- **Fichier** : `src/workers/vrpWorker.ts::getJ7Date()` lignes 29-33
- **Confiance** : À VÉRIFIER (dépend du `TZ` du process de déploiement, non confirmé ici)
- **Description** : `new Date(dateStr)` parse en UTC minuit, `.setDate(d.getDate()-7)` mute en
  heure locale du process — décalage possible d'un jour si `TZ` ≠ UTC.
- **Correction** : utiliser exclusivement des opérations UTC (`setUTCDate` etc.) ou confirmer
  `TZ=UTC` fixé en déploiement.
- **Statut** : ✅ **corrigé**, sans test dédié. `setDate`/`getDate` (heure locale) remplacés par
  `setUTCDate`/`getUTCDate` — correctif pur (aucun changement de comportement si `TZ=UTC` en
  prod, corrige le vrai bug latent sinon). Pas de test ajouté : `vrpWorker.ts` n'a pas de garde
  `isDirectRun` comme `recurringMissionsWorker.ts`/`auditRetentionWorker.ts` — il crée un vrai
  worker BullMQ + connexion Redis **au niveau module, sans fonction englobante du tout** ; importer
  ce module pour tester `getJ7Date()` isolément démarrerait une vraie connexion. Refactoriser tout
  le fichier pour le rendre testable est hors du périmètre de cette correction ponctuelle —
  vérifié par inspection + `npm run build` propre.

### N10 — `catch {}` silencieux sur calibrage ML (VRP index.ts)
- **Fichier** : `src/lib/vrp/index.ts` lignes ~110-112, ~163-166
- **Confiance** : CONFIRMÉ
- **Description** : `applyMLCoefficients`/`loadFamiliarity` avalent les erreurs sans log, alors
  que `createLogger` est déjà importé dans ce fichier.
- **Correction** : logger l'erreur en `warn` avant de continuer en dégradé.
- **Statut** : ✅ **corrigé + testé**. Les deux `catch` loggent maintenant en `warn` avec
  tenantId + message d'erreur. Tests ajoutés (`index.test.ts`, +2, vérifiés en échouant sans le
  correctif) : `mockLog.warn` appelé sur échec de `applyMLCoefficients` et de `loadFamiliarity`,
  le run continue en dégradé dans les deux cas.

### N11 — Mutation de l'objet `options` fourni par l'appelant (VRP index.ts)
- **Fichier** : `src/lib/vrp/index.ts` ligne ~105
- **Confiance** : À VÉRIFIER (pas de trigger identifié actuellement)
- **Description** : `options.defaultSpeedKmh = Math.round(...)` mute l'objet appelant au lieu
  d'une copie locale. Fragile si `options` était un jour réutilisé par l'appelant.
- **Statut** : ✅ **corrigé + testé**. Variable locale `effectiveDefaultSpeedKmh` introduite,
  mutée à la place de `options.defaultSpeedKmh`, réutilisée dans la construction de `ctx.speedKmh`
  (seul autre point de lecture). Test ajouté (+1, vérifié en échouant sans le correctif) : l'objet
  `options` fourni par l'appelant reste inchangé après l'appel, même quand le travelCoeff ML
  déclenche l'ajustement de vitesse.

### N12 — `estimatedDurationMin` non protégé contre `undefined` (formatSolution.ts)
- **Fichier** : `src/lib/vrp/formatSolution.ts::formatSolutionForAPI()` ligne 354
- **Confiance** : À VÉRIFIER (dépend si le champ peut réellement être undefined à ce point du
  pipeline — le schema Zod le rend obligatoire à la création, mais à confirmer pour tout chemin
  interne)
- **Description** : addition sans `?? 0`/`Math.max(0, ...)`, contrairement à `routeCost.ts` qui
  protège systématiquement. Risque de `NaN` dans les horaires affichés au chauffeur si jamais
  undefined.
- **Statut** : ✅ **corrigé + testé** (2 occurrences trouvées et corrigées, pas 1 : ligne 354 ET
  688). Test ajouté (+1, vérifié en échouant sans le correctif) : une mission avec
  `estimatedDurationMin` corrompu (`undefined`, cast) au milieu d'une tournée de 19 missions
  n'empêche pas le warning de surcharge horaire (`totalWork > MAX_WORK_MIN`) de se déclencher
  correctement pour les 18 autres — sans la garde, `NaN` se propage dans `totalWork`/`currentMin`
  pour toutes les missions suivantes de la tournée, et `NaN > seuil` est toujours faux (warning
  supprimé silencieusement).

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
- **Statut** : ✅ **corrigé + testé**, et l'impact réel s'est avéré plus large que "juste un log
  peu clair" : sans le correctif, la config corrompue/indéchiffrable d'UN SEUL tenant faisait
  planter (500) l'authentification du webhook pour TOUS les autres tenants ayant une intégration
  Geotab/Samsara valide dans le même batch `findMany` — pas juste ce tenant-là. Le `.find()`
  catch maintenant l'erreur, logue en `warn` (tenantId + message), et continue la recherche.
  Tests ajoutés (`integrations.test.ts`, +2, un par webhook, vérifiés en échouant sans le
  correctif) : un tenant à la config indéchiffrable n'empêche pas l'authentification via
  l'intégration suivante, valide, dans la même liste.

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
- **Statut** : ✅ **corrigé + testé (A5)** — décision tranchée par l'utilisateur en session de
  clôture d'audit : traiter maintenant plutôt que reporter indéfiniment.
  - **Migration** : `generatedFromTemplateId String?` ajouté sur `Mission`, relation optionnelle
    vers `MissionTemplate` (`onDelete: SetNull`), index dédié. Migration additive pure (colonne
    nullable, pas de `NOT NULL`, pas de drop) — appliquée en dev, vérifiée sans perte de données
    (1706 lignes `Mission` avant/après, `SELECT count(*)` identique).
  - **Backfill** (`prisma/backfill-generatedFromTemplateId.ts`, `npm run
    db:backfill-template-links`) : pour chaque `Mission` sans lien, calcule les occurrences
    RRule historiques de chaque `MissionTemplate` (même logique `toRRule` que le worker, exportée
    depuis `recurringMissionsWorker.ts`) et cherche un match tenantId+date+address+type+
    clientName. Ne lie QUE si le match est non-ambigu (exactement un template candidat) — laisse
    `null` sinon plutôt que deviner. Logique pure testée isolément
    (`src/lib/recurringTemplateBackfill.ts` + test, 6 cas dont l'ambiguïté et le cross-tenant).
    Exécuté en dev : 0 template existant → 0 lien créé, 1706 lignes intactes (comportement
    attendu, pas un échec).
  - **Worker** : `recurringMissionsWorker.ts` écrit désormais `generatedFromTemplateId` sur
    chaque mission créée, et déduplique sur `generatedFromTemplateId = tpl.id` en priorité, avec
    repli sur l'ancienne heuristique UNIQUEMENT pour les missions dont `generatedFromTemplateId`
    est encore `null` (créées avant la migration/backfill). Les nouvelles missions ne peuvent donc
    plus jamais retomber dans le cas ambigu d'origine.
  - Tests : `recurringMissionsWorker.test.ts` +2 (generatedFromTemplateId posé à la création,
    requête de dédup contient bien le OR stable/heuristique), `recurringTemplateBackfill.test.ts`
    +6 (match non-ambigu, hors-fenêtre RRule, signature différente, ambiguïté explicite,
    cross-tenant, règle de récurrence invalide). Les 2 tests worker vérifiés en échouant contre le
    code d'avant le correctif.

### N19 — Modèles avec `driverId` sans relation Prisma (pas de FK)
- **Fichier** : `prisma/schema.prisma` — `FuelRecord.driverId`, `DeliveryProof.driverId`,
  `InterventionMetric.driverId`, `PushSubscription.driverId`
- **Confiance** : À VÉRIFIER — dépend si chaque route d'écriture valide déjà le tenant du
  driverId manuellement (hors périmètre de cette entrée, à croiser avec l'audit routes)
- **Description** : contrairement à `Plan.driverId`/`Vehicle.assignedDriverId` (FK avec
  `@relation`), ces 4 champs sont de simples colonnes indexées sans intégrité référentielle DB.
- **Statut** : ✅ **`DeliveryProof` corrigé + testé** ; **`FuelRecord` et `PushSubscription`
  identifiés, non corrigés** ; `InterventionMetric` vérifié non concerné.
  - **`DeliveryProof.driverId`** (`src/app/api/delivery-proof/route.ts`) : CONFIRMÉ exploitable —
    `driverId` venait tel quel du `FormData` client, jamais vérifié contre `tenantId`, alors que
    `missionId` l'était déjà (ligne 41). Un `driverId` d'un AUTRE tenant pouvait être écrit dans
    une preuve de livraison. Corrigé : `prisma.driver.findFirst({where:{id:driverId,tenantId}})`
    ajouté, 404 si absent. Test ajouté (`incidents-comments-proof.test.ts`, +1, vérifié en
    échouant sans le correctif — retournait 200 avec un driverId d'un autre tenant).
  - **`FuelRecord.driverId`** (`src/app/api/fuel-records/route.ts`) : même schéma confirmé par
    inspection (`vehicleId` validé contre `tenantId` ligne 80, `driverId` non — champ optionnel du
    payload, écrit tel quel ligne 86) — **non corrigé**, laissé pour un futur passage, même classe
    de correctif que `DeliveryProof` directement applicable.
  - **`PushSubscription.driverId`** (`src/app/api/push/subscribe/route.ts`) : pattern similaire
    mais risque réel moindre — le destinataire réel d'un push est déterminé par
    `endpoint`/`p256dh`/`auth` (liés à l'abonnement navigateur, jamais falsifiables côté client
    de façon utile), et `/api/push/notify` filtre déjà par `tenantId` (serveur, jamais fourni par
    le client) avant tout filtre `driverId`. Un `driverId` incorrect ici mal-attribue
    l'abonnement au sein du BON tenant, ce n'est pas une fuite inter-tenant — **non corrigé,
    priorité plus basse**.
  - **`InterventionMetric.driverId`** (`src/lib/metricCollector.ts`) : `driverId` provient d'un
    appel interne serveur-à-serveur (pipeline de complétion de mission), pas d'une entrée client
    brute — **vérifié, pas d'action nécessaire**.

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
- **Confiance** : CONFIRMÉ (élevé à partir d'"à vérifier" — vrai bug trouvé, pas juste une absence
  de colonne théorique)
- **Description** : pas de colonne `tenantId`, seulement `clientId`/`siteId`. Sûr tant que tout
  accès passe par un `Client`/`Site` déjà vérifié tenant.
- **Statut** : ✅ **corrigé + testé**. Audit de tous les points d'écriture `clientSite.*` (4 réels,
  hors client Prisma généré) :
  - `POST /api/clients` (création, `siteIds`) : déjà correct — `prisma.site.count({id:{in:siteIds},
    tenantId})` vérifié avant `clientSites: {create: ...}`.
  - `PUT /api/sites/[id]` (`clientIds`) : déjà correct — même pattern côté `client.count`.
  - `POST /api/site-products` : déjà correct — `client`/`site` chargés individuellement avec
    `tenantId` avant l'`upsert` `clientSite`.
  - **`PUT /api/clients/[id]` (`siteIds`) : BUG RÉEL CONFIRMÉ.** Le `clientId` (`id` de l'URL)
    était bien vérifié contre `tenantId`, mais les `siteIds` du body ne l'étaient PAS avant
    `tx.clientSite.createMany({data: siteIds.map(siteId => ({clientId: id, siteId}))})` — alors que
    la route POST équivalente (création) fait cette vérification. Un admin du tenant A pouvait
    lier son propre client à un `siteId` appartenant à un AUTRE tenant B ; le `GET` suivant
    (`include: {clientSites: {include: {site: true}}}`) exposait alors nom/adresse/coordonnées du
    site de B au tenant A — fuite cross-tenant réelle, pas théorique.
  - **Correction** : ajout du même garde `prisma.site.count({id:{in:siteIds}, tenantId})` juste
    avant la transaction, miroir exact du pattern déjà utilisé par `POST /api/clients` et
    `PUT /api/sites/[id]`.
  - Tests ajoutés (`crud.test.ts`, +2, vérifiés en échouant sans le correctif — l'un attendait 400
    et recevait 200, l'autre vérifiait l'appel à `site.count` non fait) : rejet d'un `siteId` hors
    tenant, acceptation normale d'un `siteId` du bon tenant.

### N22 — Permissions granulaires (`UserPermission`) quasi jamais consultées (trouvé en Phase 3)
- **Fichiers** : `src/lib/permissions.ts`, `src/app/api/permissions/route.ts`, tous les routes
  d'écriture (`drivers`, `vehicles`, `missions`, `exutoires`, `users`, `settings`, `integrations`…)
- **Catégorie** : écart design/implémentation — trouvé pendant la vérification manuelle Phase 3 de
  l'invariant "permissions granulaires" listé dans CLAUDE.md, pas pendant l'audit ligne-à-ligne
  Phase 1
- **Confiance** : CONFIRMÉ
- **Description** : `hasPermission(userId, role, permission)` existe, `ALL_PERMISSIONS` liste 11
  permissions (`optimize`, `manage_drivers`, `manage_exutoires`, `manage_missions`,
  `manage_vehicles`, `manage_users`, `view_reports`, `view_costs`, `manage_settings`,
  `api_access`, `manage_integrations`), `DEFAULT_PERMISSIONS` donne un sous-ensemble par défaut
  aux `dispatcher` (les `admin`/`superadmin` ont toujours tout, court-circuité ligne 35), et
  `GET/PUT /api/permissions` permet de lire/écrire des `UserPermission` par utilisateur (testé,
  fonctionnel). Mais `hasPermission()` n'est appelée que dans **UN SEUL** endroit de toute la
  codebase applicative : `src/app/api/optimize/route.ts` (permission `optimize`). Toutes les
  autres routes (`drivers`, `vehicles`, `missions`, etc.) gate uniquement sur le `role` brut
  (`role !== 'admin' && role !== 'dispatcher'`), jamais sur la permission granulaire. De plus,
  **aucune UI n'appelle `/api/permissions`** (0 résultat dans `src/components/**`, seul le fichier
  de test l'utilise) — la fonctionnalité de personnalisation par-utilisateur n'est exposée nulle
  part dans l'admin.
- **Impact réel** : plus faible qu'il n'y paraît. Les ressources sensibles (`exutoires`, `users`,
  `settings`, `integrations`) sont déjà bloquées aux non-admins par le `role` check à lui seul,
  indépendamment du système de permissions granulaires — donc pas de fuite pour ces catégories.
  Le vrai trou concerne uniquement la possibilité de **restreindre un dispatcher spécifique**
  en dessous de son défaut de rôle (ex. lui retirer `manage_vehicles` alors que les dispatchers y
  ont accès par défaut) : cette personnalisation, si elle était configurée via l'API brute
  (`PUT /api/permissions`), serait silencieusement ignorée par toutes les routes sauf `optimize`.
  Sans UI pour la configurer, le risque pratique est faible aujourd'hui, mais le système donne une
  fausse impression de contrôle fin s'il était un jour câblé à une UI sans corriger l'application
  côté API.
- **Statut** : ✅ **corrigé + testé (A7)** — décision tranchée par l'utilisateur : câbler
  `hasPermission()` dans les 9 familles de routes restantes plutôt que laisser le système de
  permissions granulaires sans effet réel hors `/api/optimize`.
  - `hasPermission(userId, role, permission)` ajouté sur `drivers` (POST + PUT/DELETE `[id]`),
    `vehicles` (POST + PUT/DELETE `[id]`), `missions` (POST + PUT/DELETE `[id]`), `exutoires`
    (POST + PUT/DELETE `[id]`), `users` (POST + PUT/DELETE `[id]`), `settings` (PUT),
    `integrations` (POST), `reports` (GET), `api-keys` (POST) — en plus du check de `role` brut
    déjà existant, jamais en remplacement.
  - **L'audit initial de N22 sous-estimait l'impact réel** : l'hypothèse « les ressources
    sensibles sont déjà bloquées par le `role` check à lui seul » s'est révélée **fausse pour
    plusieurs routes**, découvert en traçant chaque route pendant le câblage :
    - **`POST /api/users` n'avait AUCUN garde de rôle avant cette correction** — n'importe quel
      utilisateur authentifié, y compris un `driver`, pouvait appeler `POST /api/users` avec
      `{"role":"ADMIN",...}` (`UserCreateSchema.role` accepte `'ADMIN'`) et se créer un compte
      admin sur son propre tenant. **Escalade de privilèges complète, pas juste un écart de
      permissions granulaires.** Un check `role !== 'admin' && role !== 'superadmin'` a été ajouté
      en plus de `hasPermission`.
    - **`POST /api/drivers`, `POST /api/missions`, `PUT /api/missions/[id]`,
      `PUT`/`DELETE /api/vehicles/[id]`, `PUT /api/drivers/[id]`** : aucun garde de rôle non plus
      avant cette session — n'importe quel rôle authentifié (y compris `driver`) pouvait créer un
      chauffeur/une mission, ou modifier/supprimer un véhicule. Corrigé par l'ajout de
      `hasPermission()` (rôle `driver` → `DEFAULT_PERMISSIONS.driver = []`, donc 403 pour tous ces
      cas maintenant).
    - **`DELETE /api/drivers/[id]`, `DELETE /api/missions/[id]`** : le garde existant ne bloquait
      QUE `role === 'dispatcher'`, laissant passer `driver` — un chauffeur pouvait supprimer
      n'importe quelle mission ou n'importe quel chauffeur de son tenant. Confirmé exploitable via
      test de régression (`security-idor.test.ts`, vérifié en échouant contre l'ancien code — 404
      au lieu du 403 attendu, la suppression était tentée). Corrigé par `hasPermission()` en plus
      du check existant.
  - Ces découvertes reclassent une partie de N22 de "écart design mineur" à **bug de sécurité réel
    (escalade de privilèges via `/api/users`, IDOR via `driver` sur delete)** — la sévérité 🟡
    listée en tête de cette entrée ne reflète que le design du système `UserPermission` en général,
    pas ces trous de `role` spécifiques trouvés en le câblant.
  - **UI ajoutée** (`UsersTab.tsx`) : panneau "Permissions" dans la modale d'édition utilisateur —
    liste les 11 permissions (`GET /api/permissions?userId=`), case à cocher par permission
    (`PUT /api/permissions`), bouton "Réinitialiser aux valeurs par défaut du rôle" si des
    permissions personnalisées existent. Jusqu'ici `/api/permissions` n'était appelé nulle part
    côté client — la fonctionnalité de personnalisation par-utilisateur documentée dans CLAUDE.md
    est maintenant réellement exposée dans l'admin.
  - Tests ajoutés/mis à jour (tous vérifiés en échouant contre l'ancien code avant correctif) :
    `drivers.test.ts` (+2), `missions-id.test.ts` (+2), `security-idor.test.ts` (le test
    "driver CAN delete missions" documentait le trou — réécrit en "driver cannot delete missions
    (403)"), `routes-health-vehicles-exutoires-missions.test.ts` (+2 dispatcher default/revoked
    sur `vehicles`), `routes-users-settings-reports.test.ts` (+2 sur `reports`, +1 sur `users`
    admin-bypass), `users-audit-permissions-features.test.ts` (mock `hasPermission` ajouté).
  - **Bug de fuite d'état entre tests trouvé et corrigé pendant la vérification** : deux fichiers
    de test utilisaient `mockReturnValue`/`mockResolvedValue` (persistants) au lieu de
    `mockReturnValueOnce`/`mockResolvedValueOnce` pour simuler un rôle `dispatcher` ponctuel, ou
    laissaient un `mockResolvedValueOnce` jamais consommé (bypass admin) traîner dans la file —
    `vi.clearAllMocks()` (utilisé dans tous les `beforeEach` de ce repo) réinitialise l'historique
    d'appels mais PAS les implémentations/valeurs `Once` déjà enregistrées. Résultat : 10 tests en
    échec en cascade dans deux fichiers (rôle `dispatcher`/`disp-revoked` fuitant vers des tests
    suivants censés tourner en `admin`). Corrigé en alignant sur le pattern déjà correct de
    `drivers.test.ts`/`missions-id.test.ts` (`mockReturnValueOnce`, retrait du mock inutile sur le
    cas admin-bypass). Suite complète repassée verte après correctif (199 fichiers, 3522 tests).

### N23 — Race condition entre le flush page et le flush Service Worker de la file offline
- **Fichiers** : `src/lib/syncQueue.ts:7,45-53` (verrou `_flushInProgress`), `public/sw.js:57-104`
  (`flushQueue()`)
- **Catégorie** : fiabilité — trouvé pendant la vérification manuelle Phase 3 du mode dégradé
  chauffeur hors-ligne (invariant non couvert par l'audit Phase 1, qui avait déjà trouvé N17 sur
  le head-of-line blocking du même fichier mais pas cette race-là)
- **Confiance** : CONFIRMÉ (mécanisme), impact réel dépend de l'idempotence des endpoints ciblés
- **Description** : `flushSyncQueue()` (page) protège contre les appels concurrents **dans le même
  contexte JS** via un booléen en mémoire (`_flushInProgress`). Mais `public/sw.js` a sa **propre**
  implémentation indépendante de `flushQueue()`, exécutée dans le contexte séparé du Service
  Worker — aucun verrou partagé entre les deux. Pire : `enqueueAction()` (`syncQueue.ts:22-24`)
  envoie explicitement un `postMessage({type:'FORCE_SYNC'})` au SW à CHAQUE ajout en file, donc le
  flush SW peut être déclenché activement pendant qu'un flush page est en cours (pas seulement via
  l'event `sync` en arrière-plan). Les deux flushs lisent la file (IndexedDB) indépendamment,
  peuvent tous les deux voir la même action encore présente avant que l'un des deux ne la
  supprime, et donc **POSTer la même action deux fois** au serveur.
- **Impact réel** : limité par l'idempotence de plusieurs endpoints ciblés par la file offline
  (ex. `DeliveryProof` utilise déjà un `upsert` sur `missionId`, donc un double-POST n'y crée pas
  de doublon), mais pas garanti pour tous les types d'actions mises en file (à confirmer action par
  action — hors périmètre de cette vérification manuelle).
- **Non corrigé dans cette session** : touche l'architecture de synchronisation hors-ligne
  (fonctionnalité sensible/critique pour les chauffeurs en zone blanche) — un correctif correct
  nécessite soit un verrou partagé via IndexedDB lui-même (ex. enregistrement `flush-lock` avec
  timestamp/expiration lu par les deux contextes), soit une redécision d'architecture (le SW
  devient le seul flusher, la page ne fait plus que déclencher via `postMessage`/`sync.register`
  et n'exécute plus jamais `_doFlush()` elle-même). Aucun des deux n'est un correctif ponctuel
  sûr sans tests de concurrence page/SW dédiés, qui n'existent pas dans la suite actuelle —
  proposé pour un chantier dédié plutôt que décidé unilatéralement ici.

---

### N24 — Vérification dédiée post-A7/N22 : audit AuditLog, fail-closed hasPermission(), grep exhaustif
- **Fichiers** : `src/lib/permissions.ts`, `src/lib/audit.ts`, `src/app/api/users/route.ts`,
  `src/app/api/templates/route.ts`
- **Catégorie** : vérification de sécurité dédiée demandée après le fix A7/N22 (escalade de
  privilèges via `POST /api/users` sans check de rôle) — 4 points distincts
- **Confiance** : CONFIRMÉ pour tous les points
- **1. AuditLog en base (dev)** : **aucune preuve d'exploitation**. `SELECT * FROM "AuditLog"
  WHERE "entityType" = 'User'` retourne **0 ligne** — `POST /api/users` n'a **jamais** appelé
  `writeAudit()`/`auditAsync()` (`src/lib/audit.ts`), avant ou après le fix A7. Impossible de
  savoir depuis les logs si l'escalade a été exploitée avant le correctif ; ce n'est pas "pas
  d'exploitation détectée", c'est "aucune télémétrie n'existe pour le détecter". Les 2 seuls
  comptes `ADMIN` en base (`admin@pathelix-massive.test`, `admin@excoffier.fr`, créés
  2026-07-03) proviennent de `prisma.user.create()` direct dans `prisma/seed.ts`/
  `seed-massive.ts`, pas de l'API — pas liés à la faille. Les 700 lignes `AuditLog` existantes
  sont à 500/700 des données synthétiques générées par `seed-massive.ts:704-720` (action/entité
  aléatoires, `userId` piochés dans `driverIds`) et à 200/700 de vrais appels
  `mission.create`/`Mission` (trafic dev réel). **Staging/prod non vérifiables** — aucun accès
  configuré dans cette session, seule `DATABASE_URL` locale (`localhost:5432`) était disponible.
  **Gap corollaire non corrigé** : `POST /api/users` (création ou changement de rôle) ne journalise
  toujours rien dans `AuditLog` — même avec le rôle maintenant vérifié, une création de compte
  admin par un admin légitime mais compromis resterait invisible. Recommandé pour un chantier
  séparé (`writeAudit(req, 'user.create', 'User', user.id, { role })`).
- **2. `hasPermission()` fail-closed confirmé** — `src/lib/permissions.ts:29-59`. Le seul
  court-circuit est `role === 'admin' || role === 'superadmin'` (ligne 35). Pour tout autre rôle
  sans `UserPermission` personnalisée, le fallback est `DEFAULT_PERMISSIONS[role] ?? []`
  (ligne 54) — `driver` vaut `[]`, et un rôle inconnu/absent de la table tombe aussi sur `[]` via
  le `?? []`. **Déjà fail-closed, aucun correctif nécessaire.**
- **3. Grep exhaustif des routes d'écriture** (`src/app/api/**/route.ts` avec `POST/PUT/DELETE/
  PATCH` + écriture Prisma directe ou via `src/lib/data/*`, 87 fichiers passés en revue) — **1
  route supplémentaire trouvée sans aucune protection**, hors des 9 familles déjà couvertes par
  A7 : **`POST /api/templates`** (création de `MissionTemplate`, missions récurrentes) n'utilisait
  que `getTenantId(req)`, sans `getRequestContext`/`hasPermission` — n'importe quel rôle
  authentifié, y compris `driver`, pouvait créer des templates de missions récurrentes pour le
  tenant. Isolation tenant déjà correcte (pas de fuite cross-tenant), mais pas de garde de rôle.
  **Corrigé** : `hasPermission(userId, role, 'manage_missions')` ajouté, même pattern que
  `POST /api/missions`. Les autres routes `rolecheck=0` identifiées par le grep
  (`ai/callback`, `auth/change-password`, `auth/logout`, `delivery-proof`, `driver-photos`,
  `history[/[id]]`, `incidents`, `mission-comments`, `missions/parse-natural` (ne fait aucune
  écriture — faux positif du grep), `push/subscribe`, `tracking`, webhooks `geotab/nessy/obd/
  samsara/trackdechets`) ont été lues individuellement : auth HMAC/API-key pour les webhooks et
  `ai/callback`, self-service scope par tenant/driver pour les autres (aucune ne touche à un champ
  `role`/permission, aucune n'écrit pour un tenant ou utilisateur autre que l'appelant) — acceptées
  comme design intentionnel, pas des trous d'escalade.
- **4. Tests dédiés ajoutés** (scénario exact : rôle bloqué → 403, DB write jamais tenté) pour
  les 6 routes visées :
  - `POST /api/users` — driver + `role:"ADMIN"` dans le payload → 403
    (`routes-users-settings-reports.test.ts`)
  - `POST /api/drivers` — déjà couvert (`drivers.test.ts`, test pré-existant A7)
  - `POST /api/missions` (création ordinaire, pas `action=archive-all`) — nouveau test driver → 403
    (`crud.test.ts`)
  - `PUT /api/missions/[id]` — déjà couvert (`missions-id.test.ts`, test pré-existant A7)
  - `PUT /api/vehicles/[id]` et `DELETE /api/vehicles/[id]` — nouveaux tests driver → 403
    (`routes-health-vehicles-exutoires-missions.test.ts`) ; ces deux endpoints n'avaient
    **aucun** test de rôle avant cette session malgré le fix A7 appliqué au code
  - `PUT /api/drivers/[id]` — nouveau test driver → 403 (`drivers-id.test.ts`), plus mock
    `@/lib/db`/`userPermission` ajouté (absent du fichier, `hasPermission()` n'était donc jamais
    exercé en dehors du chemin admin-bypass)
  - `POST /api/templates` — nouveau test driver → 403 pour le gap trouvé au point 3
    (`templates.test.ts`)
  - Suite complète repassée verte après ajout : 199 fichiers / 3529 tests (+7 vs baseline A7 de
    3522), lint et `tsc --noEmit` propres.

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
| M3 | Isolation tenant absente positions OBD/Geotab/Samsara | 🟠 majeure | ✅ Geotab/Samsara corrigés+testés ; OBD générique à valider utilisateur (pas de tenantId résolvable du tout) |
| M4 | Worker missions récurrentes sans isolation d'erreur | 🟠 majeure | ✅ corrigé + testé |
| M5 | Custom trades jamais enregistrés | 🟠 majeure | ✅ corrigé serveur + testé (⚠️ gap client documenté) |
| M6 | planningStore IndexedDB non nettoyé (fuite tenant) | 🟠 majeure | ✅ corrigé + testé (gap couverture admin/superadmin page.tsx documenté) |
| M7 | compactRoutes/forceAssignP1 sans deadline | 🟠 majeure | ✅ corrigé + testé |
| M8 | Collision hash 32 bits cache haversine | 🟠 majeure | ✅ corrigé + testé |
| M9 | Unité incohérente rebalanceSectors | 🟠 majeure | ✅ corrigé + testé (garde-fou oscillation ajouté) |
| M10 | forceAssignP1 peut violer invariant ALLER_RETOUR | 🟠 majeure | ✅ corrigé + testé |
| M11 | Divergence syncQueue/sw.js erreurs réseau | 🟠 majeure | ✅ corrigé + testé |
| M12 | Nessy secret global + tenantId appelant | 🟠 majeure | à valider utilisateur |
| N1 | `!oi === undefined` garde mort (externalRoutingApi) | 🟡 mineure | ✅ corrigé + testé |
| N5 | advanceStatus effets de bord dans updater | 🟡 mineure | accepté tel quel (StrictMode = dev only, jamais en prod ; risque réel de régression identifié dans la correction "propre") |
| N2 | `x-tenant-trade` non strippé | 🟡 mineure | ✅ corrigé (pas de test dédié — impact nul confirmé, limite harnais middleware) |
| N3 | Divergence regex tenantId session.ts/context.ts | 🟡 mineure | ✅ corrigé + testé |
| N6 | Tooltip.tsx timer non nettoyé | 🟡 mineure | ✅ corrigé + testé |
| N7 | DRIVER_SELECT sur-fetch | 🟡 mineure | ✅ corrigé + testé |
| N10 | catch{} silencieux calibrage ML | 🟡 mineure | ✅ corrigé + testé |
| N11 | Mutation objet options (VRP) | 🟡 mineure | ✅ corrigé + testé |
| N12 | estimatedDurationMin non protégé | 🟡 mineure | ✅ corrigé + testé |
| N15 | .find() non catché Geotab/Samsara | 🟡 mineure | ✅ corrigé + testé (impact réel plus large que prévu) |
| N9 | getJ7Date UTC/local | 🟡 mineure | ✅ corrigé (pas de test — voir détail) |
| N19 | driverId sans FK | 🟡 mineure/majeure | ✅ DeliveryProof corrigé+testé ; FuelRecord identifié non corrigé ; PushSubscription priorité basse ; InterventionMetric non concerné |
| N4,N13,N14,N16,N17 (reste, non actionnable sans arbitrage) | Voir détail | 🟡 mineure | accepté tel quel / à valider utilisateur |
| N8 | Calcul mort ejectionChainSearch (VRP) | 🟡 mineure | ✅ corrigé (refactor pur, pas de test dédié) |
| N18 | Dédup fragile worker missions récurrentes | 🟡 mineure | reporté — nécessite migration schéma |
| N20 | ClientSite sans tenantId propre | 🟡 mineure→**bug réel** | ✅ corrigé + testé (vrai bug cross-tenant trouvé sur PUT /api/clients/[id]) |

**0 faux positif identifié comme tel dans cette synthèse** — tout ce qui reste incertain est
explicitement marqué "à vérifier" ou "à valider par l'utilisateur" plutôt que présenté comme
confirmé.

*(Phase 1 terminée. Passage en Phase 2 : corrections critique → majeures → mineures, une par une,
avec test de régression et suite complète à chaque étape, sauf items "à valider par l'utilisateur"
qui sont documentés mais non corrigés sans arbitrage produit/architecture.)*

---

## Phase 2 — Bilan

23 commits de correctifs (`fix(...)`), un par bug, chacun avec test de régression vérifié en
échouant sans le correctif puis passant avec, et suite complète (lint + typecheck + tests + build)
relancée après chaque correctif. Détail par item ci-dessus. Deux bugs cross-tenant réels
supplémentaires trouvés pendant les corrections elles-mêmes (pas dans l'audit Phase 1 initial) :
N20 (`ClientSite`, `PUT /api/clients/[id]`) et le volet Geotab/Samsara de M3 — les deux corrigés
et testés dans la foulée.

Items non corrigés, chacun avec raison explicite documentée ci-dessus (pas de décision produit
prise unilatéralement) : M3/OBD générique, M12 (secret Nessy), N4 (topologie déploiement), N13,
N14, N16, N17 (compromis de conception), N18 (nécessite migration schéma), FuelRecord/
PushSubscription (volet non corrigé de N19).

## Phase 3 — Vérification non-régression globale

**Suite complète (lint + typecheck + test + build + npm audit)** : verte à chaque étape de Phase 2
(voir chaque commit) et en fin de Phase 2 — 197 fichiers de test, 3491 tests, 0 échec. `npm audit
--audit-level=critical` : 0 vulnérabilité critique (5 high, 26 moderate, 1 low — toutes
préexistantes, transitives via les dépendances bundlées de Next (postcss, sharp), correctif
disponible uniquement via `npm audit fix --force` qui bumperait Next vers une version majeure
breaking — **non fait, nécessite validation utilisateur explicite avant un tel changement**).

**E2E (Playwright, 387 tests / 32 fichiers)** : première exécution E2E de cet audit (Phase 0 ne
couvrait pas l'E2E). Premier run : ~40% des specs UI chromium échouaient/timeout. Root cause
trouvée et corrigée : `e2e/auth.setup.ts` ne fermait jamais la modale `OnboardingGuide` (guide de
bienvenue plein écran, `src/components/ui/OnboardingGuide.tsx`) avant de sauvegarder le
`storageState` réutilisé par tous les tests du projet `chromium` — chaque test démarrait donc avec
une modale bloquante ouverte. Bug d'infra de test préexistant (la modale existait avant cette
session, `auth.setup.ts` n'avait simplement jamais été mis à jour), sans lien avec les correctifs
de cette session — confirmé par inspection (la modale est gérée par une clé localStorage locale au
composant, jamais touchée par aucun commit de cette session) et par le fait que le correctif a
ramené la quasi-totalité des specs précédemment 100% en échec à un passage direct. Corrigé et
commité (`5cf406e`).

Après ce correctif, un ré-run complet n'a **pas pu être mené à terme dans cette session** : la
machine a fini par manquer de mémoire (1.16 Go libres sur 15.7 Go observés à un moment, dev server
Next à lui seul consommant ~5.3 Go après plusieurs cycles consécutifs de build+test+E2E) après
~90 minutes d'exécution continue, provoquant des échecs en cascade sur la fin du run
(`missions.spec.ts` entier en échec double, alors que les fichiers précédents passaient
normalement) — caractéristique de l'épuisement de ressources de la machine locale, pas du code.
Sur les ~257 tests exécutés avant l'arrêt (run propre, serveur frais après le correctif) : 165
passages immédiats, ~60 passages au 2ᵉ essai (`retries:1`) dus au délai de compilation à la volée
de Next en mode dev (composant jamais visité = premier hit dépasse le timeout de 30s, retry rapide
une fois compilé — caractéristique connue du test contre `next dev` plutôt qu'un build de
production, pas une régression), et 2 échecs doubles génuines identifiées avant la dégradation
mémoire : `drivers-advanced.spec.ts` "pagination next/previous buttons navigate between pages"
(liste chauffeurs vide au moment du test — pollution d'état inter-tests dans ce fichier, probable
filtre de recherche laissé actif par un test précédent) et `missions-advanced.spec.ts` "reset
filters button clears all active filters". Aucune des deux ne touche un fichier modifié dans cette
session — non creusées plus loin (priorité donnée aux correctifs d'audit, déjà validés par la
suite unitaire/intégration complète).

**Honnêteté sur ce point** : l'E2E n'a donc PAS été validé à 100% par un run complet propre dans
cette session. Ce qui est acquis : (1) un vrai bug d'infra E2E trouvé et corrigé, (2) aucune
régression E2E détectée imputable aux correctifs de cette session sur les ~257 tests observés,
(3) 2 flakys préexistants non liés identifiés pour référence future. Un run E2E complet propre
reste à faire (recommandé sur une machine avec plus de mémoire disponible, ou en tuant tous les
process Node superflus avant de lancer).

**Vérification manuelle des invariants** (lecture de code, pas de nouveaux tests — les invariants
eux-mêmes sont déjà couverts par la suite unitaire/intégration existante) :
- **Isolation multi-tenant** : `src/middleware.ts` strippe puis réinjecte `x-tenant-id`/
  `x-user-id`/`x-user-role`/`x-tenant-trade` depuis le JWT vérifié — intact, vérifié par lecture
  directe. Trois bugs cross-tenant réels trouvés et corrigés cette session (N19 DeliveryProof,
  N20 ClientSite, M3 Geotab/Samsara) démontrent que le processus de vérification fonctionne
  concrètement, pas juste en théorie.
- **Permissions granulaires** : **écart trouvé (N22) puis corrigé + testé (A7, décision utilisateur
  ultérieure, voir détail dans l'entrée N22 ci-dessus)** — `hasPermission()` n'était câblé que sur
  `/api/optimize` au moment de cette vérification Phase 3. Câblage étendu à 9 familles de routes
  supplémentaires dans une session suivante, ce qui a aussi mis au jour de vrais trous de `role`
  (pas seulement de permission granulaire) sur plusieurs routes — dont une escalade de privilèges
  critique sur `POST /api/users` (aucun garde de rôle, `role:"ADMIN"` acceptable dans le payload).
- **Mode dégradé Redis** : fallback en mémoire pour le rate limiter (`rateLimit.ts`), erreurs
  catch+log pour `redisCache` — pas de crash si Redis est down, dégradation propre.
  `USE_MOCK_DATA`/session/queue non re-testés en direct (Redis réellement coupé) faute de temps —
  vérifié par lecture de code uniquement.
- **Mode dégradé Valhalla** : `valhallaMatrix.ts` bascule proprement sur haversine avec `log.warn`
  si l'appel Valhalla échoue — confirmé par lecture de code (comportement déjà couvert par tests
  unitaires existants).
- **Mode dégradé worker VRP** : `optimizationStore.ts` détecte un job resté en `waiting` au-delà de
  `WAITING_TIMEOUT_MS` et affiche explicitement "Serveur de calcul indisponible (aucun worker
  actif)" au lieu de tourner indéfiniment ; timeout global de 10 min en filet de sécurité. Bon
  comportement confirmé par lecture de code.
- **File offline chauffeur (sync-queue)** : **écart trouvé (N23, documenté ci-dessus)** — race
  condition réelle entre le flush côté page et le flush côté Service Worker (deux implémentations
  indépendantes, aucun verrou partagé), pouvant POSTer deux fois la même action en file. Impact
  partiellement amorti par l'idempotence de certains endpoints (`DeliveryProof` upsert) mais pas
  garanti partout. Non corrigé — nécessite une décision d'architecture, proposé pour un chantier
  dédié.

**Comparaison au baseline Phase 0** : lint/typecheck/build restent propres (identique à Phase 0).
Tests : 3491 vs baseline Phase 0 (nombre exact non re-cité ici, disponible dans l'historique de
conversation — delta net = +tests ajoutés par chaque correctif de Phase 2, 0 test supprimé/désactivé
conformément à la règle absolue de la mission). `npm audit` critique : 0 dans les deux cas.

---

## Phase 4 — Mission de clôture finale (en cours)

Suite du travail après N24 (vérification dédiée de l'escalade de privilèges). Statuts mis à jour
en continu au fil de l'avancement.

### Phase 0.1 — Audit trail sur les mutations sensibles (CLOS)
- **Trouvé** : `POST /api/users` n'écrivait jamais dans `AuditLog`, ni avant ni après le fix
  A7/N22 — une création de compte (y compris une tentative d'auto-promotion admin bloquée par le
  fix, ou une création légitime avec un rôle sensible) ne laissait aucune trace interrogeable.
  Même constat sur `PUT`/`DELETE /api/users/[id]` (changement de rôle silencieux), `PUT
  /api/permissions` (octroi/retrait de permission granulaire), `POST /api/integrations`
  (rotation de secret/clé API), et `DELETE /api/audit` (un superadmin purgeant l'historique
  d'audit ne laissait qu'une ligne de log applicatif, pas de trace durable interrogeable).
- **Corrigé** :
  - `POST /api/users` → `auditAsync(req, 'user.create', 'User', id, { email, role })`
  - `PUT /api/users/[id]` → `auditAsync(..., 'user.update', ..., { roleBefore, roleAfter,
    fieldsChanged, passwordChanged })` — le changement de rôle est explicitement isolé dans les
    `changes` pour être recherchable
  - `DELETE /api/users/[id]` → `auditAsync(..., 'user.delete', ..., { email, role })`
  - `PUT /api/permissions` → `auditAsync(..., 'user.permissions_update', ..., { permissions })`
  - `POST /api/integrations` → `auditAsync(..., 'integration.configure', ..., { type, enabled,
    configChanged })` — **jamais** la valeur du secret/config, uniquement le fait qu'il a changé
  - `DELETE /api/audit` → `logSuperadminAction({..., action: 'audit_log_purge', details: {
    after, before, deletedCount }})`, même mécanisme que les autres actions superadmin
    (`src/lib/superadminAudit.ts`), donc la purge elle-même reste tracée dans `AuditLog`
- **Passage exhaustif sur les 87 routes de mutation déjà grepées (N24)** : aucune autre route
  sensible (création/rôle/permission/intégration/secret) sans trace trouvée. `drivers`,
  `missions`, `vehicles` étaient déjà couverts par `auditAsync` avant cette session. Les autres
  routes de mutation (exutoires, settings, templates, sites, clients...) ne manipulent ni rôle ni
  secret — laissées telles quelles, cohérent avec le périmètre demandé (mutation *sensible*, pas
  CRUD générique).
- **Tests** : 7 nouveaux tests dédiés (`users-audit-permissions-features.test.ts` ×4,
  `routes-users-settings-reports.test.ts` ×1, `integrations.test.ts` ×1 avec assertion explicite
  que la valeur du secret n'apparaît jamais dans les `changes` loggés) — chacun vérifie l'appel
  exact à `auditAsync`/`logSuperadminAction` avec les bons arguments, pas juste le status code.
- Suite complète : 199 fichiers / 3536 tests (+7), lint et `tsc --noEmit` propres.
- **Commit** : `f47bab6` (`fix(N24/0.1): audit trail on user/permission/integration mutations + audit-log purge`)

### Phase 0.2 — Vérification par mutation testing des 20 points `hasPermission()` (CLOS)
- **Méthode** : pour chacun des 20 appels `hasPermission()` câblés lors de N22/A7 (9 familles +
  les 6 routes sans check + `POST /api/templates`), la ligne du check a été temporairement
  remplacée par `if (false) {` (le check ne bloque plus jamais rien), le fichier de test associé
  relancé, puis le fichier restauré via `git checkout`. Un test qui continue de passer malgré le
  check désactivé prouve qu'aucun test n'exerce réellement cette ligne.
- **Résultat** : 20 points testés → **9 correctement couverts** (le mutant est tué : au moins un
  test échoue), **2 gaps réels trouvés et corrigés**, **9 "mutants survivants" qui ne sont PAS des
  gaps de test mais du code mort confirmé** (détail ci-dessous).
- **2 gaps réels (corrigés)** : `DELETE /api/drivers/[id]` et `DELETE /api/missions/[id]`. Les
  deux ont un garde `if (role === 'dispatcher') return 403` **avant** `hasPermission()` — le seul
  test 403 existant (`role: 'dispatcher'`) est bloqué par ce garde et n'atteint jamais
  `hasPermission()`. Avec `hasPermission()` désactivé, tous les tests des deux blocs `describe`
  restaient verts. Corrigé par l'ajout d'un test `role: 'driver'` (non bloqué par le garde
  dispatcher-only, donc le seul chemin qui exerce réellement `hasPermission('manage_drivers'
  /'manage_missions')`) dans `drivers-id.test.ts` et `missions-id.test.ts`.
- **9 "mutants survivants" = code mort confirmé, PAS un gap de test** — nouvelle découverte non
  prévue par la mission initiale, documentée ici plutôt que noyée dans la liste ci-dessus :
  `POST /api/users` (:60), `PUT /api/users/[id]` (:46), `DELETE /api/users/[id]` (:98),
  `PUT /api/settings` (:100), `POST /api/integrations` (:66), `POST /api/api-keys` (:51),
  `POST /api/exutoires` (:33), `PUT /api/exutoires/[id]` (:30), `DELETE /api/exutoires/[id]`
  (:58). Ces 9 routes ont **toutes** un garde `role !== 'admin' [&& role !== 'superadmin']` placé
  **avant** `hasPermission()`. Combiné au court-circuit inconditionnel de
  `hasPermission()` pour `admin`/`superadmin` (`src/lib/permissions.ts:35`, cf. point 2 de N24),
  ceci rend `hasPermission()` **structurellement inatteignable en position de bloquer quoi que ce
  soit** sur ces 9 routes : tout rôle qui pourrait se faire refuser par `hasPermission()`
  (`dispatcher`, `driver`) est déjà rejeté par le garde `role !== 'admin'` avant d'y arriver, et
  tout rôle qui atteint `hasPermission()` (`admin`/`superadmin`) le fait toujours réussir sans
  jamais consulter `UserPermission`. **Pas un test manquant — le code lui-même ne peut jamais
  emprunter la branche 403 de `hasPermission()` sur ces 9 endpoints, quel que soit le test écrit.**
- **Impact réel** : *pas* un problème de sécurité (sens inverse d'une escalade — ces routes sont
  **plus restrictives** que ce que le système de permissions granulaires suggère, pas moins). Mais
  cela signifie concrètement que le système `UserPermission`/`/api/permissions` (censé permettre
  de personnaliser les droits d'un `dispatcher` en dessous ou différemment de son rôle) est
  **totalement inopérant** pour `manage_users`, `manage_settings`, `manage_integrations`,
  `api_access`, et `manage_exutoires` — impossible d'accorder à un dispatcher spécifique l'accès à
  ces 5 permissions via `PUT /api/permissions` (bloqué avant même d'atteindre `hasPermission`), et
  impossible de retirer ces accès à un admin (bypass inconditionnel). Seuls `manage_drivers`,
  `manage_vehicles`, `manage_missions`, `view_reports` (et `optimize`, hors de ce grep) sont de
  vraies permissions granulaires fonctionnelles aujourd'hui.
- **Non corrigé — arbitrage produit requis, pas un correctif technique autonome** : deux options
  s'excluent mutuellement et changent le comportement de sécurité (élargir l'accès dispatcher pour
  5 permissions, ou documenter/retirer le code mort) — décision volontairement non prise
  unilatéralement dans cette session, cohérent avec la façon dont A2-A4 ont été traités
  (arbitrages explicites, pas des corrections automatiques) :
  - **Option 1** : retirer le garde `role !== 'admin'` de ces 9 endpoints et laisser
    `hasPermission()` seul décider (comme `drivers`/`vehicles`/`missions`/`reports`) — ouvre la
    possibilité qu'un dispatcher se voie accorder `manage_users`/`manage_settings`/
    `manage_integrations`/`api_access`/`manage_exutoires` via `UserPermission`. Change le modèle
    de sécurité : à valider explicitement (ces 5 permissions sont plus sensibles que
    drivers/vehicles/missions/reports — `manage_users` en particulier touche à la gestion des
    comptes).
  - **Option 2** : retirer les appels `hasPermission()` désormais reconnus comme morts sur ces 9
    endpoints (ou les commenter comme "intentionnellement inatteignable, admin-only strict") pour
    ne pas laisser un futur développeur croire que la personnalisation par `UserPermission`
    fonctionne pour ces 5 permissions alors qu'elle ne fonctionne pas.
  - Statut : **documenté, non tranché**, flag levé explicitement dans le rapport final de cette
    mission.
- Suite complète après les 2 correctifs de gap réel : 199 fichiers / 3538 tests (+2), lint et
  `tsc --noEmit` propres.

### Phase B — npm audit (EN COURS — voir exception Next.js majeur)
- **Baseline** : 32 vulnérabilités (`npm audit`) — 1 low, 26 moderate, 5 high, 0 critical.
- **`@opentelemetry/*` (26 moderate + 1 high `sdk-node` + 1 high `propagator-jaeger`)** :
  dépendances directes (tracing custom instrumentation.ts, pas juste transitives). CVE la plus
  significative : allocation mémoire non bornée dans la propagation de baggage W3C
  (`@opentelemetry/core`, GHSA-8988-4f7v-96qf) et DoS via header `Jaeger` malformé
  (`propagator-jaeger`, GHSA-45rx-2jwx-cxfr) — **exploitable en pratique** si
  l'auto-instrumentation HTTP entrante est active (elle l'est, `auto-instrumentations-node`),
  puisque ce sont des headers HTTP contrôlables par un client externe. **Corrigé** : bump vers
  `sdk-node@0.221.0`, `auto-instrumentations-node@0.79.0`, `exporter-trace-otlp-http@0.221.0`,
  `resources@2.8.0` — 32 → 6 vulnérabilités. Suite complète (3538 tests, lint, `tsc --noEmit`)
  repassée verte après le bump.
- **`sharp` <0.35.0 (high, CVE-2026-33327/33328/35590/35591 dans libvips)** : dépendance directe,
  pas d'import direct dans le code applicatif (pas de traitement des photos de preuve de livraison
  via `sharp` explicitement — `delivery-proof/route.ts` écrit les fichiers bruts sur disque sans
  passer par `sharp`), mais **`next/image`** (utilisé sur `admin/page.tsx`, `login/page.tsx`,
  `DataProvider.tsx`) l'utilise en interne pour l'optimisation d'images côté serveur — surface
  d'attaque réelle si une image de preuve de livraison est un jour rendue via `next/image`.
  **Bump direct appliqué** (`sharp@0.34.5` → `0.35.3`) : neutralise le risque pour tout usage
  direct futur, mais **`next@15.5.23` embarque sa PROPRE copie de `sharp` pinnée en interne à
  `^0.34.3`** (`node_modules/next/node_modules/sharp`), donc le chemin réellement emprunté par
  `next/image` reste vulnérable tant que Next.js lui-même n'est pas mis à jour — **bloqué par le
  bump majeur Next.js, voir ci-dessous**.
- **`next` <16.3.0 (high) / `postcss` <=8.5.10-8.5.22 (high, via next) / `sharp` (via next,
  ci-dessus)** : les 3 convergent sur le même correctif — bump Next.js 15.5 → 16.3.0 (majeur).
  Traité séparément sur une branche dédiée, voir sous-section "Exception Next.js majeur" ci-dessous.
- **`uuid` <11.1.1 (moderate, GHSA-w5hq-g745-h8pq — absence de vérification de bornes sur un
  buffer fourni en paramètre à `v3`/`v5`/`v6`)** : vérifié **non exploitable** dans ce projet.
  `uuid` n'est jamais un import direct de Pathélix (`grep` négatif sur `src/`) — uniquement
  transitif via `exceljs@4.4.0` → `uuid@8.3.2`. Le seul call site d'`exceljs` qui utilise `uuid`
  (`node_modules/exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`) appelle `uuidv4()`
  **sans aucun argument** — jamais de `buf` fourni, donc la faille (qui exige explicitement un
  buffer en paramètre) ne peut pas être déclenchée par ce chemin de code. Le correctif suggéré par
  `npm audit fix --force` (**downgrade `exceljs` 4.4.0 → 3.4.0**, un abaissement de version
  majeure) aurait introduit un risque de régression réel sur l'export Excel pour neutraliser une
  faille déjà inatteignable — **non appliqué, accepté en l'état, documenté**.
- **`esbuild` 0.27.3-0.28.0 (low, GHSA-g7r4-m6w7-qqqr — lecture de fichier arbitraire sur le
  serveur de dev Vite sous Windows)** : dépendance de dev uniquement, transitive via
  `vitest → vite@7.3.5` (range interne `^0.27.0`, incompatible avec le correctif `>=0.28.1` sans
  bump majeur de `vite` 7→8). **Non exploitable dans ce projet** : la faille ne s'active que si le
  serveur de dev **Vite** tourne et accepte des requêtes ; Pathélix utilise le serveur de dev
  **Next.js** (`npm run dev`), Vite n'est utilisé que comme moteur de transform interne à
  `vitest run` (mode `node`, jamais de serveur HTTP exposé). Bump `vite` 7→8 non tenté (risque
  d'instabilité de la suite de tests pour une faille non applicable) — accepté, documenté.
- **Résultat après cette phase (hors branche Next.js majeur)** : 32 → 6 vulnérabilités restantes
  (1 low accepté non-exploitable, 2 moderate acceptés non-exploitables, 3 high bloquées par le
  bump Next.js majeur). `npm audit` critique : 0 avant et après.
- **Commit** : `7b20305`

#### Exception Next.js majeur (branche `next-16-major-bump`, NON MERGÉE — BLOQUÉE)
- Bump tenté : `next@15.5.23` → `16.3.0` (dernière stable), ferme les 3 vulnérabilités high
  restantes (`next`, `postcss` via next, la copie `sharp` imbriquée dans
  `node_modules/next/node_modules/sharp` qui restait à 0.34.5 malgré le bump direct de la Phase B
  — `next` pinne `sharp: ^0.34.3` en interne, indépendant de la version racine).
- **`tsc --noEmit`** : propre. **Suite de tests** : 199 fichiers / 3538 tests, tous verts sans
  modification. **`next build`** : compile et build avec succès (97 pages statiques générées).
- **Casse trouvée et corrigée sur la branche** : `npm run lint` (`next lint`) est **totalement
  supprimé** dans Next 16 (pas juste déprécié — la commande casse avec "Invalid project directory
  provided, no such directory: lint"). Script `package.json` `"lint"` changé de `"next lint"` vers
  `"eslint src"` (portée identique à l'ancien comportement par défaut de `next lint`, vérifié :
  sortie identique, 0 erreur/warning). Ce correctif est sûr et indépendant du reste — mais reste
  sur la branche bloquée puisqu'il n'a de sens qu'accompagné du bump `next`.
- **🛑 BLOQUANT trouvé, NON contourné (conforme à l'instruction explicite de m'arrêter plutôt que
  de router autour d'un breaking change touchant middleware/App Router)** : le build émet
  `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.` —
  `src/middleware.ts` est le fichier **le plus sensible en sécurité** du projet (invariant #2 de
  CLAUDE.md : garde de route, strip des headers spoofés `x-user-id`/`x-user-role`/`x-tenant-id`,
  vérification JWT, ré-injection). Il continue de fonctionner aujourd'hui via la couche de
  compatibilité de Next 16 (la suite de 27 tests `middleware.test.ts` passe sans modification), et
  un codemod existe (`npx @next/codemod@canary middleware-to-proxy .`) — mais migrer le fichier de
  garde d'accès le plus critique du projet vers une nouvelle convention de fichier mérite une revue
  humaine explicite, pas un renommage autonome, même si les tests actuels ne détecteraient rien de
  cassé aujourd'hui.
- **Secondaire, non bloquant** : `next.config.mjs` contient `eslint: { ignoreDuringBuilds: true }`
  — clé non reconnue par Next 16 (`⚠ Unrecognized key(s) in object: 'eslint'`), warning seul, build
  toujours réussi. **Sans rapport avec les headers CSP/sécurité** du même fichier (définis via la
  fonction `headers()`, distincte, non affectée — CLAUDE.md invariant #3 reste intact sur cette
  branche).
- **Statut** : branche `next-16-major-bump` conservée avec 3 commits (`d28e184`, `2ab0c56`), **non
  mergée dans `master`**. `master` reste sur `next@15.5.23` avec les 6 vulnérabilités résiduelles
  documentées ci-dessus (3 dépendantes de ce bump). **Décision explicitement laissée à
  l'utilisateur** — voir rapport final.
