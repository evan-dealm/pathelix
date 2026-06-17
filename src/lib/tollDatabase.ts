export interface TollRate {

  network: string

  concessionaire: string

  regions: string[]

  highways: string[]

  ratePerKmClass3: number

  classMultiplier: Record<number, number>
}

export const TOLL_NETWORKS: TollRate[] = [

  {
    network: 'aprr',
    concessionaire: 'APRR',
    regions: ['Bourgogne-Franche-Comte', 'Auvergne-Rhone-Alpes', 'Grand Est'],
    highways: ['A5', 'A6', 'A31', 'A36', 'A39', 'A40', 'A42', 'A71', 'A77'],
    ratePerKmClass3: 0.21,
    classMultiplier: { 2: 0.82, 3: 1.0, 4: 1.30 },
  },

  {
    network: 'area',
    concessionaire: 'AREA',
    regions: ['Auvergne-Rhone-Alpes'],
    highways: ['A43', 'A48', 'A49', 'A41', 'A410', 'A432', 'A46'],
    ratePerKmClass3: 0.22,
    classMultiplier: { 2: 0.82, 3: 1.0, 4: 1.30 },
  },

  {
    network: 'asf',
    concessionaire: 'ASF (Vinci)',
    regions: ['Occitanie', 'Nouvelle-Aquitaine', 'Provence-Alpes-Cote d\'Azur', 'Auvergne-Rhone-Alpes'],
    highways: ['A7', 'A8', 'A9', 'A10', 'A20', 'A46', 'A47', 'A54', 'A61', 'A62', 'A64', 'A66', 'A68', 'A89'],
    ratePerKmClass3: 0.20,
    classMultiplier: { 2: 0.80, 3: 1.0, 4: 1.28 },
  },

  {
    network: 'sanef',
    concessionaire: 'SANEF',
    regions: ['Hauts-de-France', 'Ile-de-France', 'Grand Est', 'Normandie'],
    highways: ['A1', 'A2', 'A4', 'A16', 'A26', 'A29'],
    ratePerKmClass3: 0.19,
    classMultiplier: { 2: 0.83, 3: 1.0, 4: 1.27 },
  },

  {
    network: 'sapn',
    concessionaire: 'SAPN',
    regions: ['Normandie', 'Ile-de-France'],
    highways: ['A13', 'A14', 'A29'],
    ratePerKmClass3: 0.18,
    classMultiplier: { 2: 0.83, 3: 1.0, 4: 1.27 },
  },

  {
    network: 'cofiroute',
    concessionaire: 'Cofiroute (Vinci)',
    regions: ['Centre-Val de Loire', 'Pays de la Loire', 'Ile-de-France'],
    highways: ['A10', 'A11', 'A28', 'A71', 'A85', 'A86'],
    ratePerKmClass3: 0.20,
    classMultiplier: { 2: 0.80, 3: 1.0, 4: 1.28 },
  },

  {
    network: 'atlandes',
    concessionaire: 'Atlandes',
    regions: ['Nouvelle-Aquitaine'],
    highways: ['A63'],
    ratePerKmClass3: 0.23,
    classMultiplier: { 2: 0.80, 3: 1.0, 4: 1.30 },
  },

  {
    network: 'escota',
    concessionaire: 'ESCOTA (Vinci)',
    regions: ['Provence-Alpes-Cote d\'Azur'],
    highways: ['A8', 'A50', 'A51', 'A52', 'A57', 'A500', 'A501'],
    ratePerKmClass3: 0.24,
    classMultiplier: { 2: 0.80, 3: 1.0, 4: 1.30 },
  },

  {
    network: 'atmb',
    concessionaire: 'ATMB',
    regions: ['Auvergne-Rhone-Alpes'],
    highways: ['A40', 'A401'],
    ratePerKmClass3: 0.28,
    classMultiplier: { 2: 0.85, 3: 1.0, 4: 1.35 },
  },

  {
    network: 'sftrf',
    concessionaire: 'SFTRF',
    regions: ['Auvergne-Rhone-Alpes'],
    highways: ['A43'],
    ratePerKmClass3: 0.30,
    classMultiplier: { 2: 0.85, 3: 1.0, 4: 1.40 },
  },
]

export const TOLL_VAT_RATE = 0.20

export const TELEPAY_DISCOUNTS: Record<string, number> = {
  '': 0,
  'tis_pl': 0.13,
  'eurotoll': 0.07,
  'dkv': 0.05,
  'total_card': 0.06,
  'axxes': 0.08,
}

export function estimateTollCost(
  distanceKm: number,
  tollClass: number = 3,
  badge: string = '',
  autoroute?: string,
): number {
  if (distanceKm <= 0) return 0

  let rate: TollRate | undefined
  if (autoroute) {
    rate = TOLL_NETWORKS.find(n => n.highways.some(h =>
      autoroute.toUpperCase() === h.toUpperCase()
    ))
  }

  const baseRate = rate?.ratePerKmClass3 ?? 0.21
  const classMultiplier = rate?.classMultiplier[tollClass] ?? (tollClass === 2 ? 0.82 : tollClass === 4 ? 1.30 : 1.0)

  const tollPortionRatio = 0.40
  const tollDistanceKm = distanceKm * tollPortionRatio

  let cost = tollDistanceKm * baseRate * classMultiplier

  const discount = TELEPAY_DISCOUNTS[badge] ?? 0
  if (discount > 0) {
    cost *= (1 - discount)
  }

  return Math.round(cost * 100) / 100
}

export function estimateFuelCost(
  distanceKm: number,
  consumptionLPer100: number,
  fuelCostPerLiter: number,
): number {
  if (distanceKm <= 0) return 0
  return Math.round(distanceKm * (consumptionLPer100 / 100) * fuelCostPerLiter * 100) / 100
}

export function estimateWearCost(distanceKm: number, costPerKm: number): number {
  if (distanceKm <= 0) return 0
  return Math.round(distanceKm * costPerKm * 100) / 100
}

export interface RouteCostBreakdown {
  fuelCost: number
  tollCost: number
  wearCost: number
  totalTTC: number
  totalHT: number
  distanceKm: number
}

export function computeRouteCostBreakdown(params: {
  distanceKm: number
  consumptionLPer100: number
  fuelCostPerLiter: number
  costPerKm: number
  tollClass?: number
  telepayBadge?: string
}): RouteCostBreakdown {
  const fuel = estimateFuelCost(params.distanceKm, params.consumptionLPer100, params.fuelCostPerLiter)
  const toll = estimateTollCost(params.distanceKm, params.tollClass ?? 3, params.telepayBadge ?? '')
  const wear = estimateWearCost(params.distanceKm, params.costPerKm)

  const totalTTC = Math.round((fuel + toll + wear) * 100) / 100
  const totalHT = Math.round(totalTTC / (1 + TOLL_VAT_RATE) * 100) / 100

  return { fuelCost: fuel, tollCost: toll, wearCost: wear, totalTTC, totalHT, distanceKm: params.distanceKm }
}
