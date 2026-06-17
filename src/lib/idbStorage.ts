import { createStore, get, set, del } from 'idb-keyval'
import type { StateStorage } from 'zustand/middleware'
import { createLogger } from '@/lib/logger'

const log = createLogger('idbStorage')

const idbStore = typeof window !== 'undefined'
  ? createStore('pathelix-db', 'zustand-store')
  : null

export const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (!idbStore) return null

    try {

      const value = await get<string>(name, idbStore)
      if (value !== undefined) return value

      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          const lsValue = localStorage.getItem(name)
          if (lsValue) {

            await set(name, lsValue, idbStore)
            localStorage.removeItem(name)
            return lsValue
          }
        } catch {

        }
      }

      return null
    } catch (err) {
      log.warn('getItem failed, falling back to localStorage', { err: err instanceof Error ? err.message : String(err) })

      try { return localStorage.getItem(name) } catch { return null }
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (!idbStore) return

    try {
      await set(name, value, idbStore)
    } catch (err) {
      log.warn('setItem failed', { err: err instanceof Error ? err.message : String(err) })

      try { localStorage.setItem(name, value) } catch {  }
    }
  },

  removeItem: async (name: string): Promise<void> => {
    if (!idbStore) return

    try {
      await del(name, idbStore)
    } catch {

    }

    try { localStorage.removeItem(name) } catch {  }
  },
}
