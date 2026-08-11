import { describe, it, expect } from 'vitest'
import {
  TRADES, TRADE_IDS, DEFAULT_TRADE,
  getTradeConfig, isMissionTypeEnabled, getMissionTypeLabel,
  getMissionTypeIcon, filterMissionsByTrade,
} from '@/lib/trades'
import type { MissionType } from '@/lib/types'

describe('Trades — Configuration', () => {
  it('a exactement 6 métiers définis', () => {
    expect(TRADE_IDS).toHaveLength(6)
  })

  it('le métier par défaut est collecte_recyclage', () => {
    expect(DEFAULT_TRADE).toBe('collecte_recyclage')
  })

  it('chaque TRADE_ID a une config dans TRADES', () => {
    for (const id of TRADE_IDS) {
      expect(TRADES[id]).toBeDefined()
      expect(TRADES[id].id).toBe(id)
    }
  })

  it('chaque métier a un vocabulaire complet', () => {
    const requiredKeys = [
      'tradeName', 'tradeDescription', 'tradeIcon',
      'driver', 'drivers', 'vehicle', 'vehicles',
      'mission', 'missions', 'exutoire', 'exutoires',
      'depot', 'client', 'tour', 'tours',
      'binSize', 'wasteType', 'optimize', 'collect',
      'missionTypeLabels', 'missionTypeIcons',
    ]
    for (const id of TRADE_IDS) {
      const vocab = TRADES[id].vocabulary
      for (const key of requiredKeys) {
        expect(vocab).toHaveProperty(key)
      }
    }
  })

  it('chaque métier a au moins 3 types de missions activés', () => {
    for (const id of TRADE_IDS) {
      expect(TRADES[id].enabledMissionTypes.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('PAUSE est activé dans tous les métiers', () => {
    for (const id of TRADE_IDS) {
      expect(TRADES[id].enabledMissionTypes).toContain('PAUSE')
    }
  })

  it('collecte_recyclage a tous les 10 types de missions', () => {
    expect(TRADES.collecte_recyclage.enabledMissionTypes).toHaveLength(10)
  })
})

describe('Trades — Vocabulaire', () => {
  it('collecte_recyclage utilise "Chauffeur" et "Mission"', () => {
    const v = TRADES.collecte_recyclage.vocabulary
    expect(v.driver).toBe('Chauffeur')
    expect(v.mission).toBe('Mission')
    expect(v.exutoire).toBe('Exutoire')
  })

  it('livraison_distribution utilise "Livreur" et "Livraison"', () => {
    const v = TRADES.livraison_distribution.vocabulary
    expect(v.driver).toBe('Livreur')
    expect(v.mission).toBe('Livraison')
    expect(v.exutoire).toBe('Entrepôt')
    expect(v.client).toBe('Destinataire')
  })

  it('maintenance_sav utilise "Technicien" et "Intervention"', () => {
    const v = TRADES.maintenance_sav.vocabulary
    expect(v.driver).toBe('Technicien')
    expect(v.mission).toBe('Intervention')
    expect(v.exutoire).toBe('Atelier')
  })

  it('coursier_express utilise "Coursier" et "Course"', () => {
    const v = TRADES.coursier_express.vocabulary
    expect(v.driver).toBe('Coursier')
    expect(v.mission).toBe('Course')
    expect(v.exutoire).toBe('Hub')
  })

  it('demenagement utilise "Déménageur"', () => {
    const v = TRADES.demenagement.vocabulary
    expect(v.driver).toBe('Déménageur')
    expect(v.exutoire).toBe('Garde-meuble')
  })

  it('btp_location utilise "Client" et "Base"', () => {
    const v = TRADES.btp_location.vocabulary
    expect(v.client).toBe('Client')
    expect(v.depot).toBe('Base')
    expect(v.mission).toBe('Livraison')
    expect(v.binSize).toBe('Référence produit')
  })

  it('les labels de mission diffèrent entre métiers', () => {
    const collecte = TRADES.collecte_recyclage.vocabulary.missionTypeLabels.POSER
    const livraison = TRADES.livraison_distribution.vocabulary.missionTypeLabels.POSER
    const maintenance = TRADES.maintenance_sav.vocabulary.missionTypeLabels.POSER
    expect(collecte).not.toBe(livraison)
    expect(livraison).not.toBe(maintenance)
  })
})

describe('getTradeConfig', () => {
  it('retourne la config pour un ID valide', () => {
    const config = getTradeConfig('livraison_distribution')
    expect(config.id).toBe('livraison_distribution')
    expect(config.vocabulary.driver).toBe('Livreur')
  })

  it('retourne le défaut pour null', () => {
    const config = getTradeConfig(null)
    expect(config.id).toBe(DEFAULT_TRADE)
  })

  it('retourne le défaut pour undefined', () => {
    const config = getTradeConfig(undefined)
    expect(config.id).toBe(DEFAULT_TRADE)
  })

  it('retourne le défaut pour un ID inconnu', () => {
    const config = getTradeConfig('metier_inexistant')
    expect(config.id).toBe(DEFAULT_TRADE)
  })

  it('retourne le défaut pour une chaîne vide', () => {
    const config = getTradeConfig('')
    expect(config.id).toBe(DEFAULT_TRADE)
  })
})

describe('isMissionTypeEnabled', () => {
  it('TASSER est activé pour collecte_recyclage', () => {
    expect(isMissionTypeEnabled('collecte_recyclage', 'TASSER')).toBe(true)
  })

  it('TASSER est désactivé pour livraison_distribution', () => {
    expect(isMissionTypeEnabled('livraison_distribution', 'TASSER')).toBe(false)
  })

  it('ALLER_RETOUR est activé uniquement pour collecte_recyclage', () => {
    expect(isMissionTypeEnabled('collecte_recyclage', 'ALLER_RETOUR')).toBe(true)
    for (const id of TRADE_IDS.filter(i => i !== 'collecte_recyclage')) {
      expect(isMissionTypeEnabled(id, 'ALLER_RETOUR')).toBe(false)
    }
  })

  it('POSER et RETIRER sont activés pour tous les métiers', () => {
    for (const id of TRADE_IDS) {
      expect(isMissionTypeEnabled(id, 'POSER')).toBe(true)
      expect(isMissionTypeEnabled(id, 'RETIRER')).toBe(true)
    }
  })

  it('retourne le défaut si tradeId est null', () => {
    expect(isMissionTypeEnabled(null, 'TASSER')).toBe(true)
  })
})

describe('getMissionTypeLabel', () => {
  it('POSER = "Pose" en collecte_recyclage', () => {
    expect(getMissionTypeLabel('collecte_recyclage', 'POSER')).toBe('Pose')
  })

  it('POSER = "Livraison" en livraison_distribution', () => {
    expect(getMissionTypeLabel('livraison_distribution', 'POSER')).toBe('Livraison')
  })

  it('POSER = "Installation" en maintenance_sav', () => {
    expect(getMissionTypeLabel('maintenance_sav', 'POSER')).toBe('Installation')
  })

  it('CHARGER_IMMEDIAT = "Urgence" en maintenance_sav', () => {
    expect(getMissionTypeLabel('maintenance_sav', 'CHARGER_IMMEDIAT')).toBe('Urgence')
  })

  it('CHARGER_IMMEDIAT = "Express" en coursier_express', () => {
    expect(getMissionTypeLabel('coursier_express', 'CHARGER_IMMEDIAT')).toBe('Express')
  })

  it('retourne le type brut si pas de label custom', () => {
    expect(getMissionTypeLabel('collecte_recyclage', 'PAUSE')).toBe('PAUSE')
  })
})

describe('getMissionTypeIcon', () => {
  it('retourne une icône non vide pour chaque type activé', () => {
    for (const id of TRADE_IDS) {
      for (const type of TRADES[id].enabledMissionTypes) {
        const icon = getMissionTypeIcon(id, type)
        expect(icon.length).toBeGreaterThan(0)
      }
    }
  })

  it('icônes personnalisées sont utilisées si définies', () => {
    const icon = getMissionTypeIcon('livraison_distribution', 'POSER')
    expect(icon).toBe('📬')
  })
})

describe('filterMissionsByTrade', () => {
  const missions = [
    { id: '1', type: 'POSER' as MissionType },
    { id: '2', type: 'RETIRER' as MissionType },
    { id: '3', type: 'TASSER' as MissionType },
    { id: '4', type: 'ALLER_RETOUR' as MissionType },
    { id: '5', type: 'PAUSE' as MissionType },
    { id: '6', type: 'EXPEDIER' as MissionType },
  ]

  it('collecte_recyclage garde toutes les missions', () => {
    const filtered = filterMissionsByTrade('collecte_recyclage', missions)
    expect(filtered).toHaveLength(6)
  })

  it('livraison_distribution filtre TASSER et ALLER_RETOUR', () => {
    const filtered = filterMissionsByTrade('livraison_distribution', missions)
    expect(filtered).toHaveLength(4)
    expect(filtered.find(m => m.type === 'TASSER')).toBeUndefined()
    expect(filtered.find(m => m.type === 'ALLER_RETOUR')).toBeUndefined()
  })

  it('demenagement filtre TASSER, ALLER_RETOUR, EXPEDIER', () => {
    const filtered = filterMissionsByTrade('demenagement', missions)
    expect(filtered.find(m => m.type === 'TASSER')).toBeUndefined()
    expect(filtered.find(m => m.type === 'ALLER_RETOUR')).toBeUndefined()
    expect(filtered.find(m => m.type === 'EXPEDIER')).toBeUndefined()
  })

  it('retourne un tableau vide si aucune mission ne correspond', () => {
    const weird = [{ id: '1', type: 'ALLER_RETOUR' as MissionType }]
    const filtered = filterMissionsByTrade('coursier_express', weird)
    expect(filtered).toHaveLength(0)
  })

  it('utilise le défaut si tradeId est null', () => {
    const filtered = filterMissionsByTrade(null, missions)
    expect(filtered).toHaveLength(6)
  })
})

describe('Trades — Cohérence', () => {
  it('les types activés sont tous des MissionType valides', () => {
    const validTypes: MissionType[] = ['POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE', 'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER', 'ALLER_RETOUR']
    for (const id of TRADE_IDS) {
      for (const type of TRADES[id].enabledMissionTypes) {
        expect(validTypes).toContain(type)
      }
    }
  })

  it('chaque métier a un tradeName non vide', () => {
    for (const id of TRADE_IDS) {
      expect(TRADES[id].vocabulary.tradeName.length).toBeGreaterThan(0)
    }
  })

  it('les pluriels sont différents des singuliers', () => {
    for (const id of TRADE_IDS) {
      const v = TRADES[id].vocabulary
      expect(v.drivers).not.toBe(v.driver)
      expect(v.vehicles).not.toBe(v.vehicle)
      expect(v.missions).not.toBe(v.mission)
    }
  })
})

describe('Trade API routes', () => {
  it('POST/GET /api/onboarding exports correctly', async () => {
    const mod = await import('@/app/api/onboarding/route')
    expect(typeof mod.POST).toBe('function')
    expect(typeof mod.GET).toBe('function')
  })

  it('PUT /api/superadmin/tenants/[id]/settings exports correctly', async () => {
    const mod = await import('@/app/api/superadmin/tenants/[id]/settings/route')
    expect(typeof mod.PUT).toBe('function')
  })

  it('POST /api/superadmin/tenants/[id]/resources exports correctly', async () => {
    const mod = await import('@/app/api/superadmin/tenants/[id]/resources/route')
    expect(typeof mod.POST).toBe('function')
  })
})
