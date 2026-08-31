import { useState } from 'react'
import { ScenarioWorkspace } from '../scenarios/ScenarioWorkspace'
import './actionWorkspace.css'

export function ActionWorkspace() {
  const [showExtensionHint, setShowExtensionHint] = useState(false)

  return (
    <section className="action-workspace" aria-label="Hành động">
      <header className="action-workspace-tabs">
        <div className="action-workspace-tab-list" role="tablist" aria-label="Các tab Hành động">
          <button className="action-workspace-tab active" type="button" role="tab" aria-selected="true">
            Kịch bản
          </button>
        </div>

        <div className="action-workspace-extension">
          <button
            className="action-workspace-add-tab"
            type="button"
            aria-expanded={showExtensionHint}
            aria-controls="action-workspace-extension-hint"
            onClick={() => setShowExtensionHint((current) => !current)}
          >
            + Tab
          </button>
          {showExtensionHint ? (
            <div id="action-workspace-extension-hint" className="action-workspace-extension-hint" role="status">
              <span>Chọn loại hành động sẽ được bổ sung ở lô sau.</span>
              <button type="button" aria-label="Đóng thông báo" onClick={() => setShowExtensionHint(false)}>×</button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="action-workspace-body" role="tabpanel" aria-label="Kịch bản">
        <ScenarioWorkspace />
      </div>
    </section>
  )
}
