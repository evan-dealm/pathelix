import { describe, it, expect, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))

import { API_OPERATIONS, buildOpenApiSpec, requiredScope } from '@/lib/openapi'
import { API_SCOPES } from '@/lib/apiScopes'
import { scopeAllows } from '@/lib/apiKeyAuth'
import { BUSINESS_EVENTS } from '@/lib/events/outbound'

const API_DIR = join(process.cwd(), 'src', 'app', 'api')

/** Every `METHOD /path` a route file under src/app/api really exports. */
function realOperations(): Set<string> {
  const out = new Set<string>()
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { if (name !== '__tests__') walk(full); continue }
      if (name !== 'route.ts') continue
      const path = '/' + relative(API_DIR, dir).split(sep).join('/').replace(/\[([^\]]+)\]/g, '{$1}')
      const src = readFileSync(full, 'utf8')
      for (const m of src.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)) out.add(`${m[1]} ${path}`)
    }
  }
  walk(API_DIR)
  return out
}

const key = (method: string, path: string) => `${method.toUpperCase()} ${path}`
const concrete = (path: string) => `/api${path.replace(/\{[^}]+\}/g, 'x')}`

describe('API reference — matches what an API key can really do', () => {
  const real = realOperations()
  const documented = new Set(API_OPERATIONS.map(o => key(o.method, o.path)))

  it('every documented operation exists in the code', () => {
    const ghosts = [...documented].filter(k => !real.has(k))
    expect(ghosts).toEqual([])
  })

  it('every operation a key can reach is documented', () => {
    const reachable = [...real].filter(k => {
      const [method, path] = k.split(' ')
      return scopeAllows(API_SCOPES, method, concrete(path))
    })
    const missing = reachable.filter(k => !documented.has(k))
    expect(missing).toEqual([])
    expect(reachable.length).toBeGreaterThan(80)
  })

  it('every documented operation is opened by exactly the scope it announces', () => {
    for (const o of API_OPERATIONS) {
      const scope = requiredScope(o.method, o.path)
      expect(scope, `${o.method} ${o.path}`).not.toBeNull()
      expect(scopeAllows([scope!], o.method.toUpperCase(), concrete(o.path))).toBe(true)
      // Reading never needs a write scope, and the other way round.
      if (scope !== 'optimize') expect(scope!.endsWith(o.method === 'get' ? ':read' : ':write'), `${o.method} ${o.path} → ${scope}`).toBe(true)
    }
  })

  it('every scope offered in the admin opens at least one documented operation', () => {
    const used = new Set(API_OPERATIONS.map(o => requiredScope(o.method, o.path)))
    expect(API_SCOPES.filter(s => !used.has(s))).toEqual([])
  })

  it('does not document what no key may reach', () => {
    expect([...documented].some(k => k.includes('portal-users'))).toBe(false)
    for (const forbidden of ['/users', '/api-keys', '/settings', '/audit', '/webhook-endpoints', '/superadmin/tenants']) {
      expect([...documented].some(k => k.endsWith(` ${forbidden}`))).toBe(false)
    }
  })
})

describe('buildOpenApiSpec', () => {
  const spec = buildOpenApiSpec() as {
    openapi: string
    paths: Record<string, Record<string, { operationId: string; description: string; requestBody?: { content: { 'application/json': { schema: Record<string, unknown> } } }; parameters?: Array<{ name: string; in: string }> }>>
    webhooks: Record<string, unknown>
    components: { securitySchemes: { ApiKey: { name: string } } }
  }

  it('is an OpenAPI 3.1 document authenticated by X-API-Key', () => {
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.components.securitySchemes.ApiKey.name).toBe('X-API-Key')
  })

  it('gives each operation a unique id and its scope', () => {
    const ids = Object.values(spec.paths).flatMap(p => Object.values(p).map(o => o.operationId))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(API_OPERATIONS.length)
    expect(spec.paths['/invoices/{id}/issue'].post.description).toContain('invoices:write')
    expect(spec.paths['/missions'].get.description).toContain('missions:read')
  })

  it('takes request bodies from the schemas the routes validate with', () => {
    const payment = spec.paths['/payments'].post.requestBody!.content['application/json'].schema as { required: string[]; properties: Record<string, { enum?: string[] }> }
    expect(payment.required).toEqual(expect.arrayContaining(['clientId', 'amount', 'receivedAt']))
    expect(payment.properties.method.enum).toContain('TRANSFER')
    const mission = spec.paths['/missions'].post.requestBody!.content['application/json'].schema as { properties: Record<string, unknown> }
    expect(Object.keys(mission.properties)).toEqual(expect.arrayContaining(['type', 'date', 'address']))
    const plans = spec.paths['/plans'].post.requestBody!.content['application/json'].schema as { type: string }
    expect(plans.type).toBe('array')
  })

  it('declares path parameters for every templated path', () => {
    for (const [path, ops] of Object.entries(spec.paths)) {
      const names = [...path.matchAll(/\{([^}]+)\}/g)].map(m => m[1])
      for (const o of Object.values(ops)) {
        const declared = (o.parameters ?? []).filter(p => p.in === 'path').map(p => p.name)
        expect(declared, path).toEqual(names)
      }
    }
  })

  it('documents every outbound webhook event', () => {
    expect(Object.keys(spec.webhooks).sort()).toEqual([...BUSINESS_EVENTS].sort())
  })
})
