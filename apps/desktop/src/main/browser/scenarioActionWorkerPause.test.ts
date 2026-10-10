import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const protocolSource = readFileSync(new URL('../../shared/scenarioActionWorker.ts', import.meta.url), 'utf8')
const managerSource = readFileSync(new URL('./scenarioActionWorkerManager.ts', import.meta.url), 'utf8')
const workerSource = readFileSync(new URL('./scenario-action-worker.ts', import.meta.url), 'utf8')

describe('Scenario action worker cooperative pause/resume', () => {
  it('keeps pause/resume in the typed worker protocol and manager control surface', () => {
    expect(protocolSource).toContain("type: 'pause'; runKey: string")
    expect(protocolSource).toContain("type: 'resume'; runKey: string")
    expect(managerSource).toContain('pause(accountId: number, runKey: string): void')
    expect(managerSource).toContain('resume(accountId: number, runKey: string): void')
    expect(managerSource).toContain("postMessage({ type: 'pause', runKey })")
    expect(managerSource).toContain("postMessage({ type: 'resume', runKey })")
  })

  it('does not consume worker runtime timeout while paused', () => {
    expect(managerSource).toContain('remainingTimeoutMs')
    expect(managerSource).toContain('this.pauseTimeout(entry.pending)')
    expect(managerSource).toContain('pending.remainingTimeoutMs = Math.max(1, pending.remainingTimeoutMs - elapsed)')
    expect(managerSource).toContain('this.armTimeout(entry)')
  })

  it('uses cooperative pause points inside the action worker and releases pause on stop', () => {
    expect(workerSource).toContain('const pausedRunKeys = new Set<string>()')
    expect(workerSource).toContain('waitIfPaused: () => waitIfRunPaused(job.request.runKey)')
    expect(workerSource).toContain('sleep: (delayMs) => sleepWithRunControl(job.request.runKey, delayMs)')
    expect(workerSource).toContain("if (payload.type === 'pause')")
    expect(workerSource).toContain("if (payload.type === 'resume')")
    expect(workerSource).toContain("if (payload.type === 'stop')")
    expect(workerSource).toContain('pausedRunKeys.delete(payload.runKey)')
  })
})
