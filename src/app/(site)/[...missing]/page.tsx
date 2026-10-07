import { notFound } from 'next/navigation'

/**
 * The website and the application have separate root layouts, so there is no app-wide 404 page:
 * any address that matches no route lands here and gets the website's own (not-found.tsx).
 */
export default function Missing(): never {
  notFound()
}
