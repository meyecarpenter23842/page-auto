import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { selectZaloMedia } from './zaloMediaSelection'

const roots: string[] = []
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }) })

function folder(): string {
  const root = mkdtempSync(join(tmpdir(), 'page-auto-zalo-media-'))
  roots.push(root)
  return root
}

describe('Zalo per-post media selection', () => {
  it('selects sequential media from the post snapshot and reports missing folders', async () => {
    const root = folder()
    writeFileSync(join(root, '01.jpg'), 'a')
    writeFileSync(join(root, '02.png'), 'b')
    writeFileSync(join(root, '03.pdf'), 'c')

    const selected = await selectZaloMedia(
      { folderPath: root, mode: 'sequential', imagesPerTarget: 2, missingPolicy: 'skip' },
      { runId: 'r1', targetPhone: '0912345678', targetIndex: 0, postIndex: 0 }
    )
    expect(selected.missing).toBe(false)
    expect(selected.paths.map((path) => path.split(/[\\/]/).pop())).toEqual(['01.jpg', '02.png'])

    const missing = await selectZaloMedia(
      { folderPath: join(root, 'missing'), mode: 'sequential', imagesPerTarget: 1, missingPolicy: 'skip' },
      { runId: 'r1', targetPhone: '0912345678', targetIndex: 0, postIndex: 0 }
    )
    expect(missing).toEqual({ paths: [], missing: true })
  })

  it('supports canonical filename-match semantics using the Zalo target phone', async () => {
    const root = folder()
    writeFileSync(join(root, '0912345678-a.jpg'), 'a')
    writeFileSync(join(root, 'other.jpg'), 'b')
    const selected = await selectZaloMedia(
      { folderPath: root, mode: 'filename_match', imagesPerTarget: 1, missingPolicy: 'text_only' },
      { runId: 'r2', targetPhone: '0912345678', targetIndex: 0, postIndex: 0 }
    )
    expect(selected.missing).toBe(false)
    expect(selected.paths[0]?.endsWith('0912345678-a.jpg')).toBe(true)
  })
})
