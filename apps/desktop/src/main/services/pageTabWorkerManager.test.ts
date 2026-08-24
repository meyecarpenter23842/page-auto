import { describe, expect, it } from 'vitest'
import type { RotationRuntimeSnapshot } from '../../shared/rotation'
import { PageTabWorkerManager, type PageTabRotationController } from './pageTabWorkerManager'

function snapshot(pageTabId: number, status: RotationRuntimeSnapshot['status'] = 'idle'): RotationRuntimeSnapshot {
  return { pageTabId, runId: pageTabId * 10, status, currentAccountId: null, currentAccountIndex: null, slotsCompletedThisTurn: 0, targetSlotsThisTurn: 0, cycle: 0, nextActionAt: null, message: null, lastResult: null, run: null }
}
class FakeController implements PageTabRotationController {
  state: RotationRuntimeSnapshot
  startCalls = 0
  resumeCalls = 0
  stopCalls = 0
  constructor(readonly pageTabId: number) { this.state = snapshot(pageTabId) }
  start() { this.startCalls += 1; this.state = snapshot(this.pageTabId, 'running'); return this.state }
  status() { return this.state }
  pause() { this.state = { ...this.state, status: 'paused' }; return this.state }
  resume() { this.resumeCalls += 1; this.state = { ...this.state, status: 'running' }; return this.state }
  stop() { this.stopCalls += 1; this.state = { ...this.state, status: 'stopped' }; return this.state }
  dispose() {}
}

class RestartedController extends FakeController {
  private hasSession = false
  override start() { this.hasSession = true; return super.start() }
  override resume() {
    if (!this.hasSession) throw new Error(`Page Tab #${this.pageTabId} chưa có Account Rotation đang hoạt động.`)
    return super.resume()
  }
}

describe('PageTabWorkerManager', () => {
  it('keeps Page A and Page B independent while each tab owns only one controller', () => {
    let created = 0
    const manager = new PageTabWorkerManager((pageTabId) => { created += 1; return new FakeController(pageTabId) })
    manager.start({ pageTabId: 10 })
    manager.start({ pageTabId: 20 })
    expect(manager.list([10, 20]).map((item) => item.status)).toEqual(['running', 'running'])
    manager.pause({ pageTabId: 10 })
    expect(manager.status({ pageTabId: 10 }).status).toBe('paused')
    expect(manager.status({ pageTabId: 20 }).status).toBe('running')
    manager.status({ pageTabId: 10 })
    expect(created).toBe(2)
  })

  it('enforces max active Page Tabs and frees capacity when a tab is paused', () => {
    const manager = new PageTabWorkerManager((pageTabId) => new FakeController(pageTabId), () => 2)
    manager.start({ pageTabId: 10 })
    manager.start({ pageTabId: 20 })

    expect(() => manager.start({ pageTabId: 30 })).toThrow(/giới hạn 2 Page Tab/i)
    manager.pause({ pageTabId: 10 })
    expect(manager.start({ pageTabId: 30 }).status).toBe('running')
  })

  it('does not count a tab twice when Start is pressed again while it is already active', () => {
    const manager = new PageTabWorkerManager((pageTabId) => new FakeController(pageTabId), () => 1)
    expect(manager.start({ pageTabId: 10 }).status).toBe('running')
    expect(manager.start({ pageTabId: 10 }).status).toBe('running')
    expect(() => manager.resume({ pageTabId: 20 })).toThrow(/giới hạn 1 Page Tab/i)
  })

  it('recreates an in-memory rotation session when resuming a paused run after app restart', () => {
    const manager = new PageTabWorkerManager((pageTabId) => new RestartedController(pageTabId))
    expect(manager.resume({ pageTabId: 10 }).status).toBe('running')
    expect(manager.status({ pageTabId: 10 }).status).toBe('running')
  })

  it('starts a fresh run when Resume is clicked after the previous run completed', () => {
    const controller = new FakeController(10)
    controller.state = snapshot(10, 'completed')
    const manager = new PageTabWorkerManager(() => controller)

    expect(manager.resume({ pageTabId: 10 }).status).toBe('running')
    expect(controller.startCalls).toBe(1)
    expect(controller.resumeCalls).toBe(0)
  })

  it('exposes Stop separately from Pause and moves the tab to stopped', () => {
    const controller = new FakeController(10)
    controller.state = snapshot(10, 'running')
    const manager = new PageTabWorkerManager(() => controller)

    expect(manager.stop({ pageTabId: 10 }).status).toBe('stopped')
    expect(controller.stopCalls).toBe(1)
  })
})
