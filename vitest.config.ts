import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {

    environment: 'node',

    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],

    exclude: ['node_modules', 'src/generated/**'],

    testTimeout: 30_000,

    pool: 'threads',
    poolOptions: {
      threads: {
        maxThreads: 8,
        minThreads: 1,
      },
    },

    coverage: {
      provider: 'v8',
      include: [
        'src/lib/**/*.ts',
        'src/services/**/*.ts',
        'src/app/api/**/route.ts',
        'src/stores/**/*.ts',
        'src/middleware.ts',
      ],
      exclude: [
        'src/lib/mockData.ts',
        'src/generated/**',
        'src/lib/data/index.ts',
        'src/app/api/**/_store.ts',
        'src/lib/vrp/types.ts',
        // External service clients and worker-thread infra (require real Valhalla/OSRM or Node worker_threads)
        'src/lib/vrp/threadPool.ts',
        'src/lib/vrp/osrmMatrix.ts',
        'src/lib/vrp/valhallaMatrix.ts',
        // Pure type definition files
        'src/lib/trackdechets/types.ts',
      ],
      reporter: ['text', 'html'],
      thresholds: {
        lines:      87,
        branches:   81,
        functions:  90,
        statements: 87,
      },
    },
  },
  resolve: {

    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
