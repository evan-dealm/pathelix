# SUPERADMIN_AUDIT.md — Pathélix

> Audit de lecture seule du module superadmin. Produit le 2026-06-18.

---

## 1. Capacités actuelles

### 1.1 Routes API

| Route | Méthodes | Fonctionnalité |
|-------|----------|----------------|
| `/api/superadmin/tenants` | GET, POST | Lister tous les tenants (avec stats) · Créer un tenant |
| `/api/superadmin/tenants/[id]` | GET, PUT, DELETE | Détail tenant (users, settings, activité 30j) · Modifier (name/slug/plan/trade/limits) · Supprimer |
| `/api/superadmin/tenants/[id]/suspend` | POST | Suspendre le tenant · Révoquer les sessions actives · Invalider le cache |
| `/api/superadmin/tenants/[id]/activate` | POST | Réactiver un tenant suspendu |
| `/api/superadmin/tenants/[id]/purge-cache` | POST | Purger le cache Redis du tenant |
| `/api/superadmin/tenants/[id]/data` | GET | Lire toutes les données métier (users, drivers, vehicles, missions, exutoires, clients, sites, templates, settings) |
| `/api/superadmin/tenants/[id]/settings` | PUT | Modifier les TenantSettings (speed, costs, optimizations/day…) |
| `/api/superadmin/tenants/[id]/resources` | POST | CRUD sur toute entité métier d'un tenant (driver/client/vehicle/exutoire/site/mission/template) |
| `/api/superadmin/users` | GET, POST | Lister les utilisateurs cross-tenant · Créer un utilisateur dans un tenant |
| `/api/superadmin/users/[id]` | GET, PUT, DELETE | Voir · Modifier (rôle, email, prénom, nom) · Supprimer · Réinitialiser MDP |
| `/api/superadmin/trades` | GET, POST | Lister les métiers (intégrés + personnalisés) · Créer un métier custom |
| `/api/superadmin/trades/[id]` | PUT, DELETE | Modifier · Supprimer un métier custom (protégé si utilisé) |
| `/api/superadmin/stats` | GET | Statistiques globales cross-tenant (total, récent, topTenants, activité journalière) |
| `/api/superadmin/system-health` | GET | Santé infra : mémoire Node, Redis, file BullMQ, moteur de routage, DB |
| `/api/superadmin/audit-logs` | GET | Journal cross-tenant : filtres tenantId/action/userId/date, pagination, 100 max |
| `/api/superadmin/impersonate` | POST | Prendre une session admin d'un tenant (sub=sa:\<id\>, 15 min, loggé AuditLog) |
| `/api/superadmin/exit-impersonation` | POST | Restaurer la session superadmin d'origine |
| `/api/superadmin/ml-status` | GET | Maturité ML par tenant (métriques collectées, taux rejet, % vers seuil 500) |
| `/api/superadmin/ml-accuracy` | GET | Précision ML : MAPE, biais médian, par type/driver/site |

### 1.2 Interface `/superadmin` (page.tsx — 2 136 lignes)

| Onglet | Contenu |
|--------|---------|
| Dashboard | StatCards globales, activité 14j, topTenants, auditLog récent |
| Tenants | Liste avec badge plan/suspension, actions suspend/activate/impersonate/delete |
| Détail tenant | 9 sous-onglets : Users · Drivers · Vehicles · Missions · Exutoires · Clients · Sites · Templates · Settings |
| Audit | Journal cross-tenant groupé par tenant, export CSV, filtre tenant |
| Métiers (Trades) | Built-in lecture seule · Custom CRUD complet · Changer le métier d'un tenant |
| Santé système | Redis, BullMQ, routing, DB, mémoire Node |
| Pricing | Aide-mémoire interne tarification (statique, lecture seule) |
| ML Précision | (accédé via API depuis le dashboard) |

### 1.3 Composants de sécurité

| Garde | Implémentation | Statut |
|-------|---------------|--------|
| Blocage middleware `/superadmin*` | `SUPERADMIN_ONLY_PATTERNS` dans `src/middleware.ts` | ✅ |
| Defense-in-depth sur chaque route | `if (role !== 'superadmin') return 403` | ✅ |
| Session impersonation 15 min | `exp: Math.floor(Date.now()/1000) + 900` | ✅ |
| `sub=sa:<id>` identifiable | Toute session impersonation a le préfixe `sa:` | ✅ |
| ImpersonationBanner | `src/components/ImpersonationBanner.tsx` monté dans `layout.tsx` | ✅ |
| Audit impersonation → AuditLog | `auditLog.create` dans `/impersonate/route.ts` | ✅ |
| Audit suspend/activate | `logSuperadminAction` dans `/suspend/route.ts` et `/activate/route.ts` | ✅ |
| Audit purge-cache | `logSuperadminAction` dans `/purge-cache/route.ts` | ✅ |
| Audit users PUT/DELETE | `logSuperadminAction` dans `/users/[id]/route.ts` | ✅ |
| `checkTenantSuspension` | `invalidateSuspensionCache` appelé sur suspend/activate | ✅ |
| Sessions révoquées à la suspension | `revokeSessionsForTenant(id)` dans `/suspend/route.ts` | ✅ |

---

## 2. Lacunes identifiées

### 2.1 Lacunes de traçabilité (AuditLog)

| Route | Opération | Lacune |
|-------|-----------|--------|
| `DELETE /api/superadmin/tenants/[id]` | Suppression tenant | ❌ Aucune entrée AuditLog — opération irréversible non tracée |
| `PUT /api/superadmin/tenants/[id]/settings` | Modification settings | ❌ `logger.info` seulement — non tracé dans AuditLog |
| `POST /api/superadmin/users` | Création utilisateur | ❌ `logger.info` seulement — non tracé dans AuditLog |
| `POST /api/superadmin/tenants/[id]/resources` | CRUD entité métier | ❌ `logger.info` seulement — create/update/delete non tracés dans AuditLog |

### 2.2 Lacunes de tests

| Route | Statut |
|-------|--------|
| `POST /api/superadmin/tenants/[id]/resources` | ❌ Aucun test (seule route sans couverture) |
| Tests 401 non-authentifié | ⚠️ Couverts par middleware (intégration), non testés à niveau route |

### 2.3 Fonctionnalités non concernées

Les éléments suivants sont confirmés absents mais hors périmètre du superadmin (ROADMAP IA) :
- Callback AI Engine (`/api/ai/callback`) → dépend de l'AI Engine Python non déployé
- Jobs AI (`/api/ai/jobs`) → idem
- OCR tickets (`/api/ai/ocr`) → idem

---

## 3. Plan de correction

| Priorité | Action | Fichier |
|----------|--------|---------|
| P1 | Ajouter `logSuperadminAction` sur DELETE tenant | `tenants/[id]/route.ts` |
| P1 | Ajouter `logSuperadminAction` sur PUT settings | `tenants/[id]/settings/route.ts` |
| P1 | Ajouter `logSuperadminAction` sur POST users | `users/route.ts` |
| P1 | Ajouter `logSuperadminAction` sur POST resources (create/update/delete) | `tenants/[id]/resources/route.ts` |
| P2 | Créer tests pour `/api/superadmin/tenants/[id]/resources` | `superadmin-resources.test.ts` (NEW) |
| P3 | Vérifier couverture branches ≥ 90% sur module superadmin | Vitest coverage |

---

## 4. Verdict sécurité

Le module superadmin est **globalement solide** :
- Pas de backdoor silencieux (toutes les routes vérifient le rôle)
- L'impersonation est traçable (`sub=sa:<id>` + AuditLog + ImpersonationBanner)
- Les sessions sont révoquées à la suspension
- L'admin normal ne peut JAMAIS atteindre `/api/superadmin/**` (middleware)

**4 actions destructives manquent de traçabilité AuditLog** — à corriger avant production.
