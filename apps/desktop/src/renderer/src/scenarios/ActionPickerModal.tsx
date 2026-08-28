import { useMemo, useState } from 'react'
import {
  ACTION_CATEGORIES,
  ACTION_REGISTRY,
  getActionDefinition,
  type ActionDefinition
} from '../../../shared/actionRegistry'
import { applyActionOverrides } from '../../../shared/actionOverrides'

applyActionOverrides()

interface ActionPickerModalProps {
  onClose: () => void
  onSelect: (definition: ActionDefinition) => void
}

export function ActionPickerModal({ onClose, onSelect }: ActionPickerModalProps) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(ACTION_REGISTRY[0]?.id ?? '')
  const normalizedQuery = query.trim().toLocaleLowerCase('vi')
  const filtered = useMemo(() => normalizedQuery ? ACTION_REGISTRY.filter((definition) => definition.label.toLocaleLowerCase('vi').includes(normalizedQuery) || definition.id.toLocaleLowerCase('vi').includes(normalizedQuery)) : ACTION_REGISTRY, [normalizedQuery])
  const selected = getActionDefinition(selectedId)
  const visibleSelected = selected && filtered.some((item) => item.id === selected.id) ? selected : filtered[0]
  const readyCount = ACTION_REGISTRY.filter((item) => item.runtimeStatus === 'ready').length

  return (
    <div className="scenario-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="scenario-modal action-picker-modal" role="dialog" aria-modal="true" aria-label="Thêm hành động" onMouseDown={(event) => event.stopPropagation()}>
        <div className="scenario-modal-head action-picker-head">
          <div><p className="scenario-kicker">ACTION REGISTRY</p><h3>Thêm hành động</h3></div>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <label className="action-picker-search"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm hành động hoặc mã action..." /><small>{filtered.length}/{ACTION_REGISTRY.length}</small></label>
        <div className="action-picker-body">
          <div className="action-picker-catalog">
            {ACTION_CATEGORIES.map((category) => {
              const actions = filtered.filter((definition) => definition.category === category.id)
              if (!actions.length) return null
              return <section className="action-picker-group" key={category.id}>
                <div className="action-picker-group-title"><strong>{category.label}</strong><span>{actions.length}</span></div>
                <div className="action-picker-grid">{actions.map((definition) => <button className={visibleSelected?.id === definition.id ? 'action-picker-item selected' : 'action-picker-item'} key={definition.id} type="button" onClick={() => setSelectedId(definition.id)} onDoubleClick={() => onSelect(definition)}><strong>{definition.label}</strong><span>{definition.id}</span><small className={definition.runtimeStatus === 'ready' ? 'ready' : ''}>{definition.runtimeStatus === 'ready' ? 'Executor ready' : 'Chưa chạy'}</small></button>)}</div>
              </section>
            })}
            {!filtered.length ? <div className="scenario-empty action-picker-empty">Không tìm thấy hành động.</div> : null}
          </div>
          <aside className="action-picker-detail">
            {visibleSelected ? <>
              <div className="action-picker-detail-title"><p className="scenario-kicker">ĐANG CHỌN</p><h4>{visibleSelected.label}</h4><code>{visibleSelected.id}</code></div>
              <p className="action-picker-description">{visibleSelected.description}</p>
              <div className="action-picker-meta">
                <div><span>Nhóm</span><strong>{ACTION_CATEGORIES.find((item) => item.id === visibleSelected.category)?.label}</strong></div>
                <div><span>Actor</span><strong>{visibleSelected.capabilities.actors.length === 2 ? 'Profile + Page' : 'Profile'}</strong></div>
                <div><span>Cấu hình</span><strong>{visibleSelected.configSchema.fields.length} trường</strong></div>
                <div><span>Runtime</span><strong>{visibleSelected.runtimeStatus === 'ready' ? 'Executor sẵn sàng' : 'Placeholder'}</strong></div>
              </div>
              <div className={visibleSelected.runtimeStatus === 'ready' ? 'action-placeholder-card ready-card' : 'action-placeholder-card'}><strong>{visibleSelected.runtimeStatus === 'ready' ? 'Module riêng đã có executor' : 'Chưa có executor'}</strong><p>{visibleSelected.runtimeStatus === 'ready' ? 'Selector/flow nằm riêng trong module action; login/session/Page switch vẫn dùng Common Runtime.' : `Hiện có ${readyCount} action đã có executor. Action này sẽ làm ở lô sau.`}</p></div>
            </> : <div className="scenario-empty">Chọn một hành động.</div>}
          </aside>
        </div>
        <div className="scenario-modal-actions action-picker-actions"><span className="scenario-toolbar-note">Có thể thêm cùng một action nhiều lần với config riêng.</span><button className="scenario-button" type="button" onClick={onClose}>Hủy</button><button className="scenario-button primary" type="button" disabled={!visibleSelected} onClick={() => visibleSelected && onSelect(visibleSelected)}>Chọn hành động</button></div>
      </section>
    </div>
  )
}
