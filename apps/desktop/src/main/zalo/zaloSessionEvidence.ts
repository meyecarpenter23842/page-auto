import type { ZaloSessionStatus } from '../../shared/zalo'

export interface ZaloSessionEvidence {
  authenticatedShell: boolean
  loginSurface: boolean
  qrSurface: boolean
  attentionSurface: boolean
  /** Visible search surface from the authenticated chat workspace. */
  chatSearchSurface?: boolean
  /** Visible message composer from an already opened authenticated conversation. */
  composerSurface?: boolean
}

export interface WaitForZaloSessionOptions {
  timeoutMs: number
  pollIntervalMs?: number
  sleep?: (delayMs: number) => Promise<void>
}

/**
 * Conservative classifier:
 * - explicit challenge/login/QR surfaces win over generic app-shell hints;
 * - ready requires authenticated workspace evidence such as the chat search/composer shell;
 * - an otherwise unknown DOM never becomes ready.
 */
export function classifyZaloSessionEvidence(evidence: ZaloSessionEvidence): ZaloSessionStatus {
  if (evidence.attentionSurface) return 'needs_attention'
  if (evidence.qrSurface) return 'qr_waiting'
  if (evidence.loginSurface) return 'login_required'
  if (evidence.authenticatedShell || evidence.chatSearchSurface || evidence.composerSurface) return 'ready'
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

  let evidence = await inspect()
  let status = classifyZaloSessionEvidence(evidence)

  while (Date.now() < deadline) {
    if (status === 'ready' || evidence.attentionSurface) return status

    const transientUnknown = status === 'needs_attention' && !evidence.attentionSurface
    const waitingLoginTransition = status === 'login_required' || status === 'qr_waiting'
    if (!transientUnknown && !waitingLoginTransition) return status

    await sleep(pollIntervalMs)
    evidence = await inspect()
    status = classifyZaloSessionEvidence(evidence)
  }

  return status
}
