import type { MissionStatus } from '@/lib/missionStatus'

/** What the mission is currently in, shown as a chip. */
export const STATUS_LABEL: Record<MissionStatus, string> = {
  todo:     'À faire',
  en_route: 'En route',
  arrived:  'Sur place',
  started:  'Manœuvre',
  doing:    'Finalisation',
  done:     'Terminée',
}

/** The button that moves the mission to its next step — named by what the driver does. */
export const NEXT_ACTION_LABEL: Record<Exclude<MissionStatus, 'done'>, string> = {
  todo:     'Démarrer le trajet',
  en_route: 'Je suis arrivé',
  arrived:  'Commencer la manœuvre',
  started:  'Manœuvre terminée',
  doing:    'Valider la mission',
}

export const INCIDENT_TYPES = [
  { value: 'acces',    label: 'Accès impossible' },
  { value: 'refus',    label: 'Refus du client' },
  { value: 'panne',    label: 'Panne du véhicule' },
  { value: 'accident', label: 'Accident' },
  { value: 'autre',    label: 'Autre problème' },
] as const

export type IncidentType = typeof INCIDENT_TYPES[number]['value']

export function minToHHMM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Directions in the phone's maps app: exact coordinates when known, else the address. */
export function navigationUrl(m: { latitude: number; longitude: number; address: string }): string {
  if (m.latitude !== 0 || m.longitude !== 0) {
    return `https://www.google.com/maps/dir/?api=1&destination=${m.latitude},${m.longitude}`
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.address)}`
}
