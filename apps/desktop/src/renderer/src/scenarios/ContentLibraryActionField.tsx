import { useEffect, useState } from 'react'
import type { ActionConfigValue } from '../../../shared/actionRegistry'
import type { ContentLibrarySetSummary } from '../../../shared/contentLibrary'

interface ContentLibraryActionFieldProps {
  value: ActionConfigValue | undefined
  onChange: (value: ActionConfigValue | undefined) => void
}

export function ContentLibraryActionField({ value, onChange }: ContentLibraryActionFieldProps) {
  const [libraries, setLibraries] = useState<ContentLibrarySetSummary[]>([])
  const [loading, setLoading] = useState(true)
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

  const currentExists = currentId > 0 && libraries.some((item) => item.id === currentId)
  return (
    <label className="scenario-field action-config-field">
      <span>Nguồn bài viết *</span>
      <select
        aria-label="Nguồn bài viết"
        disabled={loading}
        value={currentId > 0 ? String(currentId) : ''}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : undefined)}
      >
        <option value="">{loading ? 'Đang tải Thư viện chung...' : 'Chọn từ Thư viện chung...'}</option>
        {!loading && currentId > 0 && !currentExists ? (
          <option value={String(currentId)}>Nguồn #{currentId} · không còn tồn tại</option>
        ) : null}
        {libraries.map((item) => (
          <option key={item.id} value={String(item.id)}>
            {item.name} · {item.enabledCount}/{item.itemCount} bài bật
          </option>
        ))}
      </select>
      {error ? <small className="action-config-help">{error}</small> : null}
      {!loading && !error && libraries.length === 0 ? (
        <small className="action-config-help">Chưa có nguồn global trong Thư viện Bài viết.</small>
      ) : null}
    </label>
  )
}
