import { describe, expect, it } from 'vitest'
import { cloneDefaultAppSettings } from './appSettings'
import type { PostingJobRequest } from './posting'
import {
  groupPostTaskFromLegacy,
  legacyPostingJobFromGroupTask,
  pageWallPostTaskFromBase,
  validateFacebookPostTaskJob
} from './facebookTasks'

function legacyGroupJob(): PostingJobRequest {
  const settings = cloneDefaultAppSettings()
  return {
    runId: 1,
    itemId: 2,
    accountId: 3,
    profileDirectory: 'C:\\Page-Auto\\data\\browser-profiles\\10001',
    pageUid: '90001',
    groupUid: '80001',
    content: 'hello',
    imagePaths: [],
    browser: settings.browser,
    session: settings.session,
    network: settings.network,
    logging: settings.logging,
    sessionAccount: {
      id: 3,
      uid: '10001',
      username: null,
      password: null,
      cookie: 'c_user=10001',
      twoFactorSecret: null,
      name: null
    }
  }
}

describe('Facebook task contracts', () => {
  it('round-trips the legacy Group job without changing observable Group fields', () => {
    const legacy = legacyGroupJob()
    const taskJob = groupPostTaskFromLegacy(legacy)

    expect(taskJob.executionMode).toBe('rotation')
    expect(taskJob.task).toEqual({
      type: 'group_post',
      target: { kind: 'group', groupUid: '80001' }
    })
    expect(validateFacebookPostTaskJob(taskJob)).toBeNull()
    expect(legacyPostingJobFromGroupTask(taskJob)).toEqual(legacy)
  })

  it('represents page_wall_post as an explicit one-shot without a Group UID', () => {
    const { groupUid: _groupUid, ...base } = legacyGroupJob()
    const taskJob = pageWallPostTaskFromBase(base)

    expect(taskJob.executionMode).toBe('one_shot')
    expect(taskJob.task).toEqual({
      type: 'page_wall_post',
      target: { kind: 'page_wall', pageUid: '90001' }
    })
    expect('groupUid' in taskJob).toBe(false)
    expect(validateFacebookPostTaskJob(taskJob)).toBeNull()
  })

  it('rejects a page-wall target that disagrees with the common Page runtime', () => {
    const { groupUid: _groupUid, ...base } = legacyGroupJob()
    const taskJob = pageWallPostTaskFromBase(base)
    taskJob.task.target.pageUid = '90002'

    expect(validateFacebookPostTaskJob(taskJob)).toContain('phải trùng Page UID')
  })
})
