/**
 * Client-side helpers for calling Pathélix API routes from the UI.
 *
 * Routes answer errors as `{ error: string }` or, for Zod validation failures,
 * `{ error: { formErrors: string[], fieldErrors: Record<string, string[]> } }`. Rendering the
 * second shape directly showed "[object Object]" or crashed React — always go through
 * `apiErrorMessage()`.
 */

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string }

const FIELD_LABELS: Record<string, string> = {
  password: 'Mot de passe', email: 'Email', firstName: 'Prénom', lastName: 'Nom', role: 'Rôle',
  licensePlate: 'Immatriculation', type: 'Type', date: 'Date', address: 'Adresse', cost: 'Coût',
}

export function apiErrorMessage(body: unknown, status: number): string {
  const err = (body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined)
  if (typeof err === 'string' && err) return err
  if (err && typeof err === 'object') {
    const { formErrors, fieldErrors } = err as { formErrors?: unknown; fieldErrors?: Record<string, unknown> }
    const parts: string[] = []
    if (Array.isArray(formErrors)) parts.push(...formErrors.filter((m): m is string => typeof m === 'string'))
    if (fieldErrors && typeof fieldErrors === 'object') {
      for (const [field, msgs] of Object.entries(fieldErrors)) {
        if (Array.isArray(msgs) && msgs.length > 0) parts.push(`${FIELD_LABELS[field] ?? field} : ${String(msgs[0])}`)
      }
    }
    if (parts.length > 0) return parts.join(' · ')
  }
  if (status === 401) return 'Session expirée — reconnectez-vous.'
  if (status === 403) return 'Vous n’avez pas la permission de faire cette action.'
  if (status === 404) return 'Élément introuvable (déjà supprimé ?).'
  if (status === 409) return 'Conflit : cet élément existe déjà ou a été modifié entre-temps.'
  if (status === 429) return 'Trop de requêtes — réessayez dans un instant.'
  if (status >= 500) return 'Erreur serveur — réessayez dans un instant.'
  return `Requête refusée (${status})`
}

/** fetch() + JSON, never throws: network failures come back as `{ ok: false, status: 0 }`. */
export async function apiRequest<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<ApiResult<T>> {
  const { json, headers, ...rest } = init
  let res: Response
  try {
    res = await fetch(url, {
      ...rest,
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  } catch {
    return { ok: false, status: 0, error: 'Réseau indisponible — réessayez.' }
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) return { ok: false, status: res.status, error: apiErrorMessage(body, res.status) }
  return { ok: true, status: res.status, data: body as T }
}

/**
 * Loads every page of a paginated list route (`{ data: T[], pagination: { pages } }`).
 * List routes cap `limit`; asking for `limit=5000` silently returned only the first page.
 */
export async function fetchAllPages<T>(url: string, pageSize = 100, maxPages = 200): Promise<T[]> {
  const sep = url.includes('?') ? '&' : '?'
  const all: T[] = []
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${url}${sep}page=${page}&limit=${pageSize}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(apiErrorMessage(await res.json().catch(() => null), res.status))
    const body = await res.json() as { data?: T[]; pagination?: { pages?: number } } | T[]
    if (Array.isArray(body)) return body // non-paginated route
    all.push(...(body.data ?? []))
    if (!body.pagination || page >= (body.pagination.pages ?? 1)) break
  }
  return all
}
