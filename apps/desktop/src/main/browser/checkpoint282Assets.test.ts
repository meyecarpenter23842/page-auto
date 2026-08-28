import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkpoint282CanonicalFolder,
  inspectCheckpoint282ImageReadiness,
  sanitizeCheckpoint282AssetKey
} from './checkpoint282Assets'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'page-auto-cp282-'))
  roots.push(root)
  return root
}

describe('checkpoint282 assets', () => {
  it('keeps the canonical Folder282 under the portable data root', () => {
    expect(checkpoint282CanonicalFolder(join('F:', 'Page-Auto', 'data'))).toBe(
      join('F:', 'Page-Auto', 'data', 'checkpoint-assets', '282')
    )
  })

  it('sanitizes account identifiers before using them as file names', () => {
    expect(sanitizeCheckpoint282AssetKey(' user/name:*? ')).toBe('user_name___')
    expect(sanitizeCheckpoint282AssetKey('CON')).toBe('_CON')
  })

  it('always prefers one canonical UID image over source-folder images', () => {
    const root = tempRoot()
    const source = join(root, 'source')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'new.jpg'), 'source')
    const canonical = checkpoint282CanonicalFolder(root)
    mkdirSync(canonical, { recursive: true })
    writeFileSync(join(canonical, '123456.png'), 'canonical')

    const result = inspectCheckpoint282ImageReadiness({ dataDirectory: root, uid: '123456', sourceImageFolder: source })
    expect(result.state).toBe('canonical')
    expect(result.canonicalPath).toBe(join(canonical, '123456.png'))
    expect(result.sourceCandidateCount).toBe(1)
  })

  it('falls back to source readiness when canonical image is missing', () => {
    const root = tempRoot()
    const source = join(root, 'source')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'photo.jpeg'), 'source')

    const result = inspectCheckpoint282ImageReadiness({ dataDirectory: root, uid: '123456', sourceImageFolder: source })
    expect(result.state).toBe('source')
    expect(result.canonicalPath).toBeNull()
    expect(result.sourceCandidateCount).toBe(1)
  })

  it('blocks duplicate canonical UID images instead of choosing randomly', () => {
    const root = tempRoot()
    const canonical = checkpoint282CanonicalFolder(root)
    mkdirSync(canonical, { recursive: true })
    writeFileSync(join(canonical, '123456.jpg'), 'a')
    writeFileSync(join(canonical, '123456.png'), 'b')

    const result = inspectCheckpoint282ImageReadiness({ dataDirectory: root, uid: '123456', sourceImageFolder: null })
    expect(result.state).toBe('duplicate')
    expect(result.canonicalCandidateCount).toBe(2)
    expect(result.canonicalPath).toBeNull()
  })
})
