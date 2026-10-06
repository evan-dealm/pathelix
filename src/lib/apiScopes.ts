/** Scopes an API key can be granted — shared by the server (apiKeyAuth) and the admin UI. */
export const API_SCOPES = [
  'missions:read', 'missions:write',
  'drivers:read',  'drivers:write',
  'vehicles:read', 'vehicles:write',
  'clients:read',  'clients:write',
  'sites:read',    'sites:write',
  'plans:read',    'plans:write',
  'optimize',
  'reports:read',
] as const

export type ApiScope = typeof API_SCOPES[number]
