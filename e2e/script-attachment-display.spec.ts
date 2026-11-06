import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp, expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  for (const stage of ['creative', 'draft', 'script', 'revision']) {
    test(`${stage} 审核内容中的附件只显示一次且可下载 ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      const api = await installStrictAuthenticatedApp(page)
      await page.route('**/api/v1/script-creators/me', (route) =>
        route.fulfill({ json: { code: 0, data: { profile: null, workflow_synced: false } } }),
      )
      await page.route('**/api/v1/student-applications/81', (route) =>
        route.fulfill({
          json: {
            code: 0,
            data: {
              application: { id: 81, state: 'submitted', creative: '故事', data: {} },
              progress_available: true,
              workflow: {
                status: 1,
                stage: 'waiting_review',
                current_task: null,
                versions: [
                  {
                    version: 1,
                    stage,
                    content: '测试内容',
                    task_id: 'task-1',
                    submitted_at: 1,
                    data: {
                      title: '测试',
                      title_zh: '测试',
                      revision_description: '修改',
                      attachments: [{ file_id: 81, file_name: '第一集.docx' }],
                    },
                  },
                ],
                reviews: [],
              },
            },
          },
        }),
      )
      await page.goto('/script-ideas/81')
      const details = page.locator('.si-readonly')
      const attachment = details.getByRole('link', { name: '第一集.docx' })
      await expect(attachment).toHaveCount(1)
      await expect(attachment).toHaveAttribute('href', '/api/v1/script-files/81/download')
      await expect(attachment).toHaveAttribute('download', '')
      await expect(details.getByText('下载附件', { exact: true })).toHaveCount(0)
      await attachment.scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`${stage}-${width}.png`) })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expectNoUnexpectedApi(api)
    })
  }
}
