// 探索页面：用登录态打开某个路由，截图 + 输出可点元素文本，便于写 tour 脚本
// 用法：node.exe tools/tutorial/probe.mjs /smart [selector-to-click ...]
import { chromium } from 'playwright'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const PROFILE = resolve(here, '.auth/profile')
const BASE = process.env.TUTORIAL_BASE_URL || 'http://localhost:5173'
const [route = '/smart', ...clicks] = process.argv.slice(2)
mkdirSync(resolve(here, 'out/probe'), { recursive: true })

const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1920, height: 1080 }, locale: 'zh-CN' })
const page = ctx.pages()[0] || (await ctx.newPage())
await page.goto(BASE + route, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2500)
for (const sel of clicks) {
  await page.locator(sel).first().click({ timeout: 8000 }).catch((e) => console.log('click fail', sel, e.message))
  await page.waitForTimeout(1500)
}
console.log('URL:', page.url())
const tag = (route + clicks.join('_')).replace(/[^\w一-龥]/g, '_')
await page.screenshot({ path: resolve(here, `out/probe/${tag}.png`) })
const items = await page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('button,a,[role=button],[role=tab],input,textarea,select,[contenteditable]')) {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight) continue
    const t = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    out.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').slice(0, 2).join('.') : ''} @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} | ${t}`)
  }
  return out
})
console.log(items.join('\n'))
await ctx.close()
