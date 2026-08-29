import { describe, expect, it } from 'vitest'
import type { ContentLibrarySetDetails } from '../../../shared/contentLibrary'
import { buildContentLibraryPreviewRows } from './ContentLibraryActionField'

function details(): ContentLibrarySetDetails {
  return {
    id: 5,
    name: 'Bộ bán hàng',
    itemCount: 5,
    enabledCount: 4,
    createdAt: 1,
    updatedAt: 2,
    items: [
      {
        id: 11,
        contentSetId: 5,
        sortOrder: 2,
        name: 'Bài thứ ba',
        enabled: true,
        variants: ['Nội dung thứ ba'],
        image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 9,
        contentSetId: 5,
        sortOrder: 0,
        name: 'Bài đầu',
        enabled: true,
        variants: ['  Nội dung đầu tiên  '],
        image: { folderPath: 'D:\\media', mode: 'random', imagesPerPost: 2, missingPolicy: 'skip' },
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 10,
        contentSetId: 5,
        sortOrder: 1,
        name: 'Bài chỉ ảnh',
        enabled: true,
        variants: [],
        image: { folderPath: 'D:\\only-images', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'skip' },
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 12,
        contentSetId: 5,
        sortOrder: 3,
        name: 'Bài thứ tư',
        enabled: true,
        variants: ['Nội dung thứ tư'],
        image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 13,
        contentSetId: 5,
        sortOrder: 4,
        name: 'Đang tắt',
        enabled: false,
        variants: ['Không được preview'],
        image: { folderPath: '', mode: 'sequential', imagesPerPost: 1, missingPolicy: 'text_only' },
        createdAt: 1,
        updatedAt: 1
      }
    ]
  }
}

describe('ContentLibraryActionField preview', () => {
  it('shows enabled posts in library order and keeps media-only posts understandable', () => {
    expect(buildContentLibraryPreviewRows(details())).toEqual([
      {
        id: 9,
        name: 'Bài đầu',
        preview: 'Nội dung đầu tiên',
        meta: '1 nội dung · có ảnh'
      },
      {
        id: 10,
        name: 'Bài chỉ ảnh',
        preview: 'Bài chỉ có ảnh',
        meta: '0 nội dung · có ảnh'
      },
      {
        id: 11,
        name: 'Bài thứ ba',
        preview: 'Nội dung thứ ba',
        meta: '1 nội dung · không ảnh'
      }
    ])
  })
})
