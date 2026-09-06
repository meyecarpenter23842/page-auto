import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workerSource = readFileSync(new URL('./change-info-audit-worker.ts', import.meta.url), 'utf8')
const ipcSource = readFileSync(new URL('../changeInfoAuditIpc.ts', import.meta.url), 'utf8')

describe('Change Info Bio live audit harness', () => {
  it('collects semantic evidence on About Details without field mutation controls', () => {
    expect(workerSource).toContain('https://www.facebook.com/me?sk=about_details')
    expect(workerSource).toContain('collectBioEvidence')
    expect(workerSource).toContain('page.screenshot')
    expect(workerSource).toContain('relevantControls')
    expect(workerSource).toContain('relevantRegions')
    expect(workerSource).not.toMatch(/\.click\s*\(/)
    expect(workerSource).not.toMatch(/\.fill\s*\(/)
    expect(workerSource).not.toMatch(/\.press\s*\(/)
    expect(workerSource).not.toMatch(/\.setInputFiles\s*\(/)
  })

  it('uses canonical account hydration and the app-wide account lease', () => {
    expect(ipcSource).toContain('FacebookCommonSessionPolicy')
    expect(ipcSource).toContain('sessionPolicy.hydrateScenarioActionJob(baseJob)')
    expect(ipcSource).toContain('AccountExecutionCoordinator')
    expect(ipcSource).toContain('accountExecution.run(account.id')
    expect(ipcSource).toContain("actionType: '__change_info_audit_bio__'")
  })
})
