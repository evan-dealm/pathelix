# CLAUDE.md — Pathélix

> Context for Claude Code sessions. Product/tech docs: README.md, FEATURES.md, ARCHITECTURE.md,
> OPERATIONS.md, SECURITY.md — keep them true when you change behaviour (≤ 5 docs, no new
> audit/log .md files: history belongs in commit messages).

## Project identity

Multi-tenant B2B SaaS for fleet management and route optimisation (skip-bin hauliers first).
Next.js 15.5 App Router · TypeScript 5.9 strict · PostgreSQL 16 + Prisma 7 (`@prisma/adapter-pg`,
client in `src/generated/prisma`) · Zustand · TanStack Query 5 · Tailwind 3 · MapLibre GL JS ·
Zod 4 · BullMQ + Redis (optional) · Valhalla · Sentry · Vitest + Playwright.

## Critical invariants — never break these

1. **Tenant isolation**: tenant-scoped data goes through `getTenantDb(tenantId)`
   (`src/lib/tenantDb.ts`). Importing `@/lib/db` / `unscopedPrisma` is banned by ESLint outside
   the reviewed cross-tenant whitelist (webhooks resolving tenant by secret, superadmin, workers,
   health checks, cross-tenant aggregates). Client-supplied foreign ids (driverId, clientId,
   siteId…) are verified in-tenant before writing (`src/lib/tenantRefs.ts`).
2. **Identity**: middleware strips `x-user-id`/`x-user-role`/`x-tenant-id` and re-injects them
   from the verified JWT or API key. Routes read identity only via `getRequestContext(req)`.
3. **Security headers** live only in `next.config.mjs` (baked at build time).
4. **Mock mode**: `process.env.USE_MOCK_DATA !== 'false'` (default ON) — never `=== 'true'`.
5. **VRP engine** (`src/lib/vrp/`, MV-ALNS 7-step pipeline, ML shields, CE 561/2006): route cost
   is ONE simulator in `routeCost.ts`; prefix states and insertion/removal deltas replay it —
   never reintroduce a separate delta implementation (`deltaConsistency.test.ts` guards this).
   `enforceMissionConservation` guarantees each input mission appears exactly once in output.
6. **Zod at boundaries**: every POST/PUT validates before any DB write.
7. **Permissions** are enforced server-side (`hasPermission`); UI gating is UX only.
8. **Drivers are deny-by-default** in middleware (`DRIVER_API_ALLOWLIST`); routes still check
   ownership.

## Patterns

```typescript
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { tenantId, role, userId } = getRequestContext(req)
  if (!(await hasPermission(userId, role, 'manage_missions'))) return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
  const parsed = MySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const db = getTenantDb(tenantId)
  // …
}
```

- Client fetches check `res.ok` and surface the server error (`apiRequest` in `src/lib/apiClient.ts`);
  list routes are paginated — use `fetchAllPages` for full lists.
- Caches read by both middleware and routes must live on `globalThis` (separate bundles).
- Workers: `validateEnv()` only when the file is the entry point; graceful shutdown via
  `installWorkerLifecycle`; scheduled work = BullMQ repeatable job.
- Outbound calls to admin-configured URLs go through `src/lib/outboundUrl.ts` (SSRF guard), with timeouts.

## Conventions

- No `as any`; typed interfaces or `unknown` + guards. JSDoc on non-obvious `src/lib` exports.
- No `console.log` in production code — `createLogger()` from `src/lib/logger.ts`.
- UI copy in French with proper accents; vocabulary adapts to the tenant `trade`.
- Design: Geist + Inter, light palette, brand blue `#0055A4`, `OrbitalBackground`.
- Never skip/disable a failing test; fix the bug or the wrong test, with a reason.
- Commit messages explain the user-visible bug/why; end with the Co-Authored-By line.

## Commands

```bash
npm run dev | build | lint | typecheck
npm test                          # Vitest
npx playwright test               # E2E (prefer against next build && next start)
npm run worker                    # VRP; also worker:pdf | worker:ml | worker:recurring | worker:retention
npx prisma migrate dev | generate
npm run db:seed | db:seed-superadmin
```

Manual testing: sandbox DB `manualtest_sandbox_never_prod` via `.manualtest/env.sh` (gitignored),
guard scripts with `scripts/db-guard.sh`. Never run exploratory writes against the `.env` database.
