import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { AI_POST_DELIMITER, parseAiPostOutput } from './aiPostOutputFormat'
import { AiDraftResultsPanel } from './AiDraftResultsPanel'
import './aiContentWorkspace.css'
import './aiContentWorkspaceModes.css'

type AgentFileState =
  | { kind: 'idle' }
  | { kind: 'valid'; fileName: string }
  | { kind: 'invalid'; fileName: string; message: string }

type AiContentAction = 'create' | 'random'

const POST_TYPES = ['Bán hàng', 'Chia sẻ', 'Review', 'Giới thiệu'] as const
const TONES = ['Tự nhiên', 'Gần gũi', 'Chuyên nghiệp', 'Ngắn gọn'] as const
const STRUCTURES = ['Hook → Nội dung → CTA', 'Vấn đề → Giải pháp → CTA', 'Thông tin → Lợi ích → CTA', 'Tự do'] as const
const LENGTHS = ['Ngắn', 'Trung bình', 'Dài'] as const

export function AiContentWorkspace() {
  const [agentManagerOpen, setAgentManagerOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState('')
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
  const [createImages, setCreateImages] = useState(false)
  const [agentFile, setAgentFile] = useState<AgentFileState>({ kind: 'idle' })
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const randomSourcePosts = useMemo(() => parseAiPostOutput(randomSource), [randomSource])

  const missingInput = useMemo(() => {
    if (!selectedAgent) return 'Chọn Agent trước khi tạo bài.'
    if (action === 'random') {
      if (!randomSourcePosts.length) return 'Dán ít nhất một bài nguồn để Random.'
      return null
    }
    if (!subject.trim()) return 'Nhập sản phẩm hoặc chủ đề.'
    if (!sourceInfo.trim()) return 'Nhập thông tin chính để AI có dữ liệu viết bài.'
    return null
  }, [action, randomSourcePosts.length, selectedAgent, sourceInfo, subject])

  const handleAgentFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const value = JSON.parse(await file.text()) as unknown
      if (!value || typeof value !== 'object') throw new Error('File JSON không có cấu trúc hợp lệ.')
      setAgentFile({ kind: 'valid', fileName: file.name })
    } catch (cause) {
      setAgentFile({
        kind: 'invalid',
        fileName: file.name,
        message: cause instanceof Error ? cause.message : 'Không đọc được file JSON.'
      })
    }
  }

  const actionVerb = action === 'create' ? 'Tạo' : 'Random'

  return (
    <section className="ai-content-workspace" aria-label="Tạo bài bằng AI">
      <div className="ai-content-topbar">
        <div className="ai-agent-control">
          <span className="ai-control-label">Agent</span>
          <select value={selectedAgent} onChange={(event) => setSelectedAgent(event.target.value)} aria-label="Chọn Agent">
            <option value="">Chưa có Agent</option>
          </select>
          <button className="ai-secondary-button" type="button" onClick={() => setAgentManagerOpen(true)}>
            <span aria-hidden="true">⚙</span> Quản lý Agent
          </button>
        </div>
        <div className="ai-provider-state"><span />Chưa kết nối Agent</div>
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

              <label className="ai-image-option">
                <span><input type="checkbox" checked={createImages} onChange={(event) => setCreateImages(event.target.checked)} /><b>Tạo ảnh bằng AI</b></span>
                <small>Ảnh sẽ được lưu local khi provider hỗ trợ.</small>
              </label>
            </section>
          </div>

          <div className="ai-compose-footer">
            <span className={missingInput ? 'ai-form-hint' : 'ai-form-hint ready'}>{missingInput ?? `Đã đủ thông tin để ${action === 'create' ? 'tạo' : 'random'} bài.`}</span>
            <button className="ai-generate-button" type="button" disabled={Boolean(missingInput)} title={missingInput ?? 'Provider thật sẽ được nối sau khi audit Agent JSON export.'}>
              <span aria-hidden="true">✦</span> {actionVerb} {postCount} bài
            </button>
          </div>
        </aside>

        <AiDraftResultsPanel expectedCount={postCount} actionLabel={actionVerb} />
      </div>

      {agentManagerOpen ? (
        <div className="ai-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setAgentManagerOpen(false) }}>
          <section className="ai-agent-modal" role="dialog" aria-modal="true" aria-label="Quản lý Agent">
            <header className="ai-agent-modal-header">
              <div><p>AI / AGENT</p><h2>Quản lý Agent</h2><span>Import và chọn Agent dùng cho màn tạo bài.</span></div>
              <button type="button" aria-label="Đóng" onClick={() => setAgentManagerOpen(false)}>×</button>
            </header>

            <div className="ai-agent-modal-body">
              <aside className="ai-agent-list-panel">
                <div className="ai-agent-list-heading"><strong>Agent đã import</strong><span>0</span></div>
                <div className="ai-agent-list-empty"><span aria-hidden="true">◇</span><strong>Chưa có Agent</strong><p>Import file JSON để bắt đầu.</p></div>
              </aside>

              <section className="ai-agent-import-panel">
                <div className="ai-agent-import-card">
                  <div className="ai-import-icon" aria-hidden="true">⇧</div>
                  <div><strong>Import Agent JSON</strong><p>Chọn file cấu hình Agent. Page-Auto chỉ hiển thị các Agent cần dùng; ID và metadata nội bộ sẽ không làm rối giao diện.</p></div>
                  <button className="ai-primary-button" type="button" onClick={() => fileInputRef.current?.click()}>Chọn file JSON</button>
                  <input ref={fileInputRef} className="ai-hidden-input" type="file" accept="application/json,.json" onChange={(event) => void handleAgentFile(event)} />
                </div>

                {agentFile.kind !== 'idle' ? (
                  <div className={agentFile.kind === 'valid' ? 'ai-file-state valid' : 'ai-file-state invalid'}>
                    <span aria-hidden="true">{agentFile.kind === 'valid' ? '✓' : '!'}</span>
                    <div><strong>{agentFile.fileName}</strong><p>{agentFile.kind === 'valid' ? 'Đã đọc được file JSON. Cần file Agent export thật để nhận diện và lưu Agent đúng cấu trúc.' : agentFile.message}</p></div>
                  </div>
                ) : null}

                <div className="ai-agent-policy">
                  <div><strong>Giao diện gọn</strong><p>Chỉ hiện tên, mô tả và Agent được bật.</p></div>
                  <div><strong>Ẩn phần kỹ thuật</strong><p>ID, global và metadata provider nằm phía trong.</p></div>
                  <div><strong>Secret tách riêng</strong><p>Không nhét API key/token vào file Agent JSON.</p></div>
                </div>
              </section>
            </div>

            <footer className="ai-agent-modal-footer"><button type="button" onClick={() => setAgentManagerOpen(false)}>Đóng</button></footer>
          </section>
        </div>
      ) : null}
    </section>
  )
}
