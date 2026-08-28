import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { FacebookCheckpoint282ImagePreflight } from '../../shared/checkpoint282Workbench'

const SUPPORTED_CP282_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png'])
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function checkpoint282CanonicalFolder(dataDirectory: string): string {
  return join(dataDirectory, 'checkpoint-assets', '282')
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
  } catch {
    return []
  }
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
  const assetKey = sanitizeCheckpoint282AssetKey(input.uid)
  const canonicalMatches = imageFiles(canonicalFolder)
    .filter((name) => name.slice(0, -extname(name).length).toLowerCase() === assetKey.toLowerCase())
    .map((name) => join(canonicalFolder, name))
  const sourceFolder = input.sourceImageFolder?.trim() || null
  const sourceCandidates = sourceFolder ? imageFiles(sourceFolder) : []

  if (canonicalMatches.length > 1) {
    return {
      state: 'duplicate',
      canonicalFolder,
      canonicalPath: null,
      canonicalCandidateCount: canonicalMatches.length,
      sourceFolder,
      sourceCandidateCount: sourceCandidates.length
    }
  }
  if (canonicalMatches.length === 1) {
    return {
      state: 'canonical',
      canonicalFolder,
      canonicalPath: canonicalMatches[0] ?? null,
      canonicalCandidateCount: 1,
      sourceFolder,
      sourceCandidateCount: sourceCandidates.length
    }
  }
  if (sourceCandidates.length > 0) {
    return {
      state: 'source',
      canonicalFolder,
      canonicalPath: null,
      canonicalCandidateCount: 0,
      sourceFolder,
      sourceCandidateCount: sourceCandidates.length
    }
  }
  return {
    state: 'missing',
    canonicalFolder,
    canonicalPath: null,
    canonicalCandidateCount: 0,
    sourceFolder,
    sourceCandidateCount: 0
  }
}
