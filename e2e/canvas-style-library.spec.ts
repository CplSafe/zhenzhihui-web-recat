import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

test('风格库默认不使用，自定义风格保存在当前账号并纳入报价与提交参数', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const api = await installStrictAuthenticatedApp(page, { preserveStorage: true })
  const quotes: { prompt?: string }[] = []
  const tasks: { prompt?: string }[] = []
  await page.route('**/api/v1/ai/tools**', (route) => route.fulfill({ json: { data: [] } }))
  await page.route('**/api/v1/ai/models**', (route) => {
    const operation = new URL(route.request().url()).searchParams.get('operation_code')
    return route.fulfill({
      json: {
        data:
          operation === 'image.text_to_image'
            ? [{ id: 42, display_name: '测试图像模型', operation_codes: [operation] }]
            : [],
      },
    })
  })
  await page.route('**/api/v1/ai/tasks/estimate-cost', (route) => {
    quotes.push(route.request().postDataJSON())
    return route.fulfill({ json: { estimated_cost: 10, can_afford: true } })
  })
  await page.route('**/api/v1/ai/tasks', (route) => {
    tasks.push(route.request().postDataJSON())
    return route.fulfill({ status: 400, json: { message: '模拟任务失败' } })
  })
  const prompt = '小猫在花园散步'
  const stylePrompt = '青绿和淡金色调，轮廓简洁'
  let revision = 1
  let element = {
    element_id: 'style-node',
    kind: 'node',
    payload: {
      id: 'style-node',
      type: 'image',
      position: { x: 100, y: 100 },
      data: { kind: 'image', modelVersionId: 42, prompt },
    },
  }
  await page.route('**/api/v1/canvases/956**', (route) => {
    const request = route.request()
    if (request.method() === 'PATCH') {
      const saved = request
        .postDataJSON()
        .mutations?.find((mutation: typeof element) => mutation.element_id === 'style-node')
      if (saved) element = { ...element, payload: saved.payload }
      revision++
      return route.fulfill({ json: { revision, sync_revision: revision } })
    }
    const url = new URL(request.url())
    return route.fulfill({
      json: url.pathname.endsWith('/elements')
        ? {
            elements: Number(url.searchParams.get('after_revision')) >= revision ? [] : [element],
            sync_revision: revision,
            history_floor_revision: 0,
            has_more: false,
          }
        : { id: 956, title: '风格库验收', revision },
    })
  })
  await page.route('**/api/v1/canvases/956/node-locks?**', (route) =>
    route.fulfill({ json: { granted: true, nodes: {} } }),
  )
  await page.goto('/canvas/956')
  const pickNode = () => page.locator('.react-flow__node[data-id="style-node"]').click()
  await pickNode()
  const trigger = page.getByRole('button', { name: '风格库' })
  await trigger.click()
  const picker = page.getByRole('dialog', { name: '风格库' })
  await expect(picker.getByRole('button', { name: '暂不使用' })).toHaveAttribute('aria-pressed', 'true')
  const presets = picker.getByRole('group', { name: '内置风格' })
  await expect(presets.getByRole('button')).toHaveCount(12)
  const movieThumbnail = presets.getByRole('button', { name: '电影写实' }).locator('img')
  await expect.poll(() => movieThumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  await page.screenshot({ path: testInfo.outputPath('style-previews-desktop.png'), animations: 'disabled' })
  const watercolor = presets.getByRole('button', { name: '绘本水彩' })
  await watercolor.scrollIntoViewIfNeeded()
  await expect
    .poll(() => watercolor.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0)
  await watercolor.click()
  await expect(trigger).toHaveText('绘本水彩')
  await expect.poll(() => quotes.at(-1)?.prompt).toContain('绘本水彩风格')
  await trigger.click()
  await expect(watercolor).toHaveAttribute('aria-pressed', 'true')
  await picker.getByRole('button', { name: '自定义风格' }).click()
  const editor = page.getByRole('dialog', { name: '自定义风格' })
  await editor.getByLabel('风格名称').fill('我的青绿')
  await editor.getByLabel('风格提示词').fill(stylePrompt)
  await editor.getByRole('button', { name: '保存并使用' }).click()
  await expect(trigger).toHaveText('我的青绿')
  await expect.poll(() => quotes.at(-1)?.prompt).toBe(`${prompt}\n\n${stylePrompt}`)
  await page.locator('[data-canvas-node-panel] [data-canvas-generate]').click()
  const confirm = page.getByRole('alertdialog', { name: '确认制作费用' })
  if (await confirm.isVisible()) await confirm.getByRole('button', { name: '继续制作' }).click()
  await expect.poll(() => tasks.at(-1)?.prompt).toBe(`${prompt}\n\n${stylePrompt}`)
  await expect(page.getByText('已保存到云端')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 900 })
  await page.reload()
  await pickNode()
  await trigger.click()
  await expect(picker.getByRole('button', { name: '我的青绿' })).toBeVisible()
  await expect(picker.getByRole('button', { name: '暂不使用' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => movieThumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  expect(await presets.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('style-library.png'), animations: 'disabled' })
  expectNoUnexpectedApi(api)
})
