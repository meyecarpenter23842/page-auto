import { extname, join, parse } from 'node:path'
import { readdir } from 'node:fs/promises'
import type { PageTabImageConfig } from '../../shared/pageTabs'
import type { RunItem, RunSnapshot } from '../../shared/runs'

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp'])

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

export function selectRunContent(snapshot: RunSnapshot, item: RunItem): string | null {
  const contents = snapshot.contents.map((content) => content.trim()).filter(Boolean)
  if (contents.length === 0) return null
  if (snapshot.contentMode === 'random') {
    return contents[deterministicIndex(`${item.runId}:${item.id}:${item.groupUid}`, contents.length)] ?? null
  }
  return contents[item.sortOrder % contents.length] ?? null
}

export interface ImageSelection {
  paths: string[]
  missing: boolean
}

export async function selectRunImages(
  image: PageTabImageConfig,
  item: RunItem
): Promise<ImageSelection> {
  const folder = image.folderPath.trim()
  if (!folder) return { paths: [], missing: false }

  let names: string[]
  try {
    names = (await readdir(folder, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && imageExtensions.has(extname(entry.name).toLowerCase()))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  } catch {
    return { paths: [], missing: true }
  }

  if (image.mode === 'filename_match') {
    const matched = names.filter((name) => parse(name).name.includes(item.groupUid))
    return {
      paths: matched.slice(0, image.imagesPerPost).map((name) => join(folder, name)),
      missing: matched.length < image.imagesPerPost
    }
  }

  if (names.length === 0) return { paths: [], missing: true }

  const start = image.mode === 'random'
    ? deterministicIndex(`${item.runId}:${item.id}:${item.groupUid}:image`, names.length)
    : (item.sortOrder * image.imagesPerPost) % names.length

  const selected: string[] = []
  for (let offset = 0; offset < Math.min(image.imagesPerPost, names.length); offset += 1) {
    const name = names[(start + offset) % names.length]
    if (name) selected.push(join(folder, name))
  }

  return { paths: selected, missing: selected.length < image.imagesPerPost }
}
