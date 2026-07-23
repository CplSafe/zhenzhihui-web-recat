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

test('移动端公开首页与登录页可操作且无整页横向溢出', async ({ page }) => {
  test.slow()

  await page.goto('/home')
  await expect(page.getByRole('heading', { name: '快捷入口' })).toBeVisible()
  await expect(page.getByRole('button', { name: '智能成片 输入灵感，秒出大片', exact: true })).toBeVisible()
  await expectNoDocumentOverflow(page)

  await page.getByRole('button', { name: '智能成片 输入灵感，秒出大片', exact: true }).click()
  await expect(page).toHaveURL(/\/smart$/)
  await expect(page.getByRole('heading', { name: '想打造什么样的爆款短视频？' })).toBeVisible()
  await expectNoDocumentOverflow(page)

  await page.goBack()
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('heading', { name: '快捷入口' })).toBeVisible()
  await expectNoDocumentOverflow(page)

  await page.goto('/login')
  await expect(page.getByRole('heading', { name: '欢迎加入帧智汇' })).toBeVisible()
  await expectNoDocumentOverflow(page)

  await page.getByRole('button', { name: '返回上一页' }).click()
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page.getByRole('button', { name: '开始创作' })).toBeVisible()
  await expectNoDocumentOverflow(page)

  await page.getByRole('button', { name: '开始创作' }).click()
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('heading', { name: '快捷入口' })).toBeVisible()
  await expectNoDocumentOverflow(page)
})

test('移动端智能成片与爆款复制入口可访问且无整页横向溢出', async ({ page }) => {
  test.slow()

  await page.goto('/smart')
  await expect(page.getByRole('heading', { name: '想打造什么样的爆款短视频？' })).toBeVisible()
  await expectNoDocumentOverflow(page)

  await page.getByRole('button', { name: '打开菜单' }).click()
  await expect(page.getByRole('button', { name: '爆款复制', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '爆款复制', exact: true }).click()
  await expect(page).toHaveURL(/\/hot-copy$/)
  // SPA 菜单跳转不会等待爆款复制的大型懒加载 chunk；WebKit 冷启动时给页面级加载留出预算。
  await expect(page.getByRole('heading', { name: '爆款作业直接抄,你的产品当主角!' })).toBeVisible({ timeout: 30_000 })
  await expectNoDocumentOverflow(page)

  await page.getByRole('button', { name: '打开菜单' }).click()
  await expect(page.getByRole('button', { name: '首页', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '首页', exact: true }).click()
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('heading', { name: '快捷入口' })).toBeVisible()
  await expectNoDocumentOverflow(page)
})
