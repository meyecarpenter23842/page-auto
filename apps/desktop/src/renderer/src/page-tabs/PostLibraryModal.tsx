import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_PAGE_TAB_IMAGE,
  POST_SELECTION_MODES,
  formatPostVariantText,
  parsePostVariantText,
  type CanonicalPostSummary,
  type ImageFolderInspection,
  type PageTabImageConfig,
  type PageTabPostItem,
  type PageTabPostLibrary,
  type PostSelectionMode,
  type SavePageTabPostItemInput
} from '../../../shared/pageTabs'
import './postLibrary.css'

interface Draft extends SavePageTabPostItemInput {
  key: string
  postId: number | null
  canonical: CanonicalPostSummary | null
  variantText: string
}

interface Props {
  pageTabId: number
  initialLibrary: PageTabPostLibrary
  onClose: () => void
  onSaved: (library: PageTabPostLibrary) => void
}

const key = () => `post-${Date.now()}-${Math.random().toString(36).slice(2)}`
const copyImage = (image: PageTabImageConfig) => ({ ...image })
const sameText = (a: string[], b: string[]) => formatPostVariantText(a) === formatPostVariantText(b)

function fromBinding(item: PageTabPostItem): Draft {
  return {
    key: `binding-${item.id}`,
    postId: item.postId,
    canonical: { ...item.canonical, variants: [...item.canonical.variants], image: copyImage(item.canonical.image) },
    name: item.name,
    enabled: item.enabled,
    sortOrder: item.sortOrder,
    variants: [...item.variants],
    variantText: formatPostVariantText(item.variants),
    image: copyImage(item.image)
  }
}

function fromCanonical(item: CanonicalPostSummary, sortOrder: number): Draft {
  return {
    key: key(), postId: item.postId,
    canonical: { ...item, variants: [...item.variants], image: copyImage(item.image) },
    name: item.name, enabled: true, sortOrder,
    variants: [...item.variants], variantText: formatPostVariantText(item.variants), image: copyImage(item.image)
  }
}

function newDraft(index: number): Draft {
  return {
    key: key(), postId: null, canonical: null, name: `Bài viết ${index + 1}`,
    enabled: true, sortOrder: index, variants: [], variantText: '',
    image: { ...DEFAULT_PAGE_TAB_IMAGE, mode: 'random' }
  }
}

function toInput(draft: Draft, sortOrder: number): SavePageTabPostItemInput {
  return {
    postId: draft.postId,
    name: draft.name.trim() || `Bài viết ${sortOrder + 1}`,
    enabled: draft.enabled,
    sortOrder,
    variants: parsePostVariantText(draft.variantText),
    image: { ...draft.image, folderPath: draft.image.folderPath.trim() }
  }
}

function validate(draft: Draft): void {
  const variants = parsePostVariantText(draft.variantText)
  if (!variants.length && !draft.image.folderPath.trim()) throw new Error(`“${draft.name || 'Bài viết'}” cần có nội dung hoặc folder ảnh.`)
  if (!Number.isInteger(draft.image.imagesPerPost) || draft.image.imagesPerPost < 1 || draft.image.imagesPerPost > 50) {
    throw new Error('Số ảnh mỗi lượt phải từ 1 đến 50.')
  }
}

function overridden(draft: Draft): boolean {
  const base = draft.canonical
  if (!base) return false
  const variants = parsePostVariantText(draft.variantText)
  return draft.name.trim() !== base.name || !sameText(variants, base.variants)
    || draft.image.folderPath.trim() !== base.image.folderPath || draft.image.mode !== base.image.mode
    || draft.image.imagesPerPost !== base.image.imagesPerPost || draft.image.missingPolicy !== base.image.missingPolicy
}

function Picker({ items, bound, onPick, onClose }: {
  items: CanonicalPostSummary[]
  bound: Set<number>
  onPick: (item: CanonicalPostSummary) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter((item) => !bound.has(item.postId) && (!query || [item.name, ...item.variants].some((v) => v.toLowerCase().includes(query))))
  }, [bound, items, search])
  return <div className="page-tab-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="page-tab-modal pt-post-library-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
      <div className="page-tab-modal-header pt-post-library-header"><div><p className="eyebrow">Kho bài viết gốc</p><h2>Chọn từ thư viện</h2><p className="pt-post-library-subtitle">Chỉ gắn bài có sẵn vào Page, không tạo bản copy.</p></div><button className="page-tab-icon-button" onClick={onClose}>×</button></div>
      <div className="pt-post-list-toolbar"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm tên hoặc nội dung…"/><span>{rows.length} bài</span></div>
      <div className="pt-post-list" style={{ maxHeight: '52vh' }}>{rows.map((item) => <div className="pt-post-row" key={item.postId}>
        <button className="pt-post-row-main" onClick={() => onPick(item)}><strong>#{item.postId} · {item.name}</strong><span>{item.variants.length} biến thể · {item.image.folderPath ? `${item.image.imagesPerPost} ảnh/lượt` : 'Không ảnh'}</span></button>
        <button className="pt-button primary" onClick={() => onPick(item)}>Chọn</button>
      </div>)}{!rows.length ? <div className="pt-post-empty">Không còn bài phù hợp để chọn.</div> : null}</div>
      <div className="page-tab-modal-actions"><button className="pt-button secondary" onClick={onClose}>Đóng</button></div>
    </section>
  </div>
}

export function PostLibraryModal({ pageTabId, initialLibrary, onClose, onSaved }: Props) {
  const initial = useMemo(() => initialLibrary.posts.map(fromBinding), [initialLibrary])
  const [mode, setMode] = useState<PostSelectionMode>(initialLibrary.mode)
  const [posts, setPosts] = useState<Draft[]>(initial)
  const [available, setAvailable] = useState(initialLibrary.availablePosts)
  const [selected, setSelected] = useState<string | null>(initial[0]?.key ?? null)
  const [editor, setEditor] = useState<Draft | null>(initial[0] ? { ...initial[0], image: copyImage(initial[0].image) } : null)
  const [creating, setCreating] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  const [picker, setPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inspection, setInspection] = useState<ImageFolderInspection | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    const folder = editor?.image.folderPath.trim() ?? ''
    if (!folder) { setInspection(null); return }
    let cancelled = false
    void window.pageAuto.inspectPageTabImageFolder(folder).then((value) => { if (!cancelled) setInspection(value) }).catch(() => { if (!cancelled) setInspection({ exists: false, fileCount: 0 }) })
    return () => { cancelled = true }
  }, [editor?.image.folderPath])

  const active = selected ? posts.find((item) => item.key === selected) ?? null : null
  const bound = useMemo(() => new Set(posts.flatMap((item) => item.postId === null ? [] : [item.postId])), [posts])
  const unsaved = dirty || editorDirty || mode !== initialLibrary.mode
  const patch = (value: Partial<Draft>) => { setEditor((old) => old ? { ...old, ...value } : old); setEditorDirty(true); setPreview(null) }
  const imagePatch = (value: Partial<PageTabImageConfig>) => { setEditor((old) => old ? { ...old, image: { ...old.image, ...value } } : old); setEditorDirty(true) }

  const choose = (item: Draft) => {
    if (editorDirty && !window.confirm('Bỏ thay đổi chưa áp dụng của bài đang sửa?')) return
    setSelected(item.key); setEditor({ ...item, variants: [...item.variants], image: copyImage(item.image) }); setCreating(false); setEditorDirty(false); setError(null)
  }
  const create = () => {
    if (editorDirty && !window.confirm('Bỏ thay đổi chưa áp dụng và tạo bài mới?')) return
    const next = newDraft(posts.length); setSelected(null); setEditor(next); setCreating(true); setEditorDirty(true); setError(null)
  }
  const pickExisting = (item: CanonicalPostSummary) => {
    const next = fromCanonical(item, posts.length); setPosts((old) => [...old, next]); setSelected(next.key); setEditor(next); setCreating(false); setEditorDirty(false); setDirty(true); setPicker(false)
  }
  const applyEditor = () => {
    if (!editor) return
    try {
      validate(editor)
      const next = { ...editor, variants: parsePostVariantText(editor.variantText), image: copyImage(editor.image) }
      setPosts((old) => creating ? [...old, next] : old.map((item) => item.key === next.key ? next : item))
      setSelected(next.key); setCreating(false); setEditorDirty(false); setDirty(true); setError(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const reset = () => {
    if (!editor?.canonical) return
    const base = editor.canonical
    patch({ name: base.name, variants: [...base.variants], variantText: formatPostVariantText(base.variants), image: copyImage(base.image) })
  }
  const toggle = (keyValue: string, enabled: boolean) => { setPosts((old) => old.map((item) => item.key === keyValue ? { ...item, enabled } : item)); if (editor?.key === keyValue) setEditor((old) => old ? { ...old, enabled } : old); setDirty(true) }
  const move = (delta: -1 | 1) => {
    if (!selected) return
    const index = posts.findIndex((item) => item.key === selected); const target = index + delta
    if (index < 0 || target < 0 || target >= posts.length) return
    const next = [...posts]; [next[index], next[target]] = [next[target]!, next[index]!]; setPosts(next); setDirty(true)
  }
  const clone = () => {
    if (!active) return
    const next: Draft = { ...active, key: key(), postId: null, canonical: null, name: `${active.name} Copy`, variants: [...active.variants], image: copyImage(active.image) }
    setPosts((old) => [...old, next]); setSelected(next.key); setEditor(next); setCreating(false); setEditorDirty(false); setDirty(true)
  }
  const unlink = () => {
    if (!active || !window.confirm(`Gỡ “${active.name}” khỏi Page? Bài gốc vẫn còn trong thư viện.`)) return
    const next = posts.filter((item) => item.key !== active.key); const first = next[0] ?? null
    setPosts(next); setSelected(first?.key ?? null); setEditor(first ? { ...first, image: copyImage(first.image) } : null); setCreating(false); setEditorDirty(false); setDirty(true)
  }
  const importText = async () => {
    if (!editor) return
    const file = await window.pageAuto.pickPageTabTextFile(); if (!file) return
    const values = file.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    patch({ variants: values, variantText: formatPostVariantText(values) })
  }
  const pickFolder = async () => { const folder = await window.pageAuto.pickPageTabImageFolder(); if (folder) imagePatch({ folderPath: folder }) }
  const randomPreview = () => { if (!editor) return; const values = parsePostVariantText(editor.variantText); setPreview(values.length ? values[Math.floor(Math.random() * values.length)] ?? null : null) }
  const save = async () => {
    setSaving(true); setError(null)
    try {
      let next = posts
      if (editor && (editorDirty || creating)) { validate(editor); const normalized = { ...editor, variants: parsePostVariantText(editor.variantText), image: copyImage(editor.image) }; next = creating ? [...posts, normalized] : posts.map((item) => item.key === normalized.key ? normalized : item) }
      next.forEach(validate)
      const saved = await window.pageAuto.savePageTabPostLibrary({ pageTabId, mode, posts: next.map(toInput) })
      const drafts = saved.posts.map(fromBinding); setPosts(drafts); setAvailable(saved.availablePosts); setMode(saved.mode); setDirty(false); setEditorDirty(false); setCreating(false)
      const first = drafts[0] ?? null; setSelected(first?.key ?? null); setEditor(first ? { ...first, image: copyImage(first.image) } : null); onSaved(saved)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setSaving(false) }
  }
  const close = () => { if (!unsaved || window.confirm('Còn thay đổi chưa lưu. Đóng popup?')) onClose() }

  return <>
    <div className="page-tab-modal-backdrop" role="presentation" onMouseDown={close}>
      <section className="page-tab-modal pt-post-library-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="page-tab-modal-header pt-post-library-header"><div><p className="eyebrow">Bài viết của Page</p><h2>Danh sách bài đang dùng</h2><p className="pt-post-library-subtitle">Page chỉ giữ liên kết. Gỡ ở đây không xóa bài gốc.</p></div><div className="pt-post-header-stats"><span>{posts.filter((p) => p.enabled).length}/{posts.length} bật</span><button className="page-tab-icon-button" onClick={close}>×</button></div></div>
        {error ? <div className="page-tab-error pt-post-library-error">{error}</div> : null}
        <div className="pt-post-library-layout">
          <aside className="pt-post-list-pane">
            <div className="pt-post-list-toolbar"><button className="pt-button primary" onClick={create}>+ Bài mới</button><button className="pt-button secondary" onClick={() => setPicker(true)}>Chọn từ thư viện</button><div className="pt-post-mode-toggle">{POST_SELECTION_MODES.map((item) => <button key={item} className={mode === item ? 'active' : ''} onClick={() => { setMode(item); setDirty(true) }}>{item === 'random' ? 'Ngẫu nhiên' : 'Lần lượt'}</button>)}</div></div>
            <div className="pt-post-list">{posts.map((item, index) => <div className={item.key === selected ? 'pt-post-row active' : 'pt-post-row'} key={item.key}><input type="checkbox" checked={item.enabled} onChange={(e) => toggle(item.key, e.target.checked)}/><button className="pt-post-row-main" onClick={() => choose(item)}><strong>{index + 1}. {item.name}</strong><span>{item.postId ? `#${item.postId} · ` : 'Bài mới · '}{parsePostVariantText(item.variantText).length} biến thể</span></button>{overridden(item) ? <span className="pt-business-unsaved">Sửa riêng</span> : null}</div>)}{!posts.length ? <div className="pt-post-empty">Chưa có bài. Tạo mới hoặc chọn từ thư viện.</div> : null}</div>
            <div className="pt-post-list-actions"><button onClick={() => move(-1)} disabled={!active || posts[0]?.key === selected}>↑</button><button onClick={() => move(1)} disabled={!active || posts.at(-1)?.key === selected}>↓</button><button onClick={clone} disabled={!active}>Nhân bản thành bài mới</button><button className="danger" onClick={unlink} disabled={!active}>Gỡ khỏi Page</button></div>
          </aside>
          <div className="pt-post-editor-pane">{editor ? <>
            <section className="pt-post-editor-section"><div className="pt-post-section-title"><div><span>{editor.postId ? `Bài gốc #${editor.postId}` : 'Bài mới'}</span><strong>{editor.postId ? 'Sửa riêng cho Page này' : 'Tạo bài gốc + gắn Page'}</strong></div><label className="pt-post-enabled-switch"><input type="checkbox" checked={editor.enabled} onChange={(e) => patch({ enabled: e.target.checked })}/> Đăng bài này</label></div>
              <label className="pt-stack-field"><span>Tên bài</span><input value={editor.name} onChange={(e) => patch({ name: e.target.value })}/></label>
              <label className="pt-stack-field"><span>Các cách viết · ngăn bằng <code>|</code></span><textarea className="pt-post-variant-textarea" rows={11} value={editor.variantText} onChange={(e) => patch({ variantText: e.target.value, variants: parsePostVariantText(e.target.value) })}/></label>
              <div className="pt-post-inline-actions"><button className="pt-button secondary" onClick={() => void importText()}>Import text</button><button className="pt-button secondary" onClick={randomPreview}>Thử ngẫu nhiên</button>{editor.canonical ? <button className="pt-button secondary" onClick={reset}>Khôi phục bản gốc</button> : null}</div>{preview ? <div className="pt-post-preview">{preview}</div> : null}
            </section>
            <section className="pt-post-editor-section"><div className="pt-post-section-title"><div><span>Ảnh</span><strong>{editor.image.folderPath ? 'Có folder ảnh' : 'Không dùng ảnh'}</strong></div></div>
              <label className="pt-stack-field"><span>Folder ảnh</span><div className="pt-post-folder-row"><input value={editor.image.folderPath} onChange={(e) => imagePatch({ folderPath: e.target.value })}/><button className="pt-button secondary" onClick={() => void pickFolder()}>Chọn folder</button></div></label>
              {editor.image.folderPath ? <div className="pt-post-image-grid"><label><span>Cách lấy ảnh</span><select value={editor.image.mode} onChange={(e) => imagePatch({ mode: e.target.value as PageTabImageConfig['mode'] })}><option value="sequential">Lần lượt</option><option value="random">Ngẫu nhiên</option><option value="filename_match">Khớp Group UID</option></select></label><label><span>Số ảnh/lượt</span><input type="number" min={1} max={50} value={editor.image.imagesPerPost} onChange={(e) => imagePatch({ imagesPerPost: Number(e.target.value) })}/></label><label><span>Nếu thiếu ảnh</span><select value={editor.image.missingPolicy} onChange={(e) => imagePatch({ missingPolicy: e.target.value as PageTabImageConfig['missingPolicy'] })}><option value="text_only">Vẫn đăng text</option><option value="skip">Bỏ qua bài</option></select></label></div> : null}
              {inspection ? <p className="pt-help">{inspection.exists ? `Folder hợp lệ · ${inspection.fileCount} ảnh` : 'Không đọc được folder ảnh.'}</p> : null}
            </section>
            <div className="pt-post-editor-actions"><span>{editor.postId ? (overridden(editor) ? 'Thay đổi chỉ áp dụng cho Page này.' : 'Đang dùng nguyên bản gốc.') : 'Lưu sẽ tạo bài gốc mới.'}</span><button className="pt-button primary" onClick={applyEditor}>{creating ? 'Thêm vào danh sách' : 'Áp dụng chỉnh sửa'}</button></div>
          </> : <div className="pt-post-empty">Chọn bài, tạo bài mới hoặc chọn từ thư viện.</div>}</div>
        </div>
        <div className="page-tab-modal-actions"><span className="pt-modal-save-note">Run snapshot khi Start; sửa sau Start không đổi phiên đang chạy.</span><button className="pt-button secondary" onClick={close}>Đóng</button><button className="pt-button primary" disabled={saving || !unsaved} onClick={() => void save()}>{saving ? 'Đang lưu…' : 'Lưu thay đổi'}</button></div>
      </section>
    </div>
    {picker ? <Picker items={available} bound={bound} onPick={pickExisting} onClose={() => setPicker(false)}/> : null}
  </>
}
