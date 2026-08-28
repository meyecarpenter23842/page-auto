import { useMemo, useState } from 'react'
import {
  validateActionConfig,
  type ActionConfig,
  type ActionConfigFieldDefinition,
  type ActionDefinition
} from '../../../shared/actionRegistry'
import {
  applyActionOverrides,
  getActionFieldUiMeta,
  getActionOverrideValidationErrors
} from '../../../shared/actionOverrides'
import { REACTION_OPTIONS, buildActionConfigLayout, getRangeLabel } from './actionConfigLayout'
import './k41ActionConfig.css'

applyActionOverrides()

export interface ActionEditorValue {
  id: number | null
  definition?: ActionDefinition | undefined
  actionType: string
  categoryLabel: string
  label: string
  enabled: boolean
  config: ActionConfig
}

interface ActionConfigModalProps {
  value: ActionEditorValue
  onClose: () => void
  onSave: (value: ActionEditorValue, normalizedConfig?: ActionConfig) => void
}

const REACTION_ICONS = Object.fromEntries(REACTION_OPTIONS.map((item) => [item.key, item])) as Readonly<Record<string, { icon: string; label: string }>>

function NumberInput({ field, value, onChange }: {
  field: ActionConfigFieldDefinition
  value: ActionConfig[string] | undefined
  onChange: (value: ActionConfig[string] | undefined) => void
}) {
  return (
    <input
      type="number"
      min={field.min}
      max={field.max}
      value={value === undefined ? '' : String(value)}
      onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
    />
  )
}

function ConfigField({ actionType, field, value, onChange }: {
  actionType: string
  field: ActionConfigFieldDefinition
  value: ActionConfig[string] | undefined
  onChange: (value: ActionConfig[string] | undefined) => void
}) {
  const ui = getActionFieldUiMeta(actionType, field.key)
  if (field.kind === 'boolean') {
    return (
      <label className="scenario-check action-config-check">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span>{field.label}</span>
        {field.help ? <small className="action-config-help inline-help">{field.help}</small> : null}
      </label>
    )
  }

  if (field.kind === 'select') {
    return (
      <label className="scenario-field">
        <span>{field.label}</span>
        <select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}>
          <option value="">Chọn...</option>
          {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {field.help ? <small className="action-config-help">{field.help}</small> : null}
      </label>
    )
  }

  if (field.kind === 'text' && ui?.multiline) {
    return (
      <label className="scenario-field action-config-textarea">
        <span>{field.label}{field.required ? ' *' : ''}</span>
        <textarea
          rows={Math.min(ui.rows ?? 3, 3)}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
        {field.help ? <small className="action-config-help">{field.help}</small> : null}
      </label>
    )
  }

  return (
    <label className="scenario-field">
      <span>{field.label}{field.required ? ' *' : ''}</span>
      <input
        type={field.kind === 'number' ? 'number' : 'text'}
        min={field.min}
        max={field.max}
        maxLength={field.maxLength}
        placeholder={field.placeholder}
        value={value === undefined ? '' : String(value)}
        onChange={(event) => {
          if (field.kind === 'number') onChange(event.target.value === '' ? undefined : Number(event.target.value))
          else onChange(event.target.value)
        }}
      />
      {field.help ? <small className="action-config-help">{field.help}</small> : null}
    </label>
  )
}

function RangeField({ min, max, config, setField }: {
  min: ActionConfigFieldDefinition
  max: ActionConfigFieldDefinition
  config: ActionConfig
  setField: (key: string, value: ActionConfig[string] | undefined) => void
}) {
  const help = min.help === max.help ? min.help : undefined
  return (
    <div className="action-config-range">
      <span className="action-config-range-label">{getRangeLabel(min.label, max.label)}</span>
      <div className="action-config-range-controls">
        <label><small>Từ</small><NumberInput field={min} value={config[min.key]} onChange={(next) => setField(min.key, next)} /></label>
        <span className="action-config-range-arrow">→</span>
        <label><small>Đến</small><NumberInput field={max} value={config[max.key]} onChange={(next) => setField(max.key, next)} /></label>
        {help ? <small className="action-config-range-unit">{help}</small> : null}
      </div>
    </div>
  )
}

function ReactionField({ fields, config, setField }: {
  fields: ActionConfigFieldDefinition[]
  config: ActionConfig
  setField: (key: string, value: ActionConfig[string] | undefined) => void
}) {
  return (
    <div className="action-reaction-field">
      <span className="action-config-range-label">Loại cảm xúc</span>
      <div className="action-reaction-options">
        {fields.map((field) => {
          const meta = REACTION_ICONS[field.key]
          if (!meta) return null
          const checked = Boolean(config[field.key])
          return (
            <label key={field.key} className={`action-reaction-option${checked ? ' selected' : ''}`} title={meta.label}>
              <input type="checkbox" checked={checked} onChange={(event) => setField(field.key, event.target.checked)} />
              <span aria-hidden="true">{meta.icon}</span>
              <small>{meta.label}</small>
            </label>
          )
        })}
      </div>
    </div>
  )
}

export function ActionConfigModal({ value, onClose, onSave }: ActionConfigModalProps) {
  const [label, setLabel] = useState(value.label)
  const [enabled, setEnabled] = useState(value.enabled)
  const [config, setConfig] = useState<ActionConfig>(value.config)
  const definition = value.definition
  const baseValidation = useMemo(
    () => definition ? validateActionConfig(definition.id, config) : { valid: true as const, value: config, errors: [] as [] },
    [config, definition]
  )
  const extraErrors = useMemo(
    () => definition ? getActionOverrideValidationErrors(definition.id, baseValidation.value) : [],
    [baseValidation.value, definition]
  )
  const valid = baseValidation.valid && extraErrors.length === 0

  const visibleSections = useMemo(() => {
    const sections = new Map<string, ActionConfigFieldDefinition[]>()
    for (const field of definition?.configSchema.fields ?? []) {
      const ui = getActionFieldUiMeta(definition?.id ?? '', field.key)
      if (ui?.visibleWhen && config[ui.visibleWhen.key] !== ui.visibleWhen.equals) continue
      const section = ui?.section ?? 'Cấu hình'
      const current = sections.get(section) ?? []
      current.push(field)
      sections.set(section, current)
    }
    return [...sections.entries()].map(([section, fields]) => [section, buildActionConfigLayout(fields)] as const)
  }, [config, definition])

  const visibleFieldCount = visibleSections.reduce((total, [, units]) => total + units.reduce((sum, unit) => sum + (unit.kind === 'range' ? 2 : unit.kind === 'reactions' ? unit.fields.length : 1), 0), 0)

  const setField = (key: string, nextValue: ActionConfig[string] | undefined) => {
    setConfig((current) => {
      const next = { ...current }
      if (nextValue === undefined) delete next[key]
      else next[key] = nextValue
      return next
    })
  }

  const submit = () => {
    if (!label.trim() || !valid) return
    onSave({ ...value, label: label.trim(), enabled, config }, baseValidation.value)
  }

  const runtimeReady = definition?.runtimeStatus === 'ready'

  return (
    <div className="scenario-modal-backdrop action-config-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={`scenario-modal action-config-modal k41-action-config-modal${visibleFieldCount >= 12 ? ' dense' : ''}`} role="dialog" aria-modal="true" aria-label="Cấu hình hành động" onMouseDown={(event) => event.stopPropagation()}>
        <div className="scenario-modal-head">
          <div><p className="scenario-kicker">CẤU HÌNH ACTION</p><h3>{value.id === null ? 'Thêm hành động' : 'Sửa hành động'}</h3></div>
          <button type="button" onClick={onClose}>×</button>
        </div>

        <div className="action-config-summary">
          <div><strong>{definition?.label ?? value.label}</strong><code>{value.actionType}</code></div>
          <div className="action-config-badges">
            <span>{value.categoryLabel}</span>
            <span>{definition?.capabilities.actors.length === 2 ? 'Profile + Page' : 'Profile'}</span>
            <span className={runtimeReady ? 'ready' : 'placeholder'}>{runtimeReady ? 'Executor sẵn sàng' : 'Chưa chạy thật'}</span>
          </div>
        </div>

        <div className="action-config-form">
          <div className="k41-action-header-row">
            <label className="scenario-field wide"><span>Tên hiển thị</span><input autoFocus value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} /></label>
            <label className="scenario-check modal-check"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>Bật action</span></label>
          </div>

          {visibleSections.length ? (
            <div className="k41-action-sections">
              {visibleSections.map(([section, units]) => (
                <section className="k41-action-section" key={section}>
                  <div className="k41-action-section-title">{section}</div>
                  <div className="action-config-fields k41-action-grid">
                    {units.map((unit) => {
                      if (unit.kind === 'range') return <RangeField key={`${unit.min.key}:${unit.max.key}`} min={unit.min} max={unit.max} config={config} setField={setField} />
                      if (unit.kind === 'reactions') return <ReactionField key="reaction-options" fields={unit.fields} config={config} setField={setField} />
                      return <ConfigField key={unit.field.key} actionType={value.actionType} field={unit.field} value={config[unit.field.key]} onChange={(next) => setField(unit.field.key, next)} />
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : <div className="scenario-placeholder-note">Action này chưa có trường cấu hình nghiệp vụ.</div>}

          {!definition ? <div className="scenario-placeholder-note warning">Action cũ không có trong registry. Có thể đổi tên/bật tắt, nhưng chưa chỉnh được config.</div> : null}
          {!baseValidation.valid || extraErrors.length ? (
            <div className="action-config-errors">{[...baseValidation.errors, ...extraErrors].map((item) => <span key={item}>{item}</span>)}</div>
          ) : null}
        </div>

        <div className="scenario-modal-actions">
          <span className="scenario-toolbar-note">Config không lưu password, cookie, 2FA hoặc token.</span>
          <button className="scenario-button" type="button" onClick={onClose}>Hủy</button>
          <button className="scenario-button primary" type="button" disabled={!label.trim() || !valid} onClick={submit}>{value.id === null ? 'Thêm hành động' : 'Lưu thay đổi'}</button>
        </div>
      </section>
    </div>
  )
}
