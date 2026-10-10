import type { AiApiConnectionView } from '../../../shared/aiApiConnections'
import { AiApiConnectionPanel } from './AiApiConnectionPanel'
import './aiAgentManager.css'

interface AiConnectionManagerProps {
  apiConnections: AiApiConnectionView[]
  onApiConnectionsChange: (connections: AiApiConnectionView[]) => void
  onClose: () => void
}

export function AiAgentManagerModal({
  apiConnections,
  onApiConnectionsChange,
  onClose
}: AiConnectionManagerProps) {
  return (
    <div
      className="ai-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}
    >
      <section
        className="ai-agent-modal ai-api-only-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Quản lý AI"
      >
        <header className="ai-agent-modal-header">
          <div>
            <p>AI / API & MODEL</p>
            <h2>Quản lý kết nối AI</h2>
            <span>Thêm API hoặc JSON cấu hình, tải model để chọn và lưu cho lần dùng tiếp theo.</span>
          </div>
          <button type="button" aria-label="Đóng" onClick={onClose}>×</button>
        </header>

        <div className="ai-agent-modal-body ai-api-only-body">
          <section className="ai-agent-import-panel ai-agent-manager-main" aria-label="Thiết lập kết nối API">
            <AiApiConnectionPanel
              connections={apiConnections}
              onConnectionsChange={onApiConnectionsChange}
            />
          </section>
        </div>

        <footer className="ai-agent-modal-footer">
          <button type="button" onClick={onClose}>Đóng</button>
        </footer>
      </section>
    </div>
  )
}
