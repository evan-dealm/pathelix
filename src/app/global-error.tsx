'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body className="bg-gray-950 text-white flex items-center justify-center min-h-screen">
        <div className="text-center p-8">
          <h2 className="text-2xl font-bold mb-4">Une erreur est survenue</h2>
          <p className="text-gray-400 mb-6">{error.message || 'Erreur inattendue'}</p>
          <button
            onClick={reset}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  )
}
