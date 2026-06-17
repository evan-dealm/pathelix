import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { defaultLocale, type Locale, locales } from './config'

const LOCALE_COOKIE = 'NEXT_LOCALE'

export default getRequestConfig(async () => {

  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value

  const headerStore = await headers()
  const acceptLang = headerStore.get('accept-language') ?? ''
  const headerLocale = acceptLang
    .split(',')
    .map(part => part.split(';')[0].trim().split('-')[0])
    .find(lang => locales.includes(lang as Locale))

  const resolved = cookieLocale && locales.includes(cookieLocale as Locale)
    ? cookieLocale
    : headerLocale ?? defaultLocale

  return {
    locale: resolved,
    messages: (await import(`../messages/${resolved}.json`)).default,
  }
})
