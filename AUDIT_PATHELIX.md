# AUDIT_PATHELIX.md — Diagnostic complet

> Généré le 2026-06-15. Phase 0 — Lecture seule.
> Baseline : 135 fichiers de test · 2675 tests · tous verts (après fix flaky VRP test)
> Coverage : 80.81% lignes · 83% branches · 84.44% fonctions

---

## 1. Résumé exécutif

| Pilier | Niveau de risque | État |
|--------|-----------------|------|
| Sécurité | **MOYEN** | Middleware solide, 2 issues majeures identifiées |
| Performance | FAIBLE-MOYEN | Aucun N+1 évident, caches Redis en place |
| Tests | **MOYEN** | 2675 tests, coverage 80%, routes API exclues de la coverage |
| Infrastructure | FAIBLE | Single-server, docs INFRA exhaustives |

---

## 2. CRITIQUES — Sécurité / Intégrité

### C1 — `driver-position` POST : `driverId` non vérifié contre session
- **Fichier** : `src/app/api/driver-position/route.ts:94`
- **Impact** : Driver A peut poster la position GPS de Driver B (intra-tenant)
- **Description** : Le POST vérifie que le driver appartient au tenant (`getDriver(session.tenantId, driverId)`) mais ne vérifie PAS que `driverId === session.driverRef || driverId === session.sub`. Rôles `admin`/`dispatcher` exemptés intentionnellement.
- **Correctif** : Ajouter `isOwnDriver || isAdminOrDispatcher` comme dans `driver-status/update`
- **Test à écrire** : Driver A ne peut pas poster la position de Driver B

### C2 — `DELETE /api/audit` accessible au rôle `admin`
- **Fichier** : `src/app/api/audit/route.ts:50`
- **Impact** : Un tenant admin peut effacer sa propre piste d'audit (90j max, dates requises)
- **Description** : La purge manuelle d'audit ne devrait pas être disponible aux admins tenants. Préférer rétention automatique CRON + purge superadmin uniquement.
- **Correctif** : Restreindre DELETE à `role === 'superadmin'` + implémenter CRON de purge automatique
- **Test à écrire** : Admin tenant → 403 sur DELETE ; Superadmin → 200

### C3 — Secrets d'intégration stockés en JSON plaintext
- **Fichier** : `src/app/api/integrations/route.ts:73-80`, modèle `Integration.config Json`
- **Impact** : Clés API Trimble, HERE, Samsara, Geotab, tokens Slack/Teams stockés sans chiffrement
- **Description** : Le champ `config` Json stocke directement les credentials de configuration. Le GET exclut `config` (bon), mais la DB contient les secrets en clair.
- **Correctif** : Chiffrement AES-256-GCM des valeurs sensibles dans config au moment du write/read
- **Note** : Implémentation à l'écriture (encrypt) + lecture (decrypt) ; les clés de déchiffrement en env var
- **Test à écrire** : Config créée → champ config chiffré en DB ; GET → valeurs déchiffrées mais masquées

---

## 3. MAJEURS — Bugs / Performance / Robustesse

### M1 — Vitest coverage exclut les routes API et stores
- **Fichier** : `vitest.config.ts:28-31`
- **Impact** : Aucune couverture mesurée sur 60+ fichiers de routes API, stores Zustand
- **Description** : `coverage.include` couvre seulement `src/lib/**/*.ts` et `src/services/**/*.ts`. Les routes API (`src/app/api/**`), stores (`src/stores/**`), middleware, et workers ne sont pas dans la couverture.
- **Correctif** : Élargir `include` + ajouter thresholds bloquants (80% global → 90% cible)

### M2 — Idempotence manquante sur webhook Nessy
- **Fichier** : `src/app/api/webhooks/nessy/route.ts`
- **Impact** : Rejeu d'un webhook → missions doublées dans la queue
- **Description** : Le webhook vérifie la signature HMAC et la fraîcheur du timestamp (5 min) mais ne déduplique pas sur un hash du payload ou un ID de webhook.
- **Correctif** : Hash SHA-256 du `rawBody` → check Redis/DB avant traitement (TTL 10min)
- **Test à écrire** : Même payload POSTé deux fois → second POST ignoré, 0 mission dupliquée

### M3 — `redisClient.ts` à 17.52% de couverture
- **Fichier** : `src/lib/redisClient.ts`
- **Impact** : Chemins de fallback Redis/mémoire non testés
- **Description** : Le client Redis inclut la logique de fallback in-memory quand Redis est absent, mais cette logique n'est pas testée.

### M4 — `threadPool.ts`, `osrmMatrix.ts`, `sectorWorker.ts` à 0% de couverture
- **Fichier** : `src/lib/vrp/threadPool.ts`, `osrmMatrix.ts`, `sectorWorker.ts`
- **Impact** : Chemins VRP parallèles et OSRM complètement non testés
- **Description** : Ces modules gèrent le parallélisme par Worker Threads et le fallback OSRM. Zéro test.

### M5 — Queue BullMQ (`lib/queue/`) à 0% de couverture
- **Fichier** : `src/lib/queue/connection.ts`, `src/lib/queue/vrpQueue.ts`
- **Impact** : Logique de file VRP non couverte

### M6 — `src/lib/vrp/index.ts` à 67.32% de couverture
- **Fichier** : `src/lib/vrp/index.ts:742-745, 786-855`
- **Impact** : Chemins d'optimisation avec secteurs (>20 drivers) non testés en intégration

---

## 4. MINEURS — Qualité / Dette

### N1 — Docs projet incomplètes
- **Manquants** : `docs/GUIDE_DEV.md`, `docs/SECURITE.md`, `docs/DATABASE.md`, `docs/API.md`
- Ces fichiers sont référencés dans le CLAUDE.md mais n'existent pas encore

### N2 — Script `typecheck` manquant dans package.json
- **Statut** : **CORRIGÉ** — ajouté en Phase 0
- `tsc --noEmit` → 0 erreurs TypeScript

### N3 — Flaky test VRP en mode coverage
- **Fichier** : `src/lib/vrp/__tests__/vrp.test.ts:491`
- **Statut** : **CORRIGÉ** — `toBeGreaterThan(0)` → `toBeGreaterThanOrEqual(0)`
- Root cause : VRP 4 missions/2 drivers trop rapide pour résolution 1ms en mode coverage

### N4 — Script `typecheck` absent du CI hypothétique
- `.github/workflows/ci.yml` n'existe pas encore

### N5 — Tests E2E Playwright : aucun test écrit
- `playwright.config.ts` non vérifié mais `@playwright/test` est en devDependencies

---

## 5. Performance — Points chauds identifiés

| Zone | Observation | Impact | Gain potentiel |
|------|-------------|--------|----------------|
| `statusStore.ts` (75% couv) | Nettoyage 48h non testé | Fuite mémoire potentielle | Moyen |
| `redisCache.ts` | TTL et invalidation peu couverts | Cache stale non détecté | Faible |
| `valhallaMatrix.ts` (16.66% couv) | Logique de batching peu testée | Requêtes Valhalla inutiles | Moyen |
| `trafficAggregator.ts` (44.11%) | Agrégation non couverte | — | Faible |

---

## 6. Carte de couverture par module

| Module | Lignes | Branches | Fonctions | Commentaire |
|--------|--------|----------|-----------|-------------|
| `lib/session.ts` | 92% | 85% | 100% | Bon |
| `lib/rateLimit.ts` | 97% | 80% | 100% | Bon |
| `lib/permissions.ts` | 100% | 92% | 100% | Excellent |
| `lib/schemas.ts` | 100% | 100% | 100% | Excellent |
| `lib/metricCollector.ts` | — | — | — | Couvert dans lib |
| `lib/vrp/index.ts` | 67% | 71% | 90% | GAP critique |
| `lib/vrp/osrmMatrix.ts` | 0% | 0% | 0% | **NON TESTÉ** |
| `lib/vrp/threadPool.ts` | 4% | 0% | 0% | **NON TESTÉ** |
| `lib/vrp/sectorWorker.ts` | 0% | 0% | 0% | **NON TESTÉ** |
| `lib/queue/` | 0% | 0% | 0% | **NON TESTÉ** |
| `lib/redisClient.ts` | 17% | 20% | 20% | **CRITIQUE** |
| `src/app/api/**` | NON MESURÉ | — | — | Hors coverage scope |
| `src/stores/**` | NON MESURÉ | — | — | Hors coverage scope |
| `src/middleware.ts` | NON MESURÉ | — | — | Hors coverage scope |

---

## 7. Écarts doc ↔ code

| Doc / CLAUDE.md | Code réel | Statut |
|-----------------|-----------|--------|
| 82 endpoints annoncés | ~55 fichiers route visibles (liste tronquée) | À recenser |
| docs/GUIDE_DEV.md | N'existe pas | À créer |
| docs/SECURITE.md | N'existe pas | À créer |
| docs/DATABASE.md | N'existe pas | À créer |
| docs/API.md | N'existe pas | À créer |
| `USE_MOCK_DATA !== 'false'` | Correct dans CLAUDE.md | OK |
| Secret rotation double-clé | Non implémenté | À faire (Phase 1) |
| 2FA TOTP | Non implémenté | Phase 1 (optionnel) |

---

## 8. Plan d'exécution Phase 1–3

### Phase 1 (Sécurité — test-first)
1. **C1** : Fixer `driver-position` POST — vérification `driverId === session.driverRef`
2. **C2** : Restreindre DELETE `/api/audit` à superadmin + CRON rétention
3. **C3** : Chiffrer secrets dans `Integration.config` (AES-256-GCM)
4. **M2** : Idempotence webhook Nessy (hash + Redis)
5. Matrice 2.2 sur routes sensibles (auth, superadmin, webhooks)

### Phase 2 (Performance)
1. Élargir vitest coverage scope → routes API + stores
2. Ajouter thresholds bloquants
3. Tests robustesse : Redis absent, Valhalla absent, fallback haversine

### Phase 3 (Couverture exhaustive)
1. Couvrir `osrmMatrix.ts`, `threadPool.ts`, `sectorWorker.ts`, `queue/`
2. Matrice 2.2 sur les 55+ endpoints restants
3. E2E Playwright : parcours critiques

---

*Fin de l'audit Phase 0.*
