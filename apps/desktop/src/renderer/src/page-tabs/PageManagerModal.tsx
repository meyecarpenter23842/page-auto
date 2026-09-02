import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ACCOUNT_STATUSES, type AccountRecord, type AccountStatus } from '../../../shared/accounts'
import type { PageTabAccountInput, PageTabConfig, PageTabSummary } from '../../../shared/pageTabs'
import { accountStatusLabels } from '../accounts/accountManagerModel'
import { accountInputsForSelection, buildSharedPageSaveInput } from './pageSharedState'

interface PageManagerModalProps {
  onClose: () => void
  onChanged: () => void
}

type AccountFilterStatus = AccountStatus | 'all'

const pageStatusLabels: Record<string, string> = {
  idle: 'Chưa chạy',
  scheduled: 'Đã lên lịch',
  running: 'Đang chạy',
  paused: 'Tạm dừng',
  waiting_window: 'Chờ lịch',
  stopped: 'Đã dừng',
  error: 'Lỗi'
}

function statusLabel(status: string): string {
  return (accountStatusLabels as Record<string, string>)[status] ?? status
}

export function PageManagerModal({ onClose, onChanged }: PageManagerModalProps) {
  const [tabs, setTabs] = useState<PageTabSummary[]>([])
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [config, setConfig] = useState<PageTabConfig | null>(null)
  const [name, setName] = useState('')
  const [pageUid, setPageUid] = useState('')
  const [createName, setCreateName] = useState('')
  const [createUid, setCreateUid] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingPage, setLoadingPage] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerStatus, setPickerStatus] = useState<AccountFilterStatus>('all')
  const [pickerSelected, setPickerSelected] = useState<Set<number>>(() => new Set())

  const refreshCatalog = async () => {
    const [nextTabs, nextAccounts] = await Promise.all([
      window.pageAuto.listPageTabs(),
      window.pageAuto.listAccounts()
    ])
    setTabs(nextTabs)
    setAccounts(nextAccounts)
    setActiveId((current) => {
      if (current !== null && nextTabs.some((item) => item.id === current)) return current
      return nextTabs[0]?.id ?? null
    })
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.pageAuto.listPageTabs(), window.pageAuto.listAccounts()])
      .then(([nextTabs, nextAccounts]) => {
        if (cancelled) return
        setTabs(nextTabs)
        setAccounts(nextAccounts)
        setActiveId(nextTabs[0]?.id ?? null)
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)) })
    const timer = window.setInterval(() => {
      void refreshCatalog().catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    }, 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (activeId === null) {
      setConfig(null)
      setName('')
      setPageUid('')
      return
    }
    let cancelled = false
    setLoadingPage(true)
    void window.pageAuto.getPageTab({ id: activeId })
      .then((next) => {
        if (cancelled) return
        if (!next) throw new Error('Page không còn tồn tại.')
        setConfig(next)
        setName(next.name)
        setPageUid(next.pageUid)
        setError(null)
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (!cancelled) setLoadingPage(false) })
    return () => { cancelled = true }
  }, [activeId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !pickerOpen) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, pickerOpen])

  const summary = useMemo(() => tabs.find((item) => item.id === activeId) ?? null, [activeId, tabs])
  const liveById = useMemo(() => new Map(accounts.map((item) => [item.id, item] as const)), [accounts])
  const boundAccounts = config?.accounts ?? []

  const filteredPickerAccounts = useMemo(() => {
    const query = pickerSearch.trim().toLowerCase()
    return accounts.filter((account) => {
      if (pickerStatus !== 'all' && account.status !== pickerStatus) return false
      return !query || [account.uid, account.username, account.name, account.email, account.category, account.note]
        .some((value) => value?.toLowerCase().includes(query))
    })
  }, [accounts, pickerSearch, pickerStatus])

  const reloadCurrent = async (id = activeId) => {
    if (id === null) return
    const next = await window.pageAuto.getPageTab({ id })
    if (!next) throw new Error('Page không còn tồn tại.')
    setConfig(next)
    setName(next.name)
    setPageUid(next.pageUid)
  }

  const saveIdentity = async () => {
    if (!config) return
    const nextName = name.trim()
    const nextUid = pageUid.trim()
    if (!nextName || !nextUid) {
      setError('Tên Page và Page UID không được để trống.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const latest = await window.pageAuto.getPageTab({ id: config.id })
      if (!latest) throw new Error('Page không còn tồn tại.')
      const saved = await window.pageAuto.updatePageTab({
        id: latest.id,
        config: buildSharedPageSaveInput(latest, { name: nextName, pageUid: nextUid })
      })
      setConfig(saved)
      setName(saved.name)
      setPageUid(saved.pageUid)
      await refreshCatalog()
      setNotice('Đã cập nhật Page.')
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const saveAccounts = async (nextAccounts: PageTabAccountInput[]) => {
    if (!config) return
    setSaving(true)
    setError(null)
    try {
      const latest = await window.pageAuto.getPageTab({ id: config.id })
      if (!latest) throw new Error('Page không còn tồn tại.')
      const saved = await window.pageAuto.updatePageTab({
        id: latest.id,
        config: buildSharedPageSaveInput(latest, { accounts: nextAccounts })
      })
      setConfig(saved)
      await refreshCatalog()
      setNotice('Đã đồng bộ tài khoản của Page.')
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const openPicker = () => {
    setPickerSelected(new Set(boundAccounts.map((item) => item.accountId)))
    setPickerSearch('')
    setPickerStatus('all')
    setPickerOpen(true)
  }

  const applyPicker = async () => {
    if (!config) return
    const ordered = accounts.filter((item) => pickerSelected.has(item.id)).map((item) => item.id)
    const next = accountInputsForSelection(config, ordered)
    await saveAccounts(next)
    setPickerOpen(false)
  }

  const removeAccount = async (accountId: number) => {
    if (!config) return
    await saveAccounts(config.accounts
      .filter((item) => item.accountId !== accountId)
      .map((item, index) => ({
        accountId: item.accountId,
        enabled: item.enabled,
        sortOrder: index,
        postsPerTurn: item.postsPerTurn
      })))
  }

  const toggleAccount = async (accountId: number, enabled: boolean) => {
    if (!config) return
    await saveAccounts(config.accounts.map((item, index) => ({
      accountId: item.accountId,
      enabled: item.accountId === accountId ? enabled : item.enabled,
      sortOrder: index,
      postsPerTurn: item.postsPerTurn
    })))
  }

  const moveAccount = async (index: number, direction: -1 | 1) => {
    if (!config) return
    const target = index + direction
    if (target < 0 || target >= config.accounts.length) return
    const next = [...config.accounts]
    const current = next[index]
    const other = next[target]
    if (!current || !other) return
    next[index] = other
    next[target] = current
    await saveAccounts(next.map((item, sortOrder) => ({
      accountId: item.accountId,
      enabled: item.enabled,
      sortOrder,
      postsPerTurn: item.postsPerTurn
    })))
  }

  const createPage = async (event: FormEvent) => {
    event.preventDefault()
    const nextName = createName.trim()
    const nextUid = createUid.trim()
    if (!nextName || !nextUid) return
    setSaving(true)
    setError(null)
    try {
      const created = await window.pageAuto.createPageTab({ name: nextName, pageUid: nextUid })
      setCreateName('')
      setCreateUid('')
      await refreshCatalog()
      setActiveId(created.id)
      setNotice(`Đã thêm ${created.name}.`)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const deletePage = async () => {
    if (!config || !window.confirm(`Xóa Page “${config.name}” khỏi toàn bộ module Page?`)) return
    setSaving(true)
    setError(null)
    try {
      const deletedId = config.id
      await window.pageAuto.deletePageTab({ id: deletedId })
      setConfig(null)
      setActiveId(null)
      await refreshCatalog()
      setNotice('Đã xóa Page.')
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-manager-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="page-manager-modal" role="dialog" aria-modal="true" aria-label="Quản lý Page" onMouseDown={(event) => event.stopPropagation()}>
        <header className="page-manager-head">
          <div><span>Page dùng chung</span><strong>Quản lý Page</strong><small>Page + tài khoản + trạng thái là dữ liệu chung cho mọi nghiệp vụ Page.</small></div>
          <button type="button" aria-label="Đóng" onClick={onClose}>×</button>
        </header>

        <div className="page-manager-body">
          <aside className="page-manager-pages">
            <form className="page-manager-create" onSubmit={createPage}>
              <strong>+ Page</strong>
              <input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="Tên Page" />
              <input value={createUid} onChange={(event) => setCreateUid(event.target.value)} placeholder="Page UID" />
              <button type="submit" disabled={saving || !createName.trim() || !createUid.trim()}>Thêm Page</button>
            </form>
            <div className="page-manager-page-list">
              {tabs.map((tab) => (
                <button key={tab.id} type="button" className={tab.id === activeId ? 'active' : ''} onClick={() => setActiveId(tab.id)}>
                  <span><b>{tab.name}</b><small>{tab.pageUid}</small></span>
                  <em className={`page-state state-${tab.status}`}>{pageStatusLabels[tab.status] ?? tab.status}</em>
                </button>
              ))}
              {tabs.length === 0 ? <div className="page-manager-empty">Chưa có Page.</div> : null}
            </div>
          </aside>

          <main className="page-manager-detail">
            {!config ? (
              <div className="page-manager-empty large">{loadingPage ? 'Đang tải Page…' : 'Chọn hoặc thêm Page để quản lý.'}</div>
            ) : (
              <>
                <section className="page-manager-identity">
                  <div className="page-manager-section-head">
                    <div><span>Nhận diện dùng chung</span><strong>{config.name}</strong></div>
                    <div className="page-manager-identity-actions">
                      <em className={`page-state state-${summary?.status ?? config.status}`}>{pageStatusLabels[summary?.status ?? config.status] ?? summary?.status ?? config.status}</em>
                      <button type="button" className="danger" disabled={saving} onClick={() => void deletePage()}>Xóa Page</button>
                    </div>
                  </div>
                  <div className="page-manager-form-row">
                    <label><span>Tên Page</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
                    <label><span>Page UID</span><input value={pageUid} onChange={(event) => setPageUid(event.target.value)} /></label>
                    <button type="button" className="primary" disabled={saving || !name.trim() || !pageUid.trim()} onClick={() => void saveIdentity()}>Lưu Page</button>
                  </div>
                </section>

                <section className="page-manager-account-section">
                  <div className="page-manager-section-head">
                    <div><span>Tài khoản quản lý Page</span><strong>{boundAccounts.length} tài khoản</strong></div>
                    <button type="button" className="primary" disabled={saving} onClick={openPicker}>Chọn tài khoản</button>
                  </div>
                  <div className="page-manager-account-grid-wrap">
                    <table className="page-manager-account-grid">
                      <thead><tr><th>#</th><th>Bật</th><th>UID</th><th>Tên</th><th>Trạng thái</th><th>Category</th><th>Thứ tự</th><th>Xóa</th></tr></thead>
                      <tbody>
                        {boundAccounts.map((ref, index) => {
                          const live = liveById.get(ref.accountId)
                          const liveStatus = live?.status ?? ref.status
                          return (
                            <tr key={ref.accountId}>
                              <td>{index + 1}</td>
                              <td><input type="checkbox" checked={ref.enabled} disabled={saving} onChange={(event) => void toggleAccount(ref.accountId, event.target.checked)} /></td>
                              <td className="mono">{live?.uid ?? ref.uid}</td>
                              <td>{live?.name ?? ref.name ?? '—'}</td>
                              <td><span className={`account-state account-${liveStatus}`}>{statusLabel(liveStatus)}</span></td>
                              <td>{live?.category ?? ref.category ?? '—'}</td>
                              <td className="page-manager-order"><button type="button" disabled={saving || index === 0} onClick={() => void moveAccount(index, -1)}>↑</button><button type="button" disabled={saving || index === boundAccounts.length - 1} onClick={() => void moveAccount(index, 1)}>↓</button></td>
                              <td><button type="button" className="remove" disabled={saving} onClick={() => void removeAccount(ref.accountId)}>×</button></td>
                            </tr>
                          )
                        })}
                        {boundAccounts.length === 0 ? <tr><td colSpan={8} className="page-manager-empty">Page chưa gắn tài khoản.</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </main>
        </div>

        <footer className="page-manager-foot">
          <span>{notice ?? 'Sửa ở đây sẽ cập nhật lại các tab nghiệp vụ Page.'}</span>
          {error ? <b>{error}</b> : null}
          <button type="button" onClick={onClose}>Đóng</button>
        </footer>

        {pickerOpen && config ? (
          <div className="page-manager-picker-backdrop" role="presentation" onMouseDown={() => setPickerOpen(false)}>
            <section className="page-manager-picker" role="dialog" aria-modal="true" aria-label="Chọn tài khoản cho Page" onMouseDown={(event) => event.stopPropagation()}>
              <header><div><span>Account Manager</span><strong>Chọn tài khoản cho {config.name}</strong></div><button type="button" onClick={() => setPickerOpen(false)}>×</button></header>
              <div className="page-manager-picker-filters">
                <input value={pickerSearch} onChange={(event) => setPickerSearch(event.target.value)} placeholder="Tìm UID, tên, email, note…" />
                <select value={pickerStatus} onChange={(event) => setPickerStatus(event.target.value as AccountFilterStatus)}><option value="all">Tất cả trạng thái</option>{ACCOUNT_STATUSES.map((item) => <option key={item} value={item}>{accountStatusLabels[item]}</option>)}</select>
              </div>
              <div className="page-manager-picker-list">
                {filteredPickerAccounts.map((account) => (
                  <label key={account.id} className={pickerSelected.has(account.id) ? 'selected' : ''}>
                    <input type="checkbox" checked={pickerSelected.has(account.id)} onChange={(event) => setPickerSelected((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(account.id)
                      else next.delete(account.id)
                      return next
                    })} />
                    <span><b>{account.uid}</b><small>{account.name ?? account.username ?? '—'}</small></span>
                    <em className={`account-state account-${account.status}`}>{statusLabel(account.status)}</em>
                    <small>{account.category ?? '—'}</small>
                  </label>
                ))}
                {filteredPickerAccounts.length === 0 ? <div className="page-manager-empty">Không có tài khoản phù hợp.</div> : null}
              </div>
              <footer><span>Đã chọn {pickerSelected.size}/{accounts.length}</span><button type="button" onClick={() => setPickerOpen(false)}>Hủy</button><button type="button" className="primary" disabled={saving} onClick={() => void applyPicker()}>Áp dụng</button></footer>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  )
}
