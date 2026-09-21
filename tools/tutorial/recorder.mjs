/**
 * 教程短片录制器（对标 CineArt 操作手册风格）：
 * - 只录产品视口（无浏览器 chrome），1920×1080
 * - 绿色高亮光标 + 点击涟漪（DOM 覆盖层）
 * - 每步一句祈使句大字幕，底部居中（DOM 覆盖层）
 * - 关键步骤 CSS 放大到目标区域
 * - 每个 clip 单独切成一条 mp4（静音），另拼一条完整版
 *
 * 用法：node.exe tools/tutorial/recorder.mjs tools/tutorial/tours/<name>.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync, existsSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.TUTORIAL_BASE_URL || 'http://localhost:5173'
const PROFILE = resolve(here, '.auth/profile')
const OUT_ROOT = process.env.TUTORIAL_OUT || resolve(here, 'out')
const FFMPEG = process.env.FFMPEG || resolve(process.env.LOCALAPPDATA, 'Programs/Python/Python313/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe')
const W = 1920, H = 1080

const OVERLAY_CSS = `
#__tut_cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-4px 0 0 -4px;pointer-events:none;z-index:2147483646;
  transform:translate(-100px,-100px);transition:transform .05s linear}
#__tut_cursor svg{filter:drop-shadow(0 0 6px #22e58a) drop-shadow(0 0 14px rgba(34,229,138,.8))}
#__tut_ripple{position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;
  border:3px solid #22e58a;opacity:0;pointer-events:none;z-index:2147483645;transform:translate(-100px,-100px) scale(.3)}
#__tut_ripple.on{animation:__tut_rip .55s ease-out}
@keyframes __tut_rip{0%{opacity:.95;transform:translate(var(--x),var(--y)) scale(.3)}100%{opacity:0;transform:translate(var(--x),var(--y)) scale(1.4)}}
#__tut_caption{position:fixed;left:0;right:0;bottom:56px;text-align:center;pointer-events:none;z-index:2147483647;
  font:700 40px/1.35 "Microsoft YaHei","PingFang SC",sans-serif;color:#fff;letter-spacing:1px;
  text-shadow:0 0 6px rgba(0,0,0,.95),0 2px 4px rgba(0,0,0,.95),0 0 18px rgba(0,0,0,.8);opacity:0;transition:opacity .25s}
#__tut_caption.on{opacity:1}
html{background:#0b0d12}
body{transform-origin:0 0;transition:transform .45s cubic-bezier(.4,0,.2,1)}
*{scroll-behavior:auto!important}
`
const OVERLAY_JS = `
(()=>{if(window.__tut&&document.getElementById('__tut_cursor'))return;if(!document.documentElement){document.addEventListener('DOMContentLoaded',()=>eval(window.__tutSrc));return;}
const st=document.createElement('style');st.textContent=${JSON.stringify(OVERLAY_CSS)};document.documentElement.appendChild(st);
const c=document.createElement('div');c.id='__tut_cursor';
c.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 3l14 8.5-6.2 1.3L16 20l-2.6 1.2-3.2-7.2L5 18z" fill="#22e58a" stroke="#0a3d25" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const r=document.createElement('div');r.id='__tut_ripple';
const cap=document.createElement('div');cap.id='__tut_caption';
document.documentElement.append(c,r,cap);
window.__tut={
  move(x,y){c.style.transform='translate('+x+'px,'+y+'px)';},
  ripple(x,y){r.style.setProperty('--x',x+'px');r.style.setProperty('--y',y+'px');r.classList.remove('on');void r.offsetWidth;r.classList.add('on');},
  caption(t){if(!t){cap.classList.remove('on');return;}cap.textContent=t;cap.classList.add('on');},
  zoom(rect,scale){if(!rect){document.body.style.transform='';return;}
    const cx=rect.x+rect.width/2, cy=rect.y+rect.height/2;
    let tx=innerWidth/2-cx*scale, ty=innerHeight/2-cy*scale;
    tx=Math.min(0,Math.max(innerWidth-document.documentElement.scrollWidth*scale,tx));
    ty=Math.min(0,Math.max(innerHeight-document.documentElement.scrollHeight*scale,ty));
    document.body.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')';}
};})();`

function ff(args) {
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr)
}

export async function runTour(tourPath) {
  const tour = (await import(pathToFileURL(resolve(tourPath)).href)).default
  const name = tour.name || basename(tourPath, '.mjs')
  const outDir = resolve(OUT_ROOT, name)
  mkdirSync(outDir, { recursive: true })
  if (!existsSync(PROFILE)) throw new Error('缺少登录态，请先运行 node.exe tools/tutorial/login.mjs')

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: resolve(outDir, '.raw'), size: { width: W, height: H } },
    locale: 'zh-CN',
  })
  await ctx.addInitScript('window.__tutSrc=' + JSON.stringify(OVERLAY_JS) + ';' + OVERLAY_JS)
  // 新手引导（spotlight）会遮住画面：按用户 id 预置「已看过」标记
  await ctx.addInitScript(() => {
    try {
      for (let u = 1; u <= 50; u++) {
        for (const k of ['home', 'smart']) localStorage.setItem(`zzh_guide_seen_${k}_u${u}`, '1')
        localStorage.setItem(`zzh_smart_guide_onboarded_u${u}`, '1')
      }
      localStorage.removeItem('zzh_smart_guide_armed')
    } catch {}
  })
  const page = ctx.pages()[0] || (await ctx.newPage())
  page.setDefaultTimeout(6000)
  page.setDefaultNavigationTimeout(30000)
  const t0 = Date.now()
  const clips = []
  let cur = null
  let mouse = { x: -100, y: -100 }
  const now = () => (Date.now() - t0) / 1000
  const ensure = () => page.evaluate(OVERLAY_JS)

  const api = {
    page, BASE,
    /** 开始一条新短片（切片边界） */
    async clip(title) {
      if (cur && cur.end == null) cur.end = now()
      cur = { title, start: now() + 0.3, end: null }
      clips.push(cur)
      await ensure(); await page.evaluate(() => window.__tut.caption(''))
      await page.waitForTimeout(400)
    },
    /** 立即结束当前短片（后面的等待不进成片） */
    async cut() {
      if (cur && cur.end == null) cur.end = now() + 0.3
      await page.waitForTimeout(350)
      await ensure(); await page.evaluate(() => window.__tut.caption(''))
    },
    /** 显示字幕（不自动消失） */
    async say(text, hold = 800) {
      await ensure(); await page.evaluate((t) => window.__tut.caption(t), text)
      await page.waitForTimeout(hold)
    },
    /** 光标平滑移动到元素中心 */
    async moveTo(locator, { dx = 0, dy = 0, ms = 420 } = {}) {
      const el = typeof locator === 'string' ? page.locator(locator).first() : locator
      await el.scrollIntoViewIfNeeded().catch(() => {})
      const b = await el.boundingBox()
      if (!b) throw new Error('元素不可见: ' + locator)
      const tx = b.x + b.width / 2 + dx, ty = b.y + b.height / 2 + dy
      await ensure()
      const steps = Math.max(8, Math.round(ms / 25))
      for (let i = 1; i <= steps; i++) {
        const k = 1 - Math.pow(1 - i / steps, 3)
        const x = mouse.x + (tx - mouse.x) * k, y = mouse.y + (ty - mouse.y) * k
        await page.mouse.move(x, y)
        await page.evaluate(([x, y]) => window.__tut.move(x, y), [x, y])
        await page.waitForTimeout(25)
      }
      mouse = { x: tx, y: ty }
      return { x: tx, y: ty, box: b }
    },
    /** 移动 + 涟漪 + 点击 */
    async click(locator, opts = {}) {
      let { x, y } = await api.moveTo(locator, opts)
      await page.waitForTimeout(opts.pause ?? 180)
      // hover 后元素可能放大/位移（如画布上的「+」把手）：重新取中心再点
      const el = typeof locator === 'string' ? page.locator(locator).first() : locator
      const b2 = await el.boundingBox().catch(() => null)
      if (b2) {
        const nx = b2.x + b2.width / 2 + (opts.dx ?? 0), ny = b2.y + b2.height / 2 + (opts.dy ?? 0)
        if (Math.abs(nx - x) > 3 || Math.abs(ny - y) > 3) {
          x = nx; y = ny; mouse = { x, y }
          await page.mouse.move(x, y)
          await page.evaluate(([x, y]) => window.__tut.move(x, y), [x, y])
          await page.waitForTimeout(80)
        }
      }
      await page.evaluate(([x, y]) => window.__tut.ripple(x, y), [x, y])
      await page.mouse.click(x, y)
      await page.waitForTimeout(opts.after ?? 450)
    },
    /** 逐字输入（先点击） */
    async type(locator, text, { delay = 40, after = 400 } = {}) {
      await api.click(locator, { after: 200 })
      await page.keyboard.type(text, { delay })
      await page.waitForTimeout(after)
    },
    /** 放大到元素（scale 倍），不传 locator 则还原 */
    async zoom(locator, scale = 1.6, hold = 300) {
      await ensure()
      if (!locator) {
        await page.evaluate(() => window.__tut.zoom(null))
      } else {
        const el = typeof locator === 'string' ? page.locator(locator).first() : locator
        const b = await el.boundingBox()
        if (!b) throw new Error('元素不可见: ' + locator)
        await page.evaluate(([b, s]) => window.__tut.zoom(b, s), [b, scale])
      }
      await page.waitForTimeout(hold + 450)
    },
    wait: (ms) => page.waitForTimeout(ms),
    now,
  }

  let failed = null
  try {
    await tour.run(api)
  } catch (e) {
    failed = e
    console.error('录制中断:', e.message)
    await page.screenshot({ path: resolve(outDir, 'error.png') }).catch(() => {})
  }
  if (cur && cur.end == null) cur.end = now() + 0.8
  // 关闭前等网络空闲：避免打断会话续期（refresh token 轮换中途关闭会导致登出）
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const video = page.video()
  await ctx.close()
  const rawPath = await video.path()

  const raw = resolve(outDir, 'raw.webm')
  renameSync(rawPath, raw)
  rmSync(resolve(outDir, '.raw'), { recursive: true, force: true })
  writeFileSync(resolve(outDir, 'clips.json'), JSON.stringify(clips, null, 2))

  // 切片：每条 clip 一个 mp4；再拼完整版
  const list = []
  clips.forEach((c, i) => {
    const file = resolve(outDir, `${String(i + 1).padStart(2, '0')}-${c.title.replace(/[\\/:*?"<>|\s]/g, '')}.mp4`)
    ff(['-ss', c.start.toFixed(2), '-to', c.end.toFixed(2), '-i', raw,
      '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-an', '-movflags', '+faststart', file])
    list.push(file)
    console.log('✔', basename(file), `${(c.end - c.start).toFixed(1)}s`)
  })
  if (list.length) {
    const concat = resolve(outDir, 'concat.txt')
    writeFileSync(concat, list.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
    const full = resolve(outDir, `${name}.mp4`)
    ff(['-f', 'concat', '-safe', '0', '-i', concat, '-c', 'copy', full])
    const total = clips.reduce((s, c) => s + (c.end - c.start), 0)
    console.log('★', basename(full), `${total.toFixed(1)}s`)
    // 单条主流程视频：把切片和完整版合一，删掉中间切片
    if (tour.single) { for (const f of list) rmSync(f, { force: true }); rmSync(concat, { force: true }) }
  }
  if (failed) process.exitCode = 1
  console.log('输出目录:', outDir)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tourPath = process.argv[2]
  if (!tourPath) { console.error('用法: node.exe tools/tutorial/recorder.mjs <tour.mjs>'); process.exit(2) }
  await runTour(tourPath)
}

