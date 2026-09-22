# Pathélix — Tests

> Organisation, exécution, couverture. Vérifié contre une exécution réelle le 2026-09-22.

## 1. Commandes

```bash
npm run test           # Vitest — run unique
npm run test:watch     # Mode watch
npm run test:coverage  # Avec couverture
npx playwright test    # E2E (serveur :3000 requis)
```

## 2. État actuel (2026-09-22, après la mission "mise en qualité production")

- **215 fichiers**, **3867 tests unitaires** (Vitest), 100% verts
- **34 specs E2E** (Playwright, `e2e/*.spec.ts`) — voir §4 pour le détail d'exécution
- Typecheck (`tsc --noEmit`) : 0 erreur
- Lint (`next lint`) : 0 warning/erreur

Historique récent des chiffres, pour contexte (ne pas s'y fier pour l'état courant — toujours
relancer `npx vitest run` et compter le nombre de specs `e2e/*.spec.ts` directement) :
199 fichiers/3523 tests (avant 2026-09-21) → 205/3582 (audit du 2026-09-21) → 211/3619
(migration MapLibre, même journée) → 215/3867 (mission qualité production, 2026-09-22).

## 3. Règles impératives

- Ne jamais skipper, désactiver ou commenter un test pour avancer
- Ne jamais baisser un seuil de couverture
- `src/lib/vrp/` jamais modifié sans validation complète de sa suite de tests existante
- Un test qui échoue révèle soit un bug (corriger le code), soit un test qui pinait un
  comportement incorrect (corriger le test, avec justification inline) — jamais de
  désactivation pour "faire passer" la suite. Exemple réel traité cette session : deux tests
  de `planningStore.test.ts` asseraient directement le comportement buggé d'undo/redo (un
  Annuler qui saute un niveau d'historique) — corrigés avec commentaire expliquant le bug
  qu'ils pinaient, voir [audit-2026-09-21.md](audit-2026-09-21.md).

## 4. E2E — root causes réelles des échecs historiques (résolu, 2026-08-15)

Les échecs `navigateToTab()` observés sur plusieurs sessions et longtemps attribués à de la
"pression mémoire" avaient en réalité deux causes de code distinctes, aucune liée à la
mémoire :

1. `src/providers/DataProvider.tsx` calculait la date du jour avec les composants **locaux**
   de `Date`, alors que le reste de l'app utilise **UTC**. Près de minuit local, les deux
   dates divergeaient d'un jour — corrigé (`DataProvider` passé en UTC).
2. 15 sites d'appel dans les specs utilisaient le libellé affiché (`'Dashboard'`) au lieu de
   la clé `AppTab` en minuscules attendue par le sélecteur CSS `#tabpanel-{tabName}`, sensible
   à la casse. `navigateToTab()` résout désormais la clé canonique quelle que soit la casse.

**Caractéristique machine distincte, confirmée réelle mais sans rapport avec les bugs
ci-dessus** : sur une machine de développement Windows, `next dev` (mode dev) voit son heap
grossir à 5+ Go au bout de ~50-60 tests E2E séquentiels dans une même durée de vie de serveur.
La même charge exécutée contre un build de production (`next build && next start`) reste à
~365 Mo, sans dégradation. Mitigation en mode dev : redémarrer le serveur entre petits lots de
fichiers plutôt qu'un run complet en une seule vie de serveur.

## 5. Tests de sécurité / non-régression

Chaque faille de sécurité corrigée dans l'historique du projet a un test de non-régression
dédié (voir `security-fixes.test.ts`, tests middleware sur la suspension tenant, etc.) — voir
[authentification-securite.md](authentification-securite.md) pour la liste des invariants
protégés.

## 6. Ce qui n'est pas couvert (honnêteté explicite)

- **`/api/tours/pdf` et probablement `/api/reports/pdf`** : 500 systématique en production
  (dual package hazard `@react-pdf/renderer` sous le bundler serveur Next.js — voir
  [problemes-connus.md](problemes-connus.md)). Les tests unitaires mockent le rendu PDF et ne
  détectent pas ce type de problème d'intégration bundler ; seul un vrai build de production
  testé en conditions réelles l'a révélé. Non corrigé — nécessite une refonte architecturale
  (worker dédié hors process Next, à l'image de `vrpWorker.ts`), documentée comme limitation
  connue plutôt que forcée sous contrainte de temps.
- **Partage temps réel des notes de planification** : fonctionnalité inexistante
  (`localStorage` uniquement), donc rien à tester — voir
  [fonctionnalites.md](fonctionnalites.md).
- Un run E2E complet et propre de bout en bout n'a pas pu être mené à terme dans une seule
  session continue en mode dev sur la machine de développement actuelle (limite mémoire du
  processus `next dev`, §4) — le comportement en build de production est vérifié sain sur un
  sous-ensemble comparable. Un run complet en environnement CI dédié (mémoire non partagée
  avec le poste de développement) reste à faire pour une confirmation à 100%.
- Les bugs de plomberie UI↔API (un `fetch` qui ne vérifie pas `res.ok`, un `select` Prisma qui
  omet un champ affiché par le tableau) ne sont, par construction, pas détectables par des
  tests unitaires qui mockent `fetch`/Prisma avec des réponses toujours `ok:true` — seul un
  test manuel ou E2E contre une vraie DB et un vrai build les révèle. Onze bugs de cette
  nature ont été trouvés ainsi lors de la session de test manuel du 16 août 2026, dont
  plusieurs déjà corrigés (voir commits `e39bccd`, `ea48707`, `8c2031d`, `2dbfb27`, `c00ecdb`,
  `7215ed8`) — reste ouvert : [problemes-connus.md](problemes-connus.md).
