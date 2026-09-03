import type { Browser } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import {
  closeConnectedChromiumProcess,
  devToolsEndpointFromActivePort
} from './browserProcessLifecycle'
import { managedCdpLaunchArgs } from './managedBrowserBridge'

describe('Issue #266 browser process lifecycle', () => {
  it('parses the Chrome DevToolsActivePort file into a loopback CDP endpoint', () => {
    expect(devToolsEndpointFromActivePort('9222\n/devtools/browser/test\n')).toBe('http://127.0.0.1:9222')
    expect(devToolsEndpointFromActivePort('not-a-port\n')).toBeNull()
    expect(devToolsEndpointFromActivePort('')).toBeNull()
  })

  it('forces worker-owned persistent Chrome to expose a loopback random CDP port for crash cleanup', () => {
    expect(managedCdpLaunchArgs([
      '--foo',
      '--remote-debugging-address=0.0.0.0',
      '--remote-debugging-port=9222'
    ])).toEqual([
      '--foo',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0'
    ])
  })

  it('terminates an attached Chrome with CDP Browser.close instead of treating Browser.close disconnect as process cleanup', async () => {
    let connected = true
    const commands: string[] = []
    let detached = false
    let disconnectedFallback = false
    const browser = {
      isConnected: () => connected,
      newBrowserCDPSession: async () => ({
        send: async (method: string) => {
          commands.push(method)
          if (method === 'Browser.close') connected = false
        },
        detach: async () => { detached = true }
      }),
      close: async () => {
        disconnectedFallback = true
        connected = false
      }
    } as unknown as Browser

    await closeConnectedChromiumProcess(browser, 'test Chrome')

    expect(commands).toEqual(['Browser.close'])
    expect(detached).toBe(true)
    expect(disconnectedFallback).toBe(false)
    expect(connected).toBe(false)
  })
})
