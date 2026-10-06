import { hashInviteToken, newInviteToken } from './auth'
import { sendMail } from '@/lib/mailer'

export const INVITE_TTL_DAYS = 7

/** A fresh one-time link (invitation or password reset), valid 7 days. Only its hash is stored. */
export function makeInvite(): { token: string; hash: string; expiresAt: Date } {
  const token = newInviteToken()
  return { token, hash: hashInviteToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000) }
}

export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/portal/invite?token=${encodeURIComponent(token)}`
}

/** E-mails the link when SMTP is configured; the admin always gets the link to pass on. */
export async function sendInvite(email: string, url: string, company: string, clientName: string): Promise<boolean> {
  const r = await sendMail({
    to: email,
    subject: `Votre espace client ${company || ''}`.trim(),
    text: `Bonjour,\n\n${company || 'Votre prestataire'} vous ouvre un espace client pour ${clientName} : interventions, bennes sur site, documents, devis et factures.\n\nCréez votre mot de passe (lien valable ${INVITE_TTL_DAYS} jours) :\n${url}\n`,
  })
  return r.sent
}
