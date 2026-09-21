# Pathélix — Authentification et sécurité

> Fonctionnement de l'auth, des rôles, mesures en place, risques résiduels connus. Vérifié
> contre le code réel le 2026-09-21, incluant l'audit de cette même date — voir
> [audit-2026-09-21.md](audit-2026-09-21.md) pour le détail des correctifs appliqués.

## 1. Invariants critiques — ne jamais casser

1. **Isolation multi-tenant** : toute requête Prisma filtre par `tenantId`. Vérifié par
   convention de code, pas par Row-Level Security PostgreSQL.
2. **Chaîne d'auth** : le middleware (`src/middleware.ts`) strip les headers
   `x-user-id`/`x-user-role`/`x-tenant-id` entrants puis les ré-injecte depuis le JWT vérifié.
   `getRequestContext(req)` (`src/lib/data/context.ts`) est le **seul** point de lecture
   autorisé dans les routes — jamais `req.headers.get('x-user-role')` directement. Vérifié par
   grep sur tout `src/` le 2026-09-21 : aucune violation trouvée en dehors du fichier canonique
   lui-même.
3. **CSP canonique** : définie exclusivement dans `next.config.mjs`, jamais dans
   `middleware.ts`. Vérifié 2026-09-21 : aucun en-tête de sécurité dans `middleware.ts`.
4. **Mock mode** : `process.env.USE_MOCK_DATA !== 'false'` (défaut = mock ON, jamais
   `=== 'true'`). Vérifié 2026-09-21 : zéro occurrence du pattern inversé dans `src/`.
5. **Intégrité VRP** : `src/lib/vrp/` jamais modifié sans validation complète de sa suite de
   tests.
6. **Zod aux frontières** : toutes les routes POST/PUT valident avec un schéma Zod avant toute
   écriture DB.

## 2. JWT et sessions

```
POST /api/auth/login
  → vérification bcrypt du mot de passe
  → signSession({ sub, role, tenantId, driverRef?, trade?, iat, exp })
  → cookie HttpOnly SameSite=Strict Secure, expiry 24h
```

`src/lib/session.ts` — HMAC-SHA256 via Web Crypto API, aucune dépendance NPM pour la
signature.

## 3. Middleware (`src/middleware.ts`)

Exécuté sur toutes les requêtes : décode/vérifie le JWT (401 si invalide/expiré) → strip +
ré-injecte les headers d'identité → RBAC par rôle → rate limiting Redis → passe au route
handler.

## 4. Isolation multi-tenant — pattern

```typescript
const record = await prisma.mission.findFirst({ where: { id, tenantId } })
if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
await prisma.mission.update({ where: { id }, data: { ... } })
```

Historique : trois bugs cross-tenant réels ont été trouvés et corrigés lors de l'audit d'août
2026 (`DeliveryProof.driverId`, liens `ClientSite` sur `PUT /api/clients/[id]`, `driverId` GPS
Geotab/Samsara) — voir `AUDIT_BUGS.md` à la racine pour le détail historique complet.

## 5. Permissions granulaires

`src/lib/permissions.ts` — 11 permissions (`optimize`, `manage_drivers`, `manage_exutoires`,
`manage_missions`, `manage_vehicles`, `manage_users`, `view_reports`, `view_costs`,
`manage_settings`, `api_access`, `manage_integrations`), cache 60s par utilisateur.

```typescript
DEFAULT_PERMISSIONS = {
  admin:      [...ALL_PERMISSIONS],
  superadmin: [...ALL_PERMISSIONS],
  dispatcher: ['optimize', 'manage_missions', 'manage_drivers', 'view_reports', 'manage_vehicles'],
  driver:     [],
}
```

`hasPermission()` court-circuite `true` pour `admin`/`superadmin`, retombe sur
`DEFAULT_PERMISSIONS[role] ?? []` sinon — **fail-closed par construction**.

### Limite connue, quantifiée précisément (session de test manuel, août 2026)

Sur les 11 permissions granulaires configurables par utilisateur, **1 seule** (`optimize`) a un
vrai gating d'interface côté client (bouton désactivé + tooltip). La navigation admin est
gatée uniquement par **rôle** (`adminOnly` sur `NAV_ITEMS`) — 9 onglets sur 13+ sont
inaccessibles à tout dispatcher quelle que soit la permission accordée, rendant 7 des 11
permissions totalement inertes pour ce rôle (leur onglet cible est bloqué en amont). 3 autres
(`manage_missions`, `view_reports`, `view_costs`) ciblent des onglets accessibles mais sans
gating client trouvé — **le backend reste correctement protégé** (`manage_missions` vérifié en
code : `missions/route.ts` retourne 403), donc pas de faille de sécurité, seulement une UX
trompeuse (bouton actif qui échoue silencieusement au lieu d'être grisé). Détail complet et
méthode de vérification : `TEST_MANUEL_PROGRESSION.md` section D à la racine. Non corrigé
intentionnellement — refonte UX/produit, pas un bug ponctuel, nécessite une décision produit
sur l'ampleur du gating souhaité.

## 6. Rate limiting

`src/lib/rateLimit.ts` — sliding window Redis (60s), fallback in-memory si Redis indisponible.
Login : 5 tentatives / 60s par IP.

## 7. Headers de sécurité

Définis exclusivement dans `next.config.mjs` : CSP (whitelist stricte), HSTS
(`FORCE_HTTPS=false` pour désactiver en dev), `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy`.

## 8. Chiffrement

- Secrets d'intégration (`Integration.config`) et token Trackdéchets : AES-256-GCM
  (`src/lib/configCrypto.ts`)
- Webhooks (Nessy, OBD, Geotab, Samsara) : secret/clé **par tenant**, jamais une variable
  d'environnement globale — le tenant est résolu en trouvant quelle intégration activée
  vérifie la signature/clé fournie, jamais depuis un header client-asserté. Les anciennes
  variables `NESSY_WEBHOOK_SECRET`/`OBD_WEBHOOK_TOKEN` sont dépréciées et non lues pour
  l'authentification (vérifié dans le code le 2026-09-21 — un warning de log s'affiche si
  elles sont encore définies).

## 9. Uploads de fichiers

`POST /api/delivery-proof` (photo/signature) : limite de taille (5 Mo), détection du type réel
par lecture des magic bytes (`detectImageType()`) plutôt que confiance dans le
Content-Type/nom fourni par le client, nom de fichier généré en UUID (pas de nom
client-contrôlé, pas de `missionId` dans le nom). Vérifié 2026-09-21.

## 10. Audit trail

`AuditLog` (rétention **365 jours** par défaut, `AUDIT_RETENTION_DAYS` — corrigé le 2026-09-21
dans cette documentation après vérification directe du code ; des documents antérieurs
mentionnaient 90 jours, valeur obsolète). Écrit sur les mutations sensibles : création/
modification/suppression de drivers, missions, véhicules, utilisateurs (y compris changement
de rôle), permissions, intégrations, et sur la purge d'audit elle-même.

## 11. Impersonation superadmin

Un superadmin peut prendre l'identité d'un admin tenant. Session `sub=sa:<userId_original>`,
`role=admin` pour le tenant cible. Tout accès est journalisé.

## 12. Dépendances — état de l'audit (2026-09-21)

Voir [audit-2026-09-21.md](audit-2026-09-21.md) pour le détail complet. Résumé : une
vulnérabilité **critique** (RCE non authentifiée Next.js sur serveurs Windows) a été trouvée et
corrigée cette session (`next` 15.5.18 → 15.5.25 via `npm audit fix`, sans breaking change).
10 vulnérabilités résiduelles (1 basse, 5 modérées, 4 hautes) nécessitent toutes un downgrade
breaking d'un outil de développement ou d'une dépendance transitive inutilisée en pratique —
évaluées et documentées comme acceptables dans `AUDIT_LOG.md`.

## 13. Risques résiduels connus (non corrigés, décisions documentées)

| Risque | Détail | Statut |
|--------|--------|--------|
| Gating UI des permissions granulaires incomplet | Voir §5 | Décision produit — pas une faille de sécurité (backend protégé) |
| Race condition sync-queue chauffeur offline | Verrou en mémoire local (page) non partagé avec le Service Worker (`sw.js`) — peut POSTer deux fois la même action | Amorti par l'idempotence de certains endpoints, pas garanti partout — `AUDIT_BUGS.md` (N23) |
| Cache de suspension tenant en mémoire | Pas partagé multi-instance | Acceptable en mono-serveur actuel — à revoir avant toute bascule multi-instance |
| HALT Trackdéchets actif | Aucun appel API TD prod sans validation manuelle | Voir [deploiement.md](deploiement.md) §HALT |
