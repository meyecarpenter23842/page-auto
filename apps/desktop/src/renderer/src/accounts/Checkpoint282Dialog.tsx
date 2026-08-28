import { useMemo, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type {
  FacebookCheckpoint282Action,
  FacebookCheckpoint282Result,
  FacebookCheckpointSurface
} from '../../../shared/facebookCheckpoint'
import {
  canRecheckCheckpoint282,
  checkpoint282StateLabel,
  shouldPauseCheckpoint282Sequence,
  type Checkpoint282UiState
} from './checkpoint282Ui'
import './checkpoint282.css'

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

export function Checkpoint282Dialog({ accounts, onClose }: Checkpoint282DialogProps) {
  const [surface, setSurface] = useState<FacebookCheckpointSurface>('mbasic')
  const [evidenceFolder, setEvidenceFolder] = useState('')
  const [rows, setRows] = useState<Checkpoint282Row[]>(() => initialRows(accounts))
  const [running, setRunning] = useState(false)
  const [started, setStarted] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(accounts.length > 0 ? 0 : -1)

  const resolvedCount = useMemo(() => rows.filter((row) => row.state === 'resolved').length, [rows])
  const waitingIndex = rows.findIndex((row) => row.state === 'waiting_manual')
  const waitingRow = waitingIndex >= 0 ? rows[waitingIndex] : null
  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] ?? null : null
  const selectedAccount = selectedRow
    ? accounts.find((account) => account.id === selectedRow.accountId)
    : undefined
  const activeRow = waitingRow ?? selectedRow
  const activeAccount = activeRow
    ? accounts.find((account) => account.id === activeRow.accountId)
    : undefined
  const pendingCount = rows.filter((row) => row.state === 'pending').length

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

  const pickEvidenceFolder = async () => {
    const picked = await window.pageAuto.pickFacebookCheckpointEvidenceFolder()
    if (picked) setEvidenceFolder(picked)
  }

  const footerPrimary = () => {
    if (!started) {
      return (
        <button
          className="button primary checkpoint282-primary-action"
          type="button"
          disabled={running || rows.length === 0}
          onClick={() => void runSequence(0, 'start')}
        >
          Bắt đầu CP282
        </button>
      )
    }
    if (waitingRow && waitingIndex >= 0 && canRecheckCheckpoint282(waitingRow.state)) {
      return (
        <button
          className="button primary checkpoint282-primary-action"
          type="button"
          disabled={running}
          onClick={() => void runSequence(waitingIndex, 'recheck')}
        >
          {running ? 'Đang kiểm tra…' : `Kiểm tra lại ${waitingRow.uid}`}
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
              <p className="checkpoint282-subtitle">Giữ đúng browser account · chạy tuần tự · xác minh lại session trước khi tiếp tục</p>
            </div>
          </div>
          <div className="checkpoint282-header-right">
            <div className="checkpoint282-metrics" aria-label="Tổng quan lượt chạy">
              <div><strong>{accounts.length}</strong><span>Tài khoản</span></div>
              <div><strong>{resolvedCount}</strong><span>Đã xác minh</span></div>
              <div className={waitingRow ? 'is-warning' : ''}><strong>{waitingRow ? 1 : 0}</strong><span>Đang chờ</span></div>
            </div>
            <button className="icon-button checkpoint282-close" type="button" disabled={running} onClick={onClose} aria-label="Đóng">×</button>
          </div>
        </header>

        <div className="checkpoint282-workspace">
          <aside className="checkpoint282-settings-panel">
            <section className="checkpoint282-panel-section">
              <div className="checkpoint282-section-heading">
                <div>
                  <span className="checkpoint282-kicker">Thiết lập</span>
                  <h3>Browser & phiên chạy</h3>
                </div>
                <span className="checkpoint282-tag">CP282</span>
              </div>

              <label className="checkpoint282-field">
                <span>Giao diện Facebook</span>
                <select value={surface} disabled={started} onChange={(event) => setSurface(event.target.value as FacebookCheckpointSurface)}>
                  <option value="mbasic">{surfaceLabels.mbasic} · khuyên dùng</option>
                  <option value="mobile">{surfaceLabels.mobile}</option>
                  <option value="desktop">{surfaceLabels.desktop}</option>
                </select>
              </label>

              <div className="checkpoint282-inline-hint">
                <span className="checkpoint282-dot is-ok" />
                Login dùng Facebook Common: cookie/session trước, password và 2FA chỉ khi cần.
              </div>
            </section>

            <section className="checkpoint282-panel-section">
              <div className="checkpoint282-section-heading compact">
                <div>
                  <span className="checkpoint282-kicker">Evidence</span>
                  <h3>Ảnh kết quả</h3>
                </div>
              </div>
              <label className="checkpoint282-field">
                <span>Thư mục lưu ảnh thành công</span>
                <div className="checkpoint282-folder-row">
                  <input
                    value={evidenceFolder}
                    disabled={started}
                    onChange={(event) => setEvidenceFolder(event.target.value)}
                    placeholder="Tùy chọn · để trống nếu không lưu"
                  />
                  <button className="button secondary" type="button" disabled={started} onClick={() => void pickEvidenceFolder()}>Chọn</button>
                </div>
              </label>
              <p className="checkpoint282-caption">Sau khi kiểm tra lại thành công, ảnh được lưu theo UID/Tên đăng nhập của account.</p>
            </section>

            <section className="checkpoint282-panel-section checkpoint282-run-card">
              <div className="checkpoint282-section-heading compact">
                <div>
                  <span className="checkpoint282-kicker">Lượt hiện tại</span>
                  <h3>{activeRow?.uid ?? 'Chưa chọn account'}</h3>
                </div>
                {activeRow ? <span className={`checkpoint282-state state-${activeRow.state}`}>{checkpoint282StateLabel(activeRow.state)}</span> : null}
              </div>
              <dl className="checkpoint282-run-facts">
                <div><dt>Session gốc</dt><dd>{masterStatusLabel(activeAccount)}</dd></div>
                <div><dt>Surface</dt><dd>{surfaceLabels[surface]}</dd></div>
                <div><dt>Còn chờ</dt><dd>{pendingCount}</dd></div>
              </dl>
              {waitingRow ? (
                <div className="checkpoint282-attention">
                  <strong>Đang giữ browser của {waitingRow.uid}</strong>
                  <span>Hoàn tất bước Facebook yêu cầu trên browser, sau đó dùng nút Kiểm tra lại bên dưới.</span>
                </div>
              ) : (
                <div className="checkpoint282-neutral-note">Chọn một dòng bên phải để xem chi tiết account và kết quả.</div>
              )}
            </section>
          </aside>

          <main className="checkpoint282-main-panel">
            <div className="checkpoint282-list-header">
              <div>
                <span className="checkpoint282-kicker">Danh sách xử lý</span>
                <h3>Tài khoản đã chọn</h3>
              </div>
              <div className="checkpoint282-list-legend">
                <span><i className="legend-dot is-ok" /> Đã xong {resolvedCount}</span>
                <span><i className="legend-dot" /> Chờ {pendingCount}</span>
              </div>
            </div>

            <div className="checkpoint282-grid-wrap">
              <table className="checkpoint282-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>UID / Tên đăng nhập</th>
                    <th>Session</th>
                    <th>CP State</th>
                    <th>Kết quả</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const account = accounts.find((item) => item.id === row.accountId)
                    const selected = selectedIndex === index
                    const waiting = row.state === 'waiting_manual'
                    return (
                      <tr
                        key={row.accountId}
                        className={`${selected ? 'is-selected' : ''} ${waiting ? 'is-waiting' : ''}`.trim()}
                        onClick={() => setSelectedIndex(index)}
                      >
                        <td className="checkpoint282-index">{index + 1}</td>
                        <td>
                          <div className="checkpoint282-account-cell">
                            <strong>{row.uid}</strong>
                            {account?.name ? <span>{account.name}</span> : null}
                          </div>
                        </td>
                        <td><span className={`checkpoint282-master-status master-${account?.status ?? 'unknown'}`}>{masterStatusLabel(account)}</span></td>
                        <td><span className={`checkpoint282-state state-${row.state}`}>{checkpoint282StateLabel(row.state)}</span></td>
                        <td><div className="checkpoint282-message" title={row.message}>{row.message}</div></td>
                        <td>
                          {row.evidencePath
                            ? <span className="checkpoint282-evidence" title={row.evidencePath}>{shortPath(row.evidencePath)}</span>
                            : <span className="checkpoint282-empty">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {rows.length === 0 ? <div className="checkpoint282-empty-list">Không có tài khoản trong selection.</div> : null}
            </div>

            <section className="checkpoint282-detail-panel">
              <div className="checkpoint282-detail-header">
                <div>
                  <span className="checkpoint282-kicker">Chi tiết account</span>
                  <h3>{selectedRow?.uid ?? 'Chưa chọn'}</h3>
                </div>
                {selectedRow ? <span className={`checkpoint282-state state-${selectedRow.state}`}>{checkpoint282StateLabel(selectedRow.state)}</span> : null}
              </div>
              {selectedRow ? (
                <div className="checkpoint282-detail-grid">
                  <div>
                    <span>Trạng thái</span>
                    <strong>{selectedRow.message}</strong>
                  </div>
                  <div>
                    <span>Account</span>
                    <strong>{selectedAccount?.name || selectedRow.uid}</strong>
                  </div>
                  <div>
                    <span>Evidence</span>
                    <strong title={selectedRow.evidencePath ?? undefined}>{selectedRow.evidencePath ? shortPath(selectedRow.evidencePath) : 'Chưa có'}</strong>
                  </div>
                </div>
              ) : <div className="checkpoint282-detail-empty">Chọn account để xem trạng thái chi tiết.</div>}
            </section>
          </main>
        </div>

        <footer className="checkpoint282-footer">
          <div className="checkpoint282-footer-status">
            <span className={`checkpoint282-footer-indicator ${waitingRow ? 'is-warning' : running ? 'is-running' : resolvedCount === rows.length && rows.length > 0 ? 'is-ok' : ''}`} />
            <div>
              <strong>{waitingRow ? `Chờ thao tác trên ${waitingRow.uid}` : running ? 'Đang xử lý account…' : started ? 'Lượt CP282 đã dừng/kết thúc' : 'Sẵn sàng bắt đầu'}</strong>
              <span>{resolvedCount}/{rows.length} account đã xác minh</span>
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
