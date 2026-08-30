import { useEffect, useMemo, useState } from 'react'
import type { AiAgentCatalogView, AiAgentImportResult, AiAgentRecord } from '../../../shared/aiAgents'
import './aiAgentManager.css'

interface AiAgentManagerModalProps {
  catalog: AiAgentCatalogView
  onCatalogChange: (catalog: AiAgentCatalogView) => void
  onClose: () => void
}

type Notice = { kind: 'success' | 'warning' | 'error'; message: string } | null

function describeImport(result: AiAgentImportResult): Notice {
  const changed = result.importedCount + result.updatedCount
  const base = `Đã nhận ${changed} Agent từ ${result.fileName}: ${result.importedCount} mới, ${result.updatedCount} cập nhật.`
  if (result.warnings.length) return { kind: 'warning', message: `${base} ${result.warnings.join(' ')}` }
  return { kind: 'success', message: base }
}

function shortInstructions(agent: AiAgentRecord): string {
  if (agent.description.trim()) return agent.description.trim()
  if (agent.instructions.trim()) return agent.instructions.trim().replace(/\s+/g, ' ').slice(0, 150)
  return 'Agent chưa có mô tả/instructions trong file import.'
}

export function AiAgentManagerModal({ catalog, onCatalogChange, onClose }: AiAgentManagerModalProps) {
  const [selectedId, setSelectedId] = useState(catalog.defaultAgentId ?? catalog.agents[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [apiKey, setApiKey] = useState('')

  useEffect(() => {
    if (selectedId && catalog.agents.some((agent) => agent.id === selectedId)) return
    setSelectedId(catalog.defaultAgentId ?? catalog.agents[0]?.id ?? '')
  }, [catalog.agents, catalog.defaultAgentId, selectedId])

  const selected = useMemo(
    () => catalog.agents.find((agent) => agent.id === selectedId) ?? null,
    [catalog.agents, selectedId]
  )

  const runCatalogOperation = async (operation: () => Promise<AiAgentCatalogView>) => {
    setBusy(true)
    setNotice(null)
    try {
      onCatalogChange(await operation())
    } catch (cause) {
      setNotice({ kind: 'error', message: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setBusy(false)
    }
  }

  const importAgent = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await window.pageAuto.importAiAgentJson()
      if (!result) return
      onCatalogChange(result.catalog)
      setSelectedId(result.catalog.defaultAgentId ?? result.catalog.agents[0]?.id ?? '')
      setNotice(describeImport(result))
    } catch (cause) {
      setNotice({ kind: 'error', message: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setBusy(false)
    }
  }

  const saveApiKey = async () => {
    if (!apiKey.trim()) {
      setNotice({ kind: 'error', message: 'Nhập Gemini API key trước khi lưu.' })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const next = await window.pageAuto.saveGeminiApiKey({ apiKey })
      onCatalogChange(next)
      setApiKey('')
      setNotice({ kind: 'success', message: 'Đã mã hóa và lưu Gemini API key trên máy này.' })
    } catch (cause) {
      setNotice({ kind: 'error', message: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setBusy(false)
    }
  }

  const deleteSelected = async () => {
    if (!selected || !window.confirm(`Xóa Agent “${selected.name}” khỏi Page-Auto? Bài đã lưu trong Thư viện không bị xóa.`)) return
    await runCatalogOperation(() => window.pageAuto.deleteAiAgent({ agentId: selected.id }))
  }

  return (
    <div className="ai-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose() }}>
      <section className="ai-agent-modal" role="dialog" aria-modal="true" aria-label="Quản lý Agent">
        <header className="ai-agent-modal-header">
          <div><p>AI / AGENT</p><h2>Quản lý Agent</h2><span>Import Agent, chọn Agent dùng và cấu hình kết nối ngay tại đây.</span></div>
          <button type="button" aria-label="Đóng" disabled={busy} onClick={onClose}>×</button>
        </header>

        <div className="ai-agent-modal-body">
          <aside className="ai-agent-list-panel">
            <div className="ai-agent-list-heading"><strong>Agent đã import</strong><span>{catalog.agents.length}</span></div>
            <div className="ai-agent-list-scroll">
              {catalog.agents.map((agent) => (
                <button key={agent.id} type="button" className={agent.id === selectedId ? 'ai-agent-row active' : 'ai-agent-row'} onClick={() => setSelectedId(agent.id)}>
                  <span className={agent.enabled ? 'ai-agent-dot enabled' : 'ai-agent-dot'} />
                  <span className="ai-agent-row-copy"><strong>{agent.name}</strong><small>{agent.model}</small></span>
                  {agent.isDefault ? <b title="Agent mặc định">★</b> : null}
                </button>
              ))}
              {!catalog.agents.length ? <div className="ai-agent-list-empty"><span aria-hidden="true">◇</span><strong>Chưa có Agent</strong><p>Import file JSON để bắt đầu.</p></div> : null}
            </div>
          </aside>

          <section className="ai-agent-import-panel ai-agent-manager-main">
            <div className="ai-agent-import-card">
              <div className="ai-import-icon" aria-hidden="true">⇧</div>
              <div><strong>Import / cập nhật Agent JSON</strong><p>Page-Auto nhận Agent phổ biến theo name, instructions, model, tools và chỉ lưu phần cần dùng. Metadata kỹ thuật không làm rối giao diện.</p></div>
              <button className="ai-primary-button" type="button" disabled={busy} onClick={() => void importAgent()}>{busy ? 'Đang xử lý...' : 'Chọn file JSON'}</button>
            </div>

            {notice ? <div className={`ai-agent-manager-notice ${notice.kind}`}>{notice.message}</div> : null}

            <div className="ai-agent-manager-grid">
              <div className="ai-agent-detail-card">
                <div className="ai-agent-detail-heading"><div><strong>Agent đang chọn</strong><small>Thông tin dễ đọc; ID/provider metadata được giữ phía trong.</small></div>{selected?.isDefault ? <span>Mặc định</span> : null}</div>
                {selected ? (
                  <>
                    <div className="ai-agent-detail-title"><strong>{selected.name}</strong><span>{selected.model}</span></div>
                    <p className="ai-agent-description">{shortInstructions(selected)}</p>
                    <div className="ai-agent-meta-line"><span>Nguồn</span><strong>{selected.sourceFileName}</strong></div>
                    <div className="ai-agent-meta-line"><span>Định dạng nhận diện</span><strong>{selected.sourceFormat}</strong></div>
                    <div className="ai-agent-meta-line"><span>Tools</span><strong>{selected.tools.length ? `${selected.tools.length} tool` : 'Không có'}</strong></div>
                    <div className="ai-agent-actions">
                      <label><input type="checkbox" disabled={busy} checked={selected.enabled} onChange={(event) => void runCatalogOperation(() => window.pageAuto.setAiAgentEnabled({ agentId: selected.id, enabled: event.target.checked }))} /> Bật Agent</label>
                      <button type="button" disabled={busy || !selected.enabled || selected.isDefault} onClick={() => void runCatalogOperation(() => window.pageAuto.setDefaultAiAgent({ agentId: selected.id }))}>★ Đặt mặc định</button>
                      <button className="danger" type="button" disabled={busy} onClick={() => void deleteSelected()}>Xóa</button>
                    </div>
                    {selected.tools.length ? <div className="ai-agent-tool-warning">Agent có tools: {selected.tools.join(', ')}. Runtime hiện tạo nội dung bằng model + instructions; tool external không tự chạy.</div> : null}
                  </>
                ) : <div className="ai-agent-detail-empty">Import hoặc chọn một Agent để xem chi tiết.</div>}
              </div>

              <div className="ai-agent-secret-card">
                <div className="ai-agent-detail-heading"><div><strong>Kết nối Gemini</strong><small>Key được mã hóa local, không lưu vào Agent JSON.</small></div><span className={catalog.credentialConfigured ? 'configured' : 'missing'}>{catalog.credentialConfigured ? 'Đã cấu hình' : 'Chưa có key'}</span></div>
                <label className="ai-agent-secret-field"><span>Gemini API key</span><input type="password" autoComplete="off" value={apiKey} disabled={busy} onChange={(event) => setApiKey(event.target.value)} placeholder={catalog.credentialConfigured ? 'Nhập key mới nếu muốn thay' : 'Nhập API key'} /></label>
                <div className="ai-agent-secret-actions"><button className="ai-primary-button" type="button" disabled={busy || !apiKey.trim()} onClick={() => void saveApiKey()}>Lưu key</button><button type="button" disabled={busy || !catalog.credentialConfigured} onClick={() => void runCatalogOperation(() => window.pageAuto.clearGeminiApiKey())}>Xóa key</button></div>
                <p>Page-Auto không đọc ngược key ra UI và không ghi plaintext vào log. Trên Windows key được bảo vệ bằng cơ chế mã hóa của Electron/OS.</p>
              </div>
            </div>

            <div className="ai-agent-policy">
              <div><strong>Import là dùng được</strong><p>Đọc Agent → hiện ngay bên trái → dropdown AI cập nhật ngay.</p></div>
              <div><strong>Ẩn phần kỹ thuật</strong><p>Chỉ giữ metadata cần cho runtime, không show ID/global rối mắt.</p></div>
              <div><strong>Bài vẫn độc lập</strong><p>Xóa Agent không xóa bài đã lưu trong Thư viện gốc.</p></div>
            </div>
          </section>
        </div>

        <footer className="ai-agent-modal-footer"><button type="button" disabled={busy} onClick={onClose}>Đóng</button></footer>
      </section>
    </div>
  )
}
