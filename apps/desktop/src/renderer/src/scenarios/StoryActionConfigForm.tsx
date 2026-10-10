import { useEffect, useMemo, useState } from 'react'
import type { ActionConfig } from '../../../shared/actionRegistry'
import {
  encodeStoryIds,
  parseStoryIds,
  type CreateStoryInput,
  type StoryFolderMode,
  type StoryMediaKind,
  type StoryMediaSourceType,
  type StoryRecord
} from '../../../shared/story'
import './storyActionConfig.css'

interface StoryActionConfigFormProps {
  config: ActionConfig
  onChange: (key: string, value: ActionConfig[string] | undefined) => void
}

interface StoryEditorState {
  mode: 'create' | 'edit'
  story: CreateStoryInput & { id?: number }
}

function emptyStory(): CreateStoryInput {
  return {
    name: 'Story mới',
    content: '',
    mediaSourceType: 'none',
    mediaPath: '',
    mediaKind: 'auto',
    folderMode: 'sequential',
    linkUrl: '',
    randomBackground: false,
    randomFont: false
  }
}

function toEditorStory(story: StoryRecord): CreateStoryInput & { id: number } {
  return {
    id: story.id,
    name: story.name,
    content: story.content,
    mediaSourceType: story.mediaSourceType,
    mediaPath: story.mediaPath,
    mediaKind: story.mediaKind,
    folderMode: story.folderMode,
    linkUrl: story.linkUrl,
    randomBackground: story.randomBackground,
    randomFont: story.randomFont
  }
}

function mediaLabel(story: Pick<StoryRecord, 'mediaSourceType' | 'mediaKind' | 'mediaPath'>): string {
  if (story.mediaSourceType === 'none') return 'Story chữ'
  const type = story.mediaKind === 'image' ? 'Ảnh' : story.mediaKind === 'video' ? 'Video' : 'Ảnh/Video'
  return story.mediaSourceType === 'folder' ? `${type} · Folder` : type
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function previewText(content: string): string {
  return content.replace(/\{([^{}]+)\}/g, (_whole, body: string) => body.split('|')[0]?.trim() ?? '')
}

function moveId(ids: readonly number[], index: number, direction: -1 | 1): number[] {
  const target = index + direction
  if (target < 0 || target >= ids.length) return [...ids]
  const output = [...ids]
  const current = output[index]
  output[index] = output[target]!
  output[target] = current!
  return output
}

function StoryEditor({ state, onClose, onSaved }: {
  state: StoryEditorState
  onClose: () => void
  onSaved: (story: StoryRecord) => void
}) {
  const [draft, setDraft] = useState(() => ({ ...state.story }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const source = draft.mediaSourceType ?? 'none'
  const kind = draft.mediaKind ?? 'auto'
  const folderMode = draft.folderMode ?? 'sequential'
  const content = draft.content ?? ''
  const mediaPath = draft.mediaPath ?? ''
  const linkUrl = draft.linkUrl ?? ''

  const localError = useMemo(() => {
    if (!draft.name.trim()) return 'Cần nhập tên Story.'
    if (source === 'none' && !content.trim()) return 'Story cần nội dung chữ hoặc media.'
    if (source !== 'none' && !mediaPath.trim()) return 'Story media cần chọn file hoặc folder.'
    if (linkUrl.trim() && !/^https?:\/\//i.test(linkUrl.trim())) return 'Link Story phải bắt đầu bằng http:// hoặc https://.'
    return null
  }, [content, draft.name, linkUrl, mediaPath, source])

  const patch = <K extends keyof CreateStoryInput>(key: K, value: CreateStoryInput[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setError(null)
  }

  const pickMedia = async (nextSource: Exclude<StoryMediaSourceType, 'none'>) => {
    const picked = nextSource === 'file'
      ? await window.pageAuto.pickStoryMediaFile()
      : await window.pageAuto.pickStoryMediaFolder()
    if (!picked) return
    setDraft((current) => ({ ...current, mediaSourceType: nextSource, mediaPath: picked }))
    setError(null)
  }

  const save = async () => {
    if (localError || saving) return
    setSaving(true)
    setError(null)
    try {
      const input: CreateStoryInput = {
        name: draft.name.trim(),
        content,
        mediaSourceType: source,
        mediaPath: source === 'none' ? '' : mediaPath,
        mediaKind: kind,
        folderMode,
        linkUrl: linkUrl.trim(),
        randomBackground: Boolean(draft.randomBackground),
        randomFont: Boolean(draft.randomFont)
      }
      const saved = state.mode === 'edit' && typeof draft.id === 'number'
        ? await window.pageAuto.updateStory({ ...input, id: draft.id })
        : await window.pageAuto.createStory(input)
      onSaved(saved)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="story-editor-backdrop" role="presentation">
      <section className="story-editor-modal" role="dialog" aria-modal="true" aria-label="Soạn Story">
        <header className="story-editor-header">
          <div>
            <span className="story-editor-eyebrow">STORY EDITOR</span>
            <h3>{state.mode === 'create' ? 'Thêm Story' : 'Sửa Story'}</h3>
            <p>Mỗi Story là dữ liệu dùng lại được. File/folder media chỉ được tham chiếu, không bị copy hoặc xóa.</p>
          </div>
          <button className="story-icon-button" type="button" onClick={onClose}>×</button>
        </header>

        <div className="story-editor-layout">
          <div className="story-editor-fields">
            <label className="story-field">
              <span>Tên Story</span>
              <input maxLength={200} value={draft.name} onChange={(event) => patch('name', event.target.value)} />
            </label>

            <label className="story-field">
              <span>Nội dung / Spintax</span>
              <textarea
                maxLength={20_000}
                rows={7}
                placeholder="Ví dụ: {Chào buổi sáng|Ngày mới vui vẻ}..."
                value={content}
                onChange={(event) => patch('content', event.target.value)}
              />
              <small>Dùng {'{A|B|C}'} để random nội dung lúc chạy.</small>
            </label>

            <div className="story-field">
              <span>Media</span>
              <div className="story-media-actions">
                <button type="button" onClick={() => patch('mediaSourceType', 'none')}>Không media</button>
                <button type="button" onClick={() => void pickMedia('file')}>Chọn file</button>
                <button type="button" onClick={() => void pickMedia('folder')}>Chọn folder</button>
              </div>
              <div className={`story-media-path ${mediaPath ? 'is-set' : ''}`}>
                <strong>{source === 'none' ? 'Không dùng media' : source === 'folder' ? 'Folder' : 'File'}</strong>
                <span>{mediaPath || 'Chưa chọn đường dẫn'}</span>
              </div>
            </div>

            {source !== 'none' ? (
              <div className="story-inline-fields">
                <label className="story-field">
                  <span>Loại media</span>
                  <select value={kind} onChange={(event) => patch('mediaKind', event.target.value as StoryMediaKind)}>
                    <option value="auto">Tự nhận ảnh/video</option>
                    <option value="image">Chỉ ảnh</option>
                    <option value="video">Chỉ video</option>
                  </select>
                </label>
                {source === 'folder' ? (
                  <label className="story-field">
                    <span>Cách lấy trong folder</span>
                    <select value={folderMode} onChange={(event) => patch('folderMode', event.target.value as StoryFolderMode)}>
                      <option value="sequential">Tuần tự</option>
                      <option value="random">Ngẫu nhiên</option>
                    </select>
                  </label>
                ) : <div />}
              </div>
            ) : null}

            <label className="story-field">
              <span>Link đính kèm</span>
              <input maxLength={2_000} placeholder="https://..." value={linkUrl} onChange={(event) => patch('linkUrl', event.target.value)} />
              <small>Nếu Facebook không hiện Link/Sticker phù hợp, runtime sẽ dừng trước khi đăng để tránh mất link.</small>
            </label>

            <div className="story-option-row">
              <label><input type="checkbox" checked={Boolean(draft.randomBackground)} onChange={(event) => patch('randomBackground', event.target.checked)} /> Random nền Story chữ</label>
              <label><input type="checkbox" checked={Boolean(draft.randomFont)} onChange={(event) => patch('randomFont', event.target.checked)} /> Random font</label>
            </div>

            {localError || error ? <div className="story-error">{error ?? localError}</div> : null}
          </div>

          <aside className="story-preview-panel">
            <span className="story-preview-label">Preview 9:16</span>
            <div className="story-phone-preview">
              {source === 'none' ? <div className="story-preview-gradient" /> : (
                <div className="story-preview-media">
                  <span className="story-preview-media-icon">{kind === 'video' ? '▶' : '▣'}</span>
                  <strong>{source === 'folder' ? 'Folder media' : basename(mediaPath || 'Media')}</strong>
                  <small>{kind === 'auto' ? 'Ảnh / Video' : kind === 'image' ? 'Ảnh' : 'Video'}</small>
                </div>
              )}
              {content.trim() ? <div className="story-preview-copy">{previewText(content)}</div> : null}
              {linkUrl.trim() ? <div className="story-preview-link">🔗 {linkUrl.trim()}</div> : null}
            </div>
            <p>Preview chỉ mô phỏng bố cục. Renderer không đọc trực tiếp file local.</p>
          </aside>
        </div>

        <footer className="story-editor-footer">
          <button className="story-secondary" type="button" onClick={onClose}>Hủy</button>
          <button className="story-primary" type="button" disabled={Boolean(localError) || saving} onClick={() => void save()}>{saving ? 'Đang lưu...' : 'Lưu Story'}</button>
        </footer>
      </section>
    </div>
  )
}

export function StoryActionConfigForm({ config, onChange }: StoryActionConfigFormProps) {
  const [library, setLibrary] = useState<StoryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showLibrary, setShowLibrary] = useState(false)
  const [editor, setEditor] = useState<StoryEditorState | null>(null)
  const selectedIds = useMemo(() => parseStoryIds(config.storyIds), [config.storyIds])
  const selectedStories = useMemo(() => {
    const byId = new Map(library.map((story) => [story.id, story]))
    return selectedIds.map((id) => byId.get(id)).filter((story): story is StoryRecord => Boolean(story))
  }, [library, selectedIds])

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      setLibrary(await window.pageAuto.listStories())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const commitIds = (ids: readonly number[]) => onChange('storyIds', encodeStoryIds(ids))
  const appendStory = (story: StoryRecord) => {
    if (!selectedIds.includes(story.id)) commitIds([...selectedIds, story.id])
  }

  const onSaved = async (story: StoryRecord) => {
    setEditor(null)
    const nextLibrary = await window.pageAuto.listStories().catch(() => [story, ...library.filter((item) => item.id !== story.id)])
    setLibrary(nextLibrary)
    appendStory(story)
  }

  const orderMode = typeof config.orderMode === 'string' ? config.orderMode : 'sequential'
  const storiesPerAccount = typeof config.storiesPerAccount === 'number' ? config.storiesPerAccount : 1
  const delayMin = typeof config.delayMinSeconds === 'number' ? config.delayMinSeconds : 200
  const delayMax = typeof config.delayMaxSeconds === 'number' ? config.delayMaxSeconds : 300
  const pauseAfter = typeof config.pauseAfterStories === 'number' ? config.pauseAfterStories : 30
  const pauseMinutes = typeof config.pauseMinutes === 'number' ? config.pauseMinutes : 15
  const unselected = library.filter((story) => !selectedIds.includes(story.id))

  return (
    <div className="story-action-config">
      <section className="story-config-card">
        <div className="story-card-header">
          <div>
            <span className="story-card-kicker">DANH SÁCH STORY</span>
            <h3>Story dùng cho action này</h3>
            <p>Nút Thêm tạo Story vào kho dùng chung rồi tự gắn vào action. Có thể chọn Story đã tạo từ kho bên dưới.</p>
          </div>
          <div className="story-header-actions">
            <button className="story-secondary" type="button" onClick={() => setShowLibrary((value) => !value)}>{showLibrary ? 'Ẩn kho Story' : 'Chọn từ kho'}</button>
            <button className="story-primary" type="button" onClick={() => setEditor({ mode: 'create', story: emptyStory() })}>+ Thêm Story</button>
          </div>
        </div>

        {showLibrary ? (
          <div className="story-library-drawer">
            <div className="story-library-title"><strong>Kho Story dùng chung</strong><span>{unselected.length} Story chưa chọn</span></div>
            {loading ? <div className="story-empty-small">Đang tải...</div> : unselected.length ? unselected.map((story) => (
              <button className="story-library-item" type="button" key={story.id} onClick={() => appendStory(story)}>
                <span className="story-library-icon">{story.mediaSourceType === 'none' ? 'Aa' : story.mediaKind === 'video' ? '▶' : '▣'}</span>
                <span><strong>{story.name}</strong><small>{mediaLabel(story)}{story.content ? ` · ${story.content.slice(0, 70)}` : ''}</small></span>
                <span>+ Chọn</span>
              </button>
            )) : <div className="story-empty-small">Không còn Story nào chưa chọn.</div>}
          </div>
        ) : null}

        {selectedStories.length ? (
          <div className="story-selected-list">
            {selectedStories.map((story, index) => (
              <div className="story-selected-row" key={story.id}>
                <span className="story-order-badge">{index + 1}</span>
                <span className="story-type-badge">{story.mediaSourceType === 'none' ? 'Aa' : story.mediaKind === 'video' ? '▶' : '▣'}</span>
                <span className="story-row-main">
                  <strong>{story.name}</strong>
                  <span>{mediaLabel(story)}{story.linkUrl ? ' · Có link' : ''}</span>
                  <small>{story.mediaPath || story.content || '—'}</small>
                </span>
                <span className="story-row-actions">
                  <button type="button" disabled={index === 0} onClick={() => commitIds(moveId(selectedIds, index, -1))}>↑</button>
                  <button type="button" disabled={index === selectedStories.length - 1} onClick={() => commitIds(moveId(selectedIds, index, 1))}>↓</button>
                  <button type="button" onClick={() => setEditor({ mode: 'edit', story: toEditorStory(story) })}>Sửa</button>
                  <button className="danger" type="button" onClick={() => commitIds(selectedIds.filter((id) => id !== story.id))}>Bỏ</button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="story-empty-state">
            <strong>Chưa chọn Story</strong>
            <span>Tạo Story mới hoặc chọn từ kho Story dùng chung.</span>
          </div>
        )}

        {error ? <div className="story-error">{error}</div> : null}
      </section>

      <section className="story-config-card">
        <div className="story-card-header compact">
          <div>
            <span className="story-card-kicker">CÁCH CHẠY</span>
            <h3>Số lượng & timing</h3>
          </div>
        </div>
        <div className="story-runtime-grid">
          <label className="story-field"><span>Thứ tự Story</span><select value={orderMode} onChange={(event) => onChange('orderMode', event.target.value)}><option value="sequential">Tuần tự</option><option value="random">Ngẫu nhiên</option></select></label>
          <label className="story-field"><span>Story / tài khoản</span><input type="number" min={1} max={100} value={storiesPerAccount} onChange={(event) => onChange('storiesPerAccount', Number(event.target.value))} /></label>
          <label className="story-field"><span>Delay từ (giây)</span><input type="number" min={0} max={86400} value={delayMin} onChange={(event) => onChange('delayMinSeconds', Number(event.target.value))} /></label>
          <label className="story-field"><span>Delay đến (giây)</span><input type="number" min={0} max={86400} value={delayMax} onChange={(event) => onChange('delayMaxSeconds', Number(event.target.value))} /></label>
          <label className="story-field"><span>Tạm dừng sau N Story</span><input type="number" min={0} max={100} value={pauseAfter} onChange={(event) => onChange('pauseAfterStories', Number(event.target.value))} /></label>
          <label className="story-field"><span>Tạm dừng (phút)</span><input type="number" min={0} max={1440} value={pauseMinutes} onChange={(event) => onChange('pauseMinutes', Number(event.target.value))} /></label>
        </div>
        <div className="story-runtime-note">Mặc định: delay 200–300 giây; sau 30 Story nghỉ 15 phút. File/folder media nguồn không bị xóa sau khi đăng.</div>
      </section>

      {editor ? <StoryEditor state={editor} onClose={() => setEditor(null)} onSaved={(story) => void onSaved(story)} /> : null}
    </div>
  )
}
