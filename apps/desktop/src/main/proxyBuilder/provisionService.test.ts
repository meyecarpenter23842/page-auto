import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const shared = readFileSync(new URL('../../shared/proxyBuilder.ts', import.meta.url), 'utf8')
const service = readFileSync(new URL('./provisionService.ts', import.meta.url), 'utf8')
const assets = readFileSync(new URL('./remoteAssets.ts', import.meta.url), 'utf8')

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

  it('uses the same Main-process SSH auth helper for provision/runtime connections', () => {
    expect(service).toContain("from './sshAuth'")
    expect(service).toContain('applyProxyBuilderSshAuth(config, input.auth)')
  })

  it('keeps password auth compatible with keyboard-interactive/PAM during provisioning', () => {
    expect(service).toContain('config.tryKeyboard = true')
    expect(service).toContain("this.client.on('keyboard-interactive'")
    expect(service).toContain('finish(prompts.map(() => password))')
  })

  it('keeps idempotency around the Page-Auto manifest and service', () => {
    expect(assets).toContain("MANIFEST = ETC_DIR / 'manifest.json'")
    expect(assets).toContain('old_manifest = load_json(MANIFEST, {})')
    expect(assets).toContain("systemctl', 'enable', SERVICE_NAME")
    expect(assets).toContain('restore_files(backup_dir, existed)')
  })
})
