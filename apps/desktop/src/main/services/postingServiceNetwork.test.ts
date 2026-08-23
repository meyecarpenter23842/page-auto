import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountRepository } from '../database/accountRepository'
import { initializeDatabase } from '../database/index'
import { PageTabRepository } from '../database/pageTabRepository'
import { RunRepository } from '../database/runRepository'
import { PostingService } from './postingService'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function setupInvalidProxyRun() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-proxy-invalid-'))
  tempDirectories.push(directory)
  const runtime = initializeDatabase(join(directory, 'page-auto.sqlite'))
  const accounts = new AccountRepository(runtime.client)
  const tabs = new PageTabRepository(runtime.client)
  const runs = new RunRepository(runtime.client)
  const account = accounts.create({ uid: '10001', proxy: 'missing-port' })
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
  return { directory, runtime, runs, account, run }
}

describe('PostingService proxy guard', () => {
  it('blocks malformed configured proxy before claiming a Group item', async () => {
    const { directory, runtime, runs, account, run } = setupInvalidProxyRun()
    const service = new PostingService(runtime.client, directory)

    const result = await service.executeSingle({ runId: run.run.id, accountId: account.id })

    expect(result.item).toBeNull()
    expect(result.result).toMatchObject({ status: 'failed', code: 'proxy_invalid' })
    expect(result.result.message).toContain('không mở kết nối trực tiếp')
    expect(runs.listItems(run.run.id)[0]).toMatchObject({ status: 'pending', attemptCount: 0 })
    expect(result.run.metrics).toMatchObject({ pending: 1, processing: 0, failed: 0, remaining: 1 })

    service.closeAll()
    runtime.close()
  })
})
