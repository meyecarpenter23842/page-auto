import { useEffect, useMemo, useState } from 'react'
import { CANONICAL_CONTENT_LIBRARY_SET_ID, type ContentLibraryItem } from '../../../shared/contentLibrary'
import type { ZaloAccountView, ZaloBatchRunSnapshot, ZaloBatchStartPayload } from '../../../shared/zalo'

function terminal(state: ZaloBatchRunSnapshot['state']): boolean {
  return state === 'completed' || state === 'stopped' || state === 'failed'
}

export function ZaloBatchPanel() {
  const [accounts, setAccounts] = useState<ZaloAccountView[]>([])
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
    void Promise.all([
      window.pageAutoZalo.listAccounts(),
      window.pageAuto.getContentLibrary({ id: CANONICAL_CONTENT_LIBRARY_SET_ID })
    ]).then(([nextAccounts, library]) => {
      setAccounts(nextAccounts)
      const ready = nextAccounts.filter((account) => account.sessionStatus === 'ready').map((account) => account.id)
      setSelectedAccountIds(ready.length ? ready : nextAccounts.slice(0, 1).map((account) => account.id))
      const items = library?.items.filter((item) => item.enabled) ?? []
      setContentItems(items)
      setSelectedContentIds(items.slice(0, 1).map((item) => item.id))
    }).catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
  }, [])

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
  const selectedContents = useMemo(
    () => contentItems.filter((item) => selectedContentIds.includes(item.id)),
    [contentItems, selectedContentIds]
  )

  const toggleAccount = (id: number) => {
    if (running) return
    setSelectedAccountIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  const toggleContent = (id: number) => {
    if (running) return
    setSelectedContentIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  const start = async () => {
    try {
      const payload: ZaloBatchStartPayload = {
        accountIds: selectedAccountIds,
        targets: targetsText.split(/\r?\n|[,;]/).map((value) => value.trim()).filter(Boolean),
        actions: { sendMessage, sendAttachment, addFriend },
        contentItems: selectedContents.map((item) => ({ sourceItemId: item.id, name: item.name, variants: [...item.variants] })),
        contentMode,
        attachmentPaths: attachmentPaths.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
        friendMessage: friendMessage || null,
        concurrency,
        delayMinMs: Math.max(0, delayMinSeconds * 1000),
        delayMaxMs: Math.max(0, delayMaxSeconds * 1000),
        failurePolicy
      }
      const next = await window.pageAutoZalo.startBatch(payload)
      setRun(next)
      setNotice(`Đã mở batch ${next.totalTargets} target với ${next.accountIds.length} tài khoản.`)
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
      <div className="zalo-pane-title">
        <div>
          <h2>Batch 4 · Gửi hàng loạt / Kết bạn</h2>
          <p>Nhiều target + nhiều account; mỗi account chạy tuần tự, các account chạy rolling theo concurrency.</p>
        </div>
        {run ? <span className="zalo-running-chip">{run.state} · {run.completedTargets}/{run.totalTargets}</span> : null}
      </div>

      {notice ? <div className="notice-card zalo-notice">{notice}</div> : null}

      <div className="zalo-batch-grid">
        <div className="zalo-batch-section">
          <strong>Tài khoản chạy</strong>
          <div className="zalo-batch-account-list">
            {accounts.map((account) => (
              <label key={account.id} className="zalo-check-row">
                <input type="checkbox" checked={selectedAccountIds.includes(account.id)} disabled={running} onChange={() => toggleAccount(account.id)} />
                <span>{account.phone}{account.displayName ? ` · ${account.displayName}` : ''}</span>
                <small>{account.sessionStatus}</small>
              </label>
            ))}
          </div>
        </div>

        <label className="zalo-batch-section">Danh sách SĐT target
          <textarea value={targetsText} disabled={running} onChange={(event) => setTargetsText(event.target.value)} placeholder={'0912345678\n0987654321\n...'} />
        </label>

        <div className="zalo-batch-section">
          <strong>Action</strong>
          <label className="zalo-check-row"><input type="checkbox" checked={sendMessage} disabled={running} onChange={(event) => setSendMessage(event.target.checked)} /> Gửi tin</label>
          <label className="zalo-check-row"><input type="checkbox" checked={sendAttachment} disabled={running} onChange={(event) => setSendAttachment(event.target.checked)} /> Gửi ảnh/file</label>
          <label className="zalo-check-row"><input type="checkbox" checked={addFriend} disabled={running} onChange={(event) => setAddFriend(event.target.checked)} /> Kết bạn</label>
        </div>

        <div className="zalo-batch-section zalo-batch-content-list">
          <strong>Bài viết canonical</strong>
          <div className="zalo-batch-scroll">
            {contentItems.map((item) => (
              <label key={item.id} className="zalo-check-row">
                <input type="checkbox" checked={selectedContentIds.includes(item.id)} disabled={running || !sendMessage} onChange={() => toggleContent(item.id)} />
                <span>{item.name}</span><small>{item.variants.length} biến thể</small>
              </label>
            ))}
            {!contentItems.length ? <small>Kho bài viết chưa có bài.</small> : null}
          </div>
        </div>

        <label className="zalo-batch-section">Ảnh/file cố định — mỗi dòng một path tuyệt đối
          <textarea value={attachmentPaths} disabled={running || !sendAttachment} onChange={(event) => setAttachmentPaths(event.target.value)} placeholder={'F:\\media\\anh-1.jpg\nF:\\media\\file.pdf'} />
        </label>

        <label className="zalo-batch-section">Lời nhắn kết bạn
          <textarea value={friendMessage} disabled={running || !addFriend} onChange={(event) => setFriendMessage(event.target.value)} placeholder="Có thể để trống" />
        </label>
      </div>

      <div className="zalo-batch-options">
        <label>Chọn bài<select value={contentMode} disabled={running} onChange={(event) => setContentMode(event.target.value as 'sequential' | 'random')}><option value="sequential">Tuần tự</option><option value="random">Random</option></select></label>
        <label>Concurrency<input type="number" min={1} max={Math.max(1, selectedAccountIds.length)} value={concurrency} disabled={running} onChange={(event) => setConcurrency(Math.max(1, Number(event.target.value) || 1))} /></label>
        <label>Delay min (giây)<input type="number" min={0} value={delayMinSeconds} disabled={running} onChange={(event) => setDelayMinSeconds(Math.max(0, Number(event.target.value) || 0))} /></label>
        <label>Delay max (giây)<input type="number" min={0} value={delayMaxSeconds} disabled={running} onChange={(event) => setDelayMaxSeconds(Math.max(0, Number(event.target.value) || 0))} /></label>
        <label>Khi lỗi<select value={failurePolicy} disabled={running} onChange={(event) => setFailurePolicy(event.target.value as 'continue' | 'stop_run')}><option value="continue">Bỏ qua, chạy tiếp</option><option value="stop_run">Dừng batch</option></select></label>
      </div>

      <div className="zalo-run-actions">
        <button className="button primary" type="button" disabled={running} onClick={() => void start()}>Start batch</button>
        {run && !terminal(run.state) ? (
          <>
            <button className="button secondary" type="button" disabled={run.state === 'paused'} onClick={() => void control('pause')}>Pause</button>
            <button className="button secondary" type="button" disabled={run.state !== 'paused'} onClick={() => void control('resume')}>Resume</button>
            <button className="button secondary" type="button" onClick={() => void control('stop')}>Stop</button>
          </>
        ) : null}
      </div>

      {run ? (
        <div className="zalo-result-area">
          <h3>Progress từng target</h3>
          <div className="table-wrap zalo-batch-progress-wrap">
            <table className="data-table">
              <thead><tr><th>#</th><th>Target</th><th>Account</th><th>Trạng thái</th><th>Kết quả</th></tr></thead>
              <tbody>
                {run.progress.map((item) => (
                  <tr key={`${run.runId}-${item.index}`}>
                    <td>{item.index + 1}</td><td>{item.targetPhone}</td><td>{item.assignedAccountId ?? '—'}</td><td>{item.state}</td>
                    <td>{item.message}{item.results.length ? ` · ${item.results.map((result) => `${result.action}:${result.code}`).join(', ')}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
