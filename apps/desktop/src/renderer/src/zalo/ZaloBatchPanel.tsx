import { useEffect, useMemo, useState } from 'react'
import { CANONICAL_CONTENT_LIBRARY_SET_ID, type ContentLibraryItem } from '../../../shared/contentLibrary'
import { normalizeZaloPhone, type ZaloAccountView, type ZaloActionType, type ZaloBatchRunSnapshot, type ZaloBatchStartPayload, type ZaloPostLibrary, type ZaloPostLibraryItem, type ZaloPostMediaConfig } from '../../../shared/zalo'
import './zaloBatchPanel.css'

type ConfigModal = 'targets' | 'actions' | null

const emptyLibrary: ZaloPostLibrary = { mode: 'sequential', posts: [] }

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

function actionLabel(action: ZaloActionType): string {
  if (action === 'send_message') return 'Gửi tin'
  if (action === 'send_attachment') return 'Gửi ảnh/file'
  return 'Kết bạn'
}

function truncate(value: string, max = 260): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > max ? compact.slice(0, max) + '…' : compact
}

function fileName(value: string): string {
  const parts = value.split(/[\\/]/)
  return parts[parts.length - 1] || value
}

function copyPost(post: ZaloPostLibraryItem): ZaloPostLibraryItem {
  return {
    ...post,
    variants: [...post.variants],
    canonicalImage: { ...post.canonicalImage },
    media: { ...post.media }
  }
}

function targetAnalysis(value: string) {
  const seen = new Set<string>()
  const valid: string[] = []
  let duplicates = 0
  let invalid = 0
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    try {
      const phone = normalizeZaloPhone(line)
      if (seen.has(phone)) duplicates += 1
      else { seen.add(phone); valid.push(phone) }
    } catch {
      invalid += 1
    }
  }
  return { valid, duplicates, invalid }
}

function mediaSummary(post: ZaloPostLibraryItem): string {
  if (post.media.source === 'none' || !post.media.folderPath) return 'Không media'
  const source = post.media.source === 'canonical' ? 'Theo bài gốc' : 'Folder riêng'
  const mode = post.media.mode === 'random' ? 'random' : post.media.mode === 'filename_match' ? 'khớp SĐT' : 'tuần tự'
  return source + ' · ' + post.media.imagesPerTarget + ' file/target · ' + mode
}

export interface ZaloBatchPanelProps {
  accounts: ZaloAccountView[]
}

export function ZaloBatchPanel({ accounts }: ZaloBatchPanelProps) {
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([])
  const [targetsText, setTargetsText] = useState('')
  const [postLibrary, setPostLibrary] = useState<ZaloPostLibrary>(emptyLibrary)
  const [postDraft, setPostDraft] = useState<ZaloPostLibrary | null>(null)
  const [postModalOpen, setPostModalOpen] = useState(false)
  const [editingPostId, setEditingPostId] = useState<number | null>(null)
  const [canonicalOpen, setCanonicalOpen] = useState(false)
  const [canonicalItems, setCanonicalItems] = useState<ContentLibraryItem[]>([])
  const [canonicalLoading, setCanonicalLoading] = useState(false)
  const [sendMessage, setSendMessage] = useState(true)
  const [sendAttachment, setSendAttachment] = useState(false)
  const [addFriend, setAddFriend] = useState(false)
  const [friendMessage, setFriendMessage] = useState('')
  const [failurePolicy, setFailurePolicy] = useState<'continue' | 'stop_run'>('continue')
  const [concurrency, setConcurrency] = useState(1)
  const [delayMinSeconds, setDelayMinSeconds] = useState(3)
  const [delayMaxSeconds, setDelayMaxSeconds] = useState(8)
  const [run, setRun] = useState<ZaloBatchRunSnapshot | null>(null)
  const [notice, setNotice] = useState('')
  const [configModal, setConfigModal] = useState<ConfigModal>(null)

  useEffect(() => {
    void window.pageAutoZalo.getPostLibrary()
      .then((library) => setPostLibrary({ mode: library.mode, posts: library.posts.map(copyPost) }))
      .catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
  }, [])

  useEffect(() => {
    setSelectedAccountIds((current) => {
      const valid = current.filter((id) => accounts.some((account) => account.id === id))
      if (valid.length) return valid
      return accounts.filter((account) => account.sessionStatus === 'ready').map((account) => account.id)
    })
  }, [accounts])

  useEffect(() => {
    if (!run || terminal(run.state)) return
    const timer = window.setInterval(() => {
      void window.pageAutoZalo.getBatchStatus(run.runId).then((next) => { if (next) setRun(next) })
        .catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
    }, 700)
    return () => window.clearInterval(timer)
  }, [run?.runId, run?.state])

  const running = Boolean(run && !terminal(run.state))
  const targets = useMemo(() => targetAnalysis(targetsText), [targetsText])
  const selectedAccounts = useMemo(() => accounts.filter((account) => selectedAccountIds.includes(account.id)), [accounts, selectedAccountIds])
  const runnableAccounts = useMemo(() => selectedAccounts.filter((account) => account.sessionStatus === 'ready'), [selectedAccounts])
  const enabledPosts = useMemo(() => postLibrary.posts.filter((post) => post.enabled), [postLibrary])
  const variantCount = enabledPosts.reduce((sum, post) => sum + post.variants.length, 0)
  const safeConcurrency = Math.min(Math.max(1, concurrency), Math.max(1, runnableAccounts.length))
  const currentProgress = run?.progress.find((item) => item.state === 'running')
    ?? [...(run?.progress ?? [])].reverse().find((item) => item.state !== 'pending')
    ?? null
  const currentAccount = currentProgress?.assignedAccountId == null
    ? null
    : accounts.find((account) => account.id === currentProgress.assignedAccountId) ?? null

  const toggleAccount = (id: number) => {
    if (running) return
    setSelectedAccountIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  const accountActivity = (id: number): string => {
    if (run?.progress.some((item) => item.assignedAccountId === id && item.state === 'running')) return 'Đang chạy'
    const completed = run?.progress.filter((item) => item.assignedAccountId === id && !['pending', 'running'].includes(item.state)).length ?? 0
    return completed > 0 ? 'Đã xử lý ' + completed : 'Chưa chạy'
  }

  const openPosts = () => {
    if (running) return
    setPostDraft({ mode: postLibrary.mode, posts: postLibrary.posts.map(copyPost) })
    setEditingPostId(postLibrary.posts[0]?.postId ?? null)
    setPostModalOpen(true)
  }

  const savePosts = async () => {
    if (!postDraft) return
    try {
      const saved = await window.pageAutoZalo.savePostLibrary({
        mode: postDraft.mode,
        posts: postDraft.posts.map((post, index) => ({
          postId: post.postId, enabled: post.enabled, sortOrder: index, media: { ...post.media }
        }))
      })
      setPostLibrary({ mode: saved.mode, posts: saved.posts.map(copyPost) })
      setPostModalOpen(false)
      setCanonicalOpen(false)
      setNotice('Đã lưu Bài Zalo đang dùng.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  const loadCanonical = async () => {
    setCanonicalOpen(true)
    if (canonicalItems.length) return
    setCanonicalLoading(true)
    try {
      const library = await window.pageAuto.getContentLibrary({ id: CANONICAL_CONTENT_LIBRARY_SET_ID })
      setCanonicalItems(library?.items ?? [])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setCanonicalLoading(false)
    }
  }

  const addCanonicalPost = (item: ContentLibraryItem) => {
    if (!postDraft) return
    const postId = Math.abs(item.id)
    if (postDraft.posts.some((post) => post.postId === postId)) return
    const next: ZaloPostLibraryItem = {
      bindingId: 0,
      postId,
      name: item.name,
      enabled: true,
      sortOrder: postDraft.posts.length,
      variants: [...item.variants],
      canonicalImage: {
        folderPath: item.image.folderPath, mode: item.image.mode, imagesPerPost: item.image.imagesPerPost, missingPolicy: item.image.missingPolicy
      },
      media: {
        source: 'canonical',
        folderPath: item.image.folderPath,
        mode: item.image.mode,
        imagesPerTarget: item.image.imagesPerPost,
        missingPolicy: item.image.missingPolicy
      }
    }
    setPostDraft({ ...postDraft, posts: [...postDraft.posts, next] })
    setEditingPostId(postId)
  }

  const patchPost = (postId: number, patch: Partial<ZaloPostLibraryItem>) => {
    setPostDraft((current) => current ? {
      ...current,
      posts: current.posts.map((post) => post.postId === postId ? { ...post, ...patch } : post)
    } : current)
  }

  const patchMedia = (postId: number, patch: Partial<ZaloPostMediaConfig>) => {
    setPostDraft((current) => current ? {
      ...current,
      posts: current.posts.map((post) => post.postId === postId ? { ...post, media: { ...post.media, ...patch } } : post)
    } : current)
  }

  const setMediaSource = (post: ZaloPostLibraryItem, source: ZaloPostMediaConfig['source']) => {
    if (source === 'canonical') {
      patchMedia(post.postId, {
        source,
        folderPath: post.canonicalImage.folderPath,
        mode: post.canonicalImage.mode,
        imagesPerTarget: post.canonicalImage.imagesPerPost,
        missingPolicy: post.canonicalImage.missingPolicy
      })
    } else if (source === 'none') {
      patchMedia(post.postId, { source, folderPath: '', mode: 'sequential', imagesPerTarget: 1, missingPolicy: 'text_only' })
    } else {
      patchMedia(post.postId, { source, folderPath: '', mode: 'sequential', imagesPerTarget: 1, missingPolicy: 'text_only' })
    }
  }

  const chooseFolder = async (postId: number) => {
    const folder = await window.pageAuto.pickContentLibraryImageFolder()
    if (folder) patchMedia(postId, { folderPath: folder })
  }

  const movePost = (postId: number, delta: -1 | 1) => {
    setPostDraft((current) => {
      if (!current) return current
      const index = current.posts.findIndex((post) => post.postId === postId)
      const target = index + delta
      if (index < 0 || target < 0 || target >= current.posts.length) return current
      const posts = [...current.posts]
      const [moved] = posts.splice(index, 1)
      if (moved) posts.splice(target, 0, moved)
      return { ...current, posts }
    })
  }

  const unlinkPost = (postId: number) => {
    setPostDraft((current) => current ? { ...current, posts: current.posts.filter((post) => post.postId !== postId) } : current)
    if (editingPostId === postId) setEditingPostId(null)
  }

  const start = async () => {
    if (!runnableAccounts.length) { setNotice('Không có tài khoản Sẵn sàng.'); return }
    if (!targets.valid.length) { setNotice('Chưa có SĐT hợp lệ. Bấm + Nhập SĐT.'); setConfigModal('targets'); return }
    if (!sendMessage && !sendAttachment && !addFriend) { setNotice('Chưa bật action.'); return }
    if ((sendMessage || sendAttachment) && !enabledPosts.length) { setNotice('Chưa có Bài Zalo đang bật.'); openPosts(); return }

    try {
      const payload: ZaloBatchStartPayload = {
        accountIds: runnableAccounts.map((account) => account.id),
        targets: [...targets.valid],
        actions: { sendMessage, sendAttachment, addFriend },
        contentItems: enabledPosts.map((post) => ({
          sourceItemId: post.postId,
          name: post.name,
          variants: [...post.variants],
          media: {
            folderPath: post.media.source === 'none' ? '' : post.media.folderPath,
            mode: post.media.mode,
            imagesPerTarget: post.media.imagesPerTarget,
            missingPolicy: post.media.missingPolicy
          }
        })),
        contentMode: postLibrary.mode,
        friendMessage: friendMessage || null,
        concurrency: safeConcurrency,
        delayMinMs: Math.max(0, delayMinSeconds * 1000),
        delayMaxMs: Math.max(0, delayMaxSeconds * 1000),
        failurePolicy
      }
      const next = await window.pageAutoZalo.startBatch(payload)
      setRun(next)
      setNotice('')
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

  const editingPost = postDraft?.posts.find((post) => post.postId === editingPostId) ?? null
  const boundPostIds = new Set(postDraft?.posts.map((post) => post.postId) ?? [])

  return (
    <div className="zalo-batch-panel">
      <div className="zalo-batch-commandbar">
        <div className="zalo-run-facts">
          <span><b>{runnableAccounts.length}</b> TK chạy</span>
          <span><b>{targets.valid.length.toLocaleString('vi-VN')}</b> SĐT</span>
          <span><b>{enabledPosts.length}</b> Bài Zalo</span>
          <span><b>{safeConcurrency}</b> song song</span>
        </div>
        <div className="zalo-run-actions zalo-run-actions-top">
          <button className="button primary" type="button" disabled={running} onClick={() => void start()}>Start</button>
          <button className="button secondary" type="button" disabled={!run || terminal(run.state) || run.state === 'paused'} onClick={() => void control('pause')}>Tạm dừng</button>
          <button className="button secondary" type="button" disabled={!run || terminal(run.state) || run.state !== 'paused'} onClick={() => void control('resume')}>Tiếp tục</button>
          <button className="button secondary" type="button" disabled={!run || terminal(run.state)} onClick={() => void control('stop')}>Stop</button>
        </div>
      </div>

      {notice ? <div className="notice-card zalo-notice">{notice}</div> : null}

      <div className="zalo-automation-grid">
        <section className="zalo-batch-card zalo-account-run-card">
          <div className="zalo-batch-card-heading"><div><span>Tài khoản chạy</span><strong>Danh sách tài khoản</strong></div><small>{runnableAccounts.length}/{selectedAccounts.length} sẵn sàng</small></div>
          <div className="table-wrap zalo-batch-account-table-wrap">
            <table className="data-table zalo-batch-account-table">
              <thead><tr><th>Bật</th><th>SĐT</th><th>Tên</th><th>Session</th><th>Hoạt động</th></tr></thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className={account.sessionStatus !== 'ready' ? 'zalo-account-not-ready' : ''}>
                    <td><input type="checkbox" checked={selectedAccountIds.includes(account.id)} disabled={running} onChange={() => toggleAccount(account.id)} /></td>
                    <td><strong>{account.phone}</strong></td>
                    <td>{account.displayName || '—'}</td>
                    <td><span className={'zalo-status zalo-status-' + account.sessionStatus}>{statusLabel(account.sessionStatus)}</span></td>
                    <td>{accountActivity(account.id)}</td>
                  </tr>
                ))}
                {!accounts.length ? <tr><td colSpan={5}>Chưa có tài khoản Zalo.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="zalo-batch-options">
            <label>TK song song<input type="number" min={1} max={Math.max(1, runnableAccounts.length)} value={concurrency} disabled={running} onChange={(event) => setConcurrency(Number(event.target.value))} /></label>
            <label>Delay từ (giây)<input type="number" min={0} value={delayMinSeconds} disabled={running} onChange={(event) => setDelayMinSeconds(Number(event.target.value))} /></label>
            <label>Delay đến (giây)<input type="number" min={0} value={delayMaxSeconds} disabled={running} onChange={(event) => setDelayMaxSeconds(Number(event.target.value))} /></label>
            <label>Khi lỗi<select value={failurePolicy} disabled={running} onChange={(event) => setFailurePolicy(event.target.value as 'continue' | 'stop_run')}><option value="continue">Chạy tiếp</option><option value="stop_run">Dừng lượt</option></select></label>
          </div>
        </section>

        <section className="zalo-batch-card zalo-runtime-preview">
          <div className="zalo-batch-card-heading"><div><span>Runtime</span><strong>Đang chạy</strong></div><small>{run ? run.completedTargets + '/' + run.totalTargets : 'Chưa chạy'}</small></div>
          <div className="zalo-runtime-body">
            <dl className="zalo-runtime-grid">
              <div><dt>TK</dt><dd>{currentAccount?.phone ?? '—'}</dd></div>
              <div><dt>Target</dt><dd>{currentProgress?.targetPhone ?? '—'}</dd></div>
              <div><dt>Bài</dt><dd>{currentProgress?.postName ?? enabledPosts[0]?.name ?? '—'}</dd></div>
              <div><dt>Variant</dt><dd>{currentProgress?.variantIndex == null ? '—' : '#' + (currentProgress.variantIndex + 1)}</dd></div>
              <div><dt>Action</dt><dd>{currentProgress?.currentAction ? actionLabel(currentProgress.currentAction) : run?.actions.map(actionLabel).join(' → ') || '—'}</dd></div>
              <div><dt>Media</dt><dd>{currentProgress?.mediaPaths.length ? currentProgress.mediaPaths.length + ' file' : 'Không media'}</dd></div>
              <div><dt>Progress</dt><dd>{run ? run.completedTargets + '/' + run.totalTargets : '0/' + targets.valid.length}</dd></div>
            </dl>
            <div className="zalo-runtime-content"><span>Preview nội dung</span><p>{currentProgress?.contentPreview ? truncate(currentProgress.contentPreview) : enabledPosts[0]?.variants[0] ? truncate(enabledPosts[0].variants[0]) : 'Chưa có nội dung.'}</p></div>
            {currentProgress?.mediaPaths.length ? <div className="zalo-runtime-media">{currentProgress.mediaPaths.map((path) => <span key={path}>{fileName(path)}</span>)}</div> : null}
            {currentProgress ? <strong className={'zalo-runtime-state state-' + currentProgress.state}>{currentProgress.message}</strong> : null}
          </div>
        </section>
      </div>

      <div className="zalo-config-toolbar" aria-label="Cấu hình Zalo automation">
        <button type="button" className="zalo-config-button" disabled={running} onClick={() => setConfigModal('targets')}><span>+ Nhập SĐT</span><strong>{targets.valid.length.toLocaleString('vi-VN')} SĐT</strong><small>{targets.duplicates} trùng · {targets.invalid} lỗi</small></button>
        <button type="button" className="zalo-config-button" disabled={running} onClick={openPosts}><span>Bài Zalo</span><strong>{enabledPosts.length}/{postLibrary.posts.length} bài đang dùng</strong><small>{variantCount} biến thể · {postLibrary.mode === 'random' ? 'Random' : 'Tuần tự'}</small></button>
        <div className="zalo-action-strip">
          <strong>Action</strong>
          <label><input type="checkbox" checked={sendMessage} disabled={running} onChange={(event) => setSendMessage(event.target.checked)} /> Gửi tin</label>
          <label><input type="checkbox" checked={sendAttachment} disabled={running} onChange={(event) => setSendAttachment(event.target.checked)} /> Gửi ảnh/file</label>
          <label><input type="checkbox" checked={addFriend} disabled={running} onChange={(event) => setAddFriend(event.target.checked)} /> Kết bạn</label>
          <button className="zalo-action-more" type="button" disabled={running} onClick={() => setConfigModal('actions')}>Cấu hình…</button>
        </div>
      </div>

      {run ? (
        <section className="zalo-batch-card zalo-batch-results">
          <div className="zalo-batch-card-heading"><div><span>Runtime</span><strong>Tiến độ từng SĐT</strong></div><small>{run.successTargets} thành công · {run.failedTargets} lỗi</small></div>
          <div className="table-wrap zalo-batch-progress-wrap">
            <table className="data-table">
              <thead><tr><th>#</th><th>SĐT</th><th>Tài khoản</th><th>Bài / variant</th><th>Media</th><th>Trạng thái</th></tr></thead>
              <tbody>{run.progress.map((item) => {
                const account = item.assignedAccountId == null ? null : accounts.find((candidate) => candidate.id === item.assignedAccountId) ?? null
                return <tr key={run.runId + '-' + item.index}><td>{item.index + 1}</td><td>{item.targetPhone}</td><td>{account?.phone ?? '—'}</td><td>{item.postName ?? '—'}{item.variantIndex == null ? '' : ' · #' + (item.variantIndex + 1)}</td><td>{item.mediaPaths.length ? item.mediaPaths.length + ' file' : '—'}</td><td>{item.message}</td></tr>
              })}</tbody>
            </table>
          </div>
        </section>
      ) : null}

      {configModal ? (
        <div className="zalo-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setConfigModal(null) }}>
          <section className="zalo-config-modal" role="dialog" aria-modal="true">
            <header className="zalo-modal-header"><div><span>Cấu hình</span><strong>{configModal === 'targets' ? 'Nhập SĐT' : 'Action'}</strong></div><button className="button secondary" type="button" onClick={() => setConfigModal(null)}>Đóng</button></header>
            {configModal === 'targets' ? <div className="zalo-modal-body">
              <textarea className="zalo-target-editor" value={targetsText} onChange={(event) => setTargetsText(event.target.value)} placeholder={'0912345678\n0987654321\n...'} />
              <div className="zalo-target-stats"><span><b>{targets.valid.length}</b> hợp lệ</span><span><b>{targets.duplicates}</b> trùng</span><span><b>{targets.invalid}</b> lỗi</span></div>
              <div className="zalo-modal-footer"><span>Mỗi dòng một số. Số trùng tự loại.</span><button className="button primary" type="button" onClick={() => setConfigModal(null)}>Xong</button></div>
            </div> : null}
            {configModal === 'actions' ? <div className="zalo-modal-body">
              <div className="zalo-action-grid">
                <label><input type="checkbox" checked={sendMessage} onChange={(event) => setSendMessage(event.target.checked)} /><span><b>Gửi tin</b><small>Dùng variant của Bài Zalo</small></span></label>
                <label><input type="checkbox" checked={sendAttachment} onChange={(event) => setSendAttachment(event.target.checked)} /><span><b>Gửi ảnh/file</b><small>Dùng media của chính Bài Zalo</small></span></label>
                <label><input type="checkbox" checked={addFriend} onChange={(event) => setAddFriend(event.target.checked)} /><span><b>Kết bạn</b><small>Có thể kèm lời nhắn</small></span></label>
              </div>
              {addFriend ? <label className="zalo-modal-field">Lời nhắn kết bạn<textarea value={friendMessage} onChange={(event) => setFriendMessage(event.target.value)} placeholder="Có thể để trống" /></label> : null}
              <div className="zalo-modal-footer"><span>Action chạy theo thứ tự Gửi tin → Gửi ảnh/file → Kết bạn.</span><button className="button primary" type="button" onClick={() => setConfigModal(null)}>Xong</button></div>
            </div> : null}
          </section>
        </div>
      ) : null}

      {postModalOpen && postDraft ? (
        <div className="zalo-modal-backdrop" role="presentation">
          <section className="zalo-post-library-modal" role="dialog" aria-modal="true">
            <header className="zalo-modal-header"><div><span>Consumer binding</span><strong>Bài Zalo đang dùng</strong></div><button className="button secondary" type="button" onClick={() => setPostModalOpen(false)}>Đóng</button></header>
            <div className="zalo-post-toolbar"><button className="button primary" type="button" onClick={() => void loadCanonical()}>+ Chọn từ Thư viện bài viết</button><div className="zalo-post-mode"><button type="button" className={postDraft.mode === 'sequential' ? 'active' : ''} onClick={() => setPostDraft({ ...postDraft, mode: 'sequential' })}>Tuần tự</button><button type="button" className={postDraft.mode === 'random' ? 'active' : ''} onClick={() => setPostDraft({ ...postDraft, mode: 'random' })}>Random</button></div></div>
            <div className="zalo-post-layout">
              <div className="zalo-post-list">
                {postDraft.posts.map((post, index) => <div key={post.postId} className={editingPostId === post.postId ? 'zalo-post-row is-selected' : 'zalo-post-row'}>
                  <input type="checkbox" checked={post.enabled} onChange={(event) => patchPost(post.postId, { enabled: event.target.checked })} />
                  <button className="zalo-post-main" type="button" onClick={() => setEditingPostId(post.postId)}><strong>{index + 1}. {post.name}</strong><span>{post.variants.length} biến thể · {mediaSummary(post)}</span></button>
                  <div className="zalo-post-actions"><button type="button" disabled={index === 0} onClick={() => movePost(post.postId, -1)}>↑</button><button type="button" disabled={index === postDraft.posts.length - 1} onClick={() => movePost(post.postId, 1)}>↓</button><button type="button" onClick={() => setEditingPostId(post.postId)}>Sửa</button><button type="button" onClick={() => unlinkPost(post.postId)}>Gỡ</button></div>
                </div>)}
                {!postDraft.posts.length ? <div className="zalo-post-empty">Chưa có Bài Zalo. Bấm “+ Chọn từ Thư viện bài viết”.</div> : null}
              </div>
              <aside className="zalo-post-editor">
                {editingPost ? <>
                  <div className="zalo-post-editor-head"><strong>{editingPost.name}</strong><span>{editingPost.variants.length} biến thể</span></div>
                  <div className="zalo-post-preview"><span>Preview</span><p>{editingPost.variants[0] ? truncate(editingPost.variants[0], 180) : 'Bài không có nội dung chữ.'}</p></div>
                  <label className="zalo-post-field">Media<select value={editingPost.media.source} onChange={(event) => setMediaSource(editingPost, event.target.value as ZaloPostMediaConfig['source'])}><option value="canonical">Theo bài gốc</option><option value="folder">Folder riêng</option><option value="none">Không media</option></select></label>
                  {editingPost.media.source === 'canonical' ? <div className="zalo-media-summary"><strong>{editingPost.canonicalImage.folderPath || 'Bài gốc không có folder'}</strong><span>{editingPost.canonicalImage.imagesPerPost} file/target · {editingPost.canonicalImage.mode}</span></div> : null}
                  {editingPost.media.source === 'folder' ? <>
                    <div className="zalo-folder-picker"><span>{editingPost.media.folderPath || 'Chưa chọn folder'}</span><button type="button" className="button secondary" onClick={() => void chooseFolder(editingPost.postId)}>Chọn folder</button></div>
                    <label className="zalo-post-field">Số file/target<input type="number" min={1} max={50} value={editingPost.media.imagesPerTarget} onChange={(event) => patchMedia(editingPost.postId, { imagesPerTarget: Number(event.target.value) })} /></label>
                    <label className="zalo-post-field">Cách lấy<select value={editingPost.media.mode} onChange={(event) => patchMedia(editingPost.postId, { mode: event.target.value as 'sequential' | 'random' })}><option value="sequential">Tuần tự</option><option value="random">Random</option></select></label>
                    <label className="zalo-post-field">Thiếu media<select value={editingPost.media.missingPolicy} onChange={(event) => patchMedia(editingPost.postId, { missingPolicy: event.target.value as 'text_only' | 'skip' })}><option value="text_only">Chạy tiếp không media</option><option value="skip">Bỏ target</option></select></label>
                  </> : null}
                </> : <div className="zalo-post-empty">Chọn một bài để xem media.</div>}
              </aside>
            </div>
            <footer className="zalo-post-footer"><span>Gỡ ở đây không xóa bài canonical.</span><button className="button primary" type="button" onClick={() => void savePosts()}>Lưu Bài Zalo</button></footer>
          </section>

          {canonicalOpen ? <section className="zalo-canonical-picker" role="dialog" aria-modal="true">
            <header className="zalo-modal-header"><div><span>Canonical Post Library</span><strong>Chọn từ Thư viện bài viết</strong></div><button className="button secondary" type="button" onClick={() => setCanonicalOpen(false)}>Đóng</button></header>
            <div className="zalo-canonical-list">
              {canonicalLoading ? <div className="zalo-post-empty">Đang tải…</div> : canonicalItems.map((item) => { const postId = Math.abs(item.id); const bound = boundPostIds.has(postId); return <button key={item.id} type="button" className={bound ? 'zalo-canonical-row is-bound' : 'zalo-canonical-row'} disabled={bound} onClick={() => addCanonicalPost(item)}><span><strong>{item.name}</strong><small>{item.variants.length} biến thể · {item.image.folderPath ? item.image.imagesPerPost + ' file/lượt' : 'Không media'}</small></span><b>{bound ? 'Đang dùng' : 'Chọn'}</b></button> })}
            </div>
          </section> : null}
        </div>
      ) : null}
    </div>
  )
}
