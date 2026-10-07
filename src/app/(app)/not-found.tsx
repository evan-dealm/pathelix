import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-surface-50 dark:bg-zinc-950 text-surface-900 dark:text-white">
      <div className="text-center space-y-4">
        <div className="text-7xl font-black text-surface-200 dark:text-zinc-800">404</div>
        <h1 className="text-xl font-bold">Page introuvable</h1>
        <p className="text-surface-500 dark:text-zinc-400 text-sm max-w-sm">
          La page que vous cherchez n&apos;existe pas ou a été déplacée.
        </p>
        <Link href="/admin"
          className="inline-block px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-sm font-semibold transition shadow-soft mt-2">
          Retour au dashboard
        </Link>
      </div>
    </div>
  )
}
