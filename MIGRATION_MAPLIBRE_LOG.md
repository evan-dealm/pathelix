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

## Journal des étapes suivantes

(complété au fur et à mesure)
