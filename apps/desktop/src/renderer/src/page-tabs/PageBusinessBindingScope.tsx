import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ActionWorkspaceRecord } from '../../../shared/actionWorkspaces'
import {
  pageBusinessPageIdOf,
  pageBusinessTypeOf,
  serializePageBusinessBindingConfig,
  type GenericPageBusinessType
} from '../../../shared/pageBusinessBindings'
import type { PageTabSummary } from '../../../shared/pageTabs'
import { PageTabsManager } from './PageTabsManagerV2'
import { PageWallWorkspace } from './PageWallWorkspace'
import './pageBusinessBindings.css'

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
    {activePage ? children({ activePage, allPages: pages }) : <div className="page-business-binding-empty"><strong>Chưa có Page trong tab {label}</strong><span>Page trong Quản lý Page không tự xuất hiện ở đây.</span><button type="button" onClick={() => setPickerOpen(true)}>+ Thêm Page</button></div>}
    {pickerOpen ? <PagePicker pages={pages} boundIds={boundIds} label={label} onClose={() => setPickerOpen(false)} onAdd={addPage} /> : null}
  </section>
}

export function ScopedGroupPostWorkspace({ activePageId }: { activePageId: number }) {
  return <div className="page-business-scoped-child ready"><PageTabsManager activePageId={activePageId} scoped /></div>
}

export function ScopedPageWallWorkspace({ activePageId }: { activePageId: number }) {
  return <div className="page-business-scoped-child ready"><PageWallWorkspace activePageId={activePageId} scoped /></div>
}
