import { describe, expect, it, vi } from 'vitest'
import { preloadMedia } from '@/utils/mediaPreload'

describe('mediaPreload', () => {
  it('preloads video metadata without buffering it to canplay', async () => {
    const nativeCreateElement = document.createElement.bind(document)
    const video = nativeCreateElement('video')
    const load = vi.spyOn(video, 'load').mockImplementation(() => undefined)
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) =>
      tagName === 'video' ? video : nativeCreateElement(tagName, options)) as typeof document.createElement)

    const pending = preloadMedia([{ url: 'https://cdn.example.com/metadata-only.mp4', type: 'video' }])

    expect(video.preload).toBe('metadata')
    expect(video.getAttribute('src')).toBe('https://cdn.example.com/metadata-only.mp4')
    expect(load).toHaveBeenCalledTimes(1)

    video.dispatchEvent(new Event('loadedmetadata'))
    await pending

    expect(video.getAttribute('src')).toBeNull()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
