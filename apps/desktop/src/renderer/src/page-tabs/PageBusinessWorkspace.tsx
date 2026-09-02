import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { PageBusinessWorkspace as PageBusinessWorkspaceCore } from './PageBusinessWorkspaceCore'
import { PageJoinGroupWorkspace } from './PageJoinGroupWorkspace'
import { PageManagerModal } from './PageManagerModal'
import './pageManager.css'
import './pageJoinGroup.css'

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

function PageJoinGroupTabBridge({ active, onActivate, onDeactivate, revision }: {
  active: boolean
  onActivate: () => void
  onDeactivate: () => void
  revision: number
}) {
  const [tabsTarget, setTabsTarget] = useState<HTMLElement | null>(null)
  const [workspaceTarget, setWorkspaceTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const sync = () => {
      const root = document.querySelector<HTMLElement>('.page-business-workspace')
      setWorkspaceTarget((current) => current === root ? current : root)
      setTabsTarget((current) => {
        const next = root?.querySelector<HTMLElement>('.page-business-tab-buttons') ?? null
        return current === next ? current : next
      })
    }
    sync()
    const timer = window.setInterval(sync, 250)
    return () => window.clearInterval(timer)
  }, [revision])

  useEffect(() => {
    const root = workspaceTarget
    if (!root) return
    root.classList.toggle('page-join-active', active)
    const existingTabs = Array.from(root.querySelectorAll<HTMLButtonElement>('.page-business-tab:not(.page-join-business-tab)'))
    const deactivate = () => onDeactivate()
    for (const button of existingTabs) button.addEventListener('click', deactivate)
    return () => {
      root.classList.remove('page-join-active')
      for (const button of existingTabs) button.removeEventListener('click', deactivate)
    }
  }, [active, onDeactivate, workspaceTarget])

  return <>
    {tabsTarget ? createPortal(
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className={active ? 'page-business-tab page-join-business-tab active' : 'page-business-tab page-join-business-tab'}
        onClick={onActivate}
      >
        <strong>Tham gia nhóm</strong>
        <span>Page binding</span>
      </button>,
      tabsTarget
    ) : null}
    {active && workspaceTarget ? createPortal(<PageJoinGroupWorkspace />, workspaceTarget) : null}
  </>
}

export function PageBusinessWorkspace() {
  const [managerOpen, setManagerOpen] = useState(false)
  const [joinGroupOpen, setJoinGroupOpen] = useState(false)
  const [sharedRevision, setSharedRevision] = useState(0)

  const sharedChanged = () => setSharedRevision((current) => current + 1)

  return (
    <>
      <PageBusinessWorkspaceCore key={sharedRevision} />
      <PageManagerTrigger revision={sharedRevision} onOpen={() => setManagerOpen(true)} />
      <PageJoinGroupTabBridge
        revision={sharedRevision}
        active={joinGroupOpen}
        onActivate={() => setJoinGroupOpen(true)}
        onDeactivate={() => setJoinGroupOpen(false)}
      />
      {managerOpen ? (
        <PageManagerModal
          onClose={() => setManagerOpen(false)}
          onChanged={sharedChanged}
        />
      ) : null}
    </>
  )
}
