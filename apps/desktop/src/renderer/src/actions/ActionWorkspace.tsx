import { useEffect, useState } from 'react'
import type { AccountRecord } from '../../../shared/accounts'
import type { ActionWorkspaceRecord, ActionWorkspaceType } from '../../../shared/actionWorkspaces'
import { ScenarioWorkspace } from '../scenarios/ScenarioWorkspace'
import { InteractionWorkspace } from './InteractionWorkspace'
import { ACTION_WORKSPACE_DEFINITIONS, getActionWorkspaceDefinition } from './actionWorkspaceRegistry'
import { DEFAULT_INTERACTION_WORKSPACE_DRAFT, serializeInteractionWorkspaceDraft } from './interactionWorkspaceModel'
import './actionWorkspace.css'

const SCENARIO_TAB_ID = 'scenario'

function workspaceTabId(id: number): string {
  return `workspace-${id}`
}

function defaultConfigJson(type: ActionWorkspaceType): string {
  if (type === 'interaction') return serializeInteractionWorkspaceDraft(DEFAULT_INTERACTION_WORKSPACE_DRAFT)
  return '{}'
}

function nextWorkspaceLabel(type: ActionWorkspaceType, workspaces: ActionWorkspaceRecord[]): string {
  const definition = getActionWorkspaceDefinition(type)
  if (!definition) return type
  const usedLabels = new Set(workspaces.filter((workspace) => workspace.type === type).map((workspace) => workspace.label))
  let instance = 1
  while (usedLabels.has(instance === 1 ? definition.label : `${definition.label} ${instance}`)) instance += 1
  return instance === 1 ? definition.label : `${definition.label} ${instance}`
}

export function ActionWorkspace() {
  const [tabs, setTabs] = useState<ActionWorkspaceRecord[]>([])
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [activeTabId, setActiveTabId] = useState(SCENARIO_TAB_ID)
  const [showTabPicker, setShowTabPicker] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadWorkspaceState = async () => {
    setLoading(true)
    setError(null)
    try {
      const [savedWorkspaces, accountRows] = await Promise.all([
        window.pageAuto.listActionWorkspaces(),
        window.pageAuto.listAccounts()
      ])
      setTabs(savedWorkspaces)
      setAccounts(accountRows)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadWorkspaceState()
  }, [])

  const createWorkspaceTab = async (type: ActionWorkspaceType) => {
    const definition = getActionWorkspaceDefinition(type)
    if (!definition || mutating) return
    setMutating(true)
    setError(null)
    try {
      const created = await window.pageAuto.createActionWorkspace({
        type,
        label: nextWorkspaceLabel(type, tabs),
        configJson: defaultConfigJson(type),
        accounts: []
      })
      setTabs((current) => [...current, created])
      setActiveTabId(workspaceTabId(created.id))
      setShowTabPicker(false)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setMutating(false)
    }
  }

  const closeWorkspaceTab = async (workspace: ActionWorkspaceRecord) => {
    if (mutating || !window.confirm(`Xóa tab “${workspace.label}” và cấu hình đã lưu?`)) return
    const index = tabs.findIndex((tab) => tab.id === workspace.id)
    const fallback = index > 0 ? tabs[index - 1] : null
    setMutating(true)
    setError(null)
    try {
      await window.pageAuto.deleteActionWorkspace({ id: workspace.id })
      setTabs((current) => current.filter((tab) => tab.id !== workspace.id))
      setActiveTabId((current) => current === workspaceTabId(workspace.id)
        ? (fallback ? workspaceTabId(fallback.id) : SCENARIO_TAB_ID)
        : current)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    } finally {
      setMutating(false)
    }
  }

  const handleWorkspaceSaved = (saved: ActionWorkspaceRecord) => {
    setTabs((current) => current.map((workspace) => workspace.id === saved.id ? saved : workspace))
  }

  return (
    <section className="action-workspace" aria-label="Hành động">
      <header className="action-workspace-tabs">
        <div className="action-workspace-tab-list" role="tablist" aria-label="Các tab Hành động">
          <button className={activeTabId === SCENARIO_TAB_ID ? 'action-workspace-tab active' : 'action-workspace-tab'} type="button" role="tab" aria-selected={activeTabId === SCENARIO_TAB_ID} onClick={() => setActiveTabId(SCENARIO_TAB_ID)}>
            Kịch bản
          </button>
          {tabs.map((tab) => (
            <div className={activeTabId === workspaceTabId(tab.id) ? 'action-workspace-tab-wrap active' : 'action-workspace-tab-wrap'} key={tab.id}>
              <button className="action-workspace-tab" type="button" role="tab" aria-selected={activeTabId === workspaceTabId(tab.id)} onClick={() => setActiveTabId(workspaceTabId(tab.id))}>{tab.label}</button>
              <button className="action-workspace-close-tab" type="button" aria-label={`Đóng tab ${tab.label}`} disabled={mutating} onClick={() => void closeWorkspaceTab(tab)}>×</button>
            </div>
          ))}
        </div>

        <div className="action-workspace-extension">
          <button className="action-workspace-add-tab" type="button" disabled={loading || mutating} aria-expanded={showTabPicker} aria-controls="action-workspace-tab-picker" onClick={() => setShowTabPicker((current) => !current)}>+ Tab</button>
          {showTabPicker ? (
            <div id="action-workspace-tab-picker" className="action-workspace-tab-picker" role="dialog" aria-label="Chọn tab nghiệp vụ">
              <div className="action-workspace-tab-picker-head"><div><small>WORKSPACE TYPE</small><strong>Chọn tab nghiệp vụ</strong></div><button type="button" aria-label="Đóng chọn tab" onClick={() => setShowTabPicker(false)}>×</button></div>
              <div className="action-workspace-tab-picker-list">
                {ACTION_WORKSPACE_DEFINITIONS.map((definition) => (
                  <button type="button" disabled={mutating} key={definition.id} onClick={() => void createWorkspaceTab(definition.id)}><span><strong>{definition.label}</strong><small>{definition.description}</small></span><b>+</b></button>
                ))}
              </div>
              <p>Tab nghiệp vụ được lưu trong SQLite. Action nhỏ vẫn lấy từ Action Registry và có thể compose nhiều module trong cùng tab.</p>
            </div>
          ) : null}
        </div>
      </header>

      {error ? <div className="action-workspace-persistence-error"><span>{error}</span><button type="button" onClick={() => void loadWorkspaceState()}>Thử lại</button></div> : null}
      {loading ? <div className="action-workspace-loading">Đang tải tab Hành động và danh sách tài khoản…</div> : null}

      <div className="action-workspace-body">
        <div className="action-workspace-panel" role="tabpanel" aria-label="Kịch bản" hidden={activeTabId !== SCENARIO_TAB_ID}><ScenarioWorkspace /></div>
        {tabs.map((tab) => (
          <div className="action-workspace-panel" role="tabpanel" aria-label={tab.label} hidden={activeTabId !== workspaceTabId(tab.id)} key={tab.id}>
            {tab.type === 'interaction' ? <InteractionWorkspace workspace={tab} availableAccounts={accounts} onWorkspaceSaved={handleWorkspaceSaved} /> : null}
          </div>
        ))}
      </div>
    </section>
  )
}
