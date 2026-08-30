import { useState } from 'react'
import { AiContentWorkspace } from './AiContentWorkspace'
import { ContentLibraryWorkspace } from './ContentLibraryWorkspace'
import './contentLibraryHub.css'

type ContentLibraryTab = 'library' | 'ai'

export function ContentLibraryHub() {
  const [activeTab, setActiveTab] = useState<ContentLibraryTab>('library')

  return (
    <section className="content-library-hub" aria-label="Bài viết">
      <div className="content-library-hub-tabs" role="tablist" aria-label="Chế độ quản lý bài viết">
        <button
          className={activeTab === 'library' ? 'active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'library'}
          onClick={() => setActiveTab('library')}
        >
          <span aria-hidden="true">▤</span>
          Thư viện
        </button>
        <button
          className={activeTab === 'ai' ? 'active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'ai'}
          onClick={() => setActiveTab('ai')}
        >
          <span aria-hidden="true">✦</span>
          Tạo bài bằng AI
        </button>
      </div>

      <div className="content-library-hub-body">
        {activeTab === 'library' ? <ContentLibraryWorkspace /> : <AiContentWorkspace />}
      </div>
    </section>
  )
}
