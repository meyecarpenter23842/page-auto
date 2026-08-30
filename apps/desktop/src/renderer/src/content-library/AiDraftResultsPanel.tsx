import { useEffect, useMemo, useState } from 'react'
import {
  buildAiDraftBatch,
  CONTENT_LIBRARY_EXTERNAL_CHANGE_EVENT,
  countSavableAiDrafts,
  createCanonicalContentInput,
  getAiDraftVariantCount,
  type AiDraftResult
} from './aiDraftResults'
import { AI_POST_DELIMITER } from './aiPostOutputFormat'
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
}

interface BatchNotice {
  kind: 'success' | 'warning' | 'error'
  message: string
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function excerpt(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120)
}

export function AiDraftResultsPanel({
  expectedCount,
  actionLabel,
  incomingBatch = null
}: AiDraftResultsPanelProps) {
  const [rawOutput, setRawOutput] = useState('')
  const [drafts, setDrafts] = useState<AiDraftResult[]>([])
  const [activeId, setActiveId] = useState('')
  const [notice, setNotice] = useState<BatchNotice | null>(null)
  const [saving, setSaving] = useState(false)

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

    const messages = [batch.message, warning]
      .filter((value): value is string => Boolean(value?.trim()))
    setNotice({
      kind: batch.valid && !warning ? 'success' : 'warning',
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

  const clearResults = () => {
    setDrafts([])
    setActiveId('')
    setRawOutput('')
    setNotice(null)
  }

  const headerSummary = groupedRandomDraft
    ? `1 bài · ${getAiDraftVariantCount(groupedRandomDraft)} biến thể · ${selectedCount} chọn`
    : `${drafts.length} bài · ${selectedCount} chọn`

  return (
    <section className="ai-preview-panel">
      <div className="ai-preview-header">
        <div>
          <p>KẾT QUẢ</p>
          <h2>Bài viết xem trước</h2>
          <span className="ai-output-contract">
            {isRandom
              ? <>Random lưu thành 1 bài; các biến thể cách nhau bằng <code>{AI_POST_DELIMITER}</code></>
              : <>Chuẩn đầu ra: Bài 1 <code>{AI_POST_DELIMITER}</code> Bài 2 <code>{AI_POST_DELIMITER}</code> ...</>}
          </span>
        </div>
        <div className="ai-preview-actions">
          <span className="ai-result-count">{headerSummary}</span>
          <button
            className="ai-save-selected"
            type="button"
            disabled={saving || savableCount === 0}
            onClick={() => void saveSelected()}
          >
            {saving
              ? 'Đang lưu...'
              : groupedRandomDraft
                ? 'Lưu bài Random'
                : `Lưu ${savableCount || ''} bài đã chọn`.replace('  ', ' ')}
          </button>
        </div>
      </div>

      <div className="ai-preview-canvas ai-results-canvas">
        <details className="ai-agent-output-bridge" open={!drafts.length}>
          <summary>
            <span>
              <strong>Kết quả Agent</strong>
              <small>
                Agent tự đổ kết quả vào đây; có thể mở ra để kiểm tra output thô.
              </small>
            </span>
            <b>{expectedCount} {isRandom ? 'biến thể' : 'bài'}</b>
          </summary>
          <div className="ai-agent-output-body">
            <textarea
              value={rawOutput}
              onChange={(event) => setRawOutput(event.target.value)}
              placeholder={`Dán output ${actionLabel.toLocaleLowerCase('vi')} từ Agent tại đây. Mỗi bài cách nhau bằng ${AI_POST_DELIMITER}.`}
            />
            <div>
              <span>
                {isRandom
                  ? 'Đọc kết quả sẽ gom toàn bộ biến thể thành một bài Random.'
                  : 'Không tự lưu. Output chỉ trở thành draft để duyệt/sửa trước.'}
              </span>
              <button type="button" onClick={loadAgentOutput}>Đọc kết quả</button>
            </div>
          </div>
        </details>

        {notice ? (
          <div className={`ai-batch-notice ${notice.kind}`}>{notice.message}</div>
        ) : null}

        {drafts.length ? (
          <div className="ai-results-toolbar">
            <div>
              <strong>
                {groupedRandomDraft
                  ? `1 bài Random · ${getAiDraftVariantCount(groupedRandomDraft)} biến thể`
                  : `${drafts.length} kết quả`}
              </strong>
              <span>
                {savedCount ? `${savedCount} đã vào Thư viện` : 'Chưa bài nào được lưu'}
              </span>
            </div>
            <div>
              <button type="button" disabled={saving} onClick={toggleAll}>
                {selectedCount ? 'Đổi lựa chọn' : 'Chọn tất cả'}
              </button>
              <button type="button" disabled={saving} onClick={clearResults}>
                Xóa kết quả
              </button>
            </div>
          </div>
        ) : null}

        {drafts.length ? (
          <div className="ai-results-workspace">
            <div className="ai-draft-list" aria-label="Danh sách kết quả AI">
              {drafts.map((draft, index) => {
                const variantCount = getAiDraftVariantCount(draft)
                return (
                  <article
                    key={draft.id}
                    className={`ai-draft-row ${draft.status} ${activeDraft?.id === draft.id ? 'active' : ''}`}
                  >
                    <label
                      className="ai-draft-check"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={draft.selected}
                        disabled={saving || draft.status === 'saved'}
                        onChange={(event) => updateDraft(
                          draft.id,
                          { selected: event.target.checked }
                        )}
                      />
                    </label>
                    <button
                      className="ai-draft-open"
                      type="button"
                      onClick={() => setActiveId(draft.id)}
                    >
                      <span className="ai-draft-row-title">
                        <strong>
                          {draft.kind === 'variant_group' ? 'Bài Random' : `Bài ${index + 1}`}
                        </strong>
                        <span className={`ai-draft-status ${draft.status}`}>
                          {draft.status === 'saved'
                            ? 'Đã lưu'
                            : draft.status === 'error'
                              ? 'Lỗi lưu'
                              : 'Bản nháp'}
                        </span>
                      </span>
                      <small>
                        {draft.kind === 'variant_group'
                          ? `${variantCount} biến thể · ${draft.content.trim().length.toLocaleString('vi-VN')} ký tự`
                          : `${draft.content.trim().length.toLocaleString('vi-VN')} ký tự`}
                      </small>
                      <p>{excerpt(draft.content) || 'Chưa có nội dung'}</p>
                    </button>
                  </article>
                )
              })}
            </div>

            <section className="ai-draft-editor" aria-label="Preview bài đang chọn">
              {activeDraft ? (
                <>
                  <header className="ai-draft-editor-header">
                    <div>
                      <strong>
                        {activeDraft.kind === 'variant_group'
                          ? 'Preview bài Random'
                          : 'Preview bài đang chọn'}
                      </strong>
                      <small>
                        {activeDraft.kind === 'variant_group'
                          ? `${getAiDraftVariantCount(activeDraft)} biến thể trong cùng 1 bài Thư viện`
                          : 'Bấm card bên trái để đổi bài xem trước'}
                      </small>
                    </div>
                    <span className={`ai-draft-status ${activeDraft.status}`}>
                      {activeDraft.status === 'saved'
                        ? 'Đã lưu'
                        : activeDraft.status === 'error'
                          ? 'Lỗi lưu'
                          : 'Bản nháp'}
                    </span>
                  </header>

                  <label className="ai-draft-name ai-draft-editor-name">
                    <span>Tên bài</span>
                    <input
                      value={activeDraft.name}
                      disabled={saving}
                      onChange={(event) => updateDraft(
                        activeDraft.id,
                        { name: event.target.value }
                      )}
                    />
                  </label>

                  <label className="ai-draft-content ai-draft-editor-content">
                    <span>
                      Nội dung
                      {activeDraft.kind === 'variant_group'
                        ? ` · ${getAiDraftVariantCount(activeDraft)} biến thể, cách nhau bằng ${AI_POST_DELIMITER}`
                        : ''}
                    </span>
                    <textarea
                      value={activeDraft.content}
                      disabled={saving}
                      onChange={(event) => updateDraft(
                        activeDraft.id,
                        { content: event.target.value }
                      )}
                    />
                  </label>

                  <footer className="ai-draft-editor-footer">
                    <span>
                      {activeDraft.content.trim().length.toLocaleString('vi-VN')} ký tự
                    </span>
                    {activeDraft.error ? (
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
                    ) : null}
                  </footer>
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
                : 'Agent trả bài → card ngang gọn bên trái → bấm card để sửa/xem trên preview lớn bên phải → chỉ khi bấm Lưu mới vào Thư viện gốc.'}
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
