import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workerSource = readFileSync(new URL('./change-info-audit-worker.ts', import.meta.url), 'utf8')
const ipcSource = readFileSync(new URL('../changeInfoAuditIpc.ts', import.meta.url), 'utf8')

describe('Change Info Bio live audit harness', () => {
  it('opens only the audited Bio editor trigger and collects semantic evidence without mutation', () => {
    expect(workerSource).toContain('https://www.facebook.com/me?sk=about_details')
    expect(workerSource).toContain('collectBioEvidence')
    expect(workerSource).toContain('openAuditedBioEditor')
    expect(workerSource).toContain("getByRole('tab', { name: 'Details about you', exact: true })")
    expect(workerSource).toContain("getByRole('button', { name: 'Write some details about yourself', exact: true })")
    expect(workerSource).toContain('await trigger.click()')
    expect(workerSource).toContain('page.screenshot')
    expect(workerSource).toContain('bio-editor-audit.png')
    expect(workerSource).toContain('relevantControls')
    expect(workerSource).toContain('relevantRegions')
    expect(workerSource).not.toMatch(/\.fill\s*\(/)
    expect(workerSource).not.toMatch(/\.press\s*\(/)
    expect(workerSource).not.toMatch(/\.type\s*\(/)
    expect(workerSource).not.toMatch(/\.setInputFiles\s*\(/)
    expect(workerSource).not.toMatch(/getByRole\(['"]button['"][\s\S]{0,160}(?:Save|Lưu)[\s\S]{0,160}\.click\s*\(/i)
  })

  it('uses canonical account hydration and the app-wide account lease', () => {
    expect(ipcSource).toContain('FacebookCommonSessionPolicy')
    expect(ipcSource).toContain('sessionPolicy.hydrateScenarioActionJob(baseJob)')
    expect(ipcSource).toContain('AccountExecutionCoordinator')
    expect(ipcSource).toContain('accountExecution.run(account.id')
    expect(ipcSource).toContain("actionType: '__change_info_audit_bio__'")
  })
})
