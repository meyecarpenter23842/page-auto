import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppSettings } from '../../../shared/appSettings'
import {
  compactBrowserTileSize,
  rectangularBrowserTileGrid,
  type BrowserDisplayInfo,
  type BrowserWindowLayoutSettings
} from '../../../shared/browserWindowLayout'
import {
  browserSlotLayer,
  summarizeBrowserSlotCapacity,
  type BrowserDisplaySlotRuntimeExtension,
  type BrowserSlotRuntimeAssignment
} from '../../../shared/browserSlotDiagnostics'
import './settingsSections.css'
import './browserSlotsSettings.css'

type RuntimeDisplay = BrowserDisplayInfo & BrowserDisplaySlotRuntimeExtension

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

function ownerLabel(owners: readonly string[]): string {
  if (owners.length === 0) return 'không rõ'
  return owners.map((owner) => owner === 'profile' ? 'Hồ sơ' : owner === 'posting' ? 'Đăng bài' : owner).join(' + ')
}

export function BrowserSlotsSettingsSection() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [layout, setLayout] = useState<BrowserWindowLayoutSettings | null>(null)
  const [displays, setDisplays] = useState<RuntimeDisplay[]>([])
  const [busy, setBusy] = useState<'refresh' | 'retile' | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  const refreshRuntime = useCallback(async (showBusy = false) => {
    if (showBusy) setBusy('refresh')
    try {
      const nextDisplays = await window.pageAuto.listBrowserDisplays()
      setDisplays(nextDisplays as RuntimeDisplay[])
      if (showBusy) setFeedback({ kind: 'ok', text: 'Đã làm mới trạng thái slot Chrome.' })
    } catch (caught) {
      if (showBusy) setFeedback({ kind: 'bad', text: errorText(caught) })
    } finally {
      if (showBusy) setBusy(null)
    }
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([
      window.pageAuto.getAppSettings(),
      window.pageAuto.getBrowserWindowLayout(),
      window.pageAuto.listBrowserDisplays()
    ]).then(([nextSettings, nextLayout, nextDisplays]) => {
      if (!active) return
      setSettings(nextSettings)
      setLayout(nextLayout)
      setDisplays(nextDisplays as RuntimeDisplay[])
    }).catch((caught) => {
      if (active) setFeedback({ kind: 'bad', text: errorText(caught) })
    })

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshRuntime(false)
    }, 1_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [refreshRuntime])

  const targetDisplay = useMemo(() => {
    if (!layout) return null
    if (layout.targetDisplayId !== null) {
      const selected = displays.find((display) => display.id === layout.targetDisplayId)
      if (selected) return selected
    }
    return displays.find((display) => display.isCursorDisplay)
      ?? displays.find((display) => display.isPrimary)
      ?? displays[0]
      ?? null
  }, [displays, layout])

  const grid = useMemo(() => {
    if (!settings || !layout || !targetDisplay) return null
    return rectangularBrowserTileGrid(layout, targetDisplay, settings.browser)
  }, [layout, settings, targetDisplay])

  const tileSize = useMemo(() => {
    if (!settings || !layout || !targetDisplay) return null
    return compactBrowserTileSize(layout, settings.browser, targetDisplay)
  }, [layout, settings, targetDisplay])

  const assignments = useMemo<BrowserSlotRuntimeAssignment[]>(
    () => targetDisplay?.slotRuntime.assignments ?? displays[0]?.slotRuntime.assignments ?? [],
    [displays, targetDisplay]
  )

  const summary = useMemo(
    () => summarizeBrowserSlotCapacity(assignments, grid?.capacity ?? 1),
    [assignments, grid]
  )

  const retile = async () => {
    setBusy('retile')
    setFeedback(null)
    try {
      const result = await window.pageAuto.retileBrowserWindows()
      await refreshRuntime(false)
      setFeedback({ kind: result.status === 'success' ? 'ok' : 'bad', text: result.message })
    } catch (caught) {
      setFeedback({ kind: 'bad', text: errorText(caught) })
    } finally {
      setBusy(null)
    }
  }

  if (!settings || !layout) {
    return <div className="settings-empty">Đang đọc trạng thái Chrome Slots...</div>
  }

  return <div className="settings-section settings-section-with-actions">
    <div className="settings-section-content">
      <div className="browser-slot-runtime">
        <div className="browser-slot-summary-grid">
          <div className="browser-slot-summary-card"><span>Chrome đang giữ slot</span><strong>{summary.activeCount}</strong></div>
          <div className="browser-slot-summary-card"><span>Sức chứa lớp hiện tại</span><strong>{grid ? grid.capacity : 0}</strong></div>
          <div className="browser-slot-summary-card"><span>Ô trống trong lớp</span><strong>{grid ? summary.freeVisibleSlots : 0}</strong></div>
          <div className={`browser-slot-summary-card ${summary.overflowCount > 0 ? 'warning' : ''}`}><span>Vượt lớp</span><strong>{grid ? summary.overflowCount : 0}</strong></div>
        </div>

        <div className="browser-slot-meta">
          <div><span>Màn hình đích</span><strong>{targetDisplay?.label ?? 'Chưa xác định'}</strong></div>
          <div><span>Bố cục</span><strong>{grid ? `${grid.columns} × ${grid.rows}` : '—'}</strong></div>
          <div><span>Kích thước slot</span><strong>{tileSize ? `${tileSize.width} × ${tileSize.height}px${tileSize.autoFit ? ' · Auto Fit' : ''}` : '—'}</strong></div>
          <div><span>Slot trống kế tiếp</span><strong>#{summary.nextFreeSlot + 1}</strong></div>
          <div><span>Số lớp đang dùng</span><strong>{summary.layersUsed}</strong></div>
          <div><span>Auto refresh</span><strong>1 giây</strong></div>
        </div>

        <div className="browser-slot-map-head">
          <div>
            <strong>Slot map</strong>
            <small>Polling chỉ đọc trạng thái. Chrome chỉ được dồn slot khi anh bấm “Sắp xếp lại Chrome”.</small>
          </div>
          <div className="path-input-row">
            <button type="button" className="settings-button" disabled={busy !== null} onClick={() => void refreshRuntime(true)}>
              {busy === 'refresh' ? 'Đang làm mới...' : 'Làm mới'}
            </button>
            <button type="button" className="settings-button primary" disabled={busy !== null || !layout.enabled || summary.activeCount === 0} onClick={() => void retile()}>
              {busy === 'retile' ? 'Đang xếp...' : 'Sắp xếp lại Chrome'}
            </button>
          </div>
        </div>

        <div className="browser-slot-map">
          {assignments.length === 0
            ? <div className="browser-slot-empty">Chưa có Chrome PAGE-AUTO nào đang giữ slot.</div>
            : assignments.map((assignment) => {
              const layer = grid ? browserSlotLayer(assignment.slotIndex, grid.capacity) : 0
              const overflow = grid ? assignment.slotIndex >= grid.capacity : false
              return <div className={`browser-slot-chip ${overflow ? 'overflow' : ''}`} key={`${assignment.accountId}-${assignment.slotIndex}`}>
                <strong>Slot {assignment.slotIndex + 1}</strong>
                <span>TK #{assignment.accountId}</span>
                <small>{ownerLabel(assignment.owners)} · Lớp {layer + 1}</small>
              </div>
            })}
        </div>

        {feedback && <div className={`settings-feedback ${feedback.kind}`}>{feedback.text}</div>}
      </div>
    </div>
  </div>
}
