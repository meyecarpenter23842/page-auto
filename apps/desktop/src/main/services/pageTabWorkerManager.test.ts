import { describe, expect, it } from 'vitest'
import type { RotationRuntimeSnapshot } from '../../shared/rotation'
import { PageTabWorkerManager, type PageTabRotationController } from './pageTabWorkerManager'

function snapshot(pageTabId: number, status: RotationRuntimeSnapshot['status'] = 'idle'): RotationRuntimeSnapshot {
  return { pageTabId, runId: pageTabId * 10, status, currentAccountId:null, currentAccountIndex:null, slotsCompletedThisTurn:0, targetSlotsThisTurn:0, cycle:0, nextActionAt:null, message:null, lastResult:null, run:null }
}
class FakeController implements PageTabRotationController {
  state:RotationRuntimeSnapshot
  constructor(readonly pageTabId:number){this.state=snapshot(pageTabId)}
  start(){this.state=snapshot(this.pageTabId,'running');return this.state}
  status(){return this.state}
  pause(){this.state={...this.state,status:'paused'};return this.state}
  resume(){this.state={...this.state,status:'running'};return this.state}
  dispose(){}
}

describe('PageTabWorkerManager',()=>{
  it('keeps Page A and Page B independent while each tab owns only one controller',()=>{
    let created=0
    const manager=new PageTabWorkerManager((pageTabId)=>{created+=1;return new FakeController(pageTabId)})
    manager.start({pageTabId:10})
    manager.start({pageTabId:20})
    expect(manager.list([10,20]).map((item)=>item.status)).toEqual(['running','running'])
    manager.pause({pageTabId:10})
    expect(manager.status({pageTabId:10}).status).toBe('paused')
    expect(manager.status({pageTabId:20}).status).toBe('running')
    manager.status({pageTabId:10})
    expect(created).toBe(2)
  })
})
