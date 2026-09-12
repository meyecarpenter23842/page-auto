import { describe, expect, it, vi } from 'vitest'
import type { AccountRecord } from '../../shared/accounts'
import type { AccountRepository } from '../database/accountRepository'
import { resolveMicrosoftMailboxOwner } from './microsoftMailboxRuntime'

function account(id: number, email: string | null): AccountRecord {
  return { id, email } as AccountRecord
}

function repository(rows: AccountRecord[]): Pick<AccountRepository, 'getById' | 'list'> {
  return {
    getById: vi.fn((id: number) => rows.find((row) => row.id === id) ?? null),
    list: vi.fn(({ search } = {}) => rows.filter((row) => !search || (row.email ?? '').toLowerCase().includes(search.toLowerCase())))
  } as Pick<AccountRepository, 'getById' | 'list'>
}

describe('resolveMicrosoftMailboxOwner', () => {
  it('uses the requester account only when its canonical Email is the requested mailbox', () => {
    const accounts = repository([account(1, 'Main@Outlook.com'), account(2, 'backup@outlook.com')])
    const result = resolveMicrosoftMailboxOwner(accounts, 1, 'main@outlook.com')
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.account.id).toBe(1)
  })

  it('resolves a Hotmail recovery mailbox to its own canonical account/OAuth owner', () => {
    const accounts = repository([account(1, 'main@outlook.com'), account(2, 'Backup@Hotmail.com')])
    const result = resolveMicrosoftMailboxOwner(accounts, 1, 'backup@hotmail.com')
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.account.id).toBe(2)
  })

  it('fails closed when the requested mailbox is not canonical or is ambiguous', () => {
    const missing = resolveMicrosoftMailboxOwner(repository([account(1, 'main@outlook.com')]), 1, 'missing@outlook.com')
    expect(missing.status).toBe('mailbox_not_found')

    const duplicated = resolveMicrosoftMailboxOwner(
      repository([account(1, 'main@outlook.com'), account(2, 'same@live.com'), account(3, 'SAME@LIVE.COM')]),
      1,
      'same@live.com'
    )
    expect(duplicated.status).toBe('provider_unavailable')
  })
})
