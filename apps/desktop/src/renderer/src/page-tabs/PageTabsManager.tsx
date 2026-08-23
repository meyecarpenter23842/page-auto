import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
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
import './pageTabsCompact.css'

const dayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
type ConfigDialog = 'rotation' | 'schedule' | 'groups' | 'content' | 'images'

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

interface ModalShellProps {
  eyebrow: string
  title: string
  wide?: boolean
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

function ModalShell({ eyebrow, title, wide = false, onClose, children, footer }: ModalShellProps) {
  return (
    <div className="page-tab-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={wide ? 'page-tab-modal page-tab-config-modal wide' : 'page-tab-modal page-tab-config-modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="page-tab-modal-header">
          <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
          <button type="button" className="page-tab-icon-button" onClick={onClose}>×</button>
        </div>
        <div className="page-tab-modal-body">{children}</div>
        {footer ? <div className="page-tab-modal-actions">{footer}</div> : null}
      </section>
    </div>
  )
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
  const [dialog, setDialog] = useState<ConfigDialog | null>(null)
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
      setDialog(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setDialog(null)
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
      setDialog('schedule')
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
    patchConfig({
      accounts: config.accounts.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
    })
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
    if (error?.startsWith('Khung giờ #')) setError(null)
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

  const modalFooter = (
    <>
      <button className="pt-button secondary" type="button" onClick={() => setDialog(null)}>Đóng</button>
      <button className="pt-button primary" type="button" disabled={!dirty || saving} onClick={() => void save()}>
        {saving ? 'Đang lưu…' : 'Save config'}
      </button>
    </>
  )

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
            <div className="page-tab-editor-title">
              <div className="page-tab-title-line">
                <span className="pt-status-badge">{config.status}</span>
                {dirty ? <span className="pt-dirty-badge">Chưa lưu</span> : <span className="pt-saved-badge">Đã lưu</span>}
              </div>
              <strong>{config.name}</strong>
              <span>Page UID {config.pageUid}</span>
            </div>
            <div className="page-tab-header-actions">
              <button className="pt-button secondary" type="button" onClick={() => void duplicate()}>Duplicate</button>
              <button className="pt-button danger" type="button" onClick={() => void deleteCurrent()}>Delete</button>
              <button className="pt-button primary" type="button" disabled={!dirty || saving} onClick={() => void save()}>
                {saving ? 'Đang lưu…' : 'Save config'}
              </button>
            </div>
          </header>

          <section className="pt-inline-panel pt-identity-panel">
            <div className="pt-panel-heading compact">
              <div><p className="eyebrow">Identity</p><h3>Page</h3></div>
            </div>
            <div className="pt-form-grid two">
              <label><span>Tên tab</span><input value={config.name} onChange={(event) => patchConfig({ name: event.target.value })} /></label>
              <label><span>Page UID</span><input value={config.pageUid} onChange={(event) => patchConfig({ pageUid: event.target.value })} /></label>
            </div>
          </section>

          <section className="pt-inline-panel pt-accounts-panel">
            <div className="pt-panel-heading compact">
              <div><p className="eyebrow">Accounts</p><h3>Account rotation order</h3></div>
              <span className="pt-count-chip">{config.accounts.length} account</span>
            </div>
            <div className="pt-add-row">
              <select value={accountToAdd} onChange={(event) => setAccountToAdd(event.target.value)}>
                <option value="">Chọn account từ Account Manager…</option>
                {availableAccounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.uid} · {account.name ?? 'No name'} · {account.status}</option>
                ))}
              </select>
              <button className="pt-button secondary" type="button" disabled={!accountToAdd} onClick={addAccount}>Add account</button>
            </div>

            <div className="pt-account-grid-wrap">
              <table className="pt-account-grid">
                <thead>
                  <tr>
                    <th className="pt-col-order">#</th>
                    <th className="pt-col-on">On</th>
                    <th className="pt-col-uid">UID / UserName</th>
                    <th className="pt-col-name">Tên</th>
                    <th className="pt-col-status">Status</th>
                    <th className="pt-col-category">Category</th>
                    <th className="pt-col-posts">Bài/lượt</th>
                    <th className="pt-col-move">Thứ tự</th>
                    <th className="pt-col-remove" />
                  </tr>
                </thead>
                <tbody>
                  {config.accounts.map((account, index) => (
                    <tr key={account.accountId}>
                      <td className="pt-col-order">{index + 1}</td>
                      <td className="pt-col-on"><input type="checkbox" checked={account.enabled} onChange={(event) => updateAccountRef(index, { enabled: event.target.checked })} /></td>
                      <td className="pt-col-uid" title={account.uid}>{account.uid}</td>
                      <td className="pt-col-name" title={account.name ?? ''}>{account.name ?? '—'}</td>
                      <td className="pt-col-status"><span className={`pt-account-status-text status-${account.status}`}>{account.status}</span></td>
                      <td className="pt-col-category" title={account.category ?? ''}>{account.category ?? '—'}</td>
                      <td className="pt-col-posts">
                        <input
                          type="number"
                          min="1"
                          placeholder={String(config.rotation.postsPerAccount)}
                          value={account.postsPerTurn ?? ''}
                          onChange={(event) => updateAccountRef(index, { postsPerTurn: event.target.value === '' ? null : Number(event.target.value) })}
                        />
                      </td>
                      <td className="pt-col-move">
                        <button type="button" onClick={() => moveAccount(index, -1)} disabled={index === 0}>↑</button>
                        <button type="button" onClick={() => moveAccount(index, 1)} disabled={index === config.accounts.length - 1}>↓</button>
                      </td>
                      <td className="pt-col-remove"><button type="button" onClick={() => removeAccount(index)}>×</button></td>
                    </tr>
                  ))}
                  {config.accounts.length === 0 ? (
                    <tr><td className="pt-account-empty" colSpan={9}>Tab chưa có account. Thêm account theo đúng thứ tự muốn chạy.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="pt-config-shortcuts" aria-label="Cấu hình Page Tab">
            <button type="button" onClick={() => setDialog('rotation')}>
              <span>Rotation & Delay</span>
              <strong>{config.rotation.postsPerAccount} bài/account</strong>
              <small>{config.rotation.postDelayMinSeconds}–{config.rotation.postDelayMaxSeconds}s giữa bài</small>
            </button>
            <button type="button" onClick={() => setDialog('schedule')}>
              <span>Schedule</span>
              <strong>{config.schedules.filter((item) => item.enabled).length} khung bật</strong>
              <small>{config.schedules.length === 0 ? 'Không có lịch = chạy mọi lúc' : `${config.schedules.length} khung đã tạo`}</small>
            </button>
            <button type="button" onClick={() => setDialog('groups')}>
              <span>Groups</span>
              <strong>{parseGroupText(config.groupUids.join('\n')).length} group</strong>
              <small>Group Set gốc</small>
            </button>
            <button type="button" onClick={() => setDialog('content')}>
              <span>Content</span>
              <strong>{config.contents.filter((item) => item.trim()).length} nội dung</strong>
              <small>{config.contentMode}</small>
            </button>
            <button type="button" onClick={() => setDialog('images')}>
              <span>Images</span>
              <strong>{config.image.folderPath ? `${imageInspection?.fileCount ?? 0} ảnh` : 'Chưa chọn folder'}</strong>
              <small>{config.image.mode} · {config.image.imagesPerPost} ảnh/bài</small>
            </button>
          </section>
        </div>
      )}

      {createOpen ? <CreateTabModal onClose={() => setCreateOpen(false)} onCreate={createTab} /> : null}

      {config && dialog === 'rotation' ? (
        <ModalShell eyebrow="Page Tab config" title="Rotation & Delay" wide onClose={() => setDialog(null)} footer={modalFooter}>
          <div className="pt-form-grid modal-five">
            <label><span>Bài/account</span><input type="number" min="1" value={config.rotation.postsPerAccount} onChange={(event) => patchConfig({ rotation: { ...config.rotation, postsPerAccount: Number(event.target.value) } })} /></label>
            <label><span>Delay bài min (s)</span><input type="number" min="0" value={config.rotation.postDelayMinSeconds} onChange={(event) => patchConfig({ rotation: { ...config.rotation, postDelayMinSeconds: Number(event.target.value) } })} /></label>
            <label><span>Delay bài max (s)</span><input type="number" min="0" value={config.rotation.postDelayMaxSeconds} onChange={(event) => patchConfig({ rotation: { ...config.rotation, postDelayMaxSeconds: Number(event.target.value) } })} /></label>
            <label><span>Đổi account min (s)</span><input type="number" min="0" value={config.rotation.accountDelayMinSeconds} onChange={(event) => patchConfig({ rotation: { ...config.rotation, accountDelayMinSeconds: Number(event.target.value) } })} /></label>
            <label><span>Đổi account max (s)</span><input type="number" min="0" value={config.rotation.accountDelayMaxSeconds} onChange={(event) => patchConfig({ rotation: { ...config.rotation, accountDelayMaxSeconds: Number(event.target.value) } })} /></label>
          </div>
          <p className="pt-help">Account trong cùng Page Tab luôn chạy tuần tự. Bài/lượt riêng ở bảng account sẽ override Bài/account.</p>
        </ModalShell>
      ) : null}

      {config && dialog === 'schedule' ? (
        <ModalShell eyebrow="Page Tab config" title="Schedule" wide onClose={() => setDialog(null)} footer={modalFooter}>
          <div className="pt-modal-toolbar">
            <span>Không có khung giờ bật = tab được phép chạy mọi lúc.</span>
            <button className="pt-button secondary" type="button" onClick={addSchedule}>+ Khung giờ</button>
          </div>
          <div className="pt-schedule-list">
            {config.schedules.map((schedule, index) => {
              const validation = scheduleValidationError(schedule, index)
              return (
                <div className={validation ? 'pt-schedule-item invalid' : 'pt-schedule-item'} key={`${schedule.id}:${index}`}>
                  <div className="pt-schedule-row">
                    <label><span>On</span><input type="checkbox" checked={schedule.enabled} onChange={(event) => updateSchedule(index, { enabled: event.target.checked })} /></label>
                    <label><span>Ngày</span><select value={schedule.dayOfWeek} onChange={(event) => updateSchedule(index, { dayOfWeek: Number(event.target.value) })}>{dayLabels.map((label, day) => <option key={label} value={day}>{label}</option>)}</select></label>
                    <label><span>Từ</span><input type="time" value={minutesToTime(schedule.startMinute)} onChange={(event) => updateSchedule(index, { startMinute: timeToMinutes(event.target.value) })} /></label>
                    <label><span>Đến</span><input type="time" value={minutesToTime(schedule.endMinute)} onChange={(event) => updateSchedule(index, { endMinute: timeToMinutes(event.target.value) })} /></label>
                    <button className="pt-remove-button" type="button" onClick={() => patchConfig({ schedules: config.schedules.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
                  </div>
                  {validation ? <div className="pt-inline-error">{validation}</div> : null}
                </div>
              )
            })}
            {config.schedules.length === 0 ? <div className="pt-empty-row">Chưa có lịch.</div> : null}
          </div>
        </ModalShell>
      ) : null}

      {config && dialog === 'groups' ? (
        <ModalShell eyebrow="Page Tab config" title="Group Set gốc" wide onClose={() => setDialog(null)} footer={modalFooter}>
          <div className="pt-modal-toolbar">
            <span>{parseGroupText(config.groupUids.join('\n')).length} Group UID · Save sẽ trim và deduplicate.</span>
            <button className="pt-button secondary" type="button" onClick={() => void importGroups()}>Import TXT/CSV</button>
          </div>
          <textarea
            className="pt-source-textarea tall"
            rows={18}
            value={config.groupUids.join('\n')}
            onChange={(event) => patchConfig({ groupUids: event.target.value.split(/\r?\n/) })}
            placeholder={'123456789\n987654321\n...'}
          />
          <p className="pt-help">Đây là danh sách nguồn. Mỗi run clone riêng sang run_items; success chỉ consume trong run hiện tại.</p>
        </ModalShell>
      ) : null}

      {config && dialog === 'content' ? (
        <ModalShell eyebrow="Page Tab config" title="Content Set" wide onClose={() => setDialog(null)} footer={modalFooter}>
          <div className="pt-modal-toolbar">
            <div className="pt-modal-inline-field">
              <span>Mode</span>
              <select value={config.contentMode} onChange={(event) => patchConfig({ contentMode: event.target.value as PageTabConfig['contentMode'] })}>
                {CONTENT_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
              </select>
            </div>
            <div className="pt-heading-actions">
              <button className="pt-button secondary" type="button" onClick={() => void importContents()}>Import TXT</button>
              <button className="pt-button secondary" type="button" onClick={() => patchConfig({ contents: [...config.contents, ''] })}>+ Content</button>
            </div>
          </div>
          <div className="pt-content-list">
            {config.contents.map((content, index) => (
              <div className="pt-content-item" key={index}>
                <div className="pt-content-order">
                  <strong>#{index + 1}</strong>
                  <button type="button" onClick={() => patchConfig({ contents: moveItem(config.contents, index, -1) })} disabled={index === 0}>↑</button>
                  <button type="button" onClick={() => patchConfig({ contents: moveItem(config.contents, index, 1) })} disabled={index === config.contents.length - 1}>↓</button>
                </div>
                <textarea rows={5} value={content} onChange={(event) => patchConfig({ contents: config.contents.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} placeholder="Nội dung bài viết…" />
                <button className="pt-remove-button" type="button" onClick={() => patchConfig({ contents: config.contents.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
              </div>
            ))}
            {config.contents.length === 0 ? <div className="pt-empty-row">Chưa có content item.</div> : null}
          </div>
        </ModalShell>
      ) : null}

      {config && dialog === 'images' ? (
        <ModalShell eyebrow="Page Tab config" title="Images" wide onClose={() => setDialog(null)} footer={modalFooter}>
          <div className="pt-image-grid">
            <label className="pt-stack-field full"><span>Folder Windows</span><div className="pt-folder-row"><input readOnly value={config.image.folderPath} placeholder="Chưa chọn folder" /><button className="pt-button secondary" type="button" onClick={() => void pickImageFolder()}>Browse</button></div></label>
            <div className="pt-folder-status full">
              {!config.image.folderPath ? 'Chưa chọn folder ảnh.' : imageInspection?.exists ? `${imageInspection.fileCount} file ảnh jpg/jpeg/png/webp` : 'Folder không tồn tại hoặc không đọc được.'}
            </div>
            <label className="pt-stack-field"><span>Chế độ ảnh</span><select value={config.image.mode} onChange={(event) => patchConfig({ image: { ...config.image, mode: event.target.value as PageTabConfig['image']['mode'] } })}>{IMAGE_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label>
            <label className="pt-stack-field"><span>Số ảnh/bài</span><input type="number" min="1" value={config.image.imagesPerPost} onChange={(event) => patchConfig({ image: { ...config.image, imagesPerPost: Number(event.target.value) } })} /></label>
            <label className="pt-stack-field"><span>Nếu thiếu ảnh</span><select value={config.image.missingPolicy} onChange={(event) => patchConfig({ image: { ...config.image, missingPolicy: event.target.value as PageTabConfig['image']['missingPolicy'] } })}>{MISSING_IMAGE_POLICIES.map((policy) => <option key={policy} value={policy}>{policy}</option>)}</select></label>
          </div>
        </ModalShell>
      ) : null}
    </section>
  )
}
