export default function SuperAdminLoading() {
  return (
    <div className="min-h-screen bg-zinc-950">
      {}
      <div className="h-14 bg-zinc-900 border-b border-zinc-800 flex items-center px-6 gap-4">
        <div className="skeleton w-8 h-8 rounded-lg" style={{ '--skeleton-from': '#27272a', '--skeleton-via': '#3f3f46' } as React.CSSProperties} />
        <div className="skeleton w-40 h-4 rounded" style={{ '--skeleton-from': '#27272a', '--skeleton-via': '#3f3f46' } as React.CSSProperties} />
      </div>
      {}
      <div className="h-12 bg-zinc-900/50 border-b border-zinc-800 flex items-center px-6 gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="skeleton w-24 h-6 rounded" style={{ '--skeleton-from': '#27272a', '--skeleton-via': '#3f3f46' } as React.CSSProperties} />
        ))}
      </div>
      {}
      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-4">
        <div className="grid grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-20 rounded-xl" style={{ '--skeleton-from': '#27272a', '--skeleton-via': '#3f3f46' } as React.CSSProperties} />
          ))}
        </div>
        <div className="skeleton h-48 rounded-xl" style={{ '--skeleton-from': '#27272a', '--skeleton-via': '#3f3f46' } as React.CSSProperties} />
      </div>
    </div>
  )
}
