type CacheEntry<T> = { data: T; expiresAt: number; promise?: Promise<T> }

const cache = new Map<string, CacheEntry<unknown>>()

export async function cachedFetch<T>(
  url: string,
  ttlMs: number = 30_000,
  options?: RequestInit,
): Promise<T> {
  const now = Date.now()
  const entry = cache.get(url) as CacheEntry<T> | undefined

  if (entry && entry.expiresAt > now) return entry.data

  if (entry?.promise) return entry.promise

  const promise = fetch(url, options).then(r => {
    if (!r.ok) throw new Error(`${r.status} ${url}`)
    return r.json() as Promise<T>
  }).then(data => {
    cache.set(url, { data, expiresAt: Date.now() + ttlMs })
    return data
  }).catch(err => {
    cache.delete(url)
    throw err
  })

  cache.set(url, { data: undefined as unknown as T, expiresAt: 0, promise })
  return promise
}

export function invalidateClientCache(url: string) {
  cache.delete(url)
}

export function invalidateClientCachePattern(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}
