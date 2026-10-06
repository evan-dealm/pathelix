/**
 * Validation of a bin scanned by a driver on a mission — shared by the server (authoritative) and
 * the driver app (immediate answer, offline). The goal is to stop the classic field mistakes:
 * wrong bin, wrong size, wrong customer, bin promised to another job.
 */

export type ScanRole = 'place' | 'collect'

export interface ScanMission {
  id:                    string
  type:                  string
  containerTypeId?:      string | null
  binSizeM3?:            number | null
  placedContainerId?:    string | null
  collectedContainerId?: string | null
  siteId?:               string | null
  clientId?:             string | null
}

export interface ScannedContainer {
  id:         string
  number:     string
  typeId:     string
  typeName?:  string
  capacityM3: number
  status:     string
  siteId?:    string | null
  clientId?:  string | null
  missionId?: string | null
  driverId?:  string | null
}

export type ScanErrorCode =
  | 'NOT_FOR_THIS_MISSION' | 'WRONG_CONTAINER' | 'WRONG_TYPE' | 'WRONG_SIZE'
  | 'WRONG_SITE' | 'NOT_AVAILABLE' | 'RESERVED_ELSEWHERE' | 'OUT_OF_SERVICE'

export type ScanResult = { ok: true } | { ok: false; code: ScanErrorCode; message: string }

const PLACE_TYPES = new Set(['POSER', 'ECHANGER', 'DEPLACER'])
const COLLECT_TYPES = new Set(['RETIRER', 'ECHANGER', 'ALLER_RETOUR', 'CHARGER_IMMEDIAT', 'DEPLACER'])
const OUT = new Set(['MAINTENANCE', 'IMMOBILIZED', 'LOST', 'ARCHIVED'])

/** Role implied by the mission when the driver does not choose (ECHANGER/DEPLACER need a choice). */
export function defaultScanRole(missionType: string): ScanRole | null {
  if (missionType === 'POSER') return 'place'
  if (missionType === 'RETIRER' || missionType === 'ALLER_RETOUR' || missionType === 'CHARGER_IMMEDIAT') return 'collect'
  return null
}

export function validateScan(m: ScanMission, c: ScannedContainer, role: ScanRole, driverId: string): ScanResult {
  if (OUT.has(c.status)) return { ok: false, code: 'OUT_OF_SERVICE', message: `La benne ${c.number} est déclarée hors service — ne pas l'utiliser` }
  if (role === 'place') {
    if (!PLACE_TYPES.has(m.type)) return { ok: false, code: 'NOT_FOR_THIS_MISSION', message: 'Cette mission ne pose pas de benne' }
    if (m.placedContainerId && m.placedContainerId !== c.id) {
      return { ok: false, code: 'WRONG_CONTAINER', message: `Ce n'est pas la benne prévue pour cette pose (scannée : ${c.number})` }
    }
    if (m.containerTypeId && m.containerTypeId !== c.typeId) {
      return { ok: false, code: 'WRONG_TYPE', message: `Mauvais type de benne : ${c.typeName ?? c.number} au lieu du type commandé` }
    }
    if (m.binSizeM3 && Math.abs(m.binSizeM3 - c.capacityM3) > 0.01) {
      return { ok: false, code: 'WRONG_SIZE', message: `Mauvaise taille : ${c.capacityM3} m³ au lieu de ${m.binSizeM3} m³` }
    }
    if (c.status === 'RESERVED' && c.missionId && c.missionId !== m.id) {
      return { ok: false, code: 'RESERVED_ELSEWHERE', message: `La benne ${c.number} est réservée pour une autre intervention` }
    }
    const usable = c.status === 'AVAILABLE' || c.status === 'RESERVED' || (c.status === 'IN_TRANSIT' && c.driverId === driverId)
    if (!usable) return { ok: false, code: 'NOT_AVAILABLE', message: `La benne ${c.number} n'est pas disponible (elle n'est pas au dépôt ni dans votre camion)` }
    return { ok: true }
  }
  if (!COLLECT_TYPES.has(m.type)) return { ok: false, code: 'NOT_FOR_THIS_MISSION', message: 'Cette mission ne retire pas de benne' }
  if (m.collectedContainerId && m.collectedContainerId !== c.id) {
    return { ok: false, code: 'WRONG_CONTAINER', message: `Ce n'est pas la benne à retirer (scannée : ${c.number})` }
  }
  // Refused only when the bin is recorded at ANOTHER customer: a bin with no recorded location
  // (inventory not done yet) is accepted and its history corrected by the pickup itself.
  const recordedElsewhere = m.siteId && c.siteId
    ? c.siteId !== m.siteId
    : !!(m.clientId && c.clientId && c.clientId !== m.clientId)
  if (recordedElsewhere) {
    return { ok: false, code: 'WRONG_SITE', message: `La benne ${c.number} est enregistrée chez un autre client` }
  }
  return { ok: true }
}

/** What a scanned QR code or a typed code contains: our URL (…/c/<token>), a bare token, or a fleet number. */
export function parseScannedCode(raw: string): { token?: string; number?: string } {
  const s = raw.trim()
  const url = /\/c\/([A-Za-z0-9_-]{16,64})(?:[/?#].*)?$/.exec(s)
  if (url) return { token: url[1] }
  if (/^[A-Za-z0-9_-]{22}$/.test(s) && /[a-z]/.test(s) && /[A-Z0-9]/.test(s)) return { token: s }
  return { number: s.toUpperCase() }
}
