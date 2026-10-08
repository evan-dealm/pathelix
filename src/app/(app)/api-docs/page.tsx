'use client'

import { createElement, useEffect, useRef } from 'react'

export default function ApiDocsPage() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let destroy: (() => void) | undefined

    async function init() {
      const SwaggerUI = (await import('swagger-ui-react')).default
      // @ts-ignore — CSS module lacks type declarations
      await import('swagger-ui-react/swagger-ui.css')
      const { createRoot } = await import('react-dom/client')
      if (!ref.current) return
      const root = createRoot(ref.current)
      // Rendered as an element: calling the component as a function runs its hooks outside React
      // (error #321) and left this page blank.
      root.render(createElement(SwaggerUI, { url: '/api/docs', docExpansion: 'list', deepLinking: true }))
      destroy = () => root.unmount()
    }
    init()
    return () => destroy?.()
  }, [])

  return (
    <div className="relative z-10 min-h-screen bg-white">
      <div className="bg-[#0055A4] text-white px-6 py-4 flex items-center gap-3">
        <div className="text-2xl font-black tracking-tight">Pathélix</div>
        <div className="text-sm text-blue-200">API Documentation</div>
      </div>
      <div ref={ref} className="swagger-ui-container" />
    </div>
  )
}
