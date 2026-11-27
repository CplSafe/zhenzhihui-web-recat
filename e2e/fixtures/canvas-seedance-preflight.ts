import { expect, type Page } from '@playwright/test'
import { WORKSPACE_ID } from './strict-authenticated-app'

export const PADDED_ASSET_ID = 504
const PADDING_UPLOAD_URL = 'https://canvas-test.oss-cn-beijing.aliyuncs.com/seedance-padding'

type Size = { width: number; height: number }
type UploadWindow = Window & { seedancePaddingUpload?: number[] }

export async function mockIntrinsicVideoSize(page: Page, size: Size) {
  await page.addInitScript((fixtureSize) => {
    const metadataProbes = new WeakSet<HTMLVideoElement>()
    const mediaSource = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      ...mediaSource,
      set(this: HTMLMediaElement, url: string) {
        if (
          this instanceof HTMLVideoElement &&
          !this.isConnected &&
          this.preload === 'metadata' &&
          url.includes('/api/v1/assets/501/download')
        ) {
          metadataProbes.add(this)
          queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')))
        } else {
          mediaSource.set!.call(this, url)
        }
      },
    })
    for (const [property, value] of [
      ['videoWidth', fixtureSize.width],
      ['videoHeight', fixtureSize.height],
    ] as const) {
      const original = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, property)!
      Object.defineProperty(HTMLVideoElement.prototype, property, {
        ...original,
        get(this: HTMLVideoElement) {
          return metadataProbes.has(this) ? value : original.get!.call(this)
        },
      })
    }
  }, size)
}

// The ratio guard only reads metadata. The video node itself should not play or create a poster in these tests.
export const NON_PLAYABLE_VIDEO = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="280"/>'

export async function makePaddingSourcePng(page: Page, size: Size): Promise<Buffer> {
  const encoded = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const drawing = canvas.getContext('2d')!
    drawing.fillStyle = '#ebfffb'
    drawing.fillRect(0, 0, width, height)
    drawing.fillStyle = '#4338ca'
    drawing.fillRect(0, 0, 18, 72)
    drawing.fillStyle = '#be185d'
    drawing.fillRect(width - 18, height - 72, 18, 72)
    return canvas.toDataURL('image/png').split(',')[1]
  }, size)
  return Buffer.from(encoded, 'base64')
}

export async function mockPaddedImageUpload(page: Page, title: string, status: 'active' | 'rejected' = 'active') {
  const state = { uploads: [] as Buffer[], moderation: [] as string[] }
  await page.addInitScript((uploadUrl) => {
    const originalFetch = window.fetch
    window.fetch = async (input, init) => {
      if (String(input) === uploadUrl && init?.body instanceof FormData) {
        const file = init.body.get('file')
        if (file instanceof Blob)
          (window as UploadWindow).seedancePaddingUpload = [...new Uint8Array(await file.arrayBuffer())]
      }
      return originalFetch(input, init)
    }
  }, PADDING_UPLOAD_URL)
  await page.route('**/api/v1/assets', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    expect(route.request().postDataJSON()).toMatchObject({
      name: `${title}-补边.png`,
      workspace_id: WORKSPACE_ID,
      type: 'image',
      mime_type: 'image/png',
    })
    return route.fulfill({
      json: { asset: { id: PADDED_ASSET_ID }, upload: { url: PADDING_UPLOAD_URL, form_fields: {} } },
    })
  })
  await page.route(PADDING_UPLOAD_URL, async (route) => {
    const bytes = await page.evaluate(() => (window as UploadWindow).seedancePaddingUpload)
    expect(bytes).toBeDefined()
    state.uploads.push(Buffer.from(bytes!))
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  })
  await page.route(`**/api/v1/assets/${PADDED_ASSET_ID}/complete?**`, (route) =>
    route.fulfill({ json: { id: PADDED_ASSET_ID, status: 'active' } }),
  )
  await page.route(`**/api/v1/assets/${PADDED_ASSET_ID}/download?**`, (route) => {
    expect(state.uploads).toHaveLength(1)
    return route.fulfill({ contentType: 'image/png', body: state.uploads[0] })
  })
  await page.route(`**/api/v1/assets/${PADDED_ASSET_ID}/seedance-moderation**`, (route) => {
    const method = route.request().method()
    const wasSubmitted = state.moderation.includes('POST')
    state.moderation.push(method)
    if (method === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ workspace_id: WORKSPACE_ID })
      expect(state.uploads).toHaveLength(1)
      return route.fulfill({ json: { data: { status: 'pending' } } })
    }
    if (!wasSubmitted) return route.fulfill({ status: 404, json: { message: '尚未审核' } })
    return route.fulfill({ json: { data: { status, reason: status === 'rejected' ? '补边图审核模拟拒绝' : '' } } })
  })
  return state
}

export async function expectPaddedPixels(page: Page, output: Buffer, expectedSize: Size) {
  const actual = await page.evaluate(
    async ({ sourceUrl, outputUrl }) => {
      async function readPixels(url: string) {
        const image = new Image()
        image.src = url
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const drawing = canvas.getContext('2d')!
        drawing.drawImage(image, 0, 0)
        return drawing.getImageData(0, 0, canvas.width, canvas.height)
      }
      const [source, padded] = await Promise.all([readPixels(sourceUrl), readPixels(outputUrl)])
      const left = Math.floor((padded.width - source.width) / 2)
      const top = Math.floor((padded.height - source.height) / 2)
      let originalPixelsPreserved = true
      let bandsAreWhite = true
      for (let y = 0; y < padded.height; y++) {
        for (let x = 0; x < padded.width; x++) {
          const paddedIndex = (y * padded.width + x) * 4
          const inSource = x >= left && x < left + source.width && y >= top && y < top + source.height
          const sourceIndex = ((y - top) * source.width + x - left) * 4
          for (let channel = 0; channel < 4; channel++) {
            if (inSource) {
              if (padded.data[paddedIndex + channel] !== source.data[sourceIndex + channel])
                originalPixelsPreserved = false
            } else if (padded.data[paddedIndex + channel] !== 255) {
              bandsAreWhite = false
            }
          }
        }
      }
      return { width: padded.width, height: padded.height, originalPixelsPreserved, bandsAreWhite }
    },
    {
      sourceUrl: `/api/v1/assets/501/download?workspace_id=${WORKSPACE_ID}`,
      outputUrl: `data:image/png;base64,${output.toString('base64')}`,
    },
  )
  expect(actual).toEqual({ ...expectedSize, originalPixelsPreserved: true, bandsAreWhite: true })
}
