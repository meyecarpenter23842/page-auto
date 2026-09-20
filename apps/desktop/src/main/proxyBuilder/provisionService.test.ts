import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const shared = readFileSync(new URL('../../shared/proxyBuilder.ts', import.meta.url), 'utf8')
const service = readFileSync(new URL('./provisionService.ts', import.meta.url), 'utf8')
const assets = readFileSync(new URL('./remoteAssets.ts', import.meta.url), 'utf8')
const sshAuth = readFileSync(new URL('./sshAuth.ts', import.meta.url), 'utf8')
const ociService = readFileSync(new URL('./ociCloudFirewallService.ts', import.meta.url), 'utf8')

describe('Proxy Builder Batch 3 safety contracts', () => {
  it('does not expose proxy passwords in result contracts or runtime snapshots', () => {
    const resultContract = shared.slice(shared.indexOf('export interface ProxyBuilderProxyResult'), shared.indexOf('export interface ProxyBuilderProvisionSnapshot'))
    expect(resultContract).not.toContain('password')
    expect(service).toContain('authMode: remote.authMode')
    expect(service).not.toContain('password: remote')
  })

  it('uses one multi-listener runtime instead of one process per proxy', () => {
    expect(assets).toContain("for mapping in manifest.get('mappings', [])")
    expect(assets).toContain('asyncio.start_server')
    expect(assets).toContain('asyncio.gather(*(server.serve_forever() for server in servers))')
  })

  it('bootstraps OCI /128 through the VPS Instance Principal instead of a Windows OCI config file', () => {
    expect(service).toContain('runRemoteOciHelper<RemoteOciIpv6Lease>')
    expect(service).toContain("['ensure-ipv6', remoteOci.vnicId")
    expect(service).toContain('detectRemoteOci(session)')
    expect(service).toContain("...(ociIpv6Cidr ? { ociIpv6Cidr } : {})")
    expect(service).toContain("['delete-ipv6', ociIpv6Lease.ipv6Id]")
    expect(service).toContain('/opt/page-auto-oci-sdk/bin/python')
    expect(service).not.toContain('resolveOciConfigPath(input.cloudFirewall?.configPath)')
    expect(assets).toContain('InstancePrincipalsSecurityTokenSigner')
    expect(assets).toContain("operation == 'ensure-ipv6'")
    expect(assets).toContain("operation == 'ensure-ingress'")
    expect(assets).toContain('cidr_prefix_length')
    expect(assets).toContain("oci_ipv6_cidr = request.get('ociIpv6Cidr')")
    expect(assets).toContain('managed_network = ipaddress.ip_network(allocated_cidr, strict=False)')
    expect(assets).toContain('cidr = add_ipv6(address, 128, interface)')
  })

  it('supports IPv4, IPv6 and mixed allocation without inventing public IPv4', () => {
    expect(assets).toContain("if mode == 'ipv4'")
    expect(assets).toContain("if mode == 'ipv6'")
    expect(assets).toContain('Chế độ IPv4 + IPv6')
    expect(assets).toContain('def probe_outbound(address, family):')
    expect(assets).toContain("observed = probe_outbound(address, 4)")
    expect(assets).toContain('seen_outbound = set()')
    expect(assets).toContain("result.append({'source_ip': address, 'outbound_ip': observed})")
    expect(assets).toContain("expected = mapping.get('outbound_ip', mapping['source_ip'])")
    expect(service).toContain('outboundIp: mapping.outbound_ip ?? mapping.source_ip')
  })

  it('accepts one NAT IPv4 egress while deduplicating multiple local addresses behind the same public IP', () => {
    expect(assets).toContain('if not observed or observed in seen_outbound:')
    expect(assets).toContain('seen_outbound.add(observed)')
    expect(assets).toContain("'source_ip': candidate['source_ip']")
    expect(assets).toContain("'outbound_ip': candidate['outbound_ip']")
  })

  it('uses Windows native OpenSSH for selected key files in provision/runtime', () => {
    expect(service).toContain("from './nativeOpenSsh'")
    expect(service).toContain('class NativeOpenSshSession')
    expect(service).toContain('createSshSession(input)')
    expect(service).toContain('shouldUseNativeOpenSsh(input.auth)')
  })

  it('uses the same Main-process SSH auth helper for provision/runtime connections', () => {
    expect(service).toContain("from './sshAuth'")
    expect(service).toContain('applyProxyBuilderSshAuth(config, input.auth)')
  })

  it('keeps password auth compatible with keyboard-interactive/PAM during provisioning', () => {
    expect(sshAuth).toContain('config.tryKeyboard = true')
    expect(service).toContain("this.client.on('keyboard-interactive'")
    expect(service).toContain('finish(prompts.map(() => password))')
  })

  it('verifies newly created proxies from the desktop before reporting them ready', () => {
    expect(service).toContain("from './checkerService'")
    expect(service).toContain('checkProxyLineNow(')
    expect(service).toContain("status: 'error'")
    expect(service).toContain('Cloud firewall / Security List / NSG đang chặn port.')
  })

  it('keeps idempotency around the Page-Auto manifest and service', () => {
    expect(assets).toContain("MANIFEST = ETC_DIR / 'manifest.json'")
    expect(assets).toContain('old_manifest = load_json(MANIFEST, {})')
    expect(assets).toContain("systemctl', 'enable', SERVICE_NAME")
    expect(assets).toContain('restore_files(backup_dir, existed)')
  })

  it('opens the exact requested host-firewall range with Page-Auto ownership across supported backends', () => {
    expect(assets).toContain("FIREWALL_MARKER = 'page-auto-proxy'")
    expect(assets).toContain("if ufw_active():")
    expect(assets).toContain("if firewalld_active():")
    expect(assets).toContain("backend': 'nftables'")
    expect(assets).toContain("else 'iptables'")
    expect(assets).toContain("start_port + count - 1")
    expect(assets).toContain("apply_firewall(start_port, start_port + count - 1)")
    expect(assets).toContain("cleanup_firewall(old_firewall)")
    expect(assets).toContain("cleanup_firewall(firewall_state)")
    expect(assets).toContain("apply_firewall(")
    expect(assets).not.toContain("--dport', '3128'")
  })

  it('prefers a directly verifiable iptables INPUT guard ahead of distro firewall wrappers', () => {
    const descriptorStart = assets.indexOf('def firewall_descriptor')
    const descriptorEnd = assets.indexOf('def cleanup_ufw', descriptorStart)
    const descriptor = assets.slice(descriptorStart, descriptorEnd)
    expect(descriptor.indexOf("ipt = iptables_driver()")).toBeGreaterThanOrEqual(0)
    expect(descriptor.indexOf("ipt = iptables_driver()")).toBeLessThan(descriptor.indexOf("if ufw_active():"))
    expect(assets).toContain('def verify_firewall(descriptor):')
    expect(assets).toContain("iptables', '-C', 'INPUT'")
    expect(assets).toContain("raise RuntimeError(f\"Host firewall không xác minh được rule TCP")
    expect(assets).toContain('def listeners_ready(mappings):')
    expect(assets).toContain('Proxy service active nhưng chưa LISTEN đủ port đã tạo.')
  })

  it('persists managed iptables/nft firewall rules and classifies Windows timeout as cloud firewall blocking', () => {
    expect(assets).toContain("def restore_firewall(manifest):")
    expect(assets).toContain("driver == 'iptables'")
    expect(assets).toContain("driver == 'nft-native'")
    expect(assets).toContain("'firewall': firewall_state")
    expect(service).toContain('isCloudFirewallTimeout')
    expect(service).toContain('Cloud firewall / Security List / NSG đang chặn port.')
    expect(service).toContain('remote.firewall.start_port')
    expect(service).toContain('remote.firewall.end_port')
  })


  it('tests from Windows first and opens OCI ingress through Instance Principal only on timeout', () => {
    const verifyIndex = service.indexOf('verifyProvisionedProxies(remote, input.proxyAuth)')
    const ociIndex = service.indexOf("['ensure-ingress', remote.cloud.vnicId")
    expect(service).toContain("remote.cloud?.provider === 'oci'")
    expect(service).toContain("status: 'failed'")
    expect(service).not.toContain('Máy này chưa có ~/.oci/config')
    expect(service).not.toContain('ensureOciSecurityListIngress')
    expect(service).toContain('const ingress = await runRemoteOciHelper<RemoteOciIngressResult>')
    expect(service).toContain("if (!ingress.verified)")
    expect(service).toContain("status: externalDead === 0 ? 'completed' : 'failed'")
    expect(service).toContain("phase: externalDead === 0 ? 'complete' : 'self_test'")
    expect(service).not.toContain('Có thể NSG hoặc cloud firewall khác vẫn đang chặn port.')
    expect(verifyIndex).toBeGreaterThan(0)
    expect(ociIndex).toBeGreaterThan(verifyIndex)
    expect(ociService).toContain("join(homeDirectory, '.oci', 'config')")
  })

})
