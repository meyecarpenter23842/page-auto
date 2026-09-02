type CompactGroupConfigTarget = 'identity' | 'schedule' | 'groups' | 'posts'

function ConfigIcon({ target }: { target: CompactGroupConfigTarget }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  }

  if (target === 'identity') return <svg {...common}><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M7 16c.6-1.6 1.5-2.4 2.8-2.4S12 14.4 12.6 16" /><path d="M14.5 10h3" /><path d="M14.5 14h3" /></svg>
  if (target === 'schedule') return <svg {...common}><rect x="4" y="5.5" width="16" height="14.5" rx="2" /><path d="M8 3.5v4" /><path d="M16 3.5v4" /><path d="M4 9.5h16" /><path d="M8 13h3" /><path d="M13 13h3" /><path d="M8 16.5h3" /></svg>
  if (target === 'groups') return <svg {...common}><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.3" /><path d="M3.5 19c.6-3.2 2.5-4.8 5.5-4.8s4.9 1.6 5.5 4.8" /><path d="M14.5 15.2c2.8.2 4.6 1.5 5.2 3.8" /></svg>
  return <svg {...common}><path d="M6 3.5h8l4 4V20H6z" /><path d="M14 3.5V8h4" /><path d="M9 12h6" /><path d="M9 15.5h6" /></svg>
}

interface Props {
  onIdentity: () => void
  onSchedule: () => void
  onGroups: () => void
  onPosts: () => void
}

export function CompactGroupConfigLauncher({ onIdentity, onSchedule, onGroups, onPosts }: Props) {
  return <section className="pt-panel pt-compact-config-launchers" aria-label="Cấu hình nhanh Đăng Nhóm">
    <div className="pt-compact-config-title"><span>Cấu hình</span><small>Mở khi cần</small></div>
    <div className="pt-compact-config-actions">
      <button type="button" title="Nhận diện Page" onClick={onIdentity}><ConfigIcon target="identity" /><span>Nhận diện</span></button>
      <button type="button" title="Lịch chạy" onClick={onSchedule}><ConfigIcon target="schedule" /><span>Lịch chạy</span></button>
      <button type="button" title="Danh sách Group" onClick={onGroups}><ConfigIcon target="groups" /><span>Group</span></button>
      <button type="button" title="Thư viện bài viết" onClick={onPosts}><ConfigIcon target="posts" /><span>Bài viết</span></button>
    </div>
  </section>
}
