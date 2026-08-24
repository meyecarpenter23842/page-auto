import { DEFAULT_APP_SETTINGS } from '../../shared/appSettings'
import type { RotationPageTabPayload, RotationRuntimeSnapshot, RotationRuntimeStatus } from '../../shared/rotation'

export interface PageTabRotationController {
  start(payload: RotationPageTabPayload): RotationRuntimeSnapshot
  status(payload: RotationPageTabPayload): RotationRuntimeSnapshot
  pause(payload: RotationPageTabPayload): RotationRuntimeSnapshot
  resume(payload: RotationPageTabPayload): RotationRuntimeSnapshot
  dispose(): void
}

export type PageTabRotationControllerFactory = (pageTabId: number) => PageTabRotationController

function isMissingRotationSession(error: unknown): boolean {
  return error instanceof Error && /chưa có Account Rotation đang hoạt động|chưa có vòng chạy tài khoản đang hoạt động/i.test(error.message)
}

function isActiveStatus(status: RotationRuntimeStatus): boolean {
  return status === 'starting' || status === 'running' || status === 'waiting_window'
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
    this.assertCapacity(payload.pageTabId)
    return this.getOrCreate(payload.pageTabId).start(payload)
  }

  pause(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    return this.getOrCreate(payload.pageTabId).pause(payload)
  }

  resume(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    this.assertCapacity(payload.pageTabId)
    const controller = this.getOrCreate(payload.pageTabId)
    const current = controller.status(payload)

    // Resume is the operator's "run this tab again" action. A completed run has no
    // pending items left, so create a fresh run from the current Page Tab config and
    // original Group Set instead of silently returning `completed` forever.
    if (current.status === 'completed') return controller.start(payload)

    try {
      return controller.resume(payload)
    } catch (error) {
      if (!isMissingRotationSession(error)) throw error
      return controller.start(payload)
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
