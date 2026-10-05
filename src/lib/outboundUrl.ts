import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Guard for server-side requests to URLs supplied by a tenant (integration tests, Slack/Teams/
 * custom webhooks, ERP base URLs). Without it, any admin — or anyone able to edit an integration
 * — can make the server reach internal services (cloud metadata, Redis, Postgres, the Valhalla
 * admin API…) and read back status codes or bodies (SSRF).
 *
 * - only http(s), no credentials in the URL;
 * - the host is resolved and EVERY resulting address must be public (IPv4 + IPv6, including
 *   IPv4-mapped IPv6, link-local, CGNAT, ULA…);
 * - self-hosted services that are legitimately internal (e.g. `osrm`, `valhalla` on the Docker
 *   network) must be listed explicitly in OUTBOUND_ALLOWED_HOSTS (comma-separated hostnames);
 * - redirects are not followed by safeFetch, so a public URL can't bounce to an internal one.
 *
 * Residual risk: DNS rebinding between this check and the connection. Acceptable for these
 * admin-configured endpoints; a connect-time pinned lookup would close it entirely.
 */

export class BlockedUrlError extends Error {
  constructor(message: string) { super(message); this.name = 'BlockedUrlError' }
}

function allowedHosts(): Set<string> {
  return new Set((process.env.OUTBOUND_ALLOWED_HOSTS ?? '')
    .split(',').map(h => h.trim().toLowerCase()).filter(Boolean))
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0
}

const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) {
    const n = ipv4ToInt(ip)
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
      return (n & mask) === (ipv4ToInt(base) & mask)
    })
  }
  if (kind === 6) {
    const lower = ip.toLowerCase()
    const mapped = lower.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    // Same mapping written in hex (as URL parsing normalises it): ::ffff:7f00:1 = 127.0.0.1
    const mappedHex = lower.match(/^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16)
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
    }
    if (lower === '::' || lower === '::1') return true
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower.replace(/^0+/, '')) || lower.startsWith('64:ff9b:')
  }
  return true
}

/** Throws BlockedUrlError unless `raw` is an http(s) URL resolving only to public addresses. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try { url = new URL(raw) } catch { throw new BlockedUrlError('URL invalide') }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BlockedUrlError('Seuls http et https sont autorisés')
  if (url.username || url.password) throw new BlockedUrlError('Identifiants interdits dans l\'URL')

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (allowedHosts().has(host)) return url

  let addresses: string[]
  if (isIP(host)) {
    addresses = [host]
  } else {
    try {
      addresses = (await lookup(host, { all: true })).map(a => a.address)
    } catch {
      throw new BlockedUrlError('Nom d\'hôte introuvable')
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new BlockedUrlError('Adresse interne non autorisée')
  }
  return url
}

/** fetch() to a tenant-supplied URL: public-address check, no redirects, hard timeout. */
export async function safeFetch(raw: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const url = await assertPublicUrl(raw)
  const { timeoutMs = 10_000, ...rest } = init
  return fetch(url, { ...rest, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
}
