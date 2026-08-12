import type { MissionType } from '@/lib/types'
import { MISSION_TYPE_ICONS } from '@/lib/types'

export const TRADE_IDS = [
  'collecte_recyclage',
  'livraison_distribution',
  'btp_location',
  'demenagement',
  'maintenance_sav',
  'coursier_express',
] as const

export type TradeId = (typeof TRADE_IDS)[number]

export const DEFAULT_TRADE: TradeId = 'collecte_recyclage'

export interface TradeVocabulary {

  tradeName:        string
  tradeDescription: string
  tradeIcon:        string

  driver:           string
  drivers:          string
  vehicle:          string
  vehicles:         string
  mission:          string
  missions:         string
  exutoire:         string
  exutoires:        string
  depot:            string
  client:           string
  tour:             string
  tours:            string
  binSize:          string
  wasteType:        string

  optimize:         string
  collect:          string

  missionTypeLabels: Partial<Record<MissionType, string>>
  missionTypeIcons:  Partial<Record<MissionType, string>>
}

export interface TradeConfig {
  // Custom (superadmin-created) trades use a free-form key, not the closed TradeId union.
  id:              TradeId | string
  vocabulary:      TradeVocabulary

  enabledMissionTypes: MissionType[]
}

export const TRADES: Record<TradeId, TradeConfig> = {

  collecte_recyclage: {
    id: 'collecte_recyclage',
    vocabulary: {
      tradeName:        'Collecte & Recyclage',
      tradeDescription: 'Collecte de déchets, recyclage, rotation de bennes, vidage en exutoire.',
      tradeIcon:        '♻️',
      driver: 'Chauffeur', drivers: 'Chauffeurs',
      vehicle: 'Camion', vehicles: 'Camions',
      mission: 'Mission', missions: 'Missions',
      exutoire: 'Exutoire', exutoires: 'Exutoires',
      depot: 'Dépôt', client: 'Client',
      tour: 'Tournée', tours: 'Tournées',
      binSize: 'Taille benne', wasteType: 'Type de déchet',
      optimize: 'Optimiser', collect: 'Collecter',
      missionTypeLabels: {
        POSER:            'Pose',
        RETIRER:          'Enlèvement',
        ECHANGER:         'Rotation',
        VIDER:            'Vidage',
        CHARGER_IMMEDIAT: 'Ch. immédiat',
        DEPLACER:         'Déplacement',
        TASSER:           'Tassage',
        EXPEDIER:         'Expédition',
        ALLER_RETOUR:     'Aller-Retour',
      },
      missionTypeIcons: {},
    },
    enabledMissionTypes: ['POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE', 'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER', 'ALLER_RETOUR'],
  },

  livraison_distribution: {
    id: 'livraison_distribution',
    vocabulary: {
      tradeName:        'Livraison & Distribution',
      tradeDescription: 'Transport de colis, distribution de marchandises, tournées de livraison.',
      tradeIcon:        '📦',
      driver: 'Livreur', drivers: 'Livreurs',
      vehicle: 'Véhicule', vehicles: 'Véhicules',
      mission: 'Livraison', missions: 'Livraisons',
      exutoire: 'Entrepôt', exutoires: 'Entrepôts',
      depot: 'Agence', client: 'Destinataire',
      tour: 'Tournée', tours: 'Tournées',
      binSize: 'Taille colis', wasteType: 'Type de colis',
      optimize: 'Planifier', collect: 'Livrer',
      missionTypeLabels: {
        POSER:            'Livraison',
        RETIRER:          'Enlèvement',
        ECHANGER:         'Échange',
        VIDER:            'Retour entrepôt',
        CHARGER_IMMEDIAT: 'Chargement express',
        DEPLACER:         'Transfert',
        EXPEDIER:         'Expédition',
      },
      missionTypeIcons: {
        POSER: '📬', RETIRER: '📮', ECHANGER: '🔄', VIDER: '🏢',
      },
    },
    enabledMissionTypes: ['POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE', 'CHARGER_IMMEDIAT', 'DEPLACER', 'EXPEDIER'],
  },

  btp_location: {
    id: 'btp_location',
    vocabulary: {
      tradeName:        'BTP & Location',
      tradeDescription: 'Location de matériel, livraison sur chantier, récupération d\'équipements.',
      tradeIcon:        '🏗️',
      driver: 'Chauffeur', drivers: 'Chauffeurs',
      vehicle: 'Camion', vehicles: 'Camions',
      mission: 'Livraison', missions: 'Livraisons',
      exutoire: 'Dépôt matériel', exutoires: 'Dépôts matériel',
      depot: 'Base', client: 'Client',
      tour: 'Circuit', tours: 'Circuits',
      binSize: 'Référence produit', wasteType: 'Type de matériel',
      optimize: 'Planifier', collect: 'Livrer',
      missionTypeLabels: {
        POSER:            'Livraison',
        RETIRER:          'Récupération',
        ECHANGER:         'Échange',
        VIDER:            'Retour dépôt',
        CHARGER_IMMEDIAT: 'Chargement',
        DEPLACER:         'Transfert',
      },
      missionTypeIcons: {
        POSER: '🔧', RETIRER: '📥', ECHANGER: '🔄', VIDER: '🏭',
      },
    },
    enabledMissionTypes: ['POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE', 'CHARGER_IMMEDIAT', 'DEPLACER'],
  },

  demenagement: {
    id: 'demenagement',
    vocabulary: {
      tradeName:        'Déménagement',
      tradeDescription: 'Déménagements résidentiels et professionnels, transferts de mobilier.',
      tradeIcon:        '🏠',
      driver: 'Déménageur', drivers: 'Déménageurs',
      vehicle: 'Camion', vehicles: 'Camions',
      mission: 'Intervention', missions: 'Interventions',
      exutoire: 'Garde-meuble', exutoires: 'Garde-meubles',
      depot: 'Dépôt', client: 'Client',
      tour: 'Planning', tours: 'Plannings',
      binSize: 'Volume (m³)', wasteType: 'Type de prestation',
      optimize: 'Planifier', collect: 'Intervenir',
      missionTypeLabels: {
        POSER:            'Livraison',
        RETIRER:          'Enlèvement',
        ECHANGER:         'Transfert',
        CHARGER_IMMEDIAT: 'Chargement',
        DEPLACER:         'Déplacement',
      },
      missionTypeIcons: {
        POSER: '📦', RETIRER: '🏠', ECHANGER: '🔄',
      },
    },
    enabledMissionTypes: ['POSER', 'RETIRER', 'ECHANGER', 'PAUSE', 'CHARGER_IMMEDIAT', 'DEPLACER'],
  },

  maintenance_sav: {
    id: 'maintenance_sav',
    vocabulary: {
      tradeName:        'Maintenance & SAV',
      tradeDescription: 'Techniciens itinérants, interventions de maintenance, réparations sur site.',
      tradeIcon:        '🔧',
      driver: 'Technicien', drivers: 'Techniciens',
      vehicle: 'Véhicule', vehicles: 'Véhicules',
      mission: 'Intervention', missions: 'Interventions',
      exutoire: 'Atelier', exutoires: 'Ateliers',
      depot: 'Base', client: 'Client',
      tour: 'Tournée', tours: 'Tournées',
      binSize: 'Équipement', wasteType: 'Type d\'intervention',
      optimize: 'Planifier', collect: 'Intervenir',
      missionTypeLabels: {
        POSER:            'Installation',
        RETIRER:          'Désinstallation',
        ECHANGER:         'Remplacement',
        VIDER:            'Retour atelier',
        CHARGER_IMMEDIAT: 'Urgence',
        DEPLACER:         'Déplacement',
      },
      missionTypeIcons: {
        POSER: '🔧', RETIRER: '📤', ECHANGER: '🔄', CHARGER_IMMEDIAT: '⚡',
      },
    },
    enabledMissionTypes: ['POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE', 'CHARGER_IMMEDIAT', 'DEPLACER'],
  },

  coursier_express: {
    id: 'coursier_express',
    vocabulary: {
      tradeName:        'Coursier & Express',
      tradeDescription: 'Livraison urbaine rapide, courses express, plis et colis urgents.',
      tradeIcon:        '⚡',
      driver: 'Coursier', drivers: 'Coursiers',
      vehicle: 'Véhicule', vehicles: 'Véhicules',
      mission: 'Course', missions: 'Courses',
      exutoire: 'Hub', exutoires: 'Hubs',
      depot: 'Base', client: 'Destinataire',
      tour: 'Circuit', tours: 'Circuits',
      binSize: 'Format', wasteType: 'Type d\'envoi',
      optimize: 'Optimiser', collect: 'Livrer',
      missionTypeLabels: {
        POSER:            'Dépôt',
        RETIRER:          'Ramassage',
        ECHANGER:         'Échange',
        CHARGER_IMMEDIAT: 'Express',
        DEPLACER:         'Transfert',
      },
      missionTypeIcons: {
        POSER: '📬', RETIRER: '📮', CHARGER_IMMEDIAT: '⚡',
      },
    },
    enabledMissionTypes: ['POSER', 'RETIRER', 'ECHANGER', 'PAUSE', 'CHARGER_IMMEDIAT', 'DEPLACER', 'EXPEDIER'],
  },
}

const _customTrades = new Map<string, TradeConfig>()

export function registerCustomTrade(key: string, config: TradeConfig): void {
  _customTrades.set(key, config)
}

export function unregisterCustomTrade(key: string): void {
  _customTrades.delete(key)
}

export function getAllTradeIds(): string[] {
  return [...TRADE_IDS, ..._customTrades.keys()]
}

export function getAllTrades(): Record<string, TradeConfig> {
  const all: Record<string, TradeConfig> = { ...TRADES }
  for (const [key, config] of _customTrades) {
    all[key] = config
  }
  return all
}

export function getTradeConfig(tradeId: string | null | undefined): TradeConfig {
  if (tradeId && tradeId in TRADES) return TRADES[tradeId as TradeId]
  if (tradeId && _customTrades.has(tradeId)) return _customTrades.get(tradeId)!
  return TRADES[DEFAULT_TRADE]
}

export function isMissionTypeEnabled(tradeId: string | null | undefined, type: MissionType): boolean {
  return getTradeConfig(tradeId).enabledMissionTypes.includes(type)
}

export function getMissionTypeLabel(tradeId: string | null | undefined, type: MissionType): string {
  const trade = getTradeConfig(tradeId)
  return trade.vocabulary.missionTypeLabels[type] || type
}

export function getMissionTypeIcon(tradeId: string | null | undefined, type: MissionType): string {
  const trade = getTradeConfig(tradeId)
  return trade.vocabulary.missionTypeIcons[type] || MISSION_TYPE_ICONS[type] || '📋'
}

export function filterMissionsByTrade<T extends { type: MissionType }>(
  tradeId: string | null | undefined,
  missions: T[],
): T[] {
  const config = getTradeConfig(tradeId)
  return missions.filter(m => config.enabledMissionTypes.includes(m.type))
}
