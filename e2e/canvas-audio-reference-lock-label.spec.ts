import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('音频参考连线可见且可删除，断线后清除引用标签并保留协作占用保护', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 950 })
  const api = await installStrictAuthenticatedApp(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/v1/ai/models**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 121,
            display_name: '声音参考测试模型',
            operation_codes: ['video.generate'],
            input_constraints: { 'video.generate': { roles: [{ role: 'audio', max_count: 2 }] } },
          },
        ],
      },
    }),
  )
  await page.route('**/api/v1/ai/tasks/estimate-cost', (route) =>
    route.fulfill({ json: { estimated_cost: 1, balance: 1000, can_afford: true } }),
  )

  const initialElements = [
    ...[
      { id: 'linked-voice', title: '已连线旁白', x: 140, y: 145 },
      { id: 'unlinked-voice', title: '未连线旁白', x: 140, y: 540 },
      { id: 'occupied-voice', title: '成员占用旁白', x: 640, y: 540 },
      { id: 'reference-voice', title: '克莱尔声音', x: 140, y: 342 },
      { id: 'generated-voice', title: '伊芙琳声音', x: 640, y: 342 },
    ].map(({ id, title, x, y }) => ({
      element_id: id,
      kind: 'node',
      op: 'upsert',
      payload: {
        id,
        type: 'audio',
        position: { x, y },
        style: { width: 280, height: 125 },
        data: { kind: 'audio', title },
      },
    })),
    {
      element_id: 'video',
      kind: 'node',
      op: 'upsert',
      payload: {
        id: 'video',
        type: 'video',
        position: { x: 640, y: 145 },
        style: { width: 320, height: 180 },
        data: { kind: 'video', title: '旁白视频', modelVersionId: 121, params: { duration: 5 } },
      },
    },
    {
      element_id: 'voice-to-video',
      kind: 'edge',
      op: 'upsert',
      payload: {
        id: 'voice-to-video',
        source: 'linked-voice',
        target: 'video',
        sourceHandle: 'linked-voice-right-source',
        targetHandle: 'video-left-target',
      },
    },
    {
      element_id: 'voice-to-voice',
      kind: 'edge',
      op: 'upsert',
      payload: {
        id: 'voice-to-voice',
        source: 'reference-voice',
        target: 'generated-voice',
        sourceHandle: 'reference-voice-left-target',
        targetHandle: 'old-generated-voice-left-target',
      },
    },
    {
      element_id: 'voice-to-missing-node',
      kind: 'edge',
      op: 'upsert',
      payload: { id: 'voice-to-missing-node', source: 'unlinked-voice', target: 'missing-node' },
    },
  ]

  let revision = 1
  const deletedEdges = new Set<string>()
  let newVoiceEdge: { id: string; sourceHandle?: string } | undefined
  const self = { user_id: 7, name: 'E2E 用户' }
  const other = { user_id: 8, name: '同事' }
  await page.route('**/api/v1/canvases/240**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/events')) return route.fulfill({ status: 204 })
    if (url.pathname.endsWith('/node-locks')) {
      const { nodes } = route.request().postDataJSON() as { nodes: string[] }
      return route.fulfill({
        json: {
          granted: true,
          nodes: {
            'occupied-voice': [{ ...other, editing: false }],
            ...(nodes.includes('video') && {
              video: [{ ...self, editing: true }],
              'linked-voice': [{ ...self, editing: false }],
              'unlinked-voice': [{ ...self, editing: false }],
            }),
            ...(nodes.includes('generated-voice') && {
              'generated-voice': [{ ...self, editing: true }],
              'reference-voice': [{ ...self, editing: nodes.includes('reference-voice') }],
            }),
          },
        },
      })
    }
    if (route.request().method() === 'PATCH') {
      const { mutations } = route.request().postDataJSON() as {
        mutations: Array<{
          op: string
          element_id: string
          payload?: { source?: string; target?: string; sourceHandle?: string }
        }>
      }
      for (const { op, element_id, payload } of mutations) {
        if (op === 'delete') deletedEdges.add(element_id)
        if (op === 'upsert' && payload?.source === 'reference-voice' && payload.target === 'generated-voice') {
          newVoiceEdge = { id: element_id, sourceHandle: payload.sourceHandle }
        }
      }
      return route.fulfill({ json: { sync_revision: ++revision } })
    }
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : initialElements,
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 240, title: '引用与占用状态回归', status: 'active', revision },
    })
  })

  await page.goto('/canvas/240')
  const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)
  const label = (id: string) => node(id).locator('.canvas-node-header__collaboration')
  const edge = page.locator('.react-flow__edge[data-id="voice-to-video"]')
  await expect(edge).toBeVisible()
  await node('video')
    .locator('.canvas-node-body')
    .click({ position: { x: 30, y: 30 } })
  await expect(label('video')).toHaveText('编辑中')
  await expect(label('linked-voice')).toHaveText('引用中')
  await expect(label('unlinked-voice')).toHaveCount(0)
  await expect(label('occupied-voice')).toHaveText('同事 暂时占用')
  await expect(node('occupied-voice')).toHaveClass(/canvas-node-occupied/)
  await page.screenshot({ path: testInfo.outputPath('audio-reference-and-occupancy.png') })

  await page.getByRole('button', { name: '删除音频参考' }).click()
  await expect(edge).toHaveCount(0)
  await expect(label('linked-voice')).toHaveCount(0)
  await expect(label('video')).toHaveText('编辑中')
  await expect(node('occupied-voice')).toHaveClass(/canvas-node-occupied/)
  await expect.poll(() => deletedEdges.has('voice-to-video')).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('audio-reference-removed.png') })
  await page.locator('.react-flow__pane').click({ position: { x: 660, y: 120 } })
  await expect(page.locator('[data-canvas-node-panel]')).toHaveCount(0)

  const legacyVoiceEdge = page.locator('.react-flow__edge[data-id="voice-to-voice"]')
  const referenceVoice = node('reference-voice')
  const generatedVoice = node('generated-voice')
  await expect(legacyVoiceEdge).toBeVisible()
  await generatedVoice.locator('.canvas-node-body').click({ position: { x: 15, y: 15 } })
  await expect(label('reference-voice')).toHaveText('引用中')
  await page.screenshot({ path: testInfo.outputPath('audio-reference-edge-restored.png') })

  const sourceBox = await referenceVoice.boundingBox()
  const targetBox = await generatedVoice.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('音频连线的节点不可见')
  await page.mouse.move(sourceBox.x - 16, sourceBox.y - 8)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width + 16, targetBox.y + targetBox.height + 12, { steps: 14 })
  await page.mouse.up()
  await expect(referenceVoice).toHaveClass(/selected/)
  await expect(generatedVoice).toHaveClass(/selected/)
  await expect(legacyVoiceEdge).toHaveClass(/selected/)
  const deleteEdge = page.getByRole('button', { name: '删除连线', exact: true })
  await expect(deleteEdge).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('audio-reference-edge-box-selection.png') })

  const toggleEdges = page.getByRole('button', { name: '隐藏连线', exact: true })
  await toggleEdges.click()
  await expect(legacyVoiceEdge).toHaveCount(0)
  await expect(deleteEdge).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('audio-reference-edge-hidden.png') })
  await toggleEdges.click()
  await expect(legacyVoiceEdge).toBeVisible()
  await deleteEdge.click()
  await expect(legacyVoiceEdge).toHaveCount(0)
  await expect.poll(() => deletedEdges.has('voice-to-voice')).toBe(true)
  await page
    .getByRole('toolbar', { name: '已选中 2 个节点' })
    .getByRole('button', { name: '取消', exact: true })
    .click()
  await generatedVoice.locator('.canvas-node-body').click({ position: { x: 15, y: 15 } })
  await expect(label('generated-voice')).toHaveText('编辑中')
  await expect(label('reference-voice')).toHaveCount(0)

  await referenceVoice.hover()
  const leftHandle = await referenceVoice.locator('.canvas-handle-icon--left').boundingBox()
  if (!leftHandle) throw new Error('左侧拖线加号不可见')
  await page.mouse.move(leftHandle.x + leftHandle.width / 2, leftHandle.y + leftHandle.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 16 })
  await page.mouse.up()
  await expect.poll(() => newVoiceEdge?.sourceHandle).toBe('reference-voice-right-source')
  await expect(page.locator(`.react-flow__edge[data-id="${newVoiceEdge!.id}"]`)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('audio-reference-edge-from-left-handle.png') })

  expect(errors).toEqual([])
  expect(api.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(api)
})
