import type { RotationPageTabPayload, RotationRuntimeSnapshot } from '../../shared/rotation'

export interface PageTabRotationController {
  start(payload: RotationPageTabPayload): RotationRuntimeSnapshot
  status(payload: RotationPageTabPayload): RotationRuntimeSnapshot
  pause(payload: RotationPageTabPayload): RotationRuntimeSnapshot
  resume(payload: RotationPageTabPayload): RotationRuntimeSnapshot
  dispose(): void
}

export type PageTabRotationControllerFactory = (pageTabId: number) => PageTabRotationController

function isMissingRotationSession(error: unknown): boolean {
  return error instanceof Error && /chưa có Account Rotation đang hoạt động/i.test(error.message)
}

export class PageTabWorkerManager {
  private readonly controllers = new Map<number, PageTabRotationController>()

  constructor(private readonly createController: PageTabRotationControllerFactory) {}

  list(pageTabIds: number[]): RotationRuntimeSnapshot[] {
    return pageTabIds.map((pageTabId) => this.status({ pageTabId }))
  }

  status(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    return this.getOrCreate(payload.pageTabId).status(payload)
  }

  start(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    return this.getOrCreate(payload.pageTabId).start(payload)
  }

  pause(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    return this.getOrCreate(payload.pageTabId).pause(payload)
  }

  resume(payload: RotationPageTabPayload): RotationRuntimeSnapshot {
    const controller = this.getOrCreate(payload.pageTabId)
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

  private getOrCreate(pageTabId: number): PageTabRotationController {
    const existing = this.controllers.get(pageTabId)
    if (existing) return existing
    const controller = this.createController(pageTabId)
    this.controllers.set(pageTabId, controller)
    return controller
  }
}
