import { useEffect, useMemo, useState } from 'react'
import {
  CANONICAL_CONTENT_LIBRARY_SET_ID,
  type ContentLibraryItem,
  type ContentLibrarySetDetails,
  type ContentLibrarySetSummary
} from '../../../shared/contentLibrary'
import './canonicalPostPicker.css'

export type CanonicalPostPickerMode = 'single' | 'multiple'

export interface CanonicalPostPickerValue {
  postId: number
  sourceSetId: number
  sourceSetName: string
  item: ContentLibraryItem
}

interface CanonicalPostPickerProps {
  mode?: CanonicalPostPickerMode
  title?: string
  initialSelection?: readonly CanonicalPostPickerValue[]
  disabledPostIds?: readonly number[]
  getDisabledReason?: (item: ContentLibraryItem) => string | null
  onApply: (values: CanonicalPostPickerValue[]) => void
  onClose: () => void
}

function canonicalPostId(item: ContentLibraryItem): number | null {
  if (!Number.isSafeInteger(item.id) || item.id >= 0) return null
  return Math.abs(item.id)
}

function cloneItem(item: ContentLibraryItem): ContentLibraryItem {
  return {
    ...item,
    variants: [...item.variants],
    image: { ...item.image }
  }
}

function postPreview(item: ContentLibraryItem): string {
  const value = item.variants.find((variant) => variant.trim())?.replace(/\s+/g, ' ').trim()
  if (!value) return item.image.folderPath.trim() ? 'Bài chỉ có ảnh.' : 'Bài chưa có nội dung.'
  return value.length > 190 ? `${value.slice(0, 190)}…` : value
}

function imageModeLabel(item: ContentLibraryItem): string {
  if (!item.image.folderPath.trim()) return 'Không ảnh'
  const mode = item.image.mode === 'random'
    ? 'ảnh ngẫu nhiên'
    : item.image.mode === 'filename_match'
      ? 'khớp tên'
      : 'ảnh lần lượt'
  return `${item.image.imagesPerPost} ảnh/lượt · ${mode}`
}

function sortSets(items: readonly ContentLibrarySetSummary[]): ContentLibrarySetSummary[] {
  return [...items].sort((left, right) => {
    if (left.id === CANONICAL_CONTENT_LIBRARY_SET_ID) return -1
    if (right.id === CANONICAL_CONTENT_LIBRARY_SET_ID) return 1
    return left.name.localeCompare(right.name, 'vi')
  })
}

export function CanonicalPostPicker({
  mode = 'single',
  title = 'Chọn bài từ Thư viện',
  initialSelection = [],
  disabledPostIds = [],
  getDisabledReason,
  onApply,
  onClose
}: CanonicalPostPickerProps) {
  const [sets, setSets] = useState<ContentLibrarySetSummary[]>([])
  const [activeSetId, setActiveSetId] = useState<number | null>(null)
  const [details, setDetails] = useState<ContentLibrarySetDetails | null>(null)
  const [query, setQuery] = useState('')
  const [listLoading, setListLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Map<number, CanonicalPostPickerValue>>(
    () => new Map(initialSelection.map((value) => [value.postId, {
      ...value,
      item: cloneItem(value.item)
    }]))
  )

  const disabled = useMemo(() => new Set(disabledPostIds), [disabledPostIds])
  const activeSummary = useMemo(
    () => sets.find((item) => item.id === activeSetId) ?? null,
    [activeSetId, sets]
  )
  const selectedPostIds = useMemo(() => new Set(selected.keys()), [selected])

  useEffect(() => {
    let cancelled = false
    setListLoading(true)
    setError('')
    void window.pageAuto.listContentLibraries()
      .then((items) => {
        if (cancelled) return
        const ordered = sortSets(items)
        setSets(ordered)
        setActiveSetId(
          ordered.find((item) => item.id === CANONICAL_CONTENT_LIBRARY_SET_ID)?.id
          ?? ordered[0]?.id
          ?? null
        )
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setSets([])
        setActiveSetId(null)
        setError(cause instanceof Error ? cause.message : 'Không thể tải Thư viện Bài viết.')
      })
      .finally(() => {
        if (!cancelled) setListLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (activeSetId === null) {
      setDetails(null)
      setDetailLoading(false)
      return () => {
        cancelled = true
      }
    }

    setDetailLoading(true)
    setError('')
    void window.pageAuto.getContentLibrary({ id: activeSetId })
      .then((value) => {
        if (!cancelled) setDetails(value)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setDetails(null)
        setError(cause instanceof Error ? cause.message : 'Không thể tải thư mục bài viết.')
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeSetId])

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('vi')
    const items = [...(details?.items ?? [])].sort((left, right) => left.sortOrder - right.sortOrder)
    if (!normalized) return items
    return items.filter((item) => (
      item.name.toLocaleLowerCase('vi').includes(normalized)
      || item.variants.some((variant) => variant.toLocaleLowerCase('vi').includes(normalized))
    ))
  }, [details, query])

  const toggleItem = (item: ContentLibraryItem) => {
    const postId = canonicalPostId(item)
    if (!postId || disabled.has(postId)) return

    const value: CanonicalPostPickerValue = {
      postId,
      sourceSetId: details?.id ?? CANONICAL_CONTENT_LIBRARY_SET_ID,
      sourceSetName: details?.name ?? activeSummary?.name ?? 'Thư viện Bài viết',
      item: cloneItem(item)
    }

    setSelected((current) => {
      const next = new Map(current)
      if (mode === 'single') {
        next.clear()
        next.set(postId, value)
        return next
      }
      if (next.has(postId)) next.delete(postId)
      else next.set(postId, value)
      return next
    })
  }

  const apply = () => {
    if (!selected.size) return
    onApply([...selected.values()].map((value) => ({
      ...value,
      item: cloneItem(value.item)
    })))
  }

  return (
    <div className="canonical-post-picker-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="canonical-post-picker"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="canonical-post-picker-head">
          <div>
            <small>THƯ VIỆN BÀI VIẾT CHUNG</small>
            <h2>{title}</h2>
          </div>
          <button type="button" aria-label="Đóng" onClick={onClose}>×</button>
        </header>

        {error ? <div className="canonical-post-picker-error">{error}</div> : null}

        <div className="canonical-post-picker-layout">
          <aside className="canonical-post-picker-folders">
            <div className="canonical-post-picker-pane-title">
              <span>THƯ MỤC</span>
              <b>{sets.length}</b>
            </div>
            <div className="canonical-post-picker-folder-list">
              {sets.map((set) => (
                <button
                  type="button"
                  key={set.id}
                  className={set.id === activeSetId ? 'active' : ''}
                  onClick={() => {
                    setActiveSetId(set.id)
                    setQuery('')
                  }}
                >
                  <span className="canonical-post-picker-folder-icon">
                    {set.id === CANONICAL_CONTENT_LIBRARY_SET_ID ? '▦' : '▸'}
                  </span>
                  <span>
                    <strong>{set.name}</strong>
                    <small>{set.itemCount} bài</small>
                  </span>
                </button>
              ))}
              {!listLoading && !sets.length ? (
                <div className="canonical-post-picker-empty">Chưa có thư mục bài viết.</div>
              ) : null}
              {listLoading ? <div className="canonical-post-picker-empty">Đang tải thư mục…</div> : null}
            </div>
          </aside>

          <main className="canonical-post-picker-posts">
            <div className="canonical-post-picker-toolbar">
              <div>
                <strong>{activeSummary?.name ?? details?.name ?? 'Bài viết'}</strong>
                <span>{details?.itemCount ?? 0} bài · đã chọn {selected.size}</span>
              </div>
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm tên hoặc nội dung trong thư mục…"
              />
            </div>

            <div className="canonical-post-picker-list">
              {detailLoading ? <div className="canonical-post-picker-empty">Đang tải bài viết…</div> : null}
              {!detailLoading && visibleItems.map((item) => {
                const postId = canonicalPostId(item)
                const disabledReason = postId === null
                  ? 'Post không hợp lệ'
                  : disabled.has(postId)
                    ? 'Đang dùng'
                    : getDisabledReason?.(item) ?? null
                const isDisabled = Boolean(disabledReason)
                const isSelected = postId !== null && selectedPostIds.has(postId)
                return (
                  <article
                    key={item.id}
                    className={[
                      'canonical-post-picker-row',
                      isSelected ? 'selected' : '',
                      isDisabled ? 'disabled' : ''
                    ].filter(Boolean).join(' ')}
                  >
                    <input
                      type={mode === 'single' ? 'radio' : 'checkbox'}
                      name={mode === 'single' ? 'canonical-post-picker-selection' : undefined}
                      aria-label={`Chọn ${item.name}`}
                      checked={isSelected}
                      disabled={isDisabled}
                      onChange={() => toggleItem(item)}
                    />
                    <button type="button" disabled={isDisabled} onClick={() => toggleItem(item)}>
                      <span className="canonical-post-picker-row-title">
                        <strong>{item.name}</strong>
                        {postId ? <small>Post #{postId}</small> : null}
                      </span>
                      <p>{postPreview(item)}</p>
                      <span className="canonical-post-picker-meta">
                        <small>{item.variants.length || 1} biến thể</small>
                        <small>{imageModeLabel(item)}</small>
                        {!item.enabled ? <small>Tắt trong thư mục</small> : null}
                      </span>
                    </button>
                    <b className="canonical-post-picker-state" title={disabledReason ?? undefined}>
                      {disabledReason ?? (isSelected ? 'Đã chọn' : 'Chọn')}
                    </b>
                  </article>
                )
              })}
              {!detailLoading && details && !visibleItems.length ? (
                <div className="canonical-post-picker-empty">Không có bài phù hợp trong thư mục này.</div>
              ) : null}
            </div>
          </main>
        </div>

        <footer className="canonical-post-picker-footer">
          <span>
            {mode === 'multiple'
              ? `Đã chọn ${selected.size} bài · có thể chuyển thư mục để chọn tiếp.`
              : selected.size
                ? 'Đã chọn 1 bài.'
                : 'Chọn một bài để tiếp tục.'}
          </span>
          <div>
            <button type="button" onClick={onClose}>Hủy</button>
            <button className="primary" type="button" disabled={!selected.size} onClick={apply}>
              {mode === 'multiple' ? `Áp dụng ${selected.size} bài` : 'Dùng bài đã chọn'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
