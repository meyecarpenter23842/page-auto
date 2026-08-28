import type { FacebookCheckpoint282State } from '../../../shared/facebookCheckpoint'

export type Checkpoint282UiState = 'pending' | 'running' | FacebookCheckpoint282State

export function shouldPauseCheckpoint282Sequence(state: FacebookCheckpoint282State): boolean {
  return state === 'waiting_manual'
}

export function canRecheckCheckpoint282(state: Checkpoint282UiState): boolean {
  return state === 'waiting_manual'
}

export function checkpoint282StateLabel(state: Checkpoint282UiState): string {
  switch (state) {
    case 'pending': return 'Chờ chạy'
    case 'running': return 'Đang kiểm tra'
    case 'resolved': return 'Đã xác minh'
    case 'waiting_manual': return 'Chờ thao tác'
    case 'different_checkpoint': return 'CP khác'
    case 'needs_login': return 'Cần đăng nhập'
    case 'error': return 'Lỗi'
  }
}
