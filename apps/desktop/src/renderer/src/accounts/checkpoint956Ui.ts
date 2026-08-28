import type { FacebookCheckpoint282State } from '../../../shared/facebookCheckpoint'

export type Checkpoint956UiState = FacebookCheckpoint282State | 'pending' | 'running'

export function shouldPauseCheckpoint956Sequence(state: FacebookCheckpoint282State): boolean {
  return state === 'waiting_manual'
    || state === 'needs_login'
    || state === 'stopped'
    || state === 'error'
}

export function canRecheckCheckpoint956(state: Checkpoint956UiState): boolean {
  return state === 'waiting_manual' || state === 'needs_login' || state === 'error'
}

export function checkpoint956StateLabel(state: Checkpoint956UiState): string {
  switch (state) {
    case 'pending': return 'Chờ chạy'
    case 'running': return 'Đang chạy'
    case 'resolved': return 'Đã xác minh'
    case 'waiting_manual': return 'Chờ thao tác'
    case 'different_checkpoint': return 'Khác CP956'
    case 'needs_login': return 'Cần đăng nhập'
    case 'stopped': return 'Đã dừng'
    case 'error': return 'Lỗi · thử lại'
  }
}
