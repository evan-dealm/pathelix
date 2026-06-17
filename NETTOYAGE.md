# NETTOYAGE.md — Pathélix

> Rapport de détection de code mort, fichiers inutiles, dépendances et imports.
> Produit le 2026-06-17. Outil utilisé : knip + vérification manuelle grep.
> Règle : aucune suppression sans preuve. VRP (`src/lib/vrp/`) jamais touché.

---

## Résumé exécutif

| Catégorie | Détecté | Supprimé | Conservé (justification) |
|-----------|---------|---------|--------------------------|
| Artifacts de build commités | 6 | 6 | — |
| Fichiers temporaires | 2 | 2 | — |
| Entrées .gitignore manquantes | 4 | — | 4 ajoutées |
| Code mort (composant + barrel) | 2 | 2 | — |
| Worker orphelin | 1 | 1 | — |
| Utilitaires i18n non câblés | 2 | 2 | — |
| Exports non utilisés | 14 | 0 | 14 conservés (voir section) |
| Types non utilisés | 33 | 0 | 33 conservés (interface publique) |
| Dépendances npm (faux positifs) | 3 | 0 | 3 faux positifs confirmés |
| TODO/FIXME source | 0 | — | — |

---

## Catégorie 1 — Artifacts de build et fichiers temporaires

### Supprimés

| Fichier | Raison |
|---------|--------|
| `coverage/base.css` | Rapport HTML de couverture — artifact de build, pas du code source |
| `coverage/block-navigation.js` | idem |
| `coverage/prettify.css` | idem |
| `coverage/prettify.js` | idem |
| `coverage/sorter.js` | idem |
| `coverage/favicon.png` | idem |
| `tsconfig.tsbuildinfo` | Cache de build TypeScript incrémental — artifact |
| `playwright-result.txt` | Résultat de run Playwright — fichier temporaire |
| `test-results/.last-run.json` | Dernier run Playwright — fichier temporaire |

### .gitignore — entrées ajoutées

```
coverage/
tsconfig.tsbuildinfo
playwright-result.txt
test-results/
```

---

## Catégorie 2 — Code mort (fichiers jamais importés)

### Supprimés

| Fichier | Preuve de suppression sûre |
|---------|---------------------------|
| `src/lib/data/index.ts` | Barrel export (`export * from './drivers'` etc.). Grep sur `from '@/lib/data'` (sans sous-chemin) → 0 résultat. Tous les imports vont directement vers `@/lib/data/context`, `@/lib/data/drivers`, etc. |
| `src/components/admin/InterventionFormRenderer.tsx` | Grep sur `InterventionFormRenderer` dans `src/` → 0 import (seul le fichier lui-même). Composant jamais utilisé dans l'UI admin. |

---

## Catégorie 3 — Worker orphelin

### Supprimé

| Fichier | Preuve de suppression sûre |
|---------|---------------------------|
| `src/workers/anomalyDetectionWorker.ts` | Pas de script dans `package.json` (seuls `worker`, `worker:ml`, `worker:recurring` existent). La queue BullMQ `'anomaly-detection'` n'est jamais alimentée depuis le reste du code (grep `'anomaly-detection'` → 0 résultat hors du worker lui-même). Le worker est un prototype non câblé. |

---

## Catégorie 4 — Utilitaires i18n non câblés

### Supprimés

| Fichier | Raison | Alternative couverte |
|---------|--------|----------------------|
| `src/i18n/navigation.ts` | Exports `Link`, `redirect`, `usePathname`, `useRouter` from `next-intl/navigation`. Grep sur imports → 0 résultat. Préparé pour une navigation multi-langue mais jamais intégré dans les pages/layouts. | `next/link`, `next/navigation` utilisés directement |
| `src/i18n/setLocale.ts` | Server action pour changer de locale via cookie. Grep → 0 import. Pas d'UI de changement de langue. | — |

---

## Catégorie 5 — Exports non utilisés (conservés)

Ces fonctions/variables sont exportées mais non importées depuis l'extérieur du fichier. Elles restent car :
- Certaines sont utilisées **en interne** dans le même fichier (ex. `directionalTrafficBonus` appelée à la ligne 172 du même `algorithm.ts`)
- Les autres constituent l'**interface publique** potentielle du module (suppression = risque de casser des consommateurs futurs ou des scripts non référencés)
- Les items VRP ne sont jamais modifiés

| Export | Fichier | Décision | Raison |
|--------|---------|----------|--------|
| `directionalTrafficBonus` | `algorithm.ts` | CONSERVER | Utilisée en interne ligne 172, export incidentel |
| `fetchWithRetry` | `httpClient.ts` | CONSERVER | Utilisée en interne ligne 86, export incidentel |
| `channelName` | `driverStatusPubSub.ts` | CONSERVER | Utilitaire résilience, peut être utile pour tests/debug |
| `subscribeStatusUpdates` | `driverStatusPubSub.ts` | CONSERVER | Interface publique — peut être câblée côté client |
| `invalidateFamiliarityCache` | `familiarityLoader.ts` | CONSERVER | Utilitaire d'admin/maintenance |
| `logger` (défaut) | `logger.ts` | CONSERVER | Export explicite de l'instance logger racine |
| `CACHE_TTL` | `redisCache.ts` | CONSERVER | Constante partageable avec code externe |
| `requestBackgroundSync` | `syncQueue.ts` | CONSERVER | Service worker sync — appelable par SWProvider |
| `registerCustomTrade`, `unregisterCustomTrade`, `getAllTradeIds`, `getAllTrades` | `trades.ts` | CONSERVER | API publique du système de trades — peut être utilisée depuis les routes superadmin |
| `TRIMBLE_API_URL`, `TRIMBLE_API_KEY` | `trimble.ts` | CONSERVER | Constantes de configuration d'intégration |
| `_cleanupTimers` | `planningStore.ts` | CONSERVER | Exposé pour cleanup dans tests (pattern `_` = test helper) |
| VRP : `getLastAlnsTelemetry`, `nearestDriverIdx`, `getThreadPoolSize` | `vrp/` | JAMAIS TOUCHER | Moteur VRP — invariant absolu |

---

## Catégorie 6 — Types exportés non utilisés (conservés)

33 types/interfaces exportés signalés par knip. Tous conservés — les types TypeScript constituent l'interface publique du module. Les supprimer casserait l'inférence de type dans tout code qui importe le module, y compris les tests et les scripts externes.

Types notables conservés : `OptimizeRequest`, `PlanInput`, `LoginInput`, `VehicleInput`, `TenantSettingsInput`, types Trackdéchets, types VRP.

---

## Catégorie 7 — Dépendances npm (faux positifs knip)

| Package | Signalé comme inutilisé | Réalité |
|---------|------------------------|---------|
| `@prisma/client` | Knip ne voit pas le client généré dans `src/generated/prisma/` | Utilisé via `src/generated/prisma/index.js` |
| `pg` | Knip ne trace pas `@prisma/adapter-pg` → `pg` | Utilisé dans `src/lib/db.ts` via `PrismaPg` |
| `sharp` | Next.js image optimization n'importe pas sharp explicitement | Consommé automatiquement par `next/image` en production |

---

## Catégorie 8 — TODO/FIXME

Grep exhaustif dans `src/**/*.ts` et `src/**/*.tsx` (hors tests, hors generated) :
- **Résultat : 0 TODO/FIXME dans le code source**
- Les seuls TODO trouvés sont dans `src/generated/prisma/runtime/client.d.ts` (fichier généré, pas du code source)
- Les occurrences de `HACK` dans les tests sont des données de test, pas des marqueurs de code douteux

---

## Catégorie 9 — Fichiers conservés malgré apparence de "non utilisé" (faux positifs)

| Fichier | Raison de conserver |
|---------|---------------------|
| `e2e/auth.setup.ts` | Référencé dans `playwright.config.ts` (`testMatch: /auth\.setup\.ts/`) — setup Playwright |
| `prisma/schema.prisma` | Schéma de base de données, source de vérité Prisma |
| `prisma/seed-massive.ts` | Script npm `db:seed-massive` dans package.json |
| `public/sw.js` | Service worker enregistré dans `SWProvider.tsx` à `/sw.js` |
| `src/generated/prisma/` | Fichiers générés par `npx prisma generate` — déjà dans .gitignore |
| `scripts/backup-pg.sh`, `scripts/restore-pg.sh` | Scripts opérationnels pour sauvegardes PostgreSQL |
| `src/workers/recurringMissionsWorker.ts` | Script npm `worker:recurring` dans package.json |
| `src/workers/auditRetentionWorker.ts` | Vérifié : importé depuis `vrpWorker.ts` (démarrage CRON intégré) |

---

## Espace récupéré

| Catégorie | Lignes supprimées (approx.) | Ko |
|-----------|----------------------------|----|
| Coverage HTML artifacts | ~500 | ~80 Ko |
| Fichiers temporaires | ~20 | ~2 Ko |
| InterventionFormRenderer | ~80 | ~3 Ko |
| data/index.ts | ~5 | <1 Ko |
| anomalyDetectionWorker.ts | ~112 | ~4 Ko |
| i18n/navigation.ts + setLocale.ts | ~30 | ~1 Ko |
| **Total** | **~750 lignes** | **~90 Ko** |
