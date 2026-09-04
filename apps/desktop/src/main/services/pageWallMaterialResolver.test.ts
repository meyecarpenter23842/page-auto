import { describe, expect, it } from 'vitest'
import type { PageWallCanonicalPostSelection } from '../../shared/pageWall'
import { PageWallMaterialResolver, type PageWallImageFileSource } from './pageWallMaterialResolver'

class FakeFiles implements PageWallImageFileSource {
  constructor(private readonly entries: Record<string, string[] | Error>) {}
  async list(folderPath: string): Promise<string[]> {
    const value = this.entries[folderPath]
    if (value instanceof Error) throw value
    return [...(value ?? [])]
  }
}

function selection(patch: Partial<PageWallCanonicalPostSelection> = {}): PageWallCanonicalPostSelection {
  return {
    postId: 101,
    postName: 'Bài canonical',
    variantIndex: 0,
    content: 'Nội dung A',
    image: {
      folderPath: 'C:\\media',
      mode: 'sequential',
      imagesPerPost: 2,
      missingPolicy: 'text_only'
    },
    ...patch
  }
}

describe('PageWallMaterialResolver', () => {
  it('materializes the selected canonical variant and concrete sequential image paths', async () => {
    const resolver = new PageWallMaterialResolver(new FakeFiles({
      'C:\\media': ['C:\\media\\01.jpg', 'C:\\media\\02.png', 'C:\\media\\03.webp']
    }))

    await expect(resolver.resolve(selection({ variantIndex: 2, content: '  Nội dung C  ' }))).resolves.toEqual({
      ok: true,
      material: {
        content: 'Nội dung C',
        imagePaths: ['C:\\media\\01.jpg', 'C:\\media\\02.png'],
        warnings: []
      }
    })
  })

  it('uses the canonical random image mode without mutating the source selection', async () => {
    const source = selection({
      image: { folderPath: 'D:\\photos', mode: 'random', imagesPerPost: 2, missingPolicy: 'text_only' }
    })
    const resolver = new PageWallMaterialResolver(new FakeFiles({
      'D:\\photos': ['D:\\photos\\a.jpg', 'D:\\photos\\b.jpg', 'D:\\photos\\c.jpg']
    }), () => 0.5)

    const result = await resolver.resolve(source)

    expect(result).toEqual({
      ok: true,
      material: {
        content: 'Nội dung A',
        imagePaths: ['D:\\photos\\b.jpg', 'D:\\photos\\c.jpg'],
        warnings: []
      }
    })
    expect(source.image).toEqual({ folderPath: 'D:\\photos', mode: 'random', imagesPerPost: 2, missingPolicy: 'text_only' })
  })

  it('keeps text-only fallback explicit when a canonical image folder is unavailable', async () => {
    const resolver = new PageWallMaterialResolver(new FakeFiles({
      'C:\\missing': new Error('ENOENT')
    }))

    const result = await resolver.resolve(selection({
      image: { folderPath: 'C:\\missing', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' }
    }))

    expect(result).toMatchObject({
      ok: true,
      material: { content: 'Nội dung A', imagePaths: [] }
    })
    if (result.ok) expect(result.material.warnings[0]).toContain('folder ảnh canonical')
  })

  it('rejects Group UID filename matching because Page Wall has no Group target', async () => {
    const resolver = new PageWallMaterialResolver(new FakeFiles({}))

    await expect(resolver.resolve(selection({
      image: { folderPath: 'C:\\media', mode: 'filename_match', imagesPerPost: 1, missingPolicy: 'text_only' }
    }))).resolves.toMatchObject({
      ok: false,
      code: 'media_failed'
    })
  })

  it('honors skip-on-missing instead of silently scheduling incomplete canonical media', async () => {
    const resolver = new PageWallMaterialResolver(new FakeFiles({
      'C:\\media': ['C:\\media\\only.jpg']
    }))

    await expect(resolver.resolve(selection({
      image: { folderPath: 'C:\\media', mode: 'sequential', imagesPerPost: 2, missingPolicy: 'skip' }
    }))).resolves.toMatchObject({
      ok: false,
      code: 'missing_media'
    })
  })
})
