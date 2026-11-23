import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import {
  expectNoUnexpectedApi,
  fulfillFixtureVideo,
  installStrictAuthenticatedApp,
} from './fixtures/strict-authenticated-app'

test.describe.configure({ mode: 'default' })

const sourceCanvas = { id: 820, title: '剪贴板来源画布', revision: 1 }
const targetCanvas = { id: 821, title: '剪贴板目标画布', revision: 1 }

type NodeKind = 'text' | 'image' | 'video' | 'timeline' | 'audio'

function nodeElement(type: NodeKind, title: string, data: Record<string, unknown>, index = 0) {
  const id = `clipboard-${type}-${index}`
  return {
    kind: 'node',
    op: 'upsert',
    element_id: id,
    payload: {
      id,
      type,
      position: { x: (index % 3) * 310, y: Math.floor(index / 3) * 240 },
      style: { width: 240, height: 160 },
      data: { kind: type, title, ...data },
    },
  }
}

const fourAudioNodes = Array.from({ length: 4 }, (_, index) =>
  nodeElement('audio', `剪贴板音频 ${index + 1}`, { assetId: 603 }, index),
)

const mixedNodes = [
  nodeElement('text', '剪贴板文本', { text: '跨画布保留的文本正文' }),
  nodeElement('image', '剪贴板图片', { assetId: 701 }, 1),
  nodeElement('video', '剪贴板视频', { assetId: 601, posterAssetId: 701 }, 2),
  nodeElement(
    'timeline',
    '剪贴板时间线',
    {
      timeline: { clips: [{ id: 'clip', assetId: 601, sourceDurationSec: 12, inSec: 1, outSec: 4 }] },
    },
    3,
  ),
  nodeElement('audio', '剪贴板音频', { assetId: 603 }, 4),
]

const mixedEdge = {
  kind: 'edge',
  op: 'upsert',
  element_id: 'clipboard-connection',
  payload: { id: 'clipboard-connection', source: mixedNodes[0].element_id, target: mixedNodes[2].element_id },
}

type ElementMutation = { kind: string; op: string; element_id: string; payload: Record<string, unknown> }

async function openSourceCanvas(page: Page, sourceElements: ElementMutation[]) {
  const api = await installStrictAuthenticatedApp(page)
  if (sourceElements.some((item) => item.payload.type === 'timeline')) {
    const video = await readFile('e2e/fixtures/canvas-video-trim-12s.mp4')
    await page.route('**/api/v1/assets/601/download?**', (route) => fulfillFixtureVideo(route, video))
  }
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route(/\/api\/v1\/canvases(?:\?|$)/, (route) =>
    route.fulfill({ json: { items: [sourceCanvas, targetCanvas] } }),
  )
  await page.route(/\/api\/v1\/canvases\/(820|821)\/members\?/, (route) =>
    route.fulfill({ json: { creator_id: 7, can_manage: true, member_user_ids: [], members_restricted: false } }),
  )
  await page.route(/\/api\/v1\/canvases\/(820|821)\/node-locks\?/, (route) =>
    route.fulfill({ json: { granted: true, nodes: {} } }),
  )
  const saved = new Map<string, ElementMutation>()
  let revision = 1
  await page.route(/\/api\/v1\/canvases\/(820|821)(?:\/elements)?(?:\?|$)/, (route) => {
    const url = new URL(route.request().url())
    const isSource = url.pathname.split('/')[4] === String(sourceCanvas.id)
    if (route.request().method() === 'PATCH') {
      const { mutations } = route.request().postDataJSON() as { mutations: ElementMutation[] }
      if (!isSource) {
        for (const item of mutations) saved.set(item.element_id, item)
      }
      return route.fulfill({ json: { sync_revision: ++revision } })
    }
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: isSource && Number(url.searchParams.get('after_revision')) === 0 ? sourceElements : [],
            sync_revision: revision,
            has_more: false,
          }
        : isSource
          ? sourceCanvas
          : targetCanvas,
    })
  })

  await page.goto('/canvas', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: `打开画布 ${sourceCanvas.title}` }).click()
  const nodes = page.locator('.react-flow__node')
  await expect(nodes).toHaveCount(sourceElements.filter((item) => item.kind === 'node').length)
  return { api, saved, nodes }
}

async function selectAllNodes(page: Page, count: number) {
  await page.locator('.react-flow__pane').click({ position: { x: 80, y: 350 } })
  await page.keyboard.press('ControlOrMeta+a')
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(count)
}

async function switchToTargetCanvas(page: Page) {
  await page.getByRole('button', { name: '返回无限画布' }).click()
  const openTarget = page.getByRole('button', { name: `打开画布 ${targetCanvas.title}` })
  const saveAndLeave = page.getByRole('button', { name: '保存并离开' })
  await expect(openTarget.or(saveAndLeave)).toBeVisible()
  if (await saveAndLeave.isVisible()) await saveAndLeave.click()
  await openTarget.click()
  await expect(page).toHaveURL(`/canvas/${targetCanvas.id}`)
  await expect(page.locator('.react-flow__pane')).toBeVisible()
  await expect(page.locator('.react-flow__node')).toHaveCount(0)

  // 跨画布后直接粘贴，复现没有手动点击画布获得焦点的场景。
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true)
}

async function pasteCurrentNodes(page: Page) {
  await expect(page.getByText('粘贴哪些节点？')).toBeVisible()
  await page.getByRole('button', { name: /只含当前节点/ }).click()
}

async function expectSavedCopies(saved: Map<string, ElementMutation>, originals: ReturnType<typeof nodeElement>[]) {
  const savedNodes = () => Array.from(saved.values()).filter((item) => item.kind === 'node' && item.op === 'upsert')
  await expect.poll(savedNodes).toHaveLength(originals.length)
  const copies = savedNodes()
  for (const { payload } of originals) {
    expect(copies).toContainEqual(
      expect.objectContaining({
        element_id: expect.not.stringMatching(new RegExp(`^${payload.id}$`)),
        payload: expect.objectContaining({ type: payload.type, data: expect.objectContaining(payload.data) }),
      }),
    )
  }
}

for (const pasteMethod of ['快捷键', '没有原生粘贴事件的快捷键', '右键菜单'] as const) {
  test(`跨画布通过${pasteMethod}复制粘贴四个音频节点`, async ({ page }, testInfo) => {
    const { api, saved, nodes } = await openSourceCanvas(page, fourAudioNodes)
    await selectAllNodes(page, fourAudioNodes.length)

    if (pasteMethod === '右键菜单') {
      await nodes.first().locator('.canvas-node-header').click({ button: 'right' })
      await page.getByRole('button', { name: '复制 Ctrl+C' }).click()
    } else {
      await page.keyboard.press('ControlOrMeta+c')
    }
    await expect(page.getByText('已复制 4 个节点')).toBeVisible()
    await switchToTargetCanvas(page)

    if (pasteMethod === '右键菜单') {
      await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 650, y: 350 } })
      await page.getByRole('button', { name: '粘贴 Ctrl+V' }).click()
    } else if (pasteMethod === '没有原生粘贴事件的快捷键') {
      await page.locator('body').dispatchEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true })
    } else {
      await page.keyboard.press('ControlOrMeta+v')
    }
    await pasteCurrentNodes(page)
    await expect(nodes).toHaveCount(4)
    for (const { payload } of fourAudioNodes) {
      await expect(nodes.getByText(payload.data.title, { exact: true })).toBeVisible()
    }
    await expectSavedCopies(saved, fourAudioNodes)
    if (pasteMethod === '快捷键') await page.screenshot({ path: testInfo.outputPath('four-audio-nodes-pasted.png') })
    expectNoUnexpectedApi(api)
  })
}

for (const element of mixedNodes) {
  test(`跨画布使用快捷键单独复制粘贴${element.payload.data.title}`, async ({ page }) => {
    const useKeyboardSelection = element.payload.type === 'audio'
    const { api, saved, nodes } = await openSourceCanvas(page, [element])
    const selected = nodes.filter({ has: page.getByText(element.payload.data.title, { exact: true }) })
    if (useKeyboardSelection) await selectAllNodes(page, 1)
    else await selected.locator('.canvas-node-header').click()
    await expect(selected).toHaveClass(/selected/)
    await page.keyboard.press('ControlOrMeta+c')
    await expect(page.getByText(/已复制 1 个节点|图片和节点已复制|节点已复制，图片复制失败/)).toBeVisible()

    await switchToTargetCanvas(page)
    await page.keyboard.press('ControlOrMeta+v')
    if (useKeyboardSelection) {
      await expect(page.getByRole('button', { name: /只含当前节点/ })).toBeFocused()
      await page.keyboard.press('Enter')
    } else {
      await pasteCurrentNodes(page)
    }
    await expect(nodes).toHaveCount(1)
    await expect(selected).toBeVisible()
    await expectSavedCopies(saved, [element])
    expectNoUnexpectedApi(api)
  })
}

test('跨画布快捷键批量粘贴各类节点及其连线', async ({ page }, testInfo) => {
  const { api, saved, nodes } = await openSourceCanvas(page, [...mixedNodes, mixedEdge])
  await selectAllNodes(page, mixedNodes.length)
  await page.keyboard.press('ControlOrMeta+c')
  await expect(page.getByText('已复制 5 个节点')).toBeVisible()

  await switchToTargetCanvas(page)
  await page.keyboard.press('ControlOrMeta+v')
  await pasteCurrentNodes(page)
  await expect(nodes).toHaveCount(5)
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  for (const { payload } of mixedNodes) {
    await expect(nodes.getByText(payload.data.title, { exact: true })).toBeVisible()
  }
  await expectSavedCopies(saved, mixedNodes)
  const copiedText = await nodes.filter({ hasText: '剪贴板文本' }).getAttribute('data-id')
  const copiedVideo = await nodes.filter({ hasText: '剪贴板视频' }).getAttribute('data-id')
  expect(Array.from(saved.values())).toContainEqual(
    expect.objectContaining({
      kind: 'edge',
      op: 'upsert',
      payload: expect.objectContaining({ source: copiedText, target: copiedVideo }),
    }),
  )
  await page.screenshot({ path: testInfo.outputPath('mixed-nodes-and-connection-pasted.png') })
  expectNoUnexpectedApi(api)
})

test('画布剪贴板有节点时，文本编辑器仍可用快捷键剪切和粘贴正文', async ({ page }) => {
  const { api, nodes } = await openSourceCanvas(page, [mixedNodes[0]])
  await nodes.locator('.canvas-node-header').click()
  await page.keyboard.press('ControlOrMeta+c')
  await expect(page.getByText('已复制 1 个节点')).toBeVisible()

  await nodes.locator('.canvas-node-body').dblclick()
  const editor = nodes.locator('textarea')
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue('跨画布保留的文本正文')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+x')
  await expect(editor).toHaveValue('')
  await page.keyboard.press('ControlOrMeta+v')
  await expect(editor).toHaveValue('跨画布保留的文本正文')
  await expect(page.getByText('粘贴哪些节点？')).toHaveCount(0)
  await expect(nodes).toHaveCount(1)
  expectNoUnexpectedApi(api)
})
