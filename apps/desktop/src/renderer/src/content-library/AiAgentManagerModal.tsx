import { useEffect, useMemo, useState } from 'react'
import type { AiAgentCatalogView, AiAgentImportResult, AiAgentRecord } from '../../../shared/aiAgents'
import './aiAgentManager.css'

interface AiAgentManagerModalProps {
  catalog: AiAgentCatalogView
  onCatalogChange: (catalog: AiAgentCatalogView) => void
  onClose: () => void
}

type Notice = { kind: 'success' | 'warning' | 'error'; message: string } | null

function describeConnection(result: AiAgentImportResult): Notice {
  const total = result.catalog.agents.length
  const project = result.catalog.projectId ? `project ${result.catalog.projectId}` : 'Google Cloud'
  const base = `Đã kết nối ${project} và nhận ${total} Agent đã deploy.`
  if (result.warnings.length) {
    return { kind: 'warning', message: `${base} ${result.warnings.join(' ')}` }
  }
  return { kind: 'success', message: base }
}

function shortDescription(agent: AiAgentRecord): string {
  if (agent.description.trim()) return agent.description.trim()
  return 'Agent đã deploy trên Google Agent Runtime.'
}

function resourceId(agent: AiAgentRecord): string {
  return agent.providerId.split('/').at(-1) ?? agent.providerId
}

export function AiAgentManagerModal({
  catalog,
  onCatalogChange,
  onClose
}: AiAgentManagerModalProps) {
  const [selectedId, setSelectedId] = useState(
    catalog.defaultAgentId ?? catalog.agents[0]?.id ?? ''
  )
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

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
      setNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : String(cause)
      })
    } finally {
      setBusy(false)
    }
  }

  const connectAgentBuilder = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await window.pageAuto.importAiAgentJson()
      if (!result) return
      onCatalogChange(result.catalog)
      setSelectedId(result.catalog.defaultAgentId ?? result.catalog.agents[0]?.id ?? '')
      setNotice(describeConnection(result))
    } catch (cause) {
      setNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : String(cause)
      })
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (
      !window.confirm(
        'Ngắt kết nối Google Cloud trên máy này? Danh sách Agent local sẽ được xóa, bài đã lưu trong Thư viện không bị ảnh hưởng.'
      )
    ) {
      return
    }
    await runCatalogOperation(() => window.pageAuto.clearGeminiApiKey())
  }

  return (
    <div
      className="ai-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose()
      }}
    >
      <section
        className="ai-agent-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Quản lý Agent"
      >
        <header className="ai-agent-modal-header">
          <div>
            <p>AI / AGENT BUILDER</p>
            <h2>Quản lý Agent</h2>
            <span>Kết nối Google Cloud rồi chọn Agent đã deploy để tạo bài.</span>
          </div>
          <button type="button" aria-label="Đóng" disabled={busy} onClick={onClose}>×</button>
        </header>

        <div className="ai-agent-modal-body">
          <aside className="ai-agent-list-panel">
            <div className="ai-agent-list-heading">
              <strong>Agent đã deploy</strong>
              <span>{catalog.agents.length}</span>
            </div>
            <div className="ai-agent-list-scroll">
              {catalog.agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className={agent.id === selectedId ? 'ai-agent-row active' : 'ai-agent-row'}
                  onClick={() => setSelectedId(agent.id)}
                >
                  <span className={agent.enabled ? 'ai-agent-dot enabled' : 'ai-agent-dot'} />
                  <span className="ai-agent-row-copy">
                    <strong>{agent.name}</strong>
                    <small>{agent.location}</small>
                  </span>
                  {agent.isDefault ? <b title="Agent mặc định">★</b> : null}
                </button>
              ))}
              {!catalog.agents.length ? (
                <div className="ai-agent-list-empty">
                  <span aria-hidden="true">◇</span>
                  <strong>Chưa có Agent</strong>
                  <p>Kết nối Google Cloud để tải Agent đã deploy.</p>
                </div>
              ) : null}
            </div>
          </aside>

          <section className="ai-agent-import-panel ai-agent-manager-main">
            <div className="ai-agent-import-card">
              <div className="ai-import-icon" aria-hidden="true">⇧</div>
              <div>
                <strong>Kết nối Google Agent Builder</strong>
                <p>
                  Chọn service-account JSON của Google Cloud. Page-Auto dùng file này để xác thực,
                  quét Agent Runtime trong project và lấy danh sách Agent đã deploy.
                </p>
              </div>
              <button
                className="ai-primary-button"
                type="button"
                disabled={busy}
                onClick={() => void connectAgentBuilder()}
              >
                {busy ? 'Đang kết nối...' : catalog.credentialConfigured ? 'Kết nối lại' : 'Chọn credential JSON'}
              </button>
            </div>

            {notice ? (
              <div className={`ai-agent-manager-notice ${notice.kind}`}>{notice.message}</div>
            ) : null}

            <div className="ai-agent-manager-grid">
              <div className="ai-agent-detail-card">
                <div className="ai-agent-detail-heading">
                  <div>
                    <strong>Agent đang chọn</strong>
                    <small>Đây là Agent Builder đã deploy, không phải model Gemini gọi trực tiếp.</small>
                  </div>
                  {selected?.isDefault ? <span>Mặc định</span> : null}
                </div>

                {selected ? (
                  <>
                    <div className="ai-agent-detail-title">
                      <strong>{selected.name}</strong>
                      <span>{selected.location}</span>
                    </div>
                    <p className="ai-agent-description">{shortDescription(selected)}</p>
                    <div className="ai-agent-meta-line">
                      <span>Project</span>
                      <strong>{selected.projectId}</strong>
                    </div>
                    <div className="ai-agent-meta-line">
                      <span>Agent Runtime ID</span>
                      <strong>{resourceId(selected)}</strong>
                    </div>
                    <div className="ai-agent-meta-line">
                      <span>Nguồn</span>
                      <strong>Google Agent Runtime</strong>
                    </div>
                    <div className="ai-agent-actions">
                      <label>
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={selected.enabled}
                          onChange={(event) => void runCatalogOperation(
                            () => window.pageAuto.setAiAgentEnabled({
                              agentId: selected.id,
                              enabled: event.target.checked
                            })
                          )}
                        />
                        Bật Agent
                      </label>
                      <button
                        type="button"
                        disabled={busy || !selected.enabled || selected.isDefault}
                        onClick={() => void runCatalogOperation(
                          () => window.pageAuto.setDefaultAiAgent({ agentId: selected.id })
                        )}
                      >
                        ★ Đặt mặc định
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="ai-agent-detail-empty">
                    Kết nối Google Cloud và chọn một Agent đã deploy.
                  </div>
                )}
              </div>

              <div className="ai-agent-secret-card">
                <div className="ai-agent-detail-heading">
                  <div>
                    <strong>Kết nối Google Cloud</strong>
                    <small>Service account được mã hóa local; private key không hiện lại trên UI.</small>
                  </div>
                  <span className={catalog.credentialConfigured ? 'configured' : 'missing'}>
                    {catalog.credentialConfigured ? 'Đã kết nối' : 'Chưa kết nối'}
                  </span>
                </div>

                <div className="ai-agent-meta-line">
                  <span>Project</span>
                  <strong>{catalog.projectId ?? '—'}</strong>
                </div>
                <div className="ai-agent-meta-line">
                  <span>Service account</span>
                  <strong>{catalog.serviceAccountEmail ?? '—'}</strong>
                </div>
                <div className="ai-agent-meta-line">
                  <span>Lần quét Agent</span>
                  <strong>
                    {catalog.lastSyncAt
                      ? new Date(catalog.lastSyncAt).toLocaleString('vi-VN')
                      : '—'}
                  </strong>
                </div>

                <div className="ai-agent-secret-actions">
                  <button
                    type="button"
                    disabled={busy || !catalog.credentialConfigured}
                    onClick={() => void disconnect()}
                  >
                    Ngắt kết nối
                  </button>
                </div>
                <p>
                  File credential chỉ dùng để lấy OAuth access token cho Google Agent Runtime.
                  Page-Auto không gọi Gemini API trực tiếp trong luồng này.
                </p>
              </div>
            </div>

            <div className="ai-agent-policy">
              <div>
                <strong>Đúng Agent Builder</strong>
                <p>Agent, instructions và tools chạy ở Agent Runtime như anh đã build.</p>
              </div>
              <div>
                <strong>Credential tách riêng</strong>
                <p>Service-account JSON là khóa kết nối, không bị hiểu nhầm thành Agent.</p>
              </div>
              <div>
                <strong>Bài vẫn độc lập</strong>
                <p>Ngắt Agent không xóa bài đã lưu trong Thư viện gốc.</p>
              </div>
            </div>
          </section>
        </div>

        <footer className="ai-agent-modal-footer">
          <button type="button" disabled={busy} onClick={onClose}>Đóng</button>
        </footer>
      </section>
    </div>
  )
}
