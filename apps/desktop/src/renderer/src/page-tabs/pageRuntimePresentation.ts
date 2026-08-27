import type { PostingCheckpointKind } from '../../../shared/posting'
import type {
  RotationAccountRuntimeStatus,
  RotationRuntimeSnapshot,
  RotationRuntimeStatus
} from '../../../shared/rotation'
import './pageRuntimePresentation.css'

const ACCOUNT_RUNTIME_LABELS: Record<RotationAccountRuntimeStatus, string> = {
  not_run: 'Chưa chạy',
  completed_turn: 'Đã chạy lượt',
  running: 'Đang chạy',
  error: 'Lỗi',
  waiting: 'Chờ'
}

const CHECKPOINT_RUNTIME_LABELS: Record<PostingCheckpointKind, string> = {
  '282': 'Checkpoint 282',
  '956': 'Checkpoint 956',
  unknown: 'Checkpoint không xác định'
}

const ROTATION_RUNTIME_LABELS: Record<RotationRuntimeStatus, string> = {
  idle: 'Chưa chạy',
  starting: 'Đang khởi động',
  running: 'Đang chạy',
  paused: 'Tạm dừng',
  waiting_window: 'Chờ lịch',
  stopping: 'Đang dừng',
  stopped: 'Đã dừng',
  completed: 'Hoàn tất',
  error: 'Lỗi'
}

export function accountRuntimeLabel(
  status: RotationAccountRuntimeStatus,
  checkpointKind?: PostingCheckpointKind
): string {
  if (status === 'error' && checkpointKind) return CHECKPOINT_RUNTIME_LABELS[checkpointKind]
  return ACCOUNT_RUNTIME_LABELS[status]
}

export function rotationRuntimeLabel(status: RotationRuntimeStatus): string {
  return ROTATION_RUNTIME_LABELS[status]
}

export function indexRotationRuntimes(runtimes: RotationRuntimeSnapshot[]): Record<number, RotationRuntimeSnapshot> {
  return Object.fromEntries(runtimes.map((runtime) => [runtime.pageTabId, runtime]))
}

export function activeRuntimeForPage(
  runtimeByTab: Record<number, RotationRuntimeSnapshot>,
  pageTabId: number | null
): RotationRuntimeSnapshot | null {
  return pageTabId === null ? null : runtimeByTab[pageTabId] ?? null
}

export function runtimeProgressLabel(
  runtime: Pick<RotationRuntimeSnapshot, 'slotsCompletedThisTurn' | 'targetSlotsThisTurn'> | null
): string | null {
  if (!runtime || runtime.targetSlotsThisTurn <= 0) return null
  const completed = Math.max(0, Math.min(runtime.slotsCompletedThisTurn, runtime.targetSlotsThisTurn))
  return `${completed}/${runtime.targetSlotsThisTurn}`
}

export function runtimeEmptyPreviewMessage(
  runtime: Pick<RotationRuntimeSnapshot, 'status' | 'message'> | null
): string {
  if (!runtime || runtime.status === 'idle') {
    return 'Chưa có bài đang xử lý. Khi worker chọn Group + nội dung + ảnh, preview sẽ hiện tại đây.'
  }
  if (runtime.status === 'starting') return runtime.message ?? 'Đang khởi động phiên và chuẩn bị tài khoản đầu tiên.'
  if (runtime.status === 'paused') return 'Phiên đang tạm dừng; chưa có bài nào đang được worker xử lý.'
  if (runtime.status === 'waiting_window') return runtime.message ?? 'Đang chờ khung giờ chạy tiếp theo.'
  if (runtime.status === 'stopping') return 'Đang dừng phiên; không chuẩn bị bài mới.'
  if (runtime.status === 'stopped') return 'Phiên đã dừng. Preview runtime đã được làm sạch.'
  if (runtime.status === 'completed') return 'Phiên đã hoàn tất. Không còn bài đang xử lý.'
  if (runtime.status === 'error') return runtime.message ?? 'Phiên đang lỗi; không có bài đang xử lý.'
  return runtime.message ?? 'Worker đang chuẩn bị Group, nội dung hoặc ảnh cho bài tiếp theo.'
}
