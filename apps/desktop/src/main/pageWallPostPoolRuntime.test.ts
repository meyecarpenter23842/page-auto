import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const runtime = readFileSync(
  fileURLToPath(new URL('./pageWallFiniteIpc.ts', import.meta.url)),
  'utf8'
)

describe('Page Wall schedule post-pool runtime contract', () => {
  it('resolves one pool post per occurrence before materializing all account jobs', () => {
    expect(runtime).toContain('const pooledSource = pool')
    expect(runtime).toContain('selectPageWallSchedulePost(pool, plans.countScheduleGroupOccurrencesBefore(pool.groupKey, scheduledAt))')
    expect(runtime).toContain('sourcePayload(plan.pageTabId, task.accountId, pooledSource ?? task.source)')
  })

  it('materializes due slots chronologically so sequential rotation follows clock order', () => {
    expect(runtime).toContain("ORDER BY minute_of_day, id")
  })

  it('keeps a stable group key when editing and stores pool metadata on every slot', () => {
    expect(runtime).toContain('existingGroupKeys.length === 1 ? existingGroupKeys[0]!')
    expect(runtime).toContain('plans.saveSchedulePostPool(record.id')
    expect(runtime).toContain('slotOrder: index')
  })

  it('exposes persisted pool metadata to the renderer dashboard', () => {
    expect(runtime).toContain('postPool: plans.getSchedulePostPool(plan.id)')
  })
})
