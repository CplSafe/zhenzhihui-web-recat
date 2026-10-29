import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, WORKSPACE_ID } from './fixtures/strict-authenticated-app'

for (const dimensions of [
  { width: 1024, height: 768 },
  { width: 4096, height: 256 },
  { width: 6000, height: 4000 },
  { width: 1000, height: 5000 },
]) {
  test(`超分尺寸 ${dimensions.width}×${dimensions.height}：原图保留、关闭恢复与提交`, async ({ page }, testInfo) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    const succeeds = dimensions.width === 1024
    const oversized = Math.max(dimensions.width, dimensions.height) > 4096
    await installStrictAuthenticatedApp(page)
    await page.route('**/api/v1/ai/tools?**', async (route) => {
      expect(new URL(route.request().url()).searchParams.get('workspace_id')).toBe(String(WORKSPACE_ID))
      await route.fulfill({ json: { data: [] } })
    })
    const png = Buffer.from(
      await page.evaluate(({ width, height }) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')!
        context.fillStyle = '#6688dd'
        context.fillRect(0, 0, width / 2, height)
        return canvas.toDataURL('image/png').split(',')[1]
      }, dimensions),
      'base64',
    )
    await page.route('**/api/v1/assets/{701,703}/download?**', (route) =>
      route.fulfill({ contentType: 'image/png', body: png }),
    )
    let uploadCount = 0
    let failUpload = true
    // WebKit's network interception does not reliably expose multipart file bytes.
    // Inspect the actual File passed to fetch, without changing the request body.
    await page.addInitScript(() => {
      const state = window as unknown as { upscaleUploadSizes: Array<{ width: number; height: number; alpha: number }> }
      state.upscaleUploadSizes = []
      const originalFetch = window.fetch.bind(window)
      window.fetch = async (input, init) => {
        if (String(input).includes('/api/v1/mock-upscale-upload') && init?.body instanceof FormData) {
          const file = init.body.get('file') as File
          const bytes = new Uint8Array(await file.slice(0, 26).arrayBuffer())
          if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71)
            throw new Error('上传副本不是 PNG')
          const view = new DataView(bytes.buffer)
          state.upscaleUploadSizes.push({ width: view.getUint32(16), height: view.getUint32(20), alpha: bytes[25] })
        }
        return originalFetch(input, init)
      }
    })
    await page.route('**/api/v1/assets', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      uploadCount++
      expect(route.request().postDataJSON()).toMatchObject({ mime_type: 'image/png', workspace_id: WORKSPACE_ID })
      await route.fulfill({
        json: {
          data: {
            asset: { id: 702 },
            upload: { url: new URL('/api/v1/mock-upscale-upload', route.request().url()).href, form_fields: {} },
          },
        },
      })
    })
    await page.route('**/api/v1/mock-upscale-upload', async (route) => {
      if (failUpload) {
        failUpload = false
        await route.fulfill({ status: 400, json: { message: '模拟上传失败' } })
        return
      }
      await route.fulfill({ status: 204 })
    })
    await page.route('**/api/v1/assets/702/complete?**', (route) =>
      route.fulfill({ json: { data: { id: 702, status: 'ready' } } }),
    )
    const estimates: Record<string, any>[] = []
    const submissions: Record<string, any>[] = []
    await page.route('**/api/v1/ai/tasks/estimate-cost', async (route) => {
      estimates.push(route.request().postDataJSON())
      await route.fulfill({ json: { data: { estimated_cost: 20, balance: 100, can_afford: true } } })
    })
    let releaseSubmission!: () => void
    const submissionResponse = new Promise<void>((resolve) => {
      releaseSubmission = resolve
    })
    await page.route('**/api/v1/ai/tasks', async (route) => {
      submissions.push(route.request().postDataJSON())
      if (submissions.length === 2) {
        await route.fulfill({ status: 409, json: { code: 10401, message: '当前模型有任务正在生成中，请稍后再试。' } })
        return
      }
      await submissionResponse
      await route.fulfill({ json: { data: { id: 4048, status: 'queued' } } })
    })
    await page.route('**/api/v1/ai/tasks/4048?**', (route) =>
      route.fulfill({
        json: {
          data: succeeds
            ? { id: 4048, status: 'succeeded', outputs: [{ asset_id: 703 }] }
            : { id: 4048, status: 'failed', error_message: '模拟供应商失败' },
        },
      }),
    )
    await page.route('**/api/v1/ai/models**', (route) =>
      route.fulfill({
        json: {
          data: [
            {
              id: 42,
              name: '图片超分',
              capability: 'image',
              operation_codes: ['image.upscale'],
              params_schema: {
                fields: [
                  { name: 'multiple', type: 'number', default: 2, min: 1, max: 4 },
                  {
                    name: 'resolution',
                    display_name: '输出分辨率',
                    type: 'select',
                    default: '4k',
                    options: ['4k', '8k'],
                  },
                  { name: 'detail', display_name: '细节生成程度', type: 'number', default: 50, min: 0, max: 100 },
                ],
              },
            },
          ],
        },
      }),
    )
    await page.route('**/api/v1/canvases/120**', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ json: { revision: 2 } })
        return
      }
      await route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? {
              elements: [
                {
                  element_id: 'source',
                  kind: 'node',
                  payload: {
                    id: 'source',
                    type: 'image',
                    position: { x: 300, y: 200 },
                    style: { width: 320, height: 240 },
                    data: {
                      kind: 'image',
                      assetId: 701,
                      assetWorkspaceId: WORKSPACE_ID,
                      title: '原图',
                      prompt: '保留这段图片描述',
                    },
                  },
                },
              ],
              sync_revision: 1,
              history_floor_revision: 0,
              has_more: false,
            }
          : { id: 120, title: '超分面板验证', revision: 1 },
      })
    })
    if (dimensions.height === 5000) await page.setViewportSize({ width: 760, height: 900 })
    await page.goto('/canvas/120')
    const source = page.locator('.react-flow__node[data-id="source"]')
    await source.locator('.canvas-node-header').click()
    await expect(page.locator('.canvas-panel-area')).toBeVisible()
    await expect(page.locator('.canvas-panel-area textarea').first()).toHaveValue('保留这段图片描述')
    await page.getByRole('button', { name: '超分', exact: true }).click()
    const modal = page.getByRole('dialog', { name: '超分', exact: true })
    await expect(modal).toBeVisible()
    await expect(modal.getByText('8K', { exact: true })).toBeVisible()
    await expect(modal.getByText('40', { exact: true })).toBeVisible()
    await expect(modal.getByText('4k', { exact: true })).toHaveCount(0)
    await expect(modal.getByRole('slider')).toHaveCount(0)
    await expect(modal.getByRole('spinbutton', { name: '细节生成程度' })).toHaveCount(0)
    await expect(page.getByRole('toolbar', { name: '节点操作', exact: true })).toHaveCount(0)
    await expect(page.locator('.ant-modal-mask')).toBeVisible()
    await expect(modal.getByRole('button', { name: '2 倍', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(modal.getByRole('button', { name: '6 倍', exact: true })).toHaveCount(0)
    await modal.getByRole('button', { name: '4 倍', exact: true }).click()
    await expect(modal.getByRole('spinbutton', { name: '放大倍率（倍）' })).toHaveValue('4')
    await expect(page.locator('.canvas-panel-area')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '超分', exact: true })).toHaveCount(0)
    await modal.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(modal).not.toBeVisible()
    await expect(page.locator('.canvas-panel-area')).toBeVisible()
    await expect(page.locator('.canvas-panel-area textarea').first()).toHaveValue('保留这段图片描述')
    await expect(source).toHaveClass(/selected/)
    await page.getByRole('button', { name: '超分', exact: true }).click()
    await expect(modal).toBeVisible()
    await expect(page.locator('.canvas-panel-area')).toHaveCount(0)
    await modal.getByRole('button', { name: 'Close', exact: true }).focus()
    await page.keyboard.press('Escape')
    await expect(page.locator('.canvas-panel-area')).toBeVisible()
    await page.getByRole('button', { name: '超分', exact: true }).click()
    await expect(modal).toBeVisible()
    await page.locator('.ant-modal-wrap').click({ position: { x: 5, y: 5 } })
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(modal).not.toBeVisible()
    await expect(source).toHaveClass(/selected/)
    await page.getByRole('button', { name: '超分', exact: true }).click()
    await expect(modal.getByText(`原始尺寸：${dimensions.width} × ${dimensions.height} 像素`)).toBeVisible()
    if (oversized) {
      await expect(modal.getByText('原图宽或高超过 4096 像素')).toBeVisible()
      await expect(modal.getByRole('button', { name: '确认超分' })).toBeDisabled()
      expect(estimates).toHaveLength(0)
      await testInfo.attach('超限提示', { body: await page.screenshot(), contentType: 'image/png' })
      const prepare = modal.getByRole('button', { name: '等比缩小并准备超分' })
      await prepare.click()
      await expect(modal.getByText(/素材文件上传失败/)).toBeVisible()
      expect(submissions).toHaveLength(0)
      await prepare.click()
      await expect(modal.getByText('缩小副本已准备好')).toBeVisible()
      const scale = 4096 / Math.max(dimensions.width, dimensions.height)
      const width = Math.round(dimensions.width * scale)
      const height = Math.round(dimensions.height * scale)
      const uploadedSizes = await page.evaluate(
        () => (window as unknown as { upscaleUploadSizes: unknown[] }).upscaleUploadSizes,
      )
      expect(uploadedSizes).toEqual([
        { width, height, alpha: 6 },
        { width, height, alpha: 6 },
      ])
      expect(uploadCount).toBe(2)
      await expect(modal.getByText(`预计输出：${width * 2} × ${height * 2} 像素`)).toBeVisible()
      await expect(source.locator('img').first()).toHaveAttribute('src', /assets\/701\/download/)
    } else {
      expect(uploadCount).toBe(0)
      await expect(modal.getByText('原图宽或高超过 4096 像素')).toHaveCount(0)
    }
    await expect(modal.getByRole('button', { name: '确认超分' })).toBeEnabled()
    await testInfo.attach('提交前的尺寸与费用', { body: await page.screenshot(), contentType: 'image/png' })
    await modal.getByRole('button', { name: '确认超分' }).click()
    await expect.poll(() => submissions.length).toBe(1)
    await expect(modal).not.toBeVisible()
    const child = page.locator('.react-flow__node').filter({ hasText: '原图超分' }).first()
    await expect(child).toHaveCount(1)
    await expect(source.locator('img').first()).toBeVisible()
    await expect(source.getByText('正在处理中', { exact: true })).toHaveCount(0)
    await expect(source.locator('.canvas-node-generation-spinner')).toHaveCount(0)
    await expect(child.locator('.canvas-node-generation-spinner')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('only-upscale-result-loading.png') })
    await testInfo.attach('慢请求期间已关闭弹窗并创建子节点', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    if (succeeds) {
      // 第一笔请求尚未返回时，允许同模型的独立提交；后端拒绝原因保留在第二个节点。
      await source.locator('.canvas-node-header').click()
      await page.getByRole('button', { name: '超分', exact: true }).click()
      await expect(modal.getByRole('button', { name: '确认超分' })).toBeEnabled()
      await modal.getByRole('button', { name: '确认超分' }).click()
      await expect.poll(() => submissions.length).toBe(2)
      expect(submissions[1].idempotency_key).not.toBe(submissions[0].idempotency_key)
      await expect(page.locator('.react-flow__node').filter({ hasText: '当前模型有任务正在生成中' })).toHaveCount(1)
      await page.screenshot({ path: testInfo.outputPath('concurrent-upscale-rejection.png') })
    }
    releaseSubmission()
    await expect(source).not.toHaveClass(/selected/)
    await expect(page.getByRole('toolbar', { name: '节点操作', exact: true })).toHaveCount(0)
    await expect(page.locator('.canvas-panel-area')).toHaveCount(0)
    await expect(page.locator('.canvas-hd-badge')).toHaveCount(0)
    if (succeeds) {
      await expect(child.locator('img').first()).toHaveAttribute('src', /assets\/703\/download/)
      await expect(child.locator('img').first()).toBeVisible()
      await expect(child).not.toContainText('高清产物')
    } else await expect(child).toContainText('失败')
    await expect(page.locator('.react-flow__node')).toHaveCount(succeeds ? 3 : 2)
    const submitted = submissions[0]
    expect(submitted).not.toHaveProperty('prompt')
    expect(submitted).toMatchObject({
      workspace_id: WORKSPACE_ID,
      model_version_id: 42,
      operation_code: 'image.upscale',
      params: { multiple: 2, resolution: '8k', detail: 40 },
      input_assets: [{ asset_id: oversized ? 702 : 701, role: 'image' }],
      idempotency_key: expect.any(String),
    })
    expect(estimates.at(-1)).not.toHaveProperty('prompt')
    expect(submitted).toMatchObject(estimates.at(-1)!)
    await expect(modal).not.toBeVisible()
    await expect(page.getByText('图片工具目录加载失败，请刷新页面重试')).toHaveCount(0)
    // Keep native ResizeObserver delivery notifications visible in the report;
    // application exceptions still fail the test, as do all interaction assertions.
    const resizeNotice = 'ResizeObserver loop completed with undelivered notifications.'
    if (pageErrors.includes(resizeNotice)) {
      await testInfo.attach('浏览器尺寸监听通知', { body: pageErrors.join('\n'), contentType: 'text/plain' })
    }
    expect(pageErrors.filter((message) => message !== resizeNotice)).toEqual([])
  })
}
