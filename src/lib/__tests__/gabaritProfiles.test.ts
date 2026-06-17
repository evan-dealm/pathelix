import { describe, it, expect } from 'vitest'

interface GabaritProfile {
  key: string
  label: string
  description: string
  weightTon: number
  heightM: number
  widthM: number
  lengthM: number
  axleCount: number
  hazmat: boolean
}

const GABARIT_PROFILES: GabaritProfile[] = [
  { key: 'vl_utilitaire',  label: 'VL - Utilitaire',       description: '3.5t — Fourgon, petit plateau',           weightTon: 3.5,  heightM: 2.5, widthM: 2.0,  lengthM: 6.0,   axleCount: 2, hazmat: false },
  { key: 'pl_7t5',         label: 'PL 7.5t',               description: '7.5t — Petit porteur',                    weightTon: 7.5,  heightM: 3.0, widthM: 2.4,  lengthM: 7.5,   axleCount: 2, hazmat: false },
  { key: 'pl_12t',         label: 'PL 12t',                description: '12t — Porteur moyen',                     weightTon: 12,   heightM: 3.2, widthM: 2.5,  lengthM: 8.5,   axleCount: 2, hazmat: false },
  { key: 'pl_19t',         label: 'PL 19t',                description: '19t — Porteur benne / ampliroll',         weightTon: 19,   heightM: 3.5, widthM: 2.55, lengthM: 10.0,  axleCount: 2, hazmat: false },
  { key: 'pl_26t',         label: 'PL 26t',                description: '26t — Porteur 3 essieux (standard PL)',   weightTon: 26,   heightM: 4.0, widthM: 2.55, lengthM: 12.0,  axleCount: 3, hazmat: false },
  { key: 'pl_32t_semi',    label: 'PL 32t - Semi',         description: '32t — Semi-remorque',                     weightTon: 32,   heightM: 4.0, widthM: 2.55, lengthM: 16.5,  axleCount: 4, hazmat: false },
  { key: 'pl_44t_routier', label: 'PL 44t - Grand routier', description: '44t — Ensemble articule',                weightTon: 44,   heightM: 4.0, widthM: 2.55, lengthM: 18.75, axleCount: 5, hazmat: false },
  { key: 'grue_aux',       label: 'Grue auxiliaire',        description: '26t — Porteur avec grue',                weightTon: 26,   heightM: 4.2, widthM: 2.55, lengthM: 10.0,  axleCount: 3, hazmat: false },
  { key: 'compacteur',     label: 'Compacteur',            description: '26t — BOM / compacteur',                  weightTon: 26,   heightM: 3.8, widthM: 2.55, lengthM: 10.5,  axleCount: 3, hazmat: false },
]

function getProfileByKey(key: string): GabaritProfile | undefined {
  return GABARIT_PROFILES.find(p => p.key === key)
}

function detectProfile(v: { weightTon: number; heightM: number; widthM: number; lengthM: number; axleCount: number; hazmat: boolean }): string {
  const match = GABARIT_PROFILES.find(p =>
    p.weightTon === v.weightTon && p.heightM === v.heightM && p.widthM === v.widthM &&
    p.lengthM === v.lengthM && p.axleCount === v.axleCount && p.hazmat === v.hazmat
  )
  return match?.key ?? 'custom'
}

describe('Profils gabarit — définitions', () => {
  it('contient exactement 9 profils prédéfinis', () => {
    expect(GABARIT_PROFILES).toHaveLength(9)
  })

  it('chaque profil a une clé unique', () => {
    const keys = GABARIT_PROFILES.map(p => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('chaque profil a un label non vide', () => {
    for (const p of GABARIT_PROFILES) {
      expect(p.label.length).toBeGreaterThan(0)
    }
  })

  it('chaque profil a une description non vide', () => {
    for (const p of GABARIT_PROFILES) {
      expect(p.description.length).toBeGreaterThan(0)
    }
  })

  it('aucun hazmat par défaut', () => {
    for (const p of GABARIT_PROFILES) {
      expect(p.hazmat).toBe(false)
    }
  })

  it('le poids est croissant dans l\'ordre logique', () => {
    expect(getProfileByKey('vl_utilitaire')!.weightTon).toBeLessThan(getProfileByKey('pl_7t5')!.weightTon)
    expect(getProfileByKey('pl_7t5')!.weightTon).toBeLessThan(getProfileByKey('pl_12t')!.weightTon)
    expect(getProfileByKey('pl_12t')!.weightTon).toBeLessThan(getProfileByKey('pl_19t')!.weightTon)
    expect(getProfileByKey('pl_19t')!.weightTon).toBeLessThan(getProfileByKey('pl_26t')!.weightTon)
    expect(getProfileByKey('pl_26t')!.weightTon).toBeLessThan(getProfileByKey('pl_32t_semi')!.weightTon)
    expect(getProfileByKey('pl_32t_semi')!.weightTon).toBeLessThan(getProfileByKey('pl_44t_routier')!.weightTon)
  })

  it('les essieux augmentent avec le poids (PL standard)', () => {
    expect(getProfileByKey('pl_19t')!.axleCount).toBe(2)
    expect(getProfileByKey('pl_26t')!.axleCount).toBe(3)
    expect(getProfileByKey('pl_32t_semi')!.axleCount).toBe(4)
    expect(getProfileByKey('pl_44t_routier')!.axleCount).toBe(5)
  })

  it('la longueur augmente avec le poids (PL standard)', () => {
    expect(getProfileByKey('pl_7t5')!.lengthM).toBeLessThan(getProfileByKey('pl_19t')!.lengthM)
    expect(getProfileByKey('pl_19t')!.lengthM).toBeLessThan(getProfileByKey('pl_26t')!.lengthM)
    expect(getProfileByKey('pl_26t')!.lengthM).toBeLessThan(getProfileByKey('pl_32t_semi')!.lengthM)
  })
})

describe('Profils gabarit — valeurs réglementaires', () => {
  it('VL ne dépasse pas 3.5t', () => {
    expect(getProfileByKey('vl_utilitaire')!.weightTon).toBe(3.5)
  })

  it('largeur PL standard est 2.55m (norme européenne)', () => {
    const plProfiles = ['pl_19t', 'pl_26t', 'pl_32t_semi', 'pl_44t_routier']
    for (const key of plProfiles) {
      expect(getProfileByKey(key)!.widthM).toBe(2.55)
    }
  })

  it('hauteur max reste sous 4.3m (gabarit routier France)', () => {
    for (const p of GABARIT_PROFILES) {
      expect(p.heightM).toBeLessThanOrEqual(4.3)
    }
  })

  it('longueur semi ne dépasse pas 16.5m', () => {
    expect(getProfileByKey('pl_32t_semi')!.lengthM).toBe(16.5)
  })

  it('longueur grand routier ne dépasse pas 18.75m (France)', () => {
    expect(getProfileByKey('pl_44t_routier')!.lengthM).toBe(18.75)
  })

  it('poids max PL 44t (limite France)', () => {
    expect(getProfileByKey('pl_44t_routier')!.weightTon).toBe(44)
  })
})

describe('getProfileByKey', () => {
  it('retourne le profil pour une clé existante', () => {
    const p = getProfileByKey('pl_26t')
    expect(p).toBeDefined()
    expect(p!.weightTon).toBe(26)
    expect(p!.label).toBe('PL 26t')
  })

  it('retourne undefined pour une clé inconnue', () => {
    expect(getProfileByKey('inexistant')).toBeUndefined()
  })

  it('retourne undefined pour "custom"', () => {
    expect(getProfileByKey('custom')).toBeUndefined()
  })

  it('retourne undefined pour chaîne vide', () => {
    expect(getProfileByKey('')).toBeUndefined()
  })

  it('trouve chaque profil par sa clé', () => {
    for (const p of GABARIT_PROFILES) {
      expect(getProfileByKey(p.key)).toBe(p)
    }
  })
})

describe('detectProfile', () => {
  it('détecte correctement chaque profil prédéfini', () => {
    for (const p of GABARIT_PROFILES) {
      const detected = detectProfile({
        weightTon: p.weightTon,
        heightM: p.heightM,
        widthM: p.widthM,
        lengthM: p.lengthM,
        axleCount: p.axleCount,
        hazmat: p.hazmat,
      })
      expect(detected).toBe(p.key)
    }
  })

  it('retourne "custom" pour des dimensions non standard', () => {
    expect(detectProfile({
      weightTon: 15, heightM: 3.3, widthM: 2.5, lengthM: 9.0, axleCount: 2, hazmat: false,
    })).toBe('custom')
  })

  it('retourne "custom" si hazmat diffère', () => {

    expect(detectProfile({
      weightTon: 26, heightM: 4.0, widthM: 2.55, lengthM: 12.0, axleCount: 3, hazmat: true,
    })).toBe('custom')
  })

  it('retourne "custom" si un seul champ diffère', () => {

    expect(detectProfile({
      weightTon: 26, heightM: 4.0, widthM: 2.55, lengthM: 12.0, axleCount: 4, hazmat: false,
    })).toBe('custom')
  })

  it('retourne "custom" pour des valeurs à zéro', () => {
    expect(detectProfile({
      weightTon: 0, heightM: 0, widthM: 0, lengthM: 0, axleCount: 0, hazmat: false,
    })).toBe('custom')
  })
})

describe('Profils gabarit — cohérence interne', () => {
  it('grue_aux est plus haut que PL 26t (grue déployée)', () => {
    expect(getProfileByKey('grue_aux')!.heightM).toBeGreaterThan(getProfileByKey('pl_26t')!.heightM)
  })

  it('compacteur est plus court que PL 26t', () => {
    expect(getProfileByKey('compacteur')!.lengthM).toBeLessThan(getProfileByKey('pl_26t')!.lengthM)
  })

  it('grue et compacteur ont le même poids que PL 26t', () => {
    const ref = getProfileByKey('pl_26t')!.weightTon
    expect(getProfileByKey('grue_aux')!.weightTon).toBe(ref)
    expect(getProfileByKey('compacteur')!.weightTon).toBe(ref)
  })

  it('tous les PL ont au moins 2 essieux', () => {
    for (const p of GABARIT_PROFILES) {
      expect(p.axleCount).toBeGreaterThanOrEqual(2)
    }
  })

  it('VL a une largeur inférieure aux PL', () => {
    expect(getProfileByKey('vl_utilitaire')!.widthM).toBeLessThan(getProfileByKey('pl_26t')!.widthM)
  })
})
