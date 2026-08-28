import { useMemo, useState } from 'react'
import {
  ACTION_CATEGORIES,
  validateActionConfig,
  type ActionConfig,
  type ActionConfigFieldDefinition,
  type ActionDefinition
} from '../../../shared/actionRegistry'

export interface ActionEditorValue {
  id: number | null
  definition?: ActionDefinition
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

function ConfigField({ field, value, onChange }: {
  field: ActionConfigFieldDefinition
  value: ActionConfig[string] | undefined
  onChange: (value: ActionConfig[string] | undefined) => void
}) {
  if (field.kind === 'boolean') {
    return (
      <label className="scenario-check action-config-check">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span>{field.label}</span>
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
          if (field.kind === 'number') {
            onChange(event.target.value === '' ? undefined : Number(event.target.value))
          } else {
            onChange(event.target.value)
          }
        }}
      />
      {field.help ? <small className="action-config-help">{field.help}</small> : null}
    </label>
  )
}

export function ActionConfigModal({ value, onClose, onSave }: ActionConfigModalProps) {
  const [label, setLabel] = useState(value.label)
  const [enabled, setEnabled] = useState(value.enabled)
  const [config, setConfig] = useState<ActionConfig>(value.config)
  const definition = value.definition
  const validation = useMemo(
    () => definition ? validateActionConfig(definition.id, config) : { valid: true as const, value: config, errors: [] as [] },
    [config, definition]
  )

  const setField = (key: string, nextValue: ActionConfig[string] | undefined) => {
    setConfig((current) => {
      const next = { ...current }
      if (nextValue === undefined) delete next[key]
      else next[key] = nextValue
      return next
    })
  }

  const submit = () => {
    if (!label.trim() || !validation.valid) return
    onSave({ ...value, label: label.trim(), enabled, config }, validation.value)
  }

  return (
    <div className="scenario-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="scenario-modal action-config-modal" role="dialog" aria-modal="true" aria-label="Cấu hình hành động" onMouseDown={(event) => event.stopPropagation()}>
        <div className="scenario-modal-head">
          <div><p className="scenario-kicker">CẤU HÌNH ACTION · K2</p><h3>{value.id === null ? 'Thêm hành động' : 'Sửa hành động'}</h3></div>
          <button type="button" onClick={onClose}>×</button>
        </div>

        <div className="action-config-summary">
          <div><strong>{definition?.label ?? value.label}</strong><code>{value.actionType}</code></div>
          <div className="action-config-badges">
            <span>{value.categoryLabel}</span>
            <span>{definition?.capabilities.actors.length === 2 ? 'Profile + Page' : 'Profile'}</span>
            <span className="placeholder">Chưa chạy thật</span>
          </div>
        </div>

        <div className="action-config-form">
          <label className="scenario-field wide"><span>Tên hiển thị</span><input autoFocus value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} /></label>
          <label className="scenario-check modal-check"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>Bật action trong kịch bản</span></label>

          {definition?.configSchema.fields.length ? (
            <div className="action-config-fields">
              {definition.configSchema.fields.map((field) => <ConfigField key={field.key} field={field} value={config[field.key]} onChange={(next) => setField(field.key, next)} />)}
            </div>
          ) : (
            <div className="scenario-placeholder-note">Action này chưa có trường cấu hình nghiệp vụ ở K2. Schema rỗng vẫn được version hóa để K3 bổ sung mà không đổi UI quản lý kịch bản.</div>
          )}

          {!definition ? <div className="scenario-placeholder-note warning">Action cũ không có trong registry K2. Có thể đổi tên/bật tắt, nhưng không chỉnh config cho tới khi được map vào registry.</div> : null}
          {!validation.valid ? <div className="action-config-errors">{validation.errors.map((item) => <span key={item}>{item}</span>)}</div> : null}
        </div>

        <div className="scenario-modal-actions">
          <span className="scenario-toolbar-note">Không lưu password, cookie, 2FA hoặc token trong config.</span>
          <button className="scenario-button" type="button" onClick={onClose}>Hủy</button>
          <button className="scenario-button primary" type="button" disabled={!label.trim() || !validation.valid} onClick={submit}>{value.id === null ? 'Thêm hành động' : 'Lưu thay đổi'}</button>
        </div>
      </section>
    </div>
  )
}
