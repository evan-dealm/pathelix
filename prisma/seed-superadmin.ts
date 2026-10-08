// ─── seed-superadmin.ts — Crée/met à jour le compte SuperAdmin ───────────────
// Ne touche pas aux données existantes (tenants clients, missions, etc.).
//
// Usage local :
//   npx tsx prisma/seed-superadmin.ts
//
// Usage Docker :
//   docker compose -f docker-compose.all.yml exec app \
//     sh -c "SUPERADMIN_EMAIL=xxx SUPERADMIN_PASSWORD=yyy npx tsx prisma/seed-superadmin.ts"
//
// Variables lues depuis l'environnement (ou .env / .env.local) :
//   SUPERADMIN_EMAIL    — requis
//   SUPERADMIN_PASSWORD — requis (12 caractères au moins, minuscules + majuscules + chiffres)
//
// Relancer la commande réinitialise le mot de passe, déconnecte les sessions ouvertes ET retire
// la double authentification : c'est la procédure de récupération quand le téléphone du
// superadmin est perdu (elle demande un accès à la base, donc au serveur).

import { PrismaClient } from '../src/generated/prisma'
import { PrismaPg }     from '@prisma/adapter-pg'
import { hash }          from 'bcryptjs'
import { config }        from 'dotenv'
import { PLATFORM_TENANT_SLUG, superadminPasswordIssue } from '../src/lib/superadminPolicy'

config({ path: '.env.local' })
config()

// ─── Validation ───────────────────────────────────────────────────────────────

// Stocké en minuscules : la connexion cherche l'email en minuscules.
const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase()
const pwd   = process.env.SUPERADMIN_PASSWORD

if (!email) {
  console.error('[seed-superadmin] SUPERADMIN_EMAIL est requis.')
  process.exit(1)
}
if (!pwd) {
  console.error('[seed-superadmin] SUPERADMIN_PASSWORD est requis.')
  process.exit(1)
}
const pwdIssue = superadminPasswordIssue(pwd)
if (pwdIssue) {
  console.error(`[seed-superadmin] SUPERADMIN_PASSWORD refusé : ${pwdIssue}.`)
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('[seed-superadmin] DATABASE_URL est requis.')
  process.exit(1)
}

// ─── Prisma ───────────────────────────────────────────────────────────────────

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma  = new PrismaClient({ adapter })

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔑 Seed SuperAdmin démarré')

  // ── Tenant admin-corp (slug identique à seed.ts pour cohérence) ────────────
  let tenant = await prisma.tenant.findUnique({ where: { slug: PLATFORM_TENANT_SLUG } })
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: 'Platform Admin', slug: PLATFORM_TENANT_SLUG, plan: 'ENTERPRISE' },
    })
    console.log(`  ✓ Tenant admin-corp créé (${tenant.id})`)
  } else {
    console.log(`  ✓ Tenant admin-corp existant (${tenant.id})`)
  }

  // ── SuperAdmin : upsert (create ou update si déjà en base) ────────────────
  const passwordHash = await hash(pwd!, 12)

  const existing = await prisma.user.findFirst({
    where: { email: email!, tenantId: tenant.id },
  })

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data:  { passwordHash, role: 'SUPERADMIN', sessionVersion: { increment: 1 } },
    })
    const { count } = await prisma.superadminTotp.deleteMany({ where: { userId: existing.id } })
    console.log(`  ✓ SuperAdmin mis à jour : ${email} (sessions ouvertes déconnectées)`)
    console.log("    Si l'application tourne, attendez 30 secondes avant de vous reconnecter.")
    if (count > 0) {
      console.log('  ⚠ Double authentification retirée : réactivez-la dans /superadmin → Sécurité.')
    }
  } else {
    await prisma.user.create({
      data: {
        tenantId:     tenant.id,
        email:        email!,
        passwordHash,
        role:         'SUPERADMIN',
        firstName:    'Admin',
        lastName:     'Platform',
      },
    })
    console.log(`  ✓ SuperAdmin créé : ${email}`)
  }

  console.log('')
  console.log('  ✅ Connexion : /login → redirige vers /superadmin')
  console.log(`     Email : ${email}`)
  console.log('     Pass  : (valeur de SUPERADMIN_PASSWORD)')
}

main()
  .catch(err => { console.error('❌ Erreur :', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
