import { describe, expect, it } from 'vitest'
import { sanitizedLogError, parseLogDateRange, filterLogsByAction } from './logPresentation'
describe('Execution logs UI presentation (#510 Batch 7)', () => {
  it('converts inclusive timestamp filters without modifying Main contract', () => {
    expect(parseLogDateRange('', '')).toEqual({})
    expect(parseLogDateRange('2026-10-10T12:00', '2026-10-10T11:00').error).toMatch(/trước/)
    expect(parseLogDateRange('2026-10-10T12:00', '')).toHaveProperty('fromTimestamp')
    expect(parseLogDateRange('invalid date', '').error).toBeTruthy()
  })
  it('sanitizes credentials, URL query/hash, emails and authorization headers before copying', () => {
    const value = sanitizedLogError('NETWORK', 'Request https://site.test/path?token=supersecret#secret\npassword=abc123\nBearer abc.def\nCookie: session=abc; foo=bar\nmail test@example.org')
    expect(value).toContain('https://site.test/path')
    for (const secret of ['supersecret', 'abc123', 'abc.def', 'session=abc', 'test@example.org']) expect(value).not.toContain(secret)
  })
  it('filters actions on already loaded rows, keeping their original order', () => {
    const records = [{ action:'group_post', id:1 },{action:'page_wall_post',id:2},{action:'group_post',id:3}]
    expect(filterLogsByAction(records as never, 'group').map(x=>x.id)).toEqual([1,3])
    expect(records.map(x=>x.id)).toEqual([1,2,3])
  })
})
