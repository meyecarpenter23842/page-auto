import type { ActionConfig, ActionConfigValue } from '../../../shared/actionRegistry'
import type { ScenarioActionPostInput } from '../../../shared/scenarios'
import { ScenarioPostLibraryField } from './ScenarioPostLibraryField'
import './postActionConfig.css'

interface PostActionConfigFormProps {
  config: ActionConfig
  posts: ScenarioActionPostInput[]
  onChange: (key: string, value: ActionConfigValue | undefined) => void
  onPostsChange: (posts: ScenarioActionPostInput[]) => void
}

function numberValue(config: ActionConfig, key: string, fallback: number): number {
  const value = config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringValue(config: ActionConfig, key: string): string {
  const value = config[key]
  return typeof value === 'string' ? value : ''
}

function toggleClass(enabled: boolean): string {
  return enabled ? 'post-target-card active' : 'post-target-card'
}

export function PostActionConfigForm({ config, posts, onChange, onPostsChange }: PostActionConfigFormProps) {
  const postToWall = config.postToWall === true
  const postToGroups = config.postToGroups === true
  const selectionMode = stringValue(config, 'selectionMode') || 'sequential'

  return (
    <div className="post-action-flow">
      <section className="post-config-block">
        <div className="post-config-heading">
          <span className="post-config-step">1</span>
          <div>
            <strong>Nơi đăng</strong>
            <small>Bật Tường Page, Nhóm hoặc cả hai. Mỗi đích có số bài riêng.</small>
          </div>
        </div>

        <div className="post-target-grid">
          <div className={toggleClass(postToWall)}>
            <label className="post-target-toggle">
              <input type="checkbox" checked={postToWall} onChange={(event) => onChange('postToWall', event.target.checked)} />
              <span><strong>Đăng tường Page</strong><small>Đăng trực tiếp lên tường Page.</small></span>
            </label>
            {postToWall ? (
              <div className="post-target-fields">
                <label className="scenario-field"><span>Page UID *</span><input aria-label="Page UID" value={stringValue(config, 'wallPageUid')} placeholder="Nhập Page UID..." maxLength={200} onChange={(event) => onChange('wallPageUid', event.target.value)} /></label>
                <label className="scenario-field compact-number"><span>Số bài / tài khoản</span><input aria-label="Số bài đăng tường" type="number" min={1} max={100} value={numberValue(config, 'wallPostsPerAccount', 1)} onChange={(event) => onChange('wallPostsPerAccount', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
              </div>
            ) : null}
          </div>

          <div className={toggleClass(postToGroups)}>
            <label className="post-target-toggle">
              <input type="checkbox" checked={postToGroups} onChange={(event) => onChange('postToGroups', event.target.checked)} />
              <span><strong>Đăng nhóm</strong><small>Mỗi dòng một Group UID hoặc URL Facebook.</small></span>
            </label>
            {postToGroups ? (
              <div className="post-group-fields">
                <div className="post-group-title"><span>Danh sách Group *</span><button className="scenario-button" type="button" onClick={async () => { const picked = await window.pageAuto.pickPageTabTextFile(); if (picked) onChange('groupTargets', picked.content) }}>Mở file ID</button></div>
                <textarea aria-label="Danh sách Group" rows={4} maxLength={100_000} placeholder="Mỗi dòng một Group UID hoặc URL Facebook..." value={stringValue(config, 'groupTargets')} onChange={(event) => onChange('groupTargets', event.target.value)} />
                <label className="scenario-field compact-number"><span>Số bài / tài khoản</span><input aria-label="Số bài đăng nhóm" type="number" min={1} max={100} value={numberValue(config, 'groupPostsPerAccount', 1)} onChange={(event) => onChange('groupPostsPerAccount', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="post-config-block">
        <div className="post-config-heading">
          <span className="post-config-step">2</span>
          <div><strong>Bài viết</strong><small>Tạo mới hoặc gắn bài có sẵn từ kho bài viết gốc.</small></div>
        </div>

        <div className="post-content-layout">
          <ScenarioPostLibraryField posts={posts} onChange={onPostsChange} />
          <div className="post-selection-panel">
            <span>Lấy bài theo</span>
            <div className="post-mode-options" role="radiogroup" aria-label="Cách lấy bài">
              <label>
                <input type="radio" name="post-selection-mode" value="sequential" checked={selectionMode === 'sequential'} onChange={() => onChange('selectionMode', 'sequential')} />
                <span>Lần lượt</span>
              </label>
              <label>
                <input type="radio" name="post-selection-mode" value="random" checked={selectionMode === 'random'} onChange={() => onChange('selectionMode', 'random')} />
                <span>Ngẫu nhiên</span>
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="post-config-block compact">
        <div className="post-config-heading">
          <span className="post-config-step">3</span>
          <div><strong>Delay giữa mỗi bài</strong><small>Khoảng nghỉ áp dụng cho các lượt đăng của action này.</small></div>
        </div>
        <div className="post-delay-row">
          <label><span>Từ</span><input aria-label="Delay từ" type="number" min={0} max={86_400} value={numberValue(config, 'postDelayMinSeconds', 200)} onChange={(event) => onChange('postDelayMinSeconds', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
          <span className="post-delay-arrow">→</span>
          <label><span>Đến</span><input aria-label="Delay đến" type="number" min={0} max={86_400} value={numberValue(config, 'postDelayMaxSeconds', 300)} onChange={(event) => onChange('postDelayMaxSeconds', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
          <span className="post-delay-unit">giây</span>
        </div>
      </section>
    </div>
  )
}
