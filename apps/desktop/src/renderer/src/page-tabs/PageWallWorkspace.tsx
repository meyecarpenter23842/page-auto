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
  canEditPageWallFiniteSchedule,
  normalizePageWallScheduleMinutes,
  pageWallFiniteScheduleRuntimeState,
  pageWallWeekdayLabel,
  type PageWallFiniteDashboard,
  type PageWallFinitePlanView
} from '../../../shared/pageWallFiniteRuntime'
import type { PageWallPlanPostSource, PageWallPlanStatus } from '../../../shared/pageWallPlans'
import {
  CanonicalPostPicker,
  type CanonicalPostPickerValue
} from '../content-library/CanonicalPostPicker'
import { AccountSelectionMenu } from '../accounts/AccountSelectionMenu'
import { useExcelRowRange } from '../accounts/accountTableSelection'
import './pageWallWorkspace.css'
import './pageWallRuntimeControls.css'

export interface PageWallWorkspaceProps { activePageId?: number; scoped?: boolean }
type Mode = 'now' | 'schedule'
type PickerTarget = 'workspace' | 'schedule'
type WallAccount = PageTabConfig['accounts'][number]

const WEEKDAY_OPTIONS = [
  { value: 0, label: 'CN' },
  { value: 1, label: 'T2' },
  { value: 2, label: 'T3' },
  { value: 3, label: 'T4' },
  { value: 4, label: 'T5' },
  { value: 5, label: 'T6' },
  { value: 6, label: 'T7' }
] as const

interface PostRef {
  postId: number
  postName: string
  variantIndex: number
}

interface ScheduleDraft {
  planIds: number[]
  weekdays: number[]
  times: string[]
  accountIds: number[]
  accountConcurrency: number
  post: PostRef | null
  enabled: boolean
  hasHistory: boolean
}

interface ScheduleGroup {
  key: string
  plans: PageWallFinitePlanView[]
  planIds: number[]
  scheduleKind: 'specific_date' | 'daily'
  localDate: string | null
  weekdays: number[]
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
function isWallAccountSelectable(account: WallAccount): boolean { return account.status !== 'disabled' }
function canonicalPostId(item: ContentLibraryItem): number | null {
  if (!Number.isSafeInteger(item.id) || item.id >= 0) return null
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
    weekdays: plan.weekdays,
    accountConcurrency: plan.accountConcurrency,
    tasks: plan.tasks.map((task) => ({ accountId: task.accountId, source: sourceSignature(task.source) }))
  })
}
function groupStatus(plans: PageWallFinitePlanView[]): PageWallPlanStatus {
  if (plans.some((plan) => plan.status === 'needs_attention')) return 'needs_attention'
  if (plans.some((plan) => plan.status === 'active')) return 'active'
  if (plans.some((plan) => plan.status === 'disabled')) return 'disabled'
  if (plans.every((plan) => plan.status === 'completed')) return 'completed'
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
    const accountIds = [...new Set<number>(first.tasks.map((task) => task.accountId))]
    return {
      key,
      plans: sorted,
      planIds: sorted.map((plan) => plan.id),
      scheduleKind: first.scheduleKind,
      localDate: first.localDate,
      weekdays: [...first.weekdays],
      minutes: sorted.map((plan) => plan.minuteOfDay),
      accountIds,
      accountConcurrency: first.accountConcurrency,
      source: first.tasks[0]?.source ?? null,
      status: groupStatus(sorted),
      editable: first.scheduleKind === 'daily' && canEditPageWallFiniteSchedule(sorted)
    }
  }).sort((left, right) => {
    const leftDate = left.scheduleKind === 'daily' ? '9999-12-31' : left.localDate ?? ''
    const rightDate = right.scheduleKind === 'daily' ? '9999-12-31' : right.localDate ?? ''
    return leftDate.localeCompare(rightDate) || (left.minutes[0] ?? 0) - (right.minutes[0] ?? 0)
  })
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
  const runnableIds = runnable.map((account) => account.accountId)
  const accountRange = useExcelRowRange(runnableIds)
  const [accountMenu, setAccountMenu] = useState<{ x: number; y: number } | null>(null)
  const postItem = draft.post ? libraryItems.find((item) => canonicalPostId(item) === draft.post?.postId) ?? null : null
  const toggle = (accountId: number) => onChange({ ...draft, accountIds: draft.accountIds.includes(accountId) ? draft.accountIds.filter((id) => id !== accountId) : [...draft.accountIds, accountId] })
  const toggleWeekday = (day: number) => onChange({ ...draft, weekdays: draft.weekdays.includes(day) ? draft.weekdays.filter((value) => value !== day) : [...draft.weekdays, day].sort((a, b) => a - b) })
  const setTime = (index: number, value: string) => onChange({ ...draft, times: draft.times.map((time, current) => current === index ? value : time) })
  const rawMinutes = draft.times.map(timeToMinute)
  const uniqueMinutes = (() => { try { return normalizePageWallScheduleMinutes(rawMinutes) } catch { return [] } })()
  const timesValid = rawMinutes.every((minute) => minute >= 0) && uniqueMinutes.length === draft.times.length
  const canSave = Boolean(draft.post && draft.accountIds.length && draft.weekdays.length && timesValid && uniqueMinutes.length && !busy)
  const postSummary = draft.post ? `#${draft.post.postId} · ${draft.post.postName}` : 'Chưa chọn bài'
  const postMeta = !draft.post
    ? 'Chọn bài trước khi lưu lịch'
    : `${postItem?.variants.length || 1} biến thể · ${postItem?.image.folderPath ? `${postItem.image.imagesPerPost} ảnh/lượt · ${postItem.image.folderPath}` : 'Không ảnh'}`
  return <div className="page-wall-modal-backdrop schedule" role="presentation" onMouseDown={onClose}>
    <section className="page-wall-schedule-dialog" role="dialog" aria-modal="true" aria-label="Thiết lập lịch đăng" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><small>LỊCH ĐĂNG TƯỜNG</small><h3>{draft.planIds.length ? 'Sửa lịch đăng' : 'Hẹn giờ đăng bài'}</h3></div><button type="button" onClick={onClose}>×</button></header>
      <div className="page-wall-schedule-step"><b>1. Chọn bài viết</b><div className={`page-wall-selected-post compact ${draft.post ? 'ready' : 'empty'}`}><div><small>BÀI ĐANG CHỌN</small><strong>{postSummary}</strong><span>{postMeta}</span></div><div><button className="pt-button secondary" type="button" onClick={onChoosePost}>Chọn</button><button type="button" onClick={onAddPost}>Thêm</button><button type="button" disabled={!draft.post || !postItem} onClick={onEditPost}>Sửa</button></div></div></div>
      <div className="page-wall-schedule-step"><b>2. Ngày và giờ đăng bài</b><div className="page-wall-plan-kind">{WEEKDAY_OPTIONS.map((day) => <label key={day.value}><input aria-label={day.label} type="checkbox" checked={draft.weekdays.includes(day.value)} onChange={() => toggleWeekday(day.value)} /> {day.label}</label>)}</div>{!draft.weekdays.length ? <small className="page-wall-time-error">Hãy chọn ít nhất một ngày chạy.</small> : null}<div className="page-wall-time-list">{draft.times.map((time, index) => <div className="page-wall-time-chip" key={`${index}-${time}`}><input type="time" value={time} onChange={(event) => setTime(index, event.target.value)} /><button type="button" aria-label={`Xóa giờ ${time}`} disabled={draft.times.length === 1} onClick={() => onChange({ ...draft, times: draft.times.filter((_value, current) => current !== index) })}>×</button></div>)}<button className="page-wall-add-time" type="button" disabled={draft.times.length >= 12} onClick={() => onChange({ ...draft, times: [...draft.times, '12:00'] })}>+ Thêm giờ</button></div>{!timesValid ? <small className="page-wall-time-error">Giờ chạy phải hợp lệ và không được trùng nhau.</small> : null}</div>
      <div className="page-wall-schedule-step accounts"><div className="page-wall-step-title"><b>3. Chọn tài khoản muốn đăng</b><span>{draft.accountIds.length}/{runnable.length} TK</span></div><div className="page-wall-mini-account-tools"><button type="button" onClick={() => onChange({ ...draft, accountIds: runnable.map((account) => account.accountId) })}>Chọn tất cả</button><button type="button" onClick={() => onChange({ ...draft, accountIds: [] })}>Bỏ chọn</button><label><span>TK song song</span><input type="number" min={1} max={20} value={draft.accountConcurrency} onChange={(event) => onChange({ ...draft, accountConcurrency: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })} /></label></div><div className="page-wall-schedule-account-table"><table><thead><tr><th></th><th>UID</th><th>Tên</th><th>Trạng thái</th></tr></thead><tbody>{accounts.map((account) => { const canUse = isWallAccountSelectable(account); const selected = draft.accountIds.includes(account.accountId); const ranged = accountRange.rangeIds.has(account.accountId); return <tr key={account.accountId} className={`${selected ? 'selected ' : ''}${ranged ? 'range-row ' : ''}${!canUse ? 'disabled' : ''}`.trim()} onPointerDown={(event) => { if (canUse && !busy) accountRange.onRowPointerDown(event, account.accountId) }} onPointerEnter={() => { if (canUse && !busy) accountRange.onRowPointerEnter(account.accountId) }} onContextMenu={(event) => { if (!canUse || busy) return; event.preventDefault(); accountRange.ensureContextRow(account.accountId); setAccountMenu({ x: event.clientX, y: event.clientY }) }}><td><input type="checkbox" checked={selected} disabled={!canUse || busy} onPointerDown={(event) => event.stopPropagation()} onChange={() => toggle(account.accountId)} /></td><td><b>{account.uid}</b></td><td>{account.name || '—'}</td><td>{account.status}</td></tr> })}</tbody></table></div>{accountMenu ? <AccountSelectionMenu x={accountMenu.x} y={accountMenu.y} checkedCount={draft.accountIds.filter((id) => runnableIds.includes(id)).length} rangeCount={accountRange.rangeIds.size} totalCount={runnableIds.length} onCheckRange={() => { const next = new Set(draft.accountIds); for (const id of accountRange.rangeIds) if (runnableIds.includes(id)) next.add(id); onChange({ ...draft, accountIds: [...next] }); setAccountMenu(null) }} onCheckAll={() => { onChange({ ...draft, accountIds: [...runnableIds] }); setAccountMenu(null) }} onClearChecked={() => { onChange({ ...draft, accountIds: [] }); setAccountMenu(null) }} onDismiss={() => setAccountMenu(null)} /> : null}</div>
      {draft.hasHistory ? <small className="page-wall-history-note">Lịch đã có lượt chạy. Thay đổi chỉ áp dụng cho lượt kế tiếp; lịch sử cũ được giữ nguyên.</small> : null}
      <div className="page-wall-schedule-review"><strong>{pageWallWeekdayLabel(draft.weekdays)} · {uniqueMinutes.map(minuteToTime).join(', ') || 'Chưa có giờ'}</strong><span>{postSummary} · {draft.accountIds.length} TK · song song {draft.accountConcurrency}</span></div>
      <footer><button type="button" onClick={onClose}>Hủy</button><button className="pt-button primary" type="button" disabled={!canSave} onClick={onSave}>{busy ? 'Đang lưu…' : 'Lưu lịch'}</button></footer>
    </section>
  </div>
}

export function PageWallWorkspace({ activePageId: controlledPageId, scoped = false }: PageWallWorkspaceProps = {}) {
  const [tabs, setTabs] = useState<PageTabSummary[]>([])
  const [pageTabId, setPageTabId] = useState<number | null>(controlledPageId ?? null)
  const [config, setConfig] = useState<PageTabConfig | null>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [accountMenu, setAccountMenu] = useState<{ x: number; y: number } | null>(null)
  const [accountConcurrency, setAccountConcurrency] = useState(1)
  const [runDelaySeconds, setRunDelaySeconds] = useState(0)
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
  const accountRange = useExcelRowRange(runnableIds)
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
  const applyPostItem = (target: PickerTarget, item: ContentLibraryItem, variantIndex: number) => {
    if (target === 'workspace') {
      const selection = canonicalFromItem(item, variantIndex)
      if (selection) setCanonical(selection)
    } else {
      const ref = postRefFromItem(item, variantIndex)
      if (ref) setScheduleDraft((current) => current ? { ...current, post: ref } : current)
    }
    setPickerTarget(null)
  }
  const applyPickerSelection = (target: PickerTarget, value: CanonicalPostPickerValue) => {
    const previous = target === 'workspace' ? canonical : scheduleDraft?.post ?? null
    const previousIndex = previous?.postId === value.postId ? previous.variantIndex : 0
    const variantIndex = Math.min(Math.max(0, previousIndex), Math.max(0, value.item.variants.length - 1))
    applyPostItem(target, value.item, variantIndex)
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
    applyPostItem(target, item, variantIndex)
    setPostEditor(null)
  }

  const runSelected = async () => {
    if (!canRun || !pageTabId || !canonical) return
    setBusy(true); setError(null); setLastResults([])
    try {
      const response = await window.pageWallFinite.runNow({
        pageTabId,
        accountIds: selectedRunnable,
        accountConcurrency,
        delayBetweenRunsSec: runDelaySeconds,
        content: canonical.content,
        imagePaths: [],
        canonicalPost: canonical
      })
      setLastResults(response.results)
      const next = await window.pageAuto.getPageTab({ id: pageTabId }); if (next) setConfig(next)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  const openAddSchedule = () => setScheduleDraft({
    planIds: [], weekdays: WEEKDAY_OPTIONS.map((day) => day.value), times: ['08:00'],
    accountIds: [...selectedRunnable], accountConcurrency, post: canonical ? { postId: canonical.postId, postName: canonical.postName, variantIndex: canonical.variantIndex } : null,
    enabled: true, hasHistory: false
  })
  const openEditSchedule = (group: ScheduleGroup) => {
    const source = group.source
    if (!group.editable || group.scheduleKind !== 'daily' || source?.kind !== 'canonical') return
    const item = libraryItems.find((candidate) => canonicalPostId(candidate) === source.postId)
    setScheduleDraft({
      planIds: group.planIds,
      weekdays: [...group.weekdays],
      times: group.minutes.map(minuteToTime),
      accountIds: group.accountIds,
      accountConcurrency: group.accountConcurrency,
      post: { postId: source.postId, postName: item?.name ?? `Post #${source.postId}`, variantIndex: source.variantIndex },
      enabled: group.status !== 'disabled',
      hasHistory: group.plans.some((plan) => Boolean(plan.latestOccurrence))
    })
  }
  const saveSchedule = async () => {
    if (!pageTabId || !scheduleDraft?.post || !scheduleDraft.accountIds.length || !scheduleDraft.weekdays.length) return
    setBusy(true); setError(null)
    try {
      const minuteOfDays = normalizePageWallScheduleMinutes(scheduleDraft.times.map(timeToMinute))
      const source: PageWallPlanPostSource = { kind: 'canonical', postId: scheduleDraft.post.postId, variantIndex: scheduleDraft.post.variantIndex }
      const tasks = buildPageWallFiniteTasks({ accountIds: scheduleDraft.accountIds, taskCount: scheduleDraft.accountIds.length, source })
      await window.pageWallFinite.saveSchedule({
        planIds: scheduleDraft.planIds,
        input: { pageTabId, scheduleKind: 'daily', localDate: null, weekdays: scheduleDraft.weekdays, minuteOfDays, accountConcurrency: scheduleDraft.accountConcurrency, tasks, enabled: scheduleDraft.enabled }
      })
      setScheduleDraft(null)
      await refreshDashboard(pageTabId)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const setScheduleEnabled = async (group: ScheduleGroup, enabled: boolean) => {
    if (!pageTabId) return
    const planIds = group.plans
      .filter((plan) => enabled ? plan.status === 'disabled' : plan.status === 'active' || plan.status === 'needs_attention')
      .map((plan) => plan.id)
    if (!planIds.length) return
    setBusy(true); setError(null)
    try {
      await window.pageWallFinite.setScheduleEnabled({ pageTabId, planIds, enabled })
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
    return `#${source.postId} · ${item?.name ?? 'Bài thư viện'} · ${item?.variants.length || 1} biến thể`
  }

  if (!config) return <section className="page-wall-workspace page-wall-empty"><strong>{tabs.length ? 'Đang tải Đăng Tường…' : 'Chưa có Page'}</strong></section>

  return <section className="page-wall-workspace page-wall-finite" role="tabpanel" aria-label="Đăng Tường Page">
    {!scoped ? <div className="page-wall-standalone"><select value={pageTabId ?? ''} onChange={(event) => setPageTabId(Number(event.target.value))}>{tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name} · {tab.pageUid}</option>)}</select></div> : null}
    {error ? <div className="page-tab-error page-wall-error">{error}</div> : null}
    <header className="page-wall-finite-head"><div><p className="eyebrow">Đăng Tường</p><h2>{config.name}</h2><span>Page UID: {config.pageUid}</span></div><div className="page-wall-head-state"><b>{selectedRunnable.length}</b><span>TK đã chọn</span></div></header>

    <div className="page-wall-three-regions" data-testid="page-wall-three-regions">
      <section className="pt-panel page-wall-region accounts" data-testid="page-wall-region-accounts">
        <div className="page-wall-region-head"><div><p className="eyebrow">1 · TÀI KHOẢN</p><h3>Chọn tài khoản chạy</h3></div><span>{selectedRunnable.length}/{runnableIds.length}</span></div>
        <div className="page-wall-account-table-wrap"><table className="page-wall-account-table"><thead><tr><th></th><th>#</th><th>UID</th><th>Tên</th><th>Trạng thái</th></tr></thead><tbody>{accounts.map((account, index) => { const runnable = isWallAccountSelectable(account); const selected = selectedIds.includes(account.accountId); const ranged = accountRange.rangeIds.has(account.accountId); return <tr key={account.accountId} data-account-id={account.accountId} className={`${selected ? 'selected ' : ''}${ranged ? 'range-row ' : ''}${!runnable ? 'disabled' : ''}`.trim()} onPointerDown={(event) => { if (runnable && !busy) accountRange.onRowPointerDown(event, account.accountId) }} onPointerEnter={() => { if (runnable && !busy) accountRange.onRowPointerEnter(account.accountId) }} onContextMenu={(event) => { if (!runnable || busy) return; event.preventDefault(); accountRange.ensureContextRow(account.accountId); setAccountMenu({ x: event.clientX, y: event.clientY }) }}><td><input type="checkbox" aria-label={`Chọn ${account.uid}`} disabled={!runnable || busy} checked={selected} onPointerDown={(event) => event.stopPropagation()} onChange={() => toggleAccount(account.accountId)} /></td><td>{index + 1}</td><td><b>{account.uid}</b></td><td>{account.name || '—'}</td><td><span className={`status-${account.status}`}>{account.status}</span></td></tr> })}</tbody></table></div>{accountMenu ? <AccountSelectionMenu x={accountMenu.x} y={accountMenu.y} checkedCount={selectedRunnable.length} rangeCount={accountRange.rangeIds.size} totalCount={runnableIds.length} onCheckRange={() => { setSelectedIds((current) => [...new Set([...current, ...[...accountRange.rangeIds].filter((id) => runnableIds.includes(id))])]); setAccountMenu(null) }} onCheckAll={() => { setSelectedIds(runnableIds); setAccountMenu(null) }} onClearChecked={() => { setSelectedIds([]); setAccountMenu(null) }} onDismiss={() => setAccountMenu(null)} /> : null}
        <div className="page-wall-account-controls" data-testid="page-wall-account-controls"><div><button type="button" disabled={busy} onClick={() => setSelectedIds(runnableIds)}>Chọn tất cả</button><button type="button" disabled={busy} onClick={() => setSelectedIds([])}>Bỏ chọn</button></div><label><span>TK chạy song song</span><input type="number" min={1} max={20} value={accountConcurrency} disabled={busy} onChange={(event) => setAccountConcurrency(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label></div>
      </section>

      <section className="pt-panel page-wall-region content" data-testid="page-wall-region-content">
        <div className="page-wall-region-head"><div><p className="eyebrow">2 · BÀI VIẾT</p><h3>Bài đang chọn</h3></div></div>
        <div className={`page-wall-selected-post ${canonical ? 'ready' : 'empty'}`} data-testid="page-wall-selected-post"><div><small>{canonical ? 'ĐÃ CHỌN' : 'CHƯA CHỌN BÀI'}</small><strong>{canonical ? `#${canonical.postId} · ${canonical.postName}` : 'Chọn một bài trước khi chạy'}</strong><span>{canonical ? `${selectedItem?.variants.length || 1} biến thể · ${canonical.image.folderPath ? `${canonical.image.imagesPerPost} ảnh/lượt` : 'Không ảnh'}` : 'Bài được dùng cho Đăng ngay; lịch sẽ tự snapshot bài riêng.'}</span></div><div className="page-wall-post-actions"><button className="pt-button secondary" type="button" disabled={busy} onClick={() => void chooseFromLibrary('workspace')}>Chọn từ Thư viện</button><button type="button" disabled={busy} onClick={() => openPostEditor('workspace', true)}>Thêm bài</button><button type="button" disabled={busy || !canonical || !selectedItem} onClick={() => openPostEditor('workspace', false)}>Sửa bài</button><button type="button" disabled={busy || !canonical} onClick={() => setCanonical(null)}>Bỏ chọn</button></div></div>
        {canonical ? <div className="page-wall-post-preview"><p>{canonical.content || 'Bài chỉ có ảnh.'}</p>{canonical.image.folderPath ? <small>Folder ảnh: {canonical.image.folderPath}</small> : <small>Không dùng ảnh.</small>}</div> : <div className="page-wall-post-empty"><b>1.</b><span>Bấm <strong>Chọn từ Thư viện</strong> để dùng bài có sẵn, hoặc <strong>Thêm bài</strong> để tạo bài mới vào thư viện chung.</span></div>}
      </section>

      <section className="pt-panel page-wall-region control" data-testid="page-wall-region-control">
        <div className="page-wall-mode-tabs"><button type="button" className={mode === 'now' ? 'active' : ''} onClick={() => setMode('now')}>Đăng ngay</button><button type="button" className={mode === 'schedule' ? 'active' : ''} onClick={() => setMode('schedule')}>Lịch chạy</button></div>
        {mode === 'now' ? <div className="page-wall-now-panel"><div className="page-wall-now-summary"><strong>Chạy đúng các TK đang tick</strong><span>{selectedRunnable.length} TK · {canonical ? `#${canonical.postId} ${canonical.postName}` : 'chưa chọn bài'} · song song {accountConcurrency} · delay {runDelaySeconds}s</span>{runBlockedReason ? <em>{runBlockedReason}</em> : null}</div><div className="page-wall-now-options"><label><span>Delay giữa lượt đăng</span><div><input aria-label="Delay giữa lượt Đăng ngay" type="number" min={0} max={3600} value={runDelaySeconds} disabled={busy} onChange={(event) => setRunDelaySeconds(Math.max(0, Math.min(3600, Number(event.target.value) || 0)))} /><small>giây</small></div></label><small>Lượt đầu chạy ngay; các lượt sau cách nhau ít nhất số giây này. Chỉ áp dụng Đăng ngay.</small></div><button className="pt-button primary page-wall-run-button" type="button" disabled={!canRun} onClick={() => void runSelected()}>{busy ? 'Đang chạy…' : '▶ Bắt đầu đăng'}</button><div className="page-wall-runtime-results">{lastResults.map((result) => <div key={result.accountId} className={`result-${resultTone(result)}`}><b>ACC#{result.accountId}</b><span>{result.message}</span></div>)}{!lastResults.length ? <p>Chưa có lượt chạy trong phiên UI này.</p> : null}</div></div> : null}
        {mode === 'schedule' ? <div className="page-wall-schedule-panel"><div className="page-wall-schedule-toolbar"><div><strong>Lịch đã lưu</strong><span>Mỗi lịch tự giữ bài + tài khoản + thứ/ngày chạy + giờ + concurrency.</span></div><button className="pt-button primary" type="button" disabled={busy} onClick={openAddSchedule}>+ Thêm lịch</button></div><div className="page-wall-plan-list" data-testid="page-wall-plan-list">{scheduleGroups.map((group) => {
          const runtime = pageWallFiniteScheduleRuntimeState(group.plans, localDateInput())
          const pausable = group.plans.some((plan) => plan.status === 'active' || plan.status === 'needs_attention')
          const resumable = !pausable && group.plans.some((plan) => plan.status === 'disabled')
          const legacyDate = group.scheduleKind === 'specific_date'
          const editTitle = legacyDate ? 'Lịch ngày cụ thể cũ được giữ nguyên, không chuyển ngầm sang lịch tuần.' : group.source?.kind !== 'canonical' ? 'Lịch legacy không hỗ trợ sửa bài canonical.' : !group.editable ? 'Lịch đang có lượt chạy; chờ kết thúc rồi sửa.' : 'Sửa lịch'
          const scheduleLabel = legacyDate ? `Lịch cũ · ${group.localDate}` : pageWallWeekdayLabel(group.weekdays)
          return <div key={group.key} className={`page-wall-plan-row runtime-${runtime.tone}`}><i></i><div className="page-wall-plan-copy"><strong>{scheduleLabel} · {group.minutes.map(minuteToTime).join(', ')}</strong><span>{sourceLabel(group.source)} · {group.accountIds.length} TK · SS {group.accountConcurrency}</span></div><b>{runtime.label}</b>{pausable || resumable ? <button className={`page-wall-plan-toggle ${resumable ? 'resume' : 'pause'}`} type="button" disabled={busy} onClick={() => void setScheduleEnabled(group, resumable)}>{resumable ? 'Bắt đầu' : 'Tạm dừng'}</button> : <span className="page-wall-plan-toggle-spacer"></span>}<button type="button" disabled={!group.editable || group.source?.kind !== 'canonical' || busy} title={editTitle} onClick={() => openEditSchedule(group)}>Sửa</button><button type="button" aria-label={`Xóa lịch ${group.planIds.join('-')}`} disabled={busy} onClick={() => void deleteSchedule(group)}>×</button></div>
        })}{!scheduleGroups.length ? <div className="page-wall-no-plans"><b>Chưa có lịch đăng</b><span>Bấm “+ Thêm lịch” rồi chọn bài, tài khoản, ngày trong tuần và một hoặc nhiều giờ chạy.</span></div> : null}</div></div> : null}
      </section>
    </div>
    <footer className="page-wall-finite-footer"><span><b>Finite Wall:</b> mỗi giờ đã chọn = 1 plan-slot → occurrence → page_wall_jobs</span><span>Mỗi slot chạy tối đa 1 lần trong từng ngày đã chọn.</span></footer>

    {pickerTarget ? <CanonicalPostPicker mode="single" title={pickerTarget === 'schedule' ? 'Chọn bài cho lịch Đăng Tường' : 'Chọn bài cho Đăng Tường'} getDisabledReason={(item) => item.image.folderPath.trim() && item.image.mode === 'filename_match' ? 'Không hỗ trợ ảnh khớp Group' : null} onClose={() => setPickerTarget(null)} onApply={(values) => { const value = values[0]; if (value) applyPickerSelection(pickerTarget, value) }} /> : null}
    {postEditor ? <PostEditorModal item={postEditor.item} variantIndex={postEditor.variantIndex} onClose={() => setPostEditor(null)} onSaved={(item, variantIndex) => void handlePostSaved(item, variantIndex)} /> : null}
    {scheduleDraft ? <ScheduleModal draft={scheduleDraft} accounts={accounts} libraryItems={libraryItems} busy={busy} onChange={setScheduleDraft} onChoosePost={() => void chooseFromLibrary('schedule')} onAddPost={() => openPostEditor('schedule', true)} onEditPost={() => openPostEditor('schedule', false)} onClose={() => setScheduleDraft(null)} onSave={() => void saveSchedule()} /> : null}
  </section>
}
