import { useEffect, useMemo, useState } from 'react'
import { CANONICAL_CONTENT_LIBRARY_SET_ID, type ContentLibraryItem } from '../../../shared/contentLibrary'
import type { ZaloAccountView, ZaloBatchRunSnapshot, ZaloBatchStartPayload } from '../../../shared/zalo'
import './zaloBatchPanel.css'

function terminal(state: ZaloBatchRunSnapshot['state']): boolean {
  return state === 'completed' || state === 'stopped' || state === 'failed'
}

function statusLabel(status: ZaloAccountView['sessionStatus']): string {
  const labels: Record<ZaloAccountView['sessionStatus'], string> = {
    unknown: 'Chưa kiểm tra',
    ready: 'Sẵn sàng',
    login_required: 'Cần đăng nhập',
    qr_waiting: 'Chờ QR',
    needs_attention: 'Cần kiểm tra',
    browser_error: 'Lỗi Chrome',
    profile_error: 'Lỗi profile'
  }
  return labels[status]
}

function targetList(value: string): string[] {
  return [...new Set(value.split(/\r?\n|[,;]/).map((item) => item.trim()).filter(Boolean))]
}

function truncate(value: string, max = 220): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max)}…` : compact
}

export interface ZaloBatchPanelProps {
  accounts: ZaloAccountView[]
}

export function ZaloBatchPanel({ accounts }: ZaloBatchPanelProps) {
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([])
  const [targetsText, setTargetsText] = useState('')
  const [contentItems, setContentItems] = useState<ContentLibraryItem[]>([])
  const [selectedContentIds, setSelectedContentIds] = useState<number[]>([])
  const [sendMessage, setSendMessage] = useState(true)
  const [sendAttachment, setSendAttachment] = useState(false)
  const [addFriend, setAddFriend] = useState(false)
  const [attachmentPaths, setAttachmentPaths] = useState('')
  const [friendMessage, setFriendMessage] = useState('')
  const [contentMode, setContentMode] = useState<'sequential' | 'random'>('sequential')
  const [failurePolicy, setFailurePolicy] = useState<'continue' | 'stop_run'>('continue')
  const [concurrency, setConcurrency] = useState(1)
  const [delayMinSeconds, setDelayMinSeconds] = useState(3)
  const [delayMaxSeconds, setDelayMaxSeconds] = useState(8)
  const [run, setRun] = useState<ZaloBatchRunSnapshot | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    void window.pageAuto.getContentLibrary({ id: CANONICAL_CONTENT_LIBRARY_SET_ID }).then((library) => {
      const items = library?.items.filter((item) => item.enabled) ?? []
      setContentItems(items)
      setSelectedContentIds((current) => current.length ? current.filter((id) => items.some((item) => item.id === id)) : items.slice(0, 1).map((item) => item.id))
    }).catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
  }, [])

  useEffect(() => {
    setSelectedAccountIds((current) => {
      const valid = current.filter((id) => accounts.some((account) => account.id === id))
      if (valid.length) return valid
      const ready = accounts.filter((account) => account.sessionStatus === 'ready').map((account) => account.id)
      return ready.length ? ready : []
    })
  }, [accounts])

  useEffect(() => {
    if (!run || terminal(run.state)) return
    const timer = window.setInterval(() => {
      void window.pageAutoZalo.getBatchStatus(run.runId).then((next) => {
        if (next) setRun(next)
      }).catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
    }, 700)
    return () => window.clearInterval(timer)
  }, [run?.runId, run?.state])

  const running = Boolean(run && !terminal(run.state))
  const targets = useMemo(() => targetList(targetsText), [targetsText])
  const selectedAccounts = useMemo(() => accounts.filter((account) => selectedAccountIds.includes(account.id)), [accounts, selectedAccountIds])
  const runnableAccounts = useMemo(() => selectedAccounts.filter((account) => account.sessionStatus === 'ready'), [selectedAccounts])
  const blockedAccounts = selectedAccounts.length - runnableAccounts.length
  const selectedContents = useMemo(() => contentItems.filter((item) => selectedContentIds.includes(item.id)), [contentItems, selectedContentIds])
  const variantCount = selectedContents.reduce((sum, item) => sum + item.variants.length, 0)
  const selectedPreview = selectedContents[0]?.variants[0] ?? ''
  const actionNames = [sendMessage ? 'Gửi tin' : '', sendAttachment ? 'Ảnh/file' : '', addFriend ? 'Kết bạn' : ''].filter(Boolean)
  const safeConcurrency = Math.min(Math.max(1, concurrency), Math.max(1, runnableAccounts.length))
  const summary = `${runnableAccounts.length}/${selectedAccounts.length} account sẵn sàng · concurrency ${safeConcurrency} · ${targets.length} target · ${selectedContents.length} bài ${contentMode === 'random' ? 'Random' : 'Tuần tự'} · delay ${delayMinSeconds}-${delayMaxSeconds}s · ${actionNames.join(' + ') || 'chưa chọn action'}`
  const currentProgress = run?.progress.find((item) => item.state === 'running') ?? [...(run?.progress ?? [])].reverse().find((item) => item.state !== 'pending') ?? null
  const currentAccount = currentProgress?.assignedAccountId == null ? null : accounts.find((account) => account.id === currentProgress.assignedAccountId) ?? null

  const toggleAccount = (id: number) => {
    if (running) return
    setSelectedAccountIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  const toggleContent = (id: number) => {
    if (running) return
    setSelectedContentIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  const accountActivity = (id: number): string => {
    if (run?.progress.some((item) => item.assignedAccountId === id && item.state === 'running')) return 'Đang chạy'
    const completed = run?.progress.filter((item) => item.assignedAccountId === id && !['pending', 'running'].includes(item.state)).length ?? 0
    return completed > 0 ? `Đã xử lý ${completed}` : 'Chưa chạy'
  }

  const start = async () => {
    if (!runnableAccounts.length) {
      setNotice('Không có tài khoản Sẵn sàng. Mở/đăng nhập tài khoản ở phần Quản lý tài khoản trước khi Start.')
      return
    }
    if (blockedAccounts > 0) setNotice(`Bỏ qua ${blockedAccounts} tài khoản chưa sẵn sàng; batch chỉ dùng ${runnableAccounts.length} tài khoản Sẵn sàng.`)
    try {
      const payload: ZaloBatchStartPayload = {
        accountIds: runnableAccounts.map((account) => account.id),
        targets,
        actions: { sendMessage, sendAttachment, addFriend },
        contentItems: selectedContents.map((item) => ({ sourceItemId: item.id, name: item.name, variants: [...item.variants] })),
        contentMode,
        attachmentPaths: attachmentPaths.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
        friendMessage: friendMessage || null,
        concurrency: safeConcurrency,
        delayMinMs: Math.max(0, delayMinSeconds * 1000),
        delayMaxMs: Math.max(0, delayMaxSeconds * 1000),
        failurePolicy
      }
      const next = await window.pageAutoZalo.startBatch(payload)
      setRun(next)
      setNotice(`Đã Start ${next.totalTargets} target với ${next.accountIds.length} tài khoản sẵn sàng.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  const control = async (operation: 'pause' | 'resume' | 'stop') => {
    if (!run) return
    try {
      const next = operation === 'pause'
        ? await window.pageAutoZalo.pauseBatch(run.runId)
        : operation === 'resume'
          ? await window.pageAutoZalo.resumeBatch(run.runId)
          : await window.pageAutoZalo.stopBatch(run.runId)
      if (next) setRun(next)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="panel zalo-batch-panel">
      <div className="zalo-batch-commandbar">
        <div className="zalo-run-summary">
          <span>Tóm tắt lượt chạy</span>
          <strong>{summary}</strong>
          {blockedAccounts > 0 ? <small>{blockedAccounts} tài khoản đã chọn nhưng chưa sẵn sàng sẽ không được cấp target.</small> : <small>Session được kiểm trước khi Start; batch chỉ snapshot các tài khoản Sẵn sàng.</small>}
        </div>
        <div className="zalo-run-actions zalo-run-actions-top">
          <button className="button primary" type="button" disabled={running} onClick={() => void start()}>Start</button>
          <button className="button secondary" type="button" disabled={!run || terminal(run.state) || run.state === 'paused'} onClick={() => void control('pause')}>Pause</button>
          <button className="button secondary" type="button" disabled={!run || terminal(run.state) || run.state !== 'paused'} onClick={() => void control('resume')}>Resume</button>
          <button className="button secondary" type="button" disabled={!run || terminal(run.state)} onClick={() => void control('stop')}>Stop</button>
        </div>
      </div>

      {notice ? <div className="notice-card zalo-notice">{notice}</div> : null}

      <div className="zalo-automation-grid">
        <div className="zalo-automation-left">
          <section className="zalo-batch-card">
            <div className="zalo-batch-card-heading">
              <div><span>Tài khoản</span><strong>Danh sách chạy</strong></div>
              <small>{runnableAccounts.length}/{selectedAccounts.length} sẵn sàng · {accounts.length} tổng</small>
            </div>
            <div className="table-wrap zalo-batch-account-table-wrap">
              <table className="data-table zalo-batch-account-table">
                <thead><tr><th>Bật</th><th>SĐT</th><th>Tên</th><th>Session</th><th>Hoạt động</th></tr></thead>
                <tbody>
                  {accounts.map((account) => {
                    const checked = selectedAccountIds.includes(account.id)
                    return (
                      <tr key={account.id} className={account.sessionStatus !== 'ready' ? 'zalo-account-not-ready' : ''}>
                        <td><input type="checkbox" checked={checked} disabled={running} onChange={() => toggleAccount(account.id)} /></td>
                        <td><strong>{account.phone}</strong></td>
                        <td>{account.displayName || '—'}</td>
                        <td><span className={`zalo-status zalo-status-${account.sessionStatus}`}>{statusLabel(account.sessionStatus)}</span></td>
                        <td>{accountActivity(account.id)}</td>
                      </tr>
                    )
                  })}
                  {!accounts.length ? <tr><td colSpan={5}>Chưa có tài khoản Zalo.</td></tr> : null}
                </tbody>
              </table>
            </div>
            <div className="zalo-batch-options zalo-batch-options-compact">
              <label>TK song song<input type="number" min={1} max={Math.max(1, runnableAccounts.length)} value={concurrency} disabled={running} onChange={(event) => setConcurrency(Math.max(1, Number(event.target.value) || 1))} /></label>
              <label>Delay min (s)<input type="number" min={0} value={delayMinSeconds} disabled={running} onChange={(event) => setDelayMinSeconds(Math.max(0, Number(event.target.value) || 0))} /></label>
              <label>Delay max (s)<input type="number" min={0} value={delayMaxSeconds} disabled={running} onChange={(event) => setDelayMaxSeconds(Math.max(0, Number(event.target.value) || 0))} /></label>
              <label>Khi lỗi<select value={failurePolicy} disabled={running} onChange={(event) => setFailurePolicy(event.target.value as 'continue' | 'stop_run')}><option value="continue">Chạy tiếp</option><option value="stop_run">Dừng lượt</option></select></label>
            </div>
          </section>
        </div>

        <div className="zalo-automation-right">
          <section className={`zalo-batch-card zalo-runtime-preview runtime-${run?.state ?? 'idle'}`}>
            <div className="zalo-batch-card-heading">
              <div><span>Đang xử lý</span><strong>{run ? `${run.completedTargets}/${run.totalTargets} target · ${run.state}` : 'Chưa chạy'}</strong></div>
              {currentAccount ? <small>{currentAccount.phone}{currentAccount.displayName ? ` · ${currentAccount.displayName}` : ''}</small> : null}
            </div>
            {currentProgress ? (
              <div className="zalo-runtime-body">
                <div className="zalo-runtime-meta"><span>Account <b>{currentAccount?.phone ?? `#${currentProgress.assignedAccountId ?? '—'}`}</b></span><span>Target <b>{currentProgress.targetPhone}</b></span><span>Trạng thái <b>{currentProgress.state}</b></span></div>
                <strong>{currentProgress.message}</strong>
                <p>{currentProgress.results.length ? currentProgress.results.map((result) => `${result.action}: ${result.status}/${result.code}`).join(' · ') : 'Đang chuẩn bị action và xác minh target.'}</p>
              </div>
            ) : (
              <div className="zalo-runtime-empty">
                <strong>{selectedContents.length ? `${selectedContents.length} bài đã chọn · ${variantCount} biến thể` : 'Chưa chọn bài'}</strong>
                <p>{selectedPreview ? truncate(selectedPreview) : 'Chọn target, bài viết và action ở các mục cấu hình bên dưới rồi Start.'}</p>
              </div>
            )}
          </section>

          <section className="zalo-batch-card zalo-config-stack">
            <div className="zalo-batch-card-heading"><div><span>Cấu hình</span><strong>Target · Bài viết · Action</strong></div><small>Mỗi mục chỉnh riêng</small></div>

            <details className="zalo-config-card" open>
              <summary><span>Target</span><strong>{targets.length} SĐT</strong><small>Mỗi dòng một số</small></summary>
              <textarea value={targetsText} disabled={running} onChange={(event) => setTargetsText(event.target.value)} placeholder={'0912345678\n0987654321\n...'} />
            </details>

            <details className="zalo-config-card">
              <summary><span>Bài viết</span><strong>{selectedContents.length}/{contentItems.length} bài · {variantCount} biến thể</strong><small>{contentMode === 'random' ? 'Random' : 'Tuần tự'}</small></summary>
              <div className="zalo-content-mode-row"><label>Chọn bài<select value={contentMode} disabled={running || !sendMessage} onChange={(event) => setContentMode(event.target.value as 'sequential' | 'random')}><option value="sequential">Tuần tự</option><option value="random">Random</option></select></label></div>
              <div className="zalo-batch-scroll">
                {contentItems.map((item) => (
                  <label key={item.id} className="zalo-check-row">
                    <input type="checkbox" checked={selectedContentIds.includes(item.id)} disabled={running || !sendMessage} onChange={() => toggleContent(item.id)} />
                    <span><b>{item.name}</b>{item.variants[0] ? <em>{truncate(item.variants[0], 90)}</em> : null}</span><small>{item.variants.length} biến thể</small>
                  </label>
                ))}
                {!contentItems.length ? <small>Kho bài viết chưa có bài.</small> : null}
              </div>
            </details>

            <details className="zalo-config-card">
              <summary><span>Action</span><strong>{actionNames.join(' + ') || 'Chưa chọn'}</strong><small>Thứ tự theo action runtime</small></summary>
              <div className="zalo-action-config-grid">
                <label className="zalo-check-row"><input type="checkbox" checked={sendMessage} disabled={running} onChange={(event) => setSendMessage(event.target.checked)} /><span>Gửi tin</span></label>
                <label className="zalo-check-row"><input type="checkbox" checked={sendAttachment} disabled={running} onChange={(event) => setSendAttachment(event.target.checked)} /><span>Gửi ảnh/file</span></label>
                <label className="zalo-check-row"><input type="checkbox" checked={addFriend} disabled={running} onChange={(event) => setAddFriend(event.target.checked)} /><span>Kết bạn</span></label>
              </div>
              {sendAttachment ? <label className="zalo-config-field">Ảnh/file bổ sung — mỗi dòng một đường dẫn<textarea value={attachmentPaths} disabled={running} onChange={(event) => setAttachmentPaths(event.target.value)} placeholder={'F:\\media\\anh-1.jpg\nF:\\media\\file.pdf'} /></label> : null}
              {addFriend ? <label className="zalo-config-field">Lời nhắn kết bạn<textarea value={friendMessage} disabled={running} onChange={(event) => setFriendMessage(event.target.value)} placeholder="Có thể để trống" /></label> : null}
            </details>
          </section>
        </div>
      </div>

      {run ? (
        <div className="zalo-result-area zalo-batch-results">
          <div className="zalo-batch-card-heading"><div><span>Runtime</span><strong>Progress từng target</strong></div><small>{run.successTargets} thành công · {run.failedTargets} lỗi</small></div>
          <div className="table-wrap zalo-batch-progress-wrap">
            <table className="data-table">
              <thead><tr><th>#</th><th>Target</th><th>Tài khoản</th><th>Trạng thái</th><th>Kết quả</th></tr></thead>
              <tbody>
                {run.progress.map((item) => {
                  const account = item.assignedAccountId == null ? null : accounts.find((candidate) => candidate.id === item.assignedAccountId) ?? null
                  return (
                    <tr key={`${run.runId}-${item.index}`}>
                      <td>{item.index + 1}</td>
                      <td>{item.targetPhone}</td>
                      <td>{account ? `${account.phone}${account.displayName ? ` · ${account.displayName}` : ''}` : '—'}</td>
                      <td>{item.state}</td>
                      <td>{item.message}{item.results.length ? ` · ${item.results.map((result) => `${result.action}:${result.code}`).join(', ')}` : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
