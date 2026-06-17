'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {

            staleTime: 30_000,

            retry: 3,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),

            refetchOnWindowFocus: true,
          },
          mutations: {
            retry: 1,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
