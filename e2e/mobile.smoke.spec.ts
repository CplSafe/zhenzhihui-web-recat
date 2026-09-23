import { expect, test, type Page, type Route } from '@playwright/test'

type MobileApiState = {
  unexpectedRequests: string[]
}

const apiStateByPage = new WeakMap<Page, MobileApiState>()
const allowedPublicGetPaths = new Set(['/api/v1/banners', '/api/v1/templates', '/api/v1/workspaces'])

async function rejectUnexpectedApi(route: Route, state: MobileApiState, requestLabel: string) {
  state.unexpectedRequests.push(requestLabel)
  await route.fulfill({
    status: 405,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'UNEXPECTED_MOBILE_E2E_REQUEST', message: `${requestLabel} is not allowed` }),
  })
}

async function expectNoDocumentOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
}

test.beforeEach(async ({ page }) => {
  const apiState: MobileApiState = { unexpectedRequests: [] }
  apiStateByPage.set(page, apiState)

  await page.addInitScript(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    ;(window as Window & { __zzh_dev_logout__?: boolean }).__zzh_dev_logout__ = true
  })

  await page.route(
    (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/deepauth/'),
    async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const method = request.method().toUpperCase()
      const requestLabel = `${method} ${url.pathname}${url.search}`

      if (method !== 'GET' || !allowedPublicGetPaths.has(url.pathname)) {
        await rejectUnexpectedApi(route, apiState, requestLabel)
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: [] }),
      })
    },
  )
})

test.afterEach(async ({ page }) => {
  expect(apiStateByPage.get(page)?.unexpectedRequests ?? [], '移动端页面发出了未声明或非 GET API 请求').toEqual([])
})

test('移动端公开落地页与登录页可操作且无整页横向溢出', async ({ page }) => {
  test.slow()

  // 首页已下线：旧 /home 链接落到爆款复刻入口
  await page.goto('/home')
  await expect(page).toHaveURL(/\/hot-copy$/)
  await expect(page.getByRole('heading', { name: '爆款作业直接抄,你的产品当主角!' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '模板库' })).toBeVisible()
  await expectNoDocumentOverflow(page)

  await page.goto('/smart')
  await expect(page.getByRole('heading', { name: '打造我想要的爆款视频' })).toBeVisible()
  await expectNoDocumentOverflow(page)

  await page.goBack()
  await expect(page).toHaveURL(/\/hot-copy$/)
  await expect(page.getByRole('heading', { name: '爆款作业直接抄,你的产品当主角!' })).toBeVisible()
  await expectNoDocumentOverflow(page)

  await page.goto('/login')
  await expect(page.getByRole('heading', { name: '欢迎加入帧智汇' })).toBeVisible()
  await expectNoDocumentOverflow(page)

  await page.getByRole('button', { name: '返回上一页' }).click()
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page.getByRole('button', { name: '开始创作' })).toBeVisible()
  await expectNoDocumentOverflow(page)

  await page.getByRole('button', { name: '开始创作' }).click()
  await expect(page).toHaveURL(/\/hot-copy$/)
  await expect(page.getByRole('heading', { name: '爆款作业直接抄,你的产品当主角!' })).toBeVisible()
  await expectNoDocumentOverflow(page)
})
