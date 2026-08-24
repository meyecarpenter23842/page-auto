import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_PAGE_TAB_IMAGE,
  IMAGE_MODES,
  MISSING_IMAGE_POLICIES,
  POST_SELECTION_MODES,
  formatPostVariantText,
  parsePostVariantText,
  type ImageFolderInspection,
  type PageTabPostInput,
  type PageTabPostItem,
  type PageTabPostLibrary,
  type PostSelectionMode
} from '../../../shared/pageTabs'
import './postLibrary.css'

interface PostDraft {
  key: string
  sourceId: number | null
  name: string
  enabled: boolean
  variantText: string
  image: PageTabPostInput['image']
}

interface PostLibraryModalProps {
  pageTabId: number
  initialLibrary: PageTabPostLibrary
  onClose: () => void
  onSaved: (library: PageTabPostLibrary) => void
}

function draftKey(): string {
  return `post-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function fromItem(item: PageTabPostItem): PostDraft {
  return {
    key: `saved-${item.id}`,
    sourceId: item.id,
    name: item.name,
    enabled: item.enabled,
    variantText: formatPostVariantText(item.variants),
    image: { ...item.image }
  }
}

function emptyDraft(index: number): PostDraft {
  return {
    key: draftKey(),
    sourceId: null,
    name: `Bài viết ${index + 1}`,
    enabled: true,
    variantText: '',
    image: { ...DEFAULT_PAGE_TAB_IMAGE, mode: 'random' }
  }
}

function cloneDraft(source: PostDraft, index: number): PostDraft {
  return {
    ...source,
    key: draftKey(),
    sourceId: null,
    name: `${source.name || `Bài viết ${index + 1}`} Copy`,
    image: { ...source.image }
  }
}

function toInput(post: PostDraft, sortOrder: number): PageTabPostInput {
  return {
    name: post.name.trim() || `Bài viết ${sortOrder + 1}`,
    enabled: post.enabled,
    sortOrder,
    variants: parsePostVariantText(post.variantText),
    image: {
      folderPath: post.image.folderPath.trim(),
      mode: post.image.mode,
      imagesPerPost: post.image.imagesPerPost,
      missingPolicy: post.image.missingPolicy
    }
  }
}

function validateDraft(post: PostDraft): void {
  const name = post.name.trim() || 'Bài viết'
  if (post.enabled && parsePostVariantText(post.variantText).length === 0) {
    throw new Error(`“${name}” đang bật nhưng chưa có nội dung.`)
  }
  if (!Number.isInteger(post.image.imagesPerPost) || post.image.imagesPerPost < 1 || post.image.imagesPerPost > 50) {
    throw new Error(`“${name}” phải lấy từ 1 đến 50 ảnh mỗi lần đăng.`)
  }
}

function modeLabel(mode: PostSelectionMode): string {
  return mode === 'random' ? 'Ngẫu nhiên' : 'Lần lượt'
}

function imageModeLabel(mode: PageTabPostInput['image']['mode']): string {
  if (mode === 'random') return 'Ngẫu nhiên'
  if (mode === 'filename_match') return 'Khớp tên Group UID'
  return 'Lần lượt'
}

export function PostLibraryModal({ pageTabId, initialLibrary, onClose, onSaved }: PostLibraryModalProps) {
  const initialDrafts = useMemo(() => initialLibrary.posts.map(fromItem), [initialLibrary])
  const [mode, setMode] = useState<PostSelectionMode>(initialLibrary.mode)
  const [posts, setPosts] = useState<PostDraft[]>(initialDrafts)
  const [selectedKey, setSelectedKey] = useState<string | null>(initialDrafts[0]?.key ?? null)
  const [editor, setEditor] = useState<PostDraft | null>(initialDrafts[0] ? { ...initialDrafts[0], image: { ...initialDrafts[0].image } } : null)
  const [creating, setCreating] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  const [libraryDirty, setLibraryDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inspection, setInspection] = useState<ImageFolderInspection | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    const folder = editor?.image.folderPath.trim() ?? ''
    if (!folder) {
      setInspection(null)
      return
    }
    let cancelled = false
    void window.pageAuto.inspectPageTabImageFolder(folder)
      .then((result) => { if (!cancelled) setInspection(result) })
      .catch(() => { if (!cancelled) setInspection({ exists: false, fileCount: 0 }) })
    return () => { cancelled = true }
  }, [editor?.image.folderPath])

  const activeStored = selectedKey ? posts.find((post) => post.key === selectedKey) ?? null : null
  const enabledCount = posts.filter((post) => post.enabled).length
  const variantTotal = posts.reduce((sum, post) => sum + parsePostVariantText(post.variantText).length, 0)

  const setEditorPatch = (patch: Partial<PostDraft>) => {
    setEditor((current) => current ? { ...current, ...patch } : current)
    setEditorDirty(true)
    setPreview(null)
  }

  const setImagePatch = (patch: Partial<PostDraft['image']>) => {
    setEditor((current) => current ? { ...current, image: { ...current.image, ...patch } } : current)
    setEditorDirty(true)
  }

  const choosePost = (post: PostDraft) => {
    if (editorDirty && !window.confirm('Bài đang chỉnh chưa được đưa vào danh sách. Bỏ thay đổi và mở bài khác?')) return
    setSelectedKey(post.key)
    setEditor({ ...post, image: { ...post.image } })
    setCreating(false)
    setEditorDirty(false)
    setError(null)
    setPreview(null)
  }

  const startNew = () => {
    if (editorDirty && !window.confirm('Bài đang chỉnh chưa được đưa vào danh sách. Bỏ thay đổi và tạo bài mới?')) return
    const next = emptyDraft(posts.length)
    setSelectedKey(null)
    setEditor(next)
    setCreating(true)
    setEditorDirty(true)
    setError(null)
    setPreview(null)
  }

  const materializeEditor = (source: PostDraft[]): PostDraft[] => {
    if (!editor || (!editorDirty && !creating)) return source
    validateDraft(editor)
    if (creating) return [...source, { ...editor, image: { ...editor.image } }]
    return source.map((post) => post.key === editor.key ? { ...editor, image: { ...editor.image } } : post)
  }

  const commitEditor = () => {
    if (!editor) return
    try {
      const next = materializeEditor(posts)
      setPosts(next)
      setSelectedKey(editor.key)
      setCreating(false)
      setEditorDirty(false)
      setLibraryDirty(true)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const togglePost = (key: string, enabled: boolean) => {
    setPosts((current) => current.map((post) => post.key === key ? { ...post, enabled } : post))
    if (editor?.key === key) setEditor((current) => current ? { ...current, enabled } : current)
    setLibraryDirty(true)
  }

  const moveSelected = (direction: -1 | 1) => {
    if (!selectedKey) return
    const index = posts.findIndex((post) => post.key === selectedKey)
    const target = index + direction
    if (index < 0 || target < 0 || target >= posts.length) return
    const next = [...posts]
    const current = next[index]
    const other = next[target]
    if (!current || !other) return
    next[index] = other
    next[target] = current
    setPosts(next)
    setLibraryDirty(true)
  }

  const duplicateSelected = () => {
    if (!activeStored) return
    const copy = cloneDraft(activeStored, posts.length)
    const next = [...posts, copy]
    setPosts(next)
    setSelectedKey(copy.key)
    setEditor({ ...copy, image: { ...copy.image } })
    setCreating(false)
    setEditorDirty(false)
    setLibraryDirty(true)
  }

  const deleteSelected = () => {
    if (!activeStored || !window.confirm(`Xóa “${activeStored.name}” khỏi danh sách bài viết?`)) return
    const next = posts.filter((post) => post.key !== activeStored.key)
    setPosts(next)
    const replacement = next[0] ?? null
    setSelectedKey(replacement?.key ?? null)
    setEditor(replacement ? { ...replacement, image: { ...replacement.image } } : null)
    setCreating(false)
    setEditorDirty(false)
    setLibraryDirty(true)
  }

  const pickFolder = async () => {
    const folder = await window.pageAuto.pickPageTabImageFolder()
    if (folder) setImagePatch({ folderPath: folder })
  }

  const importText = async () => {
    const result = await window.pageAuto.pickPageTabTextFile()
    if (!result) return
    setEditorPatch({ variantText: result.content })
  }

  const randomPreview = () => {
    const variants = parsePostVariantText(editor?.variantText ?? '')
    if (variants.length === 0) {
      setPreview('Chưa có biến thể nội dung để thử.')
      return
    }
    setPreview(variants[Math.floor(Math.random() * variants.length)] ?? variants[0] ?? '')
  }

  const saveLibrary = async () => {
    setSaving(true)
    setError(null)
    try {
      const nextPosts = materializeEditor(posts)
      nextPosts.forEach(validateDraft)
      const saved = await window.pageAuto.savePageTabPostLibrary({
        pageTabId,
        mode,
        posts: nextPosts.map(toInput)
      })
      const savedDrafts = saved.posts.map(fromItem)
      setPosts(savedDrafts)
      setMode(saved.mode)
      setLibraryDirty(false)
      setEditorDirty(false)
      setCreating(false)
      const nextSelected = savedDrafts[0] ?? null
      setSelectedKey(nextSelected?.key ?? null)
      setEditor(nextSelected ? { ...nextSelected, image: { ...nextSelected.image } } : null)
      onSaved(saved)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const hasUnsaved = libraryDirty || editorDirty || mode !== initialLibrary.mode

  return (
    <div className="page-tab-modal-backdrop" role="presentation" onMouseDown={() => {
      if (!hasUnsaved || window.confirm('Thư viện bài viết còn thay đổi chưa lưu. Đóng popup?')) onClose()
    }}>
      <section className="page-tab-modal pt-post-library-modal" role="dialog" aria-modal="true" aria-label="Quản lý bài viết" onMouseDown={(event) => event.stopPropagation()}>
        <div className="page-tab-modal-header pt-post-library-header">
          <div>
            <p className="eyebrow">Bài viết</p>
            <h2>Thư viện bài viết</h2>
            <p className="pt-post-library-subtitle">Mỗi bài có nhiều cách viết và nguồn ảnh riêng. Run mới sẽ snapshot thư viện này.</p>
          </div>
          <div className="pt-post-header-stats">
            <span>{enabledCount}/{posts.length} bật</span>
            <span>{variantTotal} biến thể</span>
            <button type="button" className="page-tab-icon-button" onClick={() => {
              if (!hasUnsaved || window.confirm('Thư viện bài viết còn thay đổi chưa lưu. Đóng popup?')) onClose()
            }}>×</button>
          </div>
        </div>

        {error ? <div className="page-tab-error pt-post-library-error">{error}</div> : null}

        <div className="pt-post-library-layout">
          <aside className="pt-post-list-pane">
            <div className="pt-post-list-toolbar">
              <button className="pt-button primary" type="button" onClick={startNew}>+ Bài mới</button>
              <div className="pt-post-mode-toggle" aria-label="Cách lấy bài">
                {POST_SELECTION_MODES.map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={mode === item ? 'active' : ''}
                    onClick={() => { setMode(item); setLibraryDirty(true) }}
                  >{modeLabel(item)}</button>
                ))}
              </div>
            </div>

            <div className="pt-post-list">
              {posts.map((post, index) => {
                const variantCount = parsePostVariantText(post.variantText).length
                return (
                  <div key={post.key} className={post.key === selectedKey ? 'pt-post-row active' : 'pt-post-row'}>
                    <input type="checkbox" checked={post.enabled} onChange={(event) => togglePost(post.key, event.target.checked)} title="Bật/tắt bài" />
                    <button type="button" className="pt-post-row-main" onClick={() => choosePost(post)}>
                      <strong>{index + 1}. {post.name || 'Bài chưa đặt tên'}</strong>
                      <span>{variantCount} biến thể · {post.image.folderPath ? `${post.image.imagesPerPost} ảnh/lượt` : 'Không ảnh'}</span>
                    </button>
                  </div>
                )
              })}
              {posts.length === 0 ? <div className="pt-post-empty">Chưa có bài viết. Bấm “+ Bài mới” để tạo bài đầu tiên.</div> : null}
            </div>

            <div className="pt-post-list-actions">
              <button type="button" onClick={() => moveSelected(-1)} disabled={!activeStored || posts[0]?.key === selectedKey}>↑</button>
              <button type="button" onClick={() => moveSelected(1)} disabled={!activeStored || posts.at(-1)?.key === selectedKey}>↓</button>
              <button type="button" onClick={duplicateSelected} disabled={!activeStored}>Nhân bản</button>
              <button type="button" className="danger" onClick={deleteSelected} disabled={!activeStored}>Xóa</button>
            </div>
          </aside>

          <div className="pt-post-editor-pane">
            {editor ? (
              <>
                <section className="pt-post-editor-section">
                  <div className="pt-post-section-title">
                    <div><span>Nội dung bài viết</span><strong>{creating ? 'Tạo bài mới' : 'Chỉnh bài đang chọn'}</strong></div>
                    <label className="pt-post-enabled-switch"><input type="checkbox" checked={editor.enabled} onChange={(event) => setEditorPatch({ enabled: event.target.checked })} /> Đăng bài này</label>
                  </div>
                  <label className="pt-stack-field"><span>Tên bài</span><input value={editor.name} onChange={(event) => setEditorPatch({ name: event.target.value })} placeholder="Ví dụ: Mỹ phẩm 01" /></label>
                  <label className="pt-stack-field">
                    <span>Các cách viết · dùng dấu <code>|</code> để phân cách</span>
                    <textarea
                      className="pt-post-variant-textarea"
                      rows={11}
                      value={editor.variantText}
                      onChange={(event) => setEditorPatch({ variantText: event.target.value })}
                      placeholder={'Nội dung cách 1\n|\nNội dung cách 2\n|\nNội dung cách 3'}
                    />
                  </label>
                  <div className="pt-post-editor-help">
                    <span>{parsePostVariantText(editor.variantText).length} biến thể · khi bài này được chọn sẽ lấy ngẫu nhiên 1 biến thể.</span>
                    <span>Muốn viết dấu | thật trong nội dung, dùng <code>\|</code>.</span>
                    <button type="button" className="pt-button secondary" onClick={() => void importText()}>Import TXT</button>
                    <button type="button" className="pt-button secondary" onClick={randomPreview}>Random thử</button>
                  </div>
                  {preview ? <div className="pt-post-preview"><strong>Preview:</strong><span>{preview}</span></div> : null}
                </section>

                <section className="pt-post-editor-section pt-post-image-section">
                  <div className="pt-post-section-title"><div><span>Ảnh của bài</span><strong>Nguồn ảnh riêng</strong></div></div>
                  <label className="pt-stack-field">
                    <span>Folder Windows</span>
                    <div className="pt-folder-row"><input readOnly value={editor.image.folderPath} placeholder="Không chọn folder = đăng text" /><button className="pt-button secondary" type="button" onClick={() => void pickFolder()}>Chọn folder</button></div>
                  </label>
                  <div className="pt-folder-status">
                    {!editor.image.folderPath ? 'Bài này hiện không dùng ảnh.' : inspection?.exists ? `${inspection.fileCount} ảnh jpg/jpeg/png/webp` : 'Folder không tồn tại hoặc không đọc được.'}
                  </div>
                  <div className="pt-form-grid three">
                    <label><span>Cách lấy ảnh</span><select value={editor.image.mode} onChange={(event) => setImagePatch({ mode: event.target.value as PostDraft['image']['mode'] })}>{IMAGE_MODES.map((item) => <option key={item} value={item}>{imageModeLabel(item)}</option>)}</select></label>
                    <label><span>Số ảnh/lần đăng</span><input type="number" min="1" max="50" value={editor.image.imagesPerPost} onChange={(event) => setImagePatch({ imagesPerPost: Number(event.target.value) })} /></label>
                    <label><span>Nếu thiếu ảnh</span><select value={editor.image.missingPolicy} onChange={(event) => setImagePatch({ missingPolicy: event.target.value as PostDraft['image']['missingPolicy'] })}>{MISSING_IMAGE_POLICIES.map((item) => <option key={item} value={item}>{item === 'skip' ? 'Bỏ qua Group' : 'Đăng text'}</option>)}</select></label>
                  </div>
                </section>

                <div className="pt-post-editor-commit">
                  <span>{editorDirty ? 'Có thay đổi chưa đưa vào danh sách.' : 'Bài trong danh sách đã đồng bộ với editor.'}</span>
                  <button className="pt-button primary" type="button" onClick={commitEditor}>{creating ? '+ Thêm bài' : 'Cập nhật bài'}</button>
                </div>
              </>
            ) : <div className="pt-post-editor-empty"><strong>Chọn một bài để chỉnh</strong><span>Hoặc tạo bài mới từ cột bên trái.</span><button className="pt-button primary" type="button" onClick={startNew}>+ Bài mới</button></div>}
          </div>
        </div>

        <div className="page-tab-modal-actions pt-post-library-footer">
          <span className="pt-modal-save-note">{initialLibrary.legacyFallback ? 'Đang hiển thị dữ liệu Content/Image cũ; bấm Lưu để chuyển sang Post Library.' : hasUnsaved ? 'Có thay đổi chưa lưu xuống SQLite.' : 'Đã lưu.'}</span>
          <button className="pt-button secondary" type="button" onClick={() => {
            if (!hasUnsaved || window.confirm('Bỏ thay đổi chưa lưu?')) onClose()
          }}>Đóng</button>
          <button className="pt-button primary" type="button" disabled={saving} onClick={() => void saveLibrary()}>{saving ? 'Đang lưu…' : 'Lưu thư viện bài viết'}</button>
        </div>
      </section>
    </div>
  )
}
