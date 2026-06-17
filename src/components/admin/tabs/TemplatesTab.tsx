'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { Mission, MissionType, MISSION_TYPE_HEX } from '@/lib/types'
import { MissionTemplate, expandTemplate, recurrenceLabel, getNextOccurrence } from '@/lib/missionTemplates'
import { formatDuration } from '@/lib/algorithm'
import { SYNTHETIC_TYPES } from '../types'
import { useTrade } from '@/providers/TradeProvider'
import { Btn, Modal, Field, Input, SelectInput } from '../ui'
import { addDays, useDebounce } from '../hooks'
import { useToast } from '@/components/ui/Toast'

const BLANK_TEMPLATE: Omit<MissionTemplate, 'id'> = {
  label: '',
  type: 'POSER',
  address: '',
  latitude: 0,
  longitude: 0,
  estimatedDurationMin: 45,
  maneuverTimeMin: 10,
  recurrence: { kind: 'weekly', weekDays: [1] },
  startDate: new Date().toISOString().split('T')[0],
  enabled: true,
}

const DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

function rowToTemplate(row: Record<string, unknown>): MissionTemplate {
  return {
    id:                   row.id as string,
    label:                row.label as string,
    enabled:              row.enabled as boolean,
    type:                 row.type as MissionType,
    recurrence:           row.recurrence as MissionTemplate['recurrence'],
    address:              row.address as string,
    latitude:             row.latitude as number,
    longitude:            row.longitude as number,
    clientName:           (row.clientName as string) || undefined,
    estimatedDurationMin: row.estimatedDurationMin as number,
    maneuverTimeMin:      row.maneuverTimeMin as number,
    wasteTypeLabel:       (row.wasteTypeLabel as string) || undefined,
    binSize:              (row.binSize as string) || undefined,
    binSizeM3:            (row.binSizeM3 as number) ?? undefined,
    accessNotes:          (row.accessNotes as string) || undefined,
    priority:             [1, 2, 3].includes(row.priority as number) ? (row.priority as 1|2|3) : undefined,
    timeWindow:           row.timeWindow ? (row.timeWindow as MissionTemplate['timeWindow']) : undefined,
    linkedExutoireId:     (row.linkedExutoireId as string) || undefined,
    startDate:            row.startDate as string,
    endDate:              (row.endDate as string) || undefined,
  }
}

export function TemplatesTab({ onGenerate }: { onGenerate: (_missions: Array<Omit<Mission, 'id'>>) => void }) {
  const { missionIcon, missionLabel, enabledTypes } = useTrade()
  const { error: toastError } = useToast()
  const poolTypes = enabledTypes.filter(t => !SYNTHETIC_TYPES.includes(t))

  const [templates, setTemplates] = useState<MissionTemplate[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/templates')
      .then(r => r.json())
      .then(d => setTemplates((Array.isArray(d) ? d : []).map(rowToTemplate)))
      .catch(() => toastError('Impossible de charger les templates'))
      .finally(() => setLoading(false))
  }, [toastError])

  useEffect(() => { load() }, [load])

  const [tplSearch, setTplSearch] = useState('')
  const debouncedTplSearch = useDebounce(tplSearch, 200)
  const [tplTypeFilter, setTplTypeFilter] = useState<string>('all')
  const [tplRecurrenceFilter, setTplRecurrenceFilter] = useState<string>('all')
  const [tplStatusFilter, setTplStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

  const filteredTemplates = useMemo(() => {
    const q = debouncedTplSearch.toLowerCase()
    return templates.filter(t => {
      if (q && !`${t.label} ${t.address} ${t.clientName ?? ''}`.toLowerCase().includes(q)) return false
      if (tplTypeFilter !== 'all' && t.type !== tplTypeFilter) return false
      if (tplRecurrenceFilter !== 'all' && t.recurrence.kind !== tplRecurrenceFilter) return false
      if (tplStatusFilter === 'active' && !t.enabled) return false
      if (tplStatusFilter === 'inactive' && t.enabled) return false
      return true
    })
  }, [templates, debouncedTplSearch, tplTypeFilter, tplRecurrenceFilter, tplStatusFilter])

  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Omit<MissionTemplate, 'id'>>(BLANK_TEMPLATE)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [genFrom, setGenFrom] = useState(new Date().toISOString().split('T')[0])
  const [genTo, setGenTo]     = useState(addDays(new Date().toISOString().split('T')[0], 7))
  const [genResult, setGenResult] = useState<string | null>(null)
  const [geocoding, setGeocoding] = useState(false)

  async function handleGeocode() {
    const q = form.address.trim()
    if (!q) return
    setGeocoding(true)
    try {
      const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`
      const res = await fetch(url)
      const data = await res.json()
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].geometry.coordinates
        setForm(p => ({ ...p, latitude: lat, longitude: lng }))
      }
    } catch {  }
    finally { setGeocoding(false) }
  }

  function openNew() {
    setForm(BLANK_TEMPLATE)
    setEditingId(null)
    setShowForm(true)
  }

  function openEdit(t: MissionTemplate) {
    const { id: _id, ...rest } = t
    setForm(rest)
    setEditingId(t.id)
    setShowForm(true)
  }

  async function saveForm() {
    if (!form.label || !form.address) return
    setSaving(true)
    try {
      if (editingId) {
        const res = await fetch(`/api/templates/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        if (!res.ok) throw new Error()
      } else {
        const res = await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        if (!res.ok) throw new Error()
      }
      setShowForm(false)
      load()
    } catch {
      toastError('Erreur lors de la sauvegarde du template')
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(t: MissionTemplate) {
    try {
      await fetch(`/api/templates/${t.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !t.enabled }),
      })
      load()
    } catch {
      toastError('Erreur lors de la mise à jour')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer ce template ?')) return
    try {
      await fetch(`/api/templates/${id}`, { method: 'DELETE' })
      load()
    } catch {
      toastError('Erreur lors de la suppression')
    }
  }

  function toggleWeekDay(d: number) {
    const rule = form.recurrence
    if (rule.kind !== 'weekly') return
    const days = rule.weekDays.includes(d) ? rule.weekDays.filter(x => x !== d) : [...rule.weekDays, d]
    setForm(p => ({ ...p, recurrence: { kind: 'weekly', weekDays: days } }))
  }

  function generateMissions() {
    let total = 0
    for (const tpl of templates.filter(t => t.enabled)) {
      const missions = expandTemplate(tpl, genFrom, genTo)
      if (missions.length > 0) {
        onGenerate(missions)
        total += missions.length
      }
    }
    setGenResult(total > 0 ? `✓ ${total} mission(s) générée(s) du ${genFrom} au ${genTo}` : 'Aucune occurrence dans cette période.')
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 md:gap-3 px-2 md:px-4 py-2.5 border-b border-surface-200 flex-shrink-0 flex-wrap">
        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">
          {templates.length} template{templates.length !== 1 ? 's' : ''}
        </span>
        <input value={tplSearch} onChange={e => setTplSearch(e.target.value)} placeholder="Rechercher…"
          className="bg-surface-100 border border-surface-200 rounded-lg px-3 py-1 text-surface-900 placeholder-surface-400 text-xs focus:outline-none focus:border-[#0055A4] w-36 md:w-48" />
        <select value={tplTypeFilter} onChange={e => setTplTypeFilter(e.target.value)}
          title="Filtrer par type de mission"
          className="bg-surface-100 border border-surface-200 rounded-lg px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]">
          <option value="all">Tous les types</option>
          {poolTypes.map(t => <option key={t} value={t}>{missionLabel(t)}</option>)}
        </select>
        <select value={tplRecurrenceFilter} onChange={e => setTplRecurrenceFilter(e.target.value)}
          title="Filtrer par récurrence"
          className="bg-surface-100 border border-surface-200 rounded-lg px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]">
          <option value="all">Toutes récurrences</option>
          <option value="daily">Quotidien</option>
          <option value="weekly">Hebdomadaire</option>
          <option value="monthly">Mensuel</option>
        </select>
        <select value={tplStatusFilter} onChange={e => setTplStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
          title="Filtrer par statut"
          className="bg-surface-100 border border-surface-200 rounded-lg px-2 py-1 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]">
          <option value="all">Tous statuts</option>
          <option value="active">Actifs</option>
          <option value="inactive">Inactifs</option>
        </select>
        <div className="ml-auto">
          <Btn onClick={openNew} variant="primary" size="sm">+ Nouveau template</Btn>
        </div>
      </div>
    <div className="flex-1 overflow-auto px-3 md:px-6 py-4 md:py-6 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-surface-900 font-bold text-sm uppercase tracking-wider">Missions récurrentes</h2>
          <p className="text-surface-400 text-xs mt-0.5">Définissez des modèles de missions qui se répètent automatiquement.</p>
        </div>
      </div>

      <div className="bg-white border border-surface-200 rounded-xl p-4">
        <div className="text-surface-500 text-xs font-semibold uppercase tracking-wider mb-3">Générer les missions pour une période</div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-surface-400 text-xs">Du</span>
            <input type="date" value={genFrom} onChange={e => setGenFrom(e.target.value)} title="Date début génération"
              className="bg-surface-100 border border-surface-200 rounded-lg px-2.5 py-1.5 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-surface-400 text-xs">au</span>
            <input type="date" value={genTo} onChange={e => setGenTo(e.target.value)} title="Date fin génération"
              className="bg-surface-100 border border-surface-200 rounded-lg px-2.5 py-1.5 text-surface-900 text-xs focus:outline-none focus:border-[#0055A4]" />
          </div>
          <Btn onClick={generateMissions} variant="success" size="sm"
            disabled={templates.filter(t => t.enabled).length === 0}>
            ⚡ Générer
          </Btn>
          {genResult && (
            <span className={`text-xs ${genResult.startsWith('✓') ? 'text-green-400' : 'text-yellow-400'}`}>{genResult}</span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-surface-400 text-sm">Chargement...</div>
      ) : filteredTemplates.length === 0 ? (
        <div className="text-center py-16 text-surface-400">
          <div className="text-5xl mb-3">🔁</div>
          <p>{templates.length === 0 ? 'Aucun template. Créez votre premier modèle de mission récurrente.' : 'Aucun template ne correspond aux filtres.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTemplates.map(t => {
            const next = getNextOccurrence(t)
            return (
              <div key={t.id} className={`bg-white border rounded-xl p-4 flex items-start gap-4 transition-all
                ${t.enabled ? 'border-surface-200' : 'border-surface-200/40 opacity-50'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-surface-900 text-sm">{t.label}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: MISSION_TYPE_HEX[t.type] + '25', color: MISSION_TYPE_HEX[t.type] }}>
                      {missionIcon(t.type)} {missionLabel(t.type)}
                    </span>
                    {t.priority === 1 && <span className="text-[10px] bg-red-50 text-red-700 px-1.5 py-0.5 rounded">🔥 P1</span>}
                  </div>
                  <div className="text-xs text-surface-500 mt-1 truncate">{t.address}</div>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-surface-400 flex-wrap">
                    <span>🔁 {recurrenceLabel(t.recurrence)}</span>
                    <span>Début {t.startDate}{t.endDate ? ` → ${t.endDate}` : ''}</span>
                    {next && <span className="text-blue-400">Prochaine : {next}</span>}
                    <span>{formatDuration(t.estimatedDurationMin + t.maneuverTimeMin)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button type="button"
                    onClick={() => toggleEnabled(t)}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                      t.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-surface-100 text-surface-400 border-surface-200'}`}>
                    {t.enabled ? '✓ Actif' : '○ Inactif'}
                  </button>
                  <Btn onClick={() => openEdit(t)} variant="ghost" size="xs">✏</Btn>
                  <Btn onClick={() => handleDelete(t.id)} variant="danger" size="xs">✕</Btn>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <Modal title={editingId ? 'Modifier le template' : 'Nouveau template'} onClose={() => setShowForm(false)}>
          <Field label="Nom du template">
            <Input value={form.label} onChange={v => setForm(p => ({ ...p, label: v }))} placeholder="Collecte hebdo Aldi Rumilly" />
          </Field>
          <Field label="Type de mission">
            <SelectInput value={form.type} onChange={v => setForm(p => ({ ...p, type: v as MissionType }))}
              options={poolTypes.map(t => ({ value: t, label: `${missionIcon(t)} ${missionLabel(t)}` }))} />
          </Field>
          <Field label="Client / Nom">
            <Input value={form.clientName ?? ''} onChange={v => setForm(p => ({ ...p, clientName: v || undefined }))} placeholder="Aldi Rumilly" />
          </Field>
          <Field label="Adresse">
            <div className="flex gap-2">
              <Input value={form.address} onChange={v => setForm(p => ({ ...p, address: v }))} placeholder="15 rue de la Paix, 74150 Rumilly" />
              <button type="button" onClick={handleGeocode} disabled={geocoding}
                className="flex-shrink-0 px-2 py-1 rounded text-xs font-medium bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-40 transition-colors whitespace-nowrap">
                {geocoding ? '…' : '📍 GPS'}
              </button>
            </div>
            {(form.latitude !== 0 || form.longitude !== 0) && (
              <div className="text-[10px] text-green-400 mt-1">✓ GPS : {form.latitude.toFixed(4)}, {form.longitude.toFixed(4)}</div>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Durée (min)">
              <Input type="number" value={String(form.estimatedDurationMin)} onChange={v => setForm(p => ({ ...p, estimatedDurationMin: parseInt(v) || 30 }))} />
            </Field>
            <Field label="Manœuvre (min)">
              <Input type="number" value={String(form.maneuverTimeMin)} onChange={v => setForm(p => ({ ...p, maneuverTimeMin: parseInt(v) || 0 }))} />
            </Field>
          </div>
          <Field label="Priorité">
            <SelectInput value={String(form.priority ?? 2)} onChange={v => setForm(p => ({ ...p, priority: Number(v) as 1|2|3 }))}
              options={[{ value: '1', label: '🔥 P1 — Urgent' }, { value: '2', label: '▶ P2 — Normal' }, { value: '3', label: '▽ P3 — Peut attendre' }]} />
          </Field>
          <Field label="Type de récurrence">
            <SelectInput
              value={form.recurrence.kind}
              onChange={v => {
                if (v === 'daily')   setForm(p => ({ ...p, recurrence: { kind: 'daily', everyN: 1 } }))
                if (v === 'weekly')  setForm(p => ({ ...p, recurrence: { kind: 'weekly', weekDays: [1] } }))
                if (v === 'monthly') setForm(p => ({ ...p, recurrence: { kind: 'monthly', dayOfMonth: 1 } }))
              }}
              options={[
                { value: 'daily',   label: 'Tous les N jours' },
                { value: 'weekly',  label: 'Hebdomadaire (jours spécifiques)' },
                { value: 'monthly', label: 'Mensuel (jour du mois)' },
              ]}
            />
          </Field>
          {form.recurrence.kind === 'daily' && (
            <Field label="Tous les N jours">
              <Input type="number" min="1" value={String(form.recurrence.everyN)}
                onChange={v => setForm(p => ({ ...p, recurrence: { kind: 'daily', everyN: Math.max(1, parseInt(v) || 1) } }))} />
            </Field>
          )}
          {form.recurrence.kind === 'weekly' && (
            <Field label="Jours de la semaine">
              <div className="flex gap-1.5 flex-wrap">
                {DAYS_FR.map((d, i) => (
                  <button key={i} type="button" onClick={() => toggleWeekDay(i)}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors
                      ${(form.recurrence as { kind: 'weekly'; weekDays: number[] }).weekDays.includes(i)
                        ? 'bg-[#0055A4] text-surface-900' : 'bg-surface-100 text-surface-400 border border-surface-200 hover:text-surface-600'}`}>
                    {d}
                  </button>
                ))}
              </div>
            </Field>
          )}
          {form.recurrence.kind === 'monthly' && (
            <Field label="Jour du mois (1-28)">
              <Input type="number" min="1" max="28" value={String((form.recurrence as { kind: 'monthly'; dayOfMonth: number }).dayOfMonth)}
                onChange={v => setForm(p => ({ ...p, recurrence: { kind: 'monthly', dayOfMonth: Math.min(28, Math.max(1, parseInt(v) || 1)) } }))} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date de début">
              <Input type="date" value={form.startDate} onChange={v => setForm(p => ({ ...p, startDate: v }))} />
            </Field>
            <Field label="Date de fin (optionnel)">
              <Input type="date" value={form.endDate ?? ''} onChange={v => setForm(p => ({ ...p, endDate: v || undefined }))} />
            </Field>
          </div>
          <div className="flex gap-2 pt-2 border-t border-surface-200">
            <Btn onClick={saveForm} variant="primary" size="sm" disabled={saving || !form.label || !form.address}>
              {saving ? 'Enregistrement...' : editingId ? '✓ Enregistrer' : '+ Créer le template'}
            </Btn>
            <Btn onClick={() => setShowForm(false)} variant="ghost" size="sm">Annuler</Btn>
          </div>
        </Modal>
      )}
    </div>
    </div>
  )
}
