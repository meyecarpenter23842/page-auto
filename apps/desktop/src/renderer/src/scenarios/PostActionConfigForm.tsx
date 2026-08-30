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

export function PostActionConfigForm({ config, posts, onChange, onPostsChange }: PostActionConfigFormProps) {
  const selectionMode = stringValue(config, 'selectionMode') || 'sequential'

  return (
    <div className="post-action-flow">
      <section className="post-config-block compact">
        <div className="post-config-heading">
          <span className="post-config-step">1</span>
          <div>
            <strong>Đăng tường tài khoản</strong>
            <small>Action dùng chính tài khoản đang chạy Kịch Bản. Không switch Page và không chứa cấu hình Group.</small>
          </div>
        </div>
        <div className="post-delay-row">
          <label>
            <span>Số bài / tài khoản</span>
            <input
              aria-label="Số bài / tài khoản"
              type="number"
              min={1}
              max={100}
              value={numberValue(config, 'postsPerAccount', 1)}
              onChange={(event) => onChange('postsPerAccount', event.target.value === '' ? undefined : Number(event.target.value))}
            />
          </label>
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
