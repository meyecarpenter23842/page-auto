import type { ActionConfig } from './actionRegistry'
import { getActionDefinition } from './actionRegistry'
import { parseStoryIds } from './story'

export interface K454StoryFieldUiMeta {
  section: string
}

const UI_META: Record<string, K454StoryFieldUiMeta> = {
  storyIds: { section: 'Danh sách Story' },
  orderMode: { section: 'Cách lấy Story' },
  storiesPerAccount: { section: 'Cách lấy Story' },
  delayMinSeconds: { section: 'Thời gian chạy' },
  delayMaxSeconds: { section: 'Thời gian chạy' },
  pauseAfterStories: { section: 'Thời gian chạy' },
  pauseMinutes: { section: 'Thời gian chạy' }
}

export function applyK454StoryPostActionOverrides(): void {
  const definition = getActionDefinition('post_story')
  if (!definition) return
  definition.label = 'Đăng story'
  definition.description = 'Chọn Story từ kho Story dùng chung; nút Thêm mở popup soạn Story riêng rồi runtime đăng lần lượt.'
  definition.runtimeStatus = 'ready'
  definition.capabilities.actors = ['profile']
  definition.capabilities.requiresNavigation = true
  definition.capabilities.supportsMedia = true
  definition.configSchema = {
    version: 1,
    fields: [
      {
        key: 'storyIds',
        label: 'Story đã chọn',
        kind: 'text',
        required: true,
        maxLength: 10_000,
        help: 'Danh sách ID Story dùng chung theo thứ tự chạy.'
      },
      {
        key: 'orderMode',
        label: 'Thứ tự Story',
        kind: 'select',
        defaultValue: 'sequential',
        options: [
          { value: 'sequential', label: 'Tuần tự' },
          { value: 'random', label: 'Ngẫu nhiên' }
        ]
      },
      {
        key: 'storiesPerAccount',
        label: 'Số Story / tài khoản',
        kind: 'number',
        defaultValue: 1,
        min: 1,
        max: 100
      },
      {
        key: 'delayMinSeconds',
        label: 'Delay giữa Story từ',
        kind: 'number',
        defaultValue: 200,
        min: 0,
        max: 86_400,
        help: 'giây'
      },
      {
        key: 'delayMaxSeconds',
        label: 'Delay giữa Story đến',
        kind: 'number',
        defaultValue: 300,
        min: 0,
        max: 86_400,
        help: 'giây'
      },
      {
        key: 'pauseAfterStories',
        label: 'Tạm dừng sau N Story',
        kind: 'number',
        defaultValue: 30,
        min: 0,
        max: 100
      },
      {
        key: 'pauseMinutes',
        label: 'Tạm dừng',
        kind: 'number',
        defaultValue: 15,
        min: 0,
        max: 1_440,
        help: 'phút'
      }
    ]
  }
}

export function getK454StoryFieldUiMeta(actionType: string, fieldKey: string): K454StoryFieldUiMeta | undefined {
  return actionType === 'post_story' ? UI_META[fieldKey] : undefined
}

export function getK454StoryValidationErrors(actionType: string, config: ActionConfig): string[] {
  if (actionType !== 'post_story') return []
  const errors: string[] = []
  if (parseStoryIds(config.storyIds).length === 0) errors.push('Danh sách Story: cần chọn ít nhất một Story.')
  const min = typeof config.delayMinSeconds === 'number' ? config.delayMinSeconds : 0
  const max = typeof config.delayMaxSeconds === 'number' ? config.delayMaxSeconds : 0
  if (max < min) errors.push('Delay giữa Story: giá trị “đến” phải lớn hơn hoặc bằng “từ”.')
  const pauseAfter = typeof config.pauseAfterStories === 'number' ? config.pauseAfterStories : 0
  const pauseMinutes = typeof config.pauseMinutes === 'number' ? config.pauseMinutes : 0
  if (pauseAfter > 0 && pauseMinutes <= 0) errors.push('Tạm dừng: đã chọn số Story thì cần nhập số phút lớn hơn 0.')
  return errors
}
