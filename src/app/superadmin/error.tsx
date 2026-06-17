'use client'

export default function SuperAdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-zinc-950 text-white">
      <div className="flex flex-col items-center gap-5 max-w-md text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-red-900/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-bold">Erreur Super Admin</h2>
          <p className="text-zinc-400 text-sm mt-2">{error.message || 'Erreur inattendue'}</p>
          {error.digest && <p className="text-zinc-600 text-xs mt-1 font-mono">Ref: {error.digest}</p>}
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={reset}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-bold transition">
            Recharger
          </button>
          <button type="button" onClick={() => window.location.href = '/superadmin'}
            className="px-5 py-2.5 border border-zinc-700 text-zinc-300 rounded-xl text-sm font-medium transition hover:bg-zinc-800">
            Retour
          </button>
        </div>
      </div>
    </div>
  )
}
