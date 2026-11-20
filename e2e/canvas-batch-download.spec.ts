import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { unzipSync } from 'fflate'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('画布框选与分组都可下载不同类型的素材，文本文件可重新导入', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  const wav = Buffer.from(
    '524946462400000057415645666d74201000000001000100401f0000803e0000020010006461746100000000',
    'hex',
  )
  const elements = [
    { id: 'a', kind: 'image', title: '画面', resultUrl: '/favicon.png' },
    { id: 'b', kind: 'video', title: '动画', resultUrl: '/tutorials/hot-copy.mp4' },
    { id: 'c', kind: 'audio', title: '配音', resultUrl: '/batch-fixture.wav' },
    { id: 'd', kind: 'text', title: '分镜', text: '镜头一：戴帽子的小猫。' },
    { id: 'e', kind: 'text', title: '分镜', text: '镜头二：小猫抬头。' },
  ].map(({ id, kind, ...rest }, index) => ({
    element_id: id,
    kind: 'node',
    payload: {
      id,
      type: kind,
      position: { x: (index % 3) * 390, y: index >= 3 ? 280 : 0 },
      style: { width: 225, height: kind === 'audio' ? 116 : 160 },
      data: { kind, ...rest },
    },
  }))
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined }))
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/batch-fixture.wav', (route) => route.fulfill({ contentType: 'audio/wav', body: wav }))
  await page.route('**/api/v1/assets', (route) => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().source !== 'canvas-poster') {
      return route.fallback()
    }
    return route.fulfill({ status: 503, json: { message: '测试中不保存视频封面' } })
  })
  let revision = 1
  await page.route('**/api/v1/canvases/955**', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'PATCH'
          ? { revision: ++revision, sync_revision: revision }
          : new URL(route.request().url()).pathname.endsWith('/elements')
            ? { elements, sync_revision: revision, history_floor_revision: 0, has_more: false }
            : { id: 955, title: '素材批量下载', revision },
    }),
  )
  await page.route('**/api/v1/canvases/955/node-locks?**', (route) =>
    route.fulfill({ json: { granted: true, nodes: {} } }),
  )
  await page.goto('/canvas/955')
  await expect(page.locator('.react-flow__node')).toHaveCount(5)
  await page.locator('.canvas-view').focus()
  await page.keyboard.press('Control+a')
  const toolbar = page.getByRole('toolbar', { name: '已选中 5 个节点' })
  const readSelection = async () => {
    const pendingDownload = page.waitForEvent('download')
    await toolbar.getByRole('button', { name: '下载', exact: true }).click()
    const download = await pendingDownload
    expect(download.suggestedFilename()).toMatch(/\.zip$/)
    const path = await download.path()
    if (!path) throw new Error('未生成下载文件')
    return unzipSync(await readFile(path))
  }
  await expect(toolbar).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('un-grouped-download.png') })
  const files = await readSelection()
  expect(Object.keys(files).sort()).toEqual(['分镜 (2).txt', '分镜.txt', '动画.mp4', '画面.png', '配音.wav'].sort())
  expect(Buffer.from(files['配音.wav'])).toEqual(wav)
  expect(new TextDecoder().decode(files['分镜.txt'])).toBe('镜头一：戴帽子的小猫。')
  expect(new TextDecoder().decode(files['分镜 (2).txt'])).toBe('镜头二：小猫抬头。')

  await toolbar.getByRole('button', { name: '打组', exact: true }).click()
  await expect(toolbar.getByRole('button', { name: '解组', exact: true })).toBeVisible()
  expect(Object.keys(await readSelection()).sort()).toEqual(Object.keys(files).sort())
  const text = new TextDecoder().decode(files['分镜.txt'])
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
