import { describe, it, expect } from 'vitest'
import { TRADES, TRADE_IDS, getTradeConfig } from '@/lib/trades'
import type { TradeVocabulary } from '@/lib/trades'

const VOCAB_STRING_KEYS: (keyof TradeVocabulary)[] = [
  'tradeName', 'tradeDescription', 'tradeIcon',
  'driver', 'drivers', 'vehicle', 'vehicles',
  'mission', 'missions', 'exutoire', 'exutoires',
  'depot', 'client', 'tour', 'tours',
  'binSize', 'wasteType', 'optimize', 'collect',
]

// ── PARTIE 1 : COLLECTE_RECYCLAGE ─────────────────────────────────────────────

describe('Audit collecte_recyclage — vocabulaire', () => {
  const cfg = TRADES.collecte_recyclage
  const v   = cfg.vocabulary

  it('tous les champs de vocabulaire sont non-vides', () => {
    for (const key of VOCAB_STRING_KEYS) {
      expect(String(v[key]).length, `vocab.${key} doit être non-vide`).toBeGreaterThan(0)
    }
  })

  it('termes métier spécifiques au recyclage présents', () => {
    expect(v.driver).toBe('Chauffeur')
    expect(v.vehicle).toBe('Camion')
    expect(v.mission).toBe('Mission')
    expect(v.exutoire).toBe('Exutoire')
    expect(v.binSize).toBe('Taille benne')
    expect(v.wasteType).toBe('Type de déchet')
    expect(v.client).toBe('Client')
    expect(v.depot).toBe('Dépôt')
  })

  it('TASSER et ALLER_RETOUR activés (spécifiques recyclage)', () => {
    expect(cfg.enabledMissionTypes).toContain('TASSER')
    expect(cfg.enabledMissionTypes).toContain('ALLER_RETOUR')
  })

  it('tous les 10 types de mission activés', () => {
    const all10 = ['POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE', 'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER', 'ALLER_RETOUR']
    for (const t of all10) {
      expect(cfg.enabledMissionTypes, `${t} doit être activé`).toContain(t)
    }
  })

  it('VIDER et TASSER ont des labels custom', () => {
    expect(v.missionTypeLabels['VIDER']).toBe('Vidage')
    expect(v.missionTypeLabels['TASSER']).toBe('Tassage')
  })

  it('POSER = "Pose" (et non "Livraison" de distribution)', () => {
    expect(v.missionTypeLabels['POSER']).toBe('Pose')
    expect(v.missionTypeLabels['POSER']).not.toBe('Livraison')
  })
})

describe('Audit collecte_recyclage — cohérence croisée', () => {
  it('vocabulaire distinct de livraison_distribution', () => {
    const cr = TRADES.collecte_recyclage.vocabulary
    const ld = TRADES.livraison_distribution.vocabulary
    expect(cr.driver).not.toBe(ld.driver)
    expect(cr.mission).not.toBe(ld.mission)
    expect(cr.exutoire).not.toBe(ld.exutoire)
    expect(cr.client).not.toBe(ld.client)
    expect(cr.wasteType).not.toBe(ld.wasteType)
  })

  it('vocabulaire distinct de btp_location', () => {
    const cr  = TRADES.collecte_recyclage.vocabulary
    const btp = TRADES.btp_location.vocabulary
    expect(cr.mission).not.toBe(btp.mission)
    expect(cr.exutoire).not.toBe(btp.exutoire)
    expect(cr.binSize).not.toBe(btp.binSize)
    expect(cr.wasteType).not.toBe(btp.wasteType)
  })

  it('TASSER et ALLER_RETOUR absents des autres métiers', () => {
    for (const id of TRADE_IDS.filter(i => i !== 'collecte_recyclage')) {
      expect(TRADES[id].enabledMissionTypes, `${id} ne doit pas avoir TASSER`).not.toContain('TASSER')
      expect(TRADES[id].enabledMissionTypes, `${id} ne doit pas avoir ALLER_RETOUR`).not.toContain('ALLER_RETOUR')
    }
  })
})

// ── PARTIE 2 : BTP_LOCATION (scierie) ────────────────────────────────────────

describe('Audit btp_location — vocabulaire', () => {
  const cfg = TRADES.btp_location
  const v   = cfg.vocabulary

  it('tous les champs de vocabulaire sont non-vides', () => {
    for (const key of VOCAB_STRING_KEYS) {
      expect(String(v[key]).length, `vocab.${key} doit être non-vide`).toBeGreaterThan(0)
    }
  })

  it('termes BTP/scierie présents', () => {
    expect(v.driver).toBe('Chauffeur')
    expect(v.vehicle).toBe('Camion')
    expect(v.mission).toBe('Livraison')
    expect(v.missions).toBe('Livraisons')
    expect(v.exutoire).toBe('Dépôt matériel')
    expect(v.depot).toBe('Base')
    expect(v.client).toBe('Client')
    expect(v.binSize).toBe('Référence produit')
    expect(v.wasteType).toBe('Type de matériel')
  })

  it('types de mission adaptés livraison bois (POSER/RETIRER/ECHANGER activés)', () => {
    expect(cfg.enabledMissionTypes).toContain('POSER')
    expect(cfg.enabledMissionTypes).toContain('RETIRER')
    expect(cfg.enabledMissionTypes).toContain('ECHANGER')
  })

  it('VIDER activé — retour dépôt matériel', () => {
    expect(cfg.enabledMissionTypes).toContain('VIDER')
  })

  it('CHARGER_IMMEDIAT activé — chargement urgent', () => {
    expect(cfg.enabledMissionTypes).toContain('CHARGER_IMMEDIAT')
  })

  it('TASSER et ALLER_RETOUR absents (non pertinents pour scierie)', () => {
    expect(cfg.enabledMissionTypes).not.toContain('TASSER')
    expect(cfg.enabledMissionTypes).not.toContain('ALLER_RETOUR')
  })

  it('POSER = "Livraison" (livraison de bois)', () => {
    expect(v.missionTypeLabels['POSER']).toBe('Livraison')
  })

  it('RETIRER = "Récupération"', () => {
    expect(v.missionTypeLabels['RETIRER']).toBe('Récupération')
  })

  it('VIDER = "Retour dépôt"', () => {
    expect(v.missionTypeLabels['VIDER']).toBe('Retour dépôt')
  })
})

describe('Audit btp_location — adéquation scierie vs livraison_distribution', () => {
  it('btp_location : Chauffeur (meilleur que Livreur pour grumier)', () => {
    expect(TRADES.btp_location.vocabulary.driver).toBe('Chauffeur')
    expect(TRADES.livraison_distribution.vocabulary.driver).toBe('Livreur')
  })

  it('btp_location : Camion (meilleur que Véhicule générique)', () => {
    expect(TRADES.btp_location.vocabulary.vehicle).toBe('Camion')
    expect(TRADES.livraison_distribution.vocabulary.vehicle).toBe('Véhicule')
  })

  it('btp_location : Base (entité physique scierie) vs Agence', () => {
    expect(TRADES.btp_location.vocabulary.depot).toBe('Base')
    expect(TRADES.livraison_distribution.vocabulary.depot).toBe('Agence')
  })

  it('btp_location : Livraison (mission scierie) vs Intervention (BTP avant C1)', () => {
    expect(TRADES.btp_location.vocabulary.mission).toBe('Livraison')
  })

  it('btp_location : Client (neutre) vs Chantier (BTP avant C2)', () => {
    expect(TRADES.btp_location.vocabulary.client).toBe('Client')
    expect(TRADES.btp_location.vocabulary.client).not.toBe('Chantier')
  })

  it('btp_location : Référence produit (scierie) vs Équipement (BTP avant C3)', () => {
    expect(TRADES.btp_location.vocabulary.binSize).toBe('Référence produit')
    expect(TRADES.btp_location.vocabulary.binSize).not.toBe('Équipement')
  })

  it('btp_location : EXPEDIER absent (pas de gestion d\'expédition pour scierie)', () => {
    expect(TRADES.btp_location.enabledMissionTypes).not.toContain('EXPEDIER')
  })

  it('livraison_distribution : EXPEDIER présent (non pertinent scierie)', () => {
    expect(TRADES.livraison_distribution.enabledMissionTypes).toContain('EXPEDIER')
  })
})

// ── TOUS LES MÉTIERS : vérifications générales ────────────────────────────────

describe('Audit global — tous les métiers', () => {
  it('chaque métier a un icon emoji non vide', () => {
    for (const id of TRADE_IDS) {
      const icon = TRADES[id].vocabulary.tradeIcon
      expect(icon.length, `${id}.tradeIcon vide`).toBeGreaterThan(0)
    }
  })

  it('chaque métier : pluriel != singulier pour driver/vehicle/mission', () => {
    for (const id of TRADE_IDS) {
      const v = TRADES[id].vocabulary
      expect(v.drivers, `${id}: drivers == driver`).not.toBe(v.driver)
      expect(v.vehicles, `${id}: vehicles == vehicle`).not.toBe(v.vehicle)
      expect(v.missions, `${id}: missions == mission`).not.toBe(v.mission)
      expect(v.exutoires, `${id}: exutoires == exutoire`).not.toBe(v.exutoire)
    }
  })

  it('PAUSE activé dans tous les métiers', () => {
    for (const id of TRADE_IDS) {
      expect(TRADES[id].enabledMissionTypes, `${id} manque PAUSE`).toContain('PAUSE')
    }
  })

  it('POSER et RETIRER activés dans tous les métiers', () => {
    for (const id of TRADE_IDS) {
      expect(TRADES[id].enabledMissionTypes, `${id} manque POSER`).toContain('POSER')
      expect(TRADES[id].enabledMissionTypes, `${id} manque RETIRER`).toContain('RETIRER')
    }
  })

  it('getTradeConfig retourne toujours un config valide', () => {
    for (const id of TRADE_IDS) {
      const cfg = getTradeConfig(id)
      expect(cfg.id).toBe(id)
      for (const key of VOCAB_STRING_KEYS) {
        expect(String(cfg.vocabulary[key]).length).toBeGreaterThan(0)
      }
    }
  })
})
