import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./changeInfoWorkspaceRunnerService.ts', import.meta.url), 'utf8')
const ipcSource = readFileSync(new URL('../changeInfoAuditIpc.ts', import.meta.url), 'utf8')
const preloadSource = readFileSync(new URL('../../preload/changeInfoBridge.ts', import.meta.url), 'utf8')

describe('Change Info workspace runtime orchestration', () => {
  it('uses the common rolling pool, global account lease and canonical scenario action worker', () => {
    expect(source).toContain('runRollingAccountPool')
    expect(source).toContain('this.accountExecution.tryAcquireLease(account.id)')
    expect(source).toContain('scenarioActionJobForCommonSessionPolicy')
    expect(source).toContain('this.workers.run(job')
    expect(source).toContain('retry: { maxAttempts: 1, delayMs: 0, retryableCodes: [] }')
    expect(source).toContain('await this.workers.closeAccount(account.id)')
  })

  it('injects the same shared browser placement contract before Change Info mutation workers launch', () => {
    expect(ipcSource).toContain('class ChangeInfoLayoutAwareWorkerManager extends FacebookSessionPolicyWorkerManager')
    expect(ipcSource).toContain('BrowserWindowLayoutManager')
    expect(ipcSource).toContain("this.browserWindowLayout.claim(job.accountId, 'scenario')")
    expect(ipcSource).toContain('this.browserWindowLayout.placementFor(')
    expect(ipcSource).toContain('browserPlacement ? { ...job, browserPlacement } : job')
    expect(ipcSource).toContain("this.browserWindowLayout.release(accountId, 'scenario')")
  })

  it('snapshots Data Source and records typed per-account/per-action results', () => {
    expect(source).toContain('snapshotOperations')
    expect(source).toContain("readFile(path, 'utf8')")
    expect(source).toContain('resolveChangeInfoDataSource')
    expect(source).toContain('runSeed: `${active.snapshot.runId}:${operation.catalog.key}`')
    expect(source).toContain('runtime.results.push(actionResult(')
    expect(source).toContain('ACTION_VERIFICATION_UNCERTAIN_CODE')
  })

  it('exposes start/status/pause/resume/stop through typed Change Info IPC', () => {
    for (const command of ['start', 'status', 'pause', 'resume', 'stop']) {
      expect(ipcSource).toContain(`CHANGE_INFO_RUNNER_IPC.${command}`)
      expect(preloadSource).toContain(`${command}: (payload: ChangeInfoWorkspaceRunPayload)`)
    }
  })
})
