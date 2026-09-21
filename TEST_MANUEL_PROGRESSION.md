# Progression test manuel exhaustif — Pathélix

Fichier temporaire, supprimé en fin de session. Coché élément par élément, pas de mémoire.
Format case : `- [ ] Élément — description` → `- [x] Élément — OK` ou `- [x] Élément — 🔴 BUG voir #N`

Base de test : `pathelix_fleet_manualtest` (isolée, réutilisée de la session précédente).
Base réelle démo/pilote (`pathelix_fleet`) : **jamais touchée** — vérifié par requête directe au
début de cette session (2 tenants, inchangé).

État hérité session précédente (réutilisé, pas recréé) : tenant 1 `[TEST-SESSION] Recyclage
Rhône SAS` (COLLECTE_RECYCLAGE, 100 chauffeurs, 30 véhicules, 140 missions, 1 client/2 sites,
1 exutoire), tenant 2 `[TEST-SESSION] BTP Location Alpes` (BTP_LOCATION, onboarding non terminé),
1 dispatcher restreint (`dispatcher.restreint@test-session.fr`, permissions optimize+manage_vehicles
révoquées).

## Bugs trouvés cette session

1. 🔴 **VRP toujours en fallback haversine pur pour toute flotte réaliste** — `MAX_CHUNK_SIZE=80`
   dans `valhallaMatrix.ts` produisait des chunks de 80×80=6400 paires, largement au-dessus de la
   limite Valhalla `max_matrix_locations=2500`. TOUT chunk échouait avec 400 dès que >80 points
   combinés (flotte réaliste). Trouvé en creusant "4 ECHOUES" dans Système > Télémétrie (au final
   sans rapport — jobs BullMQ historiques d'une session dev antérieure, non liés). Corrigé
   (MAX_CHUNK_SIZE=45), testé (12 tests incl. nouveau test de non-régression), re-vérifié en live
   (log worker confirme "chunks:16", zéro "chunk failed", "Traces routiers..." réel dans l'UI).
   Commit a013f6d.

2. 🔴 **Génération PDF cassée (`/api/tours/pdf`, probablement aussi `/api/reports/pdf`) —
   500 systématique sur tout chauffeur.** Trouvé en testant A3 Tournées > 🖨 Imprimer. Repro
   isolée (`tsx` hors serveur Next) fonctionne avec les mêmes données réelles → pas un bug de
   données. Root cause réelle (confirmée en live, logs ajoutés) : React error #31
   "Objects are not valid as a React child" — `@react-pdf/reconciler` est un package ESM pur
   ("type":"module"), Next l'externalise automatiquement côté serveur, donc il charge sa
   PROPRE instance de React, différente de celle bundlée par webpack pour le route handler.
   Les éléments React créés par l'une échouent `isValidElement` dans l'autre (dual package
   hazard). **Diagnostic initial (commit cf1455a, `serverExternalPackages` +=
   '@react-pdf/renderer') était FAUX** — re-vérifié en live après rebuild : erreur identique
   avant/après ce changement. Tenté aussi externaliser `react`/`react-dom` → casse le build
   entièrement (Next a besoin de son propre React pour `cache()` RSC). Tenté externaliser
   seulement les packages bas-niveau (fontkit, @react-pdf/pdfkit, etc.) → build OK mais
   erreur #31 identique. **NON CORRIGÉ** — nécessite une vraie refonte architecturale
   (déplacer le rendu PDF hors du process serveur Next, ex. worker dédié façon
   `vrpWorker.ts`, ou changer de version/lib PDF) — documenté comme limitation connue plutôt
   que forcé sous contrainte de temps, conformément à la consigne. Logging ajouté au passage
   (catch bare → `log.error` avec stack) dans les deux routes, ça reste utile indépendamment.
   Record corrigé commit 02bdb41. `next.config.mjs` contient désormais le vrai diagnostic en
   commentaire.

3. 🔴 **Onglet Missions ne montrait JAMAIS que les missions du jour même** — `DataProvider.tsx`
   ne charge dans le store que les missions datées d'aujourd'hui (correct pour la vue
   planning opérationnelle). L'onglet Missions (catalogue complet : import/export, archive,
   kanban, filtre dateFrom/dateTo) partage le même store — donc filtrait silencieusement un
   tableau qui ne pouvait jamais contenir autre chose que "aujourd'hui". Ouvrir l'onglet un
   jour sans mission affichait "Aucune mission" alors que 140 existaient réellement (juste à
   d'autres dates). Trouvé en testant A2 (0 missions affichées alors que SuperAdmin Dashboard
   ET badge sidebar affichaient 140). Corrigé : nouveau `src/lib/loadAllMissions.ts`, appelé
   au montage de l'onglet, pagine tout l'historique et fusionne dans le store (additif, ne
   perturbe pas le refresh périodique "aujourd'hui"). 5 tests unitaires. Re-vérifié en live :
   140/140 missions affichées après le fix (0/0 avant). Commit e39bccd.

   **Complément découvert en re-testant le filtre date range juste après (même bug racine,
   2e symptôme) :** le fix ci-dessus se faisait silencieusement annuler ~120s plus tard. Cause :
   le refresh périodique de `DataProvider.tsx` (`setInterval` 120s, pensé pour rafraîchir les
   statuts des missions du jour) appelait `setInitialData(drivers, missions)` avec `missions`
   scopé à aujourd'hui — un **remplacement complet** du store, effaçant l'historique complet
   chargé par le fix. Repéré en observant `0/78` sur un filtre dateFrom/dateTo pourtant valide
   après plusieurs minutes de tests successifs (confirmé faux-négatif de test d'abord —
   vérifié DOM réel, valeurs correctes — puis confirmé bug réel via les logs réseau montrant
   le refresh périodique s'être déclenché entre-temps). Corrigé : nouvelle action store
   `upsertMissions` (met à jour par id existant + ajoute les nouveaux, contrairement à
   `addMissionsBulk` qui ignore les id déjà connus) ; le refresh périodique l'utilise
   désormais au lieu d'un replace complet. 3 nouveaux tests. Re-vérifié en live : 140/140
   toujours présent après 130s (> le seuil du refresh périodique), confirmé stable.
   Commit à suivre.

**⚠️ Incident base de données pendant cette investigation** — en relançant
`prisma/seed-superadmin.ts` pour me reconnecter (session JWT expirée), un premier essai avec
`source .env.production.local` (fichier sans `export`) n'a PAS propagé `DATABASE_URL` au process
enfant `npx tsx` → celui-ci est retombé sur le `.env` par défaut = **la vraie base démo
`pathelix_fleet`**, créant un tenant "Platform Admin" + user superadmin parasites. Détecté
immédiatement (comparaison des deux bases), supprimés dans la foulée (`DELETE FROM "User"`,
`DELETE FROM "Tenant"` par id exact), ré-exécuté correctement avec `export` explicite contre
`pathelix_fleet_manualtest`. Vérifié : `pathelix_fleet` revenue à 2 tenants (Pathélix,
Excoffier Test), zéro ligne orpheline (AuditLog vérifié aussi). Aucune donnée réelle affectée
au final, mais c'est le genre d'erreur que la consigne "vérifier avant d'agir" doit prévenir —
noté ici en toute transparence.

**Garde-fou structurel mis en place suite à cet incident (sur demande explicite) :**
1. Base de test renommée `pathelix_fleet_manualtest` → `manualtest_sandbox_never_prod` (aucun
   substring commun avec `pathelix_fleet` — plus aucune troncature/faute de frappe ne peut
   matcher accidentellement le nom réel).
2. Nouveau `scripts/db-guard.sh` (commité) : wrapper qui refuse d'exécuter toute commande si
   `DATABASE_URL` n'est pas explicitement exportée OU si le nom de base résolu ne contient pas
   le marqueur `manualtest_sandbox` — echo explicite de la base utilisée avant exécution.
   Testé et vérifié bloquer : (a) `DATABASE_URL` non définie, (b) `DATABASE_URL` pointant
   explicitement vers `pathelix_fleet` (repro exacte de l'incident) — et laisser passer le cas
   correct. Documenté dans `OPERATIONS.md` §4. Commit 0c4a338.
3. Tous les scripts DB-écriture de cette session passeront désormais par ce guard.

4. 🔴 **Onglet Tournées ne montrait jamais les tournées des autres jours** — même famille de
   bug que #3, cette fois côté `ToursTab.tsx`. `storePlans` ne contient que les plans
   d'aujourd'hui (chargés une fois par `DataProvider`) ; naviguer vers un autre jour
   (Jour precedent/suivant) affichait "Aucune tournée planifiée pour ce jour" quel que soit
   le contenu réel en base, car rien ne rechargeait les plans pour la nouvelle date. Trouvé
   en testant A3 avec la date 2026-08-16 (32 plans réels en base) → 0/100 affiché. Corrigé :
   nouveau `src/lib/loadPlansForDate.ts`, appelé à chaque changement de date dans l'onglet,
   fusionne via l'action store existante `mergePlansFromDB` (déjà utilisée par DataProvider,
   aucune nouvelle logique store nécessaire). 5 tests unitaires. Re-vérifié en live :
   32/100 planifiés affichés (0/100 avant). Commit ea48707.

5. 🔴 **Undo/Redo (↩/↪) saute un niveau d'historique en arrière — NON CORRIGÉ, documenté.**
   Trouvé en testant A3 "📡 Live" : après une seule action (re-optimisation live appliquée,
   32→38/100 planifiés), le bouton "↩ Annuler" restait désactivé. Root cause identifiée dans
   `planningStore.ts` : `canUndo()` teste `_historyIdx > 0` alors que `_historyIdx === 0` est
   déjà un état valide à restaurer (le snapshot juste avant la 1ère action) — la 1ère action
   d'une session n'est donc JAMAIS annulable. Pire, `undo()` lit `_history[_historyIdx - 1]`
   (décrémente PUIS lit) au lieu de `_history[_historyIdx]` (lit PUIS décrémente) : sur 3
   actions A/B/C, un seul clic Annuler après C saute directement à l'état "avant A", pas
   "après A" (juste après B) — un niveau d'historique entier est perdu à chaque undo. Confirmé
   par le test existant `planningStore.test.ts:200` lui-même ("undo restores previous
   snapshot"), dont l'assertion `plan === undefined || plan.length === 0` est molle/hésitante
   — signe que ce comportement était déjà limite au moment où le test a été écrit. `redo()`
   utilise la même convention décalée donc reste cohérent AVEC le bug (masque le problème en
   usage normal undo→redo immédiat), mais un ↩↩↪ (deux annuler, un rétablir) ne revient pas
   à l'état "après B" — cet état intermédiaire n'existe nulle part car `_history` ne stocke
   que des snapshots PRÉ-action, jamais l'état final après la dernière action. Corriger
   proprement demanderait de revoir la structure du stack (stocker aussi l'état post-dernière-
   action, ou changer la convention d'indexation) et re-vérifier tous les cas limites
   (MAX_HISTORY=5, redo après nouvelle action tronquant le futur, etc.) — pas fait ici pour
   éviter d'introduire une régression sous contrainte de temps, conformément à la consigne du
   PDF (bug #2). Aucune perte de données réelle (les plans en base restent corrects), juste la
   fonctionnalité de confort Annuler/Rétablir qui saute un cran.

6. 🔴 **"📝 Notes de planification" (Dashboard/Tournées) n'est jamais partagé entre
   dispatchers — stocké en `localStorage` seul, jamais en base. NON CORRIGÉ, documenté.**
   `BottomPanel.tsx:51-61` : `notes` initialisé depuis `localStorage.getItem('pathelix_plan_notes')`,
   `updateNote()` écrit uniquement via `localStorage.setItem(...)` — aucun appel réseau, aucune
   table Prisma dédiée. Le placeholder du champ ("Jean absent, exutoire Bonneville fermé…")
   indique clairement une intention de communication D'ÉQUIPE, mais la note reste invisible
   pour tout autre dispatcher/navigateur — chacun a sa propre copie locale silencieuse, sans
   aucune indication à l'écran que ce n'est pas partagé. Vérifié : `localStorage.getItem(...)`
   contient bien le texte tapé, zéro requête réseau déclenchée (network log vérifié sur
   plusieurs secondes après frappe + blur). Pas un crash, un vrai gap fonctionnel sur une
   fonctionnalité de coordination d'équipe. Corriger proprement demanderait un nouveau modèle
   Prisma + route API (scope de fonctionnalité, pas de bug fix ponctuel) — documenté plutôt
   que forcé, même logique que bug #2/#5.

7. 🔴 **Onglet Statistiques — 3e occurrence du même bug racine que #3/#4.** `StatsTab.tsx`
   lit `storeMissions`/`storePlans` (uniquement peuplés pour aujourd'hui par `DataProvider`) ;
   son propre sélecteur de date ne déclenchait aucun fetch — changer de date affichait
   silencieusement 0 partout quelle que soit la réalité en base. Trouvé en testant A4 avec
   2026-08-16 (données réelles) → tout à 0. Corrigé : réutilise directement
   `loadAllMissionsIntoStore` (montage) et `loadPlansForDate` (changement de date) déjà créés
   pour les bugs #3/#4 — aucune nouvelle logique de fetch. Re-vérifié en live : 140 missions
   chargées, 40 non-assignées cohérent avec la base. Point notable en vérifiant : la carte
   "P1 Urgents" reste volontairement globale (toutes dates confondues, 15 au total en base)
   plutôt que scopée à la date sélectionnée — comportement intentionnel identique au widget
   "Prochains jours" (basé sur `today()`), confirmé correct par requête DB, pas un bug.
   Commit 8c2031d.

8. 🔴 **Chauffeurs — charge hebdomadaire (barre/% vs `weeklyHoursMax`, pertinent CE 561/2006)
   sous-estimée silencieusement.** 4e occurrence du même bug racine. `DriversTab.tsx` sommait
   `storePlans[driverId|jour]` pour chaque jour de la semaine courante — comme le store ne
   contient que les plans d'aujourd'hui, tous les autres jours contribuaient 0 minute,
   sous-estimant la charge réelle. Trouvé en auditant le même pattern après #3/#4/#7 (pas
   depuis l'UI directement — vérification proactive du code après la 3e occurrence). Risque
   plus sérieux que les précédents : un dispatcher pourrait sur-assigner un chauffeur en le
   croyant sous son plafond horaire hebdomadaire. Corrigé : fetch des plans des 7 jours de la
   semaine courante au montage via `loadPlansForDate` existant. Re-vérifié en live : 7 appels
   réseau `/api/plans?date=...` (17 au 23 août) confirmés au lieu d'1 seul.

9. 🔴 **Paramètres > Exporter JSON (sauvegarde) — fichier de "backup" silencieusement
   incomplet.** 5e occurrence. Lisait `missions`/`plans` directement du store (aujourd'hui
   seulement) sans jamais charger l'historique — un utilisateur cliquant "Exporter JSON"
   croit obtenir une sauvegarde complète, en obtient une partielle sans aucune indication.
   Trouvé en auditant le même pattern. Corrigé : nouveau `src/lib/exportBackup.ts`
   (`buildBackupExport`) qui charge tout l'historique des missions puis les plans de chaque
   date distincte ayant au moins une mission avant de lire l'état frais — limite documentée :
   aucune API "tous les plans" n'existe, donc une date avec un plan mais 0 mission survivante
   (cas rare) resterait non capturée. 4 tests unitaires.

Commit combiné #8+#9 : 2dbfb27.

10. 🔴 **Bannière "GOD MODE" persiste après connexion d'un utilisateur non-superadmin.**
    Trouvé en préparant l'audit permissions (section D) : après avoir été superadmin en
    impersonation, connecté ensuite en direct sous le dispatcher restreint (même onglet
    navigateur), la bannière rouge "GOD MODE : Vous agissez en tant que..." restait affichée
    alors que `/api/auth/me` confirmait une session dispatcher normale et correcte (pas un
    problème de sécurité — juste l'affichage client). Root cause : `ImpersonationBanner` vit
    dans le root layout (persiste sans remount lors des navigations client-side App Router),
    et son check ne s'exécutait qu'au montage initial. Corrigé : re-vérification à chaque
    changement de `pathname`, et reset explicite de l'état sur les branches non-impersonation
    (auparavant un simple `return` qui laissait l'état `true` périmé en place). 1 nouveau
    test de régression (8/8 passent). Commit 7215ed8.

11. 🔴 **Onglet Audit (A14) — 5 bugs distincts, tous corrigés.** Trouvé en testant A14 pour
    la première fois cette session (jamais ouvert avant). Tous dus à un dérapage entre
    `AuditTab.tsx` et `/api/audit/route.ts` :
    - Colonne Date : "Invalid Date" sur CHAQUE ligne (`e.date` lu, l'API ne renvoie que
      `e.createdAt`).
    - Colonne Utilisateur : vide sur CHAQUE ligne (AuditLog ne stocke que `userId`, jamais
      résolu en nom — corrigé : lookup batch avec gestion du préfixe `sa:` impersonation,
      fallback email puis id brut).
    - Colonne Details : toujours "-" (`e.details` lu, la donnée réelle est dans `e.changes`).
    - Filtre "Type entité" : renvoyait 0 résultat pour TOUTE option (dropdown en minuscules
      'user'/'driver', mais tous les appels `auditAsync()` du code utilisent la casse
      Prisma 'User'/'Driver' — corrigé + ajout du type 'tenant' manquant pour les actions
      superadmin). Même cause cassait aussi le filtre par plage de dates.
    - Pagination : plafonnée à la page 1 pour TOUT tenant, cachant tout au-delà des 25
      premières entrées (491 réelles ici) — `d.total` (inexistant) au lieu de
      `d.pagination.total`. En corrigeant ça, un 2e bug est apparu dessous : le paramètre
      page envoyé à l'API était l'état composant 0-indexé utilisé tel quel comme le
      1-indexé de l'API — "Suivant" rechargeait toujours la page 1.
    Re-vérifié en live intégralement : date réelle, nom réel, JSON réel, filtre "Utilisateur"
    → 6 lignes réelles (0 avant), "Suivant" avance réellement (Page 2/20, contenu différent
    confirmé). 7 nouveaux tests. Commit c00ecdb.

## Notes mineures (non bugs / non corrigées, faible priorité)

- SuperAdmin Dashboard : champ "Rechercher... Ctrl+K" ne filtre QUE l'onglet Tenants — no-op
  silencieux sur Dashboard/Métiers/ML/Historique/Système/Prix. Ctrl+K fonctionne (focus input),
  label pas trompeur en soi mais aucune indication que la recherche est scope-limitée.
- SuperAdmin Tenants : bouton "Cache" (purge Redis) ne montre aucun toast de confirmation
  (fonctionne, 200 confirmé réseau, juste silencieux visuellement).
- A5 Historique : le bouton "Sauvegarder la tournee actuelle" (et le nom par défaut proposé)
  dépend de `planDate` (état global partagé avec le Dashboard, prop `tourDate` transmise à
  `HistoryTab`) — PAS de la date que l'onglet Historique affiche lui-même (`browseDate`, état
  local propre à l'onglet). Un dispatcher qui vient d'optimiser une date dans Tournées, va
  dans Historique, navigue jusqu'à cette date pour la sauvegarder, ne verra le bouton
  apparaître que si le Dashboard (jamais visité, invisible) est resté sur la même date — sinon
  rien ne s'affiche, sans indication de pourquoi. Confirmé en manipulant les 3 dates
  indépendamment (Tournées a sa propre `tourDate` locale, Dashboard/Historique partagent
  `planDate`, Historique a en plus son propre `browseDate` de navigation — 3 notions de "date
  courante" coexistent). Fonctionnellement le flux marche une fois qu'on comprend le
  couplage (sauvegarde + expand + suppression testés de bout en bout, données correctes,
  18 chauffeurs). Pas corrigé — décision produit sur laquelle date faire autorité, pas un bug
  au sens strict.
- A3 Tournées : "✕ Vider" (vide TOUTES les tournées du jour, action destructive sur 38
  chauffeurs planifiés dans mon test) ne montre AUCUNE boîte de confirmation avant d'agir —
  synchronise correctement en base (vérifié : 38 lignes Plan conservées, missions vidées à
  []), donc fonctionnellement correct, mais l'absence de confirm est un vrai risque UX vu
  l'ampleur de l'action et le bug Undo/Redo (#5) qui ne permet pas de rattraper le coup
  fiablement après.

---

## PÉRIMÈTRE

### A. Interface Admin/Dispatcher — tenant 1 (COLLECTE_RECYCLAGE)
Nav réelle observée : DISPATCH(Dashboard,Missions,Tournées,Statistiques,Historique) ·
RESSOURCES(Catalogue,Chauffeurs,Camions,Exutoires,Recurrentes) ·
ADMINISTRATION(Utilisateurs,Audit,Telematique,Parametres) · PLANIFICATION(Planning semaine)

- [x] A1. Dashboard — Ctrl+K OK, Alertes OK("100 chauffeurs sans tournée" cohérent), Verifier
      le planning OK(panel validation avec checks P1/légal/GPS, contenu correct), Rafraichir
      OK, mode clair/sombre OK, Jour/Semaine/Mois OK(vraie grille mensuelle vérifiée),
      Rechercher (non testé isolément, meme pattern que Missions, faible risque), ⚡Filtres
      OK(panel type/priorité/tri/groupe), Sélection OK(toggle), +Mission OK(modal), ✨IA OK
      (modal + erreur gracieuse "Ollama non démarré" — Ollama non installé dans cet env de
      test, limitation environnement documentée, pas un bug), 📊Gantt OK(toggle sans erreur),
      📍Secteurs OK(groupement réel vérifié "AIX-LES-BAINS, 14 chauffeurs"), ▤Vue compacte
      OK, Copier OK(popover date + Copier/Annuler), PDF (clic sans erreur visible, 0 tournée
      à imprimer aujourd'hui donc no-op silencieux probable — non approfondi, même famille
      que bug#2 documenté), +Chauffeur OK(modal), Filtrer chauffeurs dropdown OK(100→10 sur
      "Disponibles", vérifié réel), driver row 🔓/🔒 OK(toggle), driver row ▼ OK(expand sans
      erreur). 🔴 bug#6 trouvé ici (Notes de planification jamais partagées, localStorage
      seul, non corrigé — voir section bugs)
- [x] A2. Missions — recherche OK, filtre type OK(5/140 RETIRER), filtre priorité OK(15/140 P1),
      filtre date range OK(vérifié stable >120s), reset filtres OK, tri (non testé — faible
      risque, colonnes triables standard), vue Kanban OK, ✏ Modifier OK(modal ouvre/ferme),
      ⎘ Dupliquer OK(POST envoyé, a échoué en 401 car session expirée pendant le test — pas
      un bug, juste ma session de test ; DB vérifiée propre, aucune écriture partielle),
      📁 Archiver + ↩ Restaurer OK(cycle complet vérifié, 140→139→140), Export CSV/Excel OK
      (menu correct, 140 lignes). ⬆ Import et actions groupées (bulk) non testés — faible
      risque, ⬆Import déjà vu fonctionnel session précédente. 🔴 bug#3 trouvé ici (0
      missions au chargement) + son complément (refresh périodique écrasait le fix) — voir
      section bugs
- [x] A3. Tournées — TTC/HT toggle OK, ⚙ params panel OK, expand ligne chauffeur OK(1/23
      échantillon), zoom carte/densité OK, filtres recherche/statut OK, export CSV OK, export
      Excel OK, navigation Jour precedent/suivant OK (🔴 bug#4 trouvé+corrigé ici — voir
      ci-dessus), "📡 Live" OK (ré-optimisation réelle testée, 32→38/100 planifiés, résultat
      appliqué au store), "✕ Vider" OK fonctionnellement (voir note UX ci-dessus, pas de
      confirm dialog). 🔴 bug#2 (PDF/Imprimer, non corrigé, documenté) et 🔴 bug#5 (Undo/Redo
      saute un niveau, non corrigé, documenté) trouvés ici. "📍 Secteurs" n'existe PAS sur cet
      onglet (correction : c'est un bouton du Dashboard, pas de Tournées — erreur de notation
      session précédente). Non testé (faible risque) : reste des 22 lignes chauffeur restantes
- [x] A4. Statistiques — recherche chauffeur OK, filtre secteur OK, date picker OK (🔴 bug#7
      trouvé+corrigé ici), cartes vérifiées cohérentes avec DB (missions/plans/P1 pool-wide
      volontaire)
- [x] A5. Historique — recherche OK, navigation date OK, cycle complet
      Sauvegarder→Expand→Supprimer OK (18 chauffeurs, données correctes vérifiées via API).
      Point notable (pas un bug) : couplage de dates entre 3 états indépendants — voir notes
      mineures
- [x] A6. Catalogue > Clients — Modifier OK(modal), Export/Import visibles, non testés en
      profondeur (faible risque, pattern standard vu ailleurs)
- [x] A7. Catalogue > Sites — Modifier OK(modal), 2 sites listés sans erreur
- [x] A8. Catalogue > Produits — vide (jamais créé, cohérent), +Nouveau produit OK(modal)
- [x] A9. Chauffeurs — Modifier OK(modal), charge hebdo OK (🔴 bug#8 trouvé+corrigé ici),
      structure lignes ✏/✕ confirmée. Filtres secteur/dépôt/recherche déjà vus session
      précédente fonctionnels — non re-testés un par un (faible risque, pattern standard)
- [x] A10. Camions — Modifier OK(modal), 🔧Entretien OK(modal), ⛽Carburant OK(modal)
- [x] A11. Exutoires — Modifier OK(modal)
- [x] A12. Recurrentes — vide (jamais créé, cohérent), +Nouveau template OK(modal), ⚡Générer
      visible non testé (nécessiterait un template existant — faible risque)
- [x] A13. Utilisateurs — 1 utilisateur listé (dispatcher restreint), cohérent avec DB (une
      instance de "0 UTILISATEURS" observée était un 401 de session expirée, pas un bug —
      revérifié propre après re-login). Modifier OK(modal, 11 permissions, optimize+
      manage_vehicles bien décochées comme attendu). Mot de passe réinitialisé pour permettre
      l'audit de permissions section D
- [x] A14. Audit — 🔴 bug#11 (5 sous-bugs) trouvé+corrigé ici. Re-testé propre après fix :
      date/utilisateur/details/filtre type/pagination tous fonctionnels
- [ ] A15. Telematique — jamais ouvert
- [ ] A16. Parametres > General — re-sweep (vu en lecture, rien modifié/enregistré)
- [ ] A17. Parametres > Integrations — jamais ouvert (Trackdéchets probablement ici)
- [ ] A18. Planning semaine — jamais ouvert

### B. Interface Chauffeur (`/driver/[id]`) — mobile simulé
- [ ] B1. Tournée du jour
- [ ] B2. Navigation turn-by-turn
- [ ] B3. Transitions statut (Démarrer/Arriver/Commencer/Terminer)
- [ ] B4. Photo de preuve (upload simulé)
- [ ] B5. Commentaires
- [ ] B6. Déclaration incident
- [ ] B7. Scan ticket de pesée
- [ ] B8. Saisie mission langage naturel
- [ ] B9. Mode offline (coupe réseau, vérifie file + resync)

### C. Console SuperAdmin
- [x] C1. Dashboard — search box(no-op hors Tenants, noté), Ctrl+K OK, "Tout voir"→Historique OK
- [x] C2. Tenants — expand row OK, +Ajouter utilisateur OK(créé admin.btp), Modifier OK,
      Cache OK(200), Suspendre/Activer OK(dialog+toggle), Export(client-side, accepté),
      bulk select/Suspendre tous/Activer tous/Changer plan OK — **attention: bulk select
      inclut Platform Admin, jamais bulk-suspendre sans déselectionner**
- [x] C3. Métiers — dropdown+Appliquer OK (BTP configuré en btp_location), table métiers intégrés lue
- [x] C4. ML / Calibration — read-only, pas d'éléments interactifs (table seule)
- [x] C5. Historique — filtre tenant OK, Tout ouvrir/fermer OK, Exporter CSV non cliqué(low-risk)
- [ ] C6. Système — Rafraichir testé, 🔴 bug#1 trouvé+corrigé, reste: rien d'autre à cliquer (vérifié: table read-only)
- [ ] C7. Prix & Forfaits — jamais ouvert

### D. Audit permissions dispatcher restreint (quantification précise) — TERMINÉ

**Méthode** : connecté directement en tant que `dispatcher.restreint@test-session.fr`
(mot de passe réinitialisé cette session), permissions actuelles : optimize=❌,
manage_drivers=✅, manage_exutoires=❌, manage_missions=✅, manage_vehicles=❌,
manage_users=❌, view_reports=✅, view_costs=❌, manage_settings=❌, api_access=❌,
manage_integrations=❌. Audité en lisant le code de gating (nav + composants) plutôt qu'en
cliquant les 100+ boutons un par un — plus fiable et exhaustif que du clic manuel.

**D1. Navigation — gating par RÔLE uniquement (`adminOnly` sur `NAV_ITEMS`,
`src/app/admin/page.tsx:535-553`), les 11 permissions granulaires n'ont AUCUN effet sur la
visibilité des onglets :**
- Visibles pour dispatcher (non `adminOnly`) : Dashboard, Missions, Tournées, Statistiques,
  Historique, Catalogue — confirmé en direct (6 onglets exacts).
- **Invisibles pour TOUT dispatcher, quelle que soit la permission accordée** (`adminOnly:
  true`) : Chauffeurs, Camions, Exutoires, Recurrentes, Utilisateurs, Audit, Telematique,
  Parametres, Planning semaine — confirmé en direct (les 9 exacts, aucun de plus/moins).

**D2. Correspondance permission → effet réel, quantifiée précisément :**
| Permission (case à cocher) | Onglet cible | Effet réel pour un dispatcher |
|---|---|---|
| `manage_drivers` ("Gérer les chauffeurs") | Chauffeurs | **Aucun** — onglet `adminOnly`, inaccessible même activé |
| `manage_vehicles` ("Gérer les véhicules") | Camions | **Aucun** — idem |
| `manage_exutoires` | Exutoires | **Aucun** — idem |
| `manage_users` | Utilisateurs | **Aucun** — idem |
| `manage_settings` | Parametres | **Aucun** — idem |
| `api_access` | Parametres (clés API) | **Aucun** — sous-page de Parametres, idem |
| `manage_integrations` | Parametres (intégrations) | **Aucun** — idem |
| `manage_missions` | Missions | Onglet accessible, mais **0 gating client** trouvé (`grep hasPerm` dans `MissionsTab.tsx` : aucun résultat) — boutons +Nouvelle/Modifier/Supprimer/Archiver toujours actifs même permission=false ; backend correctement protégé (`missions/route.ts:87` retourne 403), donc pas de faille de sécurité, juste UX : le dispatcher clique, obtient un échec silencieux au lieu d'un bouton grisé explicite |
| `view_reports` | Statistiques/Historique | Onglet accessible, pas de `hasPerm` trouvé — même limitation probable, non vérifié bouton par bouton (faible risque, lecture seule) |
| `view_costs` | Statistiques (affichage coûts) | Idem, non vérifié en détail |
| `optimize` | Tournées > bouton "Optimiser" | **Seul exemple correctement géré côté client** : `ToursTab.tsx:66` `hasPerm(permissions, 'optimize')`, bouton `disabled` + tooltip explicite "Permission... requise". Confirmé visuellement cette session (bouton grisé pour ce dispatcher) |

**Conclusion quantifiée** (remplace la note vague de la session précédente) : sur 11
permissions granulaires configurables par utilisateur, **1 seule** (`optimize`) a un vrai
gating d'interface (bouton désactivé + explication). **7** sont totalement inertes pour tout
rôle dispatcher car leur onglet cible est bloqué au niveau rôle indépendamment de la
permission (manage_drivers, manage_vehicles, manage_exutoires, manage_users, manage_settings,
api_access, manage_integrations). **3** (manage_missions, view_reports, view_costs) ciblent
des onglets accessibles mais n'ont aucun gating d'interface trouvé — protection backend
confirmée pour manage_missions (403 vérifié en code), UX trompeuse (bouton actif qui échoue)
mais pas de risque sécurité. Root cause UX : `grep hasPerm` dans tout `src/components/admin/`
ne retourne qu'UNE seule occurrence dans tout le code admin.
Pas corrigé (refonte UX/produit, pas un bug ponctuel) — documenté avec la précision demandée.

### E. 3e tenant fictif (secteur autre que COLLECTE_RECYCLAGE/BTP_LOCATION)
- [ ] E1. Création + onboarding (secteur à choisir : Déménagement / Maintenance & SAV / Coursier & Express)

### F. Trackdéchets
- [ ] F1. Configuration intégration sandbox
- [ ] F2. Flux BSDD complet (HALT actif, vérifier aucun appel prod)

### G. Prédictions ML
- [ ] G1. Localiser la fonctionnalité, tester affichage

### H. Pages publiques
- [ ] H1. `/`
- [ ] H2. `/login`
- [ ] H3. `/help`
- [ ] H4. `/status`
- [ ] H5. `/tracking`
- [ ] H6. `/api-docs`

### I. Performance (mesures réelles, en parallèle du parcours)
- [ ] I1. Temps chargement pages principales
- [ ] I2. Temps `/api/optimize` (déjà mesuré session précédente : ~15s pour 40 missions/100 chauffeurs)
- [ ] I3. Temps `/api/optimize/live`
- [ ] I4. Taille payloads listes principales / pagination

---

## Nettoyage final
- [ ] Purge test DB ou DROP, vérifié par requête SQL directe
- [ ] Confirmation finale : base réelle démo toujours à 2 tenants, inchangée
