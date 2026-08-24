import { describe, expect, it } from 'vitest'
import { managedCdpEndpointFromArgs } from './managedBrowserBridge'

describe('managedBrowserBridge', () => {
  it('reads the managed Chrome endpoint from posting-worker arguments', () => {
    expect(managedCdpEndpointFromArgs(['electron', 'posting-worker.js'])).toBeNull()
    expect(managedCdpEndpointFromArgs([
      'electron',
      'posting-worker.js',
      '--page-auto-managed-cdp=http://127.0.0.1:9222'
    ])).toBe('http://127.0.0.1:9222')
  })
})
