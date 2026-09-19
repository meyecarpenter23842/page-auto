import { describe, expect, it } from 'vitest'
import { buildNativeOpenSshArgs, resolveWindowsOpenSshExecutable, summarizeNativeOpenSshProbe } from './nativeOpenSsh'

describe('Proxy Builder Windows OpenSSH transport', () => {
  it('pins the Windows system OpenSSH binary before PATH fallback', () => {
    const expected = 'C:\\Windows\\System32\\OpenSSH\\ssh.exe'
    expect(resolveWindowsOpenSshExecutable('C:\\Windows', (candidate) => candidate === expected)).toBe(expected)
  })

  it('falls back to PATH only when Windows system OpenSSH is unavailable', () => {
    expect(resolveWindowsOpenSshExecutable('C:\\Windows', () => false)).toBe('ssh.exe')
  })

  it('pins the exact selected identity and publickey-only authentication', () => {
    const args = buildNativeOpenSshArgs({
      host: '140.238.155.28',
      username: 'ubuntu',
      auth: { type: 'key', privateKey: '', privateKeyPath: 'F:\\\\keys\\\\mcp-vps-ed25519' }
    }, 'true')

    expect(args).toContain('IdentitiesOnly=yes')
    expect(args).toContain('PreferredAuthentications=publickey')
    expect(args).toContain('PasswordAuthentication=no')
    expect(args).toContain('KbdInteractiveAuthentication=no')
    expect(args).toContain('F:\\\\keys\\\\mcp-vps-ed25519')
    expect(args).toContain('ubuntu@140.238.155.28')
    expect(args.at(-1)).toBe('true')
  })

  it('adds -vvv only for diagnostic probes', () => {
    const input = {
      host: '140.238.155.28',
      username: 'ubuntu',
      auth: { type: 'key' as const, privateKey: '', privateKeyPath: 'F:\\\\keys\\\\mcp-vps-ed25519' }
    }
    expect(buildNativeOpenSshArgs(input, 'true')).not.toContain('-vvv')
    expect(buildNativeOpenSshArgs(input, 'true', { verbose: true })[0]).toBe('-vvv')
  })

  it('extracts offered/accepted fingerprints and authenticated stage from verbose trace', () => {
    const fingerprint = 'SHA256:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/Test'
    const probe = summarizeNativeOpenSshProbe('auth_true', 'true', {
      stdout: '',
      stderr: [
        `debug1: Offering public key: key ED25519 ${fingerprint} explicit`,
        `debug1: Server accepts key: key ED25519 ${fingerprint} explicit`,
        'Authenticated to 140.238.155.28 ([140.238.155.28]:22) using "publickey".'
      ].join('\\n'),
      code: 0,
      executable: 'C:\\\\Windows\\\\System32\\\\OpenSSH\\\\ssh.exe',
      version: 'OpenSSH_for_Windows_9.5p1',
      args: ['-vvv', 'ubuntu@140.238.155.28', 'true']
    })
    expect(probe.offeredFingerprints).toEqual([fingerprint])
    expect(probe.acceptedFingerprints).toEqual([fingerprint])
    expect(probe.authenticated).toBe(true)
    expect(probe.exitCode).toBe(0)
  })

  it('rejects native transport args without a selected key path', () => {
    expect(() => buildNativeOpenSshArgs({
      host: '140.238.155.28',
      username: 'ubuntu',
      auth: { type: 'key', privateKey: 'pasted-key' }
    }, 'true')).toThrow('Native OpenSSH cần SSH key file đã chọn.')
  })
})
