import type { BsddCreateInput } from '../validators'

// Maps our domain input → Trackdéchets GraphQL FormInput.
// Isolated here to absorb TD API breaking changes without touching callers.
export function bsddInputToTdFormInput(input: BsddCreateInput): Record<string, unknown> {
  const { emitter, recipient, transporter, wasteDetails } = input

  return {
    emitter: {
      type:    emitter.type ?? 'PRODUCER',
      company: {
        siret:   emitter.company.siret,
        name:    emitter.company.name,
        address: emitter.company.address,
        contact: emitter.company.contact ?? '',
        phone:   emitter.company.phone   ?? '',
        mail:    emitter.company.mail    ?? '',
      },
      ...(emitter.workSite ? { workSite: emitter.workSite } : {}),
    },

    recipient: {
      processingOperation: recipient.processingOperation,
      company: {
        siret:   recipient.company.siret,
        name:    recipient.company.name,
        address: recipient.company.address,
        contact: recipient.company.contact ?? '',
        phone:   recipient.company.phone   ?? '',
        mail:    recipient.company.mail    ?? '',
      },
      ...(recipient.isTempStorage !== undefined
        ? { isTempStorage: recipient.isTempStorage }
        : {}),
    },

    wasteDetails: {
      code:           wasteDetails.code,
      name:           wasteDetails.name           ?? '',
      onuCode:        wasteDetails.onuCode        ?? '',
      quantity:       wasteDetails.quantity       ?? 0,
      quantityType:   wasteDetails.quantityType   ?? 'ESTIMATED',
      consistence:    wasteDetails.consistence    ?? 'SOLID',
      packagingInfos: wasteDetails.packagingInfos ?? [],
    },

    ...(transporter ? {
      transporter: {
        company: {
          siret:   transporter.company.siret,
          name:    transporter.company.name,
          address: transporter.company.address,
          contact: transporter.company.contact ?? '',
          phone:   transporter.company.phone   ?? '',
          mail:    transporter.company.mail    ?? '',
        },
        isExemptedOfReceipt: transporter.isExemptedOfReceipt ?? false,
        receipt:             transporter.receipt              ?? '',
        department:          transporter.department           ?? '',
        validityLimit:       transporter.validityLimit        ?? '',
        numberPlate:         transporter.numberPlate          ?? '',
      },
    } : {}),
  }
}
