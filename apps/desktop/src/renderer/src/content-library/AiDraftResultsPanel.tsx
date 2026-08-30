import { useEffect, useMemo, useState } from 'react'
import {
  buildAiDraftBatch,
  CONTENT_LIBRARY_EXTERNAL_CHANGE_EVENT,
  countSavableAiDrafts,
  createCanonicalContentInput,
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

export function AiDraftResultsPanel({ expectedCount, actionLabel, incomingBatch = null }: AiDraftResultsPanelProps) {
  const [rawOutput, setRawOutput] = useState('')
  const [drafts, setDrafts] = useState<AiDraftResult[]>([])
  const [notice, setNotice] = useState<BatchNotice | null>(null)
  const [saving, setSaving] = useState(false)

  const selectedCount = useMemo(() => drafts.filter((draft) => draft.selected).length, [drafts])
  const savableCount = useMemo(() => countSavableAiDrafts(drafts), [drafts])
  const savedCount = useMemo(() => drafts.filter((draft) => draft.status === 'saved').length, [drafts])

  const applyRawOutput = (output: string, warning: string | null = null) => {
    if (!output.trim()) {
      setDrafts([])
      setNotice({ kind: 'error', message: 'Agent không trả về nội dung để đọc.' })
      return
    }
    const batch = buildAiDraftBatch(output, expectedCount)
    setRawOutput(output)
    setDrafts(batch.drafts)
    const messages = [batch.message, warning].filter((value): value is string => Boolean(value?.trim()))
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

  const updateDraft = (id: string, patch: Partial<Pick<AiDraftResult, 'name' | 'content' | 'selected'>>) => {
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
    if (!draft || !draft.content.trim()) return
    setSaving(true)
    setDrafts((current) => current.map((item) => item.id === id ? { ...item, error: null, status: 'ready' } : item))
    try {
      await window.pageAuto.createContentLibraryItem(createCanonicalContentInput(draft, index))
      setDrafts((current) => current.map((item) => item.id === id ? { ...item, selected: false, status: 'saved', error: null } : item))
      setNotice({ kind: 'success', message: 'Đã lưu lại bài lỗi vào Thư viện gốc.' })
      window.dispatchEvent(new Event(CONTENT_LIBRARY_EXTERNAL_CHANGE_EVENT))
    } catch (cause) {
      setDrafts((current) => current.map((item) => item.id === id ? { ...item, status: 'error', error: errorMessage(cause) } : item))
      setNotice({ kind: 'error', message: 'Bài vẫn chưa lưu được. Các bài đã lưu trước đó được giữ nguyên.' })
    } finally {
      setSaving(false)
    }
  }

  const saveSelected = async () => {
    const targets = drafts
      .map((draft, index) => ({ draft, index }))
      .filter(({ draft }) => draft.selected && draft.status !== 'saved' && draft.content.trim())
    if (!targets.length) return

    setSaving(true)
    setNotice(null)
    let successCount = 0
    let failureCount = 0

    for (const { draft, index } of targets) {
      try {
        await window.pageAuto.createContentLibraryItem(createCanonicalContentInput(draft, index))
        successCount += 1
        setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, selected: false, status: 'saved', error: null } : item))
      } catch (cause) {
        failureCount += 1
        setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, status: 'error', error: errorMessage(cause) } : item))
      }
    }

    if (successCount > 0) window.dispatchEvent(new Event(CONTENT_LIBRARY_EXTERNAL_CHANGE_EVENT))
    setNotice({
      kind: failureCount ? 'warning' : 'success',
      message: failureCount
        ? `Đã lưu ${successCount} bài; ${failureCount} bài lỗi được giữ lại để sửa hoặc thử lưu lại.`
        : `Đã lưu ${successCount} bài đã chọn vào Thư viện gốc.`
    })
    setSaving(false)
  }

  const toggleAll = () => {
    const shouldSelect = drafts.some((draft) => draft.status !== 'saved' && !draft.selected)
    setDrafts((current) => current.map((draft) => draft.status === 'saved' ? draft : { ...draft, selected: shouldSelect }))
  }

  const clearResults = () => {
    setDrafts([])
    setRawOutput('')
    setNotice(null)
  }

  return (
    <section className="ai-preview-panel">
      <div className="ai-preview-header">
        <div>
          <p>KẾT QUẢ</p>
          <h2>Bài viết xem trước</h2>
          <span className="ai-output-contract">Chuẩn đầu ra: Bài 1 <code>{AI_POST_DELIMITER}</code> Bài 2 <code>{AI_POST_DELIMITER}</code> ...</span>
        </div>
        <div className="ai-preview-actions">
          <span className="ai-result-count">{drafts.length} bài · {selectedCount} chọn</span>
          <button className="ai-save-selected" type="button" disabled={saving || savableCount === 0} onClick={() => void saveSelected()}>
            {saving ? 'Đang lưu...' : `Lưu ${savableCount || ''} bài đã chọn`.replace('  ', ' ')}
          </button>
        </div>
      </div>

      <div className="ai-preview-canvas ai-results-canvas">
        <details className="ai-agent-output-bridge" open={!drafts.length}>
          <summary>
            <span><strong>Kết quả Agent</strong><small>Agent chạy thật sẽ tự đổ vào đây; vẫn có thể dán output để kiểm tra.</small></span>
            <b>{expectedCount} bài</b>
          </summary>
          <div className="ai-agent-output-body">
            <textarea
              value={rawOutput}
              onChange={(event) => setRawOutput(event.target.value)}
              placeholder={`Dán output ${actionLabel.toLocaleLowerCase('vi')} từ Agent tại đây. Mỗi bài cách nhau bằng ${AI_POST_DELIMITER}.`}
            />
            <div>
              <span>Không tự lưu. Output chỉ trở thành draft để anh duyệt/sửa trước.</span>
              <button type="button" onClick={loadAgentOutput}>Đọc kết quả</button>
            </div>
          </div>
        </details>

        {notice ? <div className={`ai-batch-notice ${notice.kind}`}>{notice.message}</div> : null}

        {drafts.length ? (
          <div className="ai-results-toolbar">
            <div><strong>{drafts.length} kết quả</strong><span>{savedCount ? `${savedCount} đã vào Thư viện` : 'Chưa bài nào được lưu'}</span></div>
            <div><button type="button" disabled={saving} onClick={toggleAll}>{selectedCount ? 'Đổi lựa chọn' : 'Chọn tất cả'}</button><button type="button" disabled={saving} onClick={clearResults}>Xóa kết quả</button></div>
          </div>
        ) : null}

        {drafts.length ? (
          <div className="ai-draft-list">
            {drafts.map((draft, index) => (
              <article key={draft.id} className={`ai-draft-card ${draft.status}`}>
                <header>
                  <label className="ai-draft-check">
                    <input
                      type="checkbox"
                      checked={draft.selected}
                      disabled={saving || draft.status === 'saved'}
                      onChange={(event) => updateDraft(draft.id, { selected: event.target.checked })}
                    />
                    <span>Bài {index + 1}</span>
                  </label>
                  <span className={`ai-draft-status ${draft.status}`}>
                    {draft.status === 'saved' ? 'Đã lưu' : draft.status === 'error' ? 'Lỗi lưu' : 'Bản nháp'}
                  </span>
                </header>
                <label className="ai-draft-name">
                  <span>Tên bài</span>
                  <input value={draft.name} disabled={saving} onChange={(event) => updateDraft(draft.id, { name: event.target.value })} />
                </label>
                <label className="ai-draft-content">
                  <span>Nội dung</span>
                  <textarea value={draft.content} disabled={saving} onChange={(event) => updateDraft(draft.id, { content: event.target.value })} />
                </label>
                <footer>
                  <span>{draft.content.trim().length.toLocaleString('vi-VN')} ký tự</span>
                  {draft.error ? <div className="ai-draft-error"><b>!</b><span>{draft.error}</span><button type="button" disabled={saving} onClick={() => void retrySave(draft.id)}>Thử lưu lại</button></div> : null}
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <div className="ai-preview-empty ai-results-empty">
            <div className="ai-preview-empty-icon" aria-hidden="true">✦</div>
            <strong>Kết quả {actionLabel.toLocaleLowerCase('vi')} sẽ nằm ở đây</strong>
            <p>Agent trả bài → đọc theo dấu {AI_POST_DELIMITER} → sửa/chọn từng bài → chỉ khi bấm Lưu thì bài mới đi vào Thư viện gốc.</p>
            <div className="ai-preview-empty-notes"><span>✓ Không tự lưu</span><span>✓ Hỗ trợ partial</span><span>✓ Lưu Thư viện gốc</span></div>
          </div>
        )}
      </div>
    </section>
  )
}
