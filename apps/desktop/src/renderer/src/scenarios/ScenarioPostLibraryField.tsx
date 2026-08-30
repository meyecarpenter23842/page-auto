import { useEffect, useMemo, useState } from 'react'
import {
  CANONICAL_CONTENT_LIBRARY_SET_ID,
  type ContentLibraryItem
} from '../../../shared/contentLibrary'
import {
  DEFAULT_PAGE_TAB_IMAGE,
  parsePostVariantText,
  type CanonicalPostSummary,
  type PageTabImageConfig
} from '../../../shared/pageTabs'
import type { ScenarioActionPostInput } from '../../../shared/scenarios'
import {
  canDisableScenarioPost,
  clampScenarioImagesPerPost,
  ensureScenarioHasEnabledPost
} from './scenarioPostUiValidation'
import './postActionConfig.css'

interface Props {
  posts: ScenarioActionPostInput[]
  onChange: (posts: ScenarioActionPostInput[]) => void
}

function canonicalFromItem(item: ContentLibraryItem): CanonicalPostSummary | null {
  if (!Number.isSafeInteger(item.id) || item.id >= 0) return null
  return {
    postId: Math.abs(item.id),
    name: item.name,
    variants: [...item.variants],
    image: { ...item.image },
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }
}

function preview(values: readonly string[]): string {
  const value = values.find((item) => item.trim())?.replace(/\s+/g, ' ').trim()
  if (!value) return 'Bài chỉ có ảnh hoặc chưa có nội dung chữ.'
  return value.length > 150 ? `${value.slice(0, 150)}…` : value
}

function normalizeOrder(posts: readonly ScenarioActionPostInput[]): ScenarioActionPostInput[] {
  return posts.map((post, index) => ({
    ...post,
    sortOrder: index,
    variants: [...post.variants],
    image: { ...post.image }
  }))
}

export function ScenarioPostLibraryField({ posts, onChange }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [available, setAvailable] = useState<CanonicalPostSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [variantText, setVariantText] = useState('')
  const [image, setImage] = useState<PageTabImageConfig>({ ...DEFAULT_PAGE_TAB_IMAGE, mode: 'random' })

  useEffect(() => {
    if (!posts.length || posts.some((post) => post.enabled)) return
    onChange(normalizeOrder(ensureScenarioHasEnabledPost(posts)))
  }, [onChange, posts])

  useEffect(() => {
    if (!pickerOpen) return
    let cancelled = false
    setLoading(true)
    setError('')
    void window.pageAuto.getContentLibrary({ id: CANONICAL_CONTENT_LIBRARY_SET_ID })
      .then((details) => {
        if (cancelled) return
        setAvailable((details?.items ?? []).map(canonicalFromItem).filter((item): item is CanonicalPostSummary => Boolean(item)))
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setAvailable([])
        setError(cause instanceof Error ? cause.message : 'Không thể tải Thư viện Bài viết.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [pickerOpen])

  const boundPostIds = useMemo(
    () => new Set(posts.flatMap((post) => typeof post.postId === 'number' && post.postId > 0 ? [post.postId] : [])),
    [posts]
  )
  const pickerRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi')
    return available.filter((post) => !query || [post.name, ...post.variants].some((value) => value.toLocaleLowerCase('vi').includes(query)))
  }, [available, search])

  const updatePosts = (next: readonly ScenarioActionPostInput[]) => onChange(normalizeOrder(next))
  const toggle = (index: number, enabled: boolean) => {
    if (!enabled && !canDisableScenarioPost(posts, index)) {
      setError('Action cần ít nhất một bài đang bật.')
      return
    }
    setError('')
    updatePosts(posts.map((post, current) => current === index ? { ...post, enabled } : post))
  }
  const remove = (index: number) => updatePosts(posts.filter((_post, current) => current !== index))
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= posts.length) return
    const next = [...posts]
    const current = next[index]
    const other = next[target]
    if (!current || !other) return
    next[index] = other
    next[target] = current
    updatePosts(next)
  }

  const chooseExisting = (post: CanonicalPostSummary) => {
    if (boundPostIds.has(post.postId)) return
    updatePosts([...posts, {
      postId: post.postId,
      name: post.name,
      enabled: true,
      sortOrder: posts.length,
      variants: [...post.variants],
      image: { ...post.image }
    }])
    setPickerOpen(false)
    setSearch('')
  }

  const resetCreate = () => {
    setName('')
    setVariantText('')
    setImage({ ...DEFAULT_PAGE_TAB_IMAGE, mode: 'random' })
    setError('')
  }

  const closeCreate = () => {
    setCreating(false)
    resetCreate()
  }

  const addNew = () => {
    const variants = parsePostVariantText(variantText)
    const folderPath = image.folderPath.trim()
    if (!variants.length && !folderPath) {
      setError('Bài mới cần có nội dung hoặc folder ảnh.')
      return
    }
    const normalizedName = name.trim() || `Bài viết ${posts.length + 1}`
    updatePosts([...posts, {
      postId: null,
      name: normalizedName,
      enabled: true,
      sortOrder: posts.length,
      variants,
      image: {
        ...image,
        folderPath,
        imagesPerPost: clampScenarioImagesPerPost(image.imagesPerPost)
      }
    }])
    closeCreate()
  }

  return (
    <div className="post-library-picker">
      <div className="post-library-label-row">
        <span>Bài đang dùng *</span>
        <small>Canonical · dùng chung toàn app</small>
      </div>

      <div className="post-library-toolbar">
        <button className="scenario-button primary" type="button" onClick={() => { resetCreate(); setCreating(true) }}>+ Bài mới</button>
        <button className="scenario-button" type="button" onClick={() => setPickerOpen(true)}>Chọn từ thư viện</button>
        <small>{posts.filter((post) => post.enabled).length}/{posts.length} bài bật</small>
      </div>

      {posts.length ? (
        <div className="post-bound-list">
          {posts.map((post, index) => (
            <div className="post-bound-row" key={`${post.postId ?? 'new'}-${index}`}>
              <label className="post-bound-check" title="Bật/tắt bài">
                <input type="checkbox" checked={post.enabled} onChange={(event) => toggle(index, event.target.checked)} />
              </label>
              <div className="post-bound-copy">
                <div className="post-bound-title">
                  <strong>{post.name}</strong>
                  <span>{typeof post.postId === 'number' ? `Post #${post.postId}` : 'Bài mới'}</span>
                </div>
                <p>{preview(post.variants)}</p>
              </div>
              <div className="post-bound-actions">
                <button type="button" title="Lên" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                <button type="button" title="Xuống" disabled={index === posts.length - 1} onClick={() => move(index, 1)}>↓</button>
                <button className="row-danger" type="button" title="Gỡ khỏi action" onClick={() => remove(index)}>×</button>
              </div>
            </div>
          ))}
        </div>
      ) : <div className="post-library-empty">Chưa có bài. Tạo bài mới hoặc chọn bài có sẵn từ kho chung.</div>}

      {error ? <small className="action-config-help post-library-error">{error}</small> : null}

      {creating ? (
        <div className="scenario-modal-backdrop" role="presentation" onMouseDown={closeCreate}>
          <section className="scenario-modal action-config-modal post-create-modal" role="dialog" aria-modal="true" aria-label="Tạo bài mới" onMouseDown={(event) => event.stopPropagation()}>
            <div className="scenario-modal-head">
              <div><p className="scenario-kicker">KHO BÀI VIẾT GỐC</p><h3>Tạo bài mới</h3></div>
              <button type="button" onClick={closeCreate}>×</button>
            </div>
            <div className="action-config-form post-create-form">
              <p className="post-create-note">Tạo bài vào kho gốc và bind ngay vào action này.</p>
              <label className="scenario-field"><span>Tên bài</span><input autoFocus value={name} maxLength={160} onChange={(event) => setName(event.target.value)} placeholder={`Bài viết ${posts.length + 1}`} /></label>
              <label className="scenario-field"><span>Nội dung</span><textarea rows={5} value={variantText} onChange={(event) => setVariantText(event.target.value)} placeholder="Dùng dấu | để tách biến thể; dùng \\| nếu cần ký tự |." /></label>
              <label className="scenario-field"><span>Folder ảnh</span><div className="action-config-input-line"><input value={image.folderPath} onChange={(event) => setImage((current) => ({ ...current, folderPath: event.target.value }))} placeholder="Để trống nếu chỉ đăng text"/><button className="scenario-button" type="button" onClick={async () => { const folder = await window.pageAuto.pickContentLibraryImageFolder(); if (folder) setImage((current) => ({ ...current, folderPath: folder })) }}>Chọn folder</button></div></label>
              <div className="post-create-options">
                <label><span>Chọn ảnh</span><select value={image.mode} onChange={(event) => setImage((current) => ({ ...current, mode: event.target.value as PageTabImageConfig['mode'] }))}><option value="sequential">Lần lượt</option><option value="random">Ngẫu nhiên</option><option value="filename_match">Khớp Group UID</option></select></label>
                <label><span>Số ảnh / bài</span><input type="number" min={1} max={50} value={image.imagesPerPost} onChange={(event) => setImage((current) => ({ ...current, imagesPerPost: clampScenarioImagesPerPost(Number(event.target.value) || 1) }))}/></label>
                <label><span>Khi thiếu ảnh</span><select value={image.missingPolicy} onChange={(event) => setImage((current) => ({ ...current, missingPolicy: event.target.value as PageTabImageConfig['missingPolicy'] }))}><option value="text_only">Vẫn đăng text</option><option value="skip">Bỏ qua</option></select></label>
              </div>
              {error ? <small className="action-config-help post-library-error">{error}</small> : null}
            </div>
            <div className="scenario-modal-actions">
              <button className="scenario-button" type="button" onClick={closeCreate}>Hủy</button>
              <button className="scenario-button primary" type="button" onClick={addNew}>Thêm bài</button>
            </div>
          </section>
        </div>
      ) : null}

      {pickerOpen ? (
        <div className="scenario-modal-backdrop" role="presentation" onMouseDown={() => setPickerOpen(false)}>
          <section className="scenario-modal action-config-modal" role="dialog" aria-modal="true" aria-label="Chọn bài từ thư viện" onMouseDown={(event) => event.stopPropagation()}>
            <div className="scenario-modal-head"><div><p className="scenario-kicker">KHO BÀI VIẾT GỐC</p><h3>Chọn từ thư viện</h3></div><button type="button" onClick={() => setPickerOpen(false)}>×</button></div>
            <div className="action-config-form">
              <label className="scenario-field"><span>Tìm bài</span><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên hoặc nội dung..." /></label>
              {loading ? <div className="post-library-loading">Đang tải thư viện...</div> : (
                <div className="post-library-preview">
                  {pickerRows.map((post) => {
                    const bound = boundPostIds.has(post.postId)
                    return <div className="post-library-preview-row" key={post.postId}>
                      <span className="post-library-index">#{post.postId}</span>
                      <div><strong>{post.name}</strong><p>{preview(post.variants)}</p><small>{post.variants.length} biến thể · {post.image.folderPath ? 'có ảnh' : 'không ảnh'}</small></div>
                      <button className="scenario-button" type="button" disabled={bound} onClick={() => chooseExisting(post)}>{bound ? 'Đang dùng' : 'Chọn'}</button>
                    </div>
                  })}
                  {!pickerRows.length && !loading ? <div className="post-library-empty">Không có bài phù hợp.</div> : null}
                </div>
              )}
            </div>
            <div className="scenario-modal-actions"><span className="scenario-toolbar-note">Chọn chỉ tạo binding, không copy bài.</span><button className="scenario-button" type="button" onClick={() => setPickerOpen(false)}>Đóng</button></div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
