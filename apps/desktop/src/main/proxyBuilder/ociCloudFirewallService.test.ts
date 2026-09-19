import { describe, expect, it } from 'vitest'
import { parseOciConfig, reconcileOciIngressRules } from './ociCloudFirewallService'

describe('Proxy Builder OCI cloud firewall', () => {
  it('parses a selected OCI config profile without exposing key material', () => {
    const parsed = parseOciConfig([
      '[DEFAULT]',
      'user=ocid1.user.oc1..example',
      'fingerprint=aa:bb:cc',
      'tenancy=ocid1.tenancy.oc1..example',
      'region=ap-singapore-1',
      'key_file=keys/oci_api_key.pem'
    ].join('\n'), 'DEFAULT', 'C:/Users/test/.oci/config')

    expect(parsed.user).toBe('ocid1.user.oc1..example')
    expect(parsed.tenancy).toBe('ocid1.tenancy.oc1..example')
    expect(parsed.region).toBe('ap-singapore-1')
    expect(parsed.keyFile.replaceAll('\\', '/')).toContain('/.oci/keys/oci_api_key.pem')
  })

  it('replaces only the Page-Auto rule for the same VNIC and preserves unrelated ingress', () => {
    const marker = 'page-auto-proxy:ocid1.vnic.oc1..abc'
    const existing = [
      { description: 'SSH', protocol: '6', source: '0.0.0.0/0', tcpOptions: { destinationPortRange: { min: 22, max: 22 } } },
      { description: marker, protocol: '6', source: '0.0.0.0/0', tcpOptions: { destinationPortRange: { min: 3128, max: 3128 } } },
      { description: 'page-auto-proxy:ocid1.vnic.oc1..other', protocol: '6', source: '0.0.0.0/0', tcpOptions: { destinationPortRange: { min: 5000, max: 5009 } } }
    ]

    const next = reconcileOciIngressRules(existing, marker, 6000, 6019)
    expect(next).toHaveLength(3)
    expect(next).toContainEqual(existing[0])
    expect(next).toContainEqual(existing[2])
    expect(next).toContainEqual({
      description: marker,
      isStateless: false,
      protocol: '6',
      source: '0.0.0.0/0',
      sourceType: 'CIDR_BLOCK',
      tcpOptions: { destinationPortRange: { min: 6000, max: 6019 } }
    })
  })
})
