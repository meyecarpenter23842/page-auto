import { useEffect, useMemo, useState } from 'react'
import type {
  AiAgentCatalogView,
  AiContentAction,
  GenerateAiPostsResult
} from '../../../shared/aiAgents'
import { AiAgentManagerModal } from './AiAgentManagerModal'
import { AiDraftResultsPanel, type AiIncomingDraftBatch } from './AiDraftResultsPanel'
import { captureAiRequestContext } from './aiDraftResults'
import { AI_POST_DELIMITER, parseAiPostOutput } from './aiPostOutputFormat'
import './aiContentWorkspace.css'
import './aiContentWorkspaceModes.css'

const POST_TYPES = ['Bán hàng', 'Chia sẻ', 'Review', 'Giới thiệu'] as const
const TONES = ['Tự nhiên', 'Gần gũi', 'Chuyên nghiệp', 'Ngắn gọn'] as const
const STRUCTURES = [
  'Trộn bố cục',
  'Hook → Ý chính → CTA',
  'Vấn đề → Giải pháp → Liên hệ',
  'Hook → Bullet → CTA',
  'Hỏi → Trả lời → Gợi ý',
  'Thông tin nhanh',
  'Chia sẻ tự nhiên'
] as const
const LENGTHS = ['Ngắn', 'Trung bình', 'Dài'] as const

const EMPTY_CATALOG: AiAgentCatalogView = {
  agents: [],
  defaultAgentId: null,
  credentialConfigured: false,
  projectId: null,
  serviceAccountEmail: null,
  lastSyncAt: null
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function AiContentWorkspaceAgentBuilder() {
  const [agentManagerOpen, setAgentManagerOpen] = useState(false)
  const [catalog, setCatalog] = useState<AiAgentCatalogView>(EMPTY_CATALOG)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState('')
  const [action, setAction] = useState<AiContentAction>('create')
  const [subject, setSubject] = useState('')
  const [sourceInfo, setSourceInfo] = useState('')
  const [highlight, setHighlight] = useState('')
  const [audience, setAudience] = useState('')
  const [randomSource, setRandomSource] = useState('')
  const [postType, setPostType] = useState<(typeof POST_TYPES)[number]>('Bán hàng')
  const [tone, setTone] = useState<(typeof TONES)[number]>('Tự nhiên')
  const [structure, setStructure] = useState<(typeof STRUCTURES)[number]>('Trộn bố cục')
  const [length, setLength] = useState<(typeof LENGTHS)[number]>('Trung bình')
  const [postCount, setPostCount] = useState(5)
  const [emoji, setEmoji] = useState(true)
  const [hashtag, setHashtag] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [generationVersion, setGenerationVersion] = useState(0)
  const [incomingBatch, setIncomingBatch] = useState<AiIncomingDraftBatch | null>(null)
  const [resultAction, setResultAction] = useState<AiContentAction>('create')
  const [resultPostCount, setResultPostCount] = useState(5)

  const enabledAgents = useMemo(
    () => catalog.agents.filter((agent) => agent.enabled),
    [catalog.agents]
  )
  const currentAgent = useMemo(
    () => enabledAgents.find((agent) => agent.id === selectedAgent) ?? null,
    [enabledAgents, selectedAgent]
  )
  const randomSourcePosts = useMemo(
    () => parseAiPostOutput(randomSource),
    [randomSource]
  )

  useEffect(() => {
    let active = true
    void window.pageAuto.getAiAgentCatalog()
      .then((next) => {
        if (!active) return
        setCatalog(next)
        setCatalogError(null)
        const initial = next.defaultAgentId
          && next.agents.some((agent) => agent.id === next.defaultAgentId && agent.enabled)
          ? next.defaultAgentId
          : next.agents.find((agent) => agent.enabled)?.id ?? ''
        setSelectedAgent(initial)
      })
      .catch((cause) => {
        if (!active) return
        setCatalogError(errorMessage(cause))
      })
    return () => { active = false }
  }, [])

  const applyCatalog = (next: AiAgentCatalogView) => {
    setCatalog(next)
    setCatalogError(null)
    setSelectedAgent((current) => {
      if (current && next.agents.some((agent) => agent.id === current && agent.enabled)) {
        return current
      }
      if (
        next.defaultAgentId
        && next.agents.some((agent) => agent.id === next.defaultAgentId && agent.enabled)
      ) {
        return next.defaultAgentId
      }
      return next.agents.find((agent) => agent.enabled)?.id ?? ''
    })
  }

  const missingInput = useMemo(() => {
    if (catalogError) return 'Không tải được Agent Builder. Mở Quản lý Agent để kiểm tra.'
    if (!catalog.credentialConfigured) {
      return 'Kết nối Google Cloud service account trong Quản lý Agent.'
    }
    if (!selectedAgent) return 'Chọn Agent Builder đã deploy trước khi tạo bài.'
    if (action === 'random') {
      if (!randomSourcePosts.length) return 'Dán ít nhất một bài nguồn để Random.'
      return null
    }
    if (!subject.trim()) return 'Nhập sản phẩm hoặc chủ đề.'
    if (!sourceInfo.trim()) return 'Nhập thông tin chính để Agent có dữ liệu viết bài.'
    return null
  }, [
    action,
    catalog.credentialConfigured,
    catalogError,
    randomSourcePosts.length,
    selectedAgent,
    sourceInfo,
    subject
  ])

  const generate = async () => {
    if (missingInput || generating) return
    const requestContext = captureAiRequestContext(action, postCount)
    setGenerating(true)
    setGenerationError(null)
    try {
      const result: GenerateAiPostsResult = await window.pageAuto.generateAiPosts({
        agentId: selectedAgent,
        action: requestContext.action,
        postCount: requestContext.postCount,
        subject,
        sourceInfo,
        highlight,
        audience,
        randomSourcePosts,
        postType,
        tone,
        structure,
        length,
        emoji,
        hashtag,
        extraFields: {}
      })
      const version = generationVersion + 1
      setGenerationVersion(version)
      setResultAction(requestContext.action)
      setResultPostCount(requestContext.postCount)
      setIncomingBatch({ version, output: result.output, warning: result.warning })
    } catch (cause) {
      setGenerationError(errorMessage(cause))
    } finally {
      setGenerating(false)
    }
  }

  const actionVerb = action === 'create' ? 'Tạo' : 'Random'
  const resultActionVerb = resultAction === 'create' ? 'Tạo' : 'Random'
  const previewActionVerb = incomingBatch ? resultActionVerb : actionVerb
  const previewPostCount = incomingBatch ? resultPostCount : postCount

  return (
    <section className="ai-content-workspace" aria-label="Tạo bài bằng Agent Builder">
      <div className="ai-content-topbar">
        <div className="ai-agent-control">
          <span className="ai-control-label">Agent</span>
          <select
            value={selectedAgent}
            onChange={(event) => setSelectedAgent(event.target.value)}
            aria-label="Chọn Agent Builder"
          >
            <option value="">{enabledAgents.length ? 'Chọn Agent' : 'Chưa có Agent'}</option>
            {enabledAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <button
            className="ai-secondary-button"
            type="button"
            onClick={() => setAgentManagerOpen(true)}
          >
            <span aria-hidden="true">⚙</span> Quản lý Agent
          </button>
        </div>

        <div className={catalog.credentialConfigured ? 'ai-provider-state connected' : 'ai-provider-state'}>
          <span />
          {catalog.credentialConfigured
            ? `Agent Builder đã kết nối${catalog.projectId ? ` · ${catalog.projectId}` : ''}`
            : 'Chưa kết nối Google Cloud'}
        </div>
      </div>

      <div className="ai-content-layout">
        <aside className="ai-compose-panel">
          <div className="ai-compose-scroll">
            <section className="ai-form-section">
              <div className="ai-section-heading compact">
                <div>
                  <strong>Hành động</strong>
                  <small>Chọn tạo mới hoặc biến tấu nội dung có sẵn</small>
                </div>
              </div>

              <div className="ai-action-grid">
                <label className="ai-field">
                  <span>Hành động</span>
                  <select
                    value={action}
                    onChange={(event) => setAction(event.target.value as AiContentAction)}
                  >
                    <option value="create">Tạo bài mới</option>
                    <option value="random">Random bài</option>
                  </select>
                </label>
                <label className="ai-field ai-count-field">
                  <span>Số lượng</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={postCount}
                    onChange={(event) => setPostCount(
                      Math.max(1, Math.min(50, Number(event.target.value) || 1))
                    )}
                  />
                </label>
              </div>

              <div className="ai-action-summary">
                <span>
                  {action === 'create'
                    ? 'Agent viết bài mới từ thông tin gốc.'
                    : 'Agent tạo biến thể từ nội dung nguồn.'}
                </span>
                <strong>Mỗi bài cách bằng <code>{AI_POST_DELIMITER}</code></strong>
              </div>
            </section>

            {action === 'create' ? (
              <section className="ai-form-section">
                <div className="ai-section-heading">
                  <div>
                    <strong>Thông tin gốc</strong>
                    <small>Thông tin này được gửi vào Agent Builder đã chọn</small>
                  </div>
                  <span>Bắt buộc</span>
                </div>

                <label className="ai-field">
                  <span>Sản phẩm / chủ đề <b>*</b></span>
                  <input
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    placeholder="Ví dụ: Căn hộ 2PN Vinhomes Central Park"
                  />
                </label>

                <label className="ai-field">
                  <span>Thông tin chính <b>*</b></span>
                  <textarea
                    className="ai-source-info"
                    value={sourceInfo}
                    onChange={(event) => setSourceInfo(event.target.value)}
                    placeholder="Giá, thông số, đặc điểm, ưu đãi, địa chỉ..."
                  />
                </label>

                <div className="ai-form-grid two">
                  <label className="ai-field">
                    <span>Điểm cần nhấn mạnh</span>
                    <input
                      value={highlight}
                      onChange={(event) => setHighlight(event.target.value)}
                      placeholder="Ví dụ: view sông, tầng cao"
                    />
                  </label>
                  <label className="ai-field">
                    <span>Đối tượng</span>
                    <input
                      value={audience}
                      onChange={(event) => setAudience(event.target.value)}
                      placeholder="Ví dụ: người mua để ở"
                    />
                  </label>
                </div>
              </section>
            ) : (
              <section className="ai-form-section">
                <div className="ai-section-heading">
                  <div>
                    <strong>Nội dung nguồn</strong>
                    <small>Dán bài gốc để Agent Builder viết thành biến thể</small>
                  </div>
                  <span>Bắt buộc</span>
                </div>

                <label className="ai-field">
                  <span>Bài nguồn <b>*</b></span>
                  <textarea
                    className="ai-source-info ai-random-source"
                    value={randomSource}
                    onChange={(event) => setRandomSource(event.target.value)}
                    placeholder={`Bài nguồn 1\n${AI_POST_DELIMITER}\nBài nguồn 2`}
                  />
                </label>
                <div className="ai-random-source-state">
                  <span>
                    {randomSourcePosts.length
                      ? `Đã nhận ${randomSourcePosts.length} bài nguồn`
                      : 'Chưa có bài nguồn'}
                  </span>
                  <strong>Nhiều bài nguồn cũng cách nhau bằng {AI_POST_DELIMITER}</strong>
                </div>
              </section>
            )}

            <section className="ai-form-section ai-generation-options">
              <div className="ai-section-heading compact">
                <div>
                  <strong>Cách viết</strong>
                  <small>Đây là yêu cầu gửi thêm vào Agent đã build</small>
                </div>
              </div>

              <div className="ai-form-grid two">
                <label className="ai-field">
                  <span>Loại bài</span>
                  <select
                    value={postType}
                    onChange={(event) => setPostType(
                      event.target.value as (typeof POST_TYPES)[number]
                    )}
                  >
                    {POST_TYPES.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label className="ai-field">
                  <span>Giọng văn</span>
                  <select
                    value={tone}
                    onChange={(event) => setTone(event.target.value as (typeof TONES)[number])}
                  >
                    {TONES.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
              </div>

              <label className="ai-field">
                <span>Bố cục / mạch bài</span>
                <select
                  value={structure}
                  onChange={(event) => setStructure(
                    event.target.value as (typeof STRUCTURES)[number]
                  )}
                >
                  {STRUCTURES.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>

              <div className="ai-form-grid two">
                <label className="ai-field">
                  <span>Độ dài</span>
                  <select
                    value={length}
                    onChange={(event) => setLength(event.target.value as (typeof LENGTHS)[number])}
                  >
                    {LENGTHS.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <div className="ai-option-stack" aria-label="Tùy chọn nội dung">
                  <label>
                    <input
                      type="checkbox"
                      checked={emoji}
                      onChange={(event) => setEmoji(event.target.checked)}
                    />
                    Emoji nhẹ
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={hashtag}
                      onChange={(event) => setHashtag(event.target.checked)}
                    />
                    Hashtag
                  </label>
                </div>
              </div>

              <div className="ai-image-option disabled" aria-disabled="true">
                <span><input type="checkbox" disabled /><b>Tạo ảnh bằng AI</b></span>
                <small>Ảnh sẽ nối qua Agent/tool riêng ở lô image, không gọi model ảnh trực tiếp ở đây.</small>
              </div>
            </section>
          </div>

          <div className="ai-compose-footer">
            <span className={missingInput || generationError ? 'ai-form-hint' : 'ai-form-hint ready'}>
              {generationError
                ?? missingInput
                ?? `Sẵn sàng gửi yêu cầu tới ${currentAgent?.name ?? 'Agent Builder'}.`}
            </span>
            <button
              className="ai-generate-button"
              type="button"
              disabled={Boolean(missingInput) || generating}
              title={missingInput ?? 'Gửi yêu cầu tới Agent Builder đã chọn'}
              onClick={() => void generate()}
            >
              <span aria-hidden="true">✦</span>
              {generating ? 'Agent đang chạy...' : `${actionVerb} ${postCount} bài`}
            </button>
          </div>
        </aside>

        <AiDraftResultsPanel
          expectedCount={previewPostCount}
          actionLabel={previewActionVerb}
          incomingBatch={incomingBatch}
        />
      </div>

      {agentManagerOpen ? (
        <AiAgentManagerModal
          catalog={catalog}
          onCatalogChange={applyCatalog}
          onClose={() => setAgentManagerOpen(false)}
        />
      ) : null}
    </section>
  )
}
