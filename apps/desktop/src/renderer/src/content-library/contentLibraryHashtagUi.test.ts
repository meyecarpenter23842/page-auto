import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const libraryWorkspace = readFileSync(
  fileURLToPath(new URL('./ContentLibraryWorkspace.tsx', import.meta.url)),
  'utf8'
)
const pageWallWorkspace = readFileSync(
  fileURLToPath(new URL('../page-tabs/PageWallWorkspace.tsx', import.meta.url)),
  'utf8'
)

describe('canonical hashtag ownership UI', () => {
  it('edits hashtags only inside the shared Content Library workspace', () => {
    expect(libraryWorkspace).toContain('Hashtag cuối bài')
    expect(libraryWorkspace).toContain('hashtags: editor.hashtags.trim()')
    expect(libraryWorkspace).toContain('hashtags: source.hashtags ??')
  })

  it('does not add a Page Wall-owned hashtag editor', () => {
    expect(pageWallWorkspace).not.toContain('Hashtag cuối bài')
    expect(pageWallWorkspace).not.toContain('setHashtags')
  })
})
