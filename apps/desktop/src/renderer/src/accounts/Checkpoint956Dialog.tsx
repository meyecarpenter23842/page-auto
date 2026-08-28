import { useMemo, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type {
  FacebookCheckpoint282Action,
  FacebookCheckpoint282Result
} from '../../../shared/facebookCheckpoint'
import {
  canRecheckCheckpoint956,
  checkpoint956StateLabel,
  shouldPauseCheckpoint956Sequence,
  type Checkpoint956UiState
} from './checkpoint956Ui'
import './checkpoint282.css'

interface Checkpoint956DialogProps {
  accounts: AccountRecord[]
  onClose: () => void
}

interface Checkpoint956Row {
  accountId: number
  uid: string
  state: Checkpoint956UiState
  message: string
}

function initialRows(accounts: AccountRecord[]): Checkpoint956Row[] {
  return accounts.map((account) => ({
    accountId: account.id,
    uid: account.uid,
    state: 'pending',
    message: 'Chưa chạy.'
  }))
}

function masterStatusLabel(account: AccountRecord | undefined): string {
  if (!account) return '—'
  if (account.status === 'valid') return 'Sẵn sàng'
  if (account.status === 'needs_login') return 'Cần login'
  if (account.status === 'disabled') return 'Đã tắt'
  return 'Chưa rõ'
}

function browserIsHeld(row: Checkpoint956Row | null): boolean {
  return row?.state === 'waiting_manual'
    || row?.state === 'waiting'
    || row?.state === 'needs_attention'
    || row?.state === 'needs_login'
}

export function Checkpoint956Dialog({ accounts, onClose }: Checkpoint956DialogProps) {
  const [rows, setRows] = useState<Checkpoint956Row[]>(() => initialRows(accounts))
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [started, setStarted] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(accounts.length > 0 ? 0 : -1)
  const [activeRunIndex, setActiveRunIndex] = useState(-1)

  const resolvedCount = useMemo(() => rows.filter((row) => row.state === 'resolved').length, [rows])
  const attentionCount = useMemo(() => rows.filter((row) => (
    row.state === 'waiting_manual'
    || row.state === 'waiting'
    || row.state === 'needs_attention'
    || row.state === 'needs_login'
    || row.state === 'checkpoint_timeout'
    || row.state === 'error'
  )).length, [rows])
  const pendingCount = rows.filter((row) => row.state === 'pending').length
  const retryIndex = rows.findIndex((row) => canRecheckCheckpoint956(row.state))
  const retryRow = retryIndex >= 0 ? rows[retryIndex] ?? null : null
  const heldIndex = rows.findIndex((row) => browserIsHeld(row))
  const stopIndex = activeRunIndex >= 0 ? activeRunIndex : heldIndex
  const stopRow = stopIndex >= 0 ? rows[stopIndex] ?? null : null
  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] ?? null : null
  const selectedAccount = selectedRow
    ? accounts.find((account) => account.id === selectedRow.accountId)
    : undefined
  const activeRow = retryRow ?? (activeRunIndex >= 0 ? rows[activeRunIndex] ?? null : selectedRow)
  const activeAccount = activeRow
    ? accounts.find((account) => account.id === activeRow.accountId)
    : undefined

  const updateRow = (index: number, patch: Partial<Checkpoint956Row>) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  }

  const invoke = async (row: Checkpoint956Row, action: FacebookCheckpoint282Action): Promise<FacebookCheckpoint282Result> => {
    try {
      return await window.pageAuto.runFacebookCheckpoint282({
        accountId: row.accountId,
        surface: 'desktop',
        action,
        checkpointKind: '956',
        evidenceFolder: null,
        asset: null
      })
    } catch (cause) {
      return {
        accountId: row.accountId,
        uid: row.uid,
        state: 'error',
        surface: 'desktop',
        checkpointKind: '956',
        message: cause instanceof Error ? cause.message : String(cause)
      }
    }
  }

  const runSequence = async (startIndex: number, firstAction: FacebookCheckpoint282Action) => {
    if (running || stopping || startIndex < 0 || startIndex >= rows.length) return
    setStarted(true)
    setRunning(true)
    try {
      const endIndex = firstAction === 'recheck' ? startIndex + 1 : rows.length
      for (let index = startIndex; index < endIndex; index += 1) {
        const row = rows[index]
        if (!row) continue
        setSelectedIndex(index)
        setActiveRunIndex(index)
        const action = index === startIndex ? firstAction : 'start'
        updateRow(index, {
          state: 'running',
          message: action === 'recheck'
            ? 'Đang inspect lại live challenge trước khi xác minh session…'
            : 'Đang mở profile và inspect live challenge trước bootstrap…'
        })
        const result = await invoke(row, action)
        updateRow(index, { state: result.state, message: result.message })
        if (shouldPauseCheckpoint956Sequence(result.state)) {
          setSelectedIndex(index)
          break
        }
      }
    } finally {
      setActiveRunIndex(-1)
      setRunning(false)
    }
  }

  const stopRowByIndex = async (index: number): Promise<boolean> => {
    const row = rows[index]
    if (!row) return true
    const result = await invoke(row, 'stop')
    updateRow(index, { state: result.state, message: result.message })
    return result.state === 'stopped'
  }

  const stopCheckpoint956 = async (): Promise<boolean> => {
    if (stopping || !stopRow || stopIndex < 0) return !stopping && !running
    setStopping(true)
    try {
      return await stopRowByIndex(stopIndex)
    } finally {
      setStopping(false)
    }
  }

  const requestClose = async () => {
    if (stopping) return
    setStopping(true)
    try {
      const indices = new Set<number>()
      if (activeRunIndex >= 0) indices.add(activeRunIndex)
      rows.forEach((row, index) => {
        if (browserIsHeld(row)) indices.add(index)
      })
      for (const index of indices) {
        if (!await stopRowByIndex(index)) return
      }
      onClose()
    } finally {
      setStopping(false)
    }
  }

  const footerPrimary = () => {
    if (!started) {
      return (
        <button
          className="button primary checkpoint282-primary-action"
          type="button"
          disabled={running || stopping || rows.length === 0}
          onClick={() => void runSequence(0, 'start')}
        >
          Bắt đầu CP956
        </button>
      )
    }
    if (retryRow && retryIndex >= 0) {
      return (
        <button
          className="button primary checkpoint282-primary-action"
          type="button"
          disabled={running || stopping}
          onClick={() => void runSequence(retryIndex, 'recheck')}
        >
          {running ? 'Đang kiểm tra…' : `Kiểm tra lại ${retryRow.uid}`}
        </button>
      )
    }
    return (
      <button className="button primary checkpoint282-primary-action" type="button" disabled>
        {running ? 'Đang chạy…' : stopping ? 'Đang dừng…' : 'Đã chạy xong lượt'}
      </button>
    )
  }

  return (
    <div
      className="modal-backdrop checkpoint282-backdrop"
      role="presentation"
      onMouseDown={() => { if (!running && heldIndex < 0 && !stopping) onClose() }}
    >
      <div className="modal checkpoint282-dialog" role="dialog" aria-modal="true" aria-labelledby="checkpoint956-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="checkpoint282-header">
          <div className="checkpoint282-title-block">
            <div className="checkpoint282-brand-mark" aria-hidden="true">956</div>
            <div>
              <p className="eyebrow">Facebook Common · Operator Workbench</p>
              <h2 id="checkpoint956-title">Checkpoint 956</h2>
              <p className="checkpoint282-subtitle">Inspect live challenge → continuation an toàn → xác minh session → account kế tiếp</p>
            </div>
          </div>
          <div className="checkpoint282-header-right">
            <div className="checkpoint282-metrics" aria-label="Tổng quan CP956">
              <div><strong>{resolvedCount}</strong><span>Đã xong</span></div>
              <div className={attentionCount > 0 ? 'is-warning' : ''}><strong>{attentionCount}</strong><span>Chờ xử lý</span></div>
              <div><strong>{rows.length}</strong><span>Tổng</span></div>
            </div>
            <button className="icon-button checkpoint282-close" type="button" disabled={stopping} onClick={() => void requestClose()} aria-label="Đóng">×</button>
          </div>
        </header>

        <div className="checkpoint282-workspace">
          <aside className="checkpoint282-settings-panel">
            <section className="checkpoint282-panel-section">
              <div className="checkpoint282-section-heading">
                <div><span className="checkpoint282-kicker">Thiết lập CP956</span><h3>Phiên xử lý</h3></div>
                <span className="checkpoint282-tag">956</span>
              </div>
              <dl className="checkpoint282-run-facts">
                <div><dt>Tài khoản</dt><dd>{accounts.length}</dd></div>
                <div><dt>Thứ tự</dt><dd>Tuần tự · account chờ không chặn batch</dd></div>
                <div><dt>Browser</dt><dd>Giữ có watchdog khi cần operator</dd></div>
              </dl>
              <p className="checkpoint282-caption">Identity/security review chỉ pause account đó; PAGE-AUTO không bypass. Login/2FA/Email chỉ continuation bằng dữ liệu canonical của chính account.</p>
            </section>

            <section className="checkpoint282-panel-section checkpoint282-run-card">
              <div className="checkpoint282-section-heading compact">
                <div><span className="checkpoint282-kicker">Lượt hiện tại</span><h3>{activeRow?.uid ?? 'Chưa chọn account'}</h3></div>
                {activeRow ? <span className={`checkpoint282-state state-${activeRow.state}`}>{checkpoint956StateLabel(activeRow.state)}</span> : null}
              </div>
              <dl className="checkpoint282-run-facts">
                <div><dt>Session gốc</dt><dd>{masterStatusLabel(activeAccount)}</dd></div>
                <div><dt>Còn chờ</dt><dd>{pendingCount}</dd></div>
              </dl>
              {retryRow ? (
                <div className="checkpoint282-attention">
                  <strong>{browserIsHeld(retryRow) ? `Đang giữ browser ${retryRow.uid}` : `Cần thử lại ${retryRow.uid}`}</strong>
                  <span>{retryRow.message}</span>
                </div>
              ) : <div className="checkpoint282-neutral-note">Bấm Bắt đầu để chạy các account đã chọn lần lượt.</div>}
            </section>
          </aside>

          <main className="checkpoint282-main-panel">
            <div className="checkpoint282-list-header">
              <div><span className="checkpoint282-kicker">Runtime</span><h3>Tài khoản đã chọn</h3></div>
              <div className="checkpoint282-list-legend"><span>Đã xong {resolvedCount}/{rows.length}</span></div>
            </div>

            <div className="checkpoint282-grid-wrap">
              <table className="checkpoint282-table">
                <thead><tr><th>#</th><th>Tài khoản</th><th>Master</th><th>CP956</th><th>Thông báo</th></tr></thead>
                <tbody>
                  {rows.map((row, index) => {
                    const account = accounts.find((item) => item.id === row.accountId)
                    return (
                      <tr
                        key={row.accountId}
                        className={`${selectedIndex === index ? 'is-selected' : ''} ${browserIsHeld(row) ? 'is-waiting' : ''}`}
                        onClick={() => setSelectedIndex(index)}
                      >
                        <td className="checkpoint282-index">{index + 1}</td>
                        <td><div className="checkpoint282-account-cell"><strong>{row.uid}</strong><span>{account?.name ?? '—'}</span></div></td>
                        <td><span className={`checkpoint282-master-status master-${account?.status ?? 'unknown'}`}>{masterStatusLabel(account)}</span></td>
                        <td><span className={`checkpoint282-state state-${row.state}`}>{checkpoint956StateLabel(row.state)}</span></td>
                        <td><span className="checkpoint282-message" title={row.message}>{row.message}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <section className="checkpoint282-detail-panel">
              <div className="checkpoint282-detail-header">
                <div><span className="checkpoint282-kicker">Account đang chọn</span><h3>{selectedRow?.uid ?? '—'}</h3></div>
                {selectedRow ? <span className={`checkpoint282-state state-${selectedRow.state}`}>{checkpoint956StateLabel(selectedRow.state)}</span> : null}
              </div>
              {selectedRow ? (
                <div className="checkpoint282-detail-grid">
                  <div><span>Thông báo</span><strong title={selectedRow.message}>{selectedRow.message}</strong></div>
                  <div><span>Master</span><strong>{masterStatusLabel(selectedAccount)}</strong></div>
                  <div><span>Browser</span><strong>{browserIsHeld(selectedRow) ? 'Đang giữ · có watchdog' : 'Không giữ'}</strong></div>
                </div>
              ) : <div className="checkpoint282-detail-empty">Không có account.</div>}
            </section>
          </main>
        </div>

        <footer className="checkpoint282-footer">
          <div className="checkpoint282-footer-status">
            <i className={`checkpoint282-footer-indicator ${running ? 'is-running' : retryRow ? 'is-warning' : resolvedCount === rows.length && rows.length > 0 ? 'is-ok' : ''}`} />
            <div>
              <strong>{running ? 'Đang chạy CP956' : retryRow ? `Cần xử lý ${retryRow.uid}` : 'CP956 Workbench'}</strong>
              <span>{resolvedCount}/{rows.length} account đã xác minh</span>
            </div>
          </div>
          <div className="checkpoint282-footer-actions">
            {(running || stopRow) ? <button className="button danger" type="button" disabled={stopping} onClick={() => void stopCheckpoint956()}>{stopping ? 'Đang dừng…' : 'Dừng & đóng browser'}</button> : null}
            <button className="button secondary" type="button" disabled={stopping} onClick={() => void requestClose()}>Đóng</button>
            {footerPrimary()}
          </div>
        </footer>
      </div>
    </div>
  )
}
