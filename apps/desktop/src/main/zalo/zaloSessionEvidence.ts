import type { ZaloSessionStatus } from '../../shared/zalo'

export interface ZaloSessionEvidence {
  authenticatedShell: boolean
  loginSurface: boolean
  qrSurface: boolean
  attentionSurface: boolean
}

export interface WaitForZaloSessionOptions {
  timeoutMs: number
  pollIntervalMs?: number
  sleep?: (delayMs: number) => Promise<void>
}

/** Conservative classifier: only explicit authenticated shell evidence may become ready. */
export function classifyZaloSessionEvidence(evidence: ZaloSessionEvidence): ZaloSessionStatus {
  if (evidence.authenticatedShell) return 'ready'
  if (evidence.attentionSurface) return 'needs_attention'
  if (evidence.qrSurface) return 'qr_waiting'
  if (evidence.loginSurface) return 'login_required'
  return 'needs_attention'
}

export async function waitForZaloSessionState(
  inspect: () => Promise<ZaloSessionEvidence>,
  options: WaitForZaloSessionOptions
): Promise<ZaloSessionStatus> {
  const timeoutMs = Math.max(0, options.timeoutMs)
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 500)
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)))
  const deadline = Date.now() + timeoutMs
  let status = classifyZaloSessionEvidence(await inspect())

  while ((status === 'login_required' || status === 'qr_waiting') && Date.now() < deadline) {
    await sleep(pollIntervalMs)
    status = classifyZaloSessionEvidence(await inspect())
  }

  return status
}
