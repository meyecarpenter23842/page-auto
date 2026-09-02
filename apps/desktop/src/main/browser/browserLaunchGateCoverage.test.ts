import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function mainSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'src/main', relativePath), 'utf8')
}

describe('global browser launch gate coverage', () => {
  it('keeps broker installation safe when the Electron test shim has no utilityProcess', () => {
    const broker = mainSource('browser/browserLaunchBroker.ts')
    expect(broker).toContain("if (!utilityProcess || typeof utilityProcess.fork !== 'function') return")
  })

  it('keeps launch-queue time outside operation budgets on every Main launch path', () => {
    const launchOwners = [
      'browser/postingWorkerManager.ts',
      'browser/scenarioActionWorkerManager.ts',
      'browser/browserEngineService.ts',
      'browser/browserProfileManager.ts',
      'email/emailBrowserManager.ts',
      'email/emailProxyTester.ts'
    ]

    for (const path of launchOwners) {
      expect(mainSource(path), path).toContain('setBrowserLaunchAwareTimeout')
    }
  })

  it('loads the common browser-runtime permit hook for both Email Chromium entrypoints', () => {
    expect(mainSource('email/emailBrowserLifecycle.ts')).toContain("import '../browser/browserRuntime'")
    expect(mainSource('email/email-proxy-test-worker.ts')).toContain("import '../browser/browserRuntime'")
    expect(mainSource('email/email-browser-worker.ts')).toContain("from './emailBrowserLifecycle'")
  })
})
