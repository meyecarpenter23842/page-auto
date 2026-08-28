import { useEffect, useMemo, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type {
  FacebookCheckpoint282Action,
  FacebookCheckpoint282Result,
  FacebookCheckpointSurface
} from '../../../shared/facebookCheckpoint'
import type {
  FacebookCheckpoint282AccountPreflight,
  FacebookCheckpoint282Locale,
  FacebookCheckpoint282PreflightResult,
  FacebookCheckpoint282Preset
} from '../../../shared/checkpoint282Workbench'
import {
  canRecheckCheckpoint282,
  checkpoint282StateLabel,
  shouldPauseCheckpoint282Sequence,
  type Checkpoint282UiState
} from './checkpoint282Ui'
import './checkpoint282.css'
import './checkpoint282U2.css'

interface Checkpoint282DialogProps {
  accounts: AccountRecord[]
  onClose: () => void
}

interface Checkpoint282Row {
  accountId: number
  uid: string
  state: Checkpoint282UiState
  message: string
  evidencePath: string | null
}

const surfaceLabels: Record<FacebookCheckpointSurface, string> = {
  mbasic: 'mbasic.facebook.com',
  mobile: 'm.facebook.com',
  desktop: 'www.facebook.com'
}

const localeLabels: Record<FacebookCheckpoint282Locale, string> = {
  auto: 'Auto',
  'vi-VN': 'Tiếng Việt',
  'en-US': 'English (US)'
}

function initialRows(accounts: AccountRecord[]): Checkpoint282Row[] {
  return accounts.map((account) => ({
    accountId: account.id,
    uid: account.uid,
    state: 'pending',
    message: 'Chưa chạy.',
    evidencePath: null
  }))
}

function masterStatusLabel(account: AccountRecord | undefined): string {
  if (!account) return '—'
  if (account.status === 'valid') return 'Sẵn sàng'
  if (account.status === 'needs_login') return 'Cần login'
  if (account.status === 'disabled') return 'Đã tắt'
  return 'Chưa rõ'
}

function shortPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join('/')}`
}

function imageStateLabel(row: FacebookCheckpoint282AccountPreflight | undefined): string {
  if (!row) return 'Chưa kiểm tra'
  switch (row.image.state) {
    case 'canonical': return 'Folder282'
    case 'source': return `Ảnh nguồn (${row.image.sourceCandidateCount})`
    case 'missing': return 'Thiếu ảnh'
    case 'duplicate': return `Trùng (${row.image.canonicalCandidateCount})`
  }
}

function preflightLevelLabel(row: FacebookCheckpoint282AccountPreflight | undefined): string {
  if (!row) return 'Chưa kiểm tra'
  if (row.level === 'ok') return 'OK'
  if (row.level === 'warning') return 'Cảnh báo'
  return 'Bị chặn'
}

export function Checkpoint282Dialog({ accounts, onClose }: Checkpoint282DialogProps) {
  const [surface, setSurface] = useState<FacebookCheckpointSurface>('mbasic')
  const [locale, setLocale] = useState<FacebookCheckpoint282Locale>('auto')
  const [sourceImageFolder, setSourceImageFolder] = useState('')
  const [evidenceFolder, setEvidenceFolder] = useState('')
  const [canonicalFolder, setCanonicalFolder] = useState('')
  const [preflight, setPreflight] = useState<FacebookCheckpoint282PreflightResult | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(true)
  const [presetSaving, setPresetSaving] = useState(false)
  const [rows, setRows] = useState<Checkpoint282Row[]>(() => initialRows(accounts))
  const [running, setRunning] = useState(false)
  const [started, setStarted] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(accounts.length > 0 ? 0 : -1)

  const accountIds = useMemo(() => accounts.map((account) => account.id), [accounts])
  const resolvedCount = useMemo(() => rows.filter((row) => row.state === 'resolved').length, [rows])
  const retryIndex = rows.findIndex((row) => canRecheckCheckpoint282(row.state))
  const retryRow = retryIndex >= 0 ? rows[retryIndex] : null
  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] ?? null : null
  const selectedAccount = selectedRow
    ? accounts.find((account) => account.id === selectedRow.accountId)
    : undefined
  const activeRow = retryRow ?? selectedRow
  const activeAccount = activeRow
    ? accounts.find((account) => account.id === activeRow.accountId)
    : undefined
  const pendingCount = rows.filter((row) => row.state === 'pending').length
  const preflightByAccount = useMemo(
    () => new Map((preflight?.rows ?? []).map((row) => [row.accountId, row])),
    [preflight]
  )
  const selectedPreflight = selectedRow ? preflightByAccount.get(selectedRow.accountId) : undefined
  const blockedCount = preflight?.summary.blocked ?? 0

  const currentPreset = (): FacebookCheckpoint282Preset => ({
    surface,
    locale,
    sourceImageFolder: sourceImageFolder.trim() || null
  })

  const runPreflight = async (preset: FacebookCheckpoint282Preset = currentPreset()) => {
    setPreflightLoading(true)
    try {
      const result = await window.pageAuto.preflightFacebookCheckpoint282({ accountIds, preset })
      setPreflight(result)
      setCanonicalFolder(result.canonicalFolder)
    } finally {
      setPreflightLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const preset = await window.pageAuto.getFacebookCheckpoint282Preset()
        if (cancelled) return
        setSurface(preset.surface)
        setLocale(preset.locale)
        setSourceImageFolder(preset.sourceImageFolder ?? '')
        const result = await window.pageAuto.preflightFacebookCheckpoint282({ accountIds, preset })
        if (cancelled) return
        setPreflight(result)
        setCanonicalFolder(result.canonicalFolder)
      } finally {
        if (!cancelled) setPreflightLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [accountIds])

  const updateRow = (index: number, patch: Partial<Checkpoint282Row>) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  }

  const invoke = async (row: Checkpoint282Row, action: FacebookCheckpoint282Action): Promise<FacebookCheckpoint282Result> => {
    try {
      return await window.pageAuto.runFacebookCheckpoint282({
        accountId: row.accountId,
        surface,
        action,
        evidenceFolder: evidenceFolder.trim() || null
      })
    } catch (cause) {
      return {
        accountId: row.accountId,
        uid: row.uid,
        state: 'error',
        surface,
        message: cause instanceof Error ? cause.message : String(cause)
      }
    }
  }

  const runSequence = async (startIndex: number, firstAction: FacebookCheckpoint282Action) => {
    if (running || startIndex < 0 || startIndex >= rows.length) return
    setStarted(true)
    setRunning(true)
    try {
      for (let index = startIndex; index < rows.length; index += 1) {
        const row = rows[index]
        if (!row) continue
        setSelectedIndex(index)
        const action = index === startIndex ? firstAction : 'start'
        updateRow(index, {
          state: 'running',
          message: action === 'recheck'
            ? 'Đang kiểm tra lại session và account identity…'
            : 'Đang mở session và kiểm tra CP282…',
          evidencePath: null
        })
        const result = await invoke(row, action)
        updateRow(index, {
          state: result.state,
          message: result.message,
          evidencePath: result.evidencePath ?? null
        })
        if (shouldPauseCheckpoint282Sequence(result.state)) {
          setSelectedIndex(index)
          break
        }
      }
    } finally {
      setRunning(false)
    }
  }

  const pickSourceFolder = async () => {
    const picked = await window.pageAuto.pickFacebookCheckpoint282SourceFolder()
    if (!picked) return
    setSourceImageFolder(picked)
    await runPreflight({ surface, locale, sourceImageFolder: picked })
  }

  const pickEvidenceFolder = async () => {
    const picked = await window.pageAuto.pickFacebookCheckpointEvidenceFolder()
    if (picked) setEvidenceFolder(picked)
  }

  const savePreset = async () => {
    setPresetSaving(true)
    try {
      const saved = await window.pageAuto.saveFacebookCheckpoint282Preset(currentPreset())
      setSurface(saved.surface)
      setLocale(saved.locale)
      setSourceImageFolder(saved.sourceImageFolder ?? '')
      await runPreflight(saved)
    } finally {
      setPresetSaving(false)
    }
  }

  const footerPrimary = () => {
    if (!started) {
      return (
        <button
          className="button primary checkpoint282-primary-action"
          type="button"
          disabled={running || preflightLoading || rows.length === 0 || !preflight || blockedCount > 0}
          onClick={() => void runSequence(0, 'start')}
        >
          {preflightLoading ? 'Đang preflight…' : blockedCount > 0 ? `Còn ${blockedCount} account bị chặn` : 'Bắt đầu CP282'}
        </button>
      )
    }
    if (retryRow && retryIndex >= 0 && canRecheckCheckpoint282(retryRow.state)) {
      return (
        <button
          className="button primary checkpoint282-primary-action"
          type="button"
          disabled={running}
          onClick={() => void runSequence(retryIndex, 'recheck')}
        >
          {running ? 'Đang kiểm tra…' : `Kiểm tra lại ${retryRow.uid}`}
        </button>
      )
    }
    return (
      <button className="button primary checkpoint282-primary-action" type="button" disabled>
        {running ? 'Đang chạy…' : 'Đã chạy xong lượt'}
      </button>
    )
  }

  return (
    <div className="modal-backdrop checkpoint282-backdrop" role="presentation" onMouseDown={() => { if (!running) onClose() }}>
      <div className="modal checkpoint282-dialog" role="dialog" aria-modal="true" aria-labelledby="checkpoint282-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="checkpoint282-header">
          <div className="checkpoint282-title-block">
            <div className="checkpoint282-brand-mark" aria-hidden="true">CP</div>
            <div>
              <p className="eyebrow">Facebook Common · Operator Workbench</p>
              <h2 id="checkpoint282-title">Checkpoint 282</h2>
              <p className="checkpoint282-subtitle">Folder282 ưu tiên theo UID · thiếu mới dùng ảnh nguồn · chạy tuần tự</p>
            </div>
          </div>
          <div className="checkpoint282-header-right">
            <div className="checkpoint282-metrics" aria-label="Tổng quan preflight">
              <div><strong>{preflight?.summary.ok ?? 0}</strong><span>OK</span></div>
              <div className={(preflight?.summary.warning ?? 0) > 0 ? 'is-warning' : ''}><strong>{preflight?.summary.warning ?? 0}</strong><span>Cảnh báo</span></div>
              <div className={(preflight?.summary.blocked ?? 0) > 0 ? 'is-danger' : ''}><strong>{preflight?.summary.blocked ?? 0}</strong><span>Bị chặn</span></div>
            </div>
            <button className="icon-button checkpoint282-close" type="button" disabled={running} onClick={onClose} aria-label="Đóng">×</button>
          </div>
        </header>

        <div className="checkpoint282-workspace">
          <aside className="checkpoint282-settings-panel">
            <section className="checkpoint282-panel-section">
              <div className="checkpoint282-section-heading">
                <div><span className="checkpoint282-kicker">Preset CP282</span><h3>Browser & nguồn ảnh</h3></div>
                <span className="checkpoint282-tag">U2</span>
              </div>

              <label className="checkpoint282-field">
                <span>Giao diện Facebook</span>
                <select value={surface} disabled={started} onChange={(event) => setSurface(event.target.value as FacebookCheckpointSurface)}>
                  <option value="mbasic">{surfaceLabels.mbasic} · khuyên dùng</option>
                  <option value="mobile">{surfaceLabels.mobile}</option>
                  <option value="desktop">{surfaceLabels.desktop}</option>
                </select>
              </label>

              <label className="checkpoint282-field checkpoint282-field-spaced">
                <span>Locale preset</span>
                <select value={locale} disabled={started} onChange={(event) => setLocale(event.target.value as FacebookCheckpoint282Locale)}>
                  <option value="auto">{localeLabels.auto}</option>
                  <option value="vi-VN">{localeLabels['vi-VN']}</option>
                  <option value="en-US">{localeLabels['en-US']}</option>
                </select>
              </label>

              <label className="checkpoint282-field checkpoint282-field-spaced">
                <span>Folder ảnh nguồn · chỉ dùng khi UID chưa có trong Folder282</span>
                <div className="checkpoint282-folder-row">
                  <input value={sourceImageFolder} readOnly placeholder="Chưa chọn folder ảnh nguồn" title={sourceImageFolder} />
                  <button className="button secondary" type="button" disabled={started} onClick={() => void pickSourceFolder()}>Chọn</button>
                </div>
              </label>

              <div className="checkpoint282-preset-actions">
                <button className="button secondary" type="button" disabled={started || preflightLoading} onClick={() => void runPreflight()}>Preflight lại</button>
                <button className="button secondary" type="button" disabled={started || presetSaving} onClick={() => void savePreset()}>{presetSaving ? 'Đang lưu…' : 'Lưu preset'}</button>
              </div>
            </section>

            <section className="checkpoint282-panel-section">
              <div className="checkpoint282-section-heading compact">
                <div><span className="checkpoint282-kicker">Folder282</span><h3>Kho ảnh canonical</h3></div>
              </div>
              <div className="checkpoint282-readonly-path" title={canonicalFolder}>{canonicalFolder ? shortPath(canonicalFolder) : 'Đang xác định…'}</div>
              <p className="checkpoint282-caption">App tự quản lý folder này theo data root portable. Không hard-code ổ C và không import cả folder ảnh nguồn.</p>
            </section>

            <section className="checkpoint282-panel-section">
              <div className="checkpoint282-section-heading compact">
                <div><span className="checkpoint282-kicker">Evidence</span><h3>Bằng chứng runtime</h3></div>
              </div>
              <label className="checkpoint282-field">
                <span>Folder screenshot/log · tách khỏi ảnh CP282</span>
                <div className="checkpoint282-folder-row">
                  <input value={evidenceFolder} disabled={started} onChange={(event) => setEvidenceFolder(event.target.value)} placeholder="Tùy chọn" />
                  <button className="button secondary" type="button" disabled={started} onClick={() => void pickEvidenceFolder()}>Chọn</button>
                </div>
              </label>
            </section>

            <section className="checkpoint282-panel-section checkpoint282-run-card">
              <div className="checkpoint282-section-heading compact">
                <div><span className="checkpoint282-kicker">Lượt hiện tại</span><h3>{activeRow?.uid ?? 'Chưa chọn account'}</h3></div>
                {activeRow ? <span className={`checkpoint282-state state-${activeRow.state}`}>{checkpoint282StateLabel(activeRow.state)}</span> : null}
              </div>
              <dl className="checkpoint282-run-facts">
                <div><dt>Session gốc</dt><dd>{masterStatusLabel(activeAccount)}</dd></div>
                <div><dt>Surface</dt><dd>{surfaceLabels[surface]}</dd></div>
                <div><dt>Còn chờ</dt><dd>{pendingCount}</dd></div>
              </dl>
              {retryRow ? (
                <div className="checkpoint282-attention">
                  <strong>{retryRow.state === 'waiting_manual' ? `Đang giữ browser của ${retryRow.uid}` : `Cần thử lại ${retryRow.uid}`}</strong>
                  <span>{retryRow.state === 'waiting_manual' ? 'Hoàn tất bước Facebook yêu cầu trên browser, sau đó bấm Kiểm tra lại.' : retryRow.message}</span>
                </div>
              ) : <div className="checkpoint282-neutral-note">Preflight chỉ kiểm readiness. Runtime vẫn xác minh session/account thật khi Start.</div>}
            </section>
          </aside>

          <main className="checkpoint282-main-panel">
            <div className="checkpoint282-list-header">
              <div><span className="checkpoint282-kicker">Preflight & runtime</span><h3>Tài khoản đã chọn</h3></div>
              <div className="checkpoint282-list-legend">
                <span><i className="legend-dot is-ok" /> OK {preflight?.summary.ok ?? 0}</span>
                <span><i className="legend-dot is-warning" /> Cảnh báo {preflight?.summary.warning ?? 0}</span>
                <span><i className="legend-dot is-danger" /> Chặn {preflight?.summary.blocked ?? 0}</span>
              </div>
            </div>

            <div className="checkpoint282-grid-wrap">
              <table className="checkpoint282-table checkpoint282-table-u2">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>UID / Tên đăng nhập</th>
                    <th>Preflight</th>
                    <th>Ảnh 282</th>
                    <th>Session</th>
                    <th>CP State</th>
                    <th>Kết quả</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const account = accounts.find((item) => item.id === row.accountId)
                    const readiness = preflightByAccount.get(row.accountId)
                    const selected = selectedIndex === index
                    const retryable = canRecheckCheckpoint282(row.state)
                    return (
                      <tr
                        key={row.accountId}
                        className={`${selected ? 'is-selected' : ''} ${retryable ? 'is-waiting' : ''}`.trim()}
                        onClick={() => setSelectedIndex(index)}
                      >
                        <td className="checkpoint282-index">{index + 1}</td>
                        <td><div className="checkpoint282-account-cell"><strong>{row.uid}</strong>{account?.name ? <span>{account.name}</span> : null}</div></td>
                        <td><span className={`checkpoint282-preflight preflight-${readiness?.level ?? 'unknown'}`}>{preflightLevelLabel(readiness)}</span></td>
                        <td><span className={`checkpoint282-image-state image-${readiness?.image.state ?? 'unknown'}`}>{imageStateLabel(readiness)}</span></td>
                        <td><span className={`checkpoint282-master-status master-${account?.status ?? 'unknown'}`}>{masterStatusLabel(account)}</span></td>
                        <td><span className={`checkpoint282-state state-${row.state}`}>{checkpoint282StateLabel(row.state)}</span></td>
                        <td><div className="checkpoint282-message" title={row.message}>{row.message}</div></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {rows.length === 0 ? <div className="checkpoint282-empty-list">Không có tài khoản trong selection.</div> : null}
            </div>

            <section className="checkpoint282-detail-panel">
              <div className="checkpoint282-detail-header">
                <div><span className="checkpoint282-kicker">Chi tiết account</span><h3>{selectedRow?.uid ?? 'Chưa chọn'}</h3></div>
                {selectedPreflight ? <span className={`checkpoint282-preflight preflight-${selectedPreflight.level}`}>{preflightLevelLabel(selectedPreflight)}</span> : null}
              </div>
              {selectedRow ? (
                <div className="checkpoint282-detail-grid checkpoint282-detail-grid-u2">
                  <div><span>Ảnh 282</span><strong>{imageStateLabel(selectedPreflight)}</strong></div>
                  <div><span>Session readiness</span><strong>{selectedPreflight ? `${selectedPreflight.session.profileExists ? 'Profile' : 'No profile'} · ${selectedPreflight.session.hasCookie ? 'Cookie' : 'No cookie'} · ${selectedPreflight.session.hasPasswordFallback ? 'Password fallback' : 'No password'}` : 'Chưa preflight'}</strong></div>
                  <div><span>Chi tiết</span><strong title={selectedPreflight?.messages.join(' · ') || selectedRow.message}>{selectedPreflight?.messages.join(' · ') || selectedRow.message}</strong></div>
                </div>
              ) : <div className="checkpoint282-detail-empty">Chọn account để xem trạng thái chi tiết.</div>}
            </section>
          </main>
        </div>

        <footer className="checkpoint282-footer">
          <div className="checkpoint282-footer-status">
            <span className={`checkpoint282-footer-indicator ${retryRow ? 'is-warning' : running ? 'is-running' : blockedCount > 0 ? 'is-danger' : resolvedCount === rows.length && rows.length > 0 ? 'is-ok' : ''}`} />
            <div>
              <strong>{retryRow ? `Đang dừng tại ${retryRow.uid}` : running ? 'Đang xử lý account…' : blockedCount > 0 && !started ? `Preflight còn ${blockedCount} account bị chặn` : started ? 'Lượt CP282 đã dừng/kết thúc' : 'Sẵn sàng sau preflight'}</strong>
              <span>{started ? `${resolvedCount}/${rows.length} account đã xác minh` : 'Folder282 được ưu tiên trước Folder ảnh nguồn'}</span>
            </div>
          </div>
          <div className="checkpoint282-footer-actions">
            <button className="button secondary" type="button" disabled={running} onClick={onClose}>Đóng</button>
            {footerPrimary()}
          </div>
        </footer>
      </div>
    </div>
  )
}
