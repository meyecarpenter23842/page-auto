import { useEffect, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type { ExecutionLogFilters, ExecutionLogRecord } from '../../../shared/executionLogs'
import type { PageTabSummary } from '../../../shared/pageTabs'
import './executionLogs.css'

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
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const filters: ExecutionLogFilters = { limit: 400 }
      if (pageTabId) filters.pageTabId = Number(pageTabId)
      if (accountId) filters.accountId = Number(accountId)
      if (groupUid.trim()) filters.groupUid = groupUid.trim()
      if (result !== 'all') filters.result = result
      setLogs(await window.pageAuto.listExecutionLogs(filters))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void Promise.all([
      window.pageAuto.listPageTabs(),
      window.pageAuto.listAccounts()
    ]).then(([pageTabs, accountRows]) => {
      setTabs(pageTabs)
      setAccounts(accountRows)
    })
    void load()
    // Initial load intentionally uses the empty filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retry = async (log: ExecutionLogRecord): Promise<void> => {
    if (log.runItemId === null) return
    setNotice(null)
    setError(null)
    try {
      const response = await window.pageAuto.retryExecutionLogItem({ runItemId: log.runItemId })
      setNotice(response.message)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <section className="execution-logs-shell">
      <div className="execution-logs-toolbar">
        <select value={pageTabId} onChange={(event) => setPageTabId(event.target.value)} aria-label="Lọc Page Tab">
          <option value="">Tất cả Page Tab</option>
          {tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name} · {tab.pageUid}</option>)}
        </select>
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="Lọc account">
          <option value="">Tất cả account</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.uid}{account.name ? ` · ${account.name}` : ''}</option>)}
        </select>
        <input value={groupUid} onChange={(event) => setGroupUid(event.target.value)} placeholder="Group UID" />
        <select value={result} onChange={(event) => setResult(event.target.value)} aria-label="Lọc kết quả">
          <option value="all">Tất cả kết quả</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="needs_login">Needs login</option>
          <option value="skipped">Skipped</option>
          <option value="pending">Pending retry</option>
        </select>
        <button type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Đang tải…' : 'Làm mới'}</button>
      </div>

      {notice ? <div className="execution-log-notice">{notice}</div> : null}
      {error ? <div className="execution-log-error">{error}</div> : null}

      <div className="execution-log-summary">
        <strong>{logs.length}</strong>
        <span>log gần nhất · retry tự động chỉ áp dụng lỗi transient tối đa 3 attempt; publish chưa xác nhận luôn cần review.</span>
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
            {logs.length === 0 ? (
              <tr><td colSpan={8} className="execution-log-empty">Chưa có execution log phù hợp.</td></tr>
            ) : logs.map((log) => (
              <tr key={log.id}>
                <td className="log-time">{formatTime(log.timestamp)}</td>
                <td><strong>#{log.runId ?? '—'}</strong><span>item #{log.runItemId ?? '—'} · attempt {log.attemptCount}</span></td>
                <td><strong>{log.pageUid ?? '—'}</strong><span>tab #{log.pageTabId ?? '—'} · acc #{log.accountId ?? '—'}</span></td>
                <td className="log-mono">{log.groupUid ?? '—'}</td>
                <td>{log.action}</td>
                <td><span className={`execution-result result-${log.result}`}>{log.result}</span><small>{log.retryDisposition}</small></td>
                <td className="log-details">
                  {log.errorCode ? <strong>{log.errorCode}</strong> : null}
                  {log.errorMessage ? <span title={log.errorMessage}>{log.errorMessage}</span> : null}
                  {log.publishedUrl ? <span title={log.publishedUrl}>Post: {log.publishedUrl}</span> : null}
                  {log.screenshotPath ? <span title={log.screenshotPath}>Screenshot: {basename(log.screenshotPath)}</span> : null}
                  {log.imagePaths.length ? <span title={log.imagePaths.join('\n')}>{log.imagePaths.length} ảnh · content #{log.contentIndex ?? '—'}</span> : null}
                </td>
                <td>
                  <button
                    className="retry-button"
                    type="button"
                    disabled={log.retryDisposition !== 'retryable' || log.runItemId === null}
                    onClick={() => void retry(log)}
                  >
                    Queue retry
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
