import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cloneDefaultAppSettings, type BrowserSettings } from '../../shared/appSettings'
import type { PostingJobResult } from '../../shared/posting'
import type { RotationRuntimeSnapshot } from '../../shared/rotation'
import { AccountRepository } from '../database/accountRepository'
import { initializeDatabase } from '../database/index'
import { PageTabRepository } from '../database/pageTabRepository'
import { RunRepository } from '../database/runRepository'
import { PostingService } from './postingService'
import { RotationRuntimeOverlayRegistry } from './rotationRuntimeOverlay'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function profileBrowserSettings(profileRoot: string): BrowserSettings {
  return {
    ...cloneDefaultAppSettings().browser,
    profileStorageMode: 'external',
    externalProfileRoot: profileRoot
  }
}

function injectWorkerResult(service: PostingService, result: PostingJobResult): void {
  ;(service as unknown as {
    workers: {
      run: () => Promise<PostingJobResult>
      closeAll: () => void
    }
  }).workers = {
    run: async () => result,
    closeAll: () => undefined
  }
}

describe('checkpoint status propagation', () => {
  it('persists master needs_login, keeps the Group pending, and marks only the Page run account red', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-checkpoint-status-'))
    tempDirectories.push(directory)
    const database = initializeDatabase(join(directory, 'page-auto.sqlite'))
    const accounts = new AccountRepository(database.client)
    const tabs = new PageTabRepository(database.client)
    const runs = new RunRepository(database.client)

    const account = accounts.create({
      uid: '10001',
      status: 'valid',
      cookieStatus: 'valid',
      cookie: 'c_user=10001'
    })
    const tab = tabs.create({ name: 'Page A', pageUid: '90001' })
    tabs.update(tab.id, {
      name: tab.name,
      pageUid: tab.pageUid,
      rotation: tab.rotation,
      accounts: [{ accountId: account.id, enabled: true, sortOrder: 0, postsPerTurn: null }],
      schedules: [],
      groupUids: ['group-1'],
      contentMode: 'sequential',
      contents: ['hello'],
      image: tab.image
    })
    const run = runs.createForPageTab(tab.id)

    const profileRoot = join(directory, 'facebook-profiles')
    const service = new PostingService(database.client, directory, () => profileBrowserSettings(profileRoot))
    injectWorkerResult(service, {
      status: 'needs_login',
      code: 'verification_required',
      message: 'Facebook yêu cầu checkpoint 282.',
      sessionValidation: {
        phase: 'before_run',
        state: 'verification_required',
        message: 'Facebook yêu cầu checkpoint 282.',
        checkpointKind: '282'
      }
    })

    const outcome = await service.executeSingle({ runId: run.run.id, accountId: account.id })
    const persisted = accounts.getById(account.id)

    expect(persisted).toMatchObject({
      status: 'needs_login',
      cookieStatus: 'needs_login'
    })
    expect(runs.listItems(run.run.id)[0]).toMatchObject({ status: 'pending' })
    expect(outcome.item).toBeNull()

    const overlay = new RotationRuntimeOverlayRegistry()
    const runtime: RotationRuntimeSnapshot = {
      pageTabId: tab.id,
      runId: run.run.id,
      status: 'running',
      currentAccountId: account.id,
      currentAccountIndex: 0,
      slotsCompletedThisTurn: 0,
      targetSlotsThisTurn: 1,
      cycle: 0,
      nextActionAt: null,
      message: null,
      lastResult: null,
      run: outcome.run
    }
    overlay.decorate(runtime)
    overlay.notePostingStart(run.run.id, account.id)
    overlay.notePostingResult(outcome)

    const released = overlay.decorate({
      ...runtime,
      currentAccountId: null,
      currentAccountIndex: null,
      lastResult: outcome.result
    })
    expect(released.accountStates?.find((entry) => entry.accountId === account.id)).toEqual({
      accountId: account.id,
      status: 'error',
      message: 'Facebook yêu cầu checkpoint 282.',
      checkpointKind: '282'
    })

    service.closeAll()
    database.close()
  })
})
