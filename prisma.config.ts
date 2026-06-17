import { defineConfig } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://pathelix:pathelix_local_secret@localhost:5432/pathelix_fleet',
  },
})
