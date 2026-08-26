import { useMemo, useState } from 'react'
import { PageTabsManager } from './PageTabsManagerV2'
import './pageBusinessWorkspace.css'

type PageBusinessId = 'groups' | 'wall' | 'edit'

interface PageBusinessDefinition {
  id: PageBusinessId
  label: string
  status: string
  title: string
  description: string
  items: Array<{ title: string; description: string }>
}

const businesses: PageBusinessDefinition[] = [
  {
    id: 'groups',
    label: 'Nhóm',
    status: 'Đang dùng',
    title: 'Đăng Nhóm',
    description: 'Nghiệp vụ hiện có tiếp tục dùng nguyên cấu hình, run snapshot và chống trùng theo phiên.',
    items: []
  },
  {
    id: 'wall',
    label: 'Đăng Tường',
    status: 'UI shell',
    title: 'Đăng Tường Page',
    description: 'Khung nghiệp vụ được dựng trước; runtime thật chỉ nối sau khi tầng Facebook dùng chung ổn định.',
    items: [
      { title: 'Dùng chung Page + tài khoản', description: 'Không tạo session/account riêng; sẽ dùng Page UID và danh sách account của Page Tab.' },
      { title: 'Cấu hình bài viết riêng', description: 'Content, ảnh, thứ tự/random, lịch và delay của Đăng Tường sẽ độc lập với Đăng Nhóm.' },
      { title: 'Runtime riêng', description: 'Start/Pause/Resume, preview và log sẽ tách theo nghiệp vụ nhưng dùng chung điều phối phiên.' }
    ]
  },
  {
    id: 'edit',
    label: 'Sửa Page',
    status: 'UI shell',
    title: 'Sửa Page',
    description: 'Khung nghiệp vụ được giữ chỗ đúng kiến trúc; phần thao tác Facebook sẽ làm sau Đăng Tường.',
    items: [
      { title: 'Dùng chung Facebook Common', description: 'Login, 2FA, checkpoint, profile và Page switch không được copy riêng vào Sửa Page.' },
      { title: 'Cấu hình thay đổi riêng', description: 'Các trường cần sửa và policy chạy sẽ thuộc nghiệp vụ Sửa Page, không chen vào cấu hình Nhóm.' },
      { title: 'Theo dõi kết quả', description: 'Trạng thái từng thao tác và log sẽ nối khi source common đã tách và regression Group xanh.' }
    ]
  }
]

export function PageBusinessWorkspace() {
  const [activeBusiness, setActiveBusiness] = useState<PageBusinessId>('groups')
  const active = useMemo(
    () => businesses.find((business) => business.id === activeBusiness) ?? businesses[0],
    [activeBusiness]
  )

  return (
    <div className="page-tabs-route page-business-workspace">
      <nav className="page-business-tabs" role="tablist" aria-label="Nghiệp vụ của Page">
        <div className="page-business-tabs-copy">
          <span>Nghiệp vụ Page</span>
          <small>Mỗi Page Tab dùng chung Page UID + account, cấu hình nghiệp vụ tách riêng.</small>
        </div>
        <div className="page-business-tab-buttons">
          {businesses.map((business) => (
            <button
              key={business.id}
              type="button"
              role="tab"
              aria-selected={activeBusiness === business.id}
              className={activeBusiness === business.id ? 'page-business-tab active' : 'page-business-tab'}
              onClick={() => setActiveBusiness(business.id)}
            >
              <strong>{business.label}</strong>
              <span>{business.status}</span>
            </button>
          ))}
        </div>
      </nav>

      <div
        className={activeBusiness === 'groups' ? 'page-business-pane page-business-group-pane active' : 'page-business-pane page-business-group-pane inactive'}
        role="tabpanel"
        aria-hidden={activeBusiness !== 'groups'}
      >
        <PageTabsManager />
      </div>

      {activeBusiness !== 'groups' && active ? (
        <section className="page-business-pane page-business-placeholder" role="tabpanel">
          <header className="page-business-placeholder-head">
            <div>
              <p className="eyebrow">{active.label}</p>
              <h2>{active.title}</h2>
              <p>{active.description}</p>
            </div>
            <span className="page-business-shell-badge">Chưa bật runtime</span>
          </header>

          <div className="page-business-placeholder-grid">
            {active.items.map((item, index) => (
              <article key={item.title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><strong>{item.title}</strong><p>{item.description}</p></div>
              </article>
            ))}
          </div>

          <div className="page-business-foundation-note">
            <strong>Thứ tự #77 được giữ nguyên</strong>
            <span>UI có trước để chốt thao tác. Không gọi Facebook, không tạo config giả và không nhân bản login/2FA/Page switch ở batch này.</span>
          </div>
        </section>
      ) : null}
    </div>
  )
}
