import { useRef, useState } from 'react'
import { ScenarioWorkspace } from '../scenarios/ScenarioWorkspace'
import { InteractionWorkspace } from './InteractionWorkspace'
import { ACTION_WORKSPACE_DEFINITIONS, getActionWorkspaceDefinition, type ActionWorkspaceType } from './actionWorkspaceRegistry'
import './actionWorkspace.css'

const SCENARIO_TAB_ID = 'scenario'

interface WorkspaceTab {
  id: string
  type: ActionWorkspaceType
  label: string
}

export function ActionWorkspace() {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([])
  const [activeTabId, setActiveTabId] = useState(SCENARIO_TAB_ID)
  const [showTabPicker, setShowTabPicker] = useState(false)
  const nextInstanceByType = useRef<Record<string, number>>({})

  const createWorkspaceTab = (type: ActionWorkspaceType) => {
    const definition = getActionWorkspaceDefinition(type)
    if (!definition) return
    const instance = (nextInstanceByType.current[type] ?? 0) + 1
    nextInstanceByType.current[type] = instance
    const tab: WorkspaceTab = {
      id: `${type}-${instance}`,
      type,
      label: instance === 1 ? definition.label : `${definition.label} ${instance}`
    }
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
    setShowTabPicker(false)
  }

  const closeWorkspaceTab = (tabId: string) => {
    const index = tabs.findIndex((tab) => tab.id === tabId)
    const fallbackId = index > 0 ? tabs[index - 1]?.id ?? SCENARIO_TAB_ID : SCENARIO_TAB_ID
    setTabs((current) => current.filter((tab) => tab.id !== tabId))
    setActiveTabId((current) => current === tabId ? fallbackId : current)
  }

  return (
    <section className="action-workspace" aria-label="Hành động">
      <header className="action-workspace-tabs">
        <div className="action-workspace-tab-list" role="tablist" aria-label="Các tab Hành động">
          <button className={activeTabId === SCENARIO_TAB_ID ? 'action-workspace-tab active' : 'action-workspace-tab'} type="button" role="tab" aria-selected={activeTabId === SCENARIO_TAB_ID} onClick={() => setActiveTabId(SCENARIO_TAB_ID)}>
            Kịch bản
          </button>
          {tabs.map((tab) => (
            <div className={activeTabId === tab.id ? 'action-workspace-tab-wrap active' : 'action-workspace-tab-wrap'} key={tab.id}>
              <button className="action-workspace-tab" type="button" role="tab" aria-selected={activeTabId === tab.id} onClick={() => setActiveTabId(tab.id)}>{tab.label}</button>
              <button className="action-workspace-close-tab" type="button" aria-label={`Đóng tab ${tab.label}`} onClick={() => closeWorkspaceTab(tab.id)}>×</button>
            </div>
          ))}
        </div>

        <div className="action-workspace-extension">
          <button className="action-workspace-add-tab" type="button" aria-expanded={showTabPicker} aria-controls="action-workspace-tab-picker" onClick={() => setShowTabPicker((current) => !current)}>+ Tab</button>
          {showTabPicker ? (
            <div id="action-workspace-tab-picker" className="action-workspace-tab-picker" role="dialog" aria-label="Chọn tab nghiệp vụ">
              <div className="action-workspace-tab-picker-head"><div><small>WORKSPACE TYPE</small><strong>Chọn tab nghiệp vụ</strong></div><button type="button" aria-label="Đóng chọn tab" onClick={() => setShowTabPicker(false)}>×</button></div>
              <div className="action-workspace-tab-picker-list">
                {ACTION_WORKSPACE_DEFINITIONS.map((definition) => (
                  <button type="button" key={definition.id} onClick={() => createWorkspaceTab(definition.id)}><span><strong>{definition.label}</strong><small>{definition.description}</small></span><b>+</b></button>
                ))}
              </div>
              <p>Đây là tab nghiệp vụ lớn. Action nhỏ vẫn lấy từ Action Registry và có thể được compose nhiều module trong cùng tab.</p>
            </div>
          ) : null}
        </div>
      </header>

      <div className="action-workspace-body">
        <div className="action-workspace-panel" role="tabpanel" aria-label="Kịch bản" hidden={activeTabId !== SCENARIO_TAB_ID}><ScenarioWorkspace /></div>
        {tabs.map((tab) => (
          <div className="action-workspace-panel" role="tabpanel" aria-label={tab.label} hidden={activeTabId !== tab.id} key={tab.id}>
            {tab.type === 'interaction' ? <InteractionWorkspace instanceLabel={tab.label} /> : null}
          </div>
        ))}
      </div>
    </section>
  )
}
