import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./legacyIndex.ts', import.meta.url), 'utf8')

describe('Electron single-instance startup guard', () => {
  it('acquires the Electron single-instance lock before application initialization', () => {
    const lockIndex = source.indexOf('app.requestSingleInstanceLock()')
    const readyIndex = source.indexOf('app.whenReady().then(')

    expect(lockIndex).toBeGreaterThan(0)
    expect(readyIndex).toBeGreaterThan(lockIndex)
    expect(source).toContain('if (!singleInstanceLockAcquired) {')
    expect(source).toContain('app.quit()')
    expect(source).toContain('if (!singleInstanceLockAcquired) return')
  })

  it('focuses the existing window when a second PageAuto launch is attempted', () => {
    expect(source).toContain("app.on('second-instance'")
    expect(source).toContain('if (mainWindow.isMinimized()) mainWindow.restore()')
    expect(source).toContain('if (!mainWindow.isVisible()) mainWindow.show()')
    expect(source).toContain('mainWindow.focus()')
  })
})
