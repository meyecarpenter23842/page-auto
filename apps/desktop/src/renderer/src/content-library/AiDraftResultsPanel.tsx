import { useEffect, useMemo, useRef, useState } from 'react'
import type { ContentLibraryImageConfig } from '../../../shared/contentLibrary'
import type { AiImageArticleRequest, AiImageAttachment } from './aiImageArticleBridge'
import {
  buildAiDraftBatch,
  CONTENT_LIBRARY_EXTERNAL_CHANGE_EVENT,
  countSavableAiDrafts,
  createCanonicalContentInput,
  getAiDraftVariantCount,
  type AiDraftResult
} from './aiDraftResults'
import { AI_POST_DELIMITER } from './aiPostOutputFormat'
import { parseContentVariantText } from '../../../shared/contentLibrary'
import { inspectContentVariants } from '../../../shared/contentQuality'
import './aiDraftResultsPanel.css'

export interface AiIncomingDraftBatch {
  version: number
  output: string
  warning: string | null
}

interface AiDraftResultsPanelProps {
  expectedCount: number
  actionLabel: string
  incomingBatch?: AiIncomingDraftBatch | null
  onCreateImageForArticle?: ((request: AiImageArticleRequest) => void) | undefined
  imageAttachment?: AiImageAttachment | null | undefined
}

interface BatchNotice {
  kind: 'success' | 'warning' | 'error'
  message: string
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function excerpt(value: string): string {
  return (value.split(/\r?\n/, 1)[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
}

export function AiDraftResultsPanel({
  expectedCount,
  actionLabel,
  incomingBatch = null,
  onCreateImageForArticle,
  imageAttachment = null
}: AiDraftResultsPanelProps) {
  const [rawOutput, setRawOutput] = useState('')
  const [drafts, setDrafts] = useState<AiDraftResult[]>([])
  const [activeId, setActiveId] = useState('')
  const [notice, setNotice] = useState<BatchNotice | null>(null)
  const [saving, setSaving] = useState(false)
  const [editorTab, setEditorTab] = useState<'edit' | 'preview'>('edit')
  const editorRef = useRef<HTMLTextAreaElement>(null)

  const isRandom = actionLabel.toLocaleLowerCase('vi').includes('random')
  const selectedCount = useMemo(
    () => drafts.filter((draft) => draft.selected).length,
    [drafts]
  )
  const savableCount = useMemo(() => countSavableAiDrafts(drafts), [drafts])
  const savedCount = useMemo(
    () => drafts.filter((draft) => draft.status === 'saved').length,
    [drafts]
  )
  const activeDraft = useMemo(
    () => drafts.find((draft) => draft.id === activeId) ?? drafts[0] ?? null,
    [activeId, drafts]
  )
  const qualityWarnings = useMemo(() => inspectContentVariants(drafts.flatMap((draft) =>
    draft.kind === 'variant_group' ? parseContentVariantText(draft.content) : [draft.content]
  )), [drafts])
  const groupedRandomDraft = useMemo(
    () => drafts.find((draft) => draft.kind === 'variant_group') ?? null,
    [drafts]
  )

  const applyRawOutput = (output: string, warning: string | null = null) => {
    if (!output.trim()) {
      setDrafts([])
      setActiveId('')
      setNotice({ kind: 'error', message: 'Agent không trả về nội dung để đọc.' })
      return
    }

    const batch = buildAiDraftBatch(
      output,
      expectedCount,
      undefined,
      isRandom ? 'random' : 'create'
    )
    setRawOutput(output)
    setDrafts(batch.drafts)
    setActiveId(batch.drafts[0]?.id ?? '')

    const messages = [batch.message, ...batch.warnings, warning]
      .filter((value): value is string => Boolean(value?.trim()))
    setNotice({
      kind: batch.valid && !warning && batch.warnings.length === 0 ? 'success' : 'warning',
      message: messages.join(' ')
    })
  }

  useEffect(() => {
    if (!incomingBatch) return
    applyRawOutput(incomingBatch.output, incomingBatch.warning)
    // incomingBatch.version is the explicit signal for a new provider response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingBatch?.version])

  const loadAgentOutput = () => applyRawOutput(rawOutput)

  const updateDraft = (
    id: string,
    patch: Partial<Pick<AiDraftResult, 'name' | 'content' | 'selected'>>
  ) => {
    setDrafts((current) => current.map((draft) => {
      if (draft.id !== id) return draft
      const changedContent = patch.name !== undefined || patch.content !== undefined
      return {
        ...draft,
        ...patch,
        status: changedContent && draft.status !== 'ready' ? 'ready' : draft.status,
        error: changedContent ? null : draft.error
      }
    }))
  }

  const updateDraftImage = (
    id: string,
    patch: Partial<ContentLibraryImageConfig>
  ) => {
    setDrafts((current) => current.map((draft) => (
      draft.id === id
        ? {
            ...draft,
            image: { ...draft.image, ...patch },
            status: draft.status !== 'ready' ? 'ready' : draft.status,
            error: null
          }
        : draft
    )))
  }

  useEffect(() => {
    if (!imageAttachment) return
    setDrafts(current => current.map(draft => draft.id === imageAttachment.id
      ? {...draft,image:{...draft.image,folderPath:imageAttachment.folderPath,imagesPerPost:1},
          status:'ready',error:null} : draft))
    setActiveId(imageAttachment.id)
    setNotice({kind:'success',message:'Đã gắn folder ảnh AI vào bài đang chọn. Lưu bài để cập nhật Thư viện.'})
  }, [imageAttachment?.version])

  const pickImageFolder = async () => {
    if (!activeDraft) return
    const folderPath = await window.pageAuto.pickContentLibraryImageFolder()
    if (folderPath) updateDraftImage(activeDraft.id, { folderPath })
  }

  const retrySave = async (id: string) => {
    const index = drafts.findIndex((draft) => draft.id === id)
    const draft = index >= 0 ? drafts[index] : undefined
    if (!draft || getAiDraftVariantCount(draft) === 0) return

    setSaving(true)
    setDrafts((current) => current.map(
      (item) => item.id === id ? { ...item, error: null, status: 'ready' } : item
    ))

    try {
      await window.pageAuto.createContentLibraryItem(createCanonicalContentInput(draft, index))
      setDrafts((current) => current.map(
        (item) => item.id === id
          ? { ...item, selected: false, status: 'saved', error: null }
          : item
      ))
      setNotice({ kind: 'success', message: 'Đã lưu lại bài lỗi vào Thư viện gốc.' })
      window.dispatchEvent(new Event(CONTENT_LIBRARY_EXTERNAL_CHANGE_EVENT))
    } catch (cause) {
      setDrafts((current) => current.map(
        (item) => item.id === id
          ? { ...item, status: 'error', error: errorMessage(cause) }
          : item
      ))
      setNotice({
        kind: 'error',
        message: 'Bài vẫn chưa lưu được. Các bài đã lưu trước đó được giữ nguyên.'
      })
    } finally {
      setSaving(false)
    }
  }

  const saveSelected = async () => {
    const targets = drafts
      .map((draft, index) => ({ draft, index }))
      .filter(({ draft }) => (
        draft.selected
        && draft.status !== 'saved'
        && getAiDraftVariantCount(draft) > 0
      ))

    if (!targets.length) return

    setSaving(true)
    setNotice(null)
    let successCount = 0
    let failureCount = 0

    for (const { draft, index } of targets) {
      try {
        await window.pageAuto.createContentLibraryItem(createCanonicalContentInput(draft, index))
        successCount += 1
        setDrafts((current) => current.map(
          (item) => item.id === draft.id
            ? { ...item, selected: false, status: 'saved', error: null }
            : item
        ))
      } catch (cause) {
        failureCount += 1
        setDrafts((current) => current.map(
          (item) => item.id === draft.id
            ? { ...item, status: 'error', error: errorMessage(cause) }
            : item
        ))
      }
    }

    if (successCount > 0) {
      window.dispatchEvent(new Event(CONTENT_LIBRARY_EXTERNAL_CHANGE_EVENT))
    }

    setNotice({
      kind: failureCount ? 'warning' : 'success',
      message: failureCount
        ? `Đã lưu ${successCount} bài; ${failureCount} bài lỗi được giữ lại để sửa hoặc thử lưu lại.`
        : groupedRandomDraft && successCount === 1
          ? `Đã lưu 1 bài Random gồm ${getAiDraftVariantCount(groupedRandomDraft)} biến thể vào Thư viện gốc.`
          : `Đã lưu ${successCount} bài đã chọn vào Thư viện gốc.`
    })
    setSaving(false)
  }

  const toggleAll = () => {
    const shouldSelect = drafts.some(
      (draft) => draft.status !== 'saved' && !draft.selected
    )
    setDrafts((current) => current.map(
      (draft) => draft.status === 'saved'
        ? draft
        : { ...draft, selected: shouldSelect }
    ))
  }

  const formatSelection = (before: string, after = '') => {
    if (!activeDraft || saving || editorTab !== 'edit') return
    const field = editorRef.current
    if (!field) return
    const from = field.selectionStart
    const to = field.selectionEnd
    updateDraft(activeDraft.id, {
      content: activeDraft.content.slice(0, from) + before + activeDraft.content.slice(from, to) + after + activeDraft.content.slice(to)
    })
    field.focus()
  }

  const clearResults = () => {
    setDrafts([])
    setActiveId('')
    setRawOutput('')
    setNotice(null)
  }

  return (
    <section className="ai-preview-panel">
      <div className="ai-preview-header">
        <div className="ai-preview-title">
          <p>KẾT QUẢ AI</p>
          <h2>Kết quả tạo bài</h2>
          <small>{drafts.length ? 'Đã tạo ' + drafts.length + ' bài · ' + selectedCount + ' bài đang chọn' : 'Chọn bài để xem và chỉnh sửa'}</small>
        </div>
        <div className="ai-preview-actions">
          <details className="ai-agent-output-bridge">
            <summary>Xem output gốc</summary>
            <div className="ai-agent-output-body">
              <label htmlFor="ai-raw-output">Dữ liệu gốc từ AI</label>
              <textarea
                id="ai-raw-output"
                value={rawOutput}
                onChange={(event) => setRawOutput(event.target.value)}
                placeholder={'Dán output từ AI tại đây. Mỗi bài cách nhau bằng ' + AI_POST_DELIMITER + '.'}
              />
              <div>
                <span>{isRandom ? 'Đọc kết quả sẽ gom các biến thể thành một bài Random.' : 'Không tự lưu, chỉ tạo bản nháp.'}</span>
                <button type="button" onClick={loadAgentOutput}>Đọc kết quả</button>
              </div>
            </div>
          </details>
          {onCreateImageForArticle ? <button type="button" disabled={!activeDraft || saving}
            onClick={() => {if(activeDraft) onCreateImageForArticle({id:activeDraft.id,content:activeDraft.content})}}>
            Tạo ảnh cho bài
          </button> : null}
          <button type="button" disabled={!drafts.length || saving} onClick={clearResults}>Xóa kết quả</button>
          <button className="ai-save-selected" type="button" disabled={saving || savableCount === 0} onClick={() => void saveSelected()}>
            {saving ? 'Đang lưu...' : groupedRandomDraft ? 'Lưu bài Random' : 'Lưu ' + savableCount + ' bài đã chọn'}
          </button>
        </div>
      </div>

      <div className="ai-preview-canvas ai-results-canvas" data-has-drafts={drafts.length > 0}>
        {notice ? (
          <div className={`ai-batch-notice ${notice.kind}`}>{notice.message}</div>
        ) : null}

        {qualityWarnings.length ? (
          <details className="ai-quality-notice">
            <summary>Kiểm tra chất lượng · {qualityWarnings.length} cảnh báo (không tự xóa bài)</summary>
            <ul>{qualityWarnings.slice(0, 8).map((warning, index) => <li key={index}>{warning}</li>)}</ul>
          </details>
        ) : null}

        {drafts.length ? (
          <div className="ai-results-workspace">
            <div className="ai-draft-strip-heading">
              <span>Danh sách bài viết ({drafts.length}) · {savedCount ? savedCount + ' đã lưu' : 'Chưa lưu vào thư viện'}</span>
              <button type="button" disabled={saving} onClick={toggleAll}>{selectedCount ? 'Đổi lựa chọn' : 'Chọn tất cả'}</button>
            </div>
            <div className="ai-draft-list" role="list" aria-label="Danh sách kết quả AI">
              {drafts.map((draft, index) => {
                const variantCount = getAiDraftVariantCount(draft)
                const name = draft.kind === 'variant_group' ? 'Bài Random' : 'Bài ' + (index + 1)
                const line = excerpt(draft.content) || 'Chưa có nội dung'
                return (
                  <article key={draft.id} role="listitem" className={'ai-draft-row ' + draft.status + (activeDraft?.id === draft.id ? ' active' : '')}>
                    <label className="ai-draft-check" title={'Chọn lưu ' + name}>
                      <input
                        aria-label={'Chọn lưu ' + name}
                        type="checkbox"
                        checked={draft.selected}
                        disabled={saving || draft.status === 'saved'}
                        onChange={(event) => updateDraft(draft.id, { selected: event.target.checked })}
                      />
                    </label>
                    <button
                      className="ai-draft-open"
                      type="button"
                      title={line}
                      aria-label={'Mở ' + name + ': ' + line}
                      aria-pressed={activeDraft?.id === draft.id}
                      onClick={() => { setActiveId(draft.id); setEditorTab('edit') }}
                    >
                      <span className="ai-draft-row-title"><strong>{name}: {line}</strong></span>
                      <span className="ai-draft-row-meta">
                        <small>{draft.kind === 'variant_group'
                          ? variantCount + ' biến thể · ' + draft.content.trim().length.toLocaleString('vi-VN') + ' ký tự'
                          : draft.content.trim().length.toLocaleString('vi-VN') + ' ký tự'}</small>
                        <span className={'ai-draft-status ' + draft.status}>
                          {draft.status === 'saved' ? 'Đã lưu' : draft.status === 'error' ? 'Lỗi lưu' : 'Bản nháp'}
                        </span>
                      </span>
                    </button>
                  </article>
                )
              })}
            </div>

            <section className="ai-draft-editor" aria-label="Preview bài đang chọn">
              {activeDraft ? (
                <>


                  <label className="ai-draft-name ai-draft-editor-name">
                    <span>Tiêu đề bài viết</span>
                    <input
                      value={activeDraft.name}
                      disabled={saving}
                      onChange={(event) => updateDraft(
                        activeDraft.id,
                        { name: event.target.value }
                      )}
                    />
                  </label>

                  <div className="ai-draft-content ai-draft-editor-content">
                    <div className="ai-editor-tabs" role="tablist" aria-label="Chế độ xem bài viết">
                      <button type="button" role="tab" aria-selected={editorTab === 'edit'} onClick={() => setEditorTab('edit')}>Nội dung bài viết</button>
                      <button type="button" role="tab" aria-selected={editorTab === 'preview'} onClick={() => setEditorTab('preview')}>Xem trước</button>
                      <span>{activeDraft.content.trim().length.toLocaleString('vi-VN')} ký tự</span>
                    </div>
                    {editorTab === 'edit' ? (
                      <>
                        <div className="ai-editor-tools" role="toolbar" aria-label="Công cụ soạn bài">
                          <button type="button" disabled={saving} title="In đậm đoạn chọn (Markdown)" aria-label="In đậm" onClick={() => formatSelection('**', '**')}><b>B</b></button>
                          <button type="button" disabled={saving} title="In nghiêng đoạn chọn (Markdown)" aria-label="In nghiêng" onClick={() => formatSelection('*', '*')}><i>I</i></button>
                          <button type="button" disabled={saving} title="Thêm đầu dòng" aria-label="Danh sách gạch đầu dòng" onClick={() => formatSelection('• ')}>≡</button>
                          <button type="button" disabled={saving} title="Thêm số đầu dòng" aria-label="Danh sách đánh số" onClick={() => formatSelection('1. ')}>1.</button>
                        </div>
                        <label className="ai-editor-content-label" htmlFor="ai-draft-body">Nội dung</label>
                        <textarea
                          id="ai-draft-body"
                          ref={editorRef}
                          value={activeDraft.content}
                          disabled={saving}
                          onChange={(event) => updateDraft(activeDraft.id, { content: event.target.value })}
                          aria-label="Nội dung bài viết đang chọn"
                        />
                      </>
                    ) : (
                      <div className="ai-editor-plain-preview" role="tabpanel" tabIndex={0} aria-label="Xem trước nội dung văn bản">
                        {activeDraft.content || 'Bài viết chưa có nội dung.'}
                      </div>
                    )}
                  </div>

                  <details key={activeDraft.id} className="ai-draft-media-config" aria-label="Ảnh đính kèm">
                    <summary>
                      <div>
                        <strong>Ảnh đính kèm (nếu có)</strong>
                        <small>Chọn ảnh có sẵn để đi kèm bài</small>
                      </div>
                      <span>{activeDraft.image.folderPath ? 'Có folder ảnh' : 'Chưa chọn ảnh'}</span>
                    </summary>

                    <label className="ai-media-field ai-media-folder-field">
                      <span>Folder ảnh</span>
                      <div className="ai-media-folder-row">
                        <input
                          value={activeDraft.image.folderPath}
                          disabled={saving}
                          placeholder="Không bắt buộc"
                          onChange={(event) => updateDraftImage(
                            activeDraft.id,
                            { folderPath: event.target.value }
                          )}
                        />
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void pickImageFolder()}
                        >
                          Chọn
                        </button>
                      </div>
                    </label>

                    <div className="ai-media-grid">
                      <label className="ai-media-field">
                        <span>Cách lấy ảnh</span>
                        <select
                          value={activeDraft.image.mode}
                          disabled={saving}
                          onChange={(event) => updateDraftImage(
                            activeDraft.id,
                            { mode: event.target.value as ContentLibraryImageConfig['mode'] }
                          )}
                        >
                          <option value="sequential">Lần lượt</option>
                          <option value="random">Ngẫu nhiên</option>
                          <option value="filename_match">Khớp tên file</option>
                        </select>
                      </label>

                      <label className="ai-media-field ai-media-count-field">
                        <span>Số ảnh/bài</span>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={activeDraft.image.imagesPerPost}
                          disabled={saving}
                          onChange={(event) => updateDraftImage(
                            activeDraft.id,
                            { imagesPerPost: Math.min(50, Math.max(1, Number(event.target.value) || 1)) }
                          )}
                        />
                      </label>

                      <label className="ai-media-field">
                        <span>Khi thiếu ảnh</span>
                        <select
                          value={activeDraft.image.missingPolicy}
                          disabled={saving}
                          onChange={(event) => updateDraftImage(
                            activeDraft.id,
                            { missingPolicy: event.target.value as ContentLibraryImageConfig['missingPolicy'] }
                          )}
                        >
                          <option value="text_only">Đăng chữ</option>
                          <option value="skip">Bỏ qua bài</option>
                        </select>
                      </label>
                    </div>
                  </details>

                  {activeDraft.error ? (
                    <footer className="ai-draft-editor-footer">
                      <div className="ai-draft-error">
                        <b>!</b>
                        <span>{activeDraft.error}</span>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void retrySave(activeDraft.id)}
                        >
                          Thử lưu lại
                        </button>
                      </div>
                    </footer>
                  ) : null}
                </>
              ) : (
                <div className="ai-preview-empty ai-result-editor-empty">
                  <strong>Chọn một card để xem trước</strong>
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="ai-preview-empty ai-results-empty">
            <div className="ai-preview-empty-icon" aria-hidden="true">✦</div>
            <strong>Kết quả {actionLabel.toLocaleLowerCase('vi')} sẽ nằm ở đây</strong>
            <p>
              {isRandom
                ? `Agent trả ${expectedCount} biến thể → gom thành 1 bài → sửa/copy cả khối với dấu ${AI_POST_DELIMITER} → lưu một lần vào Thư viện gốc.`
                : 'Agent trả bài → card ngang gọn phía trên → chọn bài trong editor rộng bên dưới → chỉ khi bấm Lưu mới vào Thư viện gốc.'}
            </p>
            <div className="ai-preview-empty-notes">
              <span>✓ Không tự lưu</span>
              <span>✓ Preview rộng</span>
              <span>✓ Lưu Thư viện gốc</span>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
