import { describe, expect, it } from 'vitest'
import {
  MetaGraphScannerTokenValidator,
  classifyMetaGraphTokenResponse
} from './tokenValidator'

describe('MetaGraphScannerTokenValidator', () => {
  it('sends token only in Authorization header and validates /me identity', async () => {
    let requestedUrl = ''
    let authorization = ''
    const validator = new MetaGraphScannerTokenValidator(async (input, init) => {
      requestedUrl = input
      authorization = new Headers(init?.headers).get('Authorization') ?? ''
      return new Response(JSON.stringify({ id: '10001', name: 'Scanner Test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })

    const result = await validator.validate('secret-scanner-token-1234')

    expect(requestedUrl).toContain('/v26.0/me?fields=id,name')
    expect(requestedUrl).not.toContain('secret-scanner-token-1234')
    expect(authorization).toBe('Bearer secret-scanner-token-1234')
    expect(result).toMatchObject({
      state: 'valid',
      subjectId: '10001',
      subjectName: 'Scanner Test'
    })
  })

  it('classifies expired, permission-limited and transient responses without exposing remote messages', async () => {
    const expired = await classifyMetaGraphTokenResponse(new Response(JSON.stringify({
      error: { code: 190, error_subcode: 463, message: 'remote token detail' }
    }), { status: 400 }))
    const permission = await classifyMetaGraphTokenResponse(new Response(JSON.stringify({
      error: { code: 200, message: 'remote permission detail' }
    }), { status: 403 }))
    const throttled = await classifyMetaGraphTokenResponse(new Response(JSON.stringify({
      error: { code: 4, message: 'remote throttle detail' }
    }), { status: 429 }))

    expect(expired.state).toBe('expired')
    expect(permission.state).toBe('permission_limited')
    expect(throttled.state).toBe('unverified')
    expect(JSON.stringify([expired, permission, throttled])).not.toContain('remote token detail')
    expect(JSON.stringify([expired, permission, throttled])).not.toContain('remote permission detail')
    expect(JSON.stringify([expired, permission, throttled])).not.toContain('remote throttle detail')
  })
})
