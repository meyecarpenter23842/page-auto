import type { AccountColumnLayout } from '../../../shared/accounts'
import { columnById, defaultLayout, type ColumnId } from './accountManagerModel'

export interface ColumnManagerProps {
  layout: AccountColumnLayout
  onChange: (layout: AccountColumnLayout) => void
  onClose: () => void
}

export function ColumnManager({ layout, onChange, onClose }: ColumnManagerProps) {
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
    <div className="column-popover">
      <div className="column-popover-header"><strong>Cài đặt cột</strong><button className="icon-button" type="button" onClick={onClose}>×</button></div>
      <div className="column-list">
        {layout.order.map((id) => {
          const column = columnById.get(id as ColumnId)
          if (!column) return null
          const hidden = layout.hidden.includes(id)
          return (
            <div className="column-row" key={id}>
              <label><input type="checkbox" checked={!hidden} onChange={() => onChange({ ...layout, hidden: hidden ? layout.hidden.filter((item) => item !== id) : [...layout.hidden, id] })} /><span>{column.label}</span></label>
              <input className="width-input" type="number" min="70" max="520" value={layout.widths[id] ?? column.width} onChange={(e) => onChange({ ...layout, widths: { ...layout.widths, [id]: Math.max(70, Number(e.target.value) || column.width) } })} />
              <button type="button" className="move-button" onClick={() => move(id, -1)}>↑</button>
              <button type="button" className="move-button" onClick={() => move(id, 1)}>↓</button>
            </div>
          )
        })}
      </div>
      <button className="button secondary full-width" type="button" onClick={() => onChange(defaultLayout)}>Khôi phục mặc định</button>
    </div>
  )
}
