import { useEffect, useState } from 'react'
import type { ActionConfigValue } from '../../../shared/actionRegistry'
import type { ContentLibrarySetDetails, ContentLibrarySetSummary } from '../../../shared/contentLibrary'

interface ContentLibraryActionFieldProps {
  value: ActionConfigValue | undefined
  onChange: (value: ActionConfigValue | undefined) => void
}

interface ContentLibraryPreviewRow {
  id: number
  name: string
  preview: string
  meta: string
}

export function buildContentLibraryPreviewRows(details: ContentLibrarySetDetails | null, limit = 3): ContentLibraryPreviewRow[] {
  if (!details) return []
  return details.items
    .filter((item) => item.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, limit)
    .map((item) => {
      const firstVariant = item.variants.find((variant) => variant.trim())?.replace(/\s+/g, ' ').trim()
      const hasImages = item.image.folderPath.trim().length > 0
      return {
        id: item.id,
        name: item.name.trim() || `Bài #${item.id}`,
        preview: firstVariant ? (firstVariant.length > 110 ? `${firstVariant.slice(0, 110)}…` : firstVariant) : 'Bài chỉ có ảnh',
        meta: `${item.variants.filter((variant) => variant.trim()).length} nội dung · ${hasImages ? 'có ảnh' : 'không ảnh'}`
      }
    })
}

export function ContentLibraryActionField({ value, onChange }: ContentLibraryActionFieldProps) {
  const [libraries, setLibraries] = useState<ContentLibrarySetSummary[]>([])
  const [details, setDetails] = useState<ContentLibrarySetDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const currentId = typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void window.pageAuto.listContentLibraries()
      .then((items) => {
        if (cancelled) return
        setLibraries(items)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setLibraries([])
        setLoading(false)
        setError(cause instanceof Error ? cause.message : 'Không thể tải Thư viện Bài viết chung.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (currentId <= 0) {
      setDetails(null)
      setDetailLoading(false)
      return () => {
        cancelled = true
      }
    }

    setDetails(null)
    setDetailLoading(true)
    void window.pageAuto.getContentLibrary({ id: currentId })
      .then((item) => {
        if (cancelled) return
        setDetails(item)
        setDetailLoading(false)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setDetails(null)
        setDetailLoading(false)
        setError(cause instanceof Error ? cause.message : `Không thể đọc bộ bài #${currentId}.`)
      })

    return () => {
      cancelled = true
    }
  }, [currentId])

  const currentSummary = libraries.find((item) => item.id === currentId) ?? null
  const currentExists = currentId > 0 && Boolean(currentSummary || details)
  const selectedName = details?.name ?? currentSummary?.name ?? (currentId > 0 ? `Bộ bài #${currentId}` : '')
  const itemCount = details?.itemCount ?? currentSummary?.itemCount ?? 0
  const enabledCount = details?.enabledCount ?? currentSummary?.enabledCount ?? 0
  const previewRows = buildContentLibraryPreviewRows(details)
  const remaining = Math.max(0, enabledCount - previewRows.length)

  return (
    <div className="post-library-picker">
      <div className="post-library-label-row">
        <span>Bộ bài viết *</span>
        <small>Thư viện Bài viết chung</small>
      </div>

      <select
        aria-label="Bộ bài viết"
        disabled={loading}
        value={currentId > 0 ? String(currentId) : ''}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : undefined)}
      >
        <option value="">{loading ? 'Đang tải Thư viện...' : 'Chọn bộ bài viết...'}</option>
        {!loading && currentId > 0 && !currentExists ? (
          <option value={String(currentId)}>Bộ bài #{currentId} · không còn tồn tại</option>
        ) : null}
        {libraries.map((item) => (
          <option key={item.id} value={String(item.id)}>
            {item.name} · {item.enabledCount}/{item.itemCount} bài bật
          </option>
        ))}
      </select>

      {currentId > 0 ? (
        <div className={`post-library-selected${currentExists ? '' : ' missing'}`}>
          <div className="post-library-selected-head">
            <div>
              <small>ĐANG DÙNG</small>
              <strong>{selectedName}</strong>
            </div>
            <span>{enabledCount}/{itemCount} bài bật</span>
          </div>

          {detailLoading ? <div className="post-library-loading">Đang đọc nội dung bộ bài...</div> : null}
          {!detailLoading && details && previewRows.length ? (
            <div className="post-library-preview">
              {previewRows.map((row, index) => (
                <div className="post-library-preview-row" key={row.id}>
                  <span className="post-library-index">{index + 1}</span>
                  <div>
                    <strong>{row.name}</strong>
                    <p>{row.preview}</p>
                  </div>
                  <small>{row.meta}</small>
                </div>
              ))}
              {remaining > 0 ? <div className="post-library-more">+ {remaining} bài đang bật khác</div> : null}
            </div>
          ) : null}
          {!detailLoading && details && !previewRows.length ? (
            <div className="post-library-loading warning">Bộ này chưa có bài đang bật.</div>
          ) : null}
          {!currentExists ? (
            <div className="post-library-loading warning">Bộ bài này đã bị xóa. Hãy chọn bộ khác trước khi lưu.</div>
          ) : null}
        </div>
      ) : (
        <div className="post-library-empty">Chọn một bộ bài để thấy ngay nội dung sẽ được dùng khi chạy.</div>
      )}

      {error ? <small className="action-config-help post-library-error">{error}</small> : null}
      {!loading && !error && libraries.length === 0 ? (
        <small className="action-config-help">Chưa có bộ bài nào trong Thư viện Bài viết chung.</small>
      ) : null}
    </div>
  )
}
