import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  FacebookCheckpoint282AssetPromotion,
  FacebookCheckpoint282Result,
  FacebookCheckpoint282RunAsset
} from '../../shared/facebookCheckpoint'
import type {
  FacebookCheckpoint282AssetPreview,
  FacebookCheckpoint282HistoryEntry,
  FacebookCheckpoint282ImagePreflight
} from '../../shared/checkpoint282Workbench'

const SUPPORTED_CP282_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png'])
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const MAX_CP282_PREVIEW_BYTES = 10 * 1024 * 1024

class Checkpoint282AssetConflictError extends Error {}

export function checkpoint282CanonicalFolder(dataDirectory: string): string {
  return join(dataDirectory, 'checkpoint-assets', '282')
}

function checkpoint282HistoryFolder(dataDirectory: string): string {
  return join(checkpoint282CanonicalFolder(dataDirectory), '.history')
}

function checkpoint282ArchiveFolder(dataDirectory: string, uid: string): string {
  return join(checkpoint282CanonicalFolder(dataDirectory), '.archive', sanitizeCheckpoint282AssetKey(uid))
}

export function sanitizeCheckpoint282AssetKey(identifier: string): string {
  const normalized = identifier
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 180)
  const safe = normalized || 'unknown-account'
  return WINDOWS_RESERVED_NAMES.test(safe) ? `_${safe}` : safe
}

function imageFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && SUPPORTED_CP282_IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

function canonicalMatches(dataDirectory: string, uid: string): string[] {
  const canonicalFolder = ensureCheckpoint282CanonicalFolder(dataDirectory)
  const assetKey = sanitizeCheckpoint282AssetKey(uid)
  return imageFiles(canonicalFolder)
    .filter((name) => name.slice(0, -extname(name).length).toLowerCase() === assetKey.toLowerCase())
    .map((name) => join(canonicalFolder, name))
}

function sourceCandidates(sourceImageFolder: string | null | undefined): string[] {
  const sourceFolder = sourceImageFolder?.trim() || null
  return sourceFolder ? imageFiles(sourceFolder).map((name) => join(sourceFolder, name)) : []
}

function normalizedPath(path: string): string {
  return resolve(path)
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? normalizedPath(left).toLowerCase() === normalizedPath(right).toLowerCase()
    : normalizedPath(left) === normalizedPath(right)
}

function isPathInside(parent: string, child: string): boolean {
  const result = relative(normalizedPath(parent), normalizedPath(child))
  return result === '' || (!result.startsWith('..') && !isAbsolute(result))
}

function assertSupportedImage(path: string): void {
  const extension = extname(path).toLowerCase()
  if (!SUPPORTED_CP282_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error('Ảnh CP282 chỉ hỗ trợ JPG/JPEG/PNG.')
  }
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error('Ảnh CP282 không còn tồn tại.')
}

function mimeTypeFor(path: string): 'image/jpeg' | 'image/png' {
  return extname(path).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg'
}

export function ensureCheckpoint282CanonicalFolder(dataDirectory: string): string {
  const folder = checkpoint282CanonicalFolder(dataDirectory)
  mkdirSync(folder, { recursive: true })
  return folder
}

export function inspectCheckpoint282ImageReadiness(input: {
  dataDirectory: string
  uid: string
  sourceImageFolder: string | null
}): FacebookCheckpoint282ImagePreflight {
  const canonicalFolder = ensureCheckpoint282CanonicalFolder(input.dataDirectory)
  const canonicalCandidates = canonicalMatches(input.dataDirectory, input.uid)
  const sourceFolder = input.sourceImageFolder?.trim() || null
  const sourceImageCandidates = sourceCandidates(sourceFolder)

  if (canonicalCandidates.length > 1) {
    return {
      state: 'duplicate',
      canonicalFolder,
      canonicalPath: null,
      canonicalCandidateCount: canonicalCandidates.length,
      canonicalCandidates,
      sourceFolder,
      sourceCandidateCount: sourceImageCandidates.length,
      sourceCandidates: sourceImageCandidates
    }
  }
  if (canonicalCandidates.length === 1) {
    return {
      state: 'canonical',
      canonicalFolder,
      canonicalPath: canonicalCandidates[0] ?? null,
      canonicalCandidateCount: 1,
      canonicalCandidates,
      sourceFolder,
      sourceCandidateCount: sourceImageCandidates.length,
      sourceCandidates: sourceImageCandidates
    }
  }
  if (sourceImageCandidates.length > 0) {
    return {
      state: 'source',
      canonicalFolder,
      canonicalPath: null,
      canonicalCandidateCount: 0,
      canonicalCandidates: [],
      sourceFolder,
      sourceCandidateCount: sourceImageCandidates.length,
      sourceCandidates: sourceImageCandidates
    }
  }
  return {
    state: 'missing',
    canonicalFolder,
    canonicalPath: null,
    canonicalCandidateCount: 0,
    canonicalCandidates: [],
    sourceFolder,
    sourceCandidateCount: 0,
    sourceCandidates: []
  }
}

export function readCheckpoint282AssetPreview(path: string): FacebookCheckpoint282AssetPreview {
  const normalized = path.trim()
  if (!normalized) throw new Error('Chưa chọn ảnh CP282 để preview.')
  assertSupportedImage(normalized)
  const bytes = statSync(normalized).size
  if (bytes > MAX_CP282_PREVIEW_BYTES) throw new Error('Ảnh CP282 lớn hơn giới hạn preview 10 MB.')
  const mimeType = mimeTypeFor(normalized)
  return {
    path: normalized,
    fileName: basename(normalized),
    mimeType,
    dataUrl: `data:${mimeType};base64,${readFileSync(normalized).toString('base64')}`,
    bytes
  }
}

export function validateCheckpoint282RunAsset(input: {
  dataDirectory: string
  uid: string
  asset: FacebookCheckpoint282RunAsset
}): FacebookCheckpoint282RunAsset {
  const path = input.asset.path.trim()
  if (!path) throw new Error('Chưa chọn ảnh cụ thể cho account CP282.')
  assertSupportedImage(path)

  if (input.asset.origin === 'canonical') {
    const matches = canonicalMatches(input.dataDirectory, input.uid)
    if (matches.length !== 1 || !matches[0] || !samePath(matches[0], path)) {
      throw new Error('Ảnh canonical đã thay đổi hoặc đang bị trùng; chạy Preflight lại trước khi tiếp tục.')
    }
    if (input.asset.replaceCanonical) throw new Error('Ảnh canonical không thể tự đánh dấu là replacement.')
  } else {
    const canonicalFolder = checkpoint282CanonicalFolder(input.dataDirectory)
    if (isPathInside(canonicalFolder, path)) {
      throw new Error('Ảnh source/replacement không được trỏ ngược vào Folder282.')
    }
  }

  return {
    path,
    origin: input.asset.origin,
    replaceCanonical: Boolean(input.asset.replaceCanonical),
    confirmedUsed: Boolean(input.asset.confirmedUsed)
  }
}

function archiveCanonicalFiles(input: {
  dataDirectory: string
  uid: string
  paths: string[]
  reason: string
}): string[] {
  if (input.paths.length === 0) return []
  const stamp = `${Date.now()}-${input.reason}`
  const archiveFolder = join(checkpoint282ArchiveFolder(input.dataDirectory, input.uid), stamp)
  mkdirSync(archiveFolder, { recursive: true })
  const archived: string[] = []
  for (const path of input.paths) {
    const target = join(archiveFolder, basename(path))
    copyFileSync(path, target)
    rmSync(path, { force: true })
    archived.push(target)
  }
  return archived
}

export function promoteCheckpoint282Asset(input: {
  dataDirectory: string
  uid: string
  selectedPath: string
  replaceExisting: boolean
}): FacebookCheckpoint282AssetPromotion {
  assertSupportedImage(input.selectedPath)
  const canonicalFolder = ensureCheckpoint282CanonicalFolder(input.dataDirectory)
  if (isPathInside(canonicalFolder, input.selectedPath)) {
    throw new Error('Chỉ ảnh source/replacement mới được promote vào Folder282.')
  }

  const existing = canonicalMatches(input.dataDirectory, input.uid)
  if (existing.length > 0 && !input.replaceExisting) {
    throw new Checkpoint282AssetConflictError('Folder282 đã có canonical asset; không overwrite khi chưa chọn Replace rõ ràng.')
  }

  const extension = extname(input.selectedPath).toLowerCase()
  const canonicalPath = join(canonicalFolder, `${sanitizeCheckpoint282AssetKey(input.uid)}${extension}`)
  const temporaryPath = join(canonicalFolder, `.${sanitizeCheckpoint282AssetKey(input.uid)}-${randomUUID()}.tmp`)
  copyFileSync(input.selectedPath, temporaryPath)

  let archivedPaths: string[] = []
  try {
    archivedPaths = archiveCanonicalFiles({
      dataDirectory: input.dataDirectory,
      uid: input.uid,
      paths: existing,
      reason: 'replace'
    })
    renameSync(temporaryPath, canonicalPath)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }

  const replaced = existing.length > 0
  return {
    state: replaced ? 'replaced' : 'promoted',
    message: replaced
      ? 'Đã thay canonical asset sau khi CP282 resolved và UID được xác minh.'
      : 'Đã promote ảnh thực tế dùng thành canonical asset sau khi CP282 resolved và UID được xác minh.',
    canonicalPath,
    archivedPaths
  }
}

export function resolveCheckpoint282CanonicalConflict(input: {
  dataDirectory: string
  uid: string
  keepPath: string
}): { canonicalPath: string; archivedPaths: string[] } {
  const matches = canonicalMatches(input.dataDirectory, input.uid)
  if (matches.length <= 1) throw new Error('Account hiện không có duplicate canonical asset cần xử lý.')
  const keep = matches.find((path) => samePath(path, input.keepPath))
  if (!keep) throw new Error('Ảnh được chọn không còn nằm trong nhóm duplicate canonical hiện tại.')
  const archivedPaths = archiveCanonicalFiles({
    dataDirectory: input.dataDirectory,
    uid: input.uid,
    paths: matches.filter((path) => !samePath(path, keep)),
    reason: 'duplicate'
  })
  return { canonicalPath: keep, archivedPaths }
}

export function finalizeCheckpoint282AssetRun(input: {
  dataDirectory: string
  uid: string
  asset: FacebookCheckpoint282RunAsset | null | undefined
  result: FacebookCheckpoint282Result
}): FacebookCheckpoint282AssetPromotion | undefined {
  const asset = input.asset
  if (!asset || input.result.state !== 'resolved') return undefined

  if (asset.origin === 'canonical') {
    return {
      state: 'not_needed',
      message: 'Account đã dùng canonical asset; không cần promote lại.',
      canonicalPath: asset.path,
      archivedPaths: []
    }
  }
  if (!asset.confirmedUsed) {
    return {
      state: 'skipped_unconfirmed',
      message: 'CP282 đã resolved nhưng operator chưa xác nhận đã dùng đúng ảnh đang track; không promote.',
      canonicalPath: null,
      archivedPaths: []
    }
  }
  if (input.result.identityVerification !== 'uid_match') {
    return {
      state: 'skipped_unverified',
      message: 'CP282 đã resolved nhưng chưa đối chiếu được c_user đúng UID số; không promote canonical.',
      canonicalPath: null,
      archivedPaths: []
    }
  }

  try {
    return promoteCheckpoint282Asset({
      dataDirectory: input.dataDirectory,
      uid: input.uid,
      selectedPath: asset.path,
      replaceExisting: asset.replaceCanonical
    })
  } catch (error) {
    return {
      state: error instanceof Checkpoint282AssetConflictError ? 'conflict' : 'error',
      message: error instanceof Error ? error.message : String(error),
      canonicalPath: null,
      archivedPaths: []
    }
  }
}

function historyFile(dataDirectory: string, uid: string): string {
  return join(checkpoint282HistoryFolder(dataDirectory), `${sanitizeCheckpoint282AssetKey(uid)}.jsonl`)
}

export function appendCheckpoint282History(dataDirectory: string, entry: FacebookCheckpoint282HistoryEntry): void {
  const folder = checkpoint282HistoryFolder(dataDirectory)
  mkdirSync(folder, { recursive: true })
  appendFileSync(historyFile(dataDirectory, entry.uid), `${JSON.stringify(entry)}\n`, 'utf8')
}

export function readCheckpoint282History(
  dataDirectory: string,
  uid: string,
  limit = 50
): FacebookCheckpoint282HistoryEntry[] {
  const path = historyFile(dataDirectory, uid)
  if (!existsSync(path)) return []
  try {
    const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit)))
    return readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as FacebookCheckpoint282HistoryEntry
        } catch {
          return null
        }
      })
      .filter((entry): entry is FacebookCheckpoint282HistoryEntry => Boolean(entry && entry.uid === uid))
      .slice(-safeLimit)
      .reverse()
  } catch {
    return []
  }
}
