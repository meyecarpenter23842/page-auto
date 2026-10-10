import { useEffect, useMemo, useState } from 'react'
import type { AppInfo } from '../../../ipc/channels'
import type { AppUpdaterSnapshot } from '../../../shared/appUpdater'
import './updateSettings.css'

interface UpdateSettingsSectionProps { appInfo: AppInfo | null }

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 MB'
  const mb = value / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
}

function statusLabel(state: AppUpdaterSnapshot | null): string {
  if (!state) return 'Đang tải trạng thái'
  switch (state.phase) {
    case 'checking': return 'Đang kiểm tra'
    case 'available': return 'Có bản mới'
    case 'downloading': return 'Đang tải'
    case 'ready': return 'Sẵn sàng cài'
    case 'installing': return 'Đang cập nhật'
    case 'up_to_date': return 'Mới nhất'
    case 'updated': return 'Đã cập nhật'
    case 'error': return 'Có lỗi'
    case 'unsupported': return 'Chỉ bản đã cài'
    default: return 'Sẵn sàng'
  }
}

export function UpdateSettingsSection({ appInfo }: UpdateSettingsSectionProps) {
  const [state, setState] = useState<AppUpdaterSnapshot | null>(null)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    let active = true
    const unsubscribe = window.pageAutoUpdater.onStateChanged((next) => {
      if (active) setState(next)
    })
    void window.pageAutoUpdater.getState()
      .then((next) => { if (active) setState(next) })
      .catch(() => { if (active) setState(null) })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const busy = state?.phase === 'checking' || state?.phase === 'available' || state?.phase === 'downloading' || state?.phase === 'installing'
  const canInstall = state?.phase === 'ready'
  const canCheck = state?.phase !== 'unsupported' && !busy && !canInstall
  const percent = Math.round(state?.progress?.percent ?? 0)
  const currentVersion = state?.currentVersion ?? appInfo?.version ?? '...'
  const availableVersion = state?.availableVersion ?? '—'

  const progressText = useMemo(() => {
    if (!state?.progress) return null
    const { transferred, total, bytesPerSecond } = state.progress
    const parts = [`${percent}%`]
    if (total > 0) parts.push(`${formatBytes(transferred)} / ${formatBytes(total)}`)
    if (bytesPerSecond > 0) parts.push(`${formatBytes(bytesPerSecond)}/s`)
    return parts.join(' · ')
  }, [percent, state?.progress])

  const check = async (): Promise<void> => {
    if (!canCheck || requesting) return
    setRequesting(true)
    try {
      setState(await window.pageAutoUpdater.check())
    } finally {
      setRequesting(false)
    }
  }

  const install = async (): Promise<void> => {
    if (!canInstall || requesting) return
    setRequesting(true)
    try {
      setState(await window.pageAutoUpdater.install())
    } finally {
      setRequesting(false)
    }
  }

  return <div className="settings-section update-section">
    <div className="update-summary-grid">
      <div className="update-card"><span>Phiên bản hiện tại</span><strong>v{currentVersion}</strong><small>Bản PAGE-AUTO đang chạy</small></div>
      <div className="update-card"><span>Phiên bản mới</span><strong>{availableVersion === '—' ? '—' : `v${availableVersion}`}</strong><small>Nguồn cập nhật R2</small></div>
      <div className="update-card"><span>Trạng thái</span><strong>{statusLabel(state)}</strong><small>{appInfo?.isPackaged ? 'Bản đã cài Windows' : 'Development mode'}</small></div>
    </div>

    <div className={`update-main-card${state?.phase === 'error' ? ' has-error' : ''}${state?.phase === 'updated' ? ' is-success' : ''}`}>
      <div className="update-main-copy">
        <div className="update-status-row">
          <span className={`update-status-pill phase-${state?.phase ?? 'idle'}`}>{statusLabel(state)}</span>
          {state?.phase === 'updated' && state.previousVersion ? <span className="update-version-hop">v{state.previousVersion} → v{state.currentVersion}</span> : null}
        </div>
        <h3>{state?.message ?? 'Đang đọc trạng thái cập nhật…'}</h3>
        <p>PAGE-AUTO kiểm tra và tải bản mới từ máy chủ cập nhật. Dữ liệu tài khoản, Page và browser profile nằm ngoài thư mục cài nên không bị thay thế khi cập nhật.</p>
      </div>

      {(state?.phase === 'downloading' || state?.phase === 'ready') ? <div className="update-progress-box">
        <div className="update-progress-line"><strong>Tiến trình tải</strong><span>{progressText ?? `${percent}%`}</span></div>
        <div className="update-progress-track" aria-label="Tiến trình tải cập nhật"><span className="update-progress-bar" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div>
      </div> : null}

      {state?.error ? <div className="update-error">{state.error}</div> : null}

      <div className="update-actions">
        {canInstall
          ? <button className="settings-button primary update-primary-button" type="button" disabled={requesting} onClick={() => void install()}>Khởi động lại & cập nhật</button>
          : <button className="settings-button primary update-primary-button" type="button" disabled={!canCheck || requesting} onClick={() => void check()}>{busy ? 'Đang xử lý…' : 'Kiểm tra cập nhật'}</button>}
        <span>Chỉ cài sau khi tải hoàn tất. Thành công chỉ được xác nhận sau khi app khởi động lại bằng phiên bản mới.</span>
      </div>
    </div>
  </div>
}
