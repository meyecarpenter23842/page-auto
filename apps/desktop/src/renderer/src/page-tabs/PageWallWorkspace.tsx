import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CANONICAL_CONTENT_LIBRARY_SET_ID,
  DEFAULT_CONTENT_LIBRARY_IMAGE,
  type ContentLibraryImageConfig,
  type ContentLibraryItem
} from '../../../shared/contentLibrary'
import type { PageTabConfig, PageTabSummary } from '../../../shared/pageTabs'
import type { PageWallCanonicalPostSelection, PageWallRunNowResult } from '../../../shared/pageWall'
import {
  buildPageWallFiniteTasks,
  normalizePageWallScheduleMinutes,
  type PageWallFiniteDashboard,
  type PageWallFinitePlanView
} from '../../../shared/pageWallFiniteRuntime'
import type { PageWallPlanPostSource, PageWallPlanStatus } from '../../../shared/pageWallPlans'
import './pageWallWorkspace.css'

export interface PageWallWorkspaceProps { activePageId?: number; scoped?: boolean }
type Mode = 'now' | 'schedule'
type PickerTarget = 'workspace' | 'schedule'
type WallAccount = PageTabConfig['accounts'][number]

interface PostRef {
  postId: number
  postName: string
  variantIndex: number
}

interface ScheduleDraft {
  planIds: number[]
  scheduleKind: 'specific_date' | 'daily'
  localDate: string
  times: string[]
  accountIds: number[]
  accountConcurrency: number
  post: PostRef | null
}

interface ScheduleGroup {
  key: string
  plans: PageWallFinitePlanView[]
  planIds: number[]
  scheduleKind: 'specific_date' | 'daily'
  localDate: string | null
  minutes: number[]
  accountIds: number[]
  accountConcurrency: number
  source: PageWallPlanPostSource | null
  status: PageWallPlanStatus
  editable: boolean
}

function timeToMinute(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1
}
function minuteToTime(value: number): string { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}` }
function localDateInput(): string { const now = new Date(); const shifted = new Date(now.getTime() - now.getTimezoneOffset() * 60_000); return shifted.toISOString().slice(0, 10) }
function resultTone(result: PageWallRunNowResult): string { return result.status === 'success' ? 'success' : result.status === 'needs_login' ? 'attention' : 'error' }
function statusText(status: PageWallPlanStatus): string {
  if (status === 'active') return 'Đang chờ'
  if (status === 'completed') return 'Đã chạy'
  if (status === 'disabled') return 'Tạm tắt'
  return 'Cần xử lý'
}
function isWallAccountSelectable(account: WallAccount): boolean {
  return account.status !== 'disabled'
}
function canonicalPostId(item: ContentLibraryItem): number | null {
  if (item.contentSetId !== CANONICAL_CONTENT_LIBRARY_SET_ID || !Number.isSafeInteger(item.id) || item.id >= 0) return null
  return Math.abs(item.id)
}
function postRefFromItem(item: ContentLibraryItem, variantIndex: number): PostRef | null {
  const postId = canonicalPostId(item)
  return postId ? { postId, postName: item.name, variantIndex } : null
}
function canonicalFromItem(item: ContentLibraryItem, variantIndex: number): PageWallCanonicalPostSelection | null {
  const ref = postRefFromItem(item, variantIndex)
  if (!ref) return null
  return { ...ref, content: item.variants[variantIndex] ?? '', image: { ...item.image } }
}
function sourceSignature(source: PageWallPlanPostSource): unknown {
  return source.kind === 'canonical'
    ? { kind: 'canonical', postId: source.postId, variantIndex: source.variantIndex }
    : { kind: 'manual', content: source.content, imagePaths: [...source.imagePaths] }
}
function groupSignature(plan: PageWallFinitePlanView): string {
  return JSON.stringify({
    scheduleKind: plan.scheduleKind,
    localDate: plan.localDate,
    accountConcurrency: plan.accountConcurrency,
    tasks: plan.tasks.map((task) => ({ accountId: task.accountId, source: sourceSignature(task.source) }))
  })
}
function groupStatus(plans: PageWallFinitePlanView[]): PageWallPlanStatus {
  if (plans.some((plan) => plan.status === 'needs_attention')) return 'needs_attention'
  if (plans.some((plan) => plan.status === 'active')) return 'active'
  if (plans.every((plan) => plan.status === 'completed')) return 'completed'
  if (plans.every((plan) => plan.status === 'disabled')) return 'disabled'
  return plans[0]?.status ?? 'active'
}
function groupSchedulePlans(plans: PageWallFinitePlanView[]): ScheduleGroup[] {
  const grouped = new Map<string, PageWallFinitePlanView[]>()
  for (const plan of plans) {
    const key = groupSignature(plan)
    const list = grouped.get(key) ?? []
    list.push(plan)
    grouped.set(key, list)
  }
  return [...grouped.entries()].map(([key, list]) => {
    const sorted = [...list].sort((left, right) => left.minuteOfDay - right.minuteOfDay || left.id - right.id)
    const first = sorted[0]!
    const accountIds = [...new Set(first.tasks.map((task) => task.accountId))]
    return {
      key,
      plans: sorted,
      planIds: sorted.map((plan) => plan.id),
      scheduleKind: first.scheduleKind,
      localDate: first.localDate,
      minutes: sorted.map((plan) => plan.minuteOfDay),
      accountIds,
      accountConcurrency: first.accountConcurrency,
      source: first.tasks[0]?.source ?? null,
      status: groupStatus(sorted),
      editable: sorted.every((plan) => !plan.latestOccurrence)
    }
  }).sort((left, right) => {
    const leftDate = left.scheduleKind === 'daily' ? '9999-12-31' : left.localDate ?? ''
    const rightDate = right.scheduleKind === 'daily' ? '9999-12-31' : right.localDate ?? ''
    return leftDate.localeCompare(rightDate) || (left.minutes[0] ?? 0) - (right.minutes[0] ?? 0)
  })
}

function LibraryPicker({ items, onClose, onPick }: { items: ContentLibraryItem[]; onClose: () => void; onPick: (item: ContentLibraryItem, variantIndex: number) => void }) {
  const [query, setQuery] = useState('')
  const [variants, setVariants] = useState<Record<number, number>>({})
  const filtered = items.filter((item) => !query.trim() || [item.name, ...item.variants].join(' ').toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi')))
  return <div className="page-wall-modal-backdrop picker" role="presentation" onMouseDown={onClose}>
    <section className="page-wall-library" role="dialog" aria-modal="true" aria-label="Chọn bài từ Thư viện" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><small>THƯ VIỆN BÀI VIẾT CHUNG</small><h3>Chọn bài đăng</h3></div><button type="button" onClick={onClose}>×</button></header>
      <input className="page-wall-library-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên hoặc nội dung…" autoFocus />
      <div className="page-wall-library-list">{filtered.map((item) => {
        const postId = canonicalPostId(item)
        const variantIndex = Math.min(variants[item.id] ?? 0, Math.max(0, item.variants.length - 1))
        const blocked = Boolean(item.image.folderPath.trim()) && item.image.mode === 'filename_match'
        return <article key={item.id} className="page-wall-library-item">
          <div><strong>{item.name}</strong><p>{item.variants[variantIndex] || (item.image.folderPath ? 'Bài chỉ có ảnh' : 'Không có nội dung')}</p><small>{postId ? `Post #${postId}` : 'Không có canonical id'} · {item.variants.length || 1} biến thể · {item.image.folderPath ? `${item.image.imagesPerPost} ảnh/lượt` : 'Không ảnh'}</small></div>
          <div>{item.variants.length > 1 ? <select value={variantIndex} onChange={(event) => setVariants((current) => ({ ...current, [item.id]: Number(event.target.value) }))}>{item.variants.map((_value, index) => <option key={index} value={index}>Biến thể {index + 1}</option>)}</select> : null}<button className="pt-button primary" type="button" disabled={!postId || blocked} onClick={() => onPick(item, variantIndex)}>Chọn bài này</button></div>
        </article>
      })}{!filtered.length ? <p className="page-wall-empty-copy">Không có bài phù hợp.</p> : null}</div>
    </section>
  </div>
}

function PostEditorModal({ item, variantIndex, onClose, onSaved }: { item: ContentLibraryItem | null; variantIndex: number; onClose: () => void; onSaved: (item: ContentLibraryItem, variantIndex: number) => void }) {
  const safeIndex = item ? Math.min(variantIndex, Math.max(0, item.variants.length - 1)) : 0
  const [name, setName] = useState(item?.name ?? '')
  const [text, setText] = useState(item?.variants[safeIndex] ?? '')
  const [image, setImage] = useState<ContentLibraryImageConfig>(() => item ? { ...item.image } : { ...DEFAULT_CONTENT_LIBRARY_IMAGE })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const imageCountValid = Number.isSafeInteger(image.imagesPerPost) && image.imagesPerPost >= 1 && image.imagesPerPost <= 50
  const canSave = Boolean(name.trim() && (text.trim() || image.folderPath.trim()) && imageCountValid && !busy)
  const pickFolder = async () => {
    const folderPath = await window.pageAuto.pickContentLibraryImageFolder()
    if (folderPath) setImage((current) => ({ ...current, folderPath }))
  }
  const save = async () => {
    if (!canSave) return
    setBusy(true); setError(null)
    try {
      const variants = item ? [...item.variants] : ['']
      if (!variants.length) variants.push('')
      variants[safeIndex] = text
      const details = item
        ? await window.pageAuto.updateContentLibraryItem({ id: item.id, contentSetId: CANONICAL_CONTENT_LIBRARY_SET_ID, name: name.trim(), enabled: true, variants, image })
        : await window.pageAuto.createContentLibraryItem({ contentSetId: CANONICAL_CONTENT_LIBRARY_SET_ID, name: name.trim(), enabled: true, variants: [text], image })
      const saved = item
        ? details.items.find((candidate) => candidate.id === item.id)
        : [...details.items].sort((left, right) => right.updatedAt - left.updatedAt || Math.abs(right.id) - Math.abs(left.id))[0]
      if (!saved) throw new Error('Không đọc lại được bài vừa lưu vào Thư viện.')
      onSaved(saved, item ? safeIndex : 0)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <div className="page-wall-modal-backdrop editor" role="presentation" onMouseDown={onClose}>
    <section className="page-wall-post-editor" role="dialog" aria-modal="true" aria-label={item ? 'Sửa bài viết' : 'Thêm bài viết'} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><small>THƯ VIỆN BÀI VIẾT CHUNG</small><h3>{item ? 'Sửa bài viết' : 'Thêm bài viết'}</h3></div><button type="button" onClick={onClose}>×</button></header>
      {error ? <div className="page-tab-error">{error}</div> : null}
      <label><span>Tên bài</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Khuyến mãi tháng 9" autoFocus /></label>
      <label><span>Nội dung{item && item.variants.length > 1 ? ` · biến thể ${safeIndex + 1}/${item.variants.length}` : ''}</span><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Nhập nội dung bài…" /></label>
      <label><span>Số ảnh mỗi bài</span><input aria-label="Số ảnh mỗi bài" type="number" min={1} max={50} value={image.imagesPerPost} onChange={(event) => setImage((current) => ({ ...current, imagesPerPost: Math.max(1, Math.min(50, Number(event.target.value) || 1)) }))} /><small>Mỗi lượt đăng lấy tối đa số ảnh này từ folder đã chọn.</small></label>
      <div className="page-wall-folder-row"><div><span>Folder ảnh</span><b>{image.folderPath || 'Không dùng ảnh'}</b></div><button className="pt-button secondary" type="button" onClick={() => void pickFolder()}>Chọn folder</button><button type="button" disabled={!image.folderPath} onClick={() => setImage((current) => ({ ...current, folderPath: '' }))}>Bỏ ảnh</button></div>
      <footer><button type="button" onClick={onClose}>Hủy</button><button className="pt-button primary" type="button" disabled={!canSave} onClick={() => void save()}>{busy ? 'Đang lưu…' : 'Lưu vào Thư viện'}</button></footer>
    </section>
  </div>
}

function ScheduleModal({ draft, accounts, libraryItems, busy, onChange, onChoosePost, onAddPost, onEditPost, onClose, onSave }: {
  draft: ScheduleDraft
  accounts: WallAccount[]
  libraryItems: ContentLibraryItem[]
  busy: boolean
  onChange: (next: ScheduleDraft) => void
  onChoosePost: () => void
  onAddPost: () => void
  onEditPost: () => void
  onClose: () => void
  onSave: () => void
}) {
  const runnable = accounts.filter(isWallAccountSelectable)
  const postItem = draft.post ? libraryItems.find((item) => canonicalPostId(item) === draft.post?.postId) ?? null : null
  const toggle = (accountId: number) => onChange({ ...draft, accountIds: draft.accountIds.includes(accountId) ? draft.accountIds.filter((id) => id !== accountId) : [...draft.accountIds, accountId] })
  const setTime = (index: number, value: string) => onChange({ ...draft, times: draft.times.map((time, current) => current === index ? value : time) })
  const rawMinutes = draft.times.map(timeToMinute)
  const uniqueMinutes = (() => { try { return normalizePageWallScheduleMinutes(rawMinutes) } catch { return [] } })()
  const timesValid = rawMinutes.every((minute) => minute >= 0) && uniqueMinutes.length === draft.times.length
  const canSave = Boolean(draft.post && draft.accountIds.length && timesValid && uniqueMinutes.length && (draft.scheduleKind === 'daily' || draft.localDate) && !busy)
  const postSummary = draft.post ? `#${draft.post.postId} · ${draft.post.postName} · Biến thể ${draft.post.variantIndex + 1}` : 'Chưa chọn bài'
  return <div className="page-wall-modal-backdrop schedule" role="presentation" onMouseDown={onClose}>
    <section className="page-wall-schedule-dialog" role="dialog" aria-modal="true" aria-label="Thiết lập lịch đăng" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><small>LỊCH ĐĂNG TƯỜNG</small><h3>{draft.planIds.length ? 'Sửa lịch đăng' : 'Hẹn giờ đăng bài'}</h3></div><button type="button" onClick={onClose}>×</button></header>
      <div className="page-wall-schedule-step"><b>1. Chọn bài viết</b><div className={`page-wall-selected-post compact ${draft.post ? 'ready' : 'empty'}`}><div><small>BÀI ĐANG CHỌN</small><strong>{postSummary}</strong>{postItem?.image.folderPath ? <span>{postItem.image.imagesPerPost} ảnh/lượt · {postItem.image.folderPath}</span> : <span>{draft.post ? 'Không ảnh' : 'Chọn bài trước khi lưu lịch'}</span>}</div><div><button className="pt-button secondary" type="button" onClick={onChoosePost}>Chọn</button><button type="button" onClick={onAddPost}>Thêm</button><button type="button" disabled={!draft.post || !postItem} onClick={onEditPost}>Sửa</button></div></div></div>
      <div className="page-wall-schedule-step"><b>2. Thời gian đăng bài</b><div className="page-wall-plan-kind"><label><input type="radio" checked={draft.scheduleKind === 'specific_date'} onChange={() => onChange({ ...draft, scheduleKind: 'specific_date' })} /> Ngày cụ thể</label><label><input type="radio" checked={draft.scheduleKind === 'daily'} onChange={() => onChange({ ...draft, scheduleKind: 'daily' })} /> Mỗi ngày</label></div>{draft.scheduleKind === 'specific_date' ? <label className="page-wall-date-field"><span>Ngày chạy</span><input type="date" value={draft.localDate} onChange={(event) => onChange({ ...draft, localDate: event.target.value })} /></label> : null}<div className="page-wall-time-list">{draft.times.map((time, index) => <div className="page-wall-time-chip" key={`${index}-${time}`}><input type="time" value={time} onChange={(event) => setTime(index, event.target.value)} /><button type="button" aria-label={`Xóa giờ ${time}`} disabled={draft.times.length === 1} onClick={() => onChange({ ...draft, times: draft.times.filter((_value, current) => current !== index) })}>×</button></div>)}<button className="page-wall-add-time" type="button" disabled={draft.times.length >= 12} onClick={() => onChange({ ...draft, times: [...draft.times, '12:00'] })}>+ Thêm giờ</button></div>{!timesValid ? <small className="page-wall-time-error">Giờ chạy phải hợp lệ và không được trùng nhau.</small> : null}</div>
      <div className="page-wall-schedule-step accounts"><div className="page-wall-step-title"><b>3. Chọn tài khoản muốn đăng</b><span>{draft.accountIds.length}/{runnable.length} TK</span></div><div className="page-wall-mini-account-tools"><button type="button" onClick={() => onChange({ ...draft, accountIds: runnable.map((account) => account.accountId) })}>Chọn tất cả</button><button type="button" onClick={() => onChange({ ...draft, accountIds: [] })}>Bỏ chọn</button><label><span>TK song song</span><input type="number" min={1} max={20} value={draft.accountConcurrency} onChange={(event) => onChange({ ...draft, accountConcurrency: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })} /></label></div><div className="page-wall-schedule-account-table"><table><thead><tr><th></th><th>UID</th><th>Tên</th><th>Trạng thái</th></tr></thead><tbody>{accounts.map((account) => { const canUse = isWallAccountSelectable(account); const selected = draft.accountIds.includes(account.accountId); return <tr key={account.accountId} className={`${selected ? 'selected' : ''} ${!canUse ? 'disabled' : ''}`} onClick={() => { if (canUse && !busy) toggle(account.accountId) }}><td><input type="checkbox" checked={selected} disabled={!canUse || busy} onClick={(event) => event.stopPropagation()} onChange={() => toggle(account.accountId)} /></td><td><b>{account.uid}</b></td><td>{account.name || '—'}</td><td>{account.status}</td></tr> })}</tbody></table></div></div>
      <div className="page-wall-schedule-review"><strong>{draft.scheduleKind === 'daily' ? 'Mỗi ngày' : draft.localDate || 'Chưa chọn ngày'} · {uniqueMinutes.map(minuteToTime).join(', ') || 'Chưa có giờ'}</strong><span>{postSummary} · {draft.accountIds.length} TK · song song {draft.accountConcurrency}</span></div>
      <footer><button type="button" onClick={onClose}>Hủy</button><button className="pt-button primary" type="button" disabled={!canSave} onClick={onSave}>{busy ? 'Đang lưu…' : 'Lưu lịch'}</button></footer>
    </section>
  </div>
}

export function PageWallWorkspace({ activePageId: controlledPageId, scoped = false }: PageWallWorkspaceProps = {}) {
  const [tabs, setTabs] = useState<PageTabSummary[]>([])
  const [pageTabId, setPageTabId] = useState<number | null>(controlledPageId ?? null)
  const [config, setConfig] = useState<PageTabConfig | null>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [accountConcurrency, setAccountConcurrency] = useState(1)
  const [canonical, setCanonical] = useState<PageWallCanonicalPostSelection | null>(null)
  const [mode, setMode] = useState<Mode>('now')
  const [dashboard, setDashboard] = useState<PageWallFiniteDashboard>({ plans: [], jobs: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResults, setLastResults] = useState<PageWallRunNowResult[]>([])
  const [libraryItems, setLibraryItems] = useState<ContentLibraryItem[]>([])
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null)
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null)
  const [postEditor, setPostEditor] = useState<{ target: PickerTarget; item: ContentLibraryItem | null; variantIndex: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.pageAuto.listPageTabs().then((next) => {
      if (cancelled) return
      setTabs(next)
      setPageTabId((current) => {
        const wanted = controlledPageId ?? current
        return wanted && next.some((tab) => tab.id === wanted) ? wanted : scoped ? null : next[0]?.id ?? null
      })
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
    return () => { cancelled = true }
  }, [controlledPageId, scoped])

  const refreshDashboard = useCallback(async (id: number, silent = false) => {
    try { setDashboard(await window.pageWallFinite.getDashboard({ pageTabId: id })); if (!silent) setError(null) }
    catch (cause) { if (!silent) setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [])
  const refreshLibrary = useCallback(async () => {
    const library = await window.pageAuto.getContentLibrary({ id: CANONICAL_CONTENT_LIBRARY_SET_ID })
    setLibraryItems(library?.items ?? [])
    return library?.items ?? []
  }, [])

  useEffect(() => {
    if (!pageTabId) { setConfig(null); setDashboard({ plans: [], jobs: [] }); return }
    let cancelled = false
    void window.pageAuto.getPageTab({ id: pageTabId }).then((next) => {
      if (cancelled) return
      setConfig(next)
      const runnable = (next?.accounts ?? []).filter(isWallAccountSelectable).sort((a, b) => a.sortOrder - b.sortOrder)
      setSelectedIds(runnable.map((account) => account.accountId))
      setLastResults([])
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
    void refreshLibrary().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
    void refreshDashboard(pageTabId)
    const timer = window.setInterval(() => void refreshDashboard(pageTabId, true), 3_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [pageTabId, refreshDashboard, refreshLibrary])

  const accounts = useMemo(() => [...(config?.accounts ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [config])
  const runnableIds = useMemo(() => accounts.filter(isWallAccountSelectable).map((account) => account.accountId), [accounts])
  const selectedRunnable = selectedIds.filter((id) => runnableIds.includes(id))
  const scheduleGroups = useMemo(() => groupSchedulePlans(dashboard.plans), [dashboard.plans])
  const canRun = Boolean(pageTabId && selectedRunnable.length && canonical && !busy)
  const runBlockedReason = !selectedRunnable.length ? 'Chưa chọn tài khoản' : !canonical ? 'Chưa chọn bài viết' : null

  const toggleAccount = (accountId: number) => setSelectedIds((current) => current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId])
  const chooseFromLibrary = async (target: PickerTarget) => {
    setError(null)
    try { await refreshLibrary(); setPickerTarget(target) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const applyPickedPost = (target: PickerTarget, item: ContentLibraryItem, variantIndex: number) => {
    if (target === 'workspace') {
      const selection = canonicalFromItem(item, variantIndex)
      if (selection) setCanonical(selection)
    } else {
      const ref = postRefFromItem(item, variantIndex)
      if (ref) setScheduleDraft((current) => current ? { ...current, post: ref } : current)
    }
    setPickerTarget(null)
  }
  const openPostEditor = (target: PickerTarget, create: boolean) => {
    const ref = target === 'workspace'
      ? canonical ? { postId: canonical.postId, variantIndex: canonical.variantIndex } : null
      : scheduleDraft?.post ?? null
    const item = !create && ref ? libraryItems.find((candidate) => canonicalPostId(candidate) === ref.postId) ?? null : null
    setPostEditor({ target, item, variantIndex: ref?.variantIndex ?? 0 })
  }
  const handlePostSaved = async (item: ContentLibraryItem, variantIndex: number) => {
    await refreshLibrary()
    const target = postEditor?.target ?? 'workspace'
    applyPickedPost(target, item, variantIndex)
    setPostEditor(null)
  }

  const runSelected = async () => {
    if (!canRun || !pageTabId || !canonical) return
    setBusy(true); setError(null); setLastResults([])
    try {
      const response = await window.pageWallFinite.runNow({ pageTabId, accountIds: selectedRunnable, accountConcurrency, content: canonical.content, imagePaths: [], canonicalPost: canonical })
      setLastResults(response.results)
      const next = await window.pageAuto.getPageTab({ id: pageTabId }); if (next) setConfig(next)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  const openAddSchedule = () => setScheduleDraft({
    planIds: [], scheduleKind: 'daily', localDate: localDateInput(), times: ['08:00'],
    accountIds: [...selectedRunnable], accountConcurrency, post: canonical ? { postId: canonical.postId, postName: canonical.postName, variantIndex: canonical.variantIndex } : null
  })
  const openEditSchedule = (group: ScheduleGroup) => {
    const source = group.source
    if (!group.editable || source?.kind !== 'canonical') return
    const item = libraryItems.find((candidate) => canonicalPostId(candidate) === source.postId)
    setScheduleDraft({
      planIds: group.planIds,
      scheduleKind: group.scheduleKind,
      localDate: group.localDate ?? localDateInput(),
      times: group.minutes.map(minuteToTime),
      accountIds: group.accountIds,
      accountConcurrency: group.accountConcurrency,
      post: { postId: source.postId, postName: item?.name ?? `Post #${source.postId}`, variantIndex: source.variantIndex }
    })
  }
  const saveSchedule = async () => {
    if (!pageTabId || !scheduleDraft?.post || !scheduleDraft.accountIds.length) return
    setBusy(true); setError(null)
    try {
      const minuteOfDays = normalizePageWallScheduleMinutes(scheduleDraft.times.map(timeToMinute))
      const source: PageWallPlanPostSource = { kind: 'canonical', postId: scheduleDraft.post.postId, variantIndex: scheduleDraft.post.variantIndex }
      const tasks = buildPageWallFiniteTasks({ accountIds: scheduleDraft.accountIds, taskCount: scheduleDraft.accountIds.length, source })
      await window.pageWallFinite.saveSchedule({
        planIds: scheduleDraft.planIds,
        input: { pageTabId, scheduleKind: scheduleDraft.scheduleKind, localDate: scheduleDraft.scheduleKind === 'specific_date' ? scheduleDraft.localDate : null, minuteOfDays, accountConcurrency: scheduleDraft.accountConcurrency, tasks, enabled: true }
      })
      setScheduleDraft(null)
      await refreshDashboard(pageTabId)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const deleteSchedule = async (group: ScheduleGroup) => {
    if (!pageTabId || !window.confirm(`Xóa lịch ${group.minutes.map(minuteToTime).join(', ')}?`)) return
    try { await window.pageWallFinite.deleteSchedule({ planIds: group.planIds }); await refreshDashboard(pageTabId) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const selectedItem = canonical ? libraryItems.find((item) => canonicalPostId(item) === canonical.postId) ?? null : null
  const sourceLabel = (source: PageWallPlanPostSource | null): string => {
    if (!source) return 'Không rõ bài'
    if (source.kind === 'manual') return 'Bài nhập tay (legacy)'
    const item = libraryItems.find((candidate) => canonicalPostId(candidate) === source.postId)
    return `#${source.postId} · ${item?.name ?? 'Bài thư viện'} · BT ${source.variantIndex + 1}`
  }

  if (!config) return <section className="page-wall-workspace page-wall-empty"><strong>{tabs.length ? 'Đang tải Đăng Tường…' : 'Chưa có Page'}</strong></section>

  return <section className="page-wall-workspace page-wall-finite" role="tabpanel" aria-label="Đăng Tường Page">
    {!scoped ? <div className="page-wall-standalone"><select value={pageTabId ?? ''} onChange={(event) => setPageTabId(Number(event.target.value))}>{tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name} · {tab.pageUid}</option>)}</select></div> : null}
    {error ? <div className="page-tab-error page-wall-error">{error}</div> : null}
    <header className="page-wall-finite-head"><div><p className="eyebrow">Đăng Tường</p><h2>{config.name}</h2><span>Page UID: {config.pageUid}</span></div><div className="page-wall-head-state"><b>{selectedRunnable.length}</b><span>TK đã chọn</span></div></header>

    <div className="page-wall-three-regions" data-testid="page-wall-three-regions">
      <section className="pt-panel page-wall-region accounts" data-testid="page-wall-region-accounts">
        <div className="page-wall-region-head"><div><p className="eyebrow">1 · TÀI KHOẢN</p><h3>Chọn tài khoản chạy</h3></div><span>{selectedRunnable.length}/{runnableIds.length}</span></div>
        <div className="page-wall-account-table-wrap"><table className="page-wall-account-table"><thead><tr><th></th><th>#</th><th>UID</th><th>Tên</th><th>Trạng thái</th></tr></thead><tbody>{accounts.map((account, index) => { const runnable = isWallAccountSelectable(account); const selected = selectedIds.includes(account.accountId); return <tr key={account.accountId} data-account-id={account.accountId} className={`${selected ? 'selected' : ''} ${!runnable ? 'disabled' : ''}`} onClick={() => { if (runnable && !busy) toggleAccount(account.accountId) }}><td><input type="checkbox" aria-label={`Chọn ${account.uid}`} disabled={!runnable || busy} checked={selected} onClick={(event) => event.stopPropagation()} onChange={() => toggleAccount(account.accountId)} /></td><td>{index + 1}</td><td><b>{account.uid}</b></td><td>{account.name || '—'}</td><td><span className={`status-${account.status}`}>{account.status}</span></td></tr> })}</tbody></table></div>
        <div className="page-wall-account-controls" data-testid="page-wall-account-controls"><div><button type="button" disabled={busy} onClick={() => setSelectedIds(runnableIds)}>Chọn tất cả</button><button type="button" disabled={busy} onClick={() => setSelectedIds([])}>Bỏ chọn</button></div><label><span>TK chạy song song</span><input type="number" min={1} max={20} value={accountConcurrency} disabled={busy} onChange={(event) => setAccountConcurrency(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label></div>
      </section>

      <section className="pt-panel page-wall-region content" data-testid="page-wall-region-content">
        <div className="page-wall-region-head"><div><p className="eyebrow">2 · BÀI VIẾT</p><h3>Bài đang chọn</h3></div></div>
        <div className={`page-wall-selected-post ${canonical ? 'ready' : 'empty'}`} data-testid="page-wall-selected-post"><div><small>{canonical ? 'ĐÃ CHỌN' : 'CHƯA CHỌN BÀI'}</small><strong>{canonical ? `#${canonical.postId} · ${canonical.postName}` : 'Chọn một bài trước khi chạy'}</strong><span>{canonical ? `Biến thể ${canonical.variantIndex + 1} · ${canonical.image.folderPath ? `${canonical.image.imagesPerPost} ảnh/lượt` : 'Không ảnh'}` : 'Bài được dùng cho Đăng ngay; lịch sẽ tự snapshot bài riêng.'}</span></div><div className="page-wall-post-actions"><button className="pt-button secondary" type="button" disabled={busy} onClick={() => void chooseFromLibrary('workspace')}>Chọn từ Thư viện</button><button type="button" disabled={busy} onClick={() => openPostEditor('workspace', true)}>Thêm bài</button><button type="button" disabled={busy || !canonical || !selectedItem} onClick={() => openPostEditor('workspace', false)}>Sửa bài</button><button type="button" disabled={busy || !canonical} onClick={() => setCanonical(null)}>Bỏ chọn</button></div></div>
        {canonical ? <div className="page-wall-post-preview"><p>{canonical.content || 'Bài chỉ có ảnh.'}</p>{canonical.image.folderPath ? <small>Folder ảnh: {canonical.image.folderPath}</small> : <small>Không dùng ảnh.</small>}</div> : <div className="page-wall-post-empty"><b>1.</b><span>Bấm <strong>Chọn từ Thư viện</strong> để dùng bài có sẵn, hoặc <strong>Thêm bài</strong> để tạo bài mới vào thư viện chung.</span></div>}
      </section>

      <section className="pt-panel page-wall-region control" data-testid="page-wall-region-control">
        <div className="page-wall-mode-tabs"><button type="button" className={mode === 'now' ? 'active' : ''} onClick={() => setMode('now')}>Đăng ngay</button><button type="button" className={mode === 'schedule' ? 'active' : ''} onClick={() => setMode('schedule')}>Lịch chạy</button></div>
        {mode === 'now' ? <div className="page-wall-now-panel"><div className="page-wall-now-summary"><strong>Chạy đúng các TK đang tick</strong><span>{selectedRunnable.length} TK · {canonical ? `#${canonical.postId} ${canonical.postName}` : 'chưa chọn bài'} · song song {accountConcurrency}</span>{runBlockedReason ? <em>{runBlockedReason}</em> : null}</div><button className="pt-button primary page-wall-run-button" type="button" disabled={!canRun} onClick={() => void runSelected()}>{busy ? 'Đang chạy…' : '▶ Bắt đầu đăng'}</button><div className="page-wall-runtime-results">{lastResults.map((result) => <div key={result.accountId} className={`result-${resultTone(result)}`}><b>ACC#{result.accountId}</b><span>{result.message}</span></div>)}{!lastResults.length ? <p>Chưa có lượt chạy trong phiên UI này.</p> : null}</div></div> : null}
        {mode === 'schedule' ? <div className="page-wall-schedule-panel"><div className="page-wall-schedule-toolbar"><div><strong>Lịch đã lưu</strong><span>Mỗi lịch tự giữ bài + tài khoản + ngày/giờ + concurrency.</span></div><button className="pt-button primary" type="button" disabled={busy} onClick={openAddSchedule}>+ Thêm lịch</button></div><div className="page-wall-plan-list" data-testid="page-wall-plan-list">{scheduleGroups.map((group) => <div key={group.key} className={`page-wall-plan-row status-${group.status}`}><i></i><div className="page-wall-plan-copy"><strong>{group.scheduleKind === 'daily' ? 'Mỗi ngày' : group.localDate} · {group.minutes.map(minuteToTime).join(', ')}</strong><span>{sourceLabel(group.source)} · {group.accountIds.length} TK · SS {group.accountConcurrency}</span></div><b>{statusText(group.status)}</b><button type="button" disabled={!group.editable || group.source?.kind !== 'canonical'} title={group.editable ? 'Sửa lịch' : 'Lịch đã phát sinh lượt chạy; tạo lịch mới để thay đổi.'} onClick={() => openEditSchedule(group)}>Sửa</button><button type="button" aria-label={`Xóa lịch ${group.planIds.join('-')}`} onClick={() => void deleteSchedule(group)}>×</button></div>)}{!scheduleGroups.length ? <div className="page-wall-no-plans"><b>Chưa có lịch đăng</b><span>Bấm “+ Thêm lịch” rồi chọn bài, tài khoản và một hoặc nhiều giờ chạy.</span></div> : null}</div></div> : null}
      </section>
    </div>
    <footer className="page-wall-finite-footer"><span><b>Finite Wall:</b> mỗi giờ đã chọn = 1 plan-slot → occurrence → page_wall_jobs</span><span>Một lịch có thể có nhiều giờ; mỗi slot chạy đúng 1 lần/ngày.</span></footer>

    {pickerTarget ? <LibraryPicker items={libraryItems} onClose={() => setPickerTarget(null)} onPick={(item, variantIndex) => applyPickedPost(pickerTarget, item, variantIndex)} /> : null}
    {postEditor ? <PostEditorModal item={postEditor.item} variantIndex={postEditor.variantIndex} onClose={() => setPostEditor(null)} onSaved={(item, variantIndex) => void handlePostSaved(item, variantIndex)} /> : null}
    {scheduleDraft ? <ScheduleModal draft={scheduleDraft} accounts={accounts} libraryItems={libraryItems} busy={busy} onChange={setScheduleDraft} onChoosePost={() => void chooseFromLibrary('schedule')} onAddPost={() => openPostEditor('schedule', true)} onEditPost={() => openPostEditor('schedule', false)} onClose={() => setScheduleDraft(null)} onSave={() => void saveSchedule()} /> : null}
  </section>
}
