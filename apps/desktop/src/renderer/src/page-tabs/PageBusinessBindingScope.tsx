import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AccountStatus } from '../../../shared/accounts'
import type { ActionWorkspaceRecord } from '../../../shared/actionWorkspaces'
import {
  pageBusinessPageIdOf,
  pageBusinessTypeOf,
  serializePageBusinessBindingConfig,
  type GenericPageBusinessType
} from '../../../shared/pageBusinessBindings'
import type { PageTabConfig, PageTabSummary } from '../../../shared/pageTabs'
import type { PageWallJobRecord, PageWallJobStatus } from '../../../shared/pageWallJobs'
import { accountStatusLabels } from '../accounts/accountManagerModel'
import { PageTabsManager } from './PageTabsManagerV2'
import { PageWallWorkspace } from './PageWallWorkspace'
import './pageBusinessBindings.css'
import './pageWallGroupLayout.css'

interface BindingRecord {
  workspace: ActionWorkspaceRecord
  pageTabId: number
}

export interface PageBusinessBindingContext {
  activePage: PageTabSummary
  allPages: PageTabSummary[]
}

interface PageBusinessBindingScopeProps {
  businessType: GenericPageBusinessType
  label: string
  children: (context: PageBusinessBindingContext) => ReactNode
}

function PagePicker({ pages, boundIds, label, onClose, onAdd }: {
  pages: PageTabSummary[]
  boundIds: Set<number>
  label: string
  onClose: () => void
  onAdd: (page: PageTabSummary) => Promise<void>
}) {
  const available = pages.filter((page) => !boundIds.has(page.id))
  const [selectedId, setSelectedId] = useState<number | null>(available[0]?.id ?? null)
  const [busy, setBusy] = useState(false)
  return <div className="page-business-picker-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="page-business-picker" role="dialog" aria-modal="true" aria-label={`Thêm Page vào ${label}`} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span>{label.toUpperCase()}</span><strong>Thêm Page</strong></div><button type="button" onClick={onClose}>×</button></header>
      <p>Chỉ Page được thêm tại đây mới xuất hiện trong nghiệp vụ này. Quản lý Page vẫn là kho Page gốc.</p>
      <div className="page-business-picker-list">
        {available.map((page) => <label key={page.id} className={selectedId === page.id ? 'selected' : ''}>
          <input type="radio" name={`page-business-${label}`} checked={selectedId === page.id} onChange={() => setSelectedId(page.id)} />
          <b>{page.name}</b><small>{page.pageUid}</small><span>{page.accountCount} TK</span>
        </label>)}
        {!available.length ? <div className="page-business-picker-empty">Tất cả Page trong Quản lý Page đã được thêm vào tab này.</div> : null}
      </div>
      <footer><button type="button" onClick={onClose}>Hủy</button><button className="primary" type="button" disabled={busy || selectedId === null} onClick={() => {
        const page = available.find((item) => item.id === selectedId)
        if (!page) return
        setBusy(true)
        void onAdd(page).finally(() => setBusy(false))
      }}>{busy ? 'Đang thêm…' : 'Thêm Page'}</button></footer>
    </section>
  </div>
}

export function PageBusinessBindingScope({ businessType, label, children }: PageBusinessBindingScopeProps) {
  const [pages, setPages] = useState<PageTabSummary[]>([])
  const [bindings, setBindings] = useState<BindingRecord[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (preferredWorkspaceId?: number) => {
    const [nextPages, workspaces] = await Promise.all([
      window.pageAuto.listPageTabs(),
      window.pageAuto.listActionWorkspaces()
    ])
    const nextBindings = workspaces.flatMap((workspace): BindingRecord[] => {
      if (pageBusinessTypeOf(workspace) !== businessType) return []
      const pageTabId = pageBusinessPageIdOf(workspace)
      return pageTabId ? [{ workspace, pageTabId }] : []
    }).sort((left, right) => left.workspace.id - right.workspace.id)
    setPages(nextPages)
    setBindings(nextBindings)
    setActiveWorkspaceId((current) => {
      const wanted = preferredWorkspaceId ?? current
      return wanted && nextBindings.some((item) => item.workspace.id === wanted)
        ? wanted
        : nextBindings[0]?.workspace.id ?? null
    })
    setError(null)
  }, [businessType])

  useEffect(() => {
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [refresh])

  const activeBinding = bindings.find((item) => item.workspace.id === activeWorkspaceId) ?? null
  const activePage = activeBinding ? pages.find((page) => page.id === activeBinding.pageTabId) ?? null : null
  const boundIds = useMemo(() => new Set(bindings.map((item) => item.pageTabId)), [bindings])

  const addPage = async (page: PageTabSummary) => {
    try {
      const created = await window.pageAuto.createActionWorkspace({
        type: 'interaction',
        label: `${page.name} · ${label}`,
        configJson: serializePageBusinessBindingConfig(businessType, page.id),
        accounts: []
      })
      setPickerOpen(false)
      await refresh(created.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const removePage = async (binding: BindingRecord, page: PageTabSummary | undefined) => {
    const name = page?.name ?? `Page #${binding.pageTabId}`
    if (!window.confirm(`Bỏ “${name}” khỏi ${label}? Page gốc không bị xóa.`)) return
    try {
      await window.pageAuto.deleteActionWorkspace({ id: binding.workspace.id })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return <section className={`page-business-binding-scope business-${businessType}`}>
    <div className="page-business-page-strip">
      <div className="page-business-page-scroll">
        {bindings.map((binding) => {
          const page = pages.find((item) => item.id === binding.pageTabId)
          if (!page) return null
          return <div key={binding.workspace.id} className={binding.workspace.id === activeWorkspaceId ? 'page-business-page-chip active' : 'page-business-page-chip'} title={page.pageUid}>
            <button type="button" onClick={() => setActiveWorkspaceId(binding.workspace.id)}><strong>{page.name}</strong></button>
            <button className="remove" type="button" title={`Bỏ Page khỏi ${label}`} onClick={() => void removePage(binding, page)}>×</button>
          </div>
        })}
      </div>
      <button className="page-business-add-page" type="button" onClick={() => setPickerOpen(true)}>+ Thêm Page</button>
    </div>

    {error ? <div className="page-tab-error page-business-binding-error">{error}</div> : null}
    <div className="page-business-binding-content">
      {activePage ? children({ activePage, allPages: pages }) : <div className="page-business-binding-empty"><strong>Chưa có Page trong tab {label}</strong><span>Page trong Quản lý Page không tự xuất hiện ở đây.</span><button type="button" onClick={() => setPickerOpen(true)}>+ Thêm Page</button></div>}
    </div>
    {pickerOpen ? <PagePicker pages={pages} boundIds={boundIds} label={label} onClose={() => setPickerOpen(false)} onAdd={addPage} /> : null}
  </section>
}

function wallJobStatusLabel(status: PageWallJobStatus): string {
  if (status === 'pending') return 'Chờ chạy'
  if (status === 'running') return 'Đang chạy'
  if (status === 'success') return 'Thành công'
  if (status === 'cancelled') return 'Đã hủy'
  return 'Thất bại'
}

function wallJobPreview(job: PageWallJobRecord): string {
  const normalized = job.content.trim().replace(/\s+/g, ' ')
  if (normalized) return normalized.length > 420 ? `${normalized.slice(0, 420)}…` : normalized
  return job.imagePaths.length > 0 ? `Bài chỉ có ảnh · ${job.imagePaths.length} file` : 'Không có nội dung xem trước.'
}

function PageWallGroupLayout({ activePageId }: { activePageId: number }) {
  const [pageConfig, setPageConfig] = useState<PageTabConfig | null>(null)
  const [pageJobs, setPageJobs] = useState<PageWallJobRecord[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const [nextConfig, jobs] = await Promise.all([
          window.pageAuto.getPageTab({ id: activePageId }),
          window.pageAuto.listPageWallJobs()
        ])
        if (cancelled) return
        setPageConfig(nextConfig)
        setPageJobs(jobs.filter((job) => job.pageTabId === activePageId).sort((left, right) => right.id - left.id))
        setLoadError(null)
      } catch (cause) {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 3_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activePageId])

  const accounts = useMemo(() => [...(pageConfig?.accounts ?? [])].sort((left, right) => left.sortOrder - right.sortOrder), [pageConfig])
  const enabledCount = accounts.filter((account) => account.enabled).length
  const activeJob = pageJobs.find((job) => job.status === 'running') ?? pageJobs.find((job) => job.status === 'pending') ?? null
  const pendingCount = pageJobs.filter((job) => job.status === 'pending' || job.status === 'running').length

  const openWallTool = (label: 'Lịch đã hẹn' | 'Log') => {
    const root = document.querySelector<HTMLElement>('.business-page_wall_post .page-wall-workspace')
    const button = Array.from(root?.querySelectorAll<HTMLButtonElement>('.page-wall-secondary-tools > button') ?? [])
      .find((item) => item.textContent?.includes(label))
    button?.click()
  }

  return <div className="page-business-scoped-child ready page-wall-group-layout">
    <header className="page-tab-editor-header page-wall-page-header">
      <div><h2>{pageConfig?.name ?? 'Page'}</h2><p>Page UID: {pageConfig?.pageUid ?? '—'} · {accounts.length} tài khoản</p></div>
    </header>

    <div className="page-wall-group-left">
      <section className="pt-panel page-wall-page-accounts" aria-label="Tài khoản Page">
        <div className="pt-panel-heading">
          <div><p className="eyebrow">Tài khoản</p><h3>Danh sách Page</h3></div>
          <span className="pt-count-chip">{enabledCount}/{accounts.length} bật</span>
        </div>
        <div className="pt-account-grid-wrap page-wall-page-account-grid-wrap">
          <table className="pt-account-grid page-wall-page-account-table">
            <thead><tr><th>#</th><th>Bật</th><th>UID</th><th>Tên</th><th>Trạng thái</th><th>Thứ tự</th></tr></thead>
            <tbody>
              {accounts.map((account, index) => {
                const status = account.status as AccountStatus
                return <tr key={account.accountId}><td>{index + 1}</td><td><span className={account.enabled ? 'page-wall-account-enabled' : 'page-wall-account-disabled'}>{account.enabled ? '✓' : '—'}</span></td><td className="pt-account-uid">{account.uid}</td><td>{account.name ?? '—'}</td><td><span className={`status-text status-${status}`}>{accountStatusLabels[status] ?? status}</span></td><td>{index + 1}</td></tr>
              })}
              {accounts.length === 0 ? <tr><td colSpan={6} className="pt-account-empty">Page chưa có tài khoản.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="page-wall-page-account-note">Danh sách này chỉ hiển thị. Bật/tắt, thêm/xóa và sắp xếp tài khoản tại Quản lý Page.</div>
      </section>

      <PageWallWorkspace activePageId={activePageId} scoped />
    </div>

    <aside className="page-wall-group-right">
      <section className="pt-panel page-wall-runtime-preview" aria-label="Preview bài hiện tại">
        <div className="pt-panel-heading">
          <div><p className="eyebrow">Đang xử lý</p><h3>Preview bài hiện tại</h3></div>
          <span className="pt-count-chip">{activeJob ? wallJobStatusLabel(activeJob.status) : 'Sẵn sàng'}</span>
        </div>
        <div className="page-wall-runtime-preview-body">
          {loadError ? <div className="page-tab-error">{loadError}</div> : activeJob ? <>
            <div className="page-wall-runtime-preview-copy">{wallJobPreview(activeJob)}</div>
            <div className="page-wall-runtime-preview-meta">
              <span>Account <b>{activeJob.accountUid}</b>{activeJob.accountName ? ` · ${activeJob.accountName}` : ''}</span>
              <span>Ảnh <b>{activeJob.imagePaths.length}</b></span>
              <span>Thời gian <b>{new Date(activeJob.scheduledAt).toLocaleString('vi-VN')}</b></span>
            </div>
          </> : <div className="page-wall-runtime-preview-empty"><strong>Chưa có bài đang xử lý</strong><span>Khi có job đang chạy hoặc chờ chạy, nội dung sẽ hiện tại đây.</span></div>}
        </div>
      </section>

      <section className="pt-panel page-wall-quick-tools" aria-label="Công cụ Đăng Tường">
        <div className="page-wall-quick-title"><p className="eyebrow">Cấu hình</p><small>Mở khi cần</small></div>
        <div className="page-wall-quick-actions">
          <button className="pt-button secondary" type="button" onClick={() => openWallTool('Lịch đã hẹn')}>Lịch đã hẹn <span className="page-wall-count">{pendingCount}</span></button>
          <button className="pt-button secondary" type="button" onClick={() => openWallTool('Log')}>Log</button>
        </div>
      </section>
    </aside>
  </div>
}

export function ScopedGroupPostWorkspace({ activePageId }: { activePageId: number }) {
  return <div className="page-business-scoped-child ready"><PageTabsManager activePageId={activePageId} scoped /></div>
}

export function ScopedPageWallWorkspace({ activePageId }: { activePageId: number }) {
  return <PageWallGroupLayout activePageId={activePageId} />
}
