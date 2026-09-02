export type BrowserLaunchPermitRequestMessage = {
  type: 'browser_launch_permit_request'
  requestId: string
}

export type BrowserLaunchPermitResultMessage = {
  type: 'browser_launch_permit_result'
  requestId: string
  status: 'granted' | 'failed'
  message?: string
}

export function browserLaunchPermitPayload(event: unknown): unknown {
  return event && typeof event === 'object' && 'data' in event
    ? (event as { data?: unknown }).data
    : event
}

export function isBrowserLaunchPermitRequest(
  event: unknown
): event is BrowserLaunchPermitRequestMessage {
  const payload = browserLaunchPermitPayload(event)
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Partial<BrowserLaunchPermitRequestMessage>
  return candidate.type === 'browser_launch_permit_request'
    && typeof candidate.requestId === 'string'
    && candidate.requestId.length > 0
}

export function isBrowserLaunchPermitResult(
  event: unknown
): event is BrowserLaunchPermitResultMessage {
  const payload = browserLaunchPermitPayload(event)
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Partial<BrowserLaunchPermitResultMessage>
  return candidate.type === 'browser_launch_permit_result'
    && typeof candidate.requestId === 'string'
    && candidate.requestId.length > 0
    && (candidate.status === 'granted' || candidate.status === 'failed')
}
