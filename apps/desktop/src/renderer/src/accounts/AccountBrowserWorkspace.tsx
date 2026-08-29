import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type { BrowserWindowLayoutSettings } from '../../../shared/browserWindowLayout'
import {
  profileWorkspaceAssignments,
  resolveWorkspaceDisplay,
  workspaceAssignments,
  workspaceHasBusinessBrowsers,
  type AccountWorkspaceDisplay
} from './accountBrowserWorkspaceModel'
import './accountBrowserWorkspace.css'

interface AccountBrowserWorkspaceProps {
  accounts: AccountRecord[]
  selected: AccountRecord[]
  openingProfiles: boolean
  onOpenSelected: () => Promise<void>
  onClose: () => void
}

type WorkspaceBusy = 'open' | 'refresh' | 'retile' | 'layout' | null

type WorkspaceFeedback = { kind: 'ok' | 'bad'; text: string } | null

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

export function AccountBrowserWorkspace({
  accounts,
  selected,
  openingProfiles,
  onOpenSelected,
  onClose
}: AccountBrowserWorkspaceProps) {
  const [layout, setLayout] = useState<BrowserWindowLayoutSettings | null>(null)
  const [displays, setDisplays] = useState<AccountWorkspaceDisplay[]>([])
  const [busy, setBusy] = useState<WorkspaceBusy>(null)
  const [feedback, setFeedback] = useState<WorkspaceFeedback>(null)

  const refresh = useCallback(async (showBusy = false) => {
    if (showBusy) setBusy('refresh')
    try {
      const [nextLayout, nextDisplays] = await Promise.all([
        window.pageAuto.getBrowserWindowLayout(),
        window.pageAuto.listBrowserDisplays()
      ])
      setLayout(nextLayout)
      setDisplays(nextDisplays as AccountWorkspaceDisplay[])
      if (showBusy) setFeedback({ kind: 'ok', text: 'Đã làm mới trạng thái cửa sổ Chrome.' })
    } catch (caught) {
      if (showBusy) setFeedback({ kind: 'bad', text: errorText(caught) })
    } finally {
      if (showBusy) setBusy(null)
    }
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([
      window.pageAuto.getBrowserWindowLayout(),
      window.pageAuto.listBrowserDisplays()
    ]).then(([nextLayout, nextDisplays]) => {
      if (!active) return
      setLayout(nextLayout)
      setDisplays(nextDisplays as AccountWorkspaceDisplay[])
    }).catch((caught) => {
      if (active) setFeedback({ kind: 'bad', text: errorText(caught) })
    })

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(false)
    }, 1_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [refresh])

  const assignments = useMemo(() => workspaceAssignments(displays), [displays])
  const profileAssignments = useMemo(() => profileWorkspaceAssignments(assignments), [assignments])
  const hasBusinessBrowsers = useMemo(() => workspaceHasBusinessBrowsers(assignments), [assignments])
  const targetDisplay = useMemo(
    () => resolveWorkspaceDisplay(displays, layout?.targetDisplayId ?? null),
    [displays, layout?.targetDisplayId]
  )
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])

  const openSelected = async () => {
    if (selected.length === 0 || openingProfiles || busy !== null) return
    setBusy('open')
    setFeedback(null)
    try {
      await onOpenSelected()
      await refresh(false)
    } catch (caught) {
      setFeedback({ kind: 'bad', text: errorText(caught) })
    } finally {
      setBusy(null)
    }
  }

  const saveLayout = async (patch: Partial<BrowserWindowLayoutSettings>) => {
    if (!layout || busy !== null) return
    setBusy('layout')
    setFeedback(null)
    try {
      const next = await window.pageAuto.saveBrowserWindowLayout({ ...layout, ...patch })
      setLayout(next)
      setFeedback({ kind: 'ok', text: next.enabled ? 'Đã bật tự xếp Chrome khi mở.' : 'Đã tắt tự xếp; nút Gom vẫn có thể bật lại khi cần.' })
    } catch (caught) {
      setFeedback({ kind: 'bad', text: errorText(caught) })
    } finally {
      setBusy(null)
    }
  }

  const retile = async () => {
    if (!layout || busy !== null) return
    if (profileAssignments.length === 0) {
      setFeedback({ kind: 'bad', text: 'Chưa có Chrome profile nào được mở từ Tài khoản.' })
      return
    }
    if (hasBusinessBrowsers) {
      setFeedback({
        kind: 'bad',
        text: 'Đang có Chrome của Đăng bài/Kịch Bản giữ slot. Không gom từ Tài khoản để tránh làm xê dịch cửa sổ nghiệp vụ đang chạy.'
      })
      return
    }

    setBusy('retile')
    setFeedback(null)
    try {
      let effectiveLayout = layout
      if (!effectiveLayout.enabled) {
        effectiveLayout = await window.pageAuto.saveBrowserWindowLayout({ ...effectiveLayout, enabled: true })
        setLayout(effectiveLayout)
      }
      const result = await window.pageAuto.retileBrowserWindows()
      await refresh(false)
      setFeedback({ kind: result.status === 'success' ? 'ok' : 'bad', text: result.message })
    } catch (caught) {
      setFeedback({ kind: 'bad', text: errorText(caught) })
    } finally {
      setBusy(null)
    }
  }

  const chooseDisplay = async (value: string) => {
    if (!layout || busy !== null) return
    const targetDisplayId = value === 'cursor' ? null : Number(value)
    await saveLayout({ targetDisplayId })
  }

  if (!layout) {
    return (
      <div className="account-browser-workspace loading">
        <span>Đang đọc trạng thái cửa sổ Chrome…</span>
        <button type="button" className="workspace-close" onClick={onClose} aria-label="Đóng khu cửa sổ">×</button>
      </div>
    )
  }

  return (
    <div className="account-browser-workspace">
      <div className="workspace-head">
        <div>
          <strong>Cửa sổ Chrome</strong>
          <span>Chrome vẫn là cửa sổ thật. PAGE-AUTO chỉ mở, theo dõi và gom chúng theo ô; không restart profile/session.</span>
        </div>
        <button type="button" className="workspace-close" onClick={onClose} aria-label="Đóng khu cửa sổ">×</button>
      </div>

      <div className="workspace-controls">
        <div className="workspace-stat"><span>Đã chọn</span><strong>{selected.length}</strong></div>
        <div className="workspace-stat"><span>Profile đang mở</span><strong>{profileAssignments.length}</strong></div>
        <label className="workspace-display">
          <span>Màn hình gom</span>
          <select value={layout.targetDisplayId === null ? 'cursor' : String(layout.targetDisplayId)} disabled={busy !== null} onChange={(event) => void chooseDisplay(event.target.value)}>
            <option value="cursor">Theo vị trí con trỏ</option>
            {displays.map((display) => <option key={display.id} value={display.id}>{display.label}{display.isPrimary ? ' · chính' : ''}</option>)}
          </select>
        </label>
        <label className="workspace-toggle">
          <input type="checkbox" checked={layout.enabled} disabled={busy !== null} onChange={(event) => void saveLayout({ enabled: event.target.checked })} />
          <span>Tự xếp Chrome khi mở</span>
        </label>
        <div className="workspace-actions">
          <button className="button secondary compact" type="button" disabled={selected.length === 0 || openingProfiles || busy !== null} onClick={() => void openSelected()}>
            {openingProfiles || busy === 'open' ? 'Đang mở…' : selected.length > 1 ? `Mở ${selected.length} profile` : 'Mở profile'}
          </button>
          <button className="button primary compact" type="button" disabled={busy !== null || profileAssignments.length === 0} onClick={() => void retile()}>
            {busy === 'retile' ? 'Đang gom…' : 'Gom cửa sổ'}
          </button>
          <button className="button secondary compact" type="button" disabled={busy !== null} onClick={() => void refresh(true)}>
            {busy === 'refresh' ? 'Đang tải…' : 'Làm mới'}
          </button>
        </div>
      </div>

      <div className="workspace-meta">
        <span>Đích: <strong>{targetDisplay?.label ?? 'chưa xác định'}</strong></span>
        <span>Ô: <strong>{layout.tileWidthPx ?? layout.tileSidePx ?? 500} × {layout.tileHeightPx ?? layout.tileSidePx ?? 500}px</strong></span>
        {hasBusinessBrowsers ? <span className="workspace-warning">Có cửa sổ nghiệp vụ đang chạy — Gom từ Tài khoản sẽ được chặn.</span> : null}
      </div>

      <div className="workspace-window-strip">
        {profileAssignments.length === 0 ? (
          <div className="workspace-empty">Chưa có profile nào đang mở. Chọn tài khoản trong grid rồi bấm “Mở profile”.</div>
        ) : profileAssignments.map((assignment) => {
          const account = accountById.get(assignment.accountId)
          return (
            <div className="workspace-window-chip" key={`${assignment.accountId}-${assignment.slotIndex}`}>
              <strong>{account?.uid || `TK #${assignment.accountId}`}</strong>
              <span>{account?.name || account?.username || `Account #${assignment.accountId}`}</span>
              <small>Ô {assignment.slotIndex + 1}</small>
            </div>
          )
        })}
      </div>

      {feedback ? <div className={`workspace-feedback ${feedback.kind}`}>{feedback.text}</div> : null}
    </div>
  )
}
