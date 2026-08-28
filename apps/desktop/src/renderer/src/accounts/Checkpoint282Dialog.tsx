import { useEffect, useMemo, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type {
  FacebookCheckpoint282Action,
  FacebookCheckpoint282Result,
  FacebookCheckpoint282RunAsset,
  FacebookCheckpointSurface
} from '../../../shared/facebookCheckpoint'
import type {
  FacebookCheckpoint282AccountPreflight,
  FacebookCheckpoint282AssetPreview,
  FacebookCheckpoint282HistoryEntry,
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
import './checkpoint282U3.css'
import './checkpoint282U4.css'

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

type AssetSelectionMap = Record<number, FacebookCheckpoint282RunAsset | undefined>

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

function fileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).at(-1) ?? path
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

function emailReadinessLabel(row: FacebookCheckpoint282AccountPreflight | undefined): string {
  if (!row) return 'Chưa kiểm tra'
  switch (row.verification.email.state) {
    case 'ready': return 'Email + OAuth OK'
    case 'missing_email': return 'Thiếu Email'
    case 'oauth_missing': return 'Thiếu OAuth'
    case 'oauth_pending': return 'OAuth chờ'
    case 'oauth_expired': return 'OAuth hết hạn'
    case 'oauth_error': return 'OAuth lỗi'
  }
}

function phoneReadinessLabel(row: FacebookCheckpoint282AccountPreflight | undefined): string {
  if (!row) return 'Chưa kiểm tra'
  return row.verification.phone.state === 'available'
    ? `${row.verification.phone.maskedNumber ?? 'Có phone'} · chờ route`
    : 'Không phone · chờ route'
}

function preflightLevelLabel(row: FacebookCheckpoint282AccountPreflight | undefined): string {
  if (!row) return 'Chưa kiểm tra'
  if (row.level === 'ok') return 'OK'
  if (row.level === 'warning') return 'Cảnh báo'
  return 'Bị chặn'
}

function promotionLabel(result: FacebookCheckpoint282Result): string {
  if (!result.assetPromotion) return result.message
  return `${result.message} · ${result.assetPromotion.message}`
}

function historyStateLabel(entry: FacebookCheckpoint282HistoryEntry): string {
  if (entry.state === 'asset_conflict_resolved') return 'Đã xử lý trùng'
  return checkpoint282StateLabel(entry.state)
}

function candidateSelection(
  readiness: FacebookCheckpoint282AccountPreflight,
  path: string
): FacebookCheckpoint282RunAsset | undefined {
  if (readiness.image.canonicalCandidates.includes(path)) {
    return { path, origin: 'canonical', replaceCanonical: false, confirmedUsed: false }
  }
  if (readiness.image.sourceCandidates.includes(path)) {
    return {
      path,
      origin: 'source',
      replaceCanonical: readiness.image.canonicalCandidateCount > 0,
      confirmedUsed: false
    }
  }
  return undefined
}

function reconcileAssetSelections(
  result: FacebookCheckpoint282PreflightResult,
  current: AssetSelectionMap
): AssetSelectionMap {
  const next: AssetSelectionMap = {}
  for (const row of result.rows) {
    const selected = current[row.accountId]
    const candidatePaths = [...row.image.canonicalCandidates, ...row.image.sourceCandidates]
    if (selected && candidatePaths.includes(selected.path)) {
      next[row.accountId] = selected
      continue
    }
    if (row.image.state === 'canonical' && row.image.canonicalPath) {
      next[row.accountId] = {
        path: row.image.canonicalPath,
        origin: 'canonical',
        replaceCanonical: false,
        confirmedUsed: false
      }
    }
  }
  return next
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
  const [assetSelections, setAssetSelections] = useState<AssetSelectionMap>({})
  const [preview, setPreview] = useState<FacebookCheckpoint282AssetPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [history, setHistory] = useState<FacebookCheckpoint282HistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [duplicateResolving, setDuplicateResolving] = useState(false)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [started, setStarted] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(accounts.length > 0 ? 0 : -1)

  const accountIds = useMemo(() => accounts.map((account) => account.id), [accounts])
  const resolvedCount = useMemo(() => rows.filter((row) => row.state === 'resolved').length, [rows])
  const retryIndex = rows.findIndex((row) => canRecheckCheckpoint282(row.state))
  const retryRow = retryIndex >= 0 ? rows[retryIndex] : null
  const runningIndex = rows.findIndex((row) => row.state === 'running')
  const stopIndex = runningIndex >= 0 ? runningIndex : retryIndex >= 0 ? retryIndex : selectedIndex
  const stopRow = stopIndex >= 0 ? rows[stopIndex] ?? null : null
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
  const selectedAsset = selectedRow ? assetSelections[selectedRow.accountId] : undefined
  const blockedCount = preflight?.summary.blocked ?? 0
  const sourceUnassignedCount = useMemo(
    () => (preflight?.rows ?? []).filter((row) => row.image.state === 'source' && assetSelections[row.accountId]?.origin !== 'source').length,
    [preflight, assetSelections]
  )
  const retryAsset = retryRow ? assetSelections[retryRow.accountId] : undefined
  const retryNeedsAssetConfirmation = Boolean(
    retryRow?.state === 'waiting_manual'
    && retryAsset?.origin === 'source'
    && !retryAsset.confirmedUsed
  )

  const currentPreset = (): FacebookCheckpoint282Preset => ({
    surface,
    locale,
    sourceImageFolder: sourceImageFolder.trim() || null
  })

  const applyPreflight = (result: FacebookCheckpoint282PreflightResult) => {
    setPreflight(result)
    setCanonicalFolder(result.canonicalFolder)
    setAssetSelections((current) => reconcileAssetSelections(result, current))
  }

  const runPreflight = async (preset: FacebookCheckpoint282Preset = currentPreset()) => {
    setPreflightLoading(true)
    try {
      const result = await window.pageAuto.preflightFacebookCheckpoint282({ accountIds, preset })
      applyPreflight(result)
      return result
    } finally {
      setPreflightLoading(false)
    }
  }

  const refreshHistory = async (accountId: number) => {
    setHistoryLoading(true)
    try {
      setHistory(await window.pageAuto.getFacebookCheckpoint282History({ accountId, limit: 50 }))
    } finally {
      setHistoryLoading(false)
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
        applyPreflight(result)
      } finally {
        if (!cancelled) setPreflightLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [accountIds])

  useEffect(() => {
    if (!selectedRow) {
      setHistory([])
      return
    }
    let cancelled = false
    setHistoryLoading(true)
    void window.pageAuto.getFacebookCheckpoint282History({ accountId: selectedRow.accountId, limit: 50 })
      .then((items) => { if (!cancelled) setHistory(items) })
      .finally(() => { if (!cancelled) setHistoryLoading(false) })
    return () => { cancelled = true }
  }, [selectedRow?.accountId])

  useEffect(() => {
    if (!selectedRow || !selectedAsset?.path) {
      setPreview(null)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    void window.pageAuto.previewFacebookCheckpoint282Asset({
      accountId: selectedRow.accountId,
      path: selectedAsset.path,
      preset: currentPreset()
    })
      .then((result) => { if (!cancelled) setPreview(result) })
      .catch(() => { if (!cancelled) setPreview(null) })
      .finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [selectedRow?.accountId, selectedAsset?.path, sourceImageFolder, surface, locale])

  const updateRow = (index: number, patch: Partial<Checkpoint282Row>) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  }

  const setAssetForAccount = (accountId: number, asset: FacebookCheckpoint282RunAsset | undefined) => {
    setAssetSelections((current) => ({ ...current, [accountId]: asset }))
  }

  const invoke = async (row: Checkpoint282Row, action: FacebookCheckpoint282Action): Promise<FacebookCheckpoint282Result> => {
    try {
      return await window.pageAuto.runFacebookCheckpoint282({
        accountId: row.accountId,
        surface,
        action,
        evidenceFolder: evidenceFolder.trim() || null,
        asset: assetSelections[row.accountId] ?? null
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
    if (running || stopping || startIndex < 0 || startIndex >= rows.length) return
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
            ? 'Đang kiểm tra lại session, account identity và asset đã track…'
            : 'Đang mở session và kiểm tra CP282…',
          evidencePath: null
        })
        const result = await invoke(row, action)
        updateRow(index, {
          state: result.state,
          message: promotionLabel(result),
          evidencePath: result.evidencePath ?? null
        })
        await refreshHistory(row.accountId)
        if (result.assetPromotion?.state === 'promoted' || result.assetPromotion?.state === 'replaced') {
          await runPreflight()
        }
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

  const selectAssetPath = (path: string) => {
    if (!selectedRow || !selectedPreflight) return
    setAssetForAccount(selectedRow.accountId, path ? candidateSelection(selectedPreflight, path) : undefined)
  }

  const confirmSelectedSourceUsed = (confirmedUsed: boolean) => {
    if (!selectedRow || !selectedAsset || selectedAsset.origin !== 'source') return
    setAssetForAccount(selectedRow.accountId, { ...selectedAsset, confirmedUsed })
  }

  const resolveDuplicate = async () => {
    if (!selectedRow || !selectedPreflight || !selectedAsset) return
    if (!selectedPreflight.image.canonicalCandidates.includes(selectedAsset.path)) return
    setDuplicateResolving(true)
    try {
      await window.pageAuto.resolveFacebookCheckpoint282Duplicate({
        accountId: selectedRow.accountId,
        keepPath: selectedAsset.path
      })
      await runPreflight()
      await refreshHistory(selectedRow.accountId)
    } finally {
      setDuplicateResolving(false)
    }
  }

  const revealPath = async (path: string | null | undefined) => {
    if (path) await window.pageAuto.revealFacebookCheckpoint282Path(path)
  }

  const stopCheckpoint282 = async (): Promise<boolean> => {
    if (stopping || !stopRow || stopIndex < 0) return !stopping
    setStopping(true)
    try {
      const result = await window.pageAuto.runFacebookCheckpoint282({
        accountId: stopRow.accountId,
        surface,
        action: 'stop',
        evidenceFolder: evidenceFolder.trim() || null,
        asset: null
      })
      updateRow(stopIndex, {
        state: result.state === 'stopped' ? 'stopped' : result.state,
        message: result.message,
        evidencePath: result.evidencePath ?? null
      })
      await refreshHistory(stopRow.accountId)
      return result.state === 'stopped'
    } catch (cause) {
      updateRow(stopIndex, {
        state: 'error',
        message: `Không thể dừng CP282 an toàn: ${cause instanceof Error ? cause.message : String(cause)}`
      })
      return false
    } finally {
      setStopping(false)
    }
  }

  const requestClose = async () => {
    if (stopping) return
    if (running || retryRow) {
      const stopped = await stopCheckpoint282()
      if (!stopped) return
    }
    onClose()
  }

  const footerPrimary = () => {
    if (!started) {
      const disabled = running || stopping || preflightLoading || rows.length === 0 || !preflight || blockedCount > 0 || sourceUnassignedCount > 0
      return (
        <button
          className="button primary checkpoint282-primary-action"
          type="button"
          disabled={disabled}
          onClick={() => void runSequence(0, 'start')}
        >
          {preflightLoading
            ? 'Đang preflight…'
            : blockedCount > 0
              ? `Còn ${blockedCount} account bị chặn`
              : sourceUnassignedCount > 0
                ? `Còn ${sourceUnassignedCount} account chưa chọn ảnh`
                : 'Bắt đầu CP282'}
        </button>
      )
    }
    if (retryRow && retryIndex >= 0 && canRecheckCheckpoint282(retryRow.state)) {
      return (
        <button
          className="button primary checkpoint282-primary-action"
          type="button"
          disabled={running || stopping || retryNeedsAssetConfirmation}
          onClick={() => void runSequence(retryIndex, 'recheck')}
        >
          {running
            ? 'Đang kiểm tra…'
            : stopping
              ? 'Đang dừng…'
              : retryNeedsAssetConfirmation
                ? 'Xác nhận ảnh đã dùng trước'
                : `Kiểm tra lại ${retryRow.uid}`}
        </button>
      )
    }
    return (
      <button className="button primary checkpoint282-primary-action" type="button" disabled>
        {running ? 'Đang chạy…' : stopping ? 'Đang dừng…' : 'Đã chạy xong lượt'}
      </button>
    )
  }

  const selectedCandidatePaths = selectedPreflight
    ? [...selectedPreflight.image.canonicalCandidates, ...selectedPreflight.image.sourceCandidates]
    : []
  const selectedIsDuplicateCandidate = Boolean(
    selectedAsset
    && selectedPreflight?.image.state === 'duplicate'
    && selectedPreflight.image.canonicalCandidates.includes(selectedAsset.path)
  )

  return (
    <div
      className="modal-backdrop checkpoint282-backdrop"
      role="presentation"
      onMouseDown={() => { if (!running && !retryRow && !stopping) onClose() }}
    >
      <div className="modal checkpoint282-dialog" role="dialog" aria-modal="true" aria-labelledby="checkpoint282-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="checkpoint282-header">
          <div className="checkpoint282-title-block">
            <div className="checkpoint282-brand-mark" aria-hidden="true">CP</div>
            <div>
              <p className="eyebrow">Facebook Common · Operator Workbench</p>
              <h2 id="checkpoint282-title">Checkpoint 282</h2>
              <p className="checkpoint282-subtitle">Track đúng ảnh/account · Email/OAuth canonical theo accountId · không bypass checkpoint</p>
            </div>
          </div>
          <div className="checkpoint282-header-right">
            <div className="checkpoint282-metrics" aria-label="Tổng quan preflight">
              <div><strong>{preflight?.summary.ok ?? 0}</strong><span>OK</span></div>
              <div className={(preflight?.summary.warning ?? 0) > 0 ? 'is-warning' : ''}><strong>{preflight?.summary.warning ?? 0}</strong><span>Cảnh báo</span></div>
              <div className={(preflight?.summary.blocked ?? 0) > 0 ? 'is-danger' : ''}><strong>{preflight?.summary.blocked ?? 0}</strong><span>Bị chặn</span></div>
            </div>
            <button className="icon-button checkpoint282-close" type="button" disabled={stopping} onClick={() => void requestClose()} aria-label="Đóng">×</button>
          </div>
        </header>

        <div className="checkpoint282-workspace">
          <aside className="checkpoint282-settings-panel">
            <section className="checkpoint282-panel-section">
              <div className="checkpoint282-section-heading">
                <div><span className="checkpoint282-kicker">Preset CP282</span><h3>Browser & nguồn ảnh</h3></div>
                <span className="checkpoint282-tag">U5</span>
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
                <span>Folder ảnh nguồn · chỉ dùng khi UID chưa có canonical hoặc chọn Replace</span>
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
              <p className="checkpoint282-caption">Chỉ ảnh nguồn được xác nhận đã dùng + CP282 resolved + c_user khớp UID số mới được promote. Replace luôn archive ảnh cũ.</p>
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
                  <strong>{retryRow.state === 'waiting_manual'
                    ? `Đang giữ browser của ${retryRow.uid}`
                    : retryRow.state === 'needs_login'
                      ? `Cần hoàn tất đăng nhập ${retryRow.uid}`
                      : `Cần thử lại ${retryRow.uid}`}</strong>
                  <span>{retryRow.state === 'waiting_manual'
                    ? 'Hoàn tất bước Facebook yêu cầu trực tiếp trên browser. Nếu dùng ảnh nguồn, xác nhận đúng ảnh preview trước khi Recheck.'
                    : retryRow.state === 'needs_login'
                      ? 'Browser/profile vẫn được giữ cho account này. Hoàn tất Login Common hoặc thao tác đăng nhập hợp lệ rồi bấm Kiểm tra lại.'
                      : retryRow.message}</span>
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
              <table className="checkpoint282-table checkpoint282-table-u2 checkpoint282-table-u4">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>UID / Tên đăng nhập</th>
                    <th>Preflight</th>
                    <th>Ảnh 282</th>
                    <th>Email / OAuth</th>
                    <th>Session</th>
                    <th>CP State</th>
                    <th>Kết quả</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const account = accounts.find((item) => item.id === row.accountId)
                    const readiness = preflightByAccount.get(row.accountId)
                    const asset = assetSelections[row.accountId]
                    const selected = selectedIndex === index
                    const retryable = canRecheckCheckpoint282(row.state)
                    const imageText = asset
                      ? `${asset.origin === 'canonical' ? 'Canonical' : asset.replaceCanonical ? 'Replace' : 'Source'} · ${fileName(asset.path)}`
                      : imageStateLabel(readiness)
                    return (
                      <tr
                        key={row.accountId}
                        className={`${selected ? 'is-selected' : ''} ${retryable ? 'is-waiting' : ''}`.trim()}
                        onClick={() => setSelectedIndex(index)}
                      >
                        <td className="checkpoint282-index">{index + 1}</td>
                        <td><div className="checkpoint282-account-cell"><strong>{row.uid}</strong>{account?.name ? <span>{account.name}</span> : null}</div></td>
                        <td><span className={`checkpoint282-preflight preflight-${readiness?.level ?? 'unknown'}`}>{preflightLevelLabel(readiness)}</span></td>
                        <td><span className={`checkpoint282-image-state image-${readiness?.image.state ?? 'unknown'}`} title={asset?.path}>{imageText}</span></td>
                        <td>
                          <div className="checkpoint282-email-readiness" title={readiness?.verification.email.message}>
                            <span className={`checkpoint282-email-state email-${readiness?.verification.email.state ?? 'unknown'}`}>{emailReadinessLabel(readiness)}</span>
                            <small>{readiness?.verification.email.maskedAddress ?? (readiness?.verification.phone.state === 'available' ? 'Có phone canonical' : 'Không có Email canonical')}</small>
                          </div>
                        </td>
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

            <section className="checkpoint282-detail-panel checkpoint282-detail-panel-u3">
              <div className="checkpoint282-detail-header">
                <div><span className="checkpoint282-kicker">Ảnh, readiness & lịch sử</span><h3>{selectedRow?.uid ?? 'Chưa chọn'}</h3></div>
                <div className="checkpoint282-detail-header-actions">
                  {selectedRow?.evidencePath ? <button className="button secondary" type="button" onClick={() => void revealPath(selectedRow.evidencePath)}>Mở Evidence</button> : null}
                  {selectedPreflight ? <span className={`checkpoint282-preflight preflight-${selectedPreflight.level}`}>{preflightLevelLabel(selectedPreflight)}</span> : null}
                </div>
              </div>

              {selectedRow && selectedPreflight ? (
                <div className="checkpoint282-u3-layout">
                  <div className="checkpoint282-asset-editor">
                    <div className="checkpoint282-asset-toolbar">
                      <label className="checkpoint282-field checkpoint282-asset-select">
                        <span>Ảnh track cho account này</span>
                        <select
                          value={selectedAsset?.path ?? ''}
                          disabled={running || stopping}
                          onChange={(event) => selectAssetPath(event.target.value)}
                        >
                          <option value="">— Chọn ảnh cụ thể —</option>
                          {selectedPreflight.image.canonicalCandidates.map((path) => (
                            <option key={`canonical-${path}`} value={path}>Canonical · {fileName(path)}</option>
                          ))}
                          {selectedPreflight.image.sourceCandidates.map((path) => (
                            <option key={`source-${path}`} value={path}>{selectedPreflight.image.canonicalCandidateCount > 0 ? 'Replace' : 'Source'} · {fileName(path)}</option>
                          ))}
                        </select>
                      </label>
                      <div className="checkpoint282-inline-actions">
                        {selectedIsDuplicateCandidate ? (
                          <button className="button secondary" type="button" disabled={running || stopping || duplicateResolving} onClick={() => void resolveDuplicate()}>
                            {duplicateResolving ? 'Đang xử lý…' : 'Giữ ảnh này'}
                          </button>
                        ) : null}
                        {selectedAsset ? <button className="button secondary" type="button" disabled={stopping} onClick={() => void revealPath(selectedAsset.path)}>Mở vị trí ảnh</button> : null}
                      </div>
                    </div>

                    <div className="checkpoint282-preview">
                      {previewLoading ? <span>Đang tải preview…</span> : preview ? <img src={preview.dataUrl} alt={`Ảnh CP282 ${selectedRow.uid}`} /> : <span>Chọn ảnh để preview.</span>}
                    </div>

                    <div className="checkpoint282-asset-facts">
                      <div><span>Readiness</span><strong>{imageStateLabel(selectedPreflight)}</strong></div>
                      <div><span>File đang track</span><strong title={selectedAsset?.path}>{selectedAsset ? fileName(selectedAsset.path) : 'Chưa chọn'}</strong></div>
                      <div><span>Chế độ</span><strong>{selectedAsset?.origin === 'canonical' ? 'Dùng canonical' : selectedAsset?.replaceCanonical ? 'Replace canonical' : selectedAsset?.origin === 'source' ? 'Source mới' : '—'}</strong></div>
                    </div>

                    <div className="checkpoint282-verification-card">
                      <div className="checkpoint282-verification-card-head">
                        <strong>Email / OAuth / Phone canonical</strong>
                        <span>read-only · theo accountId</span>
                      </div>
                      <div className="checkpoint282-verification-grid">
                        <div>
                          <span>Email</span>
                          <strong>{selectedPreflight.verification.email.maskedAddress ?? 'Chưa có Email'}</strong>
                          <small>{emailReadinessLabel(selectedPreflight)}</small>
                        </div>
                        <div>
                          <span>OAuth</span>
                          <strong>{selectedPreflight.verification.email.hasClientId && selectedPreflight.verification.email.hasRefreshToken ? 'Có Client ID + Refresh Token' : 'Chưa đủ canonical OAuth'}</strong>
                          <small>{selectedPreflight.verification.email.oauthStatus} · mail {selectedPreflight.verification.email.mailStatus}</small>
                        </div>
                        <div>
                          <span>Phone</span>
                          <strong>{phoneReadinessLabel(selectedPreflight)}</strong>
                          <small>Common classifier mới quyết định route</small>
                        </div>
                      </div>
                      <p className="checkpoint282-verification-note">{selectedPreflight.verification.email.message} Phone không được coi là usable chỉ vì có số; route phải được Facebook Common xác nhận. Workbench không nhận mailbox/token tùy ý.</p>
                    </div>

                    {selectedPreflight.image.state === 'duplicate' ? (
                      <div className="checkpoint282-asset-warning">Có nhiều canonical cùng UID. Chọn đúng một ảnh canonical ở trên rồi bấm <strong>Giữ ảnh này</strong>; các ảnh còn lại được chuyển vào archive, không xóa mất.</div>
                    ) : null}

                    {selectedAsset?.origin === 'source' && selectedRow.state === 'waiting_manual' ? (
                      <label className="checkpoint282-confirm-used">
                        <input
                          type="checkbox"
                          checked={selectedAsset.confirmedUsed}
                          disabled={running || stopping}
                          onChange={(event) => confirmSelectedSourceUsed(event.target.checked)}
                        />
                        <span><strong>Đã dùng đúng ảnh đang preview trên Facebook</strong><small>Chỉ xác nhận sau khi anh thực sự dùng file này cho bước CP282. Recheck mới có quyền promote nếu UID số được verify.</small></span>
                      </label>
                    ) : null}

                    {selectedAsset?.origin === 'source' && selectedRow.state !== 'waiting_manual' ? (
                      <div className="checkpoint282-asset-note">Ảnh nguồn chỉ đang được track, chưa được coi là đã dùng. Nếu CP282 yêu cầu thao tác thủ công, xác nhận file sau khi dùng rồi mới Recheck.</div>
                    ) : null}
                  </div>

                  <div className="checkpoint282-history-panel">
                    <div className="checkpoint282-history-heading">
                      <div><span className="checkpoint282-kicker">History</span><h4>CP282 của account</h4></div>
                      <span>{historyLoading ? 'Đang tải…' : `${history.length} mục`}</span>
                    </div>
                    <div className="checkpoint282-history-list">
                      {history.map((entry) => (
                        <div className="checkpoint282-history-item" key={entry.id}>
                          <div className="checkpoint282-history-item-head">
                            <strong>{historyStateLabel(entry)}</strong>
                            <time>{new Date(entry.at).toLocaleString()}</time>
                          </div>
                          <p>{entry.message}</p>
                          <div className="checkpoint282-history-meta">
                            {entry.assetPath ? <button type="button" onClick={() => void revealPath(entry.assetPath ?? null)}>{entry.assetOrigin === 'source' ? 'Ảnh source' : 'Ảnh canonical'}</button> : null}
                            {entry.canonicalPath ? <button type="button" onClick={() => void revealPath(entry.canonicalPath ?? null)}>Folder282</button> : null}
                            {entry.evidencePath ? <button type="button" onClick={() => void revealPath(entry.evidencePath ?? null)}>Evidence</button> : null}
                            {entry.promotionState ? <span>Asset: {entry.promotionState}</span> : null}
                          </div>
                        </div>
                      ))}
                      {!historyLoading && history.length === 0 ? <div className="checkpoint282-history-empty">Chưa có history CP282 cho account này.</div> : null}
                    </div>
                  </div>
                </div>
              ) : <div className="checkpoint282-detail-empty">Chọn account để xem ảnh, preview, Email/OAuth readiness và history.</div>}
            </section>
          </main>
        </div>

        <footer className="checkpoint282-footer">
          <div className="checkpoint282-footer-status">
            <span className={`checkpoint282-footer-indicator ${retryRow ? 'is-warning' : running ? 'is-running' : blockedCount > 0 ? 'is-danger' : resolvedCount === rows.length && rows.length > 0 ? 'is-ok' : ''}`} />
            <div>
              <strong>{retryRow
                ? `Đang dừng tại ${retryRow.uid}`
                : running
                  ? 'Đang xử lý account…'
                  : blockedCount > 0 && !started
                    ? `Preflight còn ${blockedCount} account bị chặn`
                    : sourceUnassignedCount > 0 && !started
                      ? `Còn ${sourceUnassignedCount} account cần chọn ảnh cụ thể`
                      : started
                        ? 'Lượt CP282 đã dừng/kết thúc'
                        : 'Sẵn sàng sau preflight'}</strong>
              <span>{started ? `${resolvedCount}/${rows.length} account đã xác minh` : 'Folder282 ưu tiên; Email/OAuth chỉ đọc canonical theo accountId'}</span>
            </div>
          </div>
          <div className="checkpoint282-footer-actions">
            {(running || retryRow) ? (
              <button className="button secondary" type="button" disabled={stopping} onClick={() => void stopCheckpoint282()}>
                {stopping ? 'Đang dừng…' : 'Dừng & đóng browser'}
              </button>
            ) : null}
            <button className="button secondary" type="button" disabled={stopping} onClick={() => void requestClose()}>Đóng</button>
            {footerPrimary()}
          </div>
        </footer>
      </div>
    </div>
  )
}
