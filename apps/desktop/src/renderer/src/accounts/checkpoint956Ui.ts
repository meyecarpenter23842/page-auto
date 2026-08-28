import type { FacebookCheckpoint282State } from '../../../shared/facebookCheckpoint'

export type Checkpoint956UiState = FacebookCheckpoint282State | 'pending' | 'running'

/**
 * CP956 batch is account-isolated. Waiting/attention/error rows stay visible but
 * do not block later accounts; only an explicit Stop ends the current sequence.
 */
export function shouldPauseCheckpoint956Sequence(state: FacebookCheckpoint282State): boolean {
  return state === 'stopped'
}

export function canRecheckCheckpoint956(state: Checkpoint956UiState): boolean {
  return state === 'waiting'
    || state === 'needs_attention'
    || state === 'needs_login'
    || state === 'checkpoint_timeout'
    || state === 'error'
}

export function checkpoint956StateLabel(state: Checkpoint956UiState): string {
  switch (state) {
    case 'pending': return 'Chờ chạy'
    case 'running': return 'Đang chạy'
    case 'resolved': return 'Đã xác minh'
    case 'waiting': return 'Đang chờ'
    case 'needs_attention': return 'Cần xử lý'
    case 'checkpoint_timeout': return 'Hết thời gian giữ'
    case 'waiting_manual': return 'Chờ thao tác'
    case 'different_checkpoint': return 'Challenge khác'
    case 'needs_login': return 'Cần đăng nhập'
    case 'stopped': return 'Đã dừng'
    case 'error': return 'Lỗi · thử lại'
  }
}
