import { encryptConfig, decryptConfig } from '@/lib/configCrypto'

/**
 * Rules specific to the platform (superadmin) account — kept free of database access so the
 * login route, the superadmin routes and the seed script share one definition.
 */

/** The organisation superadmin accounts live in. It is never suspended, renamed or deleted. */
export const PLATFORM_TENANT_SLUG = 'admin-corp'

export const SUPERADMIN_PASSWORD_MIN_LENGTH = 12

/**
 * A superadmin password opens every organisation's data: 12 characters at least, mixing
 * lowercase, uppercase and digits. Returns the reason it is refused, or null when acceptable.
 */
export function superadminPasswordIssue(password: string): string | null {
  if (password.length < SUPERADMIN_PASSWORD_MIN_LENGTH) {
    return `Le mot de passe d'un superadmin compte au moins ${SUPERADMIN_PASSWORD_MIN_LENGTH} caractères`
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return "Le mot de passe d'un superadmin mêle minuscules, majuscules et chiffres"
  }
  return null
}

/**
 * The TOTP secret as stored: encrypted when INTEGRATION_ENCRYPTION_KEY is set, readable
 * otherwise so a setup without the key still works (set the key in production).
 */
export function sealTotpSecret(secret: string): Record<string, unknown> {
  if (!process.env.INTEGRATION_ENCRYPTION_KEY) return { secret }
  return { ...encryptConfig({ secret }) }
}

/** Reads a stored TOTP secret back; null when the stored value holds none. */
export function openTotpSecret(stored: unknown): string | null {
  const plain = decryptConfig(stored)
  return typeof plain.secret === 'string' && plain.secret ? plain.secret : null
}
