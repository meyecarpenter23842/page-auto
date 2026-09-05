import { useCallback, useEffect, useMemo, useState } from 'react'
import { CANONICAL_CONTENT_LIBRARY_SET_ID, type ContentLibraryItem } from '../../../shared/contentLibrary'
import type { PageTabConfig, PageTabSummary } from '../../../shared/pageTabs'
import type { PageWallCanonicalPostSelection, PageWallRunNowResult } from '../../../shared/pageWall'
import {
  buildPageWallFiniteTasks,
  type PageWallFiniteDashboard
} from '../../../shared/pageWallFiniteRuntime'
import type { PageWallPlanPostSource, PageWallPlanRecord, PageWallPlanStatus } from '../../../shared/pageWallPlans'
import './pageWallWorkspace.css'

export interface PageWallWorkspaceProps { activePageId?: number; scoped?: boolean }
type Mode = 'now' | 'schedule'

function fileName(path: string): string { return path.split(/[\\/]/).pop() || path }
function timeToMinute(value: string): number { const [h, m] = value.split(':').map(Number); return Math.max(0, Math.min(1439, (h || 0) * 60 + (m || 0))) }
function minuteToTime(value: number): string { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}` }
function localDateInput(): string { const now = new Date(); const shifted = new Date(now.getTime() - now.getTimezoneOffset() * 60_000); return shifted.toISOString().slice(0, 10) }
function resultTone(result: PageWallRunNowResult): string { return result.status === 'success' ? 'success' : result.status === 'needs_login' ? 'attention' : 'error' }
function statusText(status: PageWallPlanStatus): string {
  if (status === 'active') return 'Đang chờ'
  if (status === 'completed') return 'Đã chạy'
  if (status === 'disabled') return 'Tạm tắt'
  return 'Cần xử lý'
}
function planText(plan: PageWallPlanRecord): string {
  const accountCount = new Set(plan.tasks.map((task) => task.accountId)).size
  const when = plan.scheduleKind === 'daily' ? `Mỗi ngày ${minuteToTime(plan.minuteOfDay)}` : `${plan.localDate ?? '—'} ${minuteToTime(plan.minuteOfDay)}`
  return `${when} · ${accountCount} TK · ${plan.taskCount} task · song song ${plan.accountConcurrency}`
}
function canonicalPostId(item: ContentLibraryItem): number | null {
  if (item.contentSetId !== CANONICAL_CONTENT_LIBRARY_SET_ID || !Number.isSafeInteger(item.id) || item.id >= 0) return null
  return Math.abs(item.id)
}

function LibraryPicker({ items, onClose, onPick }: { items: ContentLibraryItem[]; onClose: () => void; onPick: (item: ContentLibraryItem, variantIndex: number) => void }) {
  const [query, setQuery] = useState('')
  const [variants, setVariants] = useState<Record<number, number>>({})
  const filtered = items.filter((item) => !query.trim() || [item.name, ...item.variants].join(' ').toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi')))
  return <div className="page-wall-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="page-wall-library" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><div><small>THƯ VIỆN BÀI VIẾT CHUNG</small><h3>Chọn bài cho Đăng Tường</h3></div><button type="button" onClick={onClose}>×</button></header><input className="page-wall-library-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm bài…" /><div className="page-wall-library-list">{filtered.map((item) => { const postId = canonicalPostId(item); const variantIndex = Math.min(variants[item.id] ?? 0, Math.max(0, item.variants.length - 1)); const blocked = item.image.folderPath.trim() && item.image.mode === 'filename_match'; return <article key={item.id}><div><strong>{item.name}</strong><p>{item.variants[variantIndex] || (item.image.folderPath ? 'Bài chỉ có ảnh' : 'Không có nội dung')}</p><small>{postId ? `Post #${postId}` : 'Không có canonical id'} · {item.image.folderPath ? `${item.image.imagesPerPost} ảnh` : 'Không ảnh'}</small></div><div>{item.variants.length > 1 ? <select value={variantIndex} onChange={(event) => setVariants((current) => ({ ...current, [item.id]: Number(event.target.value) }))}>{item.variants.map((_value, index) => <option key={index} value={index}>Biến thể {index + 1}</option>)}</select> : null}<button className="pt-button primary" type="button" disabled={!postId || Boolean(blocked)} onClick={() => onPick(item, variantIndex)}>Chọn</button></div></article> })}</div></section></div>
}

export function PageWallWorkspace({ activePageId: controlledPageId, scoped = false }: PageWallWorkspaceProps = {}) {
  const [tabs, setTabs] = useState<PageTabSummary[]>([])
  const [pageTabId, setPageTabId] = useState<number | null>(controlledPageId ?? null)
  const [config, setConfig] = useState<PageTabConfig | null>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [accountConcurrency, setAccountConcurrency] = useState(1)
  const [content, setContent] = useState('')
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [canonical, setCanonical] = useState<PageWallCanonicalPostSelection | null>(null)
  const [mode, setMode] = useState<Mode>('now')
  const [dashboard, setDashboard] = useState<PageWallFiniteDashboard>({ plans: [], jobs: [] })
  const [scheduleKind, setScheduleKind] = useState<'specific_date' | 'daily'>('daily')
  const [localDate, setLocalDate] = useState(localDateInput)
  const [scheduleTime, setScheduleTime] = useState('08:00')
  const [taskCount, setTaskCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResults, setLastResults] = useState<PageWallRunNowResult[]>([])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryItems, setLibraryItems] = useState<ContentLibraryItem[]>([])

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

  useEffect(() => {
    if (!pageTabId) { setConfig(null); setDashboard({ plans: [], jobs: [] }); return }
    let cancelled = false
    void window.pageAuto.getPageTab({ id: pageTabId }).then((next) => {
      if (cancelled) return
      setConfig(next)
      const runnable = (next?.accounts ?? []).filter((account) => account.enabled && account.status !== 'disabled').sort((a, b) => a.sortOrder - b.sortOrder)
      setSelectedIds(runnable.map((account) => account.accountId))
      setLastResults([])
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
    void refreshDashboard(pageTabId)
    const timer = window.setInterval(() => void refreshDashboard(pageTabId, true), 3_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [pageTabId, refreshDashboard])

  const accounts = useMemo(() => [...(config?.accounts ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [config])
  const runnableIds = useMemo(() => accounts.filter((account) => account.enabled && account.status !== 'disabled').map((account) => account.accountId), [accounts])
  const selectedRunnable = selectedIds.filter((id) => runnableIds.includes(id))
  const materialReady = Boolean(canonical?.content.trim() || canonical?.image.folderPath.trim() || content.trim() || imagePaths.length)
  const canRun = Boolean(pageTabId && selectedRunnable.length && materialReady && !busy)

  const toggleAccount = (accountId: number) => setSelectedIds((current) => current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId])
  const openLibrary = async () => {
    setError(null)
    try { const library = await window.pageAuto.getContentLibrary({ id: CANONICAL_CONTENT_LIBRARY_SET_ID }); setLibraryItems(library?.items ?? []); setLibraryOpen(true) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const pickCanonical = (item: ContentLibraryItem, variantIndex: number) => {
    const postId = canonicalPostId(item); if (!postId) return
    const selection: PageWallCanonicalPostSelection = { postId, postName: item.name, variantIndex, content: item.variants[variantIndex] ?? '', image: { ...item.image } }
    setCanonical(selection); setContent(selection.content); setImagePaths([]); setLibraryOpen(false)
  }
  const pickImages = async () => {
    const picked = await window.pageAuto.pickPageWallImages(); if (!picked.length) return
    setCanonical(null); setImagePaths(picked)
  }
  const runSelected = async () => {
    if (!canRun || !pageTabId) return
    setBusy(true); setError(null); setLastResults([])
    try {
      const response = await window.pageWallFinite.runNow({ pageTabId, accountIds: selectedRunnable, accountConcurrency, content, imagePaths, ...(canonical ? { canonicalPost: canonical } : {}) })
      setLastResults(response.results)
      const next = await window.pageAuto.getPageTab({ id: pageTabId }); if (next) setConfig(next)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const currentSource = (): PageWallPlanPostSource => canonical
    ? { kind: 'canonical', postId: canonical.postId, variantIndex: canonical.variantIndex }
    : { kind: 'manual', content, imagePaths: [...imagePaths] }
  const savePlan = async () => {
    if (!pageTabId || !selectedRunnable.length || !materialReady) return
    setBusy(true); setError(null)
    try {
      await window.pageWallFinite.savePlan({ input: { pageTabId, scheduleKind, localDate: scheduleKind === 'specific_date' ? localDate : null, minuteOfDay: timeToMinute(scheduleTime), accountConcurrency, tasks: buildPageWallFiniteTasks({ accountIds: selectedRunnable, taskCount, source: currentSource() }), enabled: true } })
      await refreshDashboard(pageTabId)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const deletePlan = async (planId: number) => {
    if (!pageTabId || !window.confirm('Xóa kế hoạch này? Các job/occurrence đã chạy vẫn giữ audit theo DB.')) return
    try { await window.pageWallFinite.deletePlan({ planId }); await refreshDashboard(pageTabId) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  if (!config) return <section className="page-wall-workspace page-wall-empty"><strong>{tabs.length ? 'Đang tải Đăng Tường…' : 'Chưa có Page'}</strong></section>

  return <section className="page-wall-workspace page-wall-finite" role="tabpanel" aria-label="Đăng Tường Page">
    {!scoped ? <div className="page-wall-standalone"><select value={pageTabId ?? ''} onChange={(event) => setPageTabId(Number(event.target.value))}>{tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name} · {tab.pageUid}</option>)}</select></div> : null}
    {error ? <div className="page-tab-error page-wall-error">{error}</div> : null}
    <header className="page-wall-finite-head"><div><p className="eyebrow">Đăng Tường</p><h2>{config.name}</h2><span>Page UID: {config.pageUid}</span></div><div className="page-wall-head-state"><b>{selectedRunnable.length}</b><span>TK đã chọn</span></div></header>

    <div className="page-wall-three-regions" data-testid="page-wall-three-regions">
      <section className="pt-panel page-wall-region accounts" data-testid="page-wall-region-accounts">
        <div className="page-wall-region-head"><div><p className="eyebrow">1 · TÀI KHOẢN</p><h3>Chọn tài khoản chạy</h3></div><span>{selectedRunnable.length}/{runnableIds.length}</span></div>
        <div className="page-wall-account-table-wrap"><table className="page-wall-account-table"><thead><tr><th></th><th>#</th><th>UID</th><th>Tên</th><th>Trạng thái</th></tr></thead><tbody>{accounts.map((account, index) => { const runnable = account.enabled && account.status !== 'disabled'; return <tr key={account.accountId} className={!runnable ? 'disabled' : ''}><td><input type="checkbox" aria-label={`Chọn ${account.uid}`} disabled={!runnable || busy} checked={selectedIds.includes(account.accountId)} onChange={() => toggleAccount(account.accountId)} /></td><td>{index + 1}</td><td><b>{account.uid}</b></td><td>{account.name || '—'}</td><td><span className={`status-${account.status}`}>{account.status}</span></td></tr> })}</tbody></table></div>
        <div className="page-wall-account-controls" data-testid="page-wall-account-controls"><div><button type="button" disabled={busy} onClick={() => setSelectedIds(runnableIds)}>Chọn tất cả</button><button type="button" disabled={busy} onClick={() => setSelectedIds([])}>Bỏ chọn</button></div><label><span>TK chạy song song</span><input type="number" min={1} max={20} value={accountConcurrency} disabled={busy} onChange={(event) => setAccountConcurrency(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label></div>
      </section>

      <section className="pt-panel page-wall-region content" data-testid="page-wall-region-content">
        <div className="page-wall-region-head"><div><p className="eyebrow">2 · BÀI VIẾT</p><h3>Nội dung & ảnh</h3></div><button className="pt-button secondary" type="button" disabled={busy} onClick={() => void openLibrary()}>Chọn từ Thư viện</button></div>
        {canonical ? <div className="page-wall-canonical-chip"><span>CANONICAL</span><b>#{canonical.postId} · {canonical.postName}</b><button type="button" onClick={() => setCanonical(null)}>Nhập tay</button></div> : null}
        <textarea value={content} disabled={busy} onChange={(event) => { setCanonical(null); setContent(event.target.value) }} placeholder="Nhập nội dung bài đăng…" />
        <div className="page-wall-media-bar"><button className="pt-button secondary" type="button" disabled={busy} onClick={() => void pickImages()}>+ Chọn ảnh</button><button className="pt-button secondary" type="button" disabled={busy || (!imagePaths.length && !canonical?.image.folderPath)} onClick={() => { setCanonical(null); setImagePaths([]) }}>Bỏ ảnh</button><span>{canonical?.image.folderPath ? `${canonical.image.imagesPerPost} ảnh từ folder canonical` : `${imagePaths.length} ảnh tay`}</span></div>
        <div className="page-wall-file-list">{imagePaths.slice(0, 8).map((path, index) => <span key={`${path}-${index}`} title={path}>{index + 1}. {fileName(path)}</span>)}{imagePaths.length > 8 ? <span>+{imagePaths.length - 8} file</span> : null}{!imagePaths.length && !canonical?.image.folderPath ? <em>Không ảnh = bài text-only.</em> : null}</div>
      </section>

      <section className="pt-panel page-wall-region control" data-testid="page-wall-region-control">
        <div className="page-wall-mode-tabs"><button type="button" className={mode === 'now' ? 'active' : ''} onClick={() => setMode('now')}>Đăng ngay</button><button type="button" className={mode === 'schedule' ? 'active' : ''} onClick={() => setMode('schedule')}>Lịch chạy</button></div>
        {mode === 'now' ? <div className="page-wall-now-panel"><div className="page-wall-now-summary"><strong>Chạy đúng các TK đang tick</strong><span>{selectedRunnable.length} TK · rolling pool · tối đa {accountConcurrency} TK song song</span></div><button className="pt-button primary page-wall-run-button" type="button" disabled={!canRun} onClick={() => void runSelected()}>{busy ? 'Đang chạy…' : '▶ Bắt đầu đăng'}</button><div className="page-wall-runtime-results">{lastResults.map((result) => <div key={result.accountId} className={`result-${resultTone(result)}`}><b>ACC#{result.accountId}</b><span>{result.message}</span></div>)}{!lastResults.length ? <p>Chưa có lượt chạy trong phiên UI này.</p> : null}</div></div> : null}
        {mode === 'schedule' ? <div className="page-wall-schedule-panel"><div className="page-wall-plan-editor"><div className="page-wall-plan-kind"><label><input type="radio" checked={scheduleKind === 'daily'} onChange={() => setScheduleKind('daily')} /> Mỗi ngày</label><label><input type="radio" checked={scheduleKind === 'specific_date'} onChange={() => setScheduleKind('specific_date')} /> Ngày cụ thể</label></div><div className="page-wall-plan-fields">{scheduleKind === 'specific_date' ? <label><span>Ngày</span><input type="date" value={localDate} onChange={(event) => setLocalDate(event.target.value)} /></label> : null}<label><span>Giờ chạy</span><input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} /></label><label><span>Số task</span><input type="number" min={1} max={1000} value={taskCount} onChange={(event) => setTaskCount(Math.max(1, Math.min(1000, Number(event.target.value) || 1)))} /></label><label><span>Song song</span><input type="number" min={1} max={20} value={accountConcurrency} onChange={(event) => setAccountConcurrency(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label></div><button className="pt-button primary" type="button" disabled={busy || !selectedRunnable.length || !materialReady} onClick={() => void savePlan()}>+ Lưu kế hoạch</button></div><div className="page-wall-plan-list" data-testid="page-wall-plan-list">{dashboard.plans.map((plan) => <div key={plan.id} className={`page-wall-plan-row status-${plan.status}`}><i></i><span title={planText(plan)}>{planText(plan)}</span><b>{statusText(plan.status)}</b><button type="button" aria-label={`Xóa kế hoạch ${plan.id}`} onClick={() => void deletePlan(plan.id)}>×</button></div>)}{!dashboard.plans.length ? <p>Chưa có kế hoạch. Mỗi kế hoạch đến giờ chạy đúng một lượt rồi dừng.</p> : null}</div></div> : null}
      </section>
    </div>
    <footer className="page-wall-finite-footer"><span><b>Finite Wall:</b> plan → occurrence → page_wall_jobs</span><span>Mỗi ngày = 1 occurrence/ngày, không vòng trong khung giờ.</span></footer>
    {libraryOpen ? <LibraryPicker items={libraryItems} onClose={() => setLibraryOpen(false)} onPick={pickCanonical} /> : null}
  </section>
}
