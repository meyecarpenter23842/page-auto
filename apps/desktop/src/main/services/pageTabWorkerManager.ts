import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import type { RotationPageTabPayload, RotationRuntimeSnapshot, RotationRuntimeStatus } from '../../shared/rotation'

export interface PageTabRotationController {
  start(payload: RotationPageTabPayload): RotationRuntimeSnapshot
  status(payload: RotationPageTabPayload): RotationRuntimeSnapshot
  pause(payload: RotationPageTabPayload): RotationRuntimeSnapshot
  resume(payload: RotationPageTabPayload): RotationRuntimeSnapshot
  stop(payload: RotationPageTabPayload): RotationRuntimeSnapshot
  dispose(): void
}

export type PageTabRotationControllerFactory = (pageTabId: number) => PageTabRotationController

function isMissingRotationSession(error: unknown): boolean {
  return error instanceof Error && /chưa có Account Rotation đang hoạt động|chưa có vòng chạy tài khoản đang hoạt động/i.test(error.message)
}

function isActiveStatus(status: RotationRuntimeStatus): boolean {
  return status === 'starting' || status === 'running' || status === 'waiting_window' || status === 'stopping'
}

function diagnostic(pageTabId: number, message: string): void {
  console.info(`[PAGE-AUTO scheduler] tab=${pageTabId} ${message}`)
}

export class PageTabWorkerManager {
  private readonly controllers = new Map<number, PageTabRotationController>()

  constructor(
    private readonly createController: PageTabRotationControllerFactory,
    private readonly getMaxActivePageTabs: () => number = () => DEFAULT_APP_SETTINGS.runtime.maxActivePageTabs
  ) {}

  list(pageTabIds: number[]): RotationRuntimeSnapshot[] {
    return pageTabIds.map((pageTabId) => this.status({ pageTabId }))
  }

  status(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    return this.getOrCreate(payload.pageTabId).status(payload)
  }

  start(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    diagnostic(payload.pageTabId, 'START requested')
    try {
      this.assertCapacity(payload.pageTabId)
      const snapshot = this.getOrCreate(payload.pageTabId).start(payload)
      diagnostic(payload.pageTabId, `START accepted status=${snapshot.status} run=${snapshot.runId ?? 'none'}`)
      return snapshot
    } catch (error) {
      diagnostic(payload.pageTabId, `START rejected type=${error instanceof Error ? error.name : typeof error}`)
      throw error
    }
  }

  pause(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    diagnostic(payload.pageTabId, 'PAUSE requested')
    try {
      const snapshot = this.getOrCreate(payload.pageTabId).pause(payload)
      diagnostic(payload.pageTabId, `PAUSE accepted status=${snapshot.status} run=${snapshot.runId ?? 'none'}`)
      return snapshot
    } catch (error) {
      diagnostic(payload.pageTabId, `PAUSE rejected type=${error instanceof Error ? error.name : typeof error}`)
      throw error
    }
  }

  resume(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    diagnostic(payload.pageTabId, 'RESUME requested')
    this.assertCapacity(payload.pageTabId)
    const controller = this.getOrCreate(payload.pageTabId)
    const current = controller.status(payload)
    diagnostic(payload.pageTabId, `RESUME current status=${current.status} run=${current.runId ?? 'none'}`)

    if (current.status === 'completed') {
      const snapshot = controller.start(payload)
      diagnostic(payload.pageTabId, `RESUME created fresh run status=${snapshot.status} run=${snapshot.runId ?? 'none'}`)
      return snapshot
    }

    try {
      const snapshot = controller.resume(payload)
      diagnostic(payload.pageTabId, `RESUME accepted status=${snapshot.status} run=${snapshot.runId ?? 'none'}`)
      return snapshot
    } catch (error) {
      if (!isMissingRotationSession(error)) {
        diagnostic(payload.pageTabId, `RESUME rejected type=${error instanceof Error ? error.name : typeof error}`)
        throw error
      }
      diagnostic(payload.pageTabId, 'RESUME missing runtime session; falling back to START')
      const snapshot = controller.start(payload)
      diagnostic(payload.pageTabId, `RESUME fallback START status=${snapshot.status} run=${snapshot.runId ?? 'none'}`)
      return snapshot
    }
  }

  stop(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    diagnostic(payload.pageTabId, 'STOP requested')
    try {
      const snapshot = this.getOrCreate(payload.pageTabId).stop(payload)
      diagnostic(payload.pageTabId, `STOP accepted status=${snapshot.status} run=${snapshot.runId ?? 'none'}`)
      return snapshot
    } catch (error) {
      diagnostic(payload.pageTabId, `STOP rejected type=${error instanceof Error ? error.name : typeof error}`)
      throw error
    }
  }

  dispose(): void {
    for (const controller of this.controllers.values()) controller.dispose()
    this.controllers.clear()
  }

  private assertCapacity(pageTabId: number): void {
    const target = this.controllers.get(pageTabId)
    if (target && isActiveStatus(target.status({ pageTabId }).status)) return

    let activeCount = 0
    for (const [id, controller] of this.controllers) {
      if (id === pageTabId) continue
      if (isActiveStatus(controller.status({ pageTabId: id }).status)) activeCount += 1
    }

    const limit = Math.max(1, Math.round(this.getMaxActivePageTabs()))
    if (activeCount >= limit) {
      throw new Error(`Đã đạt giới hạn ${limit} Page Tab hoạt động đồng thời. Hãy pause một tab hoặc tăng giới hạn trong Cài đặt > Vận hành.`)
    }
  }

  private getOrCreate(pageTabId: number): PageTabRotationController {
    const existing = this.controllers.get(pageTabId)
    if (existing) return existing
    const controller = this.createController(pageTabId)
    this.controllers.set(pageTabId, controller)
    return controller
  }
}
