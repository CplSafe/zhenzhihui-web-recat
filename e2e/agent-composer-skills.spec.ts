import { expect, test } from '@playwright/test'
import { installStrictAuthenticatedApp } from './fixtures/strict-authenticated-app'

for (const width of [1440, 390]) {
  test(`Agent 运行中保留草稿，多技能逐个添加并随下一条发送 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await installStrictAuthenticatedApp(page)
    await page.addInitScript(() => {
      sessionStorage.setItem('dodo-conversation:' + JSON.stringify(['/agent-studio', 'composer-test', 110]), 'working')
    })
    let update: (status: string, cursor: number) => void = () => {
      throw new Error('WebSocket not ready')
    }
    const selection = { image: 29, video: 18, mode: 'manual' }
    await page.routeWebSocket('**/agent-studio/**', (ws) => {
      update = (status, cursor) =>
        ws.send(
          JSON.stringify({
            event: 'snapshot',
            cursor,
            data: {
              id: 'working',
              status,
              selection,
              skill_name: 'method-a',
              cursor,
              events: [],
            },
          }),
        )
    })
    await page.route('**/api/v1/canvases/110**', (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/elements')
          ? { elements: [], sync_revision: 1, history_floor_revision: 0, has_more: false }
          : { id: 110, title: '输入和技能', status: 'active', revision: 1 },
      }),
    )
    const posts: Array<{ path: string; body: Record<string, unknown> }> = []
    await page.route('**/agent-studio/**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (route.request().method() !== 'GET') {
        posts.push({ path, body: route.request().postDataJSON() })
        return route.fulfill({ json: { id: 'next' } })
      }
      if (path.endsWith('/api/bootstrap')) return route.fulfill({ json: { ready: true } })
      if (path.endsWith('/api/state'))
        return route.fulfill({
          json: {
            connected: true,
            workspace_id: 21,
            session_scope: 'composer-test',
            runs: [{ id: 'working', title: '正在制作', status: 'running' }],
          },
        })
      if (path.endsWith('/api/catalog'))
        return route.fulfill({
          json: {
            models: [
              { id: 29, model: 'Image', operation_codes: ['image.text_to_image'] },
              { id: 18, model: 'Video', operation_codes: ['video.generate'] },
            ],
            skills: [
              { id: 1, name: 'method-a', description: '剧本分析' },
              { id: 2, name: 'method-b', description: '分镜设计' },
            ],
            planning_model: { id: 52, model: 'GPT', operation_codes: ['agent.chat'] },
          },
        })
      if (path.endsWith('/api/runs/working'))
        return route.fulfill({ json: { id: 'working', status: 'running', selection, cursor: 0, events: [] } })
      if (path.endsWith('/api/runs/next'))
        return route.fulfill({ json: { id: 'next', status: 'running', selection, cursor: 0, events: [] } })
      return route.abort()
    })
    await page.goto('/canvas/110')
    await page.getByRole('button', { name: '打开 DoDo Agent' }).click()
    const agent = page.getByRole('region', { name: 'DoDo Agent' })
    const input = agent.getByRole('textbox', { name: '创作要求' })
    await expect(agent.getByRole('button', { name: '停止回复' })).toBeVisible()
    await expect(input).toBeEnabled()
    await input.fill('先分析剧本，再整理分镜，不生成视频。')
    for (const name of ['剧本分析', '分镜设计']) {
      await agent.getByRole('button', { name: 'Skill', exact: true }).click()
      await page.getByRole('button', { name: new RegExp(name) }).click()
    }
    await expect(agent.getByRole('button', { name: '移除 Skill 剧本分析' })).toHaveCount(1)
    await expect(agent.getByRole('button', { name: '移除 Skill 分镜设计' })).toHaveCount(1)
    await agent.getByRole('button', { name: '移除 Skill 剧本分析' }).click()
    await agent.getByRole('button', { name: 'Skill', exact: true }).click()
    await page.getByRole('button', { name: /剧本分析/ }).click()
    await input.press('Enter')
    expect(posts).toEqual([])
    update('running', 1)
    await expect(input).toHaveValue('先分析剧本，再整理分镜，不生成视频。')
    await agent.getByRole('button', { name: '收起 DoDo Agent' }).click()
    await page.getByRole('button', { name: '打开 DoDo Agent' }).click()
    await expect(input).toHaveValue('先分析剧本，再整理分镜，不生成视频。')
    update('complete', 2)
    await agent.getByRole('button', { name: '发送创作要求' }).click()
    await expect.poll(() => posts.length).toBe(1)
    expect(posts[0]).toMatchObject({
      path: '/agent-studio/api/runs',
      body: {
        message: '先分析剧本，再整理分镜，不生成视频。',
        skills: ['method-b', 'method-a'],
        previous: 'working',
      },
    })
    await expect(input).toHaveValue('')
    await expect(agent.getByRole('button', { name: /^移除 Skill/ })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('agent-composer.png') })
  })
}
