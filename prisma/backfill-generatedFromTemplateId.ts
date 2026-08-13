// ─── Backfill runner — Mission.generatedFromTemplateId (A5, AUDIT_BUGS.md N18) ─
// Thin DB-wiring layer around the pure matching logic in src/lib/recurringTemplateBackfill.ts.
// Run: npm run db:backfill-template-links

import { PrismaClient } from '../src/generated/prisma'
import { PrismaPg }     from '@prisma/adapter-pg'
import { config } from 'dotenv'
config({ path: '.env.local' })
config()

import { computeTemplateMatches } from '../src/lib/recurringTemplateBackfill'

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pathelix',
})
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🔗 Backfill Mission.generatedFromTemplateId démarré')

  const templates = await prisma.missionTemplate.findMany()
  const candidateMissions = await prisma.mission.findMany({
    where: { generatedFromTemplateId: null },
    select: { id: true, tenantId: true, date: true, address: true, type: true, clientName: true },
  })

  console.log(`  ${templates.length} templates, ${candidateMissions.length} missions sans lien à examiner`)

  const { assignments, ambiguous, unmatched } = computeTemplateMatches(
    templates,
    candidateMissions,
    (templateId, err) => console.warn(`  Template ${templateId} — règle de récurrence invalide, ignoré:`, err instanceof Error ? err.message : err),
  )

  for (const [missionId, templateId] of assignments) {
    await prisma.mission.update({
      where: { id: missionId },
      data:  { generatedFromTemplateId: templateId },
    })
  }

  console.log(`✅ Backfill terminé — liées: ${assignments.size}, ambiguës (laissées null): ${ambiguous}, sans candidat: ${unmatched}`)
}

main()
  .catch(err => { console.error('❌ Backfill échoué:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
