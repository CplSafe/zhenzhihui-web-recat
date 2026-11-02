import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi, installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const path of ['/smart', '/hot-copy']) {
  for (const width of [1440, 760]) {
    test(`${path} mint duration picker at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 })
      const api = await installStrictAuthenticatedApp(page)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.addInitScript(() => {
        localStorage.setItem('zzh_guide_seen_smart_u7', '1')
        localStorage.setItem('zzh_guide_seen_home_u7', '1')
      })
      await page.route('**/api/v1/ai/models**', (route) =>
        route.fulfill({
          json: {
            items: [
              {
                id: 801,
                display_name: '测试脚本模型',
                operation_codes: ['responses.multimodal'],
              },
              {
                id: 802,
                display_name: '测试视频模型',
                operation_codes: ['video.generate', 'video.replicate'],
                params_schema: {
                  fields: [
                    { name: 'duration', type: 'integer', options: [5, 10, 15], default: 5 },
                    { name: 'ratio', type: 'string', options: ['16:9', '9:16'], default: '16:9' },
                    { name: 'resolution', type: 'string', options: ['720p'], default: '720p' },
                  ],
                },
              },
            ],
            total: 2,
          },
        }),
      )
      await page.goto(path)
      const modelsTrigger = page.getByRole('button', { name: /^生成模型，/ })
      await expect(modelsTrigger).toBeEnabled()
      await modelsTrigger.click()
      await page.getByRole('option', { name: /测试视频模型/ }).click()
      const dialog = page.getByRole('dialog', { name: '创作参数', exact: true })
      await expect(dialog).toBeVisible()
      const slider = dialog.getByRole('slider', { name: '视频时长' })
      const control = dialog.locator('.wks-control')
      await expect(control).toHaveCSS('background-color', 'rgb(235, 255, 251)')
      await expect(control.locator('.wks-fill')).toHaveCSS('background-color', 'rgb(185, 243, 230)')
      await expect(control.locator('.wks-thumb')).toHaveCSS('background-color', 'rgb(17, 169, 138)')
      await slider.hover()
      await slider.focus()
      await expect(control).toHaveCSS('outline-color', 'rgb(17, 169, 138)')
      await slider.press('End')
      await expect(slider).toHaveAttribute('aria-valuetext', '15s')
      const paramsTrigger = page.getByRole('button', { name: /^创作参数，当前/ })
      await expect(paramsTrigger).toContainText('15s')
      await slider.press('ArrowLeft')
      await expect(slider).toHaveAttribute('aria-valuetext', '10s')
      await expect(paramsTrigger).toContainText('10s')
      await page.mouse.move(width - 1, 1)
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await paramsTrigger.click()
      await expect(dialog).toBeVisible()
      await expect(slider).toHaveAttribute('aria-valuetext', '10s')
      await expect(control).toHaveCSS('background-color', 'rgb(235, 255, 251)')
      await expect(async () => {
        const bounds = (await control.boundingBox())!
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.y).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(1000)
      }).toPass()
      expect(errors).toEqual([])
      expect(api.paidTaskSubmissions).toBe(0)
      expectNoUnexpectedApi(api)
      await page.screenshot({ path: testInfo.outputPath('creative-mint-duration.png') })
    })
  }
}
