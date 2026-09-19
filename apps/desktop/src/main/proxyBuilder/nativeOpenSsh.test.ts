import { describe, expect, it } from 'vitest'
import { buildNativeOpenSshArgs, resolveWindowsOpenSshExecutable } from './nativeOpenSsh'

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

  it('rejects native transport args without a selected key path', () => {
    expect(() => buildNativeOpenSshArgs({
      host: '140.238.155.28',
      username: 'ubuntu',
      auth: { type: 'key', privateKey: 'pasted-key' }
    }, 'true')).toThrow('Native OpenSSH cần SSH key file đã chọn.')
  })
})
