import { readdir } from 'node:fs/promises'
import { extname, join, parse } from 'node:path'
import type { ZaloBatchMediaSnapshot } from '../../shared/zalo'

const mediaExtensions = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.zip', '.rar', '.7z'
])

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
}

export async function selectZaloMedia(
  media: ZaloBatchMediaSnapshot,
  input: ZaloMediaSelectionInput
): Promise<ZaloMediaSelection> {
  const folder = media.folderPath.trim()
  if (!folder) return { paths: [], missing: false }

  let names: string[]
  try {
    names = (await readdir(folder, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && mediaExtensions.has(extname(entry.name).toLowerCase()))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  } catch {
    return { paths: [], missing: true }
  }

  if (media.mode === 'filename_match') {
    const matched = names.filter((name) => parse(name).name.includes(input.targetPhone))
    return {
      paths: matched.slice(0, media.imagesPerTarget).map((name) => join(folder, name)),
      missing: matched.length < media.imagesPerTarget
    }
  }

  if (!names.length) return { paths: [], missing: true }

  const start = media.mode === 'random'
    ? deterministicIndex(
        input.runId + ':' + input.targetIndex + ':' + input.postIndex + ':' + input.targetPhone,
        names.length
      )
    : (input.targetIndex * media.imagesPerTarget) % names.length

  const selected: string[] = []
  for (let offset = 0; offset < Math.min(media.imagesPerTarget, names.length); offset += 1) {
    const name = names[(start + offset) % names.length]
    if (name) selected.push(join(folder, name))
  }

  return { paths: selected, missing: selected.length < media.imagesPerTarget }
}
