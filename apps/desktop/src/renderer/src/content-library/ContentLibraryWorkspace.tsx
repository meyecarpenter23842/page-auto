import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CONTENT_LIBRARY_IMAGE_MODES,
  CONTENT_LIBRARY_MISSING_POLICIES,
  DEFAULT_CONTENT_LIBRARY_IMAGE,
  formatContentVariantText,
  parseContentVariantText,
  type ContentLibraryItem,
  type ContentLibraryItemDraft,
  type ContentLibrarySetDetails,
  type ContentLibrarySetSummary
} from '../../../shared/contentLibrary'
import './contentLibrary.css'

interface ItemEditorDraft {
  id: number | null
  name: string
  enabled: boolean
  variantText: string
  image: ContentLibraryItemDraft['image']
}

function editorFromItem(item: ContentLibraryItem): ItemEditorDraft {
  return { id: item.id, name: item.name, enabled: item.enabled, variantText: formatContentVariantText(item.variants), image: { ...item.image } }
}

function blankEditor(index: number): ItemEditorDraft {
  return { id: null, name: `Bài viết ${index + 1}`, enabled: true, variantText: '', image: { ...DEFAULT_CONTENT_LIBRARY_IMAGE } }
}

function itemType(item: ContentLibraryItem): string {
  const text = item.variants.length > 0
  const image = Boolean(item.image.folderPath.trim())
  if (text && image) return 'Chữ + ảnh'
  if (image) return 'Ảnh'
  return 'Chữ'
}

function formatUpdated(value: number): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value)
}

export function ContentLibraryWorkspace() {
  const [sets, setSets] = useState<ContentLibrarySetSummary[]>([])
  const [selectedSetId, setSelectedSetId] = useState<number | null>(null)
  const [details, setDetails] = useState<ContentLibrarySetDetails | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null)
  const [editor, setEditor] = useState<ItemEditorDraft | null>(null)
  const [setSearch, setSetSearch] = useState('')
  const [itemSearch, setItemSearch] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (preferredSetId?: number | null, preferredItemId?: number | null) => {
    const nextSets = await window.pageAuto.listContentLibraries()
    setSets(nextSets)
    const targetSetId = preferredSetId === undefined ? (selectedSetId ?? nextSets[0]?.id ?? null) : preferredSetId
    setSelectedSetId(targetSetId)
    if (targetSetId === null) {
      setDetails(null)
      setSelectedItemId(null)
      setEditor(null)
      return
    }
    const nextDetails = await window.pageAuto.getContentLibrary({ id: targetSetId })
    setDetails(nextDetails)
    if (!nextDetails) {
      setSelectedItemId(null)
      setEditor(null)
      return
    }
    const targetItemId = preferredItemId === undefined ? selectedItemId : preferredItemId
    const targetItem = targetItemId === null
      ? null
      : nextDetails.items.find((item) => item.id === targetItemId) ?? nextDetails.items[0] ?? null
    setSelectedItemId(targetItem?.id ?? null)
    setEditor(targetItem ? editorFromItem(targetItem) : null)
  }, [selectedItemId, selectedSetId])

  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  const mutate = useCallback(async (operation: () => Promise<ContentLibrarySetDetails | boolean>, preferredSetId?: number | null, preferredItemId?: number | null) => {
    setBusy(true)
    setError(null)
    try {
      const result = await operation()
      const resultSetId = typeof result === 'boolean' ? preferredSetId : result.id
      await load(resultSetId, preferredItemId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [load])

  const filteredSets = useMemo(() => {
    const query = setSearch.trim().toLocaleLowerCase('vi')
    return query ? sets.filter((item) => item.name.toLocaleLowerCase('vi').includes(query)) : sets
  }, [setSearch, sets])

  const filteredItems = useMemo(() => {
    const query = itemSearch.trim().toLocaleLowerCase('vi')
    if (!details || !query) return details?.items ?? []
    return details.items.filter((item) => item.name.toLocaleLowerCase('vi').includes(query) || item.variants.some((variant) => variant.toLocaleLowerCase('vi').includes(query)))
  }, [details, itemSearch])

  const chooseSet = async (id: number) => {
    setSelectedSetId(id)
    setSelectedItemId(null)
    setEditor(null)
    setPreview(null)
    setError(null)
    try {
      const next = await window.pageAuto.getContentLibrary({ id })
      setDetails(next)
      const first = next?.items[0] ?? null
      setSelectedItemId(first?.id ?? null)
      setEditor(first ? editorFromItem(first) : null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const chooseItem = (item: ContentLibraryItem) => {
    setSelectedItemId(item.id)
    setEditor(editorFromItem(item))
    setPreview(null)
    setError(null)
  }

  const createSet = async () => {
    const name = window.prompt('Tên nguồn bài viết mới:', `Nguồn bài viết ${sets.length + 1}`)?.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      const created = await window.pageAuto.createContentLibrary({ name })
      await load(created.id, null)
      setEditor(blankEditor(0))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const renameSet = async () => {
    if (!details) return
    const name = window.prompt('Đổi tên nguồn bài viết:', details.name)?.trim()
    if (!name || name === details.name) return
    await mutate(() => window.pageAuto.renameContentLibrary({ id: details.id, name }), details.id, selectedItemId)
  }

  const deleteSet = async () => {
    if (!details || !window.confirm(`Xóa nguồn “${details.name}” và toàn bộ bài viết bên trong?`)) return
    const fallback = sets.find((item) => item.id !== details.id)?.id ?? null
    await mutate(() => window.pageAuto.deleteContentLibrary({ id: details.id }), fallback, null)
  }

  const startNewItem = () => {
    if (!details) return
    setSelectedItemId(null)
    setEditor(blankEditor(details.items.length))
    setPreview(null)
    setError(null)
  }

  const editorInput = (): ContentLibraryItemDraft | null => {
    if (!editor) return null
    return {
      name: editor.name,
      enabled: editor.enabled,
      variants: parseContentVariantText(editor.variantText),
      image: { ...editor.image, folderPath: editor.image.folderPath.trim() }
    }
  }

  const saveItem = async () => {
    if (!details || !editor) return
    const draft = editorInput()
    if (!draft) return
    if (editor.id === null) {
      setBusy(true)
      setError(null)
      try {
        const saved = await window.pageAuto.createContentLibraryItem({ contentSetId: details.id, ...draft })
        const created = saved.items.at(-1) ?? null
        await load(saved.id, created?.id ?? null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusy(false)
      }
      return
    }
    await mutate(() => window.pageAuto.updateContentLibraryItem({ id: editor.id!, ...draft }), details.id, editor.id)
  }

  const duplicateItem = async () => {
    if (!details || !selectedItemId) return
    const source = details.items.find((item) => item.id === selectedItemId)
    if (!source) return
    setBusy(true)
    setError(null)
    try {
      const saved = await window.pageAuto.createContentLibraryItem({
        contentSetId: details.id,
        name: `${source.name} Copy`,
        enabled: source.enabled,
        variants: [...source.variants],
        image: { ...source.image }
      })
      const created = saved.items.at(-1) ?? null
      await load(saved.id, created?.id ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const deleteItem = async () => {
    if (!details || !selectedItemId) return
    const source = details.items.find((item) => item.id === selectedItemId)
    if (!source || !window.confirm(`Xóa “${source.name}”?`)) return
    await mutate(() => window.pageAuto.deleteContentLibraryItem({ id: source.id }), details.id, null)
  }

  const moveItem = async (direction: 'up' | 'down') => {
    if (!details || !selectedItemId) return
    await mutate(() => window.pageAuto.moveContentLibraryItem({ contentSetId: details.id, itemId: selectedItemId, direction }), details.id, selectedItemId)
  }

  const pickFolder = async () => {
    const folder = await window.pageAuto.pickContentLibraryImageFolder()
    if (folder) setEditor((current) => current ? { ...current, image: { ...current.image, folderPath: folder } } : current)
  }

  const importText = async () => {
    const file = await window.pageAuto.pickContentLibraryTextFile()
    if (file) setEditor((current) => current ? { ...current, variantText: file.content } : current)
  }

  const randomPreview = () => {
    const variants = parseContentVariantText(editor?.variantText ?? '')
    setPreview(variants.length ? (variants[Math.floor(Math.random() * variants.length)] ?? variants[0] ?? '') : 'Chưa có nội dung để xem thử.')
  }

  const currentIndex = details?.items.findIndex((item) => item.id === selectedItemId) ?? -1

  return (
    <section className="content-library-page" aria-label="Thư viện Bài viết chung">
      {error ? <div className="content-library-error">{error}<button type="button" onClick={() => setError(null)}>×</button></div> : null}
      <div className="content-library-shell">
        <aside className="content-library-panel content-library-sources">
          <div className="content-library-heading"><div><p className="eyebrow">NGUỒN CHUNG</p><h2>Thư viện</h2></div><span>{sets.length}</span></div>
          <div className="content-library-toolbar"><label className="content-library-search"><span>⌕</span><input value={setSearch} onChange={(event) => setSetSearch(event.target.value)} placeholder="Tìm nguồn..." /></label><button className="content-library-button primary" type="button" disabled={busy} onClick={() => void createSet()}>+ Nguồn</button></div>
          <div className="content-library-source-list">
            {filteredSets.map((item) => <button key={item.id} type="button" className={item.id === selectedSetId ? 'content-library-source active' : 'content-library-source'} onClick={() => void chooseSet(item.id)}><span className="content-library-source-icon">▤</span><span><strong>{item.name}</strong><small>{item.enabledCount}/{item.itemCount} bài bật</small></span></button>)}
            {!filteredSets.length ? <div className="content-library-empty">Chưa có nguồn bài viết.</div> : null}
          </div>
          {details ? <div className="content-library-source-actions"><button type="button" disabled={busy} onClick={() => void renameSet()}>Đổi tên</button><button className="danger" type="button" disabled={busy} onClick={() => void deleteSet()}>Xóa nguồn</button></div> : null}
        </aside>

        <section className="content-library-panel content-library-items">
          <div className="content-library-heading"><div><p className="eyebrow">BÀI VIẾT</p><h2>{details?.name ?? 'Chưa chọn nguồn'}</h2></div>{details ? <span>{details.itemCount} bài</span> : null}</div>
          <div className="content-library-toolbar"><label className="content-library-search wide"><span>⌕</span><input value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="Tìm tên hoặc nội dung..." /></label><button className="content-library-button primary" type="button" disabled={!details || busy} onClick={startNewItem}>+ Bài</button></div>
          <div className="content-library-table-wrap"><table className="content-library-table"><thead><tr><th>STT</th><th>Tên bài</th><th>Loại</th><th>Nội dung</th><th>Ảnh</th><th>Trạng thái</th></tr></thead><tbody>
            {filteredItems.map((item) => <tr key={item.id} className={item.id === selectedItemId ? 'active' : ''} onClick={() => chooseItem(item)}><td>{item.sortOrder + 1}</td><td><strong>{item.name}</strong></td><td><span className="content-library-type">{itemType(item)}</span></td><td>{item.variants.length} biến thể</td><td>{item.image.folderPath ? `${item.image.imagesPerPost}/lượt` : '—'}</td><td><span className={item.enabled ? 'content-library-enabled' : 'content-library-disabled'}>{item.enabled ? 'Bật' : 'Tắt'}</span></td></tr>)}
            {details && !filteredItems.length ? <tr><td colSpan={6}><div className="content-library-empty">Nguồn này chưa có bài viết phù hợp.</div></td></tr> : null}
          </tbody></table></div>
          <div className="content-library-row-actions"><button type="button" disabled={busy || currentIndex <= 0} onClick={() => void moveItem('up')}>↑ Lên</button><button type="button" disabled={busy || currentIndex < 0 || !details || currentIndex >= details.items.length - 1} onClick={() => void moveItem('down')}>↓ Xuống</button><button type="button" disabled={busy || !selectedItemId} onClick={() => void duplicateItem()}>Nhân bản</button><button className="danger" type="button" disabled={busy || !selectedItemId} onClick={() => void deleteItem()}>Xóa</button></div>
        </section>

        <aside className="content-library-panel content-library-editor">
          <div className="content-library-heading"><div><p className="eyebrow">BIÊN TẬP</p><h2>{editor?.id === null ? 'Bài mới' : editor?.name ?? 'Chọn bài'}</h2></div></div>
          {editor && details ? <div className="content-library-editor-body">
            <label className="content-library-toggle"><input type="checkbox" checked={editor.enabled} onChange={(event) => setEditor({ ...editor, enabled: event.target.checked })} /><span>Dùng bài này</span></label>
            <label className="content-library-field"><span>Tên bài</span><input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} placeholder="Ví dụ: Mỹ phẩm 01" /></label>
            <label className="content-library-field"><span>Nội dung · phân cách biến thể bằng |</span><textarea rows={9} value={editor.variantText} onChange={(event) => { setEditor({ ...editor, variantText: event.target.value }); setPreview(null) }} placeholder={'Nội dung A\n|\nNội dung B'} /></label>
            <div className="content-library-inline-actions"><button type="button" onClick={() => void importText()}>Import TXT</button><button type="button" onClick={randomPreview}>Xem thử</button></div>
            {preview !== null ? <div className="content-library-preview">{preview}</div> : null}
            <div className="content-library-divider"><span>Ảnh</span></div>
            <label className="content-library-field"><span>Folder ảnh</span><div className="content-library-folder"><input value={editor.image.folderPath} onChange={(event) => setEditor({ ...editor, image: { ...editor.image, folderPath: event.target.value } })} placeholder="Không bắt buộc" /><button type="button" onClick={() => void pickFolder()}>Chọn</button></div></label>
            <div className="content-library-grid-2"><label className="content-library-field"><span>Cách lấy ảnh</span><select value={editor.image.mode} onChange={(event) => setEditor({ ...editor, image: { ...editor.image, mode: event.target.value as ContentLibraryItemDraft['image']['mode'] } })}>{CONTENT_LIBRARY_IMAGE_MODES.map((mode) => <option key={mode} value={mode}>{mode === 'random' ? 'Ngẫu nhiên' : 'Lần lượt'}</option>)}</select></label><label className="content-library-field"><span>Số ảnh/bài</span><input type="number" min={1} max={50} value={editor.image.imagesPerPost} onChange={(event) => setEditor({ ...editor, image: { ...editor.image, imagesPerPost: Number(event.target.value) } })} /></label></div>
            <label className="content-library-field"><span>Khi thiếu ảnh</span><select value={editor.image.missingPolicy} onChange={(event) => setEditor({ ...editor, image: { ...editor.image, missingPolicy: event.target.value as ContentLibraryItemDraft['image']['missingPolicy'] } })}>{CONTENT_LIBRARY_MISSING_POLICIES.map((policy) => <option key={policy} value={policy}>{policy === 'skip' ? 'Bỏ qua bài' : 'Đăng chữ'}</option>)}</select></label>
            <div className="content-library-meta"><span>Cập nhật nguồn</span><strong>{formatUpdated(details.updatedAt)}</strong></div>
            <button className="content-library-save" type="button" disabled={busy} onClick={() => void saveItem()}>{busy ? 'Đang lưu...' : editor.id === null ? 'Thêm vào thư viện' : 'Lưu bài viết'}</button>
          </div> : <div className="content-library-empty editor-empty">Chọn một nguồn rồi tạo hoặc chọn bài viết.</div>}
        </aside>
      </div>
      <p className="content-library-footnote">Nguồn ở đây là dữ liệu dùng chung toàn app. K4.5.1 chưa đổi runtime Page/Kịch Bản; consumer sẽ tham chiếu nguồn và snapshot nội dung ở lô tiếp theo.</p>
    </section>
  )
}
