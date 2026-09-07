import { useEffect, useMemo, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type { ChangeInfoBioAuditResult } from '../../../shared/changeInfoAudit'
import {
  isActiveChangeInfoRunState,
  type ChangeInfoRunSnapshot,
  type ChangeInfoRunState
} from '../../../shared/changeInfoRunner'
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
  return value === undefined ? '' : String(value)
}

function listText(source: ChangeInfoDataSourceConfig): string {
  return (source.values ?? []).map(String).join('\n')
}

function parseListText(value: string): ChangeInfoDataScalar[] {
  return value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)
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

function runStateLabel(state: ChangeInfoRunState): string {
  const labels: Record<ChangeInfoRunState, string> = {
    running: 'Đang chạy',
    paused: 'Tạm dừng',
    stopping: 'Đang dừng',
    success: 'Thành công',
    partial_success: 'Thành công một phần',
    needs_attention: 'Cần xử lý',
    failed: 'Thất bại',
    stopped: 'Đã dừng'
  }
  return labels[state]
}

export function ChangeInfoWorkspace({ workspace, availableAccounts, onWorkspaceSaved }: ChangeInfoWorkspaceProps) {
  const freshDraft = useMemo(() => parseChangeInfoWorkspaceDraft(workspace.configJson), [workspace.id, workspace.configJson])
  const freshBindings = useMemo(() => bindingInputs(workspace), [workspace.id, workspace.accounts])
  const [draft, setDraft] = useState<ChangeInfoWorkspaceDraft>(freshDraft)
  const [accountBindings, setAccountBindings] = useState<ActionWorkspaceAccountInput[]>(freshBindings)
  const [savedSignature, setSavedSignature] = useState(() => signature(freshDraft, freshBindings))
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showAccountPicker, setShowAccountPicker] = useState(false)
  const [query, setQuery] = useState('')
  const [presets, setPresets] = useState<ActionWorkspacePresetRecord[]>([])
  const [presetId, setPresetId] = useState<number | null>(null)
  const [presetBusy, setPresetBusy] = useState(false)
  const [presetError, setPresetError] = useState<string | null>(null)
  const [bioAuditBusy, setBioAuditBusy] = useState(false)
  const [bioAuditResult, setBioAuditResult] = useState<ChangeInfoBioAuditResult | null>(null)
  const [runtime, setRuntime] = useState<ChangeInfoRunSnapshot | null>(null)
  const [runtimeBusy, setRuntimeBusy] = useState(false)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(freshDraft)
    setAccountBindings(freshBindings)
    setSavedSignature(signature(freshDraft, freshBindings))
    setSaveStatus('idle')
    setSaveError(null)
    setBioAuditResult(null)
    setRuntime(null)
    setRuntimeError(null)
  }, [workspace.id])

  const currentSignature = useMemo(() => signature(draft, accountBindings), [draft, accountBindings])
  const isDirty = currentSignature !== savedSignature
  const selectedIds = useMemo(() => new Set(accountBindings.map((item) => item.accountId)), [accountBindings])
  const enabledBindings = useMemo(() => accountBindings.filter((item) => item.enabled), [accountBindings])
  const enabledAccountCount = enabledBindings.length
  const enabledItems = useMemo(() => enabledChangeInfoCatalogItems(draft), [draft])
  const validationErrors = useMemo(() => validateChangeInfoWorkspaceDraft(draft), [draft])
  const accountMap = useMemo(() => new Map(availableAccounts.map((account) => [account.id, account] as const)), [availableAccounts])
  const runtimeActive = isActiveChangeInfoRunState(runtime?.state)
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

  useEffect(() => {
    let disposed = false
    const refresh = () => {
      void window.pageAutoChangeInfo.status({ workspaceId: workspace.id })
        .then((snapshot) => { if (!disposed) setRuntime(snapshot) })
        .catch((error) => { if (!disposed) setRuntimeError(error instanceof Error ? error.message : String(error)) })
    }
    refresh()
    const timer = window.setInterval(refresh, 1000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [workspace.id])

  const markDirty = () => setSaveStatus('idle')

  const applyAccountSelection = (accountIds: number[]) => {
    const selected = new Set(accountIds)
    setAccountBindings((current) => {
      const kept = current.filter((binding) => selected.has(binding.accountId))
      const existing = new Set(kept.map((binding) => binding.accountId))
      const added = accountIds.filter((id) => !existing.has(id)).map((accountId) => ({ accountId, enabled: true }))
      return [...kept, ...added]
    })
    setBioAuditResult(null)
    setShowAccountPicker(false)
    markDirty()
  }

  const setAccountEnabled = (accountId: number, enabled: boolean) => {
    setAccountBindings((current) => current.map((binding) => binding.accountId === accountId ? { ...binding, enabled } : binding))
    setBioAuditResult(null)
    markDirty()
  }

  const setAllAccountsEnabled = (enabled: boolean) => {
    setAccountBindings((current) => current.map((binding) => ({ ...binding, enabled })))
    setBioAuditResult(null)
    markDirty()
  }

  const setActionEnabled = (key: string, enabled: boolean) => {
    setDraft((current) => {
      const currentAction = current.actions[key]
      if (!currentAction) return current
      return { ...current, actions: { ...current.actions, [key]: { ...currentAction, enabled } } }
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
        actions: { ...current.actions, [key]: { ...currentAction, source: createChangeInfoDataSourceConfig(catalog, type) } }
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
        actions: { ...current.actions, [key]: { ...currentAction, source: { ...currentAction.source, ...patch } } }
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
    if (saveStatus === 'saving' || runtimeActive) return
    setSaveStatus('saving')
    setSaveError(null)
    try {
      const saved = await window.pageAuto.updateActionWorkspace({
        id: workspace.id,
        patch: { configJson: serializeChangeInfoWorkspaceDraft(draft), accounts: accountBindings }
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
      const saved = await window.pageAutoChangeInfo.savePreset({ type: 'change_info', name, configJson: serializeChangeInfoWorkspaceDraft(draft) })
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
    const path = type === 'file' ? await window.pageAutoChangeInfo.pickTextFile() : await window.pageAutoChangeInfo.pickFolder()
    if (path) patchSource(key, { path })
  }

  const runBioAudit = async () => {
    if (bioAuditBusy || runtimeActive) return
    const binding = enabledBindings[0]
    if (enabledBindings.length !== 1 || !binding) {
      setBioAuditResult({
        status: 'failed',
        accountId: binding?.accountId ?? 0,
        uid: '',
        code: 'audit_single_account_required',
        message: 'Bật đúng 1 tài khoản để audit live Tiểu sử.'
      })
      return
    }
    setBioAuditBusy(true)
    setBioAuditResult(null)
    try {
      const result = await window.pageAutoChangeInfo.auditBio({ accountId: binding.accountId })
      setBioAuditResult(result)
      console.info('[PAGE-AUTO change-info-audit]', JSON.stringify(result))
    } catch (error) {
      setBioAuditResult({
        status: 'failed',
        accountId: binding.accountId,
        uid: accountMap.get(binding.accountId)?.uid ?? '',
        code: 'audit_ipc_failed',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBioAuditBusy(false)
    }
  }

  const runCommand = async (command: 'start' | 'pause' | 'resume' | 'stop') => {
    if (runtimeBusy) return
    setRuntimeBusy(true)
    setRuntimeError(null)
    try {
      const next = await window.pageAutoChangeInfo[command]({ workspaceId: workspace.id })
      if (next) setRuntime(next)
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error))
    } finally {
      setRuntimeBusy(false)
    }
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
      {source.type === 'file' ? <div className="change-info-path-row"><input value={source.path ?? ''} readOnly placeholder="Chưa chọn file…" /><button type="button" onClick={() => void choosePath(key, 'file')}>Chọn file</button></div> : null}
      {source.type === 'folder' ? <div className="change-info-path-row"><input value={source.path ?? ''} readOnly placeholder="Chưa chọn folder…" /><button type="button" onClick={() => void choosePath(key, 'folder')}>Chọn folder</button></div> : null}
      {source.type === 'file' || source.type === 'folder' ? <select className="change-info-selection-mode" aria-label={`Phân bổ ${catalog.label}`} value={source.selectionMode ?? 'sequential'} onChange={(event) => patchSource(key, { selectionMode: event.target.value as 'sequential' | 'random' })}><option value="sequential">Tuần tự</option><option value="random">Random</option></select> : null}
      {source.type === 'random_generator' ? <input className="change-info-value-input" value={source.generatorId ?? ''} onChange={(event) => patchSource(key, { generatorId: event.target.value })} placeholder="Generator ID" /> : null}
      {source.type === 'source_profile' ? <input className="change-info-value-input" value={source.sourceProfileUid ?? ''} onChange={(event) => patchSource(key, { sourceProfileUid: event.target.value })} placeholder="UID Profile nguồn" /> : null}
    </div>
  }

  const renderGroup = (category: ChangeInfoCategory) => {
    const items = visibleCatalog.filter((item) => item.category === category)
    if (!items.length) return null
    return <section key={category} className="change-info-group">
      <div className="change-info-group-head"><strong>{CHANGE_INFO_CATEGORY_LABELS[category]}</strong><span>{items.length} mục</span></div>
      <div className="change-info-group-body">{items.map((item) => {
        const action = draft.actions[item.key]
        if (!action) return null
        const ready = item.supportStatus === 'ready' && Boolean(item.actionType)
        return <div key={item.key} className={`change-info-action-row ${action.enabled ? 'enabled' : ''}`}>
          <div className="change-info-action-line">
            <label className="change-info-action-toggle"><input type="checkbox" checked={action.enabled} onChange={(event) => setActionEnabled(item.key, event.target.checked)} /><span title={item.description}>{item.label}</span></label>
            <div className="change-info-action-meta">
              {ready ? <span className="change-info-sensitive">READY</span> : <span className="change-info-sensitive">AUDIT</span>}
              {item.key === 'bio' ? <button type="button" className="change-info-audit-button" disabled={bioAuditBusy || runtimeActive} onClick={() => void runBioAudit()}>{bioAuditBusy ? 'Đang audit…' : 'Audit live'}</button> : null}
              {item.destructive ? <span className="change-info-sensitive">Xác nhận</span> : null}
            </div>
          </div>
          {action.enabled ? renderSourceEditor(item.key) : null}
        </div>
      })}</div>
    </section>
  }

  const canStart = !runtimeBusy && !runtimeActive && !isDirty && enabledAccountCount > 0 && validationErrors.length === 0
  const startMessage = runtimeActive
    ? `${runStateLabel(runtime!.state)} · snapshot đang chạy độc lập với cấu hình UI.`
    : isDirty
      ? 'Lưu cấu hình trước khi chạy.'
      : enabledAccountCount < 1
        ? 'Cần bật ít nhất một tài khoản.'
        : validationErrors[0] ?? `Sẵn sàng: ${enabledAccountCount} tài khoản · ${enabledItems.length} thay đổi đã audit.`

  return <div className="change-info-workspace">
    <header className="change-info-head">
      <div className="change-info-title"><p>ACCOUNT / PROFILE</p><h2>{workspace.label}</h2></div>
      <div className="change-info-head-actions"><span>{isDirty ? 'Có thay đổi chưa lưu' : saveStatus === 'saved' ? 'Đã lưu' : 'Đã đồng bộ'}</span><button type="button" disabled={!isDirty || saveStatus === 'saving' || runtimeActive} onClick={() => void saveWorkspace()}>{saveStatus === 'saving' ? 'Đang lưu…' : 'Lưu cấu hình'}</button></div>
    </header>

    {saveError ? <div className="change-info-alert error">{saveError}</div> : null}
    {presetError ? <div className="change-info-alert error">{presetError}</div> : null}
    {runtimeError ? <div className="change-info-alert error">{runtimeError}</div> : null}
    {bioAuditResult ? <details className={`change-info-audit-result ${bioAuditResult.status}`} open><summary>Audit Tiểu sử · {bioAuditResult.status}</summary><p>{bioAuditResult.message}</p><pre>{JSON.stringify(bioAuditResult, null, 2)}</pre></details> : null}

    <div className="change-info-toolbar">
      <input className="change-info-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm thao tác…" />
      <div className="change-info-preset"><select value={presetId ?? ''} onChange={(event) => applyPreset(event.target.value ? Number(event.target.value) : null)}><option value="">Preset…</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><button type="button" disabled={presetBusy || runtimeActive} onClick={() => void savePreset()}>Lưu preset</button><button type="button" disabled={!presetId || presetBusy || runtimeActive} onClick={() => void deletePreset()}>Xóa</button></div>
      <div className="change-info-mode-note"><span />{runtime ? `Runtime · ${runStateLabel(runtime.state)}` : 'Chỉ action đã live audit mới được phép chạy'}</div>
    </div>

    <div className="change-info-body">
      <aside className="change-info-account-panel">
        <div className="change-info-panel-head"><div><strong>Tài khoản chạy</strong><small>{enabledAccountCount}/{accountBindings.length} đang bật</small></div><button type="button" disabled={runtimeActive} onClick={() => setShowAccountPicker(true)}>Chọn TK</button></div>
        <div className="change-info-account-tools"><button type="button" disabled={runtimeActive} onClick={() => setAllAccountsEnabled(true)}>Chọn tất cả</button><button type="button" disabled={runtimeActive} onClick={() => setAllAccountsEnabled(false)}>Bỏ chọn</button></div>
        <div className="change-info-account-list">{accountBindings.map((binding, index) => {
          const account = accountMap.get(binding.accountId)
          return <label key={binding.accountId} className={`change-info-account-row ${binding.enabled ? 'enabled' : ''}`}><input type="checkbox" disabled={runtimeActive} checked={binding.enabled} onChange={(event) => setAccountEnabled(binding.accountId, event.target.checked)} /><span className="change-info-account-index">{index + 1}</span><span className="change-info-account-text"><strong>{account?.uid ?? `#${binding.accountId}`}</strong><small>{account?.name ?? account?.username ?? 'Không có tên'}</small></span><em>{account ? accountStatusLabel(account.status) : 'Thiếu TK'}</em></label>
        })}{accountBindings.length === 0 ? <div className="change-info-empty-small">Chưa có tài khoản.</div> : null}</div>
      </aside>

      <main className="change-info-main">
        <div className="change-info-groups">{CHANGE_INFO_CATEGORIES.filter((category) => category !== 'workflow').map(renderGroup)}</div>
        <section className="change-info-workflow-panel">
          <div className="change-info-group-head"><strong>Workflow & runtime</strong><span>Common orchestration</span></div>
          <div className="change-info-workflow-grid">
            <label><span>TK chạy song song</span><input type="number" min={1} max={20} value={draft.accountConcurrency} onChange={(event) => { setDraft((current) => ({ ...current, accountConcurrency: Math.min(20, Math.max(1, Number(event.target.value) || 1)) })); markDirty() }} /></label>
            <label><span>Kịch bản trước</span><input type="number" min={1} value={draft.beforeScenarioId ?? ''} placeholder="Chưa nối runtime" onChange={(event) => { setDraft((current) => ({ ...current, beforeScenarioId: event.target.value ? Number(event.target.value) : null })); markDirty() }} /></label>
            <label><span>Kịch bản sau</span><input type="number" min={1} value={draft.afterScenarioId ?? ''} placeholder="Chưa nối runtime" onChange={(event) => { setDraft((current) => ({ ...current, afterScenarioId: event.target.value ? Number(event.target.value) : null })); markDirty() }} /></label>
            <label className="change-info-verify"><input type="checkbox" checked readOnly /><span>Verify sau thay đổi</span></label>
          </div>
          <div className="change-info-order-row"><strong>Thứ tự chạy</strong><div>{enabledItems.map((item, index) => <span key={item.key}><b>{index + 1}. {item.label}</b><button type="button" disabled={runtimeActive || index === 0} onClick={() => moveAction(item.key, -1)}>↑</button><button type="button" disabled={runtimeActive || index === enabledItems.length - 1} onClick={() => moveAction(item.key, 1)}>↓</button></span>)}</div></div>
          <div className="change-info-start-row"><div><strong>{runtime ? runStateLabel(runtime.state) : canStart ? 'Sẵn sàng chạy' : 'Chưa thể chạy'}</strong><p>{runtime?.message ?? startMessage}</p></div><div className="change-info-head-actions">
            {!runtimeActive ? <button type="button" className="change-info-start" disabled={!canStart} onClick={() => void runCommand('start')}>Bắt đầu</button> : null}
            {runtime?.state === 'running' ? <button type="button" onClick={() => void runCommand('pause')} disabled={runtimeBusy}>Pause</button> : null}
            {runtime?.state === 'paused' ? <button type="button" onClick={() => void runCommand('resume')} disabled={runtimeBusy}>Resume</button> : null}
            {runtimeActive ? <button type="button" onClick={() => void runCommand('stop')} disabled={runtimeBusy || runtime?.state === 'stopping'}>Stop</button> : null}
          </div></div>
        </section>

        {runtime ? <details className={`change-info-audit-result ${runtime.state === 'success' ? 'success' : runtime.state === 'needs_attention' ? 'needs_attention' : runtime.state === 'failed' ? 'failed' : ''}`} open>
          <summary>Runtime · {runStateLabel(runtime.state)} · {runtime.runId}</summary>
          <p>{runtime.message ?? 'Đang cập nhật trạng thái…'}</p>
          <div>{runtime.accounts.map((account) => <div key={account.accountId} className="change-info-action-row"><strong>{account.uid} · {account.state}</strong>{account.message ? <p>{account.message}</p> : null}{account.results.map((result) => <p key={`${result.key}-${result.startedAt}`}>{result.label}: <b>{result.status}</b>{result.code ? ` · ${result.code}` : ''}{result.message ? ` · ${result.message}` : ''}</p>)}</div>)}</div>
          <pre>{runtime.logs.slice(-20).map((entry) => `[${new Date(entry.at).toLocaleTimeString('vi-VN')}]${entry.accountId ? ` ACC#${entry.accountId}` : ''}${entry.actionType ? ` ${entry.actionType}` : ''} ${entry.message}`).join('\n')}</pre>
        </details> : null}
      </main>
    </div>

    {showAccountPicker ? <AccountBindingPickerModal accounts={availableAccounts} selectedIds={selectedIds} onApply={applyAccountSelection} onClose={() => setShowAccountPicker(false)} contextLabel="Sửa thông tin" /> : null}
  </div>
}
