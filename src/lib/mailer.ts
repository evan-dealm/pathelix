import { createLogger } from '@/lib/logger'

const log = createLogger('mailer')

export interface MailAttachment { filename: string; content: Buffer; contentType: string }
export interface MailMessage {
  to:          string | string[]
  subject:     string
  text:        string
  html?:       string
  replyTo?:    string
  attachments?: MailAttachment[]
}
export type MailResult = { sent: true } | { sent: false; reason: 'NOT_CONFIGURED' | 'INVALID_RECIPIENT' | 'FAILED'; detail?: string }

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/

/** Outgoing e-mail is configured (SMTP_URL + MAIL_FROM). Without it, features say so instead of pretending. */
export function mailConfigured(): boolean {
  return !!process.env.SMTP_URL && !!process.env.MAIL_FROM
}

type Transport = { sendMail(_m: Record<string, unknown>): Promise<unknown> }
const _g = globalThis as typeof globalThis & { __pathelixMailer?: Promise<Transport> }

async function transport(): Promise<Transport> {
  if (!_g.__pathelixMailer) {
    _g.__pathelixMailer = import('nodemailer').then(nm => nm.default.createTransport(process.env.SMTP_URL!, {
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    }) as unknown as Transport)
  }
  return _g.__pathelixMailer
}

/**
 * Sends one e-mail through the configured SMTP server. Never throws: the caller tells the user
 * what happened (not configured, refused address, server error).
 */
export async function sendMail(m: MailMessage): Promise<MailResult> {
  if (!mailConfigured()) return { sent: false, reason: 'NOT_CONFIGURED' }
  const to = (Array.isArray(m.to) ? m.to : [m.to]).map(s => s.trim()).filter(Boolean)
  if (to.length === 0 || !to.every(a => EMAIL_RE.test(a))) return { sent: false, reason: 'INVALID_RECIPIENT' }
  try {
    await (await transport()).sendMail({
      from: process.env.MAIL_FROM, to, subject: m.subject.replace(/[\r\n]+/g, ' ').slice(0, 250),
      text: m.text, html: m.html, replyTo: m.replyTo, attachments: m.attachments,
    })
    log.info('Mail sent', { recipients: to.length, domains: [...new Set(to.map(a => a.split('@')[1]))] })
    return { sent: true }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    log.error('Mail failed', { err: detail })
    return { sent: false, reason: 'FAILED', detail }
  }
}

export function mailFailureMessage(r: Exclude<MailResult, { sent: true }>): string {
  switch (r.reason) {
    case 'NOT_CONFIGURED': return 'L\'envoi d\'e-mails n\'est pas configuré (SMTP) : téléchargez le document et envoyez-le vous-même.'
    case 'INVALID_RECIPIENT': return 'Adresse e-mail du destinataire absente ou invalide.'
    case 'FAILED': return 'Le serveur d\'e-mail a refusé l\'envoi — réessayez ou envoyez le document vous-même.'
  }
}
