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
    random_from_list: 'Random từ danh sách',
    sequential_from_list: 'Tuần tự từ danh sách',
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
      return <div className="change-info-source-note">Nguồn này sẽ dùng runtime secret/reference sau live audit; preset không lưu secret.</div>
    }
    const source = action.source
    return <div className="change-info-source-editor">
      <label><span>Nguồn dữ liệu</span><select value={source.type} onChange={(event) => setSourceType(key, event.target.value as ChangeInfoDataSourceType)}>{catalog.allowedSources.map((type) => <option key={type} value={type}>{sourceTypeLabel(type)}</option>)}</select></label>
      {source.type === 'fixed' && catalog.valueKind === 'boolean' ? <label><span>Giá trị</span><select value={String(source.value ?? true)} onChange={(event) => patchSource(key, { value: event.target.value === 'true' })}><option value="true">Bật</option><option value="false">Tắt</option></select></label> : null}
      {source.type === 'fixed' && catalog.valueKind !== 'boolean' ? <label className="grow"><span>Giá trị</span><input value={scalarText(source.value)} onChange={(event) => patchSource(key, { value: event.target.value })} placeholder="Nhập giá trị cố định…" /></label> : null}
      {(source.type === 'list' || source.type === 'random_from_list' || source.type === 'sequential_from_list') ? <label className="stack"><span>Danh sách · mỗi dòng một giá trị</span><textarea rows={4} value={listText(source)} onChange={(event) => patchSource(key, { values: parseListText(event.target.value) })} placeholder={'Giá trị 1\nGiá trị 2\nGiá trị 3'} /></label> : null}
      {source.type === 'file' ? <label className="grow"><span>File dữ liệu</span><div className="change-info-path-row"><input value={source.path ?? ''} readOnly placeholder="Chưa chọn file…" /><button type="button" onClick={() => void choosePath(key, 'file')}>Chọn file</button></div></label> : null}
      {source.type === 'folder' ? <label className="grow"><span>Folder media</span><div className="change-info-path-row"><input value={source.path ?? ''} readOnly placeholder="Chưa chọn folder…" /><button type="button" onClick={() => void choosePath(key, 'folder')}>Chọn folder</button></div></label> : null}
      {(source.type === 'file' || source.type === 'folder') ? <label><span>Phân bổ snapshot</span><select value={source.selectionMode ?? 'sequential'} onChange={(event) => patchSource(key, { selectionMode: event.target.value as 'sequential' | 'random' })}><option value="sequential">Tuần tự</option><option value="random">Random ổn định theo run</option></select></label> : null}
      {source.type === 'random_generator' ? <label className="grow"><span>Generator ID</span><input value={source.generatorId ?? ''} onChange={(event) => patchSource(key, { generatorId: event.target.value })} placeholder="Chỉ dùng generator đã đăng ký/audit" /></label> : null}
      {source.type === 'source_profile' ? <label className="grow"><span>UID Profile nguồn</span><input value={source.sourceProfileUid ?? ''} onChange={(event) => patchSource(key, { sourceProfileUid: event.target.value })} placeholder="UID nguồn" /></label> : null}
    </div>
  }

  return <section className="change-info-workspace" aria-label={workspace.label}>
    <header className="change-info-head">
      <div><p className="change-info-kicker">ACCOUNT / PROFILE COMPOSER</p><h2>{workspace.label}</h2><p>Batch 2 dựng workspace + Data Source + preset thật. Mutation Facebook vẫn bị khóa cho tới khi từng action live-audit và có verifier.</p></div>
      <div className="change-info-head-actions"><span data-state={saveStatus}>{isDirty ? 'Chưa lưu' : saveStatus === 'saved' ? 'Đã lưu' : 'Đã đồng bộ'}</span><button type="button" disabled={!isDirty || saveStatus === 'saving'} onClick={() => void saveWorkspace()}>{saveStatus === 'saving' ? 'Đang lưu…' : 'Lưu cấu hình'}</button></div>
    </header>

    {saveError ? <div className="change-info-alert error">{saveError}</div> : null}
    {presetError ? <div className="change-info-alert error">{presetError}</div> : null}

    <div className="change-info-toolbar">
      <div className="change-info-account-summary"><strong>{accountBindings.length}</strong><span>tài khoản · bật {enabledAccountCount}</span><button type="button" onClick={() => setShowAccountPicker(true)}>Chọn lại</button></div>
      <input className="change-info-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm action / field…" />
      <div className="change-info-preset"><select value={presetId ?? ''} onChange={(event) => applyPreset(event.target.value ? Number(event.target.value) : null)}><option value="">Preset…</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><button type="button" disabled={presetBusy} onClick={() => void savePreset()}>Lưu preset</button><button type="button" disabled={!presetId || presetBusy} onClick={() => void deletePreset()}>Xóa</button></div>
    </div>

    <div className="change-info-layout">
      <aside className="change-info-catalog">
        <div className="change-info-section-title"><div><small>CATALOG</small><strong>Chọn thay đổi</strong></div><span>{enabledItems.length} đã chọn</span></div>
        {CHANGE_INFO_CATEGORIES.map((category) => {
          const rows = visibleCatalog.filter((item) => item.category === category)
          if (!rows.length) return null
          return <section key={category} className="change-info-category"><h3>{CHANGE_INFO_CATEGORY_LABELS[category]}</h3>{rows.map((item) => {
            const enabled = draft.actions[item.key]?.enabled ?? false
            return <label key={item.key} className={enabled ? 'change-info-catalog-item selected' : 'change-info-catalog-item'}><input type="checkbox" checked={enabled} onChange={(event) => setActionEnabled(item.key, event.target.checked)} /><span><strong>{item.label}</strong><small>{item.description}</small></span><em data-status={item.supportStatus}>{item.supportStatus === 'ready' ? 'Ready' : 'Cần audit'}</em></label>
          })}</section>
        })}
      </aside>

      <main className="change-info-config">
        <div className="change-info-section-title"><div><small>CONFIG</small><strong>Action đã chọn</strong></div><span>Profile actor</span></div>
        {enabledItems.length === 0 ? <div className="change-info-empty">Chọn một hoặc nhiều thay đổi ở catalog để cấu hình.</div> : enabledItems.map((item, index) => <article className="change-info-action-card" key={item.key}>
          <div className="change-info-action-card-head"><div><span>{index + 1}</span><div><strong>{item.label}</strong><small>{item.key}</small></div></div><div className="change-info-action-buttons"><button type="button" disabled={index === 0} onClick={() => moveAction(item.key, -1)}>↑</button><button type="button" disabled={index === enabledItems.length - 1} onClick={() => moveAction(item.key, 1)}>↓</button><button type="button" onClick={() => setActionEnabled(item.key, false)}>Bỏ</button></div></div>
          <div className="change-info-support-row"><span className="change-info-status audit">Live audit required</span><span>Action Registry chưa có executor mutation cho field này.</span>{item.destructive ? <b>Thao tác nhạy cảm</b> : null}</div>
          {renderSourceEditor(item.key)}
        </article>)}

        <section className="change-info-runtime-card">
          <div className="change-info-section-title"><div><small>WORKFLOW</small><strong>Runtime contract</strong></div><span>chưa chạy Facebook</span></div>
          <div className="change-info-runtime-grid">
            <label><span>Before Scenario ID</span><input type="number" min={1} value={draft.beforeScenarioId ?? ''} onChange={(event) => { setDraft((current) => ({ ...current, beforeScenarioId: event.target.value ? Number(event.target.value) : null })); markDirty() }} placeholder="Không" /></label>
            <label><span>After Scenario ID</span><input type="number" min={1} value={draft.afterScenarioId ?? ''} onChange={(event) => { setDraft((current) => ({ ...current, afterScenarioId: event.target.value ? Number(event.target.value) : null })); markDirty() }} placeholder="Không" /></label>
            <label><span>TK song song</span><input type="number" min={1} max={20} value={draft.accountConcurrency} onChange={(event) => { setDraft((current) => ({ ...current, accountConcurrency: Math.min(20, Math.max(1, Number(event.target.value) || 1)) })); markDirty() }} /></label>
            <label className="change-info-verify"><input type="checkbox" checked readOnly /><span>Verify sau thay đổi · bắt buộc</span></label>
          </div>
          <div className="change-info-gate"><div><strong>Start đang khóa đúng contract</strong><p>{validationErrors[0] ?? (enabledAccountCount < 1 ? 'Chưa có account được bật.' : 'Batch 2 chưa có Change Info runner/executor mutation.')}</p></div><button type="button" disabled>Bắt đầu</button></div>
        </section>
      </main>
    </div>

    {showAccountPicker ? <AccountBindingPickerModal accounts={availableAccounts} selectedIds={selectedIds} onApply={applyAccountSelection} onClose={() => setShowAccountPicker(false)} contextLabel="Sửa thông tin" /> : null}
  </section>
}
