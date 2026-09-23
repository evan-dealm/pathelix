'use client'

import { ReactNode } from 'react'
import { hasPerm } from '@/hooks/usePermissions'

export const PERMISSION_LABELS: Record<string, string> = {
  optimize:            'Lancer une optimisation VRP',
  manage_drivers:      'Gérer les chauffeurs',
  manage_exutoires:    'Gérer les exutoires',
  manage_missions:     'Gérer les missions',
  manage_vehicles:     'Gérer les véhicules',
  manage_users:        'Gérer les utilisateurs',
  view_reports:        'Voir les rapports',
  view_costs:          'Voir les coûts',
  manage_settings:     'Gérer les paramètres',
  api_access:          'Accès API',
  manage_integrations: 'Gérer les intégrations',
}

/**
 * Computes whether the current user holds `permission` and, if not, an explanatory tooltip —
 * mirrors the manual disabled+title pattern already used for ToursTab's "Optimiser" button, so
 * every other permission-gated control doesn't have to re-derive its own tooltip text.
 * `permissions` comes from a single `usePermissions()` call made once per page (not re-fetched
 * per gate).
 */
export function PermissionGate({ permissions, permission, children }: {
  permissions: Set<string>
  permission:  string
  children:    (_allowed: boolean, _title: string | undefined) => ReactNode
}) {
  const allowed = hasPerm(permissions, permission)
  const title = allowed ? undefined : `Permission "${PERMISSION_LABELS[permission] ?? permission}" requise`
  return <>{children(allowed, title)}</>
}
