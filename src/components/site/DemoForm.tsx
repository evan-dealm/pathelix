'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { CONTACT_EMAIL, FLEET_SIZES, FLEET_SIZE_LABELS } from '@/lib/site/config'

type FieldName = 'firstName' | 'lastName' | 'company' | 'email' | 'phone' | 'fleetSize' | 'message'
type Errors = Partial<Record<FieldName, string>>
const EMAIL_RE = /^[^s@<>"']+@[^s@<>"']+.[^s@<>"']+$/

/** Same rules as DemoRequestSchema (src/lib/site/demoRequest.ts), which the server enforces. */
function validate(values: Record<string, string>): Errors {
  const errors: Errors = {}
  if (!values.firstName) errors.firstName = 'Indiquez votre prénom'
  if (!values.lastName) errors.lastName = 'Indiquez votre nom'
  if (!values.company) errors.company = 'Indiquez votre entreprise'
  if (!values.email) errors.email = 'Indiquez votre e-mail'
  else if (!EMAIL_RE.test(values.email)) errors.email = 'Adresse e-mail invalide'
  return errors
}

type Status =
  { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'failed'; message: string }

const inputClass =
  'block w-full rounded border border-ink/20 bg-paper px-3.5 py-3 text-base text-ink transition-colors duration-150 placeholder:text-graphite/70 hover:border-ink/45 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent aria-[invalid=true]:border-[#B42318]'

/**
 * Demo request form. The request is really stored and/or e-mailed by POST /api/demo-requests;
 * « Demande envoyée » only appears when the server confirms it. Any failure says so and gives
 * the e-mail address instead.
 */
export function DemoForm() {
  const [errors, setErrors] = useState<Errors>({})
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const confirmationRef = useRef<HTMLDivElement>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const values: Record<string, string> = {}
    new FormData(form).forEach((value, key) => {
      if (typeof value === 'string') values[key] = value.trim()
    })
    const next = validate(values)
    if (Object.keys(next).length > 0) {
      setErrors(next)
      form.querySelector<HTMLElement>(`[name="${Object.keys(next)[0]}"]`)?.focus()
      return
    }
    setErrors({})
    setStatus({ kind: 'sending' })
    try {
      const res = await fetch('/api/demo-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null)
        const message =
          body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error
            : `La demande n’a pas pu être envoyée. Écrivez-nous à ${CONTACT_EMAIL}.`
        setStatus({ kind: 'failed', message })
        return
      }
      setStatus({ kind: 'sent' })
      requestAnimationFrame(() => confirmationRef.current?.focus())
    } catch {
      setStatus({
        kind: 'failed',
        message: `Connexion interrompue : la demande n’est pas partie. Réessayez, ou écrivez-nous à ${CONTACT_EMAIL}.`,
      })
    }
  }

  if (status.kind === 'sent') {
    return (
      <div
        ref={confirmationRef}
        tabIndex={-1}
        className="border-t border-ink pt-8 outline-none"
        role="status"
      >
        <h2 className="t-h2 !text-[clamp(1.75rem,1.3rem+1.8vw,2.5rem)]">Demande envoyée.</h2>
        <p className="t-lead mt-5 max-w-[30rem] text-graphite">
          Nous revenons vers vous à l’adresse indiquée pour convenir d’un créneau de démonstration.
        </p>
        <p className="mt-8">
          <Link href="/produit" className="link text-[0.9375rem]">
            En attendant, parcourir le produit
          </Link>
        </p>
      </div>
    )
  }

  const field = (name: FieldName) => ({
    id: `demo-${name}`,
    name,
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `demo-${name}-error` : undefined,
  })

  const error = (name: FieldName) =>
    errors[name] ? (
      <p id={`demo-${name}-error`} className="t-small mt-1.5 text-[#B42318]">
        {errors[name]}
      </p>
    ) : null

  const label = 'mb-1.5 block text-[0.9375rem] font-medium tracking-[-0.01em]'

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5 sm:grid-cols-2">
      <div>
        <label htmlFor="demo-firstName" className={label}>
          Prénom
        </label>
        <input
          {...field('firstName')}
          type="text"
          autoComplete="given-name"
          required
          className={inputClass}
        />
        {error('firstName')}
      </div>
      <div>
        <label htmlFor="demo-lastName" className={label}>
          Nom
        </label>
        <input
          {...field('lastName')}
          type="text"
          autoComplete="family-name"
          required
          className={inputClass}
        />
        {error('lastName')}
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="demo-company" className={label}>
          Entreprise
        </label>
        <input
          {...field('company')}
          type="text"
          autoComplete="organization"
          required
          className={inputClass}
        />
        {error('company')}
      </div>
      <div>
        <label htmlFor="demo-email" className={label}>
          E-mail professionnel
        </label>
        <input
          {...field('email')}
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          className={inputClass}
        />
        {error('email')}
      </div>
      <div>
        <label htmlFor="demo-phone" className={label}>
          Téléphone <span className="font-normal text-graphite">(facultatif)</span>
        </label>
        <input
          {...field('phone')}
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          className={inputClass}
        />
        {error('phone')}
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="demo-fleetSize" className={label}>
          Taille de l’exploitation <span className="font-normal text-graphite">(facultatif)</span>
        </label>
        <select {...field('fleetSize')} defaultValue="" className={inputClass}>
          <option value="">Non précisé</option>
          {FLEET_SIZES.map(size => (
            <option key={size} value={size}>
              {FLEET_SIZE_LABELS[size]}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="demo-message" className={label}>
          Votre activité, vos outils actuels{' '}
          <span className="font-normal text-graphite">(facultatif)</span>
        </label>
        <textarea
          {...field('message')}
          rows={4}
          maxLength={2000}
          className={`${inputClass} resize-y`}
        />
        {error('message')}
      </div>

      {/* Honeypot: invisible to people and to assistive technology. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="demo-website">Site web</label>
        <input id="demo-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="sm:col-span-2">
        <div aria-live="polite">
          {status.kind === 'failed' && (
            <p className="mb-4 border-l-2 border-[#B42318] pl-3 text-[0.9375rem] text-[#B42318]">
              {status.message}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={status.kind === 'sending'}
          className="btn btn-primary w-full disabled:opacity-60 sm:w-auto"
        >
          {status.kind === 'sending' ? 'Envoi en cours…' : 'Envoyer la demande'}
        </button>
        <p className="t-small mt-4 max-w-[34rem] text-graphite">
          Ces informations servent uniquement à répondre à votre demande.{' '}
          <Link href="/confidentialite" className="underline underline-offset-2 hover:text-ink">
            Politique de confidentialité
          </Link>
        </p>
      </div>
    </form>
  )
}
