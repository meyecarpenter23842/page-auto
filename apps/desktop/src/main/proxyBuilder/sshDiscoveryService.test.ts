import { describe, expect, it } from 'vitest'
import { parseProxyBuilderDiscovery } from './sshDiscoveryService'

describe('Proxy Builder SSH discovery parser', () => {
  it('parses network capability without inventing addresses', () => {
    const result = parseProxyBuilderDiscovery([
      'PA_OS=Ubuntu 24.04',
      'PA_IFACE=ens3',
      'PA_PUBLIC4=203.0.113.10',
      'PA_IPV4=203.0.113.10/24,203.0.113.11/24',
      'PA_IPV6=2001:db8:1::10/64',
      'PA_IPV6_GW=2001:db8:1::1',
      'PA_SOURCE4=1',
      'PA_SOURCE6=1',
      'PA_PORT_FREE=1'
    ].join('\n'))

    expect(result.defaultInterface).toBe('ens3')
    expect(result.ipv4Addresses).toEqual(['203.0.113.10/24', '203.0.113.11/24'])
    expect(result.ipv6Prefix).toBe('2001:db8:1::10/64')
    expect(result.supportsIpv4).toBe(true)
    expect(result.supportsIpv6).toBe(true)
    expect(result.startPortAvailable).toBe(true)
  })

  it('does not report capability when outbound probe fails', () => {
    const result = parseProxyBuilderDiscovery([
      'PA_OS=Debian 13',
      'PA_IFACE=eth0',
      'PA_PUBLIC4=',
      'PA_IPV4=10.0.0.2/24',
      'PA_IPV6=2001:db8:2::2/64',
      'PA_IPV6_GW=2001:db8:2::1',
      'PA_SOURCE4=0',
      'PA_SOURCE6=0',
      'PA_PORT_FREE=0'
    ].join('\n'))

    expect(result.publicIpv4).toBeNull()
    expect(result.supportsIpv4).toBe(false)
    expect(result.supportsIpv6).toBe(false)
    expect(result.startPortAvailable).toBe(false)
  })
})
