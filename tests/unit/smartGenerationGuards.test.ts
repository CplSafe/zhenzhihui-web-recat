import { describe, expect, it, vi } from 'vitest'
import {
  persistSmartEntryImages,
  requireOrderedShotAssetIds,
  scriptStreamFailureMessage,
  stableGenerationAssetKey,
} from '@/utils/smartGenerationGuards'

describe('smartGenerationGuards', () => {
  it('uses an asset id instead of a rotating signed URL in generation signatures', () => {
    expect(stableGenerationAssetKey('https://cdn.example.com/a.png?signature=old', 42)).toBe('asset:42')
    expect(stableGenerationAssetKey('https://cdn.example.com/a.png?signature=new', 42)).toBe('asset:42')
    expect(stableGenerationAssetKey('https://cdn.example.com/public.png', 0)).toBe('https://cdn.example.com/public.png')
    expect(stableGenerationAssetKey('https://cdn.example.com/a.png?signature=old#preview', 0)).toBe(
      'https://cdn.example.com/a.png',
    )
    expect(stableGenerationAssetKey('https://cdn.example.com/a.png?signature=new', 0)).toBe(
      'https://cdn.example.com/a.png',
    )
  })

  it('requires exactly one valid image asset for every active shot', () => {
    const shots = [{ no: '镜头1' }, { no: '镜头2' }]
    expect(requireOrderedShotAssetIds(shots, [11, 12])).toEqual([11, 12])
    expect(() => requireOrderedShotAssetIds(shots, [11])).toThrow('需要 2 张')
    expect(() => requireOrderedShotAssetIds(shots, [11, 0])).toThrow('镜头2')
  })

  it('persists entry images in parallel and replaces temporary URLs with durable asset URLs', async () => {
    const pending: Array<() => void> = []
    const persist = vi.fn(
      (_workspaceId: number, url: string) =>
        new Promise<{ url: string; assetId: number }>((resolve) => {
          pending.push(() =>
            resolve({
              url,
              assetId: url.includes('first') ? 101 : 102,
            }),
          )
        }),
    )

    const resultPromise = persistSmartEntryImages(7, ['data:image/png;base64,first', 'blob:second'], persist)
    expect(persist).toHaveBeenCalledTimes(2)
    pending.forEach((resolve) => resolve())

    await expect(resultPromise).resolves.toEqual({
      images: ['/api/v1/assets/101/download?workspace_id=7', '/api/v1/assets/102/download?workspace_id=7'],
      imageAssetIds: [101, 102],
    })
  })

  it('blocks creation when a browser-only entry image could not be stored', async () => {
    await expect(
      persistSmartEntryImages(7, ['blob:missing'], async () => ({ url: 'blob:missing', assetId: 0 })),
    ).rejects.toThrow('入口素材上传失败')
  })

  it('keeps carried asset ids when a generated image starts a new video project', async () => {
    const persist = vi.fn()
    await expect(
      persistSmartEntryImages(21, ['https://cdn.example.com/generated.png'], persist, [731]),
    ).resolves.toEqual({
      images: ['/api/v1/assets/731/download?workspace_id=21'],
      imageAssetIds: [731],
    })
    expect(persist).not.toHaveBeenCalled()
  })

  it('marks a partial stream as interrupted instead of complete', () => {
    expect(scriptStreamFailureMessage(new Error('连接断开'), 3)).toContain('已保留 3 个分镜')
    expect(scriptStreamFailureMessage(new Error('连接断开'), 0)).toBe('连接断开')
  })
})
