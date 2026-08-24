import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from './index'
import { PageTabRepository } from './pageTabRepository'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createRuntime() {
  const directory = mkdtempSync(join(tmpdir(), 'page-auto-schedule-overlap-'))
  tempDirectories.push(directory)
  return initializeDatabase(join(directory, 'page-auto.sqlite'))
}

describe('PageTabRepository schedule overlap validation', () => {
  it('rejects overlapping enabled windows but allows disabled overlap and adjacent windows', () => {
    const runtime = createRuntime()
    const tabs = new PageTabRepository(runtime.client)
    const tab = tabs.create({ name: 'Page A', pageUid: '90001' })
    const base = {
      name: tab.name,
      pageUid: tab.pageUid,
      rotation: {
        postsPerAccount: 1,
        postDelayMinSeconds: 0,
        postDelayMaxSeconds: 0,
        accountDelayMinSeconds: 0,
        accountDelayMaxSeconds: 0,
        accountOrderMode: 'sequential' as const
      },
      accounts: [],
      groupUids: [],
      contentMode: 'sequential' as const,
      contents: [],
      image: { folderPath: '', mode: 'sequential' as const, imagesPerPost: 1, missingPolicy: 'text_only' as const }
    }

    expect(() => tabs.update(tab.id, {
      ...base,
      schedules: [
        { dayOfWeek: 1, startMinute: 420, endMinute: 720, enabled: true, sortOrder: 0 },
        { dayOfWeek: 1, startMinute: 660, endMinute: 900, enabled: true, sortOrder: 1 }
      ]
    })).toThrow('không được chồng lấn')

    const disabledOverlap = tabs.update(tab.id, {
      ...base,
      schedules: [
        { dayOfWeek: 1, startMinute: 420, endMinute: 720, enabled: true, sortOrder: 0 },
        { dayOfWeek: 1, startMinute: 660, endMinute: 900, enabled: false, sortOrder: 1 }
      ]
    })
    expect(disabledOverlap.schedules).toHaveLength(2)

    const adjacent = tabs.update(tab.id, {
      ...base,
      schedules: [
        { dayOfWeek: 1, startMinute: 420, endMinute: 720, enabled: true, sortOrder: 0 },
        { dayOfWeek: 1, startMinute: 720, endMinute: 900, enabled: true, sortOrder: 1 }
      ]
    })
    expect(adjacent.schedules.filter((schedule) => schedule.enabled)).toHaveLength(2)

    runtime.close()
  })
})
