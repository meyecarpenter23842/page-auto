import { useEffect, useState } from 'react'
import { AiContentWorkspaceAgentBuilder } from './AiContentWorkspaceAgentBuilder'
import { CONTENT_LIBRARY_EXTERNAL_CHANGE_EVENT } from './aiDraftResults'
import { ContentLibraryWorkspace } from './ContentLibraryWorkspace'
import './contentLibraryHub.css'

type ContentLibraryTab = 'library' | 'ai'

export function ContentLibraryHub() {
  const [activeTab, setActiveTab] = useState<ContentLibraryTab>('library')
  const [libraryRevision, setLibraryRevision] = useState(0)
  const [libraryStale, setLibraryStale] = useState(false)

  useEffect(() => {
    const markLibraryStale = () => setLibraryStale(true)
    window.addEventListener(CONTENT_LIBRARY_EXTERNAL_CHANGE_EVENT, markLibraryStale)
    return () => window.removeEventListener(CONTENT_LIBRARY_EXTERNAL_CHANGE_EVENT, markLibraryStale)
  }, [])

  const activateLibrary = () => {
    if (libraryStale) {
      setLibraryRevision((current) => current + 1)
      setLibraryStale(false)
    }
    setActiveTab('library')
  }

  return (
    <section className="content-library-hub" aria-label="Bài viết">
      <div className="content-library-hub-tabs" role="tablist" aria-label="Chế độ quản lý bài viết">
        <button
          id="content-library-tab-library"
          className={activeTab === 'library' ? 'active' : ''}
          type="button"
          role="tab"
          aria-controls="content-library-panel-library"
          aria-selected={activeTab === 'library'}
          onClick={activateLibrary}
        >
          <span aria-hidden="true">▤</span>
          Thư viện{libraryStale ? ' · Mới' : ''}
        </button>
        <button
          id="content-library-tab-ai"
          className={activeTab === 'ai' ? 'active' : ''}
          type="button"
          role="tab"
          aria-controls="content-library-panel-ai"
          aria-selected={activeTab === 'ai'}
          onClick={() => setActiveTab('ai')}
        >
          <span aria-hidden="true">✦</span>
          Tạo bài bằng AI
        </button>
      </div>

      <div className="content-library-hub-body">
        <div
          id="content-library-panel-library"
          role="tabpanel"
          aria-labelledby="content-library-tab-library"
          hidden={activeTab !== 'library'}
        >
          <ContentLibraryWorkspace key={libraryRevision} />
        </div>
        <div
          id="content-library-panel-ai"
          role="tabpanel"
          aria-labelledby="content-library-tab-ai"
          hidden={activeTab !== 'ai'}
        >
          <AiContentWorkspaceAgentBuilder />
        </div>
      </div>
    </section>
  )
}
