export type SettingsSection = 'appearance' | 'update' | 'browser' | 'slots' | 'session' | 'network' | 'runtime' | 'logs' | 'captcha' | 'advanced' | 'health'
export type SettingsGroup = 'general' | 'browser' | 'operation' | 'advanced'
export type SaveMode = 'auto' | 'manual' | 'action' | 'readonly'
export interface SettingsSectionDefinition {
  id: SettingsSection
  label: string
  mark: string
  group: SettingsGroup
  keywords: string
  saveMode: SaveMode
  saveLabel: string
}
export const SETTINGS_SECTION_KEY = 'page-auto:settings:last-section'
export const settingsGroups: ReadonlyArray<{ id: SettingsGroup; label: string }> = [
  { id: 'general', label: 'CHUNG' },
  { id: 'browser', label: 'TRÌNH DUYỆT & KẾT NỐI' },
  { id: 'operation', label: 'VẬN HÀNH & NHẬT KÝ' },
  { id: 'advanced', label: 'NÂNG CAO' }
]
export const settingsSections: ReadonlyArray<SettingsSectionDefinition> = [
  { id: 'appearance', label: 'Giao diện', mark: 'UI', group: 'general', keywords: 'theme sáng tối dark light', saveMode: 'auto', saveLabel: 'Tự lưu khi chọn giao diện' },
  { id: 'update', label: 'Cập nhật', mark: 'UP', group: 'general', keywords: 'phiên bản updater version', saveMode: 'action', saveLabel: 'Kiểm tra/cài đặt bằng nút riêng' },
  { id: 'health', label: 'Kiểm tra hệ thống', mark: 'OK', group: 'general', keywords: 'chrome health tình trạng', saveMode: 'readonly', saveLabel: 'Chỉ xem trạng thái, không thay đổi cấu hình' },
  { id: 'browser', label: 'Trình duyệt', mark: 'BR', group: 'browser', keywords: 'chrome profile dpi scale', saveMode: 'manual', saveLabel: 'Sửa cấu hình rồi bấm Lưu' },
  { id: 'slots', label: 'Chrome Slots', mark: 'SL', group: 'browser', keywords: 'layout xếp cửa sổ vị trí slot', saveMode: 'action', saveLabel: 'Theo dõi trực tiếp; nút Sắp xếp mới thực thi' },
  { id: 'session', label: 'Đăng nhập', mark: 'SS', group: 'browser', keywords: 'cookie checkpoint locale phiên đăng nhập', saveMode: 'manual', saveLabel: 'Sửa cấu hình rồi bấm Lưu' },
  { id: 'network', label: 'Proxy & Mạng', mark: 'NW', group: 'browser', keywords: 'proxy timeout kết nối network', saveMode: 'manual', saveLabel: 'Sửa cấu hình rồi bấm Lưu' },
  { id: 'captcha', label: 'CAPTCHA', mark: 'CP', group: 'browser', keywords: 'provider api key captcha', saveMode: 'manual', saveLabel: 'Sửa cấu hình rồi bấm Lưu (API key mặc định được che)' },
  { id: 'runtime', label: 'Vận hành', mark: 'RT', group: 'operation', keywords: 'retry delay concurrency scheduler', saveMode: 'manual', saveLabel: 'Sửa cấu hình rồi bấm Lưu' },
  { id: 'logs', label: 'Nhật ký', mark: 'LG', group: 'operation', keywords: 'evidence log trace retention ảnh lỗi', saveMode: 'manual', saveLabel: 'Sửa cấu hình rồi bấm Lưu; Dọn ngay là thao tác riêng' },
  { id: 'advanced', label: 'Nâng cao', mark: 'AD', group: 'advanced', keywords: 'backup restore startup hardware khởi động', saveMode: 'manual', saveLabel: 'Sửa cấu hình rồi bấm Lưu; backup/restore là nút riêng' }
]
export function restoreSettingsSection(raw: string | null): SettingsSection {
  return settingsSections.find((section) => section.id === raw)?.id ?? 'browser'
}
