import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import {
  CONTENT_MODES,
  IMAGE_MODES,
  MISSING_IMAGE_POLICIES,
  type CreatePageTabInput,
  type ImageFolderInspection,
  type PageTabAccountRef,
  type PageTabConfig,
  type PageTabSaveInput,
  type PageTabSchedule,
  type PageTabSummary
} from '../../../shared/pageTabs'
import './pageTabs.css'

const dayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

function minutesToTime(minutes: number): string {
  const safe = Math.max(0, Math.min(minutes, 1439))
  const hours = Math.floor(safe / 60)
  const mins = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

function timeToMinutes(value: string): number {
  const [hoursText = '0', minutesText = '0'] = value.split(':')
  const hours = Number(hoursText)
  const minutes = Number(minutesText)
  return Math.max(0, Math.min(1439, hours * 60 + minutes))
}

function scheduleValidationError(schedule: PageTabSchedule, index: number): string | null {
  if (!schedule.enabled) return null
  if (schedule.startMinute >= schedule.endMinute) {
    return `Khung giờ #${index + 1}: giờ kết thúc phải sau giờ bắt đầu. Hãy sửa thời gian hoặc tắt khung giờ này.`
  }
  return null
}

function parseGroupText(text: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const firstCell = line.split(/[|,;\t]/)[0]?.trim() ?? ''
    if (!firstCell || seen.has(firstCell)) continue
    seen.add(firstCell)
    result.push(firstCell)
  }
  return result
}

function parseContentText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const blocks = normalized.includes('\n---\n')
    ? normalized.split(/\n-{3,}\n/)
    : normalized.split(/\n\s*\n/)
  return blocks.map((item) => item.trim()).filter(Boolean)
}

function toSaveInput(config: PageTabConfig): PageTabSaveInput {
  return {
    name: config.name,
    pageUid: config.pageUid,
    rotation: { ...config.rotation },
    accounts: config.accounts.map((item, index) => ({
      accountId: item.accountId,
      enabled: item.enabled,
      sortOrder: index,
      postsPerTurn: item.postsPerTurn
    })),
    schedules: config.schedules.map((item, index) => ({
      dayOfWeek: item.dayOfWeek,
      startMinute: item.startMinute,
      endMinute: item.endMinute,
      enabled: item.enabled,
      sortOrder: index
    })),
    groupUids: [...config.groupUids],
    contentMode: config.contentMode,
    contents: [...config.contents],
    image: { ...config.image }
  }
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (index < 0 || target < 0 || target >= items.length) return items
  const next = [...items]
  const current = next[index]
  const other = next[target]
  if (current === undefined || other === undefined) return items
  next[index] = other
  next[target] = current
  return next
}

interface CreateTabModalProps {
  onClose: () => void
  onCreate: (input: CreatePageTabInput) => Promise<void>
}

function CreateTabModal({ onClose, onCreate }: CreateTabModalProps) {
  const [name, setName] = useState('')
  const [pageUid, setPageUid] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onCreate({ name, pageUid })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-tab-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="page-tab-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="page-tab-modal-header">
          <div><p className="eyebrow">Page Tabs</p><h2>Tạo Page Tab</h2></div>
          <button type="button" className="page-tab-icon-button" onClick={onClose}>×</button>
        </div>
        <label><span>Tên tab</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Page A" /></label>
        <label><span>Page UID</span><input required value={pageUid} onChange={(event) => setPageUid(event.target.value)} placeholder="123456789" /></label>
        {error ? <div className="page-tab-error">{error}</div> : null}
        <div className="page-tab-modal-actions">
          <button className="pt-button secondary" type="button" onClick={onClose}>Hủy</button>
          <button className="pt-button primary" type="submit" disabled={saving}>{saving ? 'Đang tạo…' : 'Tạo tab'}</button>
        </div>
      </form>
    </div>
  )
}

export function PageTabsManager() {
  const [tabs, setTabs] = useState<PageTabSummary[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [config, setConfig] = useState<PageTabConfig | null>(null)
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [accountToAdd, setAccountToAdd] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imageInspection, setImageInspection] = useState<ImageFolderInspection | null>(null)

  const refreshTabs = useCallback(async (preferredId?: number) => {
    const nextTabs = await window.pageAuto.listPageTabs()
    setTabs(nextTabs)
    const nextActive = preferredId ?? activeId ?? nextTabs[0]?.id ?? null
    if (nextActive !== null && nextTabs.some((tab) => tab.id === nextActive)) {
      setActiveId(nextActive)
    } else {
      setActiveId(nextTabs[0]?.id ?? null)
    }
  }, [activeId])

  useEffect(() => {
    void Promise.all([window.pageAuto.listPageTabs(), window.pageAuto.listAccounts()])
      .then(([nextTabs, nextAccounts]) => {
        setTabs(nextTabs)
        setAccounts(nextAccounts)
        setActiveId(nextTabs[0]?.id ?? null)
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (activeId === null) {
      setConfig(null)
      setDirty(false)
      return
    }

    let cancelled = false
    setLoading(true)
    void window.pageAuto.getPageTab({ id: activeId })
      .then((nextConfig) => {
        if (cancelled) return
        setConfig(nextConfig)
        setDirty(false)
        setError(null)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [activeId])

  useEffect(() => {
    const folderPath = config?.image.folderPath.trim() ?? ''
    if (!folderPath) {
      setImageInspection(null)
      return
    }
    let cancelled = false
    void window.pageAuto.inspectPageTabImageFolder(folderPath).then((result) => {
      if (!cancelled) setImageInspection(result)
    })
    return () => { cancelled = true }
  }, [config?.image.folderPath])

  const patchConfig = (patch: Partial<PageTabConfig>) => {
    setConfig((current) => current ? { ...current, ...patch } : current)
    setDirty(true)
  }

  const createTab = async (input: CreatePageTabInput) => {
    const created = await window.pageAuto.createPageTab(input)
    setCreateOpen(false)
    setNotice(`Đã tạo ${created.name}.`)
    await refreshTabs(created.id)
    setActiveId(created.id)
  }

  const save = async () => {
    if (!config) return
    const scheduleError = config.schedules
      .map((schedule, index) => scheduleValidationError(schedule, index))
      .find((message): message is string => message !== null)
    if (scheduleError) {
      setNotice(null)
      setError(scheduleError)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const saved = await window.pageAuto.updatePageTab({ id: config.id, config: toSaveInput(config) })
      setConfig(saved)
      setDirty(false)
      setNotice('Đã lưu toàn bộ cấu hình Page Tab.')
      await refreshTabs(saved.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const duplicate = async () => {
    if (!config) return
    const copy = await window.pageAuto.duplicatePageTab({ id: config.id })
    setNotice(`Đã duplicate thành ${copy.name}.`)
    await refreshTabs(copy.id)
    setActiveId(copy.id)
  }

  const deleteCurrent = async () => {
    if (!config || !window.confirm(`Xóa Page Tab “${config.name}”? Group/Content config của tab cũng sẽ bị xóa.`)) return
    await window.pageAuto.deletePageTab({ id: config.id })
    setNotice(`Đã xóa ${config.name}.`)
    setConfig(null)
    setActiveId(null)
    await refreshTabs()
  }

  const availableAccounts = useMemo(() => {
    const selectedIds = new Set(config?.accounts.map((item) => item.accountId) ?? [])
    return accounts.filter((account) => !selectedIds.has(account.id))
  }, [accounts, config?.accounts])

  const addAccount = () => {
    if (!config) return
    const accountId = Number(accountToAdd)
    const account = accounts.find((item) => item.id === accountId)
    if (!account) return
    const ref: PageTabAccountRef = {
      accountId: account.id,
      enabled: true,
      sortOrder: config.accounts.length,
      postsPerTurn: null,
      uid: account.uid,
      name: account.name,
      status: account.status,
      category: account.category
    }
    patchConfig({ accounts: [...config.accounts, ref] })
    setAccountToAdd('')
  }

  const updateAccountRef = (index: number, patch: Partial<PageTabAccountRef>) => {
    if (!config) return
    const next = config.accounts.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
    patchConfig({ accounts: next })
  }

  const moveAccount = (index: number, direction: -1 | 1) => {
    if (!config) return
    patchConfig({ accounts: moveItem(config.accounts, index, direction) })
  }

  const removeAccount = (index: number) => {
    if (!config) return
    patchConfig({ accounts: config.accounts.filter((_, itemIndex) => itemIndex !== index) })
  }

  const addSchedule = () => {
    if (!config) return
    const schedule: PageTabSchedule = {
      id: -(Date.now()),
      dayOfWeek: 1,
      startMinute: 480,
      endMinute: 660,
      enabled: true,
      sortOrder: config.schedules.length
    }
    patchConfig({ schedules: [...config.schedules, schedule] })
  }

  const updateSchedule = (index: number, patch: Partial<PageTabSchedule>) => {
    if (!config) return
    patchConfig({ schedules: config.schedules.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) })
  }

  const importGroups = async () => {
    const result = await window.pageAuto.pickPageTabTextFile()
    if (!result || !config) return
    patchConfig({ groupUids: parseGroupText(result.content) })
    setNotice(`Đã nạp Group UID từ ${result.path}.`)
  }

  const importContents = async () => {
    const result = await window.pageAuto.pickPageTabTextFile()
    if (!result || !config) return
    patchConfig({ contents: parseContentText(result.content) })
    setNotice(`Đã nạp Content từ ${result.path}.`)
  }

  const pickImageFolder = async () => {
    const folderPath = await window.pageAuto.pickPageTabImageFolder()
    if (!folderPath || !config) return
    patchConfig({ image: { ...config.image, folderPath } })
  }

  if (loading && tabs.length === 0) {
    return <section className="page-tabs-empty"><strong>Đang tải Page Tabs…</strong></section>
  }

  return (
    <section className="page-tabs-manager">
      <div className="page-tabs-strip" aria-label="Danh sách Page Tabs">
        <div className="page-tabs-scroll">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={tab.id === activeId ? 'page-tab-chip active' : 'page-tab-chip'}
              onClick={() => {
                if (dirty && !window.confirm('Cấu hình hiện tại chưa lưu. Chuyển tab và bỏ thay đổi?')) return
                setActiveId(tab.id)
              }}
            >
              <span className="page-tab-status-dot" />
              <span><strong>{tab.name}</strong><small>{tab.pageUid}</small></span>
            </button>
          ))}
        </div>
        <button className="page-tab-add" type="button" onClick={() => setCreateOpen(true)}>+ Page</button>
      </div>

      {notice ? <div className="pt-notice"><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}
      {error ? <div className="page-tab-error">{error}</div> : null}

      {!config ? (
        <div className="page-tabs-empty">
          <strong>Chưa có Page Tab</strong>
          <span>Tạo tab đầu tiên để cấu hình Page UID, account, lịch chạy, group, content và ảnh.</span>
          <button className="pt-button primary" type="button" onClick={() => setCreateOpen(true)}>+ Tạo Page Tab</button>
        </div>
      ) : (
        <div className="page-tab-workspace">
          <header className="page-tab-editor-header">
            <div>
              <div className="page-tab-title-line">
                <span className="pt-status-badge">{config.status}</span>
                {dirty ? <span className="pt-dirty-badge">Chưa lưu</span> : <span className="pt-saved-badge">Đã lưu</span>}
              </div>
              <h2>{config.name}</h2>
              <p>Page UID: {config.pageUid}</p>
            </div>
            <div className="page-tab-header-actions">
              <button className="pt-button secondary" type="button" onClick={() => void duplicate()}>Duplicate</button>
              <button className="pt-button danger" type="button" onClick={() => void deleteCurrent()}>Delete</button>
              <button className="pt-button primary" type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Đang lưu…' : 'Save config'}</button>
            </div>
          </header>

          <div className="page-tab-layout">
            <div className="page-tab-main-column">
              <section className="pt-panel">
                <div className="pt-panel-heading"><div><p className="eyebrow">Identity</p><h3>Page</h3></div></div>
                <div className="pt-form-grid two">
                  <label><span>Tên tab</span><input value={config.name} onChange={(event) => patchConfig({ name: event.target.value })} /></label>
                  <label><span>Page UID</span><input value={config.pageUid} onChange={(event) => patchConfig({ pageUid: event.target.value })} /></label>
                </div>
              </section>

              <section className="pt-panel">
                <div className="pt-panel-heading">
                  <div><p className="eyebrow">Accounts</p><h3>Account rotation order</h3></div>
                  <span className="pt-count-chip">{config.accounts.length} account</span>
                </div>
                <div className="pt-add-row">
                  <select value={accountToAdd} onChange={(event) => setAccountToAdd(event.target.value)}>
                    <option value="">Chọn account từ Account Manager…</option>
                    {availableAccounts.map((account) => <option key={account.id} value={account.id}>{account.uid} · {account.name ?? 'No name'} · {account.status}</option>)}
                  </select>
                  <button className="pt-button secondary" type="button" disabled={!accountToAdd} onClick={addAccount}>Add account</button>
                </div>
                <div className="pt-account-list">
                  {config.accounts.map((account, index) => (
                    <div className="pt-account-row" key={account.accountId}>
                      <div className="pt-order-actions">
                        <button type="button" onClick={() => moveAccount(index, -1)} disabled={index === 0}>↑</button>
                        <button type="button" onClick={() => moveAccount(index, 1)} disabled={index === config.accounts.length - 1}>↓</button>
                      </div>
                      <label className="pt-enable-check"><input type="checkbox" checked={account.enabled} onChange={(event) => updateAccountRef(index, { enabled: event.target.checked })} /></label>
                      <div className="pt-account-info"><strong>{account.uid}</strong><span>{account.name ?? 'Chưa có tên'} · {account.category ?? 'No category'}</span></div>
                      <span className={`pt-account-status status-${account.status}`}>{account.status}</span>
                      <label className="pt-post-override"><span>Bài/lượt</span><input type="number" min="1" placeholder={String(config.rotation.postsPerAccount)} value={account.postsPerTurn ?? ''} onChange={(event) => updateAccountRef(index, { postsPerTurn: event.target.value === '' ? null : Number(event.target.value) })} /></label>
                      <button className="pt-remove-button" type="button" onClick={() => removeAccount(index)}>Remove</button>
                    </div>
                  ))}
                  {config.accounts.length === 0 ? <div className="pt-empty-row">Tab chưa có account. Thêm account theo đúng thứ tự muốn chạy.</div> : null}
                </div>
              </section>

              <section className="pt-panel">
                <div className="pt-panel-heading"><div><p className="eyebrow">Rotation</p><h3>Số bài & delay</h3></div></div>
                <div className="pt-form-grid five">
                  <label><span>Bài/account</span><input type="number" min="1" value={config.rotation.postsPerAccount} onChange={(event) => patchConfig({ rotation: { ...config.rotation, postsPerAccount: Number(event.target.value) } })} /></label>
                  <label><span>Delay bài min (s)</span><input type="number" min="0" value={config.rotation.postDelayMinSeconds} onChange={(event) => patchConfig({ rotation: { ...config.rotation, postDelayMinSeconds: Number(event.target.value) } })} /></label>
                  <label><span>Delay bài max (s)</span><input type="number" min="0" value={config.rotation.postDelayMaxSeconds} onChange={(event) => patchConfig({ rotation: { ...config.rotation, postDelayMaxSeconds: Number(event.target.value) } })} /></label>
                  <label><span>Đổi account min (s)</span><input type="number" min="0" value={config.rotation.accountDelayMinSeconds} onChange={(event) => patchConfig({ rotation: { ...config.rotation, accountDelayMinSeconds: Number(event.target.value) } })} /></label>
                  <label><span>Đổi account max (s)</span><input type="number" min="0" value={config.rotation.accountDelayMaxSeconds} onChange={(event) => patchConfig({ rotation: { ...config.rotation, accountDelayMaxSeconds: Number(event.target.value) } })} /></label>
                </div>
              </section>

              <section className="pt-panel">
                <div className="pt-panel-heading">
                  <div><p className="eyebrow">Schedule</p><h3>Nhiều khung giờ/ngày</h3></div>
                  <button className="pt-button secondary" type="button" onClick={addSchedule}>+ Khung giờ</button>
                </div>
                <div className="pt-schedule-list">
                  {config.schedules.map((schedule, index) => (
                    <div className="pt-schedule-row" key={`${schedule.id}:${index}`}>
                      <label><span>On</span><input type="checkbox" checked={schedule.enabled} onChange={(event) => updateSchedule(index, { enabled: event.target.checked })} /></label>
                      <label><span>Ngày</span><select value={schedule.dayOfWeek} onChange={(event) => updateSchedule(index, { dayOfWeek: Number(event.target.value) })}>{dayLabels.map((label, day) => <option key={label} value={day}>{label}</option>)}</select></label>
                      <label><span>Từ</span><input type="time" value={minutesToTime(schedule.startMinute)} onChange={(event) => updateSchedule(index, { startMinute: timeToMinutes(event.target.value) })} /></label>
                      <label><span>Đến</span><input type="time" value={minutesToTime(schedule.endMinute)} onChange={(event) => updateSchedule(index, { endMinute: timeToMinutes(event.target.value) })} /></label>
                      <button className="pt-remove-button" type="button" onClick={() => patchConfig({ schedules: config.schedules.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
                    </div>
                  ))}
                  {config.schedules.length === 0 ? <div className="pt-empty-row">Chưa có lịch. Có thể lưu tab trước và thêm lịch sau.</div> : null}
                </div>
              </section>

              <section className="pt-panel">
                <div className="pt-panel-heading">
                  <div><p className="eyebrow">Groups</p><h3>Group Set gốc</h3></div>
                  <div className="pt-heading-actions"><span className="pt-count-chip">{parseGroupText(config.groupUids.join('\n')).length} group</span><button className="pt-button secondary" type="button" onClick={() => void importGroups()}>Import TXT/CSV</button></div>
                </div>
                <textarea className="pt-source-textarea" rows={10} value={config.groupUids.join('\n')} onChange={(event) => patchConfig({ groupUids: event.target.value.split(/\r?\n/) })} placeholder={'123456789\n987654321\n...'} />
                <p className="pt-help">Save sẽ trim + deduplicate UID. Danh sách này là nguồn gốc; Phase 4 mới clone sang run_items.</p>
              </section>

              <section className="pt-panel">
                <div className="pt-panel-heading">
                  <div><p className="eyebrow">Content</p><h3>Content Set</h3></div>
                  <div className="pt-heading-actions"><select value={config.contentMode} onChange={(event) => patchConfig({ contentMode: event.target.value as PageTabConfig['contentMode'] })}>{CONTENT_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select><button className="pt-button secondary" type="button" onClick={() => void importContents()}>Import TXT</button><button className="pt-button secondary" type="button" onClick={() => patchConfig({ contents: [...config.contents, ''] })}>+ Content</button></div>
                </div>
                <div className="pt-content-list">
                  {config.contents.map((content, index) => (
                    <div className="pt-content-item" key={index}>
                      <div className="pt-content-order"><strong>#{index + 1}</strong><button type="button" onClick={() => patchConfig({ contents: moveItem(config.contents, index, -1) })} disabled={index === 0}>↑</button><button type="button" onClick={() => patchConfig({ contents: moveItem(config.contents, index, 1) })} disabled={index === config.contents.length - 1}>↓</button></div>
                      <textarea rows={5} value={content} onChange={(event) => patchConfig({ contents: config.contents.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} placeholder="Nội dung bài viết…" />
                      <button className="pt-remove-button" type="button" onClick={() => patchConfig({ contents: config.contents.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
                    </div>
                  ))}
                  {config.contents.length === 0 ? <div className="pt-empty-row">Chưa có content item.</div> : null}
                </div>
              </section>
            </div>

            <aside className="page-tab-side-column">
              <section className="pt-panel sticky-panel">
                <div className="pt-panel-heading"><div><p className="eyebrow">Images</p><h3>Image Folder</h3></div></div>
                <label className="pt-stack-field"><span>Folder Windows</span><div className="pt-folder-row"><input readOnly value={config.image.folderPath} placeholder="Chưa chọn folder" /><button className="pt-button secondary" type="button" onClick={() => void pickImageFolder()}>Browse</button></div></label>
                <div className="pt-folder-status">
                  {!config.image.folderPath ? 'Chưa chọn folder ảnh.' : imageInspection?.exists ? `${imageInspection.fileCount} file ảnh jpg/jpeg/png/webp` : 'Folder không tồn tại hoặc không đọc được.'}
                </div>
                <label className="pt-stack-field"><span>Chế độ ảnh</span><select value={config.image.mode} onChange={(event) => patchConfig({ image: { ...config.image, mode: event.target.value as PageTabConfig['image']['mode'] } })}>{IMAGE_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label>
                <label className="pt-stack-field"><span>Số ảnh/bài</span><input type="number" min="1" value={config.image.imagesPerPost} onChange={(event) => patchConfig({ image: { ...config.image, imagesPerPost: Number(event.target.value) } })} /></label>
                <label className="pt-stack-field"><span>Nếu thiếu ảnh</span><select value={config.image.missingPolicy} onChange={(event) => patchConfig({ image: { ...config.image, missingPolicy: event.target.value as PageTabConfig['image']['missingPolicy'] } })}>{MISSING_IMAGE_POLICIES.map((policy) => <option key={policy} value={policy}>{policy}</option>)}</select></label>
              </section>

              <section className="pt-panel pt-summary-panel">
                <p className="eyebrow">Config summary</p>
                <div><span>Accounts</span><strong>{config.accounts.length}</strong></div>
                <div><span>Enabled</span><strong>{config.accounts.filter((item) => item.enabled).length}</strong></div>
                <div><span>Schedules</span><strong>{config.schedules.filter((item) => item.enabled).length}</strong></div>
                <div><span>Groups</span><strong>{parseGroupText(config.groupUids.join('\n')).length}</strong></div>
                <div><span>Contents</span><strong>{config.contents.filter((item) => item.trim()).length}</strong></div>
              </section>
            </aside>
          </div>
        </div>
      )}

      {createOpen ? <CreateTabModal onClose={() => setCreateOpen(false)} onCreate={createTab} /> : null}
    </section>
  )
}
