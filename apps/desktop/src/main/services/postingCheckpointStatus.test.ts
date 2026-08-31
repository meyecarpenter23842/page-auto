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

function setupPostingRun() {
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
  return { database, accounts, tabs, runs, account, tab, run, service }
}

describe('checkpoint status propagation', () => {
  it('persists checkpoint_282, keeps the Group pending, and marks only the Page run account red', async () => {
    const { database, accounts, runs, account, tab, run, service } = setupPostingRun()
    injectWorkerResult(service, {
      status: 'needs_login',
      code: 'verification_required',
      message: 'Facebook yêu cầu checkpoint 282.',
      sessionValidation: {
        phase: 'before_run',
        state: 'verification_required',
        accountStatus: 'checkpoint_282',
        message: 'Facebook yêu cầu checkpoint 282.',
        checkpointKind: '282'
      }
    })

    const outcome = await service.executeSingle({ runId: run.run.id, accountId: account.id })
    const persisted = accounts.getById(account.id)

    expect(persisted).toMatchObject({
      status: 'checkpoint_282',
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

  it('falls back to the checkpoint kind for older worker results that do not carry accountStatus', async () => {
    const { database, accounts, account, run, service } = setupPostingRun()
    injectWorkerResult(service, {
      status: 'needs_login',
      code: 'verification_required',
      message: 'Facebook yêu cầu checkpoint 956.',
      sessionValidation: {
        phase: 'before_run',
        state: 'verification_required',
        message: 'Facebook yêu cầu checkpoint 956.',
        checkpointKind: '956'
      }
    })

    await service.executeSingle({ runId: run.run.id, accountId: account.id })
    expect(accounts.getById(account.id)?.status).toBe('checkpoint_956')

    service.closeAll()
    database.close()
  })

  it('persists locked/disabled session evidence without collapsing it to needs_login', async () => {
    for (const [accountStatus, checkpointKind] of [
      ['locked', '956_purple_lock'],
      ['disabled', 'disabled']
    ] as const) {
      const { database, accounts, account, run, service } = setupPostingRun()
      injectWorkerResult(service, {
        status: 'needs_login',
        code: 'verification_required',
        message: `Facebook account state: ${accountStatus}`,
        sessionValidation: {
          phase: 'before_run',
          state: 'verification_required',
          accountStatus,
          message: `Facebook account state: ${accountStatus}`,
          checkpointKind
        }
      })

      await service.executeSingle({ runId: run.run.id, accountId: account.id })
      expect(accounts.getById(account.id)?.status).toBe(accountStatus)

      service.closeAll()
      database.close()
    }
  })

  it('does not overwrite a healthy account status for a runtime-only Group/Page failure', async () => {
    const { database, accounts, account, run, service } = setupPostingRun()
    injectWorkerResult(service, {
      status: 'failed',
      code: 'group_unavailable',
      message: 'Không mở được Group.'
    })

    await service.executeSingle({ runId: run.run.id, accountId: account.id })
    expect(accounts.getById(account.id)).toMatchObject({
      status: 'valid',
      cookieStatus: 'valid'
    })

    service.closeAll()
    database.close()
  })
})
