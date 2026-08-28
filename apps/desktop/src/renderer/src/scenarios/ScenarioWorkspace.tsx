import { useState } from 'react'
import { ScenarioManager } from './ScenarioManager'
import { ScenarioRunnerDashboard } from './ScenarioRunnerDashboard'
import './scenarioRunnerDashboard.css'

export function ScenarioWorkspace() {
  const [mode, setMode] = useState<'runner' | 'manager'>('runner')

  if (mode === 'manager') {
    return (
      <section className="scenario-manager-mode">
        <div className="scenario-manager-mode-bar">
          <button type="button" onClick={() => setMode('runner')}>← Chạy Kịch Bản</button>
          <span>Quản lý thư viện kịch bản và cấu hình từng action.</span>
        </div>
        <ScenarioManager />
      </section>
    )
  }

  return <ScenarioRunnerDashboard onOpenManager={() => setMode('manager')} />
}
