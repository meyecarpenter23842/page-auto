import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CANONICAL_CONTENT_LIBRARY_SET_ID,
  CONTENT_LIBRARY_IMAGE_MODES,
  CONTENT_LIBRARY_MISSING_POLICIES,
  DEFAULT_CONTENT_LIBRARY_IMAGE,
  parseContentVariantText,
  type ContentLibraryItem,
  type ContentLibraryItemDraft,
  type ContentLibrarySetDetails,
  type ContentLibrarySetSummary
} from '../../../shared/contentLibrary'
import { CONTENT_SPIN_ICON_OPTIONS, spinContent } from '../../../shared/contentSpin'
import {
  ensureEditorVariants,
  insertTextAtSelection,
  replaceEditorVariant
} from './contentLibraryEditor'
import './contentLibrary.css'
import './contentLibraryCategories.css'

interface ItemEditorDraft {
  id: number | null
  name: string
  enabled: boolean
  variants: string[]
  image: ContentLibraryItemDraft['image']
}

interface PreviewState {
  mode: 'source' | 'spin'
  content: string
}

interface CategoryDialogState {
  mode: 'create' | 'rename'
  name: string
}

const CONTENT_SPIN_TOKEN_HINTS = [
  { token: '[u]', label: 'Tên target thật; thiếu context thì giữ nguyên' },
  { token: '[g]', label: 'Ngẫu nhiên anh/chị' },
  { token: '[f]', label: 'Tên người nhận bỏ họ; chỉ resolve khi flow có người nhận thật' },
  { token: '[n]', label: '6 số ngẫu nhiên' },
  { token: '[d]', label: 'Ngày dd/MM/yyyy' },
  { token: '[t]', label: 'Giờ HH:mm:ss' },
  { token: '[w]', label: 'Một chữ thường a-z' }
] as const

function editorFromItem(item: ContentLibraryItem): ItemEditorDraft {
  return {
    id: item.id,
    name: item.name,
    enabled: item.enabled,
    variants: ensureEditorVariants(item.variants),
    image: { ...item.image }
  }
}

function blankEditor(index: number): ItemEditorDraft {
  return {
    id: null,
    name: `Bài viết ${index + 1}`,
    enabled: true,
    variants: [''],
    image: { ...DEFAULT_CONTENT_LIBRARY_IMAGE }
  }
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

function compactVariantLabel(value: string, index: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? `#${index + 1} · ${text.slice(0, 28)}` : `#${index + 1} · Trống`
}

export function ContentLibraryWorkspace() {
  const [sets, setSets] = useState<ContentLibrarySetSummary[]>([])
  const [selectedSetId, setSelectedSetId] = useState<number | null>(null)
  const [details, setDetails] = useState<ContentLibrarySetDetails | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null)
  const [checkedItemIds, setCheckedItemIds] = useState<number[]>([])
  const [moveTarget, setMoveTarget] = useState('none')
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialogState | null>(null)
  const [editor, setEditor] = useState<ItemEditorDraft | null>(null)
  const [activeVariantIndex, setActiveVariantIndex] = useState(0)
  const [setSearch, setSetSearch] = useState('')
  const [itemSearch, setItemSearch] = useState('')
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sourceLoadSequence = useRef(0)
  const variantTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  const load = useCallback(async (preferredSetId?: number | null, preferredItemId?: number | null) => {
    const requestId = ++sourceLoadSequence.current
    try {
      const nextSets = await window.pageAuto.listContentLibraries()
      if (requestId !== sourceLoadSequence.current) return
      setSets(nextSets)
      const targetSetId = preferredSetId === undefined ? (selectedSetId ?? nextSets[0]?.id ?? null) : preferredSetId
      setSelectedSetId(targetSetId)
      if (targetSetId === null) {
        setDetails(null)
        setSelectedItemId(null)
        setEditor(null)
        setActiveVariantIndex(0)
        return
      }
      const nextDetails = await window.pageAuto.getContentLibrary({ id: targetSetId })
      if (requestId !== sourceLoadSequence.current) return
      setDetails(nextDetails)
      if (!nextDetails) {
        setSelectedItemId(null)
        setEditor(null)
        setActiveVariantIndex(0)
        return
      }
      const targetItemId = preferredItemId === undefined ? selectedItemId : preferredItemId
      const targetItem = targetItemId === null
        ? null
        : nextDetails.items.find((item) => item.id === targetItemId) ?? nextDetails.items[0] ?? null
      setSelectedItemId(targetItem?.id ?? null)
      setEditor(targetItem ? editorFromItem(targetItem) : null)
      setActiveVariantIndex(0)
      setPreview(null)
    } catch (cause) {
      if (requestId === sourceLoadSequence.current) throw cause
    }
  }, [selectedItemId, selectedSetId])

  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  const mutate = useCallback(async (
    operation: () => Promise<ContentLibrarySetDetails | boolean>,
    preferredSetId?: number | null,
    preferredItemId?: number | null
  ) => {
    setBusy(true)
    setError(null)
    try {
      const result = await operation()
      const resultSetId = preferredSetId !== undefined
        ? preferredSetId
        : typeof result === 'boolean'
          ? selectedSetId
          : result.id
      await load(resultSetId, preferredItemId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [load, selectedSetId])

  const filteredSets = useMemo(() => {
    const query = setSearch.trim().toLocaleLowerCase('vi')
    return query ? sets.filter((item) => item.name.toLocaleLowerCase('vi').includes(query)) : sets
  }, [setSearch, sets])

  const filteredItems = useMemo(() => {
    const query = itemSearch.trim().toLocaleLowerCase('vi')
    if (!details || !query) return details?.items ?? []
    return details.items.filter((item) => (
      item.name.toLocaleLowerCase('vi').includes(query)
      || item.variants.some((variant) => variant.toLocaleLowerCase('vi').includes(query))
    ))
  }, [details, itemSearch])

  const categorySets = useMemo(() => sets.filter((item) => item.id !== CANONICAL_CONTENT_LIBRARY_SET_ID), [sets])
  const activeVariant = editor?.variants[activeVariantIndex] ?? ''
  const previewMode = preview?.mode ?? 'source'
  const isAllPosts = details?.id === CANONICAL_CONTENT_LIBRARY_SET_ID
  const moveCandidateIds = checkedItemIds.length > 0
    ? checkedItemIds
    : selectedItemId === null
      ? []
      : [selectedItemId]

  const chooseSet = async (id: number) => {
    const requestId = ++sourceLoadSequence.current
    setBusy(true)
    setSelectedSetId(id)
    setSelectedItemId(null)
    setCheckedItemIds([])
    setEditor(null)
    setActiveVariantIndex(0)
    setPreview(null)
    setError(null)
    try {
      const next = await window.pageAuto.getContentLibrary({ id })
      if (requestId !== sourceLoadSequence.current) return
      setDetails(next)
      const first = next?.items[0] ?? null
      setSelectedItemId(first?.id ?? null)
      setEditor(first ? editorFromItem(first) : null)
    } catch (cause) {
      if (requestId === sourceLoadSequence.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (requestId === sourceLoadSequence.current) setBusy(false)
    }
  }

  const chooseItem = (item: ContentLibraryItem) => {
    setSelectedItemId(item.id)
    setEditor(editorFromItem(item))
    setActiveVariantIndex(0)
    setPreview(null)
    setError(null)
  }

  const toggleCheckedItem = (itemId: number, checked: boolean) => {
    setCheckedItemIds((current) => checked
      ? current.includes(itemId) ? current : [...current, itemId]
      : current.filter((id) => id !== itemId))
  }

  const openCreateCategory = () => {
    setCategoryDialog({ mode: 'create', name: `Danh mục ${categorySets.length + 1}` })
    setError(null)
  }

  const openRenameCategory = () => {
    if (!details || details.id === CANONICAL_CONTENT_LIBRARY_SET_ID) return
    setCategoryDialog({ mode: 'rename', name: details.name })
    setError(null)
  }

  const saveCategoryDialog = async () => {
    if (!categoryDialog) return
    const name = categoryDialog.name.trim()
    if (!name) {
      setError('Tên danh mục không được để trống.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      if (categoryDialog.mode === 'create') {
        const created = await window.pageAuto.createContentLibrary({ name })
        setCategoryDialog(null)
        setCheckedItemIds([])
        await load(created.id, null)
      } else if (details && details.id !== CANONICAL_CONTENT_LIBRARY_SET_ID) {
        const renamed = await window.pageAuto.renameContentLibrary({ id: details.id, name })
        setCategoryDialog(null)
        await load(renamed.id, selectedItemId)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const deleteCategory = async () => {
    if (!details || details.id === CANONICAL_CONTENT_LIBRARY_SET_ID) return
    const confirmed = window.confirm(
      `Xóa danh mục “${details.name}”? Bài viết vẫn được giữ nguyên trong “Tất cả bài viết”.`
    )
    if (!confirmed) return
    setCheckedItemIds([])
    await mutate(
      () => window.pageAuto.deleteContentLibrary({ id: details.id }),
      CANONICAL_CONTENT_LIBRARY_SET_ID,
      null
    )
  }

  const moveSelectedToCategory = async () => {
    if (!details || moveCandidateIds.length === 0) return
    const targetContentSetId = moveTarget === 'none' ? null : Number(moveTarget)
    setCheckedItemIds([])
    await mutate(
      () => window.pageAuto.moveContentLibraryItem({
        contentSetId: details.id,
        itemId: moveCandidateIds[0]!,
        direction: 'up',
        itemIds: moveCandidateIds,
        targetContentSetId
      }),
      details.id,
      null
    )
  }

  const startNewItem = () => {
    if (!details) return
    setSelectedItemId(null)
    setEditor(blankEditor(details.items.length))
    setActiveVariantIndex(0)
    setPreview(null)
    setError(null)
  }

  const editorInput = (): ContentLibraryItemDraft | null => {
    if (!editor) return null
    return {
      name: editor.name,
      enabled: editor.enabled,
      variants: editor.variants.map((variant) => variant.trim()).filter(Boolean),
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
        const previousIds = new Set(details.items.map((item) => item.id))
        const saved = await window.pageAuto.createContentLibraryItem({ contentSetId: details.id, ...draft })
        const created = saved.items.find((item) => !previousIds.has(item.id)) ?? saved.items[0] ?? null
        await load(details.id, created?.id ?? null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusy(false)
      }
      return
    }

    await mutate(
      () => window.pageAuto.updateContentLibraryItem({ id: editor.id!, contentSetId: details.id, ...draft }),
      details.id,
      editor.id
    )
  }

  const duplicateItem = async () => {
    if (!details || !selectedItemId) return
    const source = details.items.find((item) => item.id === selectedItemId)
    if (!source) return
    setBusy(true)
    setError(null)
    try {
      const previousIds = new Set(details.items.map((item) => item.id))
      const saved = await window.pageAuto.createContentLibraryItem({
        contentSetId: details.id,
        name: `${source.name} Copy`,
        enabled: source.enabled,
        variants: [...source.variants],
        image: { ...source.image }
      })
      const created = saved.items.find((item) => !previousIds.has(item.id)) ?? saved.items[0] ?? null
      await load(details.id, created?.id ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const deleteItem = async () => {
    if (!details || !selectedItemId) return
    const source = details.items.find((item) => item.id === selectedItemId)
    if (!source || !window.confirm(`Xóa vĩnh viễn “${source.name}” khỏi kho bài gốc?`)) return
    setCheckedItemIds((current) => current.filter((id) => id !== source.id))
    await mutate(() => window.pageAuto.deleteContentLibraryItem({ id: source.id }), details.id, null)
  }

  const moveItem = async (direction: 'up' | 'down') => {
    if (!details || !selectedItemId || details.id === CANONICAL_CONTENT_LIBRARY_SET_ID) return
    await mutate(
      () => window.pageAuto.moveContentLibraryItem({ contentSetId: details.id, itemId: selectedItemId, direction }),
      details.id,
      selectedItemId
    )
  }

  const pickFolder = async () => {
    const folder = await window.pageAuto.pickContentLibraryImageFolder()
    if (folder) {
      setEditor((current) => current
        ? { ...current, image: { ...current.image, folderPath: folder } }
        : current)
    }
  }

  const importText = async () => {
    const file = await window.pageAuto.pickContentLibraryTextFile()
    if (!file) return

    const imported = parseContentVariantText(file.content)
    setEditor((current) => current
      ? {
          ...current,
          variants: imported.length ? imported : [file.content]
        }
      : current)
    setActiveVariantIndex(0)
    setPreview(null)
  }

  const setActiveVariantContent = (value: string) => {
    if (!editor) return
    setEditor({
      ...editor,
      variants: replaceEditorVariant(editor.variants, activeVariantIndex, value)
    })
    setPreview(null)
  }

  const chooseVariant = (index: number) => {
    setActiveVariantIndex(index)
    setPreview(null)
    window.requestAnimationFrame(() => variantTextareaRef.current?.focus())
  }

  const addVariant = () => {
    if (!editor) return
    const nextIndex = editor.variants.length
    setEditor({ ...editor, variants: [...editor.variants, ''] })
    setActiveVariantIndex(nextIndex)
    setPreview(null)
    window.requestAnimationFrame(() => variantTextareaRef.current?.focus())
  }

  const duplicateVariant = () => {
    if (!editor) return
    const source = editor.variants[activeVariantIndex] ?? ''
    const nextIndex = activeVariantIndex + 1
    const next = [...editor.variants]
    next.splice(nextIndex, 0, source)
    setEditor({ ...editor, variants: next })
    setActiveVariantIndex(nextIndex)
    setPreview(null)
  }

  const removeVariant = () => {
    if (!editor) return
    if (editor.variants.length <= 1) {
      setEditor({ ...editor, variants: [''] })
      setActiveVariantIndex(0)
      setPreview(null)
      return
    }

    const next = editor.variants.filter((_variant, index) => index !== activeVariantIndex)
    setEditor({ ...editor, variants: next })
    setActiveVariantIndex(Math.min(activeVariantIndex, next.length - 1))
    setPreview(null)
  }

  const insertSpinSnippet = (snippet: string) => {
    if (!editor) return
    const textarea = variantTextareaRef.current
    const source = editor.variants[activeVariantIndex] ?? ''
    const inserted = insertTextAtSelection(
      source,
      snippet,
      textarea?.selectionStart ?? source.length,
      textarea?.selectionEnd ?? source.length
    )

    setEditor({
      ...editor,
      variants: replaceEditorVariant(editor.variants, activeVariantIndex, inserted.value)
    })
    setPreview(null)
    window.requestAnimationFrame(() => {
      const current = variantTextareaRef.current
      if (!current) return
      current.focus()
      current.setSelectionRange(inserted.cursor, inserted.cursor)
    })
  }

  const showSourcePreview = () => {
    setPreview({
      mode: 'source',
      content: activeVariant || 'Biến thể hiện tại chưa có nội dung.'
    })
  }

  const spinPreview = () => {
    setPreview({
      mode: 'spin',
      content: activeVariant ? spinContent(activeVariant) : 'Biến thể hiện tại chưa có nội dung để Spin thử.'
    })
  }

  const currentIndex = details?.items.findIndex((item) => item.id === selectedItemId) ?? -1

  return (
    <section className="content-library-page" aria-label="Thư viện Bài viết chung">
      {error ? (
        <div className="content-library-error">
          {error}
          <button type="button" onClick={() => setError(null)}>×</button>
        </div>
      ) : null}

      <div className="content-library-shell">
        <aside className="content-library-panel content-library-sources">
          <div className="content-library-heading">
            <div><p className="eyebrow">THƯ VIỆN</p><h2>Danh mục</h2></div>
            <span>{sets.length}</span>
          </div>
          <div className="content-library-toolbar">
            <label className="content-library-search">
              <span>⌕</span>
              <input value={setSearch} onChange={(event) => setSetSearch(event.target.value)} placeholder="Tìm..." />
            </label>
            <button className="content-library-button primary" type="button" disabled={busy} onClick={openCreateCategory}>+</button>
          </div>
          <div className="content-library-source-list">
            {filteredSets.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                className={item.id === selectedSetId ? 'content-library-source active' : 'content-library-source'}
                onClick={() => void chooseSet(item.id)}
              >
                <span className="content-library-source-icon">▤</span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.itemCount} bài</small>
                </span>
              </button>
            ))}
            {!filteredSets.length ? <div className="content-library-empty">Chưa có danh mục phù hợp.</div> : null}
          </div>
          {details && details.id !== CANONICAL_CONTENT_LIBRARY_SET_ID ? (
            <div className="content-library-source-actions">
              <button type="button" disabled={busy} onClick={openRenameCategory}>Đổi tên</button>
              <button className="danger" type="button" disabled={busy} onClick={() => void deleteCategory()}>Xóa</button>
            </div>
          ) : null}
        </aside>

        <section className="content-library-panel content-library-items">
          <div className="content-library-heading">
            <div><p className="eyebrow">BÀI VIẾT</p><h2>{details?.name ?? 'Chưa chọn danh mục'}</h2></div>
            {details ? <span>{details.itemCount}</span> : null}
          </div>
          <div className="content-library-toolbar">
            <label className="content-library-search wide">
              <span>⌕</span>
              <input value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="Tìm bài..." />
            </label>
            <button className="content-library-button primary" type="button" disabled={!details || busy} onClick={startNewItem}>+ Bài</button>
          </div>
          <div className="content-library-table-wrap">
            <table className="content-library-table content-library-category-table">
              <thead>
                <tr><th aria-label="Chọn"></th><th>STT</th><th>Tên bài</th><th>Loại</th><th>Biến thể</th><th>Trạng thái</th></tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr
                    key={item.id}
                    className={item.id === selectedItemId ? 'active' : ''}
                    onClick={() => chooseItem(item)}
                  >
                    <td className="content-library-check-cell" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Chọn ${item.name}`}
                        checked={checkedItemIds.includes(item.id)}
                        onChange={(event) => toggleCheckedItem(item.id, event.target.checked)}
                      />
                    </td>
                    <td>{item.sortOrder + 1}</td>
                    <td><strong>{item.name}</strong><small>{item.variants[0]?.replace(/\s+/g, ' ').slice(0, 55) || 'Không có chữ'}</small></td>
                    <td><span className="content-library-type">{itemType(item)}</span></td>
                    <td>{item.variants.length}</td>
                    <td><span className={item.enabled ? 'content-library-enabled' : 'content-library-disabled'}>{item.enabled ? 'Bật' : 'Tắt'}</span></td>
                  </tr>
                ))}
                {details && !filteredItems.length ? (
                  <tr><td colSpan={6}><div className="content-library-empty">Chưa có bài viết phù hợp.</div></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="content-library-row-actions content-library-category-actions">
            <div className="content-library-category-move">
              <span>{moveCandidateIds.length > 0 ? `${moveCandidateIds.length} bài` : 'Chọn bài'}</span>
              <select
                aria-label="Danh mục đích"
                value={moveTarget}
                disabled={busy || moveCandidateIds.length === 0}
                onChange={(event) => setMoveTarget(event.target.value)}
              >
                <option value="none">Không danh mục</option>
                {categorySets.map((category) => (
                  <option key={category.id} value={String(category.id)}>{category.name}</option>
                ))}
              </select>
              <button type="button" disabled={busy || moveCandidateIds.length === 0} onClick={() => void moveSelectedToCategory()}>
                Chuyển
              </button>
            </div>
            <button type="button" disabled={busy || isAllPosts || currentIndex <= 0} onClick={() => void moveItem('up')}>↑</button>
            <button type="button" disabled={busy || isAllPosts || currentIndex < 0 || !details || currentIndex >= details.items.length - 1} onClick={() => void moveItem('down')}>↓</button>
            <button type="button" disabled={busy || !selectedItemId} onClick={() => void duplicateItem()}>Nhân bản</button>
            <button className="danger" type="button" disabled={busy || !selectedItemId} onClick={() => void deleteItem()}>Xóa</button>
          </div>
        </section>

        <section className="content-library-panel content-library-editor">
          <div className="content-library-heading content-library-editor-heading">
            <div><p className="eyebrow">BIÊN TẬP BÀI</p><h2>{editor?.id === null ? 'Bài mới' : editor?.name ?? 'Chọn bài'}</h2></div>
            {editor ? <span>{editor.variants.length} biến thể</span> : null}
          </div>

          {editor && details ? (
            <div className="content-library-editor-body">
              <div className="content-library-editor-topline">
                <label className="content-library-toggle">
                  <input
                    type="checkbox"
                    checked={editor.enabled}
                    onChange={(event) => setEditor({ ...editor, enabled: event.target.checked })}
                  />
                  <span>Dùng bài này</span>
                </label>
                <label className="content-library-field content-library-name-field">
                  <span>Tên bài</span>
                  <input
                    value={editor.name}
                    onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                    placeholder="Ví dụ: Mỹ phẩm 01"
                  />
                </label>
              </div>

              <div className="content-library-editor-layout">
                <div className="content-library-compose">
                  <div className="content-library-variant-bar">
                    <div className="content-library-variant-bar-title">
                      <strong>Biến thể thư viện</strong>
                      <small>Mỗi tab là một biến thể riêng. Dấu | bên trong bài chỉ dành cho Runtime Spin.</small>
                    </div>
                    <div className="content-library-variant-strip" role="tablist" aria-label="Biến thể bài viết">
                      {editor.variants.map((variant, index) => (
                        <button
                          key={index}
                          type="button"
                          role="tab"
                          aria-selected={index === activeVariantIndex}
                          className={index === activeVariantIndex ? 'content-library-variant-tab active' : 'content-library-variant-tab'}
                          title={compactVariantLabel(variant, index)}
                          onClick={() => chooseVariant(index)}
                        >
                          #{index + 1}
                        </button>
                      ))}
                      <button className="content-library-variant-add" type="button" title="Thêm biến thể" onClick={addVariant}>+</button>
                    </div>
                    <div className="content-library-variant-actions">
                      <button type="button" onClick={duplicateVariant}>Nhân bản biến thể</button>
                      <button type="button" onClick={removeVariant}>Xóa biến thể</button>
                      <button type="button" onClick={() => void importText()}>Import TXT</button>
                    </div>
                  </div>

                  <label className="content-library-field content-library-content-field">
                    <span>Nội dung biến thể #{activeVariantIndex + 1}</span>
                    <textarea
                      ref={variantTextareaRef}
                      value={activeVariant}
                      onChange={(event) => setActiveVariantContent(event.target.value)}
                      placeholder={'Nhập nội dung bài...\n\nVí dụ Spin: {Giá tốt|Hàng mới|Ưu đãi hôm nay}'}
                    />
                  </label>

                  <div className="content-library-spinbar">
                    <div className="content-library-spinbar-label">
                      <strong>Spin</strong>
                      <span>chèn tại con trỏ</span>
                    </div>
                    <div className="content-library-spin-quick">
                      {CONTENT_SPIN_TOKEN_HINTS.map((item) => (
                        <button
                          key={item.token}
                          type="button"
                          title={item.label}
                          onClick={() => insertSpinSnippet(item.token)}
                        >
                          {item.token}
                        </button>
                      ))}
                    </div>
                    <select
                      aria-label="Chèn icon Spin"
                      value=""
                      onChange={(event) => {
                        const token = event.target.value
                        if (token) insertSpinSnippet(token)
                      }}
                    >
                      <option value="">Icon Spin…</option>
                      {CONTENT_SPIN_ICON_OPTIONS.map((item) => (
                        <option key={item.token} value={item.token}>{item.label}</option>
                      ))}
                    </select>
                    <button className="content-library-spin-skeleton" type="button" onClick={() => insertSpinSnippet('{A|B|C}')}>
                      + {'{A|B|C}'}
                    </button>
                    <div className="content-library-preview-actions content-library-preview-launchers">
                      <button type="button" onClick={showSourcePreview}>Xem gốc</button>
                      <button className="primary" type="button" onClick={spinPreview}>Spin thử</button>
                    </div>
                  </div>

                  <p className="content-library-spin-note">
                    <code>A|B|C</code> random cả nhánh; <code>{'{A|B|C}'}</code> random đúng cấp hiện tại rồi tiếp tục xử lý nhóm lồng bên trong.
                    Token cần tên thật như <code>[u]</code>/<code>[f]</code> sẽ giữ nguyên nếu flow không có context.
                  </p>
                </div>

                <aside className="content-library-settings">
                  <section className="content-library-settings-card">
                    <div className="content-library-settings-title">
                      <strong>Ảnh</strong>
                      <small>Thiết lập media cho bài này</small>
                    </div>
                    <label className="content-library-field">
                      <span>Folder ảnh</span>
                      <div className="content-library-folder">
                        <input
                          value={editor.image.folderPath}
                          onChange={(event) => setEditor({ ...editor, image: { ...editor.image, folderPath: event.target.value } })}
                          placeholder="Không bắt buộc"
                        />
                        <button type="button" onClick={() => void pickFolder()}>Chọn</button>
                      </div>
                    </label>
                    <label className="content-library-field">
                      <span>Cách lấy ảnh</span>
                      <select
                        value={editor.image.mode}
                        onChange={(event) => setEditor({
                          ...editor,
                          image: { ...editor.image, mode: event.target.value as ContentLibraryItemDraft['image']['mode'] }
                        })}
                      >
                        {CONTENT_LIBRARY_IMAGE_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode === 'random' ? 'Ngẫu nhiên' : mode === 'filename_match' ? 'Khớp tên file' : 'Lần lượt'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="content-library-field">
                      <span>Số ảnh/bài</span>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={editor.image.imagesPerPost}
                        onChange={(event) => setEditor({
                          ...editor,
                          image: { ...editor.image, imagesPerPost: Number(event.target.value) }
                        })}
                      />
                    </label>
                    <label className="content-library-field">
                      <span>Khi thiếu ảnh</span>
                      <select
                        value={editor.image.missingPolicy}
                        onChange={(event) => setEditor({
                          ...editor,
                          image: {
                            ...editor.image,
                            missingPolicy: event.target.value as ContentLibraryItemDraft['image']['missingPolicy']
                          }
                        })}
                      >
                        {CONTENT_LIBRARY_MISSING_POLICIES.map((policy) => (
                          <option key={policy} value={policy}>{policy === 'skip' ? 'Bỏ qua bài' : 'Đăng chữ'}</option>
                        ))}
                      </select>
                    </label>
                  </section>

                  <section className="content-library-settings-card content-library-save-card">
                    <div className="content-library-meta">
                      <span>Cập nhật thư viện</span>
                      <strong>{formatUpdated(details.updatedAt)}</strong>
                    </div>
                    <p>Canonical chỉ lưu cú pháp Spin. Kết quả random không ghi ngược vào bài gốc.</p>
                    <button className="content-library-save" type="button" disabled={busy} onClick={() => void saveItem()}>
                      {busy ? 'Đang lưu...' : editor.id === null ? 'Thêm vào thư viện' : 'Lưu bài viết'}
                    </button>
                  </section>
                </aside>
              </div>
            </div>
          ) : (
            <div className="content-library-empty editor-empty">Chọn một danh mục rồi tạo hoặc chọn bài viết.</div>
          )}
        </section>
      </div>

      {preview ? (
        <div className="content-library-preview-modal-backdrop" role="presentation" onMouseDown={() => setPreview(null)}>
          <section
            className="content-library-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={previewMode === 'spin' ? 'Spin thử bài viết' : 'Xem bài gốc'}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="content-library-preview-modal-head">
              <div>
                <p className="eyebrow">XEM TRƯỚC BÀI</p>
                <h3>{previewMode === 'spin' ? 'Spin thử' : 'Bản gốc'}</h3>
              </div>
              <button type="button" aria-label="Đóng xem trước" onClick={() => setPreview(null)}>×</button>
            </div>
            <div className="content-library-preview-modal-body">
              {preview.content}
            </div>
            <div className="content-library-preview-modal-actions">
              <button type="button" onClick={showSourcePreview}>Xem gốc</button>
              <button className="primary" type="button" onClick={spinPreview}>Spin thử</button>
              <button type="button" onClick={() => setPreview(null)}>Đóng</button>
            </div>
          </section>
        </div>
      ) : null}

      {categoryDialog ? (
        <div className="content-library-category-dialog-backdrop" role="presentation" onMouseDown={() => !busy && setCategoryDialog(null)}>
          <form
            className="content-library-category-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={categoryDialog.mode === 'create' ? 'Tạo danh mục' : 'Đổi tên danh mục'}
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              void saveCategoryDialog()
            }}
          >
            <div>
              <p className="eyebrow">DANH MỤC BÀI VIẾT</p>
              <h3>{categoryDialog.mode === 'create' ? 'Tạo danh mục' : 'Đổi tên danh mục'}</h3>
            </div>
            <label className="content-library-field">
              <span>Tên danh mục</span>
              <input
                autoFocus
                value={categoryDialog.name}
                maxLength={120}
                onChange={(event) => setCategoryDialog({ ...categoryDialog, name: event.target.value })}
              />
            </label>
            <p>Danh mục chỉ để gom bài; bài gốc vẫn nằm trong “Tất cả bài viết”.</p>
            <div className="content-library-category-dialog-actions">
              <button type="button" disabled={busy} onClick={() => setCategoryDialog(null)}>Hủy</button>
              <button className="primary" type="submit" disabled={busy || !categoryDialog.name.trim()}>
                {busy ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <p className="content-library-footnote">
        Thư viện là một kho canonical dùng chung toàn app; Danh mục chỉ là cách gom bài. Runtime Spin chỉ tạo nội dung cho từng lượt đăng thực tế.
      </p>
    </section>
  )
}
