import { useEffect, useState } from 'react'
import { AiContentWorkspaceAgentBuilder } from './AiContentWorkspaceAgentBuilder'
import { AiImageStudio } from './AiImageStudio'
import type { AiImageArticleRequest, AiImageAttachment } from './aiImageArticleBridge'
import { CONTENT_LIBRARY_EXTERNAL_CHANGE_EVENT } from './aiDraftResults'
import { ContentLibraryWorkspace } from './ContentLibraryWorkspace'
import { ScanDatasetLibrary } from './ScanDatasetLibrary'
import './contentLibraryHub.css'
import './contentLibraryDarkTheme.css'

type ContentLibraryTab = 'posts' | 'scanner' | 'ai' | 'images'

export function ContentLibraryHub() {
  const [activeTab, setActiveTab] = useState<ContentLibraryTab>('posts')
  const [libraryRevision, setLibraryRevision] = useState(0)
  const [libraryStale, setLibraryStale] = useState(false)
  const [imageArticle, setImageArticle] = useState<AiImageArticleRequest | null>(null)
  const [imageAttachment, setImageAttachment] = useState<AiImageAttachment | null>(null)
  const openImageForArticle = (request: AiImageArticleRequest) => {
    setImageArticle(request)
    setActiveTab('images')
  }
  const attachImagesToArticle = (request: AiImageArticleRequest, folderPath: string) => {
    setImageAttachment(current => ({id:request.id,folderPath,version:(current?.version??0)+1}))
    setActiveTab('ai')
  }

  useEffect(() => {
    const markLibraryStale = () => setLibraryStale(true)
    window.addEventListener(CONTENT_LIBRARY_EXTERNAL_CHANGE_EVENT, markLibraryStale)
    return () => window.removeEventListener(CONTENT_LIBRARY_EXTERNAL_CHANGE_EVENT, markLibraryStale)
  }, [])

  const activatePosts = () => {
    if (libraryStale) {
      setLibraryRevision((current) => current + 1)
      setLibraryStale(false)
    }
    setActiveTab('posts')
  }

  return (
    <section className="content-library-hub" aria-label="Thư viện">
      <div className="content-library-hub-tabs" role="tablist" aria-label="Nội dung Thư viện">
        <button id="content-library-tab-posts" className={activeTab === 'posts' ? 'active' : ''} type="button" role="tab" aria-controls="content-library-panel-posts" aria-selected={activeTab === 'posts'} onClick={activatePosts}>
          <span aria-hidden="true">▤</span>Bài viết{libraryStale ? ' · Mới' : ''}
        </button>
        <button id="content-library-tab-scanner" className={activeTab === 'scanner' ? 'active' : ''} type="button" role="tab" aria-controls="content-library-panel-scanner" aria-selected={activeTab === 'scanner'} onClick={() => setActiveTab('scanner')}>
          <span aria-hidden="true">⌕</span>Dữ liệu quét
        </button>
        <button id="content-library-tab-ai" className={activeTab === 'ai' ? 'active' : ''} type="button" role="tab" aria-controls="content-library-panel-ai" aria-selected={activeTab === 'ai'} onClick={() => setActiveTab('ai')}>
          <span aria-hidden="true">✦</span>Tạo bài bằng AI
        </button>
        <button id="content-library-tab-images" className={activeTab === 'images' ? 'active' : ''} type="button" role="tab" aria-controls="content-library-panel-images" aria-selected={activeTab === 'images'} onClick={() => setActiveTab('images')}>
          <span aria-hidden="true">✧</span>Tạo ảnh AI
        </button>
      </div>

      <div className="content-library-hub-body">
        <div id="content-library-panel-posts" role="tabpanel" aria-labelledby="content-library-tab-posts" hidden={activeTab !== 'posts'}><ContentLibraryWorkspace key={libraryRevision} /></div>
        <div id="content-library-panel-scanner" role="tabpanel" aria-labelledby="content-library-tab-scanner" hidden={activeTab !== 'scanner'}><ScanDatasetLibrary /></div>
        <div id="content-library-panel-ai" role="tabpanel" aria-labelledby="content-library-tab-ai" hidden={activeTab !== 'ai'}><AiContentWorkspaceAgentBuilder onCreateImageForArticle={openImageForArticle} imageAttachment={imageAttachment} /></div>
        <div id="content-library-panel-images" role="tabpanel" aria-labelledby="content-library-tab-images" hidden={activeTab !== 'images'}><AiImageStudio articleRequest={imageArticle} onAttachToArticle={attachImagesToArticle} /></div>
      </div>
    </section>
  )
}
