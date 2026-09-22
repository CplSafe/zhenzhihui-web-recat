// 一次性：打开有头浏览器（持久化 profile）让人手动登录；登录态直接落在 tools/tutorial/.auth/profile 里，
// 录制器复用同一个 profile，不依赖会话探测。
// 用法：node.exe tools/tutorial/login.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const PROFILE = resolve(here, '.auth/profile')
const base = process.env.TUTORIAL_BASE_URL || 'http://localhost:5173'

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(PROFILE, { recursive: true })
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1600, height: 900 } })
  const page = ctx.pages()[0] || (await ctx.newPage())
  await page.goto(`${base}/login`)
  console.log('请在弹出的浏览器里完成登录，登录成功看到首页后【直接关闭浏览器窗口】即可。')
  await new Promise((r) => ctx.on('close', r))
  console.log('profile 已保存 →', PROFILE)
}
