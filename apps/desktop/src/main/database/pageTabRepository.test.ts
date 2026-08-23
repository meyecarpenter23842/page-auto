import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountRepository } from './accountRepository'
import { initializeDatabase } from './index'
import { PageTabRepository } from './pageTabRepository'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createRuntime() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-tab-db-'))
  tempDirectories.push(directory)
  return initializeDatabase(join(directory, 'page-auto.sqlite'))
}

describe('PageTabRepository', () => {
  it('persists full tab config and restores current account references', () => {
    const runtime = createRuntime()
    const accounts = new AccountRepository(runtime.client)
    const tabs = new PageTabRepository(runtime.client)

    const first = accounts.create({ uid: '10001', name: 'Account One', category: 'Warm' })
    const second = accounts.create({ uid: '10002', name: 'Account Two', category: 'Cold' })
    const tab = tabs.create({ name: 'Page A', pageUid: '90001' })

    const saved = tabs.update(tab.id, {
      name: 'Page A',
      pageUid: '90001',
      rotation: {
        postsPerAccount: 5,
        postDelayMinSeconds: 180,
        postDelayMaxSeconds: 300,
        accountDelayMinSeconds: 600,
        accountDelayMaxSeconds: 900
      },
      accounts: [
        { accountId: second.id, enabled: true, sortOrder: 0, postsPerTurn: 3 },
        { accountId: first.id, enabled: false, sortOrder: 1, postsPerTurn: null }
      ],
      schedules: [
        { dayOfWeek: 1, startMinute: 480, endMinute: 660, enabled: true, sortOrder: 0 },
        { dayOfWeek: 1, startMinute: 810, endMinute: 1020, enabled: true, sortOrder: 1 }
      ],
      groupUids: ['g1', 'g2', 'g1', '  g3  '],
      contentMode: 'round_robin',
      contents: ['First post', ' Second post ', ''],
      image: {
        folderPath: 'D:\\PageAuto\\PageA\\images',
        mode: 'random',
        imagesPerPost: 2,
        missingPolicy: 'skip'
      }
    })

    expect(saved.accounts.map((item) => item.uid)).toEqual(['10002', '10001'])
    expect(saved.accounts.map((item) => item.enabled)).toEqual([true, false])
    expect(saved.schedules).toHaveLength(2)
    expect(saved.groupUids).toEqual(['g1', 'g2', 'g3'])
    expect(saved.contents).toEqual(['First post', 'Second post'])
    expect(saved.contentMode).toBe('round_robin')
    expect(saved.image).toEqual({
      folderPath: 'D:\\PageAuto\\PageA\\images',
      mode: 'random',
      imagesPerPost: 2,
      missingPolicy: 'skip'
    })

    accounts.update(second.id, { name: 'Account Two Updated' })
    expect(tabs.get(tab.id)?.accounts[0]?.name).toBe('Account Two Updated')

    runtime.close()
  })

  it('deep-copies tab config while keeping account references', () => {
    const runtime = createRuntime()
    const accounts = new AccountRepository(runtime.client)
    const tabs = new PageTabRepository(runtime.client)
    const account = accounts.create({ uid: '10001' })
    const original = tabs.create({ name: 'Page A', pageUid: '90001' })

    tabs.update(original.id, {
      name: 'Page A',
      pageUid: '90001',
      rotation: {
        postsPerAccount: 2,
        postDelayMinSeconds: 60,
        postDelayMaxSeconds: 90,
        accountDelayMinSeconds: 120,
        accountDelayMaxSeconds: 180
      },
      accounts: [{ accountId: account.id, enabled: true, sortOrder: 0, postsPerTurn: null }],
      schedules: [{ dayOfWeek: 2, startMinute: 540, endMinute: 720, enabled: true, sortOrder: 0 }],
      groupUids: ['g1', 'g2'],
      contentMode: 'sequential',
      contents: ['hello'],
      image: { folderPath: 'D:\\images', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    })

    const copy = tabs.duplicate(original.id)
    expect(copy.id).not.toBe(original.id)
    expect(copy.name).toBe('Page A Copy')
    expect(copy.pageUid).toBe('90001')
    expect(copy.accounts.map((item) => item.accountId)).toEqual([account.id])
    expect(copy.groupUids).toEqual(['g1', 'g2'])
    expect(copy.contents).toEqual(['hello'])
    expect(tabs.list()).toHaveLength(2)

    expect(tabs.delete(original.id)).toBe(true)
    expect(tabs.get(original.id)).toBeNull()
    expect(tabs.get(copy.id)?.accounts[0]?.accountId).toBe(account.id)

    runtime.close()
  })

  it('allows disabled schedule drafts but still rejects invalid enabled windows', () => {
    const runtime = createRuntime()
    const tabs = new PageTabRepository(runtime.client)
    const tab = tabs.create({ name: 'Page A', pageUid: '90001' })

    const baseConfig = {
      name: 'Page A',
      pageUid: '90001',
      rotation: {
        postsPerAccount: 1,
        postDelayMinSeconds: 1,
        postDelayMaxSeconds: 2,
        accountDelayMinSeconds: 1,
        accountDelayMaxSeconds: 2
      },
      accounts: [],
      groupUids: [],
      contentMode: 'sequential' as const,
      contents: [],
      image: { folderPath: '', mode: 'sequential' as const, imagesPerPost: 1, missingPolicy: 'text_only' as const }
    }

    const saved = tabs.update(tab.id, {
      ...baseConfig,
      schedules: [{ dayOfWeek: 1, startMinute: 600, endMinute: 600, enabled: false, sortOrder: 0 }]
    })
    expect(saved.schedules[0]).toMatchObject({ startMinute: 600, endMinute: 600, enabled: false })

    expect(() => tabs.update(tab.id, {
      ...baseConfig,
      schedules: [{ dayOfWeek: 1, startMinute: 600, endMinute: 600, enabled: true, sortOrder: 0 }]
    })).toThrow('Khung giờ phải có giờ kết thúc sau giờ bắt đầu')

    runtime.close()
  })

  it('rejects invalid delay windows and missing account references', () => {
    const runtime = createRuntime()
    const tabs = new PageTabRepository(runtime.client)
    const tab = tabs.create({ name: 'Page A', pageUid: '90001' })

    expect(() => tabs.update(tab.id, {
      name: 'Page A',
      pageUid: '90001',
      rotation: {
        postsPerAccount: 1,
        postDelayMinSeconds: 300,
        postDelayMaxSeconds: 100,
        accountDelayMinSeconds: 1,
        accountDelayMaxSeconds: 2
      },
      accounts: [],
      schedules: [],
      groupUids: [],
      contentMode: 'sequential',
      contents: [],
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    })).toThrow('Delay bài tối thiểu')

    expect(() => tabs.update(tab.id, {
      name: 'Page A',
      pageUid: '90001',
      rotation: {
        postsPerAccount: 1,
        postDelayMinSeconds: 1,
        postDelayMaxSeconds: 2,
        accountDelayMinSeconds: 1,
        accountDelayMaxSeconds: 2
      },
      accounts: [{ accountId: 999, enabled: true, sortOrder: 0, postsPerTurn: null }],
      schedules: [],
      groupUids: [],
      contentMode: 'sequential',
      contents: [],
      image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    })).toThrow('không còn tồn tại')

    runtime.close()
  })
})
