import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GROUP_WORKSPACE_DRAFT,
  allocateGroupTargets,
  buildJoinGroupActionConfig,
  parseGroupWorkspaceDraft,
  serializeGroupWorkspaceDraft,
  splitGroupTargets,
  validateGroupWorkspaceDraft
} from './groupWorkspaceConfig'

describe('group workspace config', () => {
  it('round-trips the persisted draft and keeps safe defaults', () => {
    const draft = { ...DEFAULT_GROUP_WORKSPACE_DRAFT, sourceMode: 'id_shared' as const, sourceTargets: '1\n2' }
    expect(parseGroupWorkspaceDraft(serializeGroupWorkspaceDraft(draft))).toEqual(draft)
    expect(parseGroupWorkspaceDraft('{bad json')).toEqual(DEFAULT_GROUP_WORKSPACE_DRAFT)
  })

  it('splits and deduplicates group targets', () => {
    expect(splitGroupTargets('1\n2|2\n 3 ')).toEqual(['1', '2', '3'])
  })

  it('distributes IDs without overlap across accounts', () => {
    const draft = { ...DEFAULT_GROUP_WORKSPACE_DRAFT, sourceMode: 'id_distribute' as const }
    const targets = ['1', '2', '3', '4', '5']
    expect(allocateGroupTargets(draft, targets, 0, 2)).toEqual(['1', '3', '5'])
    expect(allocateGroupTargets(draft, targets, 1, 2)).toEqual(['2', '4'])
  })

  it('applies a hard per-account ID limit using non-overlapping slices', () => {
    const draft = { ...DEFAULT_GROUP_WORKSPACE_DRAFT, sourceMode: 'id_limit' as const, limitPerAccount: 2 }
    const targets = ['1', '2', '3', '4', '5']
    expect(allocateGroupTargets(draft, targets, 0, 3)).toEqual(['1', '2'])
    expect(allocateGroupTargets(draft, targets, 1, 3)).toEqual(['3', '4'])
    expect(allocateGroupTargets(draft, targets, 2, 3)).toEqual(['5'])
  })

  it('shares the same IDs for shared/file modes', () => {
    const targets = ['1', '2']
    expect(allocateGroupTargets({ ...DEFAULT_GROUP_WORKSPACE_DRAFT, sourceMode: 'id_shared' }, targets, 1, 2)).toEqual(targets)
    expect(allocateGroupTargets({ ...DEFAULT_GROUP_WORKSPACE_DRAFT, sourceMode: 'file' }, targets, 1, 2)).toEqual(targets)
  })

  it('composes the real join_group config including filters and additive action pacing', () => {
    const config = buildJoinGroupActionConfig({
      ...DEFAULT_GROUP_WORKSPACE_DRAFT,
      sourceMode: 'id_shared',
      sourceTargets: '11\n22',
      answerQuestionsEnabled: false,
      answerQuestions: 'yes',
      memberMin: 10_000,
      memberMax: 50_000,
      errorPauseMinutes: 9
    }, ['11', '22'])

    expect(config).toMatchObject({
      sourceMode: 'id_list',
      sourceTargets: '11\n22',
      answerQuestions: '',
      memberFilterEnabled: true,
      memberMin: 10_000,
      memberMax: 50_000,
      itemDelayMinSeconds: 200,
      itemDelayMaxSeconds: 300,
      errorPauseMinutes: 9
    })
  })

  it('rejects decorative/invalid states before Start', () => {
    expect(validateGroupWorkspaceDraft({
      ...DEFAULT_GROUP_WORKSPACE_DRAFT,
      sourceMode: 'id_distribute',
      sourceTargets: '',
      privacyOpen: false,
      privacyClosed: false,
      joinMin: 20,
      joinMax: 5
    }, 0)).toEqual(expect.arrayContaining([
      'Cần bật ít nhất một tài khoản.',
      'Số lượng nhóm: giá trị từ phải nhỏ hơn hoặc bằng giá trị đến.',
      'Privacy: cần chọn ít nhất OPEN hoặc CLOSED.',
      'Nguồn Group ID: cần nhập danh sách hoặc nạp file.'
    ]))
  })
})
