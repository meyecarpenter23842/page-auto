import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloneDefaultAppSettings } from '../../shared/appSettings'
import {
  pageWallPostTaskFromBase,
  type FacebookPostTaskJobRequest,
  type FacebookTaskJobBase
} from '../../shared/facebookTasks'
import type { PostingJobResult } from '../../shared/posting'
import { AccountRepository } from '../database/accountRepository'
import { initializeDatabase } from '../database/index'
import { PostingService } from './postingService'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setupAccount() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-facebook-task-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  const accounts = new AccountRepository(runtime.client)
  const account = accounts.create({
    uid: '10001',
    password: 'canonical-password',
    cookie: 'c_user=10001; xs=canonical'
  })
  return { directory, runtime, accounts, account }
}

function wallJob(accountId: number): ReturnType<typeof pageWallPostTaskFromBase> {
  const settings = cloneDefaultAppSettings()
  const base: FacebookTaskJobBase = {
    runId: 501,
    itemId: 601,
    accountId,
    profileDirectory: 'C:\\stale\\profile',
    pageUid: '90001',
    content: 'hello wall',
    imagePaths: [],
    browser: { ...settings.browser, navigationTimeoutMs: 1_234 },
    session: settings.session,
    network: settings.network,
    logging: settings.logging,
    sessionAccount: {
      id: accountId,
      uid: '10001',
      username: 'stale-user',
      password: 'stale-password',
      cookie: 'c_user=10001; xs=stale',
      twoFactorSecret: 'stale-2fa',
      name: 'Stale Name'
    },
    userAgent: 'stale-user-agent',
    proxy: { server: 'http://127.0.0.1:9999', username: 'stale', password: 'stale' }
  }
  return pageWallPostTaskFromBase(base)
}

describe('PostingService Facebook task entrypoint', () => {
  it('rebuilds canonical account/session/runtime material before dispatching a Page Wall task', async () => {
    const { directory, runtime, accounts, account } = setupAccount()
    const service = new PostingService(runtime.client, directory)
    const runTask = vi.fn(async (_job: FacebookPostTaskJobRequest): Promise<PostingJobResult> => ({
      status: 'success',
      message: 'published',
      sessionCookie: 'c_user=10001; xs=fresh'
    }))
    Object.defineProperty(service, 'workers', {
      value: { runTask, closeAll: vi.fn() },
      configurable: true
    })

    const result = await service.executeFacebookPostTask(wallJob(account.id))

    expect(runTask).toHaveBeenCalledTimes(1)
    const dispatched = runTask.mock.calls[0]![0]
    expect(dispatched.profileDirectory).toBe(join(directory, 'browser-profiles', `account-${account.id}`))
    expect(dispatched.sessionAccount).toMatchObject({
      id: account.id,
      uid: account.uid,
      username: account.username,
      password: 'canonical-password',
      cookie: 'c_user=10001; xs=canonical',
      twoFactorSecret: account.twoFactorSecret,
      name: account.name
    })
    expect(dispatched.userAgent).toBeUndefined()
    expect(dispatched.proxy).toBeUndefined()
    expect(dispatched.browser.navigationTimeoutMs).toBe(cloneDefaultAppSettings().browser.navigationTimeoutMs)
    expect(result.sessionCookie).toBeUndefined()
    expect(accounts.getById(account.id)?.cookie).toBe('c_user=10001; xs=fresh')

    service.closeAll()
    runtime.close()
  })

  it('rejects malformed canonical proxy before the generic worker can run', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'page-auto-facebook-task-proxy-'))
    tempDirectories.push(directory)
    const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
    const accounts = new AccountRepository(runtime.client)
    const account = accounts.create({ uid: '10002', proxy: 'missing-port' })
    const service = new PostingService(runtime.client, directory)
    const runTask = vi.fn()
    Object.defineProperty(service, 'workers', {
      value: { runTask, closeAll: vi.fn() },
      configurable: true
    })

    const job = wallJob(account.id)
    job.sessionAccount.uid = account.uid
    const result = await service.executeFacebookPostTask(job)

    expect(result).toMatchObject({ status: 'failed', code: 'proxy_invalid' })
    expect(runTask).not.toHaveBeenCalled()

    service.closeAll()
    runtime.close()
  })
})
