import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildOciVnicMetadataProbeCommand,
  parseOciVnicMetadataProbeOutput
} from './ociMetadata'

const source = readFileSync(new URL('./ociMetadata.ts', import.meta.url), 'utf8')

describe('OCI VNIC metadata probe', () => {
  it('parses an assigned /116 CIDR from the shared probe output', () => {
    const result = parseOciVnicMetadataProbeOutput([
      'PA_OCI_REGION=ap-singapore-1',
      'PA_OCI_VNIC=ocid1.vnic.oc1.ap-singapore-1.example',
      'PA_OCI_IPV6_CIDRS=2603:c021:6:f800:f324:d872:e4bb:0/116,2603:c021:6:f800:6b62:688:3c01:0/128',
      'PA_OCI_IPV6_SUBNETS=2603:c021:6:f800::/64'
    ].join('\n'))

    expect(result).not.toBeNull()
    expect(result?.region).toBe('ap-singapore-1')
    expect(result?.assignedIpv6Cidrs).toEqual([
      '2603:c021:6:f800:f324:d872:e4bb:0/116',
      '2603:c021:6:f800:6b62:688:3c01:0/128'
    ])
    expect(result?.subnetIpv6Cidrs).toEqual(['2603:c021:6:f800::/64'])
  })

  it('returns null without a valid OCI VNIC identity', () => {
    expect(parseOciVnicMetadataProbeOutput('PA_OCI_VNIC=')).toBeNull()
  })

  it('queries full VNIC metadata and matches the default interface instead of per-index paths', () => {
    expect(source).toContain('http://169.254.169.254/opc/v2/vnics/')
    expect(source).toContain('http://169.254.169.254/opc/v1/vnics/')
    expect(source).not.toContain('/vnics/0/')
    expect(source).toContain("ci_get(item, 'macAddr')")
    expect(source).toContain("ci_get(item, 'privateIp')")
    expect(source).toContain("collect('ipv6AddressCidrs')")
    expect(buildOciVnicMetadataProbeCommand('"$IFACE"')).toContain('python3 -c')
  })
})
