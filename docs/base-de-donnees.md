# Pathélix — Base de données

> Schéma, modèles, relations, migrations. Vérifié directement contre `prisma/schema.prisma`
> le 2026-09-22 (34 modèles, 4 énumérations, recompté après l'ajout du modèle `IdempotencyKey`
> lors de la mission qualité production — des documents antérieurs du projet mentionnaient
> 30 modèles / 3 énumérations, chiffre déjà obsolète avant cet ajout, corrigé ici).

## 1. Généralités

PostgreSQL 16, Prisma 7 avec `@prisma/adapter-pg` (pas le driver Prisma historique — adapter
explicite avec pool `pg`, taille configurée via `DB_POOL_SIZE`). Client généré dans
`src/generated/prisma` (sortie custom, pas `node_modules/@prisma/client`).

**Isolation multi-tenant garantie par convention de code, pas par Row-Level Security
PostgreSQL** — chaque requête Prisma doit filtrer explicitement par `tenantId`. C'est
l'invariant de sécurité le plus important du projet (voir
[authentification-securite.md](authentification-securite.md)).

Migrations : `prisma/migrations/` — 19 migrations au 2026-09-22 (dont `20260922193350_add_
idempotency_key`, ajoutée lors de la mission qualité production — voir §4 et
`QUALITE_PROD_LOG.md` "Phase 3"). Toujours `npx prisma migrate dev` pour un changement de schéma
en développement, `npx prisma migrate deploy` en production (après sauvegarde, voir
[deploiement.md](deploiement.md)).

## 2. Modèles (34)

```
Tenant (1)
  ├─ TenantSettings (1:1)
  ├─ TenantMLProfile (1:1)
  ├─ User (N) ── UserPermission (N)
  ├─ Driver (N) ── DriverUnavailability (N)
  ├─ Vehicle (N) ── MaintenanceRecord (N), FuelRecord (N)
  ├─ Client (N) ── Site (N) ── SiteProduct (N)
  │        └─ ClientSite (N)              ← liaison client ↔ site
  ├─ Mission (N) ── MissionComment (N), DeliveryProof (N), InterventionMetric (N)
  ├─ Exutoire (N)
  ├─ Plan (N)                 ← missions JSON : PlannedMission[]
  ├─ TourHistory (N)          ← snapshots de tournées passées
  ├─ WeeklyPlan (N)           ← planning hebdomadaire
  ├─ MissionTemplate (N)      ← missions récurrentes, backed en DB
  ├─ AuditLog (N)
  ├─ ApiKey (N) · PushSubscription (N) · Holiday (N) · Integration (N)
  ├─ DriverPosition (N)
  ├─ AiJob (N)                ← jobs OCR
  ├─ CustomTrade (N)          ← secteurs personnalisés au-delà des 6 intégrés, GLOBAL (pas de tenantId)
  ├─ TrackdechetsAccount (N)  ← token chiffré AES-256-GCM
  ├─ Bsd (N)
  └─ IdempotencyKey (N)       ← rejeu des actions chauffeur hors-ligne, purge 48h (voir authentification-securite.md §13)
```

Modèles listés ici tels qu'ils existent réellement dans `prisma/schema.prisma` au
2026-09-22 — ne pas se fier à un diagramme d'un document antérieur sans revérifier contre le
schéma si une divergence est suspectée.

## 3. Énumérations (4)

```prisma
enum TenantPlan  { FREE BASIC PRO ENTERPRISE }
enum UserRole    { SUPERADMIN ADMIN DISPATCHER DRIVER }
enum MissionType {
  POSER RETIRER ECHANGER VIDER PAUSE
  CHARGER_IMMEDIAT DEPLACER TASSER EXPEDIER ALLER_RETOUR
}
enum BsdStatus   { /* statuts du cycle de vie d'un Bordereau de Suivi des Déchets */ }
```

`VIDER` et `PAUSE` sont synthétiques — générées par le VRP, jamais créées directement par un
utilisateur ni acceptées par les schémas Zod de création manuelle (`UserCreateSchema` etc.).
Les vues UI standard (table Missions) les excluent via `SYNTHETIC_TYPES`.

## 4. Champs et conventions notables

- `Plan.missions` : `Json` — tableau de `PlannedMission[]` (structure dans `src/lib/schemas.ts`)
- `Integration.config` : `Json` — chiffré AES-256-GCM avant stockage
- `TrackdechetsAccount.encryptedToken` : chiffré AES-256-GCM, jamais renvoyé par une route
- `Mission.linkedExutoireId` : lien direct exutoire (**pas** via `Client`)
- `Mission.generatedFromTemplateId` : lien stable vers le `MissionTemplate` d'origine pour les
  missions récurrentes (dédup par ce champ, pas par heuristique de correspondance) — backfill
  disponible : `npm run db:backfill-template-links`
- `TenantSettings.valhallaFactor` : facteur ML de correction du temps de trajet (défaut 1,60)
- `AuditLog` : rétention pilotée par `AUDIT_RETENTION_DAYS` (défaut **365** jours dans le code
  du worker de purge — voir [configuration.md](configuration.md))

## 5. Pattern d'accès type

```typescript
// Lecture scoping tenant
const record = await prisma.mission.findFirst({ where: { id, tenantId } })
if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

// Écriture — jamais sans le where tenantId sur l'update/delete lui-même
// quand la ressource est identifiée uniquement par son id
await prisma.mission.update({ where: { id }, data: { ... } })
```

## 6. Seeds et scripts

| Commande | Usage |
|----------|-------|
| `npm run db:seed` | Données réalistes multi-tenant |
| `npm run db:seed-massive` | Volume important (tests de charge) |
| `npm run db:seed-superadmin` | Compte superadmin uniquement |
| `npm run db:backfill-template-links` | Backfill `Mission.generatedFromTemplateId` |
| `npx prisma studio` | GUI base de données |

Tout script écrivant en base pendant une session de test manuel doit passer par
`scripts/db-guard.sh` — voir [installation.md](installation.md) §5.
