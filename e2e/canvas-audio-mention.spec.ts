import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const width of [1440, 900]) {
  test(`视频节点允许直接选择、搜索及连入音频，放大前后保持引用 ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90000)
    await page.setViewportSize({ width, height: 1000 })
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

    const audio = {
      lane: 'voice',
      durationSec: 2,
      inSec: 0,
      outSec: 2,
      startSec: 0,
      volume: 1,
      origin: 'generated',
    }
    const initialElements = [
      ...[
        { id: 'voice', title: '第一段旁白', y: 120 },
        { id: 'voice-copy', title: '第二段旁白', y: 390 },
      ].map(({ id, title, y }) => ({
        element_id: id,
        kind: 'node',
        op: 'upsert',
        payload: {
          id,
          type: 'audio',
          position: { x: 100, y },
          style: { width: 260, height: 120 },
          data: { kind: 'audio', title, assetId: 55, assetWorkspaceId: WORKSPACE_ID, audio },
        },
      })),
      {
        element_id: 'video',
        kind: 'node',
        op: 'upsert',
        payload: {
          id: 'video',
          type: 'video',
          position: { x: 550, y: 140 },
          style: { width: 320, height: 180 },
          data: { kind: 'video', modelVersionId: 121, prompt: '', params: { duration: 5 } },
        },
      },
      {
        element_id: 'voice-edge',
        kind: 'edge',
        op: 'upsert',
        payload: {
          id: 'voice-edge',
          source: 'voice',
          target: 'video',
          sourceHandle: 'voice-right-source',
          targetHandle: 'video-left-target',
          data: { slotIndex: 0 },
        },
      },
    ]
    const elements = new Map(initialElements.map((element) => [element.element_id, element]))
    let revision = 1
    await page.route('**/api/v1/canvases/238**', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/events')) return route.fulfill({ status: 204 })
      if (url.pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
      if (route.request().method() === 'PATCH') {
        for (const mutation of route.request().postDataJSON().mutations ?? []) {
          if (mutation.op === 'delete') elements.delete(mutation.element_id)
          else elements.set(mutation.element_id, mutation)
        }
        return route.fulfill({ json: { sync_revision: ++revision } })
      }
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : [...elements.values()],
              sync_revision: revision,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 238, title: '音频引用验证', status: 'active', revision },
      })
    })

    const wav = Buffer.alloc(44 + 48000 * 2)
    wav.write('RIFF')
    wav.writeUInt32LE(wav.length - 8, 4)
    wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(24000, 24)
    wav.writeUInt32LE(48000, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(wav.length - 44, 40)
    await page.route('**/api/v1/assets/55/download**', (route) =>
      route.fulfill({ contentType: 'audio/wav', body: wav }),
    )

    await page.goto('/canvas/238')
    const video = page.locator('.react-flow__node[data-id="video"]')
    const secondAudio = page.locator('.react-flow__node[data-id="voice-copy"]')
    await expect(secondAudio).toBeVisible()
    await secondAudio.hover()
    await secondAudio.locator('.canvas-handle-icon--right').dragTo(video)
    await expect
      .poll(() =>
        [...elements.values()].some(
          ({ kind, payload }) =>
            kind === 'edge' && 'source' in payload && payload.source === 'voice-copy' && payload.target === 'video',
        ),
      )
      .toBe(true)
    await video.locator('.canvas-node-body').click({ position: { x: 30, y: 30 } })
    const panel = page.locator('[data-canvas-node-panel]')
    const thumbnails = panel.getByTitle('点击插入音频引用')
    await expect(thumbnails).toHaveCount(2)
    await expect(panel).toContainText(/音频\s*2\/2/)

    const inlinePrompt = panel.getByPlaceholder(/描述你想要生成/)
    await panel.getByRole('button', { name: '插入音频引用 @第一段旁白', exact: true }).click()
    await expect(inlinePrompt).toHaveAttribute('data-value', '@第一段旁白 ')
    await expect(inlinePrompt.locator('[data-mention="@第一段旁白"]')).toBeVisible()
    await inlinePrompt.pressSequentially('@')
    await inlinePrompt.pressSequentially('音频')
    const picker = page.getByRole('listbox', { name: '选择要 @ 的参考素材' })
    await picker.getByRole('option', { name: /@第二段旁白/ }).click()
    await expect(inlinePrompt).toHaveAttribute('data-value', '@第一段旁白 @第二段旁白 ')

    await inlinePrompt.fill('保留前文，替换这一段')
    await inlinePrompt.press('End')
    for (let i = 0; i < '替换这一段'.length; i++) await inlinePrompt.press('Shift+ArrowLeft')
    await inlinePrompt.pressSequentially('＠')
    await picker.getByRole('option', { name: /@第二段旁白/ }).click()
    await expect(inlinePrompt).toHaveAttribute('data-value', '保留前文，@第二段旁白 ')
    await page.screenshot({ path: testInfo.outputPath('canvas-audio-inline-picker.png') })

    await panel.getByTitle('放大输入框').click()
    const dialog = page.getByRole('dialog', { name: '编辑提示词' })
    const expandedPrompt = dialog.getByPlaceholder(/描述你想要生成/)
    await expect(expandedPrompt).toHaveAttribute('data-value', '保留前文，@第二段旁白 ')
    await expandedPrompt.fill('')
    await dialog.getByTitle('插入 @第一段旁白').click()
    await expect(expandedPrompt).toHaveAttribute('data-value', '@第一段旁白 ')
    await expandedPrompt.pressSequentially('@')
    await picker.getByRole('option', { name: /@第二段旁白/ }).click()
    await expect(expandedPrompt).toHaveAttribute('data-value', '@第一段旁白 @第二段旁白 ')

    await expandedPrompt.fill('保留前文，替换这一段')
    await expandedPrompt.press('End')
    for (let i = 0; i < '替换这一段'.length; i++) await expandedPrompt.press('Shift+ArrowLeft')
    await dialog.getByRole('button', { name: '@引用素材' }).click()
    await picker.getByRole('option', { name: /@第二段旁白/ }).click()
    await expect(expandedPrompt).toHaveAttribute('data-value', '保留前文，@第二段旁白 ')
    await page.screenshot({ path: testInfo.outputPath('canvas-audio-expanded-picker.png') })

    await dialog.getByRole('button', { name: '完成' }).click()
    await expect(inlinePrompt).toHaveAttribute('data-value', '保留前文，@第二段旁白 ')
    await panel.getByRole('combobox', { name: '音频用途' }).selectOption('mix')
    await panel.getByTitle('放大输入框').click()
    const expandedAudioUse = dialog.getByRole('combobox', { name: '音频用途' })
    await expect(expandedAudioUse).toHaveValue('mix')
    await expandedAudioUse.selectOption('reference')
    await expect(dialog.getByTitle('插入 @第二段旁白')).toBeVisible()

    expect(errors).toEqual([])
    expect(api.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(api)
  })
}
