import { useEffect, useMemo, useState } from 'react'
import type {
  AiAgentCatalogView,
  AiAgentInputField,
  AiContentAction,
  GenerateAiPostsResult
} from '../../../shared/aiAgents'
import { AiAgentManagerModal } from './AiAgentManagerModal'
import { AiDraftResultsPanel, type AiIncomingDraftBatch } from './AiDraftResultsPanel'
import { AI_POST_DELIMITER, parseAiPostOutput } from './aiPostOutputFormat'
import './aiContentWorkspace.css'
import './aiContentWorkspaceModes.css'

const POST_TYPES = ['Bán hàng', 'Chia sẻ', 'Review', 'Giới thiệu'] as const
const TONES = ['Tự nhiên', 'Gần gũi', 'Chuyên nghiệp', 'Ngắn gọn'] as const
const STRUCTURES = ['Hook → Nội dung → CTA', 'Vấn đề → Giải pháp → CTA', 'Thông tin → Lợi ích → CTA', 'Tự do'] as const
const LENGTHS = ['Ngắn', 'Trung bình', 'Dài'] as const

const EMPTY_CATALOG: AiAgentCatalogView = {
  agents: [],
  defaultAgentId: null,
  credentialConfigured: false
}

type ExtraFieldValue = string | number | boolean

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function initialExtraFields(fields: readonly AiAgentInputField[]): Record<string, ExtraFieldValue> {
  return Object.fromEntries(fields.map((field) => {
    if (field.defaultValue !== null) return [field.key, field.defaultValue]
    if (field.type === 'toggle') return [field.key, false]
    if (field.type === 'number') return [field.key, 0]
    return [field.key, '']
  }))
}

function requiredExtraFieldMessage(fields: readonly AiAgentInputField[], values: Record<string, ExtraFieldValue>): string | null {
  for (const field of fields) {
    if (!field.required) continue
    const value = values[field.key]
    if (typeof value === 'string' && !value.trim()) return `Nhập ${field.label}.`
    if (value === undefined || value === null) return `Nhập ${field.label}.`
  }
  return null
}

interface AgentDynamicFieldsProps {
  fields: readonly AiAgentInputField[]
  values: Record<string, ExtraFieldValue>
  onChange: (key: string, value: ExtraFieldValue) => void
}

function AgentDynamicFields({ fields, values, onChange }: AgentDynamicFieldsProps) {
  if (!fields.length) return null

  return (
    <section className="ai-form-section ai-agent-dynamic-section">
      <div className="ai-section-heading compact">
        <div><strong>Thông tin theo Agent</strong><small>Các trường được khai báo trong Agent JSON</small></div>
      </div>
      <div className="ai-agent-dynamic-grid">
        {fields.map((field) => {
          const value = values[field.key] ?? (field.type === 'toggle' ? false : field.type === 'number' ? 0 : '')
          if (field.type === 'toggle') {
            return (
              <label key={field.key} className="ai-agent-toggle-field">
                <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(field.key, event.target.checked)} />
                <span><b>{field.label}{field.required ? ' *' : ''}</b>{field.placeholder ? <small>{field.placeholder}</small> : null}</span>
              </label>
            )
          }
          if (field.type === 'textarea') {
            return (
              <label key={field.key} className="ai-field ai-agent-dynamic-wide">
                <span>{field.label}{field.required ? <b> *</b> : null}</span>
                <textarea value={String(value)} placeholder={field.placeholder} onChange={(event) => onChange(field.key, event.target.value)} />
              </label>
            )
          }
          if (field.type === 'select') {
            return (
              <label key={field.key} className="ai-field">
                <span>{field.label}{field.required ? <b> *</b> : null}</span>
                <select value={String(value)} onChange={(event) => onChange(field.key, event.target.value)}>
                  {!field.required ? <option value="">Không chọn</option> : null}
                  {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            )
          }
          return (
            <label key={field.key} className="ai-field">
              <span>{field.label}{field.required ? <b> *</b> : null}</span>
              <input
                type={field.type === 'number' ? 'number' : 'text'}
                value={typeof value === 'boolean' ? '' : value}
                placeholder={field.placeholder}
                onChange={(event) => onChange(field.key, field.type === 'number' ? Number(event.target.value) : event.target.value)}
              />
            </label>
          )
        })}
      </div>
    </section>
  )
}

export function AiContentWorkspace() {
  const [agentManagerOpen, setAgentManagerOpen] = useState(false)
  const [catalog, setCatalog] = useState<AiAgentCatalogView>(EMPTY_CATALOG)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState('')
  const [extraFields, setExtraFields] = useState<Record<string, ExtraFieldValue>>({})
  const [action, setAction] = useState<AiContentAction>('create')
  const [subject, setSubject] = useState('')
  const [sourceInfo, setSourceInfo] = useState('')
  const [highlight, setHighlight] = useState('')
  const [audience, setAudience] = useState('')
  const [randomSource, setRandomSource] = useState('')
  const [postType, setPostType] = useState<(typeof POST_TYPES)[number]>('Bán hàng')
  const [tone, setTone] = useState<(typeof TONES)[number]>('Tự nhiên')
  const [structure, setStructure] = useState<(typeof STRUCTURES)[number]>('Hook → Nội dung → CTA')
  const [length, setLength] = useState<(typeof LENGTHS)[number]>('Trung bình')
  const [postCount, setPostCount] = useState(5)
  const [emoji, setEmoji] = useState(true)
  const [hashtag, setHashtag] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [generationVersion, setGenerationVersion] = useState(0)
  const [incomingBatch, setIncomingBatch] = useState<AiIncomingDraftBatch | null>(null)

  const enabledAgents = useMemo(() => catalog.agents.filter((agent) => agent.enabled), [catalog.agents])
  const currentAgent = useMemo(
    () => enabledAgents.find((agent) => agent.id === selectedAgent) ?? null,
    [enabledAgents, selectedAgent]
  )
  const randomSourcePosts = useMemo(() => parseAiPostOutput(randomSource), [randomSource])

  useEffect(() => {
    let active = true
    void window.pageAuto.getAiAgentCatalog()
      .then((next) => {
        if (!active) return
        setCatalog(next)
        setCatalogError(null)
        const initial = next.defaultAgentId && next.agents.some((agent) => agent.id === next.defaultAgentId && agent.enabled)
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

  useEffect(() => {
    setExtraFields(initialExtraFields(currentAgent?.inputFields ?? []))
  }, [currentAgent?.id])

  const applyCatalog = (next: AiAgentCatalogView) => {
    setCatalog(next)
    setCatalogError(null)
    setSelectedAgent((current) => {
      if (current && next.agents.some((agent) => agent.id === current && agent.enabled)) return current
      if (next.defaultAgentId && next.agents.some((agent) => agent.id === next.defaultAgentId && agent.enabled)) return next.defaultAgentId
      return next.agents.find((agent) => agent.enabled)?.id ?? ''
    })
  }

  const missingInput = useMemo(() => {
    if (catalogError) return 'Không tải được Agent. Mở Quản lý Agent để kiểm tra.'
    if (!selectedAgent) return 'Chọn hoặc import Agent trước khi tạo bài.'
    if (!catalog.credentialConfigured) return 'Cấu hình Gemini API key trong Quản lý Agent.'
    if (currentAgent) {
      const dynamicMissing = requiredExtraFieldMessage(currentAgent.inputFields, extraFields)
      if (dynamicMissing) return dynamicMissing
    }
    if (action === 'random') {
      if (!randomSourcePosts.length) return 'Dán ít nhất một bài nguồn để Random.'
      return null
    }
    if (!subject.trim()) return 'Nhập sản phẩm hoặc chủ đề.'
    if (!sourceInfo.trim()) return 'Nhập thông tin chính để AI có dữ liệu viết bài.'
    return null
  }, [action, catalog.credentialConfigured, catalogError, currentAgent, extraFields, randomSourcePosts.length, selectedAgent, sourceInfo, subject])

  const generate = async () => {
    if (missingInput || generating) return
    setGenerating(true)
    setGenerationError(null)
    try {
      const result: GenerateAiPostsResult = await window.pageAuto.generateAiPosts({
        agentId: selectedAgent,
        action,
        postCount,
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
        extraFields
      })
      const version = generationVersion + 1
      setGenerationVersion(version)
      setIncomingBatch({ version, output: result.output, warning: result.warning })
    } catch (cause) {
      setGenerationError(errorMessage(cause))
    } finally {
      setGenerating(false)
    }
  }

  const actionVerb = action === 'create' ? 'Tạo' : 'Random'

  return (
    <section className="ai-content-workspace" aria-label="Tạo bài bằng AI">
      <div className="ai-content-topbar">
        <div className="ai-agent-control">
          <span className="ai-control-label">Agent</span>
          <select value={selectedAgent} onChange={(event) => setSelectedAgent(event.target.value)} aria-label="Chọn Agent">
            <option value="">{enabledAgents.length ? 'Chọn Agent' : 'Chưa có Agent'}</option>
            {enabledAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
          <button className="ai-secondary-button" type="button" onClick={() => setAgentManagerOpen(true)}>
            <span aria-hidden="true">⚙</span> Quản lý Agent
          </button>
        </div>
        <div className={catalog.credentialConfigured ? 'ai-provider-state connected' : 'ai-provider-state'}>
          <span />{catalog.credentialConfigured ? 'Gemini đã kết nối' : 'Chưa cấu hình Gemini key'}
        </div>
      </div>

      <div className="ai-content-layout">
        <aside className="ai-compose-panel">
          <div className="ai-compose-scroll">
            <section className="ai-form-section">
              <div className="ai-section-heading compact">
                <div><strong>Hành động</strong><small>Chọn tạo mới hoặc biến tấu nội dung có sẵn</small></div>
              </div>

              <div className="ai-action-grid">
                <label className="ai-field">
                  <span>Hành động</span>
                  <select value={action} onChange={(event) => setAction(event.target.value as AiContentAction)}>
                    <option value="create">Tạo bài mới</option>
                    <option value="random">Random bài</option>
                  </select>
                </label>
                <label className="ai-field ai-count-field">
                  <span>Số lượng</span>
                  <input type="number" min={1} max={50} value={postCount} onChange={(event) => setPostCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} />
                </label>
              </div>

              <div className="ai-action-summary">
                <span>{action === 'create' ? 'Viết bài mới từ thông tin gốc.' : 'Tạo biến thể từ nội dung nguồn.'}</span>
                <strong>Mỗi bài cách bằng <code>{AI_POST_DELIMITER}</code></strong>
              </div>
            </section>

            {action === 'create' ? (
              <section className="ai-form-section">
                <div className="ai-section-heading">
                  <div><strong>Thông tin gốc</strong><small>AI chỉ viết từ dữ liệu anh cung cấp</small></div>
                  <span>Bắt buộc</span>
                </div>

                <label className="ai-field">
                  <span>Sản phẩm / chủ đề <b>*</b></span>
                  <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Ví dụ: Căn hộ 2PN Vinhomes Central Park" />
                </label>

                <label className="ai-field">
                  <span>Thông tin chính <b>*</b></span>
                  <textarea
                    className="ai-source-info"
                    value={sourceInfo}
                    onChange={(event) => setSourceInfo(event.target.value)}
                    placeholder="Giá, thông số, đặc điểm, ưu đãi, địa chỉ... Chỉ nhập những gì AI được phép sử dụng."
                  />
                </label>

                <div className="ai-form-grid two">
                  <label className="ai-field">
                    <span>Điểm cần nhấn mạnh</span>
                    <input value={highlight} onChange={(event) => setHighlight(event.target.value)} placeholder="Ví dụ: view sông, tầng cao" />
                  </label>
                  <label className="ai-field">
                    <span>Đối tượng</span>
                    <input value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="Ví dụ: người mua để ở" />
                  </label>
                </div>
              </section>
            ) : (
              <section className="ai-form-section">
                <div className="ai-section-heading">
                  <div><strong>Nội dung nguồn</strong><small>Dán bài gốc để AI viết thành các biến thể khác nhau</small></div>
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
                  <span>{randomSourcePosts.length ? `Đã nhận ${randomSourcePosts.length} bài nguồn` : 'Chưa có bài nguồn'}</span>
                  <strong>Nhiều bài nguồn cũng cách nhau bằng {AI_POST_DELIMITER}</strong>
                </div>
              </section>
            )}

            <AgentDynamicFields
              fields={currentAgent?.inputFields ?? []}
              values={extraFields}
              onChange={(key, value) => setExtraFields((current) => ({ ...current, [key]: value }))}
            />

            <section className="ai-form-section ai-generation-options">
              <div className="ai-section-heading compact"><div><strong>Cách viết</strong><small>Chọn nhanh, không cần viết prompt</small></div></div>

              <div className="ai-form-grid two">
                <label className="ai-field">
                  <span>Loại bài</span>
                  <select value={postType} onChange={(event) => setPostType(event.target.value as (typeof POST_TYPES)[number])}>
                    {POST_TYPES.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label className="ai-field">
                  <span>Giọng văn</span>
                  <select value={tone} onChange={(event) => setTone(event.target.value as (typeof TONES)[number])}>
                    {TONES.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
              </div>

              <label className="ai-field">
                <span>Cấu trúc</span>
                <select value={structure} onChange={(event) => setStructure(event.target.value as (typeof STRUCTURES)[number])}>
                  {STRUCTURES.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>

              <div className="ai-form-grid two">
                <label className="ai-field">
                  <span>Độ dài</span>
                  <select value={length} onChange={(event) => setLength(event.target.value as (typeof LENGTHS)[number])}>
                    {LENGTHS.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <div className="ai-option-stack" aria-label="Tùy chọn nội dung">
                  <label><input type="checkbox" checked={emoji} onChange={(event) => setEmoji(event.target.checked)} /> Emoji nhẹ</label>
                  <label><input type="checkbox" checked={hashtag} onChange={(event) => setHashtag(event.target.checked)} /> Hashtag</label>
                </div>
              </div>

              <div className="ai-image-option disabled" aria-disabled="true">
                <span><input type="checkbox" disabled /><b>Tạo ảnh bằng AI</b></span>
                <small>Chưa bật trong runtime text; không giả lập ảnh.</small>
              </div>
            </section>
          </div>

          <div className="ai-compose-footer">
            <span className={missingInput || generationError ? 'ai-form-hint' : 'ai-form-hint ready'}>{generationError ?? missingInput ?? `Đã đủ thông tin để ${action === 'create' ? 'tạo' : 'random'} bài.`}</span>
            <button className="ai-generate-button" type="button" disabled={Boolean(missingInput) || generating} title={missingInput ?? 'Tạo bài bằng Agent đã chọn'} onClick={() => void generate()}>
              <span aria-hidden="true">✦</span> {generating ? 'Đang tạo...' : `${actionVerb} ${postCount} bài`}
            </button>
          </div>
        </aside>

        <AiDraftResultsPanel expectedCount={postCount} actionLabel={actionVerb} incomingBatch={incomingBatch} />
      </div>

      {agentManagerOpen ? <AiAgentManagerModal catalog={catalog} onCatalogChange={applyCatalog} onClose={() => setAgentManagerOpen(false)} /> : null}
    </section>
  )
}
