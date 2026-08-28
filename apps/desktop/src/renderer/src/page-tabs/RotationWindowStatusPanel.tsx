import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PageTabConfig } from '../../../shared/pageTabs'
import type {
  RotationRuntimeSnapshot,
  RotationWindowRuntimeState,
  RotationWindowRuntimeStatus
} from '../../../shared/rotation'
import './rotationWindowStatus.css'

const statusLabels: Record<RotationWindowRuntimeStatus, string> = {
  upcoming: 'Chưa tới',
  running: 'Đang chạy',
  closed_account_cycle: 'Đã đóng — hết vòng TK',
  closed_time_remaining_accounts: 'Đã đóng — hết giờ, còn TK'
}

function minuteLabel(minute: number): string {
  if (minute === 1440) return '24:00'
  const normalized = Math.max(0, Math.min(1439, minute))
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

function accountLabel(config: PageTabConfig | null, accountId: number | null): string {
  if (accountId === null) return '—'
  const account = config?.accounts.find((entry) => entry.accountId === accountId)
  if (!account) return `#${accountId}`
  return account.name?.trim() || account.uid || `#${accountId}`
}

function progressLabel(windowState: RotationWindowRuntimeState): string {
  if (windowState.targetSlotsThisTurn <= 0) return '—'
  return `${windowState.slotsCompletedThisTurn}/${windowState.targetSlotsThisTurn}`
}

export function RotationWindowStatusPanel() {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const [runtime, setRuntime] = useState<RotationRuntimeSnapshot | null>(null)
  const [config, setConfig] = useState<PageTabConfig | null>(null)

  useEffect(() => {
    let disposed = false

    const refresh = async () => {
      const target = document.querySelector<HTMLElement>('.page-business-group-pane .page-tab-left-pane')
      if (!disposed) setPortalTarget(target)
      if (!target) return

      try {
        const [tabs, runtimes] = await Promise.all([
          window.pageAuto.listPageTabs(),
          window.pageAuto.listPageTabRotations()
        ])
        if (disposed) return

        const pageButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.page-business-group-pane .page-tab-chip'))
        const activeIndex = pageButtons.findIndex((button) => button.classList.contains('active'))
        const activeId = activeIndex >= 0 ? tabs[activeIndex]?.id ?? null : null
        if (activeId === null) {
          setRuntime(null)
          setConfig(null)
          return
        }

        const nextRuntime = runtimes.find((entry) => entry.pageTabId === activeId) ?? null
        const nextConfig = await window.pageAuto.getPageTab({ id: activeId })
        if (disposed) return
        setRuntime(nextRuntime)
        setConfig(nextConfig)
      } catch {
        if (!disposed) {
          setRuntime(null)
          setConfig(null)
        }
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [])

  const windows = runtime?.windowStates ?? []
  const dateKey = useMemo(() => windows[0]?.dateKey ?? null, [windows])

  if (!portalTarget) return null

  return createPortal(
    <section className="pt-panel pt-window-status-panel" aria-label="Trạng thái từng khung giờ">
      <div className="pt-window-status-head">
        <div><strong>Trạng thái khung giờ</strong><span>Rotation hôm nay</span></div>
        <small>{dateKey ?? 'Theo lịch hiện tại'}</small>
      </div>

      {windows.length === 0 ? (
        <div className="pt-window-status-empty">Hôm nay không có khung giờ được bật.</div>
      ) : (
        <div className="pt-window-status-list">
          {windows.map((windowState) => (
            <article className={`pt-window-status-row window-${windowState.status}`} key={windowState.key}>
              <div className="pt-window-status-time">
                <strong>{windowState.startMinute === 0 && windowState.endMinute === 1440
                  ? 'Cả ngày'
                  : `${minuteLabel(windowState.startMinute)}–${minuteLabel(windowState.endMinute)}`}</strong>
                <span className={`pt-window-status-chip status-${windowState.status}`}>{statusLabels[windowState.status]}</span>
              </div>
              <div className="pt-window-status-metrics">
                <span><small>TK hiện tại</small><b title={accountLabel(config, windowState.currentAccountId)}>{accountLabel(config, windowState.currentAccountId)}</b></span>
                <span><small>Bài/lượt</small><b>{progressLabel(windowState)}</b></span>
                <span><small>Group còn</small><b>{windowState.groupRemaining}</b></span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>,
    portalTarget
  )
}
