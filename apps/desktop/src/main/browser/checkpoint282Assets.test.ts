import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FacebookCheckpoint282Result, FacebookCheckpoint282RunAsset } from '../../shared/facebookCheckpoint'
import {
  appendCheckpoint282History,
  checkpoint282CanonicalFolder,
  finalizeCheckpoint282AssetRun,
  inspectCheckpoint282ImageReadiness,
  readCheckpoint282AssetPreview,
  readCheckpoint282History,
  resolveCheckpoint282CanonicalConflict,
  sanitizeCheckpoint282AssetKey,
  validateCheckpoint282RunAsset
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

function resolvedResult(uid = '123456', verification: FacebookCheckpoint282Result['identityVerification'] = 'uid_match'): FacebookCheckpoint282Result {
  return {
    accountId: 1,
    uid,
    state: 'resolved',
    surface: 'mbasic',
    identityVerification: verification,
    message: 'resolved'
  }
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
    expect(result.canonicalCandidates).toEqual([join(canonical, '123456.png')])
    expect(result.sourceCandidates).toEqual([join(source, 'new.jpg')])
  })

  it('falls back to source readiness without choosing a random source image', () => {
    const root = tempRoot()
    const source = join(root, 'source')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'photo-b.jpeg'), 'source-b')
    writeFileSync(join(source, 'photo-a.jpg'), 'source-a')

    const result = inspectCheckpoint282ImageReadiness({ dataDirectory: root, uid: '123456', sourceImageFolder: source })
    expect(result.state).toBe('source')
    expect(result.canonicalPath).toBeNull()
    expect(result.sourceCandidateCount).toBe(2)
    expect(result.sourceCandidates.map((path) => basename(path))).toEqual(['photo-a.jpg', 'photo-b.jpeg'])
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

  it('previews only the selected image as a bounded data URL', () => {
    const root = tempRoot()
    const image = join(root, 'photo.png')
    writeFileSync(image, 'png-data')
    const preview = readCheckpoint282AssetPreview(image)
    expect(preview.fileName).toBe('photo.png')
    expect(preview.mimeType).toBe('image/png')
    expect(preview.dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('requires a unique canonical path when a run claims canonical origin', () => {
    const root = tempRoot()
    const canonical = checkpoint282CanonicalFolder(root)
    mkdirSync(canonical, { recursive: true })
    const path = join(canonical, '123456.jpg')
    writeFileSync(path, 'canonical')
    expect(validateCheckpoint282RunAsset({
      dataDirectory: root,
      uid: '123456',
      asset: { path, origin: 'canonical', replaceCanonical: false, confirmedUsed: false }
    }).path).toBe(path)
  })

  it('does not promote a source image until operator confirms it was used', () => {
    const root = tempRoot()
    const source = join(root, 'source.jpg')
    writeFileSync(source, 'source-image')
    const asset: FacebookCheckpoint282RunAsset = {
      path: source,
      origin: 'source',
      replaceCanonical: false,
      confirmedUsed: false
    }
    const promotion = finalizeCheckpoint282AssetRun({ dataDirectory: root, uid: '123456', asset, result: resolvedResult() })
    expect(promotion?.state).toBe('skipped_unconfirmed')
    expect(existsSync(join(checkpoint282CanonicalFolder(root), '123456.jpg'))).toBe(false)
  })

  it('does not promote when resolved identity is session-only', () => {
    const root = tempRoot()
    const source = join(root, 'source.jpg')
    writeFileSync(source, 'source-image')
    const promotion = finalizeCheckpoint282AssetRun({
      dataDirectory: root,
      uid: 'username-only',
      asset: { path: source, origin: 'source', replaceCanonical: false, confirmedUsed: true },
      result: resolvedResult('username-only', 'session_only')
    })
    expect(promotion?.state).toBe('skipped_unverified')
  })

  it('promotes the confirmed source image only after resolved UID verification', () => {
    const root = tempRoot()
    const source = join(root, 'source.png')
    writeFileSync(source, 'actual-used-image')
    const promotion = finalizeCheckpoint282AssetRun({
      dataDirectory: root,
      uid: '123456',
      asset: { path: source, origin: 'source', replaceCanonical: false, confirmedUsed: true },
      result: resolvedResult()
    })
    const canonical = join(checkpoint282CanonicalFolder(root), '123456.png')
    expect(promotion?.state).toBe('promoted')
    expect(promotion?.canonicalPath).toBe(canonical)
    expect(readFileSync(canonical, 'utf8')).toBe('actual-used-image')
  })

  it('archives the previous canonical file when an explicit replacement succeeds', () => {
    const root = tempRoot()
    const canonicalFolder = checkpoint282CanonicalFolder(root)
    mkdirSync(canonicalFolder, { recursive: true })
    writeFileSync(join(canonicalFolder, '123456.jpg'), 'old')
    const source = join(root, 'replacement.png')
    writeFileSync(source, 'new')

    const promotion = finalizeCheckpoint282AssetRun({
      dataDirectory: root,
      uid: '123456',
      asset: { path: source, origin: 'source', replaceCanonical: true, confirmedUsed: true },
      result: resolvedResult()
    })
    expect(promotion?.state).toBe('replaced')
    expect(promotion?.archivedPaths?.length).toBe(1)
    expect(readFileSync(join(canonicalFolder, '123456.png'), 'utf8')).toBe('new')
    expect(readFileSync(promotion?.archivedPaths?.[0] ?? '', 'utf8')).toBe('old')
  })

  it('resolves duplicate canonical assets by keeping the selected candidate and archiving the others', () => {
    const root = tempRoot()
    const canonical = checkpoint282CanonicalFolder(root)
    mkdirSync(canonical, { recursive: true })
    const keep = join(canonical, '123456.jpg')
    const archive = join(canonical, '123456.png')
    writeFileSync(keep, 'keep')
    writeFileSync(archive, 'archive')

    const result = resolveCheckpoint282CanonicalConflict({ dataDirectory: root, uid: '123456', keepPath: keep })
    expect(result.canonicalPath).toBe(keep)
    expect(result.archivedPaths).toHaveLength(1)
    expect(existsSync(keep)).toBe(true)
    expect(existsSync(archive)).toBe(false)
    expect(inspectCheckpoint282ImageReadiness({ dataDirectory: root, uid: '123456', sourceImageFolder: null }).state).toBe('canonical')
  })

  it('stores per-account CP282 history without secrets', () => {
    const root = tempRoot()
    appendCheckpoint282History(root, {
      id: 'entry-1',
      at: 123,
      accountId: 1,
      uid: '123456',
      action: 'recheck',
      state: 'resolved',
      message: 'verified',
      assetPath: 'F:\\source\\photo.jpg',
      assetOrigin: 'source',
      assetConfirmedUsed: true,
      promotionState: 'promoted',
      canonicalPath: 'F:\\data\\checkpoint-assets\\282\\123456.jpg',
      evidencePath: null
    })
    expect(readCheckpoint282History(root, '123456')).toEqual([
      expect.objectContaining({ id: 'entry-1', state: 'resolved', promotionState: 'promoted' })
    ])
  })
})
