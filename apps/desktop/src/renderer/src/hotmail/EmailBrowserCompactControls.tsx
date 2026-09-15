import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { DEFAULT_APP_SETTINGS } from '../../../shared/appSettings'
import {
  CHROME_MIN_COMPACT_OUTER_HEIGHT_PX,
  CHROME_MIN_COMPACT_OUTER_WIDTH_PX,
  MAX_COMPACT_OUTER_HEIGHT_PX,
  MAX_COMPACT_OUTER_WIDTH_PX,
  compactBrowserTileSize,
  rectangularBrowserTileGrid,
  withCompactBrowserTileSize,
  type BrowserDisplayInfo,
  type BrowserWindowLayoutSettings
} from '../../../shared/browserWindowLayout'

const PRESETS = [
  { label: 'Gọn', width: 500, height: 350 },
  { label: 'Vừa', width: 600, height: 450 },
  { label: 'Lớn', width: 800, height: 600 }
] as const

interface Props {
  layout: BrowserWindowLayoutSettings
  browserWindowWidth: number
  browserWindowHeight: number
  disabled?: boolean
  onChange: (layout: BrowserWindowLayoutSettings) => void
  onMessage: (message: string) => void
}

export function EmailBrowserCompactControls({
  layout,
  browserWindowWidth,
  browserWindowHeight,
  disabled = false,
  onChange,
  onMessage
}: Props) {
  const [displays, setDisplays] = useState<BrowserDisplayInfo[]>([])
  const [retileBusy, setRetileBusy] = useState(false)

  useEffect(() => {
    void window.pageAuto.listBrowserDisplays()
      .then(setDisplays)
      .catch(() => setDisplays([]))
  }, [])

  const browser = useMemo(() => ({
    ...DEFAULT_APP_SETTINGS.browser,
    windowWidth: browserWindowWidth,
    windowHeight: browserWindowHeight
  }), [browserWindowHeight, browserWindowWidth])

  const selectedDisplay = useMemo(() => {
    if (layout.targetDisplayId !== null) {
      const exact = displays.find((display) => display.id === layout.targetDisplayId)
      if (exact) return exact
    }
    return displays.find((display) => display.isPrimary) ?? displays[0] ?? null
  }, [displays, layout.targetDisplayId])

  const tileSize = useMemo(
    () => compactBrowserTileSize(layout, browser, selectedDisplay ?? undefined),
    [browser, layout, selectedDisplay]
  )
  const grid = useMemo(
    () => selectedDisplay ? rectangularBrowserTileGrid(layout, selectedDisplay, browser) : null,
    [browser, layout, selectedDisplay]
  )

  const requestedWidth = layout.tileWidthPx ?? 500
  const requestedHeight = layout.tileHeightPx ?? 500

  const setSize = (width: number, height: number, autoFit = layout.autoFit === true) => {
    onChange(withCompactBrowserTileSize(layout, width, height, autoFit))
  }

  const retile = async () => {
    setRetileBusy(true)
    try {
      const result = await window.pageAutoEmailBrowser.retile()
      onMessage(result.message)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setRetileBusy(false)
    }
  }

  return <section className="email-settings-card email-compact-card">
    <div className="email-settings-heading">
      <div><span>COMPACT EMAIL</span><h3>Scale / xếp Chrome như Facebook</h3></div>
      <span className="email-settings-badge">Slot Email riêng</span>
    </div>

    <div className="email-panel-actions email-compact-presets">
      {PRESETS.map((preset) => <button
        key={preset.label}
        type="button"
        className="email-button secondary"
        disabled={disabled}
        onClick={() => setSize(preset.width, preset.height, false)}
      >{preset.label} {preset.width}×{preset.height}</button>)}
    </div>

    <div className="email-settings-grid">
      <label>
        <span>Compact / xếp nhiều Chrome</span>
        <select
          value={layout.enabled ? 'on' : 'off'}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange({ ...layout, enabled: event.target.value === 'on' })}
        >
          <option value="on">Bật</option>
          <option value="off">Tắt</option>
        </select>
        <small>Cùng native-window engine Facebook; slot Email tách riêng.</small>
      </label>

      <label>
        <span>Auto Fit toàn Chrome</span>
        <select
          value={layout.autoFit === true ? 'on' : 'off'}
          disabled={disabled || !layout.enabled}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange({ ...layout, autoFit: event.target.value === 'on' })}
        >
          <option value="off">Tắt</option>
          <option value="on">Bật</option>
        </select>
        <small>Dùng cùng whole-Chrome scale của Facebook, không giả lập viewport.</small>
      </label>

      <label>
        <span>Rộng Chrome Email</span>
        <input
          type="number"
          min={CHROME_MIN_COMPACT_OUTER_WIDTH_PX}
          max={MAX_COMPACT_OUTER_WIDTH_PX}
          step={50}
          value={requestedWidth}
          disabled={disabled || !layout.enabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setSize(Number(event.target.value), requestedHeight)}
        />
      </label>

      <label>
        <span>Cao Chrome Email</span>
        <input
          type="number"
          min={CHROME_MIN_COMPACT_OUTER_HEIGHT_PX}
          max={MAX_COMPACT_OUTER_HEIGHT_PX}
          step={25}
          value={layout.autoFit === true ? tileSize.height : requestedHeight}
          disabled={disabled || !layout.enabled || layout.autoFit === true}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setSize(requestedWidth, Number(event.target.value), false)}
        />
        <small>{layout.autoFit === true ? `Auto Fit đang tính ${tileSize.width}×${tileSize.height}.` : 'Kích thước native của từng ô Email.'}</small>
      </label>

      <label className="wide">
        <span>Màn hình xếp Chrome Email</span>
        <select
          value={layout.targetDisplayId === null ? '' : String(layout.targetDisplayId)}
          disabled={disabled || !layout.enabled}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange({
            ...layout,
            targetDisplayId: event.target.value ? Number(event.target.value) : null
          })}
        >
          <option value="">Tự động / màn hình hiện tại</option>
          {displays.map((display) => <option key={display.id} value={display.id}>
            {display.label}{display.isPrimary ? ' · chính' : ''} · {display.workArea.width}×{display.workArea.height}
          </option>)}
        </select>
      </label>
    </div>

    <div className="email-info-card">
      <strong>Preview layout Email</strong>
      <p>{layout.enabled
        ? `${tileSize.width}×${tileSize.height}${grid ? ` · ${grid.columns} cột × ${grid.rows} hàng · ${grid.capacity} cửa sổ/lớp` : ''}`
        : 'Compact Email đang tắt; browser dùng kích thước thường.'}</p>
    </div>

    <div className="email-panel-actions">
      <button type="button" className="email-button secondary" disabled={disabled || retileBusy} onClick={() => void retile()}>
        {retileBusy ? 'Đang xếp…' : 'Sắp xếp lại Chrome Email'}
      </button>
      <span className="email-panel-note">Lưu cài đặt sẽ tự retile các Chrome Email đang mở; nếu đổi whole-Chrome scale, phiên đang chạy có thể cần mở lại như Facebook.</span>
    </div>
  </section>
}
