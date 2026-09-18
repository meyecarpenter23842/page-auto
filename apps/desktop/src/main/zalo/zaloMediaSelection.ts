import { readdir } from 'node:fs/promises'
import { extname, join, parse, relative } from 'node:path'
import type { ZaloBatchMediaSnapshot } from '../../shared/zalo'

const mediaExtensions = new Set([
  '.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.bmp', '.avif', '.heic', '.heif',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.zip', '.rar', '.7z'
])

const MAX_MEDIA_SCAN_DEPTH = 5
const MAX_MEDIA_FILES = 5_000

interface MediaFile {
  absolutePath: string
  relativePath: string
  name: string
}

async function listMediaFiles(root: string): Promise<MediaFile[]> {
  const files: MediaFile[] = []
  const stack: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }]

  while (stack.length && files.length < MAX_MEDIA_FILES) {
    const current = stack.pop()!
    const entries = await readdir(current.directory, { withFileTypes: true })

    for (const entry of entries) {
      if (files.length >= MAX_MEDIA_FILES) break
      const absolutePath = join(current.directory, entry.name)

      if (entry.isFile()) {
        if (!mediaExtensions.has(extname(entry.name).toLowerCase())) continue
        files.push({
          absolutePath,
          relativePath: relative(root, absolutePath),
          name: entry.name
        })
        continue
      }

      if (entry.isDirectory() && current.depth < MAX_MEDIA_SCAN_DEPTH) {
        stack.push({ directory: absolutePath, depth: current.depth + 1 })
      }
    }
  }

  return files.sort((left, right) => left.relativePath.localeCompare(
    right.relativePath,
    undefined,
    { numeric: true, sensitivity: 'base' }
  ))
}

function hashSeed(value: string): number {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function deterministicIndex(seed: string, length: number): number {
  return length === 0 ? 0 : hashSeed(seed) % length
}

export interface ZaloMediaSelectionInput {
  runId: string
  targetPhone: string
  targetIndex: number
  postIndex: number
}

export interface ZaloMediaSelection {
  paths: string[]
  missing: boolean
  reason: 'none' | 'folder_unreadable' | 'no_supported_files' | 'insufficient_files'
  discoveredCount: number
}

export async function selectZaloMedia(
  media: ZaloBatchMediaSnapshot,
  input: ZaloMediaSelectionInput
): Promise<ZaloMediaSelection> {
  const folder = media.folderPath.trim()
  if (!folder) return { paths: [], missing: false, reason: 'none', discoveredCount: 0 }

  let files: MediaFile[]
  try {
    files = await listMediaFiles(folder)
  } catch {
    return { paths: [], missing: true, reason: 'folder_unreadable', discoveredCount: 0 }
  }

  if (media.mode === 'filename_match') {
    const matched = files.filter((file) => parse(file.name).name.includes(input.targetPhone))
    const selected = matched.slice(0, media.imagesPerTarget).map((file) => file.absolutePath)
    return {
      paths: selected,
      missing: selected.length < media.imagesPerTarget,
      reason: selected.length === 0
        ? 'no_supported_files'
        : selected.length < media.imagesPerTarget
          ? 'insufficient_files'
          : 'none',
      discoveredCount: files.length
    }
  }

  if (!files.length) {
    return { paths: [], missing: true, reason: 'no_supported_files', discoveredCount: 0 }
  }

  const start = media.mode === 'random'
    ? deterministicIndex(
        input.runId + ':' + input.targetIndex + ':' + input.postIndex + ':' + input.targetPhone,
        files.length
      )
    : (input.targetIndex * media.imagesPerTarget) % files.length

  const selected: string[] = []
  for (let offset = 0; offset < Math.min(media.imagesPerTarget, files.length); offset += 1) {
    const file = files[(start + offset) % files.length]
    if (file) selected.push(file.absolutePath)
  }

  return {
    paths: selected,
    missing: selected.length < media.imagesPerTarget,
    reason: selected.length < media.imagesPerTarget ? 'insufficient_files' : 'none',
    discoveredCount: files.length
  }
}
