import { callTdGraphQL, TdApiError } from './client'
import { bsddInputToTdFormInput } from './mappers/bsdd'
import { decryptToken } from './crypto'
import { createLogger } from '@/lib/logger'
import type { BsddCreateInput, BsddSignInput } from './validators'
import type { TdFormResult } from './types'
import type { BsdStatus } from '@/generated/prisma'

const log = createLogger('trackdechets/bsdService')

// ─── GraphQL documents ────────────────────────────────────────────────────────

const SAVE_FORM_MUTATION = `
  mutation SaveForm($formInput: FormInput!) {
    saveForm(formInput: $formInput) {
      id
      status
      readableId
    }
  }
`

const MARK_SEALED_MUTATION = `
  mutation MarkAsSealed($id: ID!) {
    markAsSealed(id: $id) {
      id
      status
      readableId
    }
  }
`

const SIGNED_BY_PRODUCER_MUTATION = `
  mutation SignedByProducer($id: ID!, $signingInfo: TransporterSignatureFormInput!) {
    signedByProducer(id: $id, signingInfo: $signingInfo) {
      id
      status
    }
  }
`

const SIGNED_BY_TRANSPORTER_MUTATION = `
  mutation SignedByTransporter($id: ID!, $signingInfo: SignatureFormInput!) {
    signedByTransporter(id: $id, signingInfo: $signingInfo) {
      id
      status
    }
  }
`

const GET_FORM_QUERY = `
  query GetForm($id: ID!) {
    form(id: $id) {
      id
      status
      readableId
    }
  }
`

// ─── Status mapping ───────────────────────────────────────────────────────────

const TD_STATUS_MAP: Record<string, BsdStatus> = {
  DRAFT:                  'DRAFT',
  SEALED:                 'SEALED',
  SENT:                   'SENT',
  RECEIVED:               'RECEIVED',
  PROCESSED:              'PROCESSED',
  REFUSED:                'REFUSED',
  AWAITING_GROUP:         'AWAITING_GROUP',
  NO_TRACEABILITY:        'NO_TRACEABILITY',
  CANCELED:               'CANCELED',
  SIGNED_BY_PRODUCER:     'SIGNED_BY_PRODUCER',
  SIGNED_BY_TRANSPORTER:  'SIGNED_BY_TRANSPORTER',
  TEMP_STORED:            'TEMP_STORED',
  TEMP_STORER_ACCEPTED:   'TEMP_STORER_ACCEPTED',
  GROUPED:                'GROUPED',
  RESEALED:               'RESEALED',
  RESENT:                 'RESENT',
  INITIAL:                'INITIAL',
}

export function mapTdStatus(tdStatus: string): BsdStatus {
  return TD_STATUS_MAP[tdStatus] ?? 'DRAFT'
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function createBsddInTd(
  token: string,
  input: BsddCreateInput,
): Promise<TdFormResult> {
  const formInput = bsddInputToTdFormInput(input)
  const data = await callTdGraphQL<{ saveForm: TdFormResult }>(
    token, SAVE_FORM_MUTATION, { formInput },
  )
  log.info('BSDD created in TD', { tdId: data.saveForm.id })
  return data.saveForm
}

export async function sealBsddInTd(token: string, tdId: string): Promise<TdFormResult> {
  const data = await callTdGraphQL<{ markAsSealed: TdFormResult }>(
    token, MARK_SEALED_MUTATION, { id: tdId },
  )
  log.info('BSDD sealed in TD', { tdId })
  return data.markAsSealed
}

export async function signBsddInTd(
  token: string,
  tdId:  string,
  input: BsddSignInput,
): Promise<TdFormResult> {
  const date = input.signatureDate ?? new Date().toISOString()

  if (input.signatureType === 'PRODUCER') {
    const data = await callTdGraphQL<{ signedByProducer: TdFormResult }>(
      token, SIGNED_BY_PRODUCER_MUTATION,
      { id: tdId, signingInfo: { sentAt: date, sentBy: input.signatureAuthor } },
    )
    log.info('BSDD signed by producer', { tdId })
    return data.signedByProducer
  }

  const data = await callTdGraphQL<{ signedByTransporter: TdFormResult }>(
    token, SIGNED_BY_TRANSPORTER_MUTATION,
    { id: tdId, signingInfo: { signedAt: date, signedBy: input.signatureAuthor } },
  )
  log.info('BSDD signed by transporter', { tdId })
  return data.signedByTransporter
}

export async function fetchBsddStatusFromTd(token: string, tdId: string): Promise<TdFormResult> {
  const data = await callTdGraphQL<{ form: TdFormResult }>(
    token, GET_FORM_QUERY, { id: tdId },
  )
  return data.form
}

// ─── Stage-specific pre-flight validators ─────────────────────────────────────

/**
 * Fields required before TD will accept signedByProducer (which also seals the form).
 * Returns human-readable field paths for each missing/empty required field.
 */
export function validatePayloadForProducerSign(payload: unknown): string[] {
  const errors: string[] = []
  const p  = payload as Record<string, unknown> | null
  const wd = (p?.wasteDetails ?? {}) as Record<string, unknown>

  if (!wd.name || String(wd.name).trim() === '') {
    errors.push('wasteDetails.name — nom commercial du déchet requis à la signature producteur')
  }
  if (wd.quantity === undefined || wd.quantity === null) {
    errors.push('wasteDetails.quantity — quantité requise à la signature producteur')
  }
  return errors
}

/**
 * Fields required before TD will accept signedByTransporter.
 */
export function validatePayloadForTransporterSign(payload: unknown): string[] {
  const errors: string[] = []
  const p  = payload as Record<string, unknown> | null
  const tr = (p?.transporter ?? null) as Record<string, unknown> | null

  if (!tr) {
    errors.push('transporter — bloc transporteur requis pour la signature transporteur')
    return errors
  }
  if (!tr.receipt || String(tr.receipt).trim() === '') {
    errors.push('transporter.receipt — récépissé transporteur requis')
  }
  if (!tr.department || String(tr.department).trim() === '') {
    errors.push('transporter.department — département transporteur requis')
  }
  if (!tr.validityLimit || String(tr.validityLimit).trim() === '') {
    errors.push('transporter.validityLimit — date de validité du récépissé requise')
  }
  return errors
}

export function getTokenFromAccount(account: {
  encryptedToken: string
  iv:             string
  keyVersion:     number
}): string {
  return decryptToken({
    encryptedToken: account.encryptedToken,
    iv:             account.iv,
    keyVersion:     account.keyVersion,
  })
}

export { TdApiError }
