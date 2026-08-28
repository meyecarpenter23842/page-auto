import { describe, expect, it } from 'vitest'
import type { AccountRecord } from '../../shared/accounts'
import type { FacebookCheckpoint282Result, FacebookCheckpoint282RunPayload } from '../../shared/facebookCheckpoint'
import { mapCheckpoint956ProbeResult } from './checkpoint282RuntimeController'

const account = { id: 7, uid: '123456' } as AccountRecord
const payload: FacebookCheckpoint282RunPayload = {
  accountId: 7,
  surface: 'desktop',
  action: 'start',
  checkpointKind: '956',
  asset: null
}

function probe(state: FacebookCheckpoint282Result['state'], kind?: FacebookCheckpoint282Result['checkpointKind']): FacebookCheckpoint282Result {
  return {
    accountId: account.id,
    uid: account.uid,
    state,
    surface: 'desktop',
    message: state,
    ...(kind ? { checkpointKind: kind } : {})
  }
}

describe('CP956 workbench probe mapping', () => {
  it('holds the browser when the common detector sees 956', () => {
    expect(mapCheckpoint956ProbeResult(account, payload, probe('different_checkpoint', '956')))
      .toEqual(expect.objectContaining({ state: 'waiting_manual', checkpointKind: '956' }))
  })

  it('rejects a 282 surface from the 956 workbench', () => {
    expect(mapCheckpoint956ProbeResult(account, payload, probe('waiting_manual', '282')))
      .toEqual(expect.objectContaining({ state: 'different_checkpoint', checkpointKind: '282' }))
  })

  it('maps a valid common session to resolved and keeps evidence', () => {
    const result = mapCheckpoint956ProbeResult(account, payload, { ...probe('resolved'), evidencePath: 'evidence.png' })
    expect(result).toEqual(expect.objectContaining({ state: 'resolved', checkpointKind: '956', evidencePath: 'evidence.png' }))
  })
})
