import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  for (const document of [
    {
      path: 'creator-agreement',
      title: '创作者入驻协议',
      ending: '与本说明相关的问题，可通过帧智汇平台客服渠道反馈。',
    },
    { path: 'originality-statement', title: '原创说明', ending: '六、上述声明不实的，本人承担相应法律责任' },
  ]) {
    test(`${document.title}可滚动至末尾 ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 500 })
      await installStrictAuthenticatedApp(page)
      await page.goto(`/script-ideas/${document.path}`)
      await expect(page.getByRole('heading', { name: document.title })).toBeVisible()
      const scroller = page.locator('.script-legal-page')
      const ending = page.getByText(document.ending, { exact: false })
      expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
      await page.mouse.move(width / 2, 250)
      await page.mouse.wheel(0, 100000)
      await expect
        .poll(() => scroller.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1))
        .toBe(true)
      await expect(ending).toBeInViewport()
      await page.screenshot({ path: testInfo.outputPath(`legal-bottom-${document.path}-${width}.png`) })
    })
  }
}
