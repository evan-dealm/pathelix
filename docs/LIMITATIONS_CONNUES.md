# Limitations connues — Pathélix

> Limites acceptées consciemment pour le pilote actuel (100 chauffeurs, région Rhône-Alpes,
> secteur recyclage/BTP). À retraiter explicitement avant d'étendre le périmètre décrit ci-dessous.
> Voir `AUDIT_BUGS.md` pour le détail technique complet de chaque item (N13, N14).

## N13 — Centres urbains codés en dur (bonus trafic directionnel)

**Fichier** : `src/lib/algorithm.ts:75-81` (`DEFAULT_URBAN_CENTERS`)

5 villes de la région Rhône-Alpes (Grenoble, Lyon, Chambéry, Annecy, Genève-frontière) sont codées
en dur pour le calcul du bonus de trafic directionnel du moteur VRP. Un override existe via la
variable d'environnement `URBAN_CENTERS_JSON`, mais c'est une seule liste globale — pas de
configuration par tenant.

**À retraiter avant** : d'onboarder un tenant opérant hors région Rhône-Alpes/Genève. Sans
retraitement, le bonus de trafic directionnel sera soit inactif (pas de centre urbain pertinent
dans son rayon d'opération), soit appliqué à des coordonnées sans rapport avec son terrain réel.

## N14 — `isHfvrpCompatible` ne contrôle que le volume, jamais hazmat/gabarit

**Fichier** : `src/lib/vrp/hfvrp.ts:3-11`

`isHfvrpCompatible()`/`areAllHfvrpCompatible()` comparent uniquement `mission.binSizeM3` contre
`driver.maxBinSizeM3`. Aucune contrainte dure sur le transport de matières dangereuses (hazmat) ou
sur le gabarit du véhicule (hauteur/largeur/longueur/essieux — ces champs existent sur `Driver`
mais ne sont utilisés nulle part comme contrainte de compatibilité mission/véhicule dans le VRP).

**À retraiter avant** : d'onboarder un tenant du secteur BTP ou matières dangereuses en usage réel
intensif où le mauvais appariement mission/véhicule aurait un impact réglementaire ou sécurité (pas
seulement une inefficacité de tournée). Actuellement pas un bug — `Mission` n'a pas de champ
hazmat/gabarit requis exposé, donc rien à violer dans le pilote actuel — mais deviendrait un vrai
gap de sécurité opérationnelle si ces champs sont un jour utilisés sans corriger cette fonction en
parallèle.
