import { useMemo, useState } from 'react'
import {
  ACTION_CATEGORIES,
  ACTION_REGISTRY,
  getActionDefinition,
  type ActionDefinition
} from '../../../shared/actionRegistry'

interface ActionPickerModalProps {
  onClose: () => void
  onSelect: (definition: ActionDefinition) => void
}

export function ActionPickerModal({ onClose, onSelect }: ActionPickerModalProps) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(ACTION_REGISTRY[0]?.id ?? '')
  const normalizedQuery = query.trim().toLocaleLowerCase('vi')

  const filtered = useMemo(() => {
    if (!normalizedQuery) return ACTION_REGISTRY
    return ACTION_REGISTRY.filter((definition) => (
      definition.label.toLocaleLowerCase('vi').includes(normalizedQuery)
      || definition.id.toLocaleLowerCase('vi').includes(normalizedQuery)
    ))
  }, [normalizedQuery])

  const selected = getActionDefinition(selectedId)
  const visibleSelected = selected && filtered.some((item) => item.id === selected.id)
    ? selected
    : filtered[0]

  return (
    <div className="scenario-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="scenario-modal action-picker-modal" role="dialog" aria-modal="true" aria-label="Thêm hành động" onMouseDown={(event) => event.stopPropagation()}>
        <div className="scenario-modal-head action-picker-head">
          <div><p className="scenario-kicker">ACTION REGISTRY · K2</p><h3>Thêm hành động</h3></div>
          <button type="button" onClick={onClose}>×</button>
        </div>

        <label className="action-picker-search">
          <span>⌕</span>
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm hành động hoặc mã action..." />
          <small>{filtered.length}/{ACTION_REGISTRY.length}</small>
        </label>

        <div className="action-picker-body">
          <div className="action-picker-catalog">
            {ACTION_CATEGORIES.map((category) => {
              const actions = filtered.filter((definition) => definition.category === category.id)
              if (!actions.length) return null
              return (
                <section className="action-picker-group" key={category.id}>
                  <div className="action-picker-group-title"><strong>{category.label}</strong><span>{actions.length}</span></div>
                  <div className="action-picker-grid">
                    {actions.map((definition) => (
                      <button
                        className={visibleSelected?.id === definition.id ? 'action-picker-item selected' : 'action-picker-item'}
                        key={definition.id}
                        type="button"
                        onClick={() => setSelectedId(definition.id)}
                        onDoubleClick={() => onSelect(definition)}
                      >
                        <strong>{definition.label}</strong>
                        <span>{definition.id}</span>
                        <small>Chưa chạy thật</small>
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
            {!filtered.length ? <div className="scenario-empty action-picker-empty">Không tìm thấy hành động.</div> : null}
          </div>

          <aside className="action-picker-detail">
            {visibleSelected ? (
              <>
                <div className="action-picker-detail-title">
                  <p className="scenario-kicker">ĐANG CHỌN</p>
                  <h4>{visibleSelected.label}</h4>
                  <code>{visibleSelected.id}</code>
                </div>
                <p className="action-picker-description">{visibleSelected.description}</p>
                <div className="action-picker-meta">
                  <div><span>Nhóm</span><strong>{ACTION_CATEGORIES.find((item) => item.id === visibleSelected.category)?.label}</strong></div>
                  <div><span>Actor</span><strong>{visibleSelected.capabilities.actors.length === 2 ? 'Profile + Page' : 'Profile'}</strong></div>
                  <div><span>Cấu hình</span><strong>{visibleSelected.configSchema.fields.length} trường</strong></div>
                </div>
                <div className="action-placeholder-card">
                  <strong>Khung K2</strong>
                  <p>Registry và schema đã có. Executor riêng của action sẽ được nối ở K3+, không chứa login/session/Page switch.</p>
                </div>
              </>
            ) : <div className="scenario-empty">Chọn một hành động.</div>}
          </aside>
        </div>

        <div className="scenario-modal-actions action-picker-actions">
          <span className="scenario-toolbar-note">Có thể thêm cùng một action nhiều lần với config riêng.</span>
          <button className="scenario-button" type="button" onClick={onClose}>Hủy</button>
          <button className="scenario-button primary" type="button" disabled={!visibleSelected} onClick={() => visibleSelected && onSelect(visibleSelected)}>Chọn hành động</button>
        </div>
      </section>
    </div>
  )
}
