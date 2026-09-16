import type { ZaloSessionStatus } from '../../shared/zalo'

export interface ZaloSessionEvidence {
  authenticatedShell: boolean
  loginSurface: boolean
  qrSurface: boolean
  attentionSurface: boolean
}

/** Conservative classifier: only explicit authenticated shell evidence may become ready. */
export function classifyZaloSessionEvidence(evidence: ZaloSessionEvidence): ZaloSessionStatus {
  if (evidence.authenticatedShell) return 'ready'
  if (evidence.attentionSurface) return 'needs_attention'
  if (evidence.qrSurface) return 'qr_waiting'
  if (evidence.loginSurface) return 'login_required'
  return 'needs_attention'
}
