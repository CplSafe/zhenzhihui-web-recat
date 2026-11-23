import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import {
  expectNoUnexpectedApi,
  fulfillFixtureVideo,
  installStrictAuthenticatedApp,
} from './fixtures/strict-authenticated-app'

type DownloadNode = {
  id: string
  kind: 'image' | 'video' | 'audio' | 'text'
  title: string
  position: { x: number; y: number }
  resultUrl?: string
  text?: string
}

async function openDownloadCanvas(page: Page, nodes: DownloadNode[]) {
  const api = await installStrictAuthenticatedApp(page)
  const elements = nodes.map(({ id, position, kind, ...data }) => ({
    element_id: id,
    kind: 'node',
    payload: {
      id,
      type: kind,
      position,
      style: { width: 225, height: kind === 'audio' ? 116 : 160 },
      data: { kind, ...data },
    },
  }))
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/assets', (route) => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().source !== 'canvas-poster') {
      return route.fallback()
    }
    return route.fulfill({ status: 503, json: { message: '测试中不保存视频封面' } })
  })
  let revision = 1
  await page.route('**/api/v1/canvases/955**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/events')) return route.fallback()
    return route.fulfill({
      json:
        route.request().method() === 'PATCH'
          ? { revision: ++revision, sync_revision: revision }
          : url.pathname.endsWith('/elements')
            ? {
                elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : elements,
                sync_revision: revision,
                history_floor_revision: 0,
                has_more: false,
              }
            : { id: 955, title: '素材批量下载', revision },
    })
  })
  await page.route('**/api/v1/canvases/955/node-locks?**', (route) =>
    route.fulfill({ json: { granted: true, nodes: {} } }),
  )
  await page.goto('/canvas/955', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.react-flow__node')).toHaveCount(nodes.length)
  return api
}

async function readArchive(download: Download) {
  expect(download.suggestedFilename()).toMatch(/\.zip$/)
  const path = await download.path()
  if (!path) throw new Error('未生成下载文件')
  return unzipSync(await readFile(path))
}

test('画布框选与分组都可下载不同类型的素材，文本文件可重新导入', async ({ page }, testInfo) => {
  const wav = Buffer.from(
    '524946462400000057415645666d74201000000001000100401f0000803e0000020010006461746100000000',
    'hex',
  )
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined }))
  await page.route('**/batch-fixture.wav', (route) => route.fulfill({ contentType: 'audio/wav', body: wav }))
  const api = await openDownloadCanvas(
    page,
    (
      [
        { id: 'a', kind: 'image', title: '画面', resultUrl: '/favicon.png' },
        { id: 'b', kind: 'video', title: '动画', resultUrl: '/tutorials/hot-copy.mp4' },
        { id: 'c', kind: 'audio', title: '配音', resultUrl: '/batch-fixture.wav' },
        { id: 'd', kind: 'text', title: '分镜', text: '镜头一：戴帽子的小猫。' },
        { id: 'e', kind: 'text', title: '分镜', text: '镜头二：小猫抬头。' },
      ] as const
    ).map((node, index) => ({
      ...node,
      position: { x: (index % 3) * 390, y: index >= 3 ? 280 : 0 },
    })),
  )
  await page.locator('.canvas-view').focus()
  await page.keyboard.press('Control+a')
  const toolbar = page.getByRole('toolbar', { name: '已选中 5 个节点' })
  const downloadButton = toolbar.getByRole('button', { name: '下载', exact: true })
  const readSelection = async () => {
    const pendingDownload = page.waitForEvent('download')
    await downloadButton.click()
    return readArchive(await pendingDownload)
  }
  await expect(toolbar).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('un-grouped-download.png') })
  const files = await readSelection()
  expect(Object.keys(files).sort()).toEqual(['分镜 (2).txt', '分镜.txt', '动画.mp4', '画面.png', '配音.wav'].sort())
  expect(Buffer.from(files['配音.wav'])).toEqual(wav)
  const text = new TextDecoder().decode(files['分镜.txt'])
  expect(text).toBe('镜头一：戴帽子的小猫。')
  expect(new TextDecoder().decode(files['分镜 (2).txt'])).toBe('镜头二：小猫抬头。')

  await toolbar.getByRole('button', { name: '打组', exact: true }).click()
  await expect(toolbar.getByRole('button', { name: '解组', exact: true })).toBeVisible()
  expect(Object.keys(await readSelection()).sort()).toEqual(Object.keys(files).sort())
  await page.locator('.canvas-view').evaluate((root, source) => {
    const data = new DataTransfer()
    data.items.add(new File([source], '重新导入.txt', { type: 'text/plain' }))
    root.dispatchEvent(
      new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: 810, clientY: 445 }),
    )
  }, text)
  await expect(page.locator('.react-flow__node-text')).toHaveCount(3)
  await expect(page.locator('.react-flow__node-text').filter({ hasText: '重新导入' })).toContainText(text)
  expectNoUnexpectedApi(api)
})

async function boxSelectGroup(page: Page, [first, last]: readonly [string, string]) {
  const left = page.locator(`.react-flow__node[data-id="${first}"]`)
  const right = page.locator(`.react-flow__node[data-id="${last}"]`)
  const [start, end] = await Promise.all([left.boundingBox(), right.boundingBox()])
  if (!start || !end) throw new Error('视频节点位置缺失')
  await page.mouse.move(start.x - 18, start.y - 54)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width + 12, end.y + end.height * 0.6, { steps: 12 })
  await page.mouse.up()
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)
  await expect(left).toHaveClass(/selected/)
  await expect(right).toHaveClass(/selected/)

  const toolbar = page.getByRole('toolbar', { name: '已选中 2 个节点' })
  await toolbar.getByRole('button', { name: '打组', exact: true }).click()
  await expect(toolbar.getByRole('button', { name: '解组', exact: true })).toBeVisible()
}

async function readDirectoryDownloads(page: Page) {
  return page.evaluate(async () => {
    type Directory = FileSystemDirectoryHandle & {
      entries(): AsyncIterable<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>
    }
    const root = (await navigator.storage.getDirectory()) as Directory
    const batches: Array<{ name: string; files: Record<string, string> }> = []
    for await (const [name, directory] of root.entries()) {
      if (directory.kind !== 'directory') throw new Error('批次应保存在独立的目录中')
      const files: Record<string, string> = {}
      for await (const [filename, handle] of (directory as Directory).entries()) {
        if (handle.kind !== 'file') throw new Error('预期批次目录只包含文件')
        const file = await handle.getFile()
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
        files[filename] = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
      }
      batches.push({ name, files })
    }
    return batches
  })
}

function fileDigests(files: Record<string, Uint8Array>) {
  return Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]),
  )
}

for (const mode of ['ZIP', '文件夹'] as const) {
  test(`首组视频下载中，重新框选打组的第二批可先完成（${mode}）`, async ({ page, browserName }, testInfo) => {
    test.skip(mode === '文件夹' && browserName !== 'chromium', '目录选择器是 Chromium 支持的导出入口')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.addInitScript((downloadMode) => {
      // 只替代原生选址对话框。目录模式仍使用真实的浏览器文件句柄、写入和关闭操作。
      Object.defineProperty(window, 'showDirectoryPicker', {
        value: downloadMode === '文件夹' ? () => navigator.storage.getDirectory() : undefined,
      })
    }, mode)
    const downloads: Download[] = []
    page.on('download', (download) => downloads.push(download))
    const videos = await Promise.all(
      [
        ['a1', '第一组镜头一', 'e2e/fixtures/canvas-subject-12s.mp4'],
        ['a2', '第一组镜头二', 'public/t1test.mp4'],
        ['b1', '第二组镜头一', 'public/tutorials/hot-copy.mp4'],
        ['b2', '第二组镜头二', 'public/tutorials/smart-create.mp4'],
      ].map(async ([id, title, path]) => ({ id, title, bytes: await readFile(path), url: `/batch-video-${id}.mp4` })),
    )
    const firstBatch = fileDigests(
      Object.fromEntries(videos.slice(0, 2).map(({ title, bytes }) => [`${title}.mp4`, bytes])),
    )
    const secondBatch = fileDigests(
      Object.fromEntries(videos.slice(2).map(({ title, bytes }) => [`${title}.mp4`, bytes])),
    )
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    for (const video of videos) {
      await page.route(`**${video.url}`, async (route) => {
        if (video.id === 'a1' && route.request().resourceType() === 'fetch') await firstBlocked
        await fulfillFixtureVideo(route, video.bytes)
      })
    }

    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    const api = await openDownloadCanvas(
      page,
      videos.map(({ id, title, url }, index) => ({
        id,
        title,
        kind: 'video',
        resultUrl: url,
        position: { x: [0, 255, 620, 875][index], y: 0 },
      })),
    )
    const toolbar = page.getByRole('toolbar', { name: '已选中 2 个节点' })
    const downloadButton = toolbar.getByRole('button', { name: '下载', exact: true })
    const status = toolbar.getByRole('status')
    let firstDirectory: string | undefined

    try {
      await boxSelectGroup(page, ['a1', 'a2'])
      const firstRequested = page.waitForRequest(
        (request) => request.url().endsWith(videos[0].url) && request.resourceType() === 'fetch',
      )
      await downloadButton.click()
      await firstRequested
      await expect(status).toHaveText('1 批下载中')
      if (mode === '文件夹') {
        const batches = await readDirectoryDownloads(page)
        expect(batches).toHaveLength(1)
        expect(batches[0].files).toEqual({})
        firstDirectory = batches[0].name
      }

      await boxSelectGroup(page, ['b1', 'b2'])
      await expect(status).toHaveText('1 批下载中')
      await expect(downloadButton).toBeEnabled()
      await page.screenshot({ path: testInfo.outputPath('second-group-ready.png') })
      await downloadButton.click()
      if (mode === 'ZIP') {
        await expect.poll(() => downloads.length).toBe(1)
        expect(fileDigests(await readArchive(downloads[0]))).toEqual(secondBatch)
      } else {
        await expect
          .poll(async () => (await readDirectoryDownloads(page)).find((batch) => batch.name !== firstDirectory)?.files)
          .toEqual(secondBatch)
        const batches = await readDirectoryDownloads(page)
        expect(batches).toHaveLength(2)
        expect(batches.find((batch) => batch.name === firstDirectory)?.files).toEqual({})
        expect(downloads).toHaveLength(0)
      }
      await expect(status).toHaveText('1 批下载中')
      await page.screenshot({ path: testInfo.outputPath('second-group-finished-first.png') })
    } finally {
      releaseFirst()
    }

    if (mode === 'ZIP') {
      await expect.poll(() => downloads.length).toBe(2)
      expect(fileDigests(await readArchive(downloads[1]))).toEqual(firstBatch)
    } else {
      await expect
        .poll(async () => (await readDirectoryDownloads(page)).find((batch) => batch.name === firstDirectory)?.files)
        .toEqual(firstBatch)
      expect(downloads).toHaveLength(0)
    }
    await expect(status).toHaveCount(0)
    expect(pageErrors).toEqual([])
    expectNoUnexpectedApi(api)
  })
}
