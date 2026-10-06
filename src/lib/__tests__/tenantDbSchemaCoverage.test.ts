import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TENANT_SCOPED_MODELS } from '../tenantDb'

// Every model with its own tenantId column must be scoped by getTenantDb — a new model added to
// schema.prisma without being listed would silently be readable across tenants.
describe('getTenantDb covers every tenant-owned model', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')
  const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
    .filter(([, , body]) => /^\s+tenantId\s+String\b/m.test(body))
    .map(([, name]) => name)
  // Tenant itself has no tenantId; these are the deliberate exceptions.
  const GLOBAL = new Set<string>([])

  it('found the models', () => { expect(models.length).toBeGreaterThan(30) })
  it.each(models)('%s is tenant-scoped', (name) => {
    if (GLOBAL.has(name)) return
    expect(TENANT_SCOPED_MODELS.has(name)).toBe(true)
  })
})
