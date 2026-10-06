'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/components/ui/Toast'
import { cachedFetch, invalidateClientCache } from '@/lib/clientCache'

interface IntegrationType {
  type: string
  name: string
  description: string
  category: string
  configured: boolean
  integration: {
    id: string
    type: string
    name: string
    enabled: boolean
    lastSyncAt: string | null
    lastError: string | null
  } | null
}

interface ConfigField {
  key: string
  label: string
  type: 'text' | 'password' | 'url'
  placeholder: string
  required?: boolean
}

const CONFIG_FIELDS: Record<string, ConfigField[]> = {
  trimble: [
    { key: 'apiKey', label: 'Clé API Trimble', type: 'password', placeholder: 'trimble_key_...', required: true },
    { key: 'baseUrl', label: 'URL de base', type: 'url', placeholder: 'https://pcmiler.alk.com/apis/rest/v1.0' },
  ],
  here: [
    { key: 'apiKey', label: 'Clé API HERE', type: 'password', placeholder: 'here_api_key_...', required: true },
  ],
  geotab: [
    { key: 'apiKey', label: 'Clé API Geotab', type: 'password', placeholder: 'geotab_...', required: true },
    { key: 'database', label: 'Nom de la base', type: 'text', placeholder: 'my_company_db' },
    { key: 'server', label: 'Serveur', type: 'url', placeholder: 'my1.geotab.com' },
  ],
  samsara: [
    { key: 'apiToken', label: 'Token API Samsara', type: 'password', placeholder: 'samsara_api_...', required: true },
  ],
  sage: [
    { key: 'apiKey', label: 'Clé API Sage', type: 'password', placeholder: 'sage_key_...', required: true },
    { key: 'companyId', label: 'Company ID', type: 'text', placeholder: 'COMP001' },
  ],
  sap: [
    { key: 'baseUrl', label: 'URL SAP', type: 'url', placeholder: 'https://sap.example.com/api', required: true },
    { key: 'clientId', label: 'Client ID', type: 'text', placeholder: 'sap_client_id', required: true },
    { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'sap_secret_...', required: true },
  ],
  nessy: [
    { key: 'webhookSecret', label: 'Secret HMAC', type: 'password', placeholder: 'hmac_secret_...', required: true },
  ],
  slack: [
    { key: 'webhookUrl', label: 'Webhook URL Slack', type: 'url', placeholder: 'https://hooks.slack.com/services/T.../B.../...', required: true },
  ],
  teams: [
    { key: 'webhookUrl', label: 'Webhook URL Teams', type: 'url', placeholder: 'https://outlook.office.com/webhook/...', required: true },
  ],
  twilio_sms: [
    { key: 'accountSid', label: 'Account SID', type: 'text', placeholder: 'AC...', required: true },
    { key: 'authToken', label: 'Auth Token', type: 'password', placeholder: 'auth_token_...', required: true },
    { key: 'fromNumber', label: 'Numéro expéditeur', type: 'text', placeholder: '+33612345678', required: true },
  ],
  power_bi: [
    { key: 'workspaceId', label: 'Workspace ID', type: 'text', placeholder: 'ws-...', required: true },
    { key: 'apiKey', label: 'Clé API', type: 'password', placeholder: 'pbi_key_...' },
  ],
  custom_webhook: [
    { key: 'url', label: 'URL du webhook', type: 'url', placeholder: 'https://votre-service.com/webhook', required: true },
    { key: 'secret', label: 'Secret HMAC (optionnel)', type: 'password', placeholder: 'hmac_secret_...' },
    { key: 'events', label: 'Événements (comma-separated)', type: 'text', placeholder: 'mission.done, tour.optimized, anomaly.detected' },
  ],
  osrm: [
    { key: 'url', label: 'URL du serveur OSRM', type: 'url', placeholder: 'http://10.8.0.2:5000', required: true },
  ],
}

const TYPE_META: Record<string, { icon: string; color: string }> = {
  trimble:         { icon: '🗺',  color: 'blue' },
  here:            { icon: '📍',  color: 'green' },
  geotab:          { icon: '📡',  color: 'purple' },
  samsara:         { icon: '📡',  color: 'indigo' },
  sage:            { icon: '💼',  color: 'amber' },
  sap:             { icon: '💼',  color: 'orange' },
  nessy:           { icon: '🔗',  color: 'teal' },
  slack:           { icon: '💬',  color: 'purple' },
  teams:           { icon: '💬',  color: 'blue' },
  twilio_sms:      { icon: '📱',  color: 'red' },
  power_bi:        { icon: '📊',  color: 'yellow' },
  custom_webhook:  { icon: '🔗',  color: 'gray' },
  osrm:            { icon: '🗺',  color: 'green' },
}

const CATEGORY_LABELS: Record<string, string> = {
  routing:      'Routage & Cartographie',
  erp:          'ERP & Facturation',
  telemetry:    'Télématique & Flotte',
  notifications: 'Notifications',
  productivity: 'Productivite',
  reporting:    'Reporting & BI',
  custom:       'Personnalisé',
}

const INFO_TEXT: Record<string, string> = {
  trimble: 'Trimble Maps remplace OSRM pour le calcul d\'itinéraires poids-lourds. Il prend en compte les péages, les restrictions de gabarit et les coûts carburant. Si Trimble est active, il est utilise en priorité. Si l\'appel echoue, le système bascule sur OSRM puis sur le calcul a vol d\'oiseau. Utile si vous avez déjà un contrat Trimble.',
  here: 'HERE Truck Routing calcule les itinéraires poids-lourds avec le trafic en temps réel. Il connaît les Zones a Faibles Émissions (ZFE) de Lyon, Paris, Grenoble et interdit les camions non-conformes. Même cascade que Trimble : HERE → OSRM → vol d\'oiseau.',
  osrm: 'OSRM est le moteur de routage open-source intégré par défaut. Il tourne sur votre serveur local avec un profil camion (26t, 4m hauteur, 2.55m largeur). Configurez l\'URL ici au lieu de la variable d\'environnement pour pouvoir la changer sans redeployer.',
  geotab: 'Geotab reçoit les positions GPS de vos boîtiers télématiques OBD. Les positions arrivent automatiquement sans dépendre de l\'application mobile. Vous voyez les camions sur la carte même si le chauffeur n\'a pas ouvert l\'app. Configurez le mapping entre les IDs Geotab et vos chauffeurs.',
  samsara: 'Samsara fonctionne comme Geotab : il envoie les positions GPS de vos boîtiers. En plus, Samsara peut envoyer des alertes camera (freinage brusque, virage dangereux) et le suivi de temperature pour les transports alimentaires.',
  nessy: 'Nessy envoie automatiquement les missions depuis votre ERP vers PATHÉLIX via un webhook securise (HMAC-SHA256). Les missions sont injectées dans le pool et prises en compte a la prochaine optimisation. Configurez le secret HMAC partage avec Nessy.',
  sage: 'Quand un chauffeur termine une mission, une ligne de facturation est creee automatiquement dans Sage. Plus besoin de re-saisir manuellement chaque mission en fin de journée. Les données envoyees : client, type de déchet, poids, durée, chauffeur.',
  sap: 'Même principe que Sage mais pour SAP Business One. Chaque mission terminee genere un bon de livraison dans SAP. Le mapping entre les clients PATHÉLIX et les Business Partners SAP est automatique.',
  slack: 'Recevez les notifications directement dans Slack : optimisation terminee (nb missions, score), anomalie ML détectée (clic rafale, GPS incohérent), mission P1 en retard, chauffeur hors zone depuis 30 min. Configurez l\'URL du webhook Slack.',
  teams: 'Même chose que Slack mais pour Microsoft Teams. Les notifications arrivent sous forme de cartes adaptatives dans le canal configure. Configurez l\'URL du connecteur Incoming Webhook de Teams.',
  twilio_sms: 'Envoie un SMS au client quand le chauffeur est en route : "Votre benne arrive dans environ 30 minutes. Chauffeur : Gabin Martin." Réduit les accès bloqués de 30-40% car le client peut préparer l\'accès. Nécessite un compte Twilio et un numéro expéditeur.',
  power_bi: 'Les KPIs du jour (missions, km, durée moyenne, taux de conformité) sont envoyés automatiquement vers votre dataset Power BI. Vos dirigeants voient les tableaux de bord sans ouvrir PATHÉLIX.',
  custom_webhook: 'Envoyez des événements vers n\'importe quelle URL quand quelque chose se passe : mission terminee, tournée optimisée, anomalie détectée, position chauffeur. Chaque événement est signe HMAC-SHA256 pour la sécurité. Connectez Zapier, Make, ou votre propre système.',
}

const FULL_MARKETPLACE: Array<{ type: string; name: string; description: string; category: string }> = [
  { type: 'trimble',         name: 'Trimble Maps',         description: 'Calcul de routes poids-lourds (restrictions, péages)', category: 'routing' },
  { type: 'here',            name: 'HERE Truck Routing',   description: 'Routage PL avec trafic temps réel et zones ZFE', category: 'routing' },
  { type: 'osrm',            name: 'OSRM (Self-hosted)',   description: 'Matrice de distances open-source pour l\'optimisation VRP', category: 'routing' },
  { type: 'geotab',          name: 'Geotab',               description: 'Télématique universelle — positions GPS et données moteur via boîtier OBD', category: 'telemetry' },
  { type: 'samsara',         name: 'Samsara',              description: 'GPS + cameras embarquees + suivi temperature', category: 'telemetry' },
  { type: 'nessy',           name: 'Nessy (Webhook)',      description: 'Reception automatique des missions depuis l\'ERP Nessy', category: 'erp' },
  { type: 'sage',            name: 'Sage Comptabilite',    description: 'Export automatique des tournées vers la comptabilite', category: 'erp' },
  { type: 'sap',             name: 'SAP Business One',     description: 'Synchronisation bons de livraison et factures', category: 'erp' },
  { type: 'slack',           name: 'Slack',                description: 'Notifications tournées et alertes anomalies dans vos canaux', category: 'notifications' },
  { type: 'teams',           name: 'Microsoft Teams',      description: 'Notifications dans Teams via webhook', category: 'notifications' },
  { type: 'twilio_sms',      name: 'SMS (Twilio)',         description: 'Notifier vos clients par SMS : "Votre benne arrive dans 30 min"', category: 'notifications' },
  { type: 'power_bi',        name: 'Power BI',             description: 'Connecter vos données a des tableaux de bord avancés', category: 'reporting' },
  { type: 'custom_webhook',  name: 'Webhook personnalise', description: 'Envoyer des événements vers n\'importe quelle URL', category: 'custom' },
]

export function IntegrationsPanel() {
  const { error: toastError } = useToast()
  const [marketplace, setMarketplace] = useState<IntegrationType[]>([])
  const [loading, setLoading] = useState(true)
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [showingInfo, setShowingInfo] = useState<string | null>(null)
  const [configValues, setConfigValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await cachedFetch<{ marketplace?: IntegrationType[] }>('/api/integrations', 30_000)

      const apiTypes = new Map((data.marketplace ?? []).map((m: IntegrationType) => [m.type, m]))
      const merged: IntegrationType[] = FULL_MARKETPLACE.map(fm => {
        const apiEntry = apiTypes.get(fm.type)
        return (apiEntry ?? { ...fm, configured: false, integration: null }) as IntegrationType
      })
      setMarketplace(merged)
    } catch {  }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave() {
    if (!configuring) return
    setSaving(true)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: configuring,
          config: configValues,
          enabled: true,
        }),
      })
      if (res.ok) {
        setConfiguring(null)
        setConfigValues({})
        setTestResult(null)
        invalidateClientCache('/api/integrations')
        load()
      } else {
        toastError('Erreur de sauvegarde')
      }
    } finally { setSaving(false) }
  }

  async function handleToggle(type: string, enabled: boolean) {
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, enabled }),
      })
      if (!res.ok) toastError('Erreur lors du changement de statut')
      invalidateClientCache('/api/integrations')
      load()
    } catch {
      toastError('Erreur réseau — impossible de contacter le serveur')
    }
  }

  async function handleTest() {
    if (!configuring) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/integrations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: configuring, config: configValues }),
      })
      const data = await res.json()
      setTestResult({
        ok: data.ok ?? false,
        message: `${data.message ?? 'Erreur'}${data.latencyMs ? ` (${data.latencyMs}ms)` : ''}`,
      })
    } catch {
      setTestResult({ ok: false, message: 'Erreur réseau — impossible de contacter le serveur' })
    } finally { setTesting(false) }
  }

  const [catFilter, setCatFilter] = useState('all')
  const [searchFilter, setSearchFilter] = useState('')
  const allCats = [...new Set(marketplace.map(m => m.category))]
  const filtered = marketplace.filter(m => {
    if (catFilter !== 'all' && m.category !== catFilter) return false
    if (searchFilter) {
      const q = searchFilter.toLowerCase()
      return m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q) || m.type.toLowerCase().includes(q)
    }
    return true
  })

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-surface-400 text-sm">Chargement des intégrations...</div>
  }

  return (
    <div className="flex flex-col h-full">
      {}
      <div className="flex items-center gap-2 mb-3 flex-shrink-0 flex-wrap">
        <input value={searchFilter} onChange={e => setSearchFilter(e.target.value)} placeholder="Rechercher une API..."
          title="Rechercher une intégration"
          className="px-3 py-1 rounded-full text-[11px] bg-surface-50 border border-surface-200 text-surface-700 placeholder-surface-400 focus:outline-none focus:border-brand-400 w-44" />
        <button type="button" onClick={() => setCatFilter('all')}
          className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${catFilter === 'all' ? 'bg-brand-500 text-white' : 'bg-surface-100 text-surface-500 hover:bg-surface-200'}`}>
          Tout ({marketplace.length})
        </button>
        {allCats.map(cat => (
          <button key={cat} type="button" onClick={() => setCatFilter(cat)}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${catFilter === cat ? 'bg-brand-500 text-white' : 'bg-surface-100 text-surface-500 hover:bg-surface-200'}`}>
            {CATEGORY_LABELS[cat] || cat}
          </button>
        ))}
      </div>

      {}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] text-surface-400 uppercase tracking-wider border-b border-surface-100">
              <th className="text-left py-2 px-3 font-medium">Service</th>
              <th className="text-left py-2 px-3 font-medium hidden md:table-cell">Description</th>
              <th className="text-center py-2 px-3 font-medium w-20">Statut</th>
              <th className="text-right py-2 px-3 font-medium w-32">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => {
              const meta = TYPE_META[item.type] || { icon: '🔌', color: 'gray' }
              const isActive = item.integration?.enabled ?? false

              return (
                <React.Fragment key={item.type}>
                <tr className="border-b border-surface-50 dark:border-surface-700 hover:bg-surface-50/50 dark:hover:bg-surface-700/30 transition-colors group">
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{meta.icon}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-surface-800 dark:text-surface-100 text-xs">{item.name}</span>
                        <button type="button" title={`En savoir plus sur ${item.name}`}
                          onClick={e => { e.stopPropagation(); setShowingInfo(showingInfo === item.type ? null : item.type) }}
                          className="w-4 h-4 rounded-full bg-surface-200 hover:bg-brand-100 text-surface-500 hover:text-brand-600 text-[10px] font-bold flex items-center justify-center shrink-0 transition-colors">
                          ?
                        </button>
                      </div>
                      <div className="text-[10px] text-surface-400 md:hidden">{item.description.slice(0, 50)}...</div>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-[11px] text-surface-400 hidden md:table-cell max-w-[300px] truncate">{item.description}</td>
                  <td className="py-2.5 px-3 text-center">
                    {isActive ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[10px] font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Active
                      </span>
                    ) : item.configured ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full bg-surface-100 text-surface-400 text-[10px] font-medium">Inactive</span>
                    ) : (
                      <span className="text-[10px] text-surface-300">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button"
                        onClick={() => { setConfiguring(item.type); setConfigValues({}); setTestResult(null) }}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium border border-surface-200 text-surface-600 hover:bg-surface-100 transition-colors">
                        Configurer
                      </button>
                      {item.configured && (
                        <button type="button" onClick={() => handleToggle(item.type, !isActive)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                            isActive ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30' : 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30'
                          }`}>
                          {isActive ? 'Off' : 'On'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {showingInfo === item.type && INFO_TEXT[item.type] && (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 bg-brand-50/50 dark:bg-brand-900/20 border-b border-brand-100 dark:border-brand-800/30">
                      <div className="flex items-start gap-2">
                        <span className="text-brand-500 text-sm shrink-0 mt-0.5">💡</span>
                        <p className="text-xs text-surface-600 dark:text-surface-300 leading-relaxed">{INFO_TEXT[item.type]}</p>
                        <button type="button" onClick={() => setShowingInfo(null)}
                          className="text-surface-400 hover:text-surface-600 text-xs shrink-0">&times;</button>
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {}
      {configuring && (
        <>
          <div className="fixed inset-0 bg-black/30 dark:bg-black/60 z-[9998]" onClick={() => { setConfiguring(null); setTestResult(null) }} />
          <div className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none">
            <div className="bg-white dark:bg-surface-800 rounded-2xl shadow-2xl p-6 w-96 max-h-[80vh] overflow-y-auto pointer-events-auto">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{TYPE_META[configuring]?.icon ?? '🔌'}</span>
                  <div>
                    <div className="text-sm font-semibold text-surface-800 dark:text-surface-100">
                      {FULL_MARKETPLACE.find(m => m.type === configuring)?.name ?? configuring}
                    </div>
                    <div className="text-[10px] text-surface-400">Configuration</div>
                  </div>
                </div>
                <button type="button" onClick={() => { setConfiguring(null); setTestResult(null) }}
                  className="text-surface-400 hover:text-surface-600 text-lg">&times;</button>
              </div>

              {}
              <div className="space-y-3">
                {(CONFIG_FIELDS[configuring] ?? []).map(field => (
                  <div key={field.key}>
                    <label className="block text-xs font-medium text-surface-600 mb-1">
                      {field.label} {field.required && <span className="text-red-400">*</span>}
                    </label>
                    <input
                      type={field.type}
                      value={configValues[field.key] ?? ''}
                      placeholder={field.placeholder}
                      title={field.label}
                      onChange={e => setConfigValues(v => ({ ...v, [field.key]: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-surface-200 dark:border-surface-600 rounded-lg bg-surface-50 dark:bg-surface-700 text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:border-brand-400"
                    />
                  </div>
                ))}

                {(CONFIG_FIELDS[configuring] ?? []).length === 0 && (
                  <div className="text-sm text-surface-400 text-center py-4">
                    Aucune configuration requise pour cette intégration.
                  </div>
                )}
              </div>

              {}
              {testResult && (
                <div className={`mt-3 px-3 py-2 rounded-lg text-xs font-medium ${
                  testResult.ok
                    ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800/50'
                    : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50'
                }`}>
                  {testResult.ok ? '✓' : '✕'} {testResult.message}
                </div>
              )}

              {}
              <div className="flex items-center gap-2 mt-5">
                <button type="button" onClick={handleTest} disabled={testing}
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-medium border border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors disabled:opacity-50">
                  {testing ? 'Test en cours...' : 'Tester la connexion'}
                </button>
                <button type="button" onClick={handleSave} disabled={saving}
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold bg-brand-500 hover:bg-brand-600 text-white transition-colors disabled:opacity-50">
                  {saving ? 'Sauvegarde...' : 'Sauvegarder'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
