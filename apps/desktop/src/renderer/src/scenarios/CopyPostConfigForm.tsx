import { useMemo, useState } from 'react'
import type { ActionConfig } from '../../../shared/actionRegistry'
import type { CopyPostMedia, CopyPostSaveItemResult, CopyPostScanItem, CopyPostScanRequest } from '../../../shared/copyPost'
import './copyPostConfig.css'

interface CopyPostConfigFormProps {
  config: ActionConfig
  onChange: (key: string, value: ActionConfig[string] | undefined) => void
}

type DraftStatus = 'ready' | 'saved' | 'error'
interface CopyDraft extends CopyPostScanItem {
  selected: boolean
  name: string
  editedContent: string
  selectedMediaKeys: string[]
  status: DraftStatus
  error: string | null
}

function stringValue(config: ActionConfig, key: string): string {
  return typeof config[key] === 'string' ? String(config[key]) : ''
}
function numberValue(config: ActionConfig, key: string, fallback: number): number {
  return typeof config[key] === 'number' && Number.isFinite(config[key]) ? Number(config[key]) : fallback
}
function boolValue(config: ActionConfig, key: string, fallback = false): boolean {
  return typeof config[key] === 'boolean' ? Boolean(config[key]) : fallback
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function requestFromConfig(config: ActionConfig, token: string): CopyPostScanRequest {
  return {
    token,
    sourcesText: stringValue(config, 'sourcesText'),
    fromDate: stringValue(config, 'fromDate'),
    toDate: stringValue(config, 'toDate'),
    limit: numberValue(config, 'limit', 50),
    randomCount: numberValue(config, 'randomCount', 0),
    includeStatus: boolValue(config, 'includeStatus', true),
    includePhoto: boolValue(config, 'includePhoto', true),
    includeVideo: boolValue(config, 'includeVideo', true),
    includeReel: boolValue(config, 'includeReel', true),
    includeLink: boolValue(config, 'includeLink', true),
    stripLinks: boolValue(config, 'stripLinks'),
    stripHashtags: boolValue(config, 'stripHashtags'),
    ignoreContent: boolValue(config, 'ignoreContent'),
    prefixText: stringValue(config, 'prefixText'),
    suffixText: stringValue(config, 'suffixText'),
    skipCopied: boolValue(config, 'skipCopied', true)
  }
}

function toDraft(item: CopyPostScanItem, index: number): CopyDraft {
  return {
    ...item,
    selected: true,
    name: `Copy ${item.source} · ${index + 1}`,
    editedContent: item.content,
    selectedMediaKeys: item.media.map((media) => media.key),
    status: 'ready',
    error: null
  }
}

function formatDate(value: string): string {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(time) : '—'
}

export function CopyPostConfigForm({ config, onChange }: CopyPostConfigFormProps) {
  const [token, setToken] = useState('')
  const [drafts, setDrafts] = useState<CopyDraft[]>([])
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedDrafts = useMemo(() => drafts.filter((draft) => draft.selected && draft.status !== 'saved'), [drafts])
  const selectedMediaCount = useMemo(() => selectedDrafts.reduce((sum, draft) => sum + draft.selectedMediaKeys.length, 0), [selectedDrafts])
  const mediaFolder = stringValue(config, 'mediaFolder').trim()
  const saveBlockedByFolder = selectedMediaCount > 0 && !mediaFolder

  const patchDraft = (key: string, patch: Partial<CopyDraft>) => {
    setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, ...patch, status: draft.status === 'saved' ? 'saved' : 'ready', error: null } : draft))
  }

  const scan = async () => {
    setScanning(true)
    setError(null)
    setNotice(null)
    try {
      const items = await window.pageAuto.scanCopyPosts(requestFromConfig(config, token))
      setDrafts(items.map(toDraft))
      setNotice(items.length ? `Đã quét ${items.length} bài. Chọn/sửa bài rồi lưu vào Thư viện.` : 'Không có bài phù hợp bộ lọc.')
    } catch (cause) {
      setDrafts([])
      setError(errorText(cause))
    } finally {
      setScanning(false)
    }
  }

  const pickFolder = async () => {
    const folder = await window.pageAuto.pickCopyPostMediaFolder()
    if (folder) onChange('mediaFolder', folder)
  }

  const applySaveResults = (items: CopyPostSaveItemResult[]) => {
    const byId = new Map(items.map((item) => [item.sourcePostId, item]))
    setDrafts((current) => current.map((draft) => {
      const result = byId.get(draft.sourcePostId)
      if (!result) return draft
      if (result.status === 'saved') return { ...draft, selected: false, status: 'saved', error: null }
      return { ...draft, status: 'error', error: result.error }
    }))
  }

  const saveSelected = async () => {
    if (!selectedDrafts.length || saveBlockedByFolder) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await window.pageAuto.saveCopyPosts({
        token,
        destinationFolder: mediaFolder,
        items: selectedDrafts.map((draft) => ({
          source: draft.source,
          sourcePostId: draft.sourcePostId,
          permalink: draft.permalink,
          name: draft.name,
          content: draft.editedContent,
          media: draft.media.filter((media) => draft.selectedMediaKeys.includes(media.key))
        }))
      })
      applySaveResults(result.items)
      if (result.savedCount > 0) window.dispatchEvent(new Event('page-auto:content-library-external-change'))
      setNotice(result.failedCount
        ? `Đã lưu ${result.savedCount} bài; ${result.failedCount} bài lỗi còn nguyên để sửa/thử lại.`
        : `Đã lưu ${result.savedCount} bài vào Thư viện bài viết chung.`)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setSaving(false)
    }
  }

  const toggleMedia = (draft: CopyDraft, media: CopyPostMedia, checked: boolean) => {
    const selectedMediaKeys = checked
      ? [...new Set([...draft.selectedMediaKeys, media.key])]
      : draft.selectedMediaKeys.filter((key) => key !== media.key)
    patchDraft(draft.key, { selectedMediaKeys })
  }

  return (
    <div className="copy-post-workspace">
      <section className="copy-post-source-card">
        <div className="copy-post-section-head"><strong>Nguồn quét</strong><span>Token chỉ giữ trong cửa sổ này, không lưu vào Kịch Bản hoặc file backup.</span></div>
        <label className="scenario-field wide">
          <span>Token quét thông tin *</span>
          <div className="copy-post-token-row">
            <input type={showToken ? 'text' : 'password'} value={token} onChange={(event) => setToken(event.target.value)} placeholder="Dán token Facebook..." autoComplete="off" />
            <button type="button" className="scenario-button" onClick={() => setShowToken((value) => !value)}>{showToken ? 'Ẩn' : 'Hiện'}</button>
          </div>
        </label>
        <label className="scenario-field wide"><span>Profile / Page nguồn *</span><textarea rows={4} value={stringValue(config, 'sourcesText')} onChange={(event) => onChange('sourcesText', event.target.value)} placeholder="Mỗi dòng một UID hoặc URL Facebook..." /></label>

        <div className="copy-post-filter-grid">
          <label className="scenario-field"><span>Từ ngày</span><input type="date" value={stringValue(config, 'fromDate')} onChange={(event) => onChange('fromDate', event.target.value)} /></label>
          <label className="scenario-field"><span>Đến ngày</span><input type="date" value={stringValue(config, 'toDate')} onChange={(event) => onChange('toDate', event.target.value)} /></label>
          <label className="scenario-field"><span>Giới hạn</span><input type="number" min={1} max={500} value={numberValue(config, 'limit', 50)} onChange={(event) => onChange('limit', Number(event.target.value))} /></label>
          <label className="scenario-field"><span>Random N bài</span><input type="number" min={0} max={500} value={numberValue(config, 'randomCount', 0)} onChange={(event) => onChange('randomCount', Number(event.target.value))} /></label>
        </div>

        <div className="copy-post-check-row">
          {([['includeStatus', 'Status'], ['includePhoto', 'Photo'], ['includeVideo', 'Video'], ['includeReel', 'Reel'], ['includeLink', 'Link']] as const).map(([key, label]) => (
            <label key={key}><input type="checkbox" checked={boolValue(config, key, true)} onChange={(event) => onChange(key, event.target.checked)} />{label}</label>
          ))}
        </div>
        <div className="copy-post-check-row secondary">
          <label><input type="checkbox" checked={boolValue(config, 'stripLinks')} onChange={(event) => onChange('stripLinks', event.target.checked)} />Bỏ link</label>
          <label><input type="checkbox" checked={boolValue(config, 'stripHashtags')} onChange={(event) => onChange('stripHashtags', event.target.checked)} />Bỏ hashtag</label>
          <label><input type="checkbox" checked={boolValue(config, 'ignoreContent')} onChange={(event) => onChange('ignoreContent', event.target.checked)} />Không lấy chữ</label>
          <label><input type="checkbox" checked={boolValue(config, 'skipCopied', true)} onChange={(event) => onChange('skipCopied', event.target.checked)} />Bỏ bài đã copy</label>
        </div>
        <div className="copy-post-filter-grid two">
          <label className="scenario-field"><span>Thêm đầu bài</span><textarea rows={2} value={stringValue(config, 'prefixText')} onChange={(event) => onChange('prefixText', event.target.value)} /></label>
          <label className="scenario-field"><span>Thêm cuối bài</span><textarea rows={2} value={stringValue(config, 'suffixText')} onChange={(event) => onChange('suffixText', event.target.value)} /></label>
        </div>
        <div className="copy-post-scan-actions"><button type="button" className="scenario-button primary" disabled={scanning || saving} onClick={() => void scan()}>{scanning ? 'Đang quét...' : 'Quét bài viết'}</button></div>
      </section>

      {error ? <div className="copy-post-message error">{error}</div> : null}
      {notice ? <div className="copy-post-message">{notice}</div> : null}

      {drafts.length ? (
        <section className="copy-post-results">
          <div className="copy-post-results-toolbar">
            <div><strong>{drafts.length} bài quét được</strong><span>{selectedDrafts.length} bài đang chọn · {selectedMediaCount} media</span></div>
            <div className="copy-post-folder-row">
              <input readOnly value={mediaFolder} placeholder={selectedMediaCount ? 'Bắt buộc chọn thư mục nếu lưu media' : 'Không cần folder với bài chỉ có chữ'} />
              <button type="button" className="scenario-button" onClick={() => void pickFolder()}>Chọn ổ/thư mục</button>
            </div>
          </div>
          {saveBlockedByFolder ? <div className="copy-post-folder-warning">Có ảnh/video đang được chọn — phải chọn thư mục trên ổ đĩa trước khi lưu.</div> : null}

          <div className="copy-post-list">
            {drafts.map((draft, index) => (
              <article key={draft.key} className={`copy-post-item ${draft.status}`}>
                <header>
                  <label><input type="checkbox" checked={draft.selected} disabled={draft.status === 'saved' || saving} onChange={(event) => patchDraft(draft.key, { selected: event.target.checked })} /><strong>Bài {index + 1}</strong></label>
                  <div><span>{draft.type.toUpperCase()}</span><span>{formatDate(draft.createdAt)}</span><span>{draft.source}</span>{draft.alreadyCopied ? <span>Đã copy trước</span> : null}</div>
                </header>
                <label className="scenario-field"><span>Tên bài</span><input value={draft.name} disabled={draft.status === 'saved' || saving} onChange={(event) => patchDraft(draft.key, { name: event.target.value })} /></label>
                <label className="scenario-field"><span>Nội dung</span><textarea rows={4} value={draft.editedContent} disabled={draft.status === 'saved' || saving} onChange={(event) => patchDraft(draft.key, { editedContent: event.target.value })} /></label>
                {draft.media.length ? (
                  <div className="copy-post-media-list">
                    {draft.media.map((media) => (
                      <label key={media.key} className="copy-post-media">
                        <input type="checkbox" checked={draft.selectedMediaKeys.includes(media.key)} disabled={draft.status === 'saved' || saving} onChange={(event) => toggleMedia(draft, media, event.target.checked)} />
                        {media.previewUrl ? <img src={media.previewUrl} alt="" /> : <div className="copy-post-media-placeholder">{media.kind === 'video' ? 'VIDEO' : 'ẢNH'}</div>}
                        <span>{media.kind === 'video' ? 'Video' : 'Ảnh'}</span>
                      </label>
                    ))}
                  </div>
                ) : <small className="copy-post-no-media">Bài không có media.</small>}
                <footer>
                  <span>{draft.status === 'saved' ? 'Đã lưu vào Thư viện' : draft.status === 'error' ? 'Lưu lỗi' : `${draft.selectedMediaKeys.length}/${draft.media.length} media được chọn`}</span>
                  {draft.permalink ? <span className="copy-post-permalink" title={draft.permalink}>Có permalink nguồn</span> : null}
                  {draft.error ? <strong>{draft.error}</strong> : null}
                </footer>
              </article>
            ))}
          </div>
          <div className="copy-post-save-bar">
            <span>{selectedMediaCount ? `Media sẽ lưu vào: ${mediaFolder || 'CHƯA CHỌN'}` : 'Các bài chỉ có chữ có thể lưu thẳng.'}</span>
            <button type="button" className="scenario-button primary" disabled={saving || !selectedDrafts.length || saveBlockedByFolder} onClick={() => void saveSelected()}>{saving ? 'Đang tải/lưu...' : `Lưu ${selectedDrafts.length} bài đã chọn vào Thư viện`}</button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
