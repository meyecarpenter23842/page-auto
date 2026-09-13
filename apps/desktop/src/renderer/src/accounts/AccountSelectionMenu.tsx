import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { clampContextMenuPoint } from './accountTableSelection'

interface AccountSelectionMenuProps {
  x: number
  y: number
  checkedCount: number
  rangeCount: number
  totalCount: number
  onCheckRange: () => void
  onCheckAll: () => void
  onClearChecked: () => void
  children?: ReactNode
}

export function AccountSelectionMenu({
  x,
  y,
  checkedCount,
  rangeCount,
  totalCount,
  onCheckRange,
  onCheckAll,
  onClearChecked,
  children
}: AccountSelectionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })
  const [submenuSide, setSubmenuSide] = useState<'left' | 'right'>('right')

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const next = clampContextMenuPoint(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight)
    setPosition(next)
    setSubmenuSide(next.x + rect.width + 220 + 8 > window.innerWidth ? 'left' : 'right')
  }, [x, y, checkedCount, rangeCount, totalCount])

  return (
    <div
      ref={menuRef}
      className="account-selection-menu"
      style={{ left: position.x, top: position.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="account-selection-menu-meta">
        <span>Đã tích <strong>{checkedCount}</strong></span>
        <span>Phủ khối <strong>{rangeCount}</strong></span>
      </div>
      {children ? <><div className="account-selection-menu-actions">{children}</div><div className="account-selection-menu-separator" /></> : null}
      <div className="account-selection-submenu">
        <button type="button" className="account-selection-submenu-trigger">
          <span>Chọn</span><span aria-hidden="true">›</span>
        </button>
        <div className={`account-selection-submenu-panel ${submenuSide === 'left' ? 'open-left' : ''}`}>
          <button type="button" disabled={rangeCount === 0} onClick={onCheckRange}>Phần đang phủ khối ({rangeCount})</button>
          <button type="button" disabled={totalCount === 0} onClick={onCheckAll}>Chọn tất cả ({totalCount})</button>
        </div>
      </div>
      <button type="button" disabled={checkedCount === 0} onClick={onClearChecked}>Bỏ chọn tất cả</button>
    </div>
  )
}
