'use client'

export interface FormFieldDef {
  key:       string
  label:     string
  type:      'text' | 'number' | 'select' | 'checkbox' | 'textarea'
  required?: boolean
  options?:  string[]
  min?:      number
  max?:      number
}

interface Props {
  fields:   FormFieldDef[]
  values:   Record<string, unknown>
  onChange: (_key: string, _value: unknown) => void
  compact?: boolean
}

export function InterventionFormRenderer({ fields, values, onChange, compact }: Props) {
  if (fields.length === 0) return null

  return (
    <div className={`space-y-${compact ? '2' : '4'}`}>
      {fields.map(f => (
        <div key={f.key}>
          <label className={`block font-semibold text-surface-700 mb-1 ${compact ? 'text-xs' : 'text-sm'}`}>
            {f.label}
            {f.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>

          {f.type === 'text' && (
            <input
              type="text"
              value={String(values[f.key] ?? '')}
              onChange={e => onChange(f.key, e.target.value)}
              required={f.required}
              className="w-full bg-surface-100 border border-surface-200 rounded-lg px-3 py-2 text-sm text-surface-900 focus:outline-none focus:border-[#0055A4] transition-colors"
            />
          )}

          {f.type === 'textarea' && (
            <textarea
              value={String(values[f.key] ?? '')}
              onChange={e => onChange(f.key, e.target.value)}
              required={f.required}
              rows={compact ? 2 : 3}
              className="w-full bg-surface-100 border border-surface-200 rounded-lg px-3 py-2 text-sm text-surface-900 focus:outline-none focus:border-[#0055A4] transition-colors resize-none"
            />
          )}

          {f.type === 'number' && (
            <input
              type="number"
              value={String(values[f.key] ?? '')}
              onChange={e => onChange(f.key, e.target.value === '' ? '' : Number(e.target.value))}
              required={f.required}
              min={f.min}
              max={f.max}
              className="w-full bg-surface-100 border border-surface-200 rounded-lg px-3 py-2 text-sm text-surface-900 focus:outline-none focus:border-[#0055A4] transition-colors"
            />
          )}

          {f.type === 'select' && (
            <select
              value={String(values[f.key] ?? '')}
              onChange={e => onChange(f.key, e.target.value)}
              required={f.required}
              title={f.label}
              className="w-full bg-surface-100 border border-surface-200 rounded-lg px-3 py-2 text-sm text-surface-900 focus:outline-none focus:border-[#0055A4] transition-colors"
            >
              <option value="">— Sélectionner —</option>
              {(f.options ?? []).map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          )}

          {f.type === 'checkbox' && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(values[f.key])}
                onChange={e => onChange(f.key, e.target.checked)}
                className="w-4 h-4 rounded border-surface-300 text-[#0055A4] focus:ring-[#0055A4]"
              />
              <span className="text-sm text-surface-600">{f.label}</span>
            </label>
          )}
        </div>
      ))}
    </div>
  )
}

interface EditorProps {
  fields:    FormFieldDef[]
  onChange:  (_fields: FormFieldDef[]) => void
}

const FIELD_TYPES: FormFieldDef['type'][] = ['text', 'textarea', 'number', 'select', 'checkbox']

export function InterventionFormEditor({ fields, onChange }: EditorProps) {
  function addField() {
    onChange([...fields, {
      key:      `field_${Date.now()}`,
      label:    'Nouveau champ',
      type:     'text',
      required: false,
    }])
  }

  function updateField(idx: number, patch: Partial<FormFieldDef>) {
    onChange(fields.map((f, i) => i === idx ? { ...f, ...patch } : f))
  }

  function removeField(idx: number) {
    onChange(fields.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-3">
      {fields.map((f, idx) => (
        <div key={f.key} className="bg-surface-50 border border-surface-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={f.label}
              onChange={e => updateField(idx, { label: e.target.value })}
              placeholder="Label du champ"
              className="flex-1 bg-white border border-surface-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#0055A4]"
            />
            <select value={f.type} onChange={e => updateField(idx, { type: e.target.value as FormFieldDef['type'] })}
              title="Type de champ"
              className="bg-white border border-surface-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#0055A4]">
              {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs text-surface-600 cursor-pointer">
              <input type="checkbox" checked={f.required ?? false}
                onChange={e => updateField(idx, { required: e.target.checked })} />
              Requis
            </label>
            <button type="button" onClick={() => removeField(idx)}
              className="text-red-400 hover:text-red-600 transition-colors text-sm px-2">
              ✕
            </button>
          </div>

          {f.type === 'select' && (
            <div>
              <label className="text-xs text-surface-500 mb-1 block">Options (une par ligne)</label>
              <textarea
                value={(f.options ?? []).join('\n')}
                onChange={e => updateField(idx, { options: e.target.value.split('\n').filter(Boolean) })}
                rows={3}
                placeholder="Option A&#10;Option B&#10;Option C"
                className="w-full bg-white border border-surface-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#0055A4] resize-none"
              />
            </div>
          )}
        </div>
      ))}

      <button type="button" onClick={addField}
        className="w-full py-2 border-2 border-dashed border-surface-200 rounded-xl text-sm text-surface-400 hover:border-[#0055A4] hover:text-[#0055A4] transition-colors">
        + Ajouter un champ
      </button>
    </div>
  )
}
