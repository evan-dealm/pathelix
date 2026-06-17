'use client'

import { useEffect, useState, useCallback } from 'react'

const MISSION_TYPE_LABELS: Record<string, string> = {
  POSER:            'Pose de benne',
  RETIRER:          'Enlèvement',
  ECHANGER:         'Rotation',
  VIDER:            'Vidage',
  CHARGER_IMMEDIAT: 'Chargement immédiat',
  DEPLACER:         'Déplacement',
  TASSER:           'Tassement',
  EXPEDIER:         'Expédition',
  ALLER_RETOUR:     'Aller-retour',
}

interface EtaData {
  minutes:    number
  distanceKm: number
  driverLat:  number
  driverLng:  number
  updatedAt:  string
}

interface MissionData {
  id:            string
  type:          string
  address:       string
  clientName:    string | null
  status:        'in_progress' | 'completed' | 'cancelled'
  completedAt:   string | null
  driverComment: string
}

interface TrackingData {
  mission: MissionData
  eta:     EtaData | null
}

interface Props {
  token:       string
  initialData: TrackingData | null
}

const POLL_INTERVAL_MS = 30_000

export function TrackingContent({ token, initialData }: Props) {
  const [data, setData]           = useState<TrackingData | null>(initialData)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/tracking?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json() as TrackingData
      setData(json)
      setLastRefresh(new Date())
    } catch {  }
  }, [token])

  useEffect(() => {

    if (data?.mission.status === 'completed' || data?.mission.status === 'cancelled') return
    const id = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [data?.mission.status, refresh])

  const mission = data?.mission ?? null
  const eta     = data?.eta ?? null

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full">

        {}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🚛</div>
          <h1 className="text-2xl font-black text-white tracking-tight">Suivi de livraison</h1>
          <p className="text-gray-400 text-sm mt-1">Pathélix — Logistique en temps réel</p>
        </div>

        {!mission ? (
          <div className="bg-gray-900 border border-red-900/50 rounded-2xl p-6 text-center">
            <div className="text-3xl mb-3">❌</div>
            <h2 className="text-lg font-bold text-white mb-2">Lien invalide ou expiré</h2>
            <p className="text-gray-400 text-sm">
              Ce lien de suivi n&apos;est plus valide. Contactez votre livreur pour obtenir un nouveau lien.
            </p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

            {}
            <div className={`px-6 py-4 ${
              mission.status === 'completed'  ? 'bg-green-900/50 border-b border-green-800/50' :
              mission.status === 'cancelled'  ? 'bg-red-900/50 border-b border-red-800/50' :
              'bg-blue-900/50 border-b border-blue-800/50'
            }`}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">
                  {mission.status === 'completed' ? '✅' : mission.status === 'cancelled' ? '❌' : '🔄'}
                </span>
                <div>
                  <div className={`font-bold text-lg ${
                    mission.status === 'completed' ? 'text-green-300' :
                    mission.status === 'cancelled' ? 'text-red-300' : 'text-blue-300'
                  }`}>
                    {mission.status === 'completed' ? 'Livraison effectuée' :
                     mission.status === 'cancelled' ? 'Mission annulée' :
                     'En cours de livraison'}
                  </div>
                  {mission.completedAt && (
                    <div className="text-gray-400 text-sm">
                      {new Date(mission.completedAt).toLocaleString('fr-FR', {
                        dateStyle: 'medium', timeStyle: 'short',
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {}
            {mission.status === 'in_progress' && eta && (
              <div className="px-6 py-4 bg-amber-900/30 border-b border-amber-800/40">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-amber-400 text-xs uppercase tracking-wider font-semibold mb-0.5">
                      Arrivée estimée
                    </div>
                    <div className="text-white text-3xl font-black">
                      ~{eta.minutes} <span className="text-lg font-semibold text-gray-300">min</span>
                    </div>
                    <div className="text-gray-400 text-xs mt-0.5">{eta.distanceKm} km restants</div>
                  </div>
                  <div className="text-right">
                    <div className="text-4xl">📍</div>
                    <div className="text-gray-500 text-xs mt-1">
                      Mis à jour {new Date(eta.updatedAt).toLocaleTimeString('fr-FR', { timeStyle: 'short' })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {}
            <div className="px-6 py-5 space-y-4">
              {mission.clientName && (
                <div>
                  <div className="text-gray-500 text-xs uppercase tracking-wider font-semibold mb-1">Client</div>
                  <div className="text-white font-semibold">{mission.clientName}</div>
                </div>
              )}
              <div>
                <div className="text-gray-500 text-xs uppercase tracking-wider font-semibold mb-1">Type</div>
                <div className="text-white">{MISSION_TYPE_LABELS[mission.type] ?? mission.type}</div>
              </div>
              <div>
                <div className="text-gray-500 text-xs uppercase tracking-wider font-semibold mb-1">Adresse</div>
                <div className="text-white">{mission.address}</div>
              </div>
              {mission.driverComment && (
                <div className="bg-gray-800 rounded-xl p-4">
                  <div className="text-gray-500 text-xs uppercase tracking-wider font-semibold mb-1">
                    Commentaire du chauffeur
                  </div>
                  <div className="text-gray-200 text-sm">{mission.driverComment}</div>
                </div>
              )}
            </div>

            <div className="px-6 pb-5">
              <p className="text-gray-600 text-xs text-center">
                {mission.status === 'in_progress'
                  ? `Actualisation auto toutes les 30s · ${lastRefresh.toLocaleTimeString('fr-FR', { timeStyle: 'short' })}`
                  : 'Pathélix — Logistique intelligente'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
