import { useEffect, useMemo, useRef, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type { ExecutionLogFilters, ExecutionLogRecord } from '../../../shared/executionLogs'
import type { PageTabSummary } from '../../../shared/pageTabs'
import './executionLogs.css'
import './executionLogsBatch7.css'
import { filterLogsByAction, formatLogEvidence, parseLogDateRange, sanitizedLogError } from './logPresentation'

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export function ExecutionLogs() {
  const [logs, setLogs] = useState<ExecutionLogRecord[]>([])
  const [tabs, setTabs] = useState<PageTabSummary[]>([])
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [pageTabId, setPageTabId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [groupUid, setGroupUid] = useState('')
  const [result, setResult] = useState('all')
  const [action, setAction] = useState('')
  const [fromTime, setFromTime] = useState('')
  const [toTime, setToTime] = useState('')
  const [detailId, setDetailId] = useState<number | null>(null)
  const [retryingId, setRetryingId] = useState<number | null>(null)
  const sequence = useRef(0)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const visibleLogs = useMemo(() => filterLogsByAction(logs, action), [logs, action])
  const detail = logs.find((log) => log.id === detailId) ?? null

  const load = async (): Promise<void> => {
    const range = parseLogDateRange(fromTime, toTime)
    if (range.error) { setError(range.error); return }
    const requestId = ++sequence.current
    setLoading(true)
    setError(null)
    try {
      const filters: ExecutionLogFilters = { limit: 400, ...range }
      if (pageTabId) filters.pageTabId = Number(pageTabId)
      if (accountId) filters.accountId = Number(accountId)
      if (groupUid.trim()) filters.groupUid = groupUid.trim()
      if (result !== 'all') filters.result = result
      const next = await window.pageAuto.listExecutionLogs(filters)
      if (requestId === sequence.current) setLogs(next)
    } catch (cause) {
      if (requestId === sequence.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (requestId === sequence.current) setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true
    void Promise.all([
      window.pageAuto.listPageTabs(),
      window.pageAuto.listAccounts()
    ]).then(([pageTabs, accountRows]) => {
      if (mounted) { setTabs(pageTabs); setAccounts(accountRows) }
    }).catch((cause) => { if (mounted) setError(cause instanceof Error ? cause.message : String(cause)) })
    void load()
    return () => { mounted = false; sequence.current += 1 }
    // Initial load intentionally uses the empty filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retry = async (log: ExecutionLogRecord): Promise<void> => {
    if (log.runItemId === null || retryingId !== null) return
    setRetryingId(log.id)
    setNotice(null)
    setError(null)
    try {
      const response = await window.pageAuto.retryExecutionLogItem({ runItemId: log.runItemId })
      setNotice(response.message)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setRetryingId(null) }
  }

  const copyError = async (log: ExecutionLogRecord): Promise<void> => {
    try {
      await navigator.clipboard.writeText(sanitizedLogError(log.errorCode, log.errorMessage))
      setNotice('Đã sao chép lỗi sau khi che thông tin nhạy cảm.')
    } catch { setError('Không thể sao chép lỗi tự động trên máy này.') }
  }
  const resetFilters = () => {
    setPageTabId(''); setAccountId(''); setGroupUid(''); setResult('all'); setAction(''); setFromTime(''); setToTime('')
    setNotice('Đã xóa các lựa chọn lọc. Bấm Áp dụng lọc để tải lại.')
  }

  return (
    <section className="execution-logs-shell" aria-label="Nhật ký thực thi">
      <div className="execution-logs-toolbar">
        <select value={pageTabId} onChange={(event) => setPageTabId(event.target.value)} aria-label="Lọc Page Tab">
          <option value="">Tất cả Page Tab</option>
          {tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name} · {tab.pageUid}</option>)}
        </select>
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="Lọc account">
          <option value="">Tất cả account</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.uid}{account.name ? ` · ${account.name}` : ''}</option>)}
        </select>
        <input value={groupUid} onChange={(event) => setGroupUid(event.target.value)} placeholder="Group UID" aria-label="Lọc Group UID" />
        <input className="log-action-filter" value={action} onChange={(event) => setAction(event.target.value)} placeholder="Tìm action..." aria-label="Tìm action trong kết quả đã tải" />
        <select value={result} onChange={(event) => setResult(event.target.value)} aria-label="Lọc kết quả">
          <option value="all">Tất cả kết quả</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="needs_login">Needs login</option>
          <option value="skipped">Skipped</option>
          <option value="pending">Pending retry</option>
        </select>
        <label className="log-time-filter">Từ <input type="datetime-local" aria-label="Thời gian bắt đầu" value={fromTime} onChange={(event) => setFromTime(event.target.value)} /></label>
        <label className="log-time-filter">Đến <input type="datetime-local" aria-label="Thời gian kết thúc" value={toTime} onChange={(event) => setToTime(event.target.value)} /></label>
        <button type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Đang tải…' : 'Áp dụng lọc'}</button>
        <button type="button" onClick={resetFilters} disabled={loading}>Xóa lọc</button>
      </div>

      {notice ? <div className="execution-log-notice">{notice}</div> : null}
      {error ? <div className="execution-log-error" role="alert">{error} <button type="button" onClick={() => void load()}>Thử lại</button></div> : null}

      <div className="execution-log-summary">
        <strong className="log-summary-total">{visibleLogs.length}/{logs.length}</strong>
        <span aria-live="polite">{loading ? 'Đang tải…' : 'log đang hiển thị, tối đa 400 bản ghi do Main trả về.'} Action lọc trong kết quả đã tải; retry không đổi policy.</span>
      </div>

      <div className="execution-log-table-wrap">
        <table className="execution-log-table">
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Run / Item</th>
              <th>Page / Account</th>
              <th>Group</th>
              <th>Action</th>
              <th>Kết quả</th>
              <th>Lỗi / Evidence</th>
              <th>Retry</th>
            </tr>
          </thead>
          <tbody>
            {visibleLogs.length === 0 ? (
              <tr><td colSpan={8} className="execution-log-empty">{loading ? 'Đang tải nhật ký…' : error ? 'Không tải được nhật ký. Bấm Thử lại.' : 'Chưa có execution log phù hợp bộ lọc.'}</td></tr>
            ) : visibleLogs.map((log) => (
              <tr key={log.id}>
                <td className="log-time">{formatTime(log.timestamp)}</td>
                <td><strong>#{log.runId ?? '—'}</strong><span>item #{log.runItemId ?? '—'} · attempt {log.attemptCount}</span></td>
                <td><strong>{log.pageUid ?? '—'}</strong><span>tab #{log.pageTabId ?? '—'} · acc #{log.accountId ?? '—'}</span></td>
                <td className="log-mono">{log.groupUid ?? '—'}</td>
                <td>{log.action}</td>
                <td><span className={`execution-result result-${log.result}`}>{log.result}</span><small>{log.retryDisposition}</small></td>
                <td className="log-details">
                  {log.errorCode ? <strong>{log.errorCode}</strong> : null}
                  {log.errorMessage ? <span title="Mở chi tiết để xem lỗi an toàn">{sanitizedLogError(null, log.errorMessage)}</span> : null}
                  {log.publishedUrl ? <span>Post: có URL</span> : null}
                  {log.screenshotPath ? <span title={log.screenshotPath}>Screenshot: {basename(log.screenshotPath)}</span> : null}
                  {log.imagePaths.length ? <span title={log.imagePaths.join('\n')}>{log.imagePaths.length} ảnh · content #{log.contentIndex ?? '—'}</span> : null}
                </td>
                <td>
                  <button className="execution-log-detail-button" type="button" onClick={() => setDetailId(log.id)}>Chi tiết</button>{' '}
                  <button
                    className="retry-button"
                    type="button"
                    disabled={retryingId !== null || log.retryDisposition !== 'retryable' || log.runItemId === null}
                    onClick={() => void retry(log)}
                  >
                    {retryingId === log.id ? 'Đang gửi…' : 'Queue retry'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail ? <div className="execution-log-modal-backdrop" role="presentation"
        onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailId(null) }}>
        <section className="execution-log-modal" role="dialog" aria-modal="true" aria-label="Chi tiết execution log"
          onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setDetailId(null) } }}>
          <header className="execution-log-modal-head">
            <div><h2>Execution log #{detail.id}</h2><small>{formatTime(detail.timestamp)} · {detail.action} · {detail.result}</small></div>
            <button type="button" autoFocus aria-label="Đóng chi tiết" onClick={() => setDetailId(null)}>Đóng</button>
          </header>
          <dl>
            <dt>Page / Account</dt><dd>#{detail.pageTabId ?? '—'} / #{detail.accountId ?? '—'}</dd>
            <dt>Run / Item</dt><dd>#{detail.runId ?? '—'} / #{detail.runItemId ?? '—'}</dd>
            <dt>Group UID</dt><dd>{detail.groupUid ?? '—'}</dd>
            <dt>Retry</dt><dd>{detail.retryDisposition} · attempt {detail.attemptCount}</dd>
          </dl>
          <div><strong>Lỗi đã che thông tin nhạy cảm</strong><pre>{sanitizedLogError(detail.errorCode, detail.errorMessage)}</pre></div>
          <div><strong>Evidence đã ghi nhận</strong>
            {formatLogEvidence(detail).length ? <dl>{formatLogEvidence(detail).map((item) =>
              <FragmentEvidence key={item.label} label={item.label} value={item.value} />
            )}</dl> : <p className="execution-log-modal-empty">Chưa có screenshot, ảnh hoặc URL được ghi nhận.</p>}
            <small className="execution-log-filter-tip">Chỉ hiển thị metadata đã lưu. Chưa có chức năng mở screenshot trong giao diện này.</small>
          </div>
          <footer className="execution-log-modal-actions">
            <button type="button" onClick={() => void copyError(detail)}>Copy lỗi đã ẩn dữ liệu</button>
            <button type="button" disabled={retryingId !== null || detail.retryDisposition !== 'retryable' || detail.runItemId === null}
              onClick={() => void retry(detail)}>Queue retry</button>
          </footer>
        </section>
      </div> : null}
    </section>
  )
}
function FragmentEvidence({ label, value }: { label: string; value: string }) {
  return <><dt>{label}</dt><dd>{value}</dd></>
}
