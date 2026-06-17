'use server'

import { cookies } from 'next/headers'
import { type Locale, locales, defaultLocale } from './config'

const LOCALE_COOKIE = 'NEXT_LOCALE'

export async function setLocale(locale: string): Promise<void> {
  const resolved: Locale = locales.includes(locale as Locale)
    ? (locale as Locale)
    : defaultLocale

  const cookieStore = await cookies()
  cookieStore.set(LOCALE_COOKIE, resolved, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
}
