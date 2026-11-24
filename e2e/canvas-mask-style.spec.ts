import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=',
  'base64',
)

for (const width of [1440, 390]) {
  test(`参考图旁添加、替换和移除蒙版 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const api = await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools?**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/v1/ai/models**', (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: 27,
              provider: 'openai',
              version: 'gpt-image-2',
              capability: 'image',
              enabled: true,
              display_name: 'GPT Image',
              operation_codes: ['image.text_to_image', 'image.image_to_image'],
              input_constraints: {
                'image.image_to_image': { roles: [{ role: 'reference_image', min_count: 1, max_count: 3 }] },
              },
            },
          ],
        },
      }),
    )
    const nodes = [
      {
        element_id: 'image-edit',
        kind: 'node',
        op: 'upsert',
        payload: {
          id: 'image-edit',
          type: 'image',
          position: { x: 180, y: 100 },
          style: { width: 250, height: 250 },
          data: { kind: 'image', prompt: '测试蒙版', modelVersionId: 27 },
        },
      },
      {
        element_id: 'source',
        kind: 'node',
        op: 'upsert',
        payload: {
          id: 'source',
          type: 'image',
          position: { x: -140, y: 100 },
          style: { width: 200, height: 200 },
          data: { kind: 'image', title: '场景参考图', assetId: 12391, assetWorkspaceId: WORKSPACE_ID },
        },
      },
      {
        element_id: 'edge',
        kind: 'edge',
        op: 'upsert',
        payload: {
          id: 'edge',
          source: 'source',
          target: 'image-edit',
          sourceHandle: 'source-right-source',
          targetHandle: 'image-edit-left-target',
        },
      },
    ]
    let revision = 1
    let savedMask: number | undefined
    await page.route(/\/api\/v1\/canvases\/108(?:\/(?:elements|node-locks|members))?(?:\?.*)?$/, (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/node-locks')) return route.fulfill({ json: { granted: true, nodes: {} } })
      if (url.pathname.endsWith('/members')) {
        return route.fulfill({
          json: { creator_id: 7, can_manage: true, member_user_ids: [], members_restricted: false },
        })
      }
      if (route.request().method() === 'PATCH') {
        const { mutations } = route.request().postDataJSON() as {
          mutations: { element_id: string; payload?: { data?: { params?: { mask_asset_id?: number } } } }[]
        }
        const image = mutations.find((mutation) => mutation.element_id === 'image-edit')
        if (image) savedMask = Number(image.payload?.data?.params?.mask_asset_id || 0)
        return route.fulfill({ json: { sync_revision: ++revision } })
      }
      return route.fulfill({
        json: url.pathname.endsWith('/elements')
          ? {
              elements: Number(url.searchParams.get('after_revision')) > 0 ? [] : nodes,
              sync_revision: revision,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 108, title: '蒙版测试', revision },
      })
    })
    const uploadNames: string[] = []
    const completedAssets: number[] = []
    await page.route('**/api/v1/assets', (route) => {
      const { name } = route.request().postDataJSON() as { name: string }
      uploadNames.push(name)
      return route.fulfill({
        json: {
          data: {
            asset: { id: 701 + uploadNames.length },
            upload: { url: new URL('/api/v1/mock-mask-upload', route.request().url()).href, form_fields: {} },
          },
        },
      })
    })
    await page.route('**/api/v1/mock-mask-upload', (route) => route.fulfill({ status: 204 }))
    await page.route(/\/api\/v1\/assets\/(702|703)\/complete(?:\?|$)/, (route) => {
      const id = Number(new URL(route.request().url()).pathname.split('/').at(-2))
      completedAssets.push(id)
      return route.fulfill({ json: { data: { id, status: 'ready' } } })
    })
    await page.route(/\/api\/v1\/assets\/(702|703)\/download(?:\?|$)/, (route) =>
      route.fulfill({ contentType: 'image/png', body: png }),
    )
    await page.route('**/api/v1/assets/12391/download?**', (route) =>
      route.fulfill({ contentType: 'image/png', path: 'public/t1test.png' }),
    )

    await page.goto('/canvas/108')
    await page.locator('.react-flow__node[data-id="image-edit"] .canvas-node-header').click()
    const panel = page.locator('[data-canvas-node-panel]')
    const referenceGroup = panel.locator('[data-canvas-reference-mask]')
    const reference = panel.getByTitle('点击预览素材，点击名称插入引用')
    const add = referenceGroup.getByRole('button', { name: '添加蒙版', exact: true })
    const replace = referenceGroup.getByRole('button', { name: '替换蒙版', exact: true })
    const remove = referenceGroup.getByRole('button', { name: '移除蒙版', exact: true })
    const preview = referenceGroup.getByRole('img', { name: '编辑蒙版', exact: true })
    const popover = page.getByRole('dialog', { name: '上传蒙版', exact: true })
    const input = popover.getByLabel('上传编辑蒙版', { exact: true })
    await expect(referenceGroup).toHaveCount(1)
    await expect(add).toHaveCount(1)
    await expect(add).toBeVisible()
    await expect(reference).toBeVisible()
    const refBounds = (await reference.boundingBox())!
    const addBounds = (await add.boundingBox())!
    expect(addBounds.x).toBeGreaterThanOrEqual(refBounds.x + refBounds.width - 1)
    expect(addBounds.y).toBeLessThan(refBounds.y + refBounds.height)
    expect(refBounds.y).toBeLessThan(addBounds.y + addBounds.height)
    await expect(page.getByText(/透明区域将被修改/)).toHaveCount(0)
    await expect(input).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('mask-empty.png') })

    await add.click()
    await expect(popover).toBeVisible()
    await expect(popover).toBeInViewport({ ratio: 0.99 })
    await expect(popover).toContainText(/透明区域.*修改/)
    await expect(popover).toContainText(/第一张参考图/)
    await expect(popover).toContainText(/PNG/)
    await expect(popover).toContainText(/4\s*MB/)
    await expect(popover.getByRole('button', { name: '取消', exact: true })).toBeVisible()
    await expect(input).toBeAttached()
    await page.screenshot({ path: testInfo.outputPath('mask-upload-popover.png') })
    await input.setInputFiles({ name: 'first-mask.png', mimeType: 'image/png', buffer: png })
    await expect(popover).toHaveCount(0)
    await expect(preview).toBeVisible()
    await expect(preview).toHaveAttribute('src', /\/702\/download/)
    await expect.poll(() => preview.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1)
    await expect(replace).toHaveText('替换')
    await expect(remove).toHaveText('移除')
    await expect(add).toHaveCount(0)
    await expect.poll(() => savedMask).toBe(702)
    await page.screenshot({ path: testInfo.outputPath('mask-uploaded.png') })

    await replace.click()
    await expect(popover).toBeVisible()
    await input.setInputFiles({ name: 'replacement-mask.png', mimeType: 'image/png', buffer: png })
    await expect(popover).toHaveCount(0)
    await expect(preview).toHaveAttribute('src', /\/703\/download/)
    await expect.poll(() => savedMask).toBe(703)
    expect(uploadNames).toEqual(['first-mask.png', 'replacement-mask.png'])
    expect(completedAssets).toEqual([702, 703])

    await remove.click()
    await expect(preview).toHaveCount(0)
    await expect(add).toBeVisible()
    await expect.poll(() => savedMask).toBe(0)
    await add.click()
    await expect(popover).toBeVisible()
    await page.locator('.react-flow__node[data-id="source"] .canvas-node-header').click()
    await expect(popover).toHaveCount(0)
    await expect(add).toHaveCount(0)
    expectNoUnexpectedApi(api)
  })
}
