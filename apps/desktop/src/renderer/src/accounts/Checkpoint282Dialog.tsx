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

export function Checkpoint282Dialog({ accounts, onClose }: Checkpoint282DialogProps) {
  const [surface, setSurface] = useState<FacebookCheckpointSurface>('mbasic')
  const [evidenceFolder, setEvidenceFolder] = useState('')
  const [rows, setRows] = useState<Checkpoint282Row[]>(() => initialRows(accounts))
  const [running, setRunning] = useState(false)
  const [started, setStarted] = useState(false)

  const resolvedCount = useMemo(() => rows.filter((row) => row.state === 'resolved').length, [rows])
  const waitingRow = rows.find((row) => row.state === 'waiting_manual') ?? null

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
    if (running) return
    setStarted(true)
    setRunning(true)
    try {
      for (let index = startIndex; index < rows.length; index += 1) {
        const row = rows[index]
        if (!row) continue
        const action = index === startIndex ? firstAction : 'start'
        updateRow(index, {
          state: 'running',
          message: action === 'recheck' ? 'Đang kiểm tra lại session và UID…' : 'Đang mở session và kiểm tra CP282…',
          evidencePath: null
        })
        const result = await invoke(row, action)
        updateRow(index, {
          state: result.state,
          message: result.message,
          evidencePath: result.evidencePath ?? null
        })
        if (shouldPauseCheckpoint282Sequence(result.state)) break
      }
    } finally {
      setRunning(false)
    }
  }

  const pickEvidenceFolder = async () => {
    const picked = await window.pageAuto.pickFacebookCheckpointEvidenceFolder()
    if (picked) setEvidenceFolder(picked)
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!running) onClose() }}>
      <div className="modal checkpoint282-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Facebook Common</p>
            <h2>Checkpoint 282</h2>
          </div>
          <button className="icon-button" type="button" disabled={running} onClick={onClose}>×</button>
        </div>

        <div className="checkpoint282-note">
          Luồng này chỉ mở/giữ đúng browser account, nhận diện CP282 và kiểm tra lại session + c_user sau khi anh hoàn tất bước xác minh trên Facebook. Không tự vượt xác minh danh tính hoặc security review.
        </div>

        <div className="checkpoint282-settings">
          <label>
            <span>Giao diện Facebook</span>
            <select value={surface} disabled={started} onChange={(event) => setSurface(event.target.value as FacebookCheckpointSurface)}>
              <option value="mbasic">{surfaceLabels.mbasic} — khuyên dùng</option>
              <option value="mobile">{surfaceLabels.mobile}</option>
              <option value="desktop">{surfaceLabels.desktop}</option>
            </select>
          </label>
          <label className="checkpoint282-folder-field">
            <span>Thư mục lưu ảnh thành công (tùy chọn)</span>
            <div className="checkpoint282-folder-row">
              <input value={evidenceFolder} disabled={started} onChange={(event) => setEvidenceFolder(event.target.value)} placeholder="Không lưu nếu để trống" />
              <button className="button secondary" type="button" disabled={started} onClick={() => void pickEvidenceFolder()}>Chọn…</button>
            </div>
          </label>
        </div>

        <div className="checkpoint282-summary">
          <span>{accounts.length} tài khoản</span>
          <span>{resolvedCount} đã xác minh</span>
          {waitingRow ? <strong>Đang chờ thao tác: {waitingRow.uid}</strong> : null}
        </div>

        <div className="checkpoint282-table-wrap">
          <table className="checkpoint282-table">
            <thead>
              <tr><th>#</th><th>UID</th><th>Trạng thái</th><th>Chi tiết</th><th>Thao tác</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.accountId}>
                  <td>{index + 1}</td>
                  <td className="checkpoint282-uid">{row.uid}</td>
                  <td><span className={`checkpoint282-state state-${row.state}`}>{checkpoint282StateLabel(row.state)}</span></td>
                  <td>
                    <div className="checkpoint282-message" title={row.message}>{row.message}</div>
                    {row.evidencePath ? <div className="checkpoint282-evidence" title={row.evidencePath}>Ảnh: {row.evidencePath}</div> : null}
                  </td>
                  <td>
                    {canRecheckCheckpoint282(row.state) ? (
                      <button className="button secondary compact" type="button" disabled={running} onClick={() => void runSequence(index, 'recheck')}>Kiểm tra lại</button>
                    ) : <span className="checkpoint282-no-action">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="checkpoint282-footer-note">
          Khi gặp “Chờ thao tác”, batch dừng tại tài khoản đó và browser được giữ mở. Hoàn tất bước Facebook yêu cầu rồi bấm “Kiểm tra lại”; chỉ khi session và UID hợp lệ mới chạy tài khoản tiếp theo.
        </div>

        <div className="modal-actions">
          <button className="button secondary" type="button" disabled={running} onClick={onClose}>Đóng</button>
          <button className="button primary" type="button" disabled={running || started || rows.length === 0} onClick={() => void runSequence(0, 'start')}>
            {running ? 'Đang chạy…' : started ? 'Đã bắt đầu' : 'Bắt đầu CP282'}
          </button>
        </div>
      </div>
    </div>
  )
}
