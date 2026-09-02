import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { PageBusinessWorkspace as PageBusinessWorkspaceCore } from './PageBusinessWorkspaceCore'
import { PageManagerModal } from './PageManagerModal'
import './pageManager.css'

function PageManagerTrigger({ onOpen, revision }: { onOpen: () => void; revision: number }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const sync = () => {
      const next = document.querySelector<HTMLElement>('.page-business-workspace .page-business-tabs')
      setTarget((current) => current === next ? current : next)
    }
    sync()
    const timer = window.setInterval(sync, 250)
    return () => window.clearInterval(timer)
  }, [revision])

  if (!target) return null
  return createPortal(
    <button className="page-manager-trigger" type="button" onClick={onOpen}>
      Quản lý Page
      <small>Page · tài khoản · trạng thái</small>
    </button>,
    target
  )
}

export function PageBusinessWorkspace() {
  const [managerOpen, setManagerOpen] = useState(false)
  const [sharedRevision, setSharedRevision] = useState(0)

  const sharedChanged = () => setSharedRevision((current) => current + 1)

  return (
    <>
      <PageBusinessWorkspaceCore key={sharedRevision} />
      <PageManagerTrigger revision={sharedRevision} onOpen={() => setManagerOpen(true)} />
      {managerOpen ? (
        <PageManagerModal
          onClose={() => setManagerOpen(false)}
          onChanged={sharedChanged}
        />
      ) : null}
    </>
  )
}
