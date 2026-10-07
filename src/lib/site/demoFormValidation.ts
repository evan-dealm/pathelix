/**
 * Checks the demo form runs in the browser before submitting. Kept free of Zod so the website
 * does not ship it; the server enforces DemoRequestSchema (demoRequest.ts) and a test keeps the
 * two in agreement.
 */
export type DemoFormField = 'firstName' | 'lastName' | 'company' | 'email'
export type DemoFormErrors = Partial<Record<DemoFormField, string>>

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/

export function validateDemoForm(values: Record<string, string | undefined>): DemoFormErrors {
  const errors: DemoFormErrors = {}
  if (!values.firstName?.trim()) errors.firstName = 'Indiquez votre prénom'
  if (!values.lastName?.trim()) errors.lastName = 'Indiquez votre nom'
  if (!values.company?.trim()) errors.company = 'Indiquez votre entreprise'
  const email = values.email?.trim() ?? ''
  if (!email) errors.email = 'Indiquez votre e-mail'
  else if (!EMAIL_RE.test(email)) errors.email = 'Adresse e-mail invalide'
  return errors
}
