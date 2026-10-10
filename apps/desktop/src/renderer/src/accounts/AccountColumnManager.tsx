import { useState } from 'react'
import type { AccountColumnLayout } from '../../../shared/accounts'
import { columnById, defaultLayout, type ColumnId } from './accountManagerModel'

export interface ColumnManagerProps {
  layout: AccountColumnLayout
  onChange: (layout: AccountColumnLayout) => void
  onClose: () => void
}

export function ColumnManager({ layout, onChange, onClose }: ColumnManagerProps) {
  const [query, setQuery] = useState('')
  const visibleCount = layout.order.filter((id) => !layout.hidden.includes(id)).length
  const matchingColumns = layout.order.filter((id) => {
    const column = columnById.get(id as ColumnId)
    return column && (column.label.toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi')) || id.toLowerCase().includes(query.trim().toLowerCase()))
  })
  const move = (id: string, direction: -1 | 1) => {
    const index = layout.order.indexOf(id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= layout.order.length) return
    const order = [...layout.order]
    const current = order[index]!
    order[index] = order[target]!
    order[target] = current
    onChange({ ...layout, order })
  }
  return (
    <div className="column-popover" role="dialog" aria-label="Cài đặt cột tài khoản" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <div className="column-popover-header"><strong>Cài đặt cột · {visibleCount}/{layout.order.length} hiển thị</strong><button className="icon-button" type="button" aria-label="Đóng cài đặt cột" onClick={onClose}>×</button></div>
      <input autoFocus className="column-search" type="search" aria-label="Tìm cột" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên cột hoặc field…" />
      <div className="column-list">
        {matchingColumns.map((id) => {
          const column = columnById.get(id as ColumnId)
          if (!column) return null
          const hidden = layout.hidden.includes(id)
          return (
            <div className="column-row" key={id}>
              <label title={column.label}><input type="checkbox" checked={!hidden} onChange={() => onChange({ ...layout, hidden: hidden ? layout.hidden.filter((item) => item !== id) : [...layout.hidden, id] })} /><span>{column.label}</span></label>
              <input className="width-input" type="number" aria-label={`Độ rộng cột ${column.label}`} title="Độ rộng (px)" min={70} max={520} value={layout.widths[id] ?? column.width} onChange={(event) => onChange({ ...layout, widths: { ...layout.widths, [id]: Math.min(520, Math.max(70, Number(event.target.value) || column.width)) } })} />
              <button type="button" className="move-button" title="Đưa cột lên" aria-label={`Đưa cột ${column.label} lên`} disabled={layout.order.indexOf(id) === 0} onClick={() => move(id, -1)}>↑</button>
              <button type="button" className="move-button" title="Đưa cột xuống" aria-label={`Đưa cột ${column.label} xuống`} disabled={layout.order.indexOf(id) === layout.order.length - 1} onClick={() => move(id, 1)}>↓</button>
            </div>
          )
        })}
        {!matchingColumns.length ? <p className="column-search-empty">Không có cột phù hợp.</p> : null}
      </div>
      <div className="column-popover-footer">
        <span>Ẩn/hiện, đổi thứ tự và nhập độ rộng (px) được lưu tự động.</span>
        <button className="button secondary" type="button" onClick={() => onChange({ order: [...defaultLayout.order], hidden: [...defaultLayout.hidden], widths: { ...defaultLayout.widths } })}>Khôi phục mặc định</button>
      </div>
    </div>
  )
}
export { ColumnManager as AccountColumnManager }
