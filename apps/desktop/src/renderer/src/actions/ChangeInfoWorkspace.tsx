import { useEffect, useMemo, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type {
  ActionWorkspaceAccountInput,
  ActionWorkspacePresetRecord,
  ActionWorkspaceRecord
} from '../../../shared/actionWorkspaces'
import {
  CHANGE_INFO_CATALOG,
  CHANGE_INFO_CATEGORIES,
  CHANGE_INFO_CATEGORY_LABELS,
  createChangeInfoDataSourceConfig,
  enabledChangeInfoCatalogItems,
  getChangeInfoCatalogItem,
  parseChangeInfoWorkspaceDraft,
  serializeChangeInfoWorkspaceDraft,
  validateChangeInfoWorkspaceDraft,
  type ChangeInfoCategory,
  type ChangeInfoDataScalar,
  type ChangeInfoDataSourceConfig,
  type ChangeInfoDataSourceType,
  type ChangeInfoWorkspaceDraft
} from '../../../shared/changeInfoWorkspace'
import { AccountBindingPickerModal } from './AccountBindingPickerModal'
import './changeInfoWorkspace.css'

interface ChangeInfoWorkspaceProps {
  workspace: ActionWorkspaceRecord
  availableAccounts: AccountRecord[]
  onWorkspaceSaved: (workspace: ActionWorkspaceRecord) => void
}

function bindingInputs(workspace: ActionWorkspaceRecord): ActionWorkspaceAccountInput[] {
  return [...workspace.accounts]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((binding) => ({ accountId: binding.accountId, enabled: binding.enabled }))
}

function signature(draft: ChangeInfoWorkspaceDraft, accounts: ActionWorkspaceAccountInput[]): string {
  return JSON.stringify({ configJson: serializeChangeInfoWorkspaceDraft(draft), accounts })
}

function sourceTypeLabel(type: ChangeInfoDataSourceType): string {
  const labels: Record<ChangeInfoDataSourceType, string> = {
    fixed: 'Cố định',
    list: 'Danh sách',
    file: 'File',
    folder: 'Folder',
    random_from_list: 'Random danh sách',
    sequential_from_list: 'Tuần tự danh sách',
    random_generator: 'Random generator',
    source_profile: 'Profile nguồn'
  }
  return labels[type]
}

function scalarText(value: ChangeInfoDataScalar | undefined): string {
  if (value === undefined) return ''
  return String(value)
}

function listText(source: ChangeInfoDataSourceConfig): string {
  return (source.values ?? []).map(String).join('\n')
}

function parseListText(value: string): ChangeInfoDataScalar[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function accountStatusLabel(status: AccountRecord['status']): string {
  const labels: Partial<Record<AccountRecord['status'], string>> = {
    valid: 'Hoạt động',
    unknown: 'Chưa kiểm tra',
    needs_login: 'Cần đăng nhập',
    two_factor_required: 'Cần 2FA',
    locked: 'Bị khóa',
    disabled: 'Vô hiệu hóa',
    needs_attention: 'Cần xử lý'
  }
  return labels[status] ?? status
}

export function ChangeInfoWorkspace({ workspace, availableAccounts, onWorkspaceSaved }: ChangeInfoWorkspaceProps) {
  const initialDraft = useMemo(() => parseChangeInfoWorkspaceDraft(workspace.configJson), [workspace.id])
  const initialBindings = useMemo(() => bindingInputs(workspace), [workspace.id])
  const [draft, setDraft] = useState<ChangeInfoWorkspaceDraft>(initialDraft)
  const [accountBindings, setAccountBindings] = useState<ActionWorkspaceAccountInput[]>(initialBindings)
  const [savedSignature, setSavedSignature] = useState(() => signature(initialDraft, initialBindings))
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showAccountPicker, setShowAccountPicker] = useState(false)
  const [query, setQuery] = useState('')
  const [presets, setPresets] = useState<ActionWorkspacePresetRecord[]>([])
  const [presetId, setPresetId] = useState<number | null>(null)
  const [presetBusy, setPresetBusy] = useState(false)
  const [presetError, setPresetError] = useState<string | null>(null)

  const currentSignature = useMemo(() => signature(draft, accountBindings), [draft, accountBindings])
  const isDirty = currentSignature !== savedSignature
  const selectedIds = useMemo(() => new Set(accountBindings.map((item) => item.accountId)), [accountBindings])
  const enabledAccountCount = accountBindings.filter((item) => item.enabled).length
  const enabledItems = useMemo(() => enabledChangeInfoCatalogItems(draft), [draft])
  const validationErrors = useMemo(() => validateChangeInfoWorkspaceDraft(draft), [draft])
  const accountMap = useMemo(() => new Map(availableAccounts.map((account) => [account.id, account] as const)), [availableAccounts])
  const normalizedQuery = query.trim().toLocaleLowerCase('vi')
  const visibleCatalog = useMemo(() => normalizedQuery
    ? CHANGE_INFO_CATALOG.filter((item) => `${item.label} ${item.key} ${item.description}`.toLocaleLowerCase('vi').includes(normalizedQuery))
    : [...CHANGE_INFO_CATALOG], [normalizedQuery])

  useEffect(() => {
    let disposed = false
    void window.pageAutoChangeInfo.listPresets({ type: 'change_info' })
      .then((rows) => { if (!disposed) setPresets(rows) })
      .catch((error) => { if (!disposed) setPresetError(error instanceof Error ? error.message : String(error)) })
    return () => { disposed = true }
  }, [])

  const markDirty = () => setSaveStatus('idle')

  const applyAccountSelection = (accountIds: number[]) => {
    const selected = new Set(accountIds)
    setAccountBindings((current) => {
      const kept = current.filter((binding) => selected.has(binding.accountId))
      const existing = new Set(kept.map((binding) => binding.accountId))
      const added = accountIds.filter((id) => !existing.has(id)).map((accountId) => ({ accountId, enabled: true }))
      return [...kept, ...added]
    })
    setShowAccountPicker(false)
    markDirty()
  }

  const setAccountEnabled = (accountId: number, enabled: boolean) => {
    setAccountBindings((current) => current.map((binding) => binding.accountId === accountId ? { ...binding, enabled } : binding))
    markDirty()
  }

  const setAllAccountsEnabled = (enabled: boolean) => {
    setAccountBindings((current) => current.map((binding) => ({ ...binding, enabled })))
    markDirty()
  }

  const setActionEnabled = (key: string, enabled: boolean) => {
    setDraft((current) => {
      const currentAction = current.actions[key]
      if (!currentAction) return current
      return {
        ...current,
        actions: {
          ...current.actions,
          [key]: { ...currentAction, enabled }
        }
      }
    })
    markDirty()
  }

  const setSourceType = (key: string, type: ChangeInfoDataSourceType) => {
    const catalog = getChangeInfoCatalogItem(key)
    if (!catalog) return
    setDraft((current) => {
      const currentAction = current.actions[key]
      if (!currentAction) return current
      return {
        ...current,
        actions: {
          ...current.actions,
          [key]: {
            ...currentAction,
            source: createChangeInfoDataSourceConfig(catalog, type)
          }
        }
      }
    })
    markDirty()
  }

  const patchSource = (key: string, patch: Partial<ChangeInfoDataSourceConfig>) => {
    setDraft((current) => {
      const currentAction = current.actions[key]
      if (!currentAction) return current
      return {
        ...current,
        actions: {
          ...current.actions,
          [key]: {
            ...currentAction,
            source: { ...currentAction.source, ...patch }
          }
        }
      }
    })
    markDirty()
  }

  const moveAction = (key: string, direction: -1 | 1) => {
    setDraft((current) => {
      const order = [...current.actionOrder]
      const enabledOrder = order.filter((item) => current.actions[item]?.enabled)
      const enabledIndex = enabledOrder.indexOf(key)
      const targetEnabled = enabledOrder[enabledIndex + direction]
      if (enabledIndex < 0 || !targetEnabled) return current
      const index = order.indexOf(key)
      const target = order.indexOf(targetEnabled)
      order[index] = targetEnabled
      order[target] = key
      return { ...current, actionOrder: order }
    })
    markDirty()
  }

  const saveWorkspace = async () => {
    if (saveStatus === 'saving') return
    setSaveStatus('saving')
    setSaveError(null)
    try {
      const saved = await window.pageAuto.updateActionWorkspace({
        id: workspace.id,
        patch: {
          configJson: serializeChangeInfoWorkspaceDraft(draft),
          accounts: accountBindings
        }
      })
      const savedDraft = parseChangeInfoWorkspaceDraft(saved.configJson)
      const savedAccounts = bindingInputs(saved)
      setDraft(savedDraft)
      setAccountBindings(savedAccounts)
      setSavedSignature(signature(savedDraft, savedAccounts))
      setSaveStatus('saved')
      onWorkspaceSaved(saved)
    } catch (error) {
      setSaveStatus('error')
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }

  const savePreset = async () => {
    const name = window.prompt('Tên preset Change Info:')?.trim()
    if (!name || presetBusy) return
    setPresetBusy(true)
    setPresetError(null)
    try {
      const saved = await window.pageAutoChangeInfo.savePreset({
        type: 'change_info',
        name,
        configJson: serializeChangeInfoWorkspaceDraft(draft)
      })
      setPresets((current) => [...current.filter((item) => item.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, 'vi')))
      setPresetId(saved.id)
    } catch (error) {
      setPresetError(error instanceof Error ? error.message : String(error))
    } finally {
      setPresetBusy(false)
    }
  }

  const applyPreset = (id: number | null) => {
    setPresetId(id)
    if (!id) return
    const preset = presets.find((item) => item.id === id)
    if (!preset) return
    setDraft(parseChangeInfoWorkspaceDraft(preset.configJson))
    markDirty()
  }

  const deletePreset = async () => {
    if (!presetId || presetBusy) return
    const preset = presets.find((item) => item.id === presetId)
    if (!preset || !window.confirm(`Xóa preset “${preset.name}”?`)) return
    setPresetBusy(true)
    setPresetError(null)
    try {
      await window.pageAutoChangeInfo.deletePreset({ id: preset.id })
      setPresets((current) => current.filter((item) => item.id !== preset.id))
      setPresetId(null)
    } catch (error) {
      setPresetError(error instanceof Error ? error.message : String(error))
    } finally {
      setPresetBusy(false)
    }
  }

  const choosePath = async (key: string, type: 'file' | 'folder') => {
    const path = type === 'file'
      ? await window.pageAutoChangeInfo.pickTextFile()
      : await window.pageAutoChangeInfo.pickFolder()
    if (path) patchSource(key, { path })
  }

  const renderSourceEditor = (key: string) => {
    const catalog = getChangeInfoCatalogItem(key)
    const action = draft.actions[key]
    if (!catalog || !action) return null
    if (catalog.allowedSources.length === 0) {
      return <div className="change-info-source-note">Dữ liệu nhạy cảm chỉ nhập lúc chạy, không lưu trong preset.</div>
    }
    const source = action.source
    return <div className="change-info-inline-editor">
      <select className="change-info-source-type" aria-label={`Nguồn ${catalog.label}`} value={source.type} onChange={(event) => setSourceType(key, event.target.value as ChangeInfoDataSourceType)}>{catalog.allowedSources.map((type) => <option key={type} value={type}>{sourceTypeLabel(type)}</option>)}</select>
      {source.type === 'fixed' && catalog.valueKind === 'boolean' ? <select aria-label={`Giá trị ${catalog.label}`} value={String(source.value ?? true)} onChange={(event) => patchSource(key, { value: event.target.value === 'true' })}><option value="true">Bật</option><option value="false">Tắt</option></select> : null}
      {source.type === 'fixed' && catalog.valueKind !== 'boolean' ? <input className="change-info-value-input" value={scalarText(source.value)} onChange={(event) => patchSource(key, { value: event.target.value })} placeholder="Nhập giá trị…" /> : null}
      {(source.type === 'list' || source.type === 'random_from_list' || source.type === 'sequential_from_list') ? <textarea className="change-info-list-input" rows={3} value={listText(source)} onChange={(event) => patchSource(key, { values: parseListText(event.target.value) })} placeholder={'Mỗi dòng một giá trị\nGiá trị 1\nGiá trị 2'} /> : null}
      {source.type === 'file' || source.type === 'folder' ? <div className="change-info-path-row"><input value={source.path ?? ''} readOnly placeholder={source.type === 'file' ? 'Chưa chọn file…' : 'Chưa chọn folder…'} /><button type="button" onClick={() => void choosePath(key, source.type)}>{source.type === 'file' ? 'Chọn file' : 'Chọn folder'}</button></div> : null}
      {source.type === 'file' || source.type === 'folder' ? <select className="change-info-selection-mode" aria-label={`Phân bổ ${catalog.label}`} value={source.selectionMode ?? 'sequential'} onChange={(event) => patchSource(key, { selectionMode: event.target.value as 'sequential' | 'random' })}><option value="sequential">Tuần tự</option><option value="random">Random</option></select> : null}
      {source.type === 'random_generator' ? <input className="change-info-value-input" value={source.generatorId ?? ''} onChange={(event) => patchSource(key, { generatorId: event.target.value })} placeholder="Generator ID" /> : null}
      {source.type === 'source_profile' ? <input className="change-info-value-input" value={source.sourceProfileUid ?? ''} onChange={(event) => patchSource(key, { sourceProfileUid: event.target.value })} placeholder="UID Profile nguồn" /> : null}
    </div>
  }

  const renderCategoryPanel = (category: ChangeInfoCategory) => {
    const rows = visibleCatalog.filter((item) => item.category === category)
    if (!rows.length) return null
    const enabledInCategory = rows.filter((item) => draft.actions[item.key]?.enabled).length
    return <section key={category} className={`change-info-group change-info-group-${category}`}>
      <header className="change-info-group-head">
        <strong>{CHANGE_INFO_CATEGORY_LABELS[category]}</strong>
        <span>{enabledInCategory}/{rows.length}</span>
      </header>
      <div className="change-info-group-body">
        {rows.map((item) => {
          const enabled = draft.actions[item.key]?.enabled ?? false
          return <div key={item.key} className={enabled ? 'change-info-action-row enabled' : 'change-info-action-row'}>
            <div className="change-info-action-line">
              <label className="change-info-action-toggle" title={item.description}>
                <input type="checkbox" checked={enabled} onChange={(event) => setActionEnabled(item.key, event.target.checked)} />
                <span>{item.label}</span>
              </label>
              {item.destructive ? <small className="change-info-sensitive">Nhạy cảm</small> : null}
            </div>
            {enabled ? renderSourceEditor(item.key) : null}
          </div>
        })}
      </div>
    </section>
  }

  return <section className="change-info-workspace" aria-label={workspace.label}>
    <header className="change-info-head">
      <div className="change-info-title"><p>SỬA THÔNG TIN TÀI KHOẢN</p><h2>{workspace.label}</h2></div>
      <div className="change-info-head-actions">
        <span data-state={saveStatus}>{isDirty ? 'Chưa lưu' : saveStatus === 'saved' ? 'Đã lưu' : 'Đã đồng bộ'}</span>
        <button type="button" disabled={!isDirty || saveStatus === 'saving'} onClick={() => void saveWorkspace()}>{saveStatus === 'saving' ? 'Đang lưu…' : 'Lưu cấu hình'}</button>
      </div>
    </header>

    {saveError ? <div className="change-info-alert error">{saveError}</div> : null}
    {presetError ? <div className="change-info-alert error">{presetError}</div> : null}

    <div className="change-info-toolbar">
      <input className="change-info-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm chức năng…" />
      <div className="change-info-preset">
        <select value={presetId ?? ''} onChange={(event) => applyPreset(event.target.value ? Number(event.target.value) : null)}><option value="">Thiết lập đã lưu…</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select>
        <button type="button" disabled={presetBusy} onClick={() => void savePreset()}>Lưu preset</button>
        <button type="button" disabled={!presetId || presetBusy} onClick={() => void deletePreset()}>Xóa</button>
      </div>
      <div className="change-info-mode-note"><span />Chế độ cấu hình · chưa chạy thay đổi trên Facebook</div>
    </div>

    <div className="change-info-body">
      <aside className="change-info-account-panel">
        <div className="change-info-panel-head">
          <div><strong>Tài khoản chạy</strong><small>{accountBindings.length} tài khoản · bật {enabledAccountCount}</small></div>
          <button type="button" onClick={() => setShowAccountPicker(true)}>Chọn lại</button>
        </div>
        <div className="change-info-account-tools">
          <button type="button" onClick={() => setAllAccountsEnabled(true)}>Bật tất cả</button>
          <button type="button" onClick={() => setAllAccountsEnabled(false)}>Tắt tất cả</button>
        </div>
        <div className="change-info-account-list">
          {accountBindings.length === 0 ? <div className="change-info-empty-small">Chưa chọn tài khoản.</div> : accountBindings.map((binding, index) => {
            const account = accountMap.get(binding.accountId)
            return <label key={binding.accountId} className={binding.enabled ? 'change-info-account-row enabled' : 'change-info-account-row'}>
              <input type="checkbox" checked={binding.enabled} onChange={(event) => setAccountEnabled(binding.accountId, event.target.checked)} />
              <span className="change-info-account-index">{index + 1}</span>
              <span className="change-info-account-text"><strong>{account?.name || account?.username || account?.uid || `ACC#${binding.accountId}`}</strong><small>{account?.uid ?? `ID ${binding.accountId}`}</small></span>
              <em>{account ? accountStatusLabel(account.status) : 'Không tìm thấy'}</em>
            </label>
          })}
        </div>
      </aside>

      <main className="change-info-main">
        <div className="change-info-groups">
          {CHANGE_INFO_CATEGORIES.filter((category) => category !== 'workflow').map(renderCategoryPanel)}
        </div>

        <section className="change-info-workflow-panel">
          <header className="change-info-group-head"><strong>Workflow & chạy</strong><span>{enabledItems.length} thay đổi</span></header>
          <div className="change-info-workflow-grid">
            <label><span>Kịch bản trước</span><input type="number" min={1} value={draft.beforeScenarioId ?? ''} onChange={(event) => { setDraft((current) => ({ ...current, beforeScenarioId: event.target.value ? Number(event.target.value) : null })); markDirty() }} placeholder="Không" /></label>
            <label><span>Kịch bản sau</span><input type="number" min={1} value={draft.afterScenarioId ?? ''} onChange={(event) => { setDraft((current) => ({ ...current, afterScenarioId: event.target.value ? Number(event.target.value) : null })); markDirty() }} placeholder="Không" /></label>
            <label><span>TK song song</span><input type="number" min={1} max={20} value={draft.accountConcurrency} onChange={(event) => { setDraft((current) => ({ ...current, accountConcurrency: Math.min(20, Math.max(1, Number(event.target.value) || 1)) })); markDirty() }} /></label>
            <label className="change-info-verify"><input type="checkbox" checked readOnly /><span>Verify sau thay đổi</span></label>
          </div>
          {enabledItems.length ? <div className="change-info-order-row"><strong>Thứ tự chạy</strong><div>{enabledItems.map((item, index) => <span key={item.key}><b>{index + 1}. {item.label}</b><button type="button" disabled={index === 0} onClick={() => moveAction(item.key, -1)}>↑</button><button type="button" disabled={index === enabledItems.length - 1} onClick={() => moveAction(item.key, 1)}>↓</button></span>)}</div></div> : null}
          <div className="change-info-start-row">
            <div><strong>Chưa sẵn sàng chạy</strong><p>{validationErrors[0] ?? (enabledAccountCount < 1 ? 'Chưa có tài khoản được bật.' : 'Các action đang chờ hoàn tất kiểm thử Facebook.')}</p></div>
            <button type="button" className="change-info-start" disabled>Bắt đầu</button>
          </div>
        </section>
      </main>
    </div>

    {showAccountPicker ? <AccountBindingPickerModal accounts={availableAccounts} selectedIds={selectedIds} onApply={applyAccountSelection} onClose={() => setShowAccountPicker(false)} contextLabel="Sửa thông tin" /> : null}
  </section>
}
