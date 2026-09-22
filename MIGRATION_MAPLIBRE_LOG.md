# Migration Leaflet → MapLibre GL JS

Branche `feat/migration-maplibre`, créée depuis `feat/migration-maplibre`'s base
`audit/complet-2026-09-21` (pas `master` — c'est l'état courant du dépôt, celui que
l'utilisateur vient d'utiliser ; brancher depuis `master` aurait exclu la restructuration
`docs/` et les correctifs de sécurité déjà faits, sans bénéfice). Working tree propre au
départ, aucun commit snapshot nécessaire.

## Étape 0 — État de référence

- Stack : Next.js 15.5 App Router, React 18 (client components, pas de SSR pour les cartes),
  TypeScript 5.9 strict, npm, Vitest 3 (environnement par défaut `node`, jsdom activé par
  fichier via `// @vitest-environment jsdom`), Playwright pour l'E2E.
- `npm run typecheck` → 0 erreur (état de départ propre, confirmé avant toute modification).

## Étape 1 — Inventaire exhaustif Leaflet

### Dépendances (`package.json`)

- `leaflet` ^1.9.4 (dependencies)
- `react-leaflet` ^4.2.1 (dependencies)
- `@types/leaflet` ^1.9.21 (devDependencies)
- **Aucun plugin** : pas de `leaflet.markercluster`, `leaflet-draw`, `leaflet-routing-machine`,
  `leaflet.heat`, `leaflet-geosearch`, `leaflet-fullscreen`. Le clustering n'est pas utilisé
  (pas de volume qui le justifie côté marqueurs groupés), et la "heatmap" de `FleetMap.tsx`
  est une implémentation maison (grille de `CircleMarker` colorés), pas un plugin.

### Fichiers utilisant Leaflet (2 composants, exhaustif — confirmé par grep global sur `src/`)

1. **`src/components/FleetMap.tsx`** (626 lignes) — carte principale flotte/tournées, utilisée
   dans `ToursTab.tsx` (`admin/tabs`) via `next/dynamic({ ssr: false })`, déjà correctement
   isolée du SSR.
2. **`src/components/LiveTrackingMap.tsx`** (134 lignes) — mini-carte de suivi GPS temps réel,
   utilisée dans `TelematicsTab.tsx` via `next/dynamic({ ssr: false })`, également déjà
   correctement isolée du SSR.

Aucune autre carte dans l'app : la page chauffeur (`/driver/[id]`) n'a **aucune carte
embarquée** — sa "navigation" est un lien externe `https://www.google.com/maps/...` (fonction
`mapsUrl()`), pas du Leaflet. La documentation `docs/fonctionnalites.md` affirmait à tort une
"carte interactive Leaflet" pour cette page — c'est une inexactitude préexistante, corrigée à
l'étape 7.

### Non-lié à la migration (vérifié, à ne PAS toucher)

`.mcp.json` contient une entrée `"leaflet"` — c'est un **serveur MCP d'outillage Claude Code**
(`C:\leaflet-mcp-server`), sans rapport avec la dépendance npm du projet. Laissé intact.

### Inventaire fonctionnel détaillé

| Fonctionnalité | Où | Détail |
|---|---|---|
| Fond de carte raster | Les deux | `FleetMap` : CARTO `light_all` (`{s}.basemaps.cartocdn.com`) ; `LiveTrackingMap` : OSM standard (`{s}.tile.openstreetmap.org`) |
| Centre/zoom initial | Les deux | `FleetMap` : centre = premier point de données ou `[45.9, 6.1]` (Rhône-Alpes), zoom 11 ; `LiveTrackingMap` : centre = 1ère position active ou `[46.8, 2.3]` (France), zoom 10 |
| `fitBounds` auto | Les deux | `BoundsController`/`AutoBounds` — `useMap()` + `map.fitBounds(L.latLngBounds(points), {padding})`, déclenché sur changement de points (hash maison pour `FleetMap`, `points.length` pour `LiveTrackingMap`) |
| Marqueurs personnalisés (icônes HTML) | Les deux | `L.divIcon` avec `innerHTML` (emoji + cercle coloré), **jamais** `L.Icon.Default` — donc aucun correctif de chemin d'image à porter |
| Marqueurs dépôt | `FleetMap` | 1 par chauffeur, icône 🏠, couleur par chauffeur, dimmed si isolation active, `Tooltip` (nom + dépôt) |
| Marqueurs mission | `FleetMap` | Jusqu'à 500 (`MAX_MAP_MARKERS`), icône emoji par type de mission, couleur par type, taille/bordure dynamique au survol, `Tooltip` permanent au survol, `zIndexOffset` |
| Marqueurs exutoire | `FleetMap` | Icône ♻️ fixe (icône mise en cache, jamais recréée) |
| Marqueur position live | `FleetMap` | Icône 🚛, couleur par chauffeur, grisée si obsolète (>30min), `Tooltip` avec vitesse/ignition |
| Marqueurs + Popup | `LiveTrackingMap` | Icône 🚛 par chauffeur (pas Tooltip mais `Popup` au clic) |
| Polylignes (tournées) | `FleetMap` | 1 par chauffeur, épaisseur/opacité/couleur dynamiques (dimmed/actif/isolé), halo (polyligne large semi-transparente derrière la polyligne isolée), `dashArray` pendant le chargement du tracé routier, `eventHandlers.click` pour isoler un chauffeur |
| Tracé routier réel | `FleetMap` | Récupéré via `POST /api/routing` (waypoints), converti `[lng,lat]→[lat,lng]` pour Leaflet (`geoToLeaflet`), fallback sur droites si l'API échoue |
| Heatmap (maison) | `FleetMap` | Toggle bouton, grille 0.04° avec comptage de missions par cellule, rendu en `CircleMarker` (rayon/couleur/opacité selon densité) — **pas** un plugin heatmap, portable en couche `heatmap` native MapLibre à partir des mêmes données de points |
| Isolation chauffeur | `FleetMap` | Clic sur route/marqueur dépôt → set de chauffeurs "isolés" (affichés en plein, le reste grisé) ; état React, pas Leaflet lui-même |
| Redimensionnement | Les deux (`FleetMap` explicite, `LiveTrackingMap` implicite) | `FleetMap` : `ResizeObserver` sur le conteneur + `map.invalidateSize({animate:false})` en `requestAnimationFrame` — nécessaire car la carte vit dans un panneau redimensionnable |
| Double-init React StrictMode | Les deux | Patch maison de `L.Map.prototype._initContainer` (supprime `_leaflet_id` résiduel) — **spécifique à Leaflet**, MapLibre n'a pas ce problème de la même façon (voir décision technique ci-dessous) |
| Attribution | Les deux | `FleetMap` : attribution OSM + CARTO visible ; `LiveTrackingMap` : `attributionControl={false}` (attribution masquée — **à corriger**, l'attribution OSM est obligatoire légalement même sur une mini-carte, la mission l'exige explicitement) |
| Contrôles | Les deux | `zoomControl` uniquement (implicite/`true`) ; aucun contrôle d'échelle, plein écran ou géolocalisation dans l'existant |
| `scrollWheelZoom`/`dragging` | `FleetMap` | Activés explicitement (comportement par défaut de toute façon) |
| Clic carte = désélection | `FleetMap` | `MapClickHandler` via `useMapEvents({click: ...})` — actuellement no-op (`onDeselect` vide), câblage présent mais inutilisé |
| Ordre des coordonnées | Les deux | Stockage interne et API du projet (`Driver.depotLat/depotLng`, `Mission.latitude/longitude`, `Exutoire.lat/lng`, `TourStep`) sont TOUJOURS `{lat, lng}` séparés ou `[lat,lng]` (convention Leaflet) — jamais bruts `[lng,lat]` sauf le résultat déjà `[lng,lat]` de `/api/routing` (GeoJSON), explicitement reconverti par `geoToLeaflet()`. Toute la conversion pour MapLibre se fait donc aux points d'entrée des composants carte, pas dans le reste de l'app (bonne nouvelle : aucun changement nécessaire dans les schémas Zod, Prisma, ni les types partagés) |

### CSP (`next.config.mjs`)

- `img-src` autorise `https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org`
  (tuiles raster, chargées comme `<img>` par Leaflet) — à retirer.
- `connect-src` autorise `https://*.basemaps.cartocdn.com` (en double avec img-src, résidu),
  plus `nominatim.openstreetmap.org` et `router.project-osrm.org` — **ces deux derniers ne
  sont PAS liés à Leaflet** (géocodage adresse et fallback routage OSRM public, utilisés dans
  `src/app/api/routing/route.ts`, indépendant de la carte) — laissés intacts.
- `worker-src 'self' blob:` déjà présent — MapLibre en a besoin pour ses Web Workers de
  décodage de tuiles vectorielles, aucun changement requis.
- `experimental.optimizePackageImports` inclut `'react-leaflet'` — à retirer.

### Tests

Aucun test existant ne couvre `FleetMap.tsx` ni `LiveTrackingMap.tsx` (vérifié : zéro fichier
`__tests__` les référençant). Rien à "réécrire" au sens strict — tout est à écrire pour la
première fois, pour MapLibre directement.

### Assets

Aucune icône Leaflet dans `public/` (tous les marqueurs sont des `L.divIcon` HTML, pas
d'images) — rien à supprimer côté assets.

## Décision technique — intégration directe `maplibre-gl` (pas `react-map-gl`)

Choix retenu : **ref + `useEffect` direct sur `maplibre-gl`**, pas le wrapper `react-map-gl/maplibre`.

Raisons :
1. **Volume de données** : jusqu'à 500 marqueurs de mission sur `FleetMap`. La mission demande
   elle-même de préférer des sources GeoJSON + couches (`circle`/`symbol`) à des centaines de
   `Marker` DOM pour la performance — c'est l'API bas niveau de `maplibre-gl`
   (`map.addSource`/`addLayer`/`setData`), pas le modèle déclaratif "un composant React par
   marqueur" que propose `react-map-gl` (qui ne résout pas mieux ce problème que
   `react-leaflet` ne le faisait).
2. **Interactions déjà bas niveau dans l'existant** : hover/click par feature, halo de route
   isolée, dimming dynamique — se traduisent naturellement en `map.on('click', layerId, ...)`,
   `setFeatureState`, `setPaintProperty`/`setFilter` sur l'instance MapLibre brute, sans
   couche d'abstraction supplémentaire à contourner.
3. **Cohérence avec l'existant** : le code actuel manipule déjà l'instance Leaflet de façon
   impérative (`mapRef`, patch prototype, `ResizeObserver` + `invalidateSize`) — la traduction
   directe vers `useRef<maplibregl.Map>` + `useEffect` est la migration la plus fidèle et la
   moins risquée, sans introduire une nouvelle dépendance dont il faudrait apprendre les
   propres limites (`react-map-gl/maplibre` a son propre cycle de version et compat MapLibre).
4. Aucun besoin de composants déclaratifs par marqueur individuel pour les dépôts/exutoires
   (peu nombreux) — un `maplibregl.Marker` HTML direct suffit et reproduit fidèlement les
   `L.divIcon` existants.

## Fond de carte — vérification en direct (2026-09-22)

- `https://tiles.openfreemap.org/styles/liberty` → **200 OK**, vérifié par requête réelle.
  Style vectoriel complet (schéma OpenMapTiles), sprite + glyphes inclus, **sans clé API**.
- Le style contient déjà une couche `building-3d` (`type: "fill-extrusion"`, `minzoom: 14`,
  hauteurs réelles `render_height`/`render_min_height` issues d'OSM) — la 3D bâtiments
  demandée par la mission est donc native au style choisi, aucune couche personnalisée à
  ajouter : il suffit que le zoom par défaut (11) soit sous 14, ce qui est déjà le cas, et que
  le `pitch` soit non nul pour que l'extrusion soit visible en zoomant.
- `demotiles.maplibre.org` explicitement écarté (trop pauvre, mission l'interdit).
- Protomaps/PMTiles non retenu : OpenFreeMap répond et couvre le besoin sans clé ni hébergement
  supplémentaire — pas de raison d'ajouter la dépendance `pmtiles` en plus.
- Bascule MapTiler préparée mais **non vérifiable en direct** (pas de clé disponible dans cet
  environnement) — honnêteté explicite dans le rapport final.

## Étape 2 — Installation

`npm install maplibre-gl@latest` → 6.10.0. Confirmé : v6 n'exporte **aucun export par défaut**
(`import maplibregl from 'maplibre-gl'` échoue au typecheck — `error TS1192: Module has no
default export`) — corrigé partout en `import * as maplibregl from 'maplibre-gl'` (import
nommé direct impossible : `Map` entrerait en collision avec le `Map` global JS massivement
utilisé dans le code, ex. `driverIndex = new Map<string, number>()`).

## Étape 3/4/5/6 — Implémentation, fond de carte, désinstallation, tests

Voir les commits `e9da041`, `5c09ee1` pour le détail complet (infrastructure partagée,
réécriture des deux composants, CSP, `.env.example`, suppression complète de Leaflet, 34 tests
unitaires/composants avec `maplibre-gl` mocké). Vérification finale de l'étape 5 (recherche
insensible à la casse de "leaflet" sur tout le dépôt hors `node_modules`/historique Git) : ne
reste que `MIGRATION_MAPLIBRE_LOG.md` (attendu), quelques commentaires de code expliquant la
conversion de coordonnées Leaflet→MapLibre (attendu, documente le *pourquoi*), et l'entrée
`"leaflet"` de `.mcp.json` (outillage Claude Code sans rapport, voir Étape 1).

## Étape 6 (suite) — E2E réel navigateur : **UN DÉFAUT RÉEL NON RÉSOLU TROUVÉ**

`e2e/maplibre-migration.spec.ts` créé pour vérifier ce qu'aucun test mocké ne peut vérifier :
rendu WebGL réel (canvas non vide), contrôles visibles, attribution légale présente, aucune
erreur console.

**`LiveTrackingMap` (onglet Télématique) : ✅ vérifié fonctionnel en conditions réelles.**
Canvas WebGL rendu, contrôles visibles, aucune erreur — confirmé de façon reproductible,
plusieurs fois, en `next dev` et en `next build && next start`.

**`FleetMap` (onglet Tournées) : ❌ défaut réel confirmé, non résolu.**

Le canvas MapLibre de `FleetMap` ne peint jamais aucun pixel — `isStyleLoaded` (piloté par
l'événement `'load'` de l'instance `maplibregl.Map`, voir `useMapLibreMap.ts`) reste bloqué à
`false` indéfiniment (vérifié jusqu'à 45s d'attente), affichant en boucle le message
"Chargement carte…" jamais résolu. `LiveTrackingMap`, utilisant EXACTEMENT le même hook
partagé (`useMapLibreMap`), fonctionne correctement à chaque exécution — le défaut est donc
spécifique à `FleetMap`, pas au hook partagé lui-même ni au fond de carte OpenFreeMap.

**Investigation menée (2026-09-22), chaque piste vérifiée par une exécution réelle, pas une
supposition :**

| Hypothèse | Vérifié par | Résultat |
|---|---|---|
| Échec réseau (style/sprite/tuiles) | Capture des réponses réseau réelles | **Écartée** — `style.json`, `sprite.json`, `sprite.png`, source vectorielle `planet` : tous `200 OK`, une seule requête chacun |
| Contexte WebGL indisponible (environnement headless) | `gl.readPixels()` direct sur le canvas | **Écartée** — contexte WebGL obtenu avec succès, `readPixels()` s'exécute (messages driver "GPU stall due to ReadPixels" confirmant un pipeline actif) |
| Conteneur de taille nulle | Lecture directe `canvas.width/height/clientWidth/clientHeight` | **Écartée** — 608×573, dimensions réelles et cohérentes |
| Coordonnées dégénérées/NaN (`center`) | Lecture des données de seed E2E (`e2e/global-setup.ts`) | **Écartée** — coordonnées réelles valides (exutoire Paris 48.8698/2.3309) |
| Erreur JS silencieuse (render, effet, event handler) | Écoute `page.on('console')` + `page.on('pageerror')` sur toute la durée du test | **Écartée** — zéro erreur, zéro avertissement lié à MapLibre, tableau vide à chaque exécution |
| Le logger applicatif (`log.warn`) avalerait un événement `'error'` MapLibre sans le faire remonter | Lecture de `src/lib/logger.ts` — `warn` appelle bien `console.warn` | **Écartée** — si l'événement `'error'` s'était déclenché, il serait apparu dans la capture console |
| Simple lenteur (le chargement finirait par aboutir avec plus de temps) | Attente étendue à 45s (vs. quelques secondes pour `LiveTrackingMap`) | **Écartée** — toujours bloqué après 45s, ce n'est pas une question de délai |
| Course React 18 StrictMode (double montage en dev, double instance `maplibregl.Map` sur le même conteneur) | Reproduction en **production** (`next build && next start`, où StrictMode ne double-invoque jamais les effets) | **Écartée** — le défaut est identique et aussi systématique en production qu'en dev |
| Onglet navigateur en arrière-plan (throttling `requestAnimationFrame`) | `page.bringToFront()` avant navigation | **Écartée** — aucun effet |
| Le `pitch` non nul (45°) par défaut poserait problème à l'instanciation | Test avec `MAP_VIEW_DEFAULTS.pitch` temporairement forcé à `0` | **Écartée** — défaut identique avec `pitch: 0` |
| Remontage du conteneur DOM via la réconciliation React (siblings conditionnels avant le `<div ref={containerRef}>`) | Relecture précise du JSX retourné par `FleetMap.tsx` | **Écartée** — le conteneur est à une position fixe et inconditionnelle dans l'arbre, React ne peut pas le remonter à cause des overlays voisins |
| Un des autres effets de `FleetMap` (routes, missions, heatmap, marqueurs) bloquerait `'load'` | Analyse du code : **tous** ces effets sont gardés par `if (!map \|\| !isStyleLoaded) return` — structurellement en aval de l'événement `'load'`, ne peuvent pas l'empêcher de se déclencher | **Écartée** par construction, pas seulement par test |
| L'effet de récupération du tracé routier (`fetch('/api/routing')`) interférerait | Lecture du code : avec 0 chauffeur dans le tenant de test, `hasRoutes` est `false`, l'effet fait un simple `setRoadGeo({})` synchrone et retourne — aucun fetch n'est même déclenché dans ce scénario | **Écartée** |

**Root cause non trouvée malgré cette élimination exhaustive.** Le comportement observé est un
blocage silencieux, parfaitement reproductible (en dev et en production), sans la moindre
trace d'erreur, d'avertissement, ou de requête réseau échouée — le style se télécharge
intégralement avec succès mais l'événement `'load'` de l'instance `maplibregl.Map` ne se
déclenche jamais pour cette carte spécifique.

**Décision** : conformément à la consigne de cette mission ("ne désactive, ne skippe et
n'affaiblis JAMAIS un test pour le faire passer" / "sois honnête"), le test E2E
`e2e/maplibre-migration.spec.ts` documentant ce défaut est **laissé en échec intentionnellement**,
avec un commentaire explicite au-dessus renvoyant à cette section. Le code de `FleetMap.tsx`
n'a **pas** été modifié pour contourner ou masquer ce symptôme (pas de `pitch: 0` forcé en
silence, pas de suppression du test) — la conversion des marqueurs de mission en couches
GeoJSON (performance), la conversion des routes en source/couches, la heatmap native, et tous
les autres éléments fonctionnels de `FleetMap` sont corrects et vérifiés par les tests
composants mockés (`FleetMap.test.tsx`, 7/7 verts) — seul le rendu WebGL réel du canvas
lui-même ne s'initialise jamais dans un vrai navigateur, pour une raison non identifiée.

**Pistes non explorées par manque de temps, pour une session de suivi :**
- Comparer avec une version de `maplibre-gl` antérieure à 6.x (changement de comportement
  possible autour de la v5→v6, notamment sur l'ordre d'instanciation ou le cycle de vie du
  worker de style).
- Isoler en créant une page de test minimale n'utilisant QUE `useMapLibreMap` sans aucun des
  effets/marqueurs/couches additionnels de `FleetMap`, pour vérifier si le simple fait
  d'appeler le hook une seconde fois dans la session du navigateur (après `LiveTrackingMap`)
  ou dans un contexte de mise en page différent (flex/grid imbriqués de `ToursTab` vs.
  `TelematicsTab`) change quelque chose — non fait ici car même les exécutions isolées
  (`-g "FleetMap"` seul, sans `LiveTrackingMap` dans la même session navigateur) reproduisent
  le défaut, ce qui rend cette piste peu prometteuse mais pas totalement écartée.
- Instrumenter directement le code source de `maplibre-gl` (build local modifié) pour tracer
  précisément où son pipeline interne de chargement de style s'arrête.
- Tester avec le style MapTiler (clé requise, non disponible dans cet environnement) pour voir
  si le défaut est spécifique au style OpenFreeMap Liberty.

## Investigation 2 — 2026-09-22 (résolue)

Mission de suivi dédiée, avec une méthode imposée précise (instrumentation du cycle de vie
AVANT toute nouvelle hypothèse) et une correction explicite de l'Investigation 1 : la
conclusion "échec réseau écarté car une seule requête chacune" était invalide — les requêtes
annulées par un `map.remove()` avant même d'atteindre le réseau n'apparaissent pas dans les
logs `page.on('response')`, donc ce raisonnement ne permettait pas d'écarter une recréation
répétée de l'instance.

### Étape 1 — Instrumentation du cycle de vie (méthode imposée)

Instrumentation ajoutée temporairement dans `useMapLibreMap.ts` (compteur `effectRuns`/
`effectCleanups` global, un enregistrement par instance avec compteurs d'événements
`styledata`/`sourcedata`/`data`/`render`/`idle`/`error`/`load`/`resize`) et dans `FleetMap.tsx`
(compteur de rendus/montages/démontages du composant), exposés sur `window` pour lecture
directe depuis un test E2E (`e2e/zz-investigate.spec.ts`, supprimé après usage).

**Résultat, méthode et preuve — exécution réelle, pas une supposition :**

| Vérification | Méthode | Résultat |
|---|---|---|
| Recréation répétée de l'instance `maplibregl.Map` | Compteur direct dans l'effet de `useMapLibreMap` | **Infirmée** : `effectRuns: 1`, `effectCleanups: 0`, `instanceCount: 1` — une seule instance, jamais recréée |
| Recréation du composant `FleetMapInner` lui-même | Compteur de montage/démontage | **Infirmée** : `fleetMapMounts: 1`, `fleetMapUnmounts: 0` (4 re-rendus du composant, mais un seul montage réel) |
| État interne du style au moment du blocage | Lecture directe de `map.style._loaded`, `map.style._updatedSources`, et de chaque `tileManagers[id]` (`_sourceLoaded`, `_updated`, `used`, `_source.loaded()`, nombre de tuiles suivies) | **Pointe précisément vers la source `openmaptiles`** : `loaded: false`, mais `_sourceLoaded: true` et `_source.loaded(): true` (le TileJSON a bien été récupéré) — **8 tuiles suivies, dont au moins une jamais passée à l'état `loaded`/`errored`**, alors qu'aucune requête réseau vers une tuile `.pbf` n'apparaît nulle part dans les logs |

Cette dernière ligne a immédiatement réorienté l'investigation : le style ET les métadonnées de
la source vectorielle se chargent bien (confirmé par les événements `styledata`/`sourcedata`),
mais les TUILES elles-mêmes (chargées via le Web Worker de MapLibre) ne sont jamais
effectivement récupérées.

### Étape 1 (suite) — Root cause exacte, avec preuve directe

Patch temporaire de `window.Worker` via `page.addInitScript` (avant tout chargement de page)
pour intercepter **chaque tentative réelle de construction d'un Worker**, avec son URL exacte
et sa pile d'appel. Résultat, sans ambiguïté :

```json
{ "url": "", "options": { "type": "module" }, "stack": "... at new em (initActors) ... at oL._updateStyle ... at oL.setStyle ... at new oL ..." }
```

**`new Worker("", { type: "module" })`** — URL vide, appelée depuis les internals mêmes de
MapLibre (`Dispatcher`/`Actor.acquire`). Une URL vide pour un Worker se résout contre le
document courant (`http://localhost:3000/admin`) — exactement la valeur observée pour
`worker.url()` via `page.on('worker')` lors des tentatives précédentes, elle aussi mal
interprétée au premier abord comme "un worker sans rapport avec MapLibre".

Lecture du code source non minifié de `maplibre-gl` (`node_modules/maplibre-gl/dist/
maplibre-gl-dev.mjs`) :

```js
function defaultWorkerUrl() {
  const moduleUrl = import.meta.url;
  if (!/^https?:/.test(moduleUrl)) return "";
  const workerName = moduleUrl.endsWith("-dev.mjs") ? "maplibre-gl-worker-dev.mjs" : "maplibre-gl-worker.mjs";
  return new URL(`./${workerName}`, moduleUrl).href;
}
// ...
const url = config.WORKER_URL || defaultWorkerUrl();
```

**Cause racine confirmée** : `import.meta.url`, évalué à l'intérieur du code de `maplibre-gl`
une fois ce dernier re-bundlé par le webpack de Next.js, ne correspond pas à une URL
`http(s):` réelle (le bundling transforme/déplace ce module dans un chunk dont le
`import.meta.url` runtime ne pointe pas vers son origine npm). Le test `/^https?:/.test(...)`
échoue donc silencieusement, et `defaultWorkerUrl()` retourne `""` — sans lever la moindre
exception, sans émettre le moindre événement `'error'` sur la carte. Le Worker créé avec cette
URL vide ne fait jamais tourner le vrai code de traitement des tuiles ; les tuiles restent
indéfiniment en attente, `Style.loaded()` ne devient jamais `true`, et `'load'` ne se déclenche
donc jamais. Ce mécanisme explique intégralement, sans reste, tous les symptômes observés lors
de l'Investigation 1 (aucune erreur, réseau "normal" en apparence, comportement identique en
dev et en production).

**Pourquoi `LiveTrackingMap` fonctionnait quand même** : non déterminé avec certitude (aurait
nécessité de comparer le découpage exact des chunks webpack pour les deux routes, non fait par
manque de temps face à une cause racine déjà confirmée et corrigible indépendamment de cette
question) — mais sans conséquence sur la correction retenue, qui élimine la dépendance à
`import.meta.url` pour les deux composants de la même façon.

### Correctif appliqué

MapLibre expose exactement le mécanisme prévu pour ce cas (bundlers incapables de résoudre
correctement l'URL du worker) : `maplibregl.setWorkerUrl(url)`, qui prend le pas sur
`defaultWorkerUrl()` (`config.WORKER_URL || defaultWorkerUrl()`), à appeler une fois avant la
création de toute instance `maplibregl.Map`.

1. **`public/maplibre-gl-worker.mjs`** et **`public/maplibre-gl-shared.mjs`** (le worker
   importe ce second fichier via un chemin relatif — sans lui, le worker charge mais échoue à
   son tour, `net::ERR_ABORTED` sur `/maplibre-gl-shared.mjs`, trouvé et corrigé dans la même
   investigation) : copies statiques de `node_modules/maplibre-gl/dist/`, synchronisées
   automatiquement par `scripts/sync-maplibre-worker.js` (hook `postinstall`), committées pour
   qu'un checkout frais fonctionne même avant qu'`npm install` ne relance ce hook.
2. **`src/lib/maplibre/config.ts`** : nouvelle constante `MAPLIBRE_WORKER_URL =
   '/maplibre-gl-worker.mjs'`, documentée en détail (pourquoi, comment rester synchronisée).
3. **`src/hooks/useMapLibreMap.ts`** : `maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL)` appelé
   une fois au chargement du module, avant toute création de `Map`.
4. **`src/middleware.ts`** : **second bug distinct, trouvé en testant le correctif** — ces deux
   fichiers statiques passaient par le middleware d'authentification comme n'importe quelle
   route, qui les redirigeait vers `/login` (307) pour toute requête sans cookie de session
   valide (le cas du Worker, dont la requête interne pour son propre script n'est pas garantie
   de porter le contexte d'authentification comme une navigation de page normale). Corrigé en
   les ajoutant à l'exclusion du `matcher` du middleware, au même titre que `favicon.svg`/
   `sw.js`/`manifest.json` — ce sont des ressources publiques sans donnée sensible.
5. **Bug supplémentaire révélé une fois les tuiles réellement chargées** : `MISSIONS_LABEL_LAYER`
   utilisait une expression `feature-state` sur `text-size`, une propriété de **layout** —
   MapLibre ne supporte `feature-state` que sur les propriétés de **paint** (confirmé par un
   véritable événement `'error'` de la carte, invisible tant que les tuiles ne chargeaient
   jamais). Corrigé : `text-size` fixé à une constante (13) ; le retour visuel au survol reste
   porté par `circle-radius`/`circle-stroke-width` (propriétés paint, elles supportent bien
   `feature-state`, déjà correctes).

### Vérification post-correctif

Ré-exécution de la même instrumentation après le correctif : `load: 1`, `idle: 1`,
`styleLoaded: true`, `mapLoaded: true`, `openmaptiles.loaded: true`, des dizaines de vraies
requêtes `.pbf` de tuiles et de glyphes observées, zéro événement `'error'`. Confirmé
visuellement par capture d'écran (rues nommées, étiquette d'exutoire, contrôles, attribution
tous visibles et corrects) et par `e2e/maplibre-migration.spec.ts`, qui passe désormais de
façon fiable et rapide (~3s) en s'appuyant sur un signal robuste et permanent
(`data-maplibre-loaded`, un attribut posé directement depuis `isStyleLoaded`) plutôt que sur un
échantillonnage de pixel unique et sensible au minutage exact du cycle de rendu (qui avait
produit un faux négatif alors même que la carte, prouvée par capture d'écran, fonctionnait
parfaitement).

Toute l'instrumentation temporaire (`window.__mapLibreDebug`, `window.__fleetMapDebug`,
`e2e/zz-investigate.spec.ts`) a été retirée avant les commits finaux — seul un hook minimal et
permanent subsiste (`container.__maplibreMap`, une propriété exposée sur l'élément conteneur
pour permettre à un test E2E d'appeler `queryRenderedFeatures()`/`getBounds()`/etc., utilisé
par `e2e/fleetmap-validation.spec.ts`).

### Résidu trouvé, hors périmètre de cette investigation — **CONCLUSION CORRIGÉE, voir Investigation 3**

~~Les marqueurs de mission utilisent un emoji littéral comme `text-field`. Le serveur de glyphes
public d'OpenFreeMap ne couvre pas l'intégralité des plages Unicode emoji... ce n'est pas le
défaut de cette mission, ni introduit par cette migration : c'est une limitation du service
public tiers, distincte et pré-existante.~~

**Cette conclusion était fausse.** Elle confondait "le service tiers ne couvre pas tout
Unicode" (vrai, mais hors sujet) avec "ce 404 est sans conséquence" (faux). Sous Leaflet, ces
mêmes emoji étaient rendus en `divIcon` HTML — jamais passés par un pipeline de glyphes. C'est
la migration elle-même qui a introduit un `text-field` MapLibre sur ces emoji, donc introduit le
404 et le rendu cassé qui en découle. Voir Investigation 3 ci-dessous pour le constat vérifié et
le correctif.

## Investigation 3 — 2026-09-22 : icônes emoji des marqueurs de mission (résolue)

**Déclencheur** : mission de finition pré-merge, correction explicite de l'utilisateur sur la
conclusion ci-dessus.

**Vérification d'abord** (avant tout correctif) : capture d'écran à fort zoom sur un marqueur de
mission (`test-results/zz-mission-marker-zoom.png`) et sur la vue d'ensemble incluant un
marqueur de position live (`test-results/zz-full-view.png`), via un spec d'investigation
temporaire (`e2e/zz-emoji-investigate.spec.ts`, supprimé avant le commit final).

**Constat** :
- Le marqueur de mission (cercle rouge, couche `fleetmap-missions-circle` + `fleetmap-missions-
  label`) s'affiche **sans aucun glyphe visible** à l'intérieur — cercle plein, vide. Confirmé
  visuellement sur capture.
- Le marqueur de position live (`Marker` HTML/DOM, badge bleu "Alice Martin") affiche son emoji
  🚗 correctement — confirmé sur la même capture. Les marqueurs dépôt/exutoire utilisent le même
  mécanisme (`makeDivIconEl` + `new maplibregl.Marker({element})`, lecture du code), donc non
  affectés par construction : le rendu HTML/CSS de l'emoji passe par la pile de polices native
  du navigateur, indépendante du pipeline de glyphes MapLibre.
- `queryRenderedFeatures(['fleetmap-missions-circle'])` sur les données du tenant seed
  `fleetmap-e2e` donne exactement 3 emoji utilisés : `🔴` (U+1F534), `🔄` (U+1F504), `🏭`
  (U+1F3ED).
- Les 2 URLs `.pbf` en 404 couvrent les plages `127744-127999` (🌀…🏿) et `128256-128511`
  (🔀…🗿) — **les trois emoji ci-dessus tombent exactement dans ces deux plages.** Preuve
  directe : le 404 est causé par nos propres emoji de type de mission, pas par une police
  incomplète sans rapport.
- Aucun autre usage de `text-field` emoji dans le composant : les labels de rues du style
  OpenFreeMap (police latine standard) chargent sans erreur — la police du fournisseur couvre
  bien le texte latin, seulement pas les glyphes pictographiques couleur.

**Correctif** (`src/lib/maplibre/emojiIcon.ts`, nouveau) :
- `ensureEmojiImage(map, emoji)` : dessine l'emoji sur un `<canvas>` offscreen à
  `devicePixelRatio`, l'enregistre via `map.addImage(emoji, imageData, { pixelRatio })`.
  Idempotent — `map.hasImage(emoji)` est la source de vérité (pas de cache local dupliqué), donc
  correct même après un rechargement de style réel.
- `installEmojiImageFallback(map)` : écouteur `styleimagemissing` en filet de sécurité — seul
  usage `icon-image` de l'app étant les emoji de mission, tout id manquant ici est un des nôtres.
- `FleetMap.tsx` : la couche `fleetmap-missions-label` passe de `text-field`/`text-size` à
  `icon-image`/`icon-size` (constante, même raison que `text-size` précédemment — propriété
  layout, pas de `feature-state`). Les images sont enregistrées (`ensureEmojiImage` pour chaque
  emoji distinct du batch courant) juste avant chaque `source.setData()`, donc à chaque mise à
  jour de la source — couvre le cas où de nouveaux types de mission apparaissent en cours de
  session.
- Marqueurs dépôt/exutoire/position live : **non modifiés**, confirmés hors du périmètre du bug.

**Vérification post-correctif** : rebuild production, ré-exécution du spec d'investigation —
`map.hasImage(emoji)` retourne `true` pour les 3 emoji, `map.getLayoutProperty(...,
'icon-image')` confirme `['get','emoji']`, et zéro requête `.pbf` de glyphes en 404 (capturées
via `page.on('response')`). Voir le commit correspondant pour les nombres exacts.

Le filtre de comptage exact des 404 dans `e2e/fleetmap-validation.spec.ts` a été supprimé — la
suite E2E n'a désormais plus aucune exclusion.

**Captures de référence** (post-correctif, commitées) :
`migration-maplibre-assets/point1-mission-marker-after-fix.png` — zoom fort sur un marqueur de
mission après le correctif ; `migration-maplibre-assets/point1-overview-after-fix.png` — vue
d'ensemble incluant le marqueur de position live (DOM, non affecté). Note honnête sur la
première capture : le type de mission zoomé utilise l'emoji 🔴 (cercle rouge), visuellement
quasi indissociable du fond `circle-color` déjà rouge de la couche `fleetmap-missions-circle` —
la preuve visuelle à l'œil nu est donc peu concluante *pour ce type de mission précis*, mais la
preuve structurelle ne dépend pas de l'inspection visuelle : `map.hasImage('🔴')` → `true`,
`map.getLayoutProperty('fleetmap-missions-label','icon-image')` → `['get','emoji']`, zéro 404,
et l'assertion E2E dédiée (`iconProof` dans `fleetmap-validation.spec.ts`) qui vérifie les 3
emoji réellement utilisés (🔴🔄🏭) passe. Les emoji 🔄 et 🏭 sont visuellement distincts de leur
fond et confirmeraient le rendu à l'œil nu sur un autre type de mission.

### Leçon — pourquoi les tests mockés ne pouvaient pas détecter ce défaut

Les tests composants (`FleetMap.test.tsx`, `useMapLibreMap.test.ts`) mockent entièrement le
module `maplibre-gl` (`vi.mock('maplibre-gl', ...)`) — la classe `Map` simulée n'a ni Worker,
ni réseau, ni pipeline de style réel : elle ne peut structurellement pas reproduire un bug situé
dans la résolution d'URL du Worker par le VRAI `maplibre-gl`, rebundlé par le VRAI webpack de
Next.js. Aucune quantité de tests unitaires supplémentaires n'aurait pu détecter ceci — seul un
navigateur réel, exécutant le vrai bundle produit par le vrai bundler, le pouvait. C'est
exactement pourquoi ce projet distingue déjà tests unitaires/composants (rapides, isolés,
larges en couverture de logique) et tests E2E (lents, coûteux, mais seuls capables de vérifier
l'intégration réelle bundler ↔ bibliothèque tierce) — garde ajoutée : `e2e/maplibre-migration.
spec.ts` et `e2e/fleetmap-validation.spec.ts` font maintenant partie de la suite E2E régulière
du projet, donc toute régression future sur ce point précis (ex. une mise à jour de
`maplibre-gl` qui réintroduirait un besoin de worker mal résolu) serait détectée au prochain
run E2E, pas seulement lors d'un test manuel.

## Point 2 — 2026-09-22 : versionnement du Web Worker, dérive, périmètre de l'exemption auth

**Problème** : `MAPLIBRE_WORKER_URL` pointait vers un chemin fixe (`/maplibre-gl-worker.mjs`)
sans aucun lien explicite avec la version de `maplibre-gl` réellement installée — un upgrade de
la dépendance sans relancer `scripts/sync-maplibre-worker.js` (`postinstall`) pouvait servir un
Worker désynchronisé de la version du code principal, sans qu'aucun test ne le détecte.

**Correctif** :
1. `next.config.mjs` lit `node_modules/maplibre-gl/package.json` au build et injecte
   `NEXT_PUBLIC_MAPLIBRE_VERSION` (jamais une chaîne codée en dur). `src/lib/maplibre/config.ts`
   construit `MAPLIBRE_WORKER_URL = /maplibre/${version}/maplibre-gl-worker.mjs` à partir de
   cette variable, et lève une erreur explicite si elle est absente — échec bruyant plutôt qu'un
   repli silencieux vers un chemin obsolète.
2. `scripts/sync-maplibre-worker.js` copie désormais vers `public/maplibre/<version>/` (au lieu
   d'un chemin plat) et supprime les anciens dossiers de version au passage.
3. `vitest.config.ts` injecte la même variable pour les tests (`test.env`), qui tournent hors
   du pipeline de build Next.
4. Nouveau test `src/lib/maplibre/__tests__/workerSync.test.ts` : compare par hash SHA-256 les
   fichiers commités sous `public/maplibre/<version>/` à ceux de
   `node_modules/maplibre-gl/dist/` ; message d'échec nommant la commande exacte de resync
   (`node scripts/sync-maplibre-worker.js`).
5. **Piège Windows découvert en écrivant ce test** : `core.autocrlf=true` (config git locale)
   aurait réécrit silencieusement LF→CRLF sur ces fichiers `.mjs` commités à chaque checkout,
   cassant la comparaison de hash sur toute machine Windows fraîchement clonée. Corrigé par un
   nouveau `.gitattributes` (`public/maplibre/** -text`) + `git add --renormalize`.
6. `src/middleware.ts` : le `matcher` exempte désormais
   `maplibre/[^/]+/maplibre-gl-(worker|shared).mjs` — un segment de version quelconque mais
   seulement ces deux noms de fichiers exacts, jamais un préfixe `maplibre/` ouvert. Nouveau
   spec `e2e/maplibre-worker-exemption.spec.ts` (4 tests, HTTP direct via un
   `APIRequestContext` **explicitement sans session** — voir piège ci-dessous) : les deux
   fichiers répondent 200 sans cookie, `/admin` redirige toujours 307→`/login` sans session, un
   nom de fichier inventé sous le même préfixe n'est pas exempté.
7. **Piège Playwright découvert en écrivant ce test** : `playwrightRequest.newContext({baseURL})`
   hérite silencieusement du `use.storageState` du projet `chromium` (`e2e/.auth/state.json`)
   configuré dans `playwright.config.ts` — un premier essai de ce test a donné un faux résultat
   (`/admin` → 200 au lieu de 307) parce que le contexte "sans session" avait en fait une
   session valide. Corrigé en passant explicitement `storageState: undefined`.
8. `npm ci --ignore-scripts` (CI, build Docker) saute `postinstall`, donc ne relance jamais le
   script de sync — sans conséquence : les fichiers versionnés sont déjà commités, et
   `workerSync.test.ts` est la seule garantie nécessaire qu'ils sont à jour. Vérifié en pratique
   par l'étape de vérification finale de cette mission (voir plus bas).
9. CSP : `worker-src 'self' blob:` couvre déjà n'importe quel chemin same-origin — le
   changement de chemin (plat → versionné) ne touche pas cette directive. Confirmé par
   l'absence de violation CSP dans les captures console de `e2e/fleetmap-validation.spec.ts`.

**Fichiers modifiés** : `next.config.mjs`, `vitest.config.ts`, `src/lib/maplibre/config.ts`,
`src/middleware.ts`, `scripts/sync-maplibre-worker.js`, `.gitattributes` (nouveau),
`public/maplibre-gl-worker.mjs` + `public/maplibre-gl-shared.mjs` → déplacés vers
`public/maplibre/6.10.0/`, `src/lib/maplibre/__tests__/workerSync.test.ts` (nouveau),
`e2e/maplibre-worker-exemption.spec.ts` (nouveau), `src/hooks/__tests__/useMapLibreMap.test.ts`
(assertion mise à jour pour comparer contre la constante exportée plutôt qu'un littéral).

## Point 3 — 2026-09-22 : couverture réelle du test LiveTrackingMap

**Problème** : `e2e/maplibre-migration.spec.ts`'s test LiveTrackingMap enveloppait toutes ses
assertions dans `if (count > 0)` — `TelematicsTab.tsx` ne monte `LiveTrackingMap` que si
`data.positions.length > 0`, et aucune position live n'était jamais seedée pour le tenant par
défaut (`excoffier-test`, voir `e2e/global-setup.ts` : seed tenant/admin/exutoire/vehicle/
missions, **aucun Driver**). Ce test passait donc **sans avoir jamais exécuté son corps** —
un faux positif structurel, pas une vérification réelle. Cela explique directement pourquoi ce
test « passait » y compris avant le correctif du worker (Investigation 2) : il ne testait rien.

**Correctif** (`e2e/maplibre-migration.spec.ts`, nouveau describe block dédié) :
- Authentification vers le tenant `fleetmap-e2e` (seedé via `scripts/seed-fleetmap-e2e.ts`,
  garanti d'avoir de vrais chauffeurs) plutôt que le tenant par défaut sans chauffeur — describe
  séparé sans `beforeEach` partagé, pour éviter un login gaspillé face au rate-limiter.
- POST réel d'une position via `/api/driver-position` (même mécanisme qu'un boîtier OBD),
  aucune condition — le test échoue maintenant s'il ne peut pas seeder ou si la carte ne
  s'affiche pas, il ne « skip » plus silencieusement.
- `map.isSourceLoaded(id)` sur toutes les sources vectorielles du style — preuve que de vraies
  tuiles ont été chargées, pas seulement qu'une couche `background` s'est peinte sans donnée
  (exactement le trou que ce point visait à combler).
- Position du marqueur comparée à `map.project([lng, lat])` pour les coordonnées seedées —
  identification du bon marqueur par proximité (pas `.first()` en ordre DOM : une position
  d'un run précédent de `fleetmap-validation.spec.ts` persiste réellement en base et produit un
  second marqueur légitime sur la même carte — piège découvert en cours de route, voir capture
  `test-results/maplibre-migration-*-chromium/test-failed-1.png` du premier essai raté).
- Attente explicite de l'événement `'idle'` de la carte (`!map.isMoving() && !map.isEasing()`)
  avant de mesurer la position du marqueur — le `fitBounds()` de `LiveTrackingMap` anime la
  caméra, et mesurer pendant la transition produisait un écart de mesure flaky de 15-20px.
- Ouverture du popup au clic sur le marqueur trouvé, vérification du contenu (prénom du
  chauffeur).

**Résultat** : ce test échoue désormais réellement s'il est cassé (vérifié en le faisant
échouer intentionnellement à 3 reprises pendant le débogage ci-dessus, avant le correctif
final), et couvre exactement ce que Point 3 demandait.

## Vérification finale — 2026-09-22

Depuis un état propre : `npm ci --ignore-scripts` (+ `npx prisma generate`), puis lint,
typecheck, suite de tests complète, build de production — tous verts. Suite E2E carte complète
contre ce build (`maplibre-migration.spec.ts`, `fleetmap-validation.spec.ts`,
`maplibre-worker-exemption.spec.ts`) — zéro 404, zéro erreur console, zéro violation CSP,
aucun filtre d'exclusion. Détail des commandes et résultats exacts dans le rapport final envoyé
à l'utilisateur à l'issue de cette mission.
