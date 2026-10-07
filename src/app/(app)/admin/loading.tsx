export default function AdminLoading() {
  return (
    <div className="min-h-screen bg-surface-50 dark:bg-zinc-950">
      {}
      <div className="h-14 bg-white dark:bg-zinc-900 border-b border-surface-200 dark:border-zinc-800 flex items-center px-6 gap-4">
        <div className="skeleton w-8 h-8 rounded-lg" />
        <div className="skeleton w-32 h-4 rounded" />
        <div className="flex-1" />
        <div className="skeleton w-48 h-8 rounded-lg" />
      </div>
      {}
      <div className="flex">
        {}
        <div className="hidden md:block w-16 bg-white dark:bg-zinc-900 border-r border-surface-200 dark:border-zinc-800 min-h-screen pt-4 space-y-4 px-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton w-10 h-10 rounded-xl" />
          ))}
        </div>
        {}
        <div className="flex-1 p-6 space-y-4">
          <div className="skeleton w-64 h-6 rounded" />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-24 rounded-2xl" />
            ))}
          </div>
          <div className="skeleton h-64 rounded-2xl" />
        </div>
      </div>
    </div>
  )
}
