/* 帧智汇使用手册截图脚本（docs/帧智汇使用手册.md）。需先 npm run dev（http://localhost:5173）。
 *
 * 用法：node scripts/capture-manual-screenshots.cjs <mode>
 *   guest  无头截游客可见页面（开屏 / 登录 / 注册 / 入口页）。
 *   auth   截全部登录态页面。默认有头打开登录页等待人工登录；也可复用已登录的持久化 profile：
 *            MANUAL_PROFILE=tools/tutorial/.auth/profile MANUAL_HEADLESS=1 MANUAL_TEAM_SPACE=<团队名>
 *   all    guest + auth。
 *
 * 每张截图可带「操作标注」：红框圈出控件，带编号的标签用箭头指向它，方便读者对照手册里的步骤。
 * 标注只是截图前临时叠在页面上的一层 SVG，不改动页面本身。
 */
const path = require('path')
const fs = require('fs')
const { chromium } = require('playwright')

const BASE = 'http://localhost:5173'
const OUT = path.resolve(__dirname, '../docs/images')
// 可用 MANUAL_PROFILE 指向已登录的持久化 profile（如 tools/tutorial/.auth/profile），MANUAL_HEADLESS=1 则无头运行。
const PROFILE = process.env.MANUAL_PROFILE
  ? path.resolve(process.env.MANUAL_PROFILE)
  : path.resolve(__dirname, '../.pw-manual-profile')
const TEAM_SPACE = process.env.MANUAL_TEAM_SPACE || ''
const mode = process.argv[2] || 'guest'
fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ───────────────────────── 基础动作 ─────────────────────────

async function go(page, url) {
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  await sleep(1500)
}

async function tryStep(label, fn) {
  try {
    await fn()
  } catch (e) {
    console.log('SKIP', label, '-', String(e.message || e).split('\n')[0])
  }
}

async function clickText(page, text, opts = {}) {
  const loc = page.getByText(text, { exact: opts.exact ?? true }).first()
  await loc.waitFor({ state: 'visible', timeout: opts.timeout ?? 6000 })
  await loc.click()
  await sleep(opts.after ?? 900)
}

/** 截图前把页面上的手机号打码，避免成员隐私进入手册。 */
async function maskPhones(page) {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const re = /1[3-9]\d{9}/g
    let node
    while ((node = walker.nextNode())) {
      if (re.test(node.nodeValue || '')) {
        node.nodeValue = (node.nodeValue || '').replace(re, (m) => `${m.slice(0, 3)}****${m.slice(-4)}`)
      }
    }
  })
}

// ───────────────────────── 标注层 ─────────────────────────

/** 定位器简写：t=按文本，r=按角色+名称，l=按 aria-label，c=按 CSS。 */
const T =
  (text, exact = true) =>
  (page) =>
    page.getByText(text, { exact }).first()
const R = (role, name) => (page) => page.getByRole(role, { name }).first()
const L = (label) => (page) => page.getByLabel(label).first()
const C = (css) => (page) => page.locator(css).first()

/**
 * 在页面上叠加标注层。items: [{ find, label, at? }]
 * - find：上面的 T/R/L/C 之一，或 (page) => Locator
 * - label：标签文字（自动加序号）
 * - at：标签放在控件的哪一侧，top | bottom | left | right；不填则自动选空间大的一侧
 * 找不到的控件会被跳过并打印 SKIP，不影响截图。
 */
async function annotate(page, items) {
  const boxes = []
  for (const item of items) {
    try {
      const loc = item.find(page)
      await loc.waitFor({ state: 'visible', timeout: 2500 })
      const box = await loc.boundingBox()
      if (!box || box.width < 2 || box.height < 2) throw new Error('empty box')
      boxes.push({ ...box, label: item.label, at: item.at || '' })
    } catch (e) {
      console.log('  SKIP 标注', item.label, '-', String(e.message || e).split('\n')[0])
    }
  }
  if (!boxes.length) return
  await page.evaluate((boxes) => {
    const NS = 'http://www.w3.org/2000/svg'
    const W = window.innerWidth
    const H = window.innerHeight
    const svg = document.createElementNS(NS, 'svg')
    svg.id = '__manual_annotations__'
    svg.setAttribute('width', String(W))
    svg.setAttribute('height', String(H))
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    Object.assign(svg.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
      fontFamily:
        '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    })
    const defs = document.createElementNS(NS, 'defs')
    defs.innerHTML =
      '<marker id="__ma_arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0,0 L10,5 L0,10 z" fill="#ff3b30"/></marker>' +
      '<filter id="__ma_shadow" x="-20%" y="-20%" width="140%" height="160%">' +
      '<feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.35)"/></filter>'
    svg.appendChild(defs)

    const RED = '#ff3b30'
    const PAD = 5
    const LABEL_H = 34
    const GAP = 26 // 标签与红框的距离
    const placed = [] // 已放置标签的矩形，用于简单避让

    const overlaps = (a, b) => !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)

    boxes.forEach((b, i) => {
      const x = b.x - PAD
      const y = b.y - PAD
      const w = b.width + PAD * 2
      const h = b.height + PAD * 2

      // 红框
      const rect = document.createElementNS(NS, 'rect')
      rect.setAttribute('x', String(x))
      rect.setAttribute('y', String(y))
      rect.setAttribute('width', String(w))
      rect.setAttribute('height', String(h))
      rect.setAttribute('rx', '8')
      rect.setAttribute('fill', 'none')
      rect.setAttribute('stroke', RED)
      rect.setAttribute('stroke-width', '3')
      svg.appendChild(rect)

      // 标签尺寸（按字数估算：中文 15px/字，序号圆 26px）
      const text = `${i + 1}  ${b.label}`
      const labelW = Math.min(W - 16, 18 + b.label.length * 15.5 + 34)
      const cx = x + w / 2
      const cy = y + h / 2

      // 自动选边：优先上方，其次下方、右侧、左侧；要求标签落在视口内且不与已放标签重叠
      const candidates = []
      const order = b.at ? [b.at] : ['top', 'bottom', 'right', 'left']
      for (const side of order) {
        let lx
        let ly
        if (side === 'top') {
          lx = cx - labelW / 2
          ly = y - GAP - LABEL_H
        } else if (side === 'bottom') {
          lx = cx - labelW / 2
          ly = y + h + GAP
        } else if (side === 'right') {
          lx = x + w + GAP
          ly = cy - LABEL_H / 2
        } else {
          lx = x - GAP - labelW
          ly = cy - LABEL_H / 2
        }
        candidates.push({ side, lx, ly })
      }
      let pick = null
      for (let round = 0; round < 3 && !pick; round++) {
        for (const c of candidates) {
          const lx = Math.max(8, Math.min(W - labelW - 8, c.lx))
          const ly = Math.max(8, Math.min(H - LABEL_H - 8, c.ly + (c.side === 'top' ? -1 : 1) * round * (LABEL_H + 10)))
          const rectL = { x: lx, y: ly, w: labelW, h: LABEL_H }
          const clash = placed.some((p) => overlaps(p, rectL))
          const inside = overlaps(rectL, { x, y, w, h })
          if (!clash && !inside) {
            pick = { ...c, lx, ly }
            break
          }
        }
      }
      if (!pick) {
        const c = candidates[0]
        pick = {
          ...c,
          lx: Math.max(8, Math.min(W - labelW - 8, c.lx)),
          ly: Math.max(8, Math.min(H - LABEL_H - 8, c.ly)),
        }
      }
      placed.push({ x: pick.lx, y: pick.ly, w: labelW, h: LABEL_H })

      // 箭头：从标签边缘指向红框边缘
      let sx
      let sy
      let ex
      let ey
      const lcx = pick.lx + labelW / 2
      const lcy = pick.ly + LABEL_H / 2
      if (pick.side === 'top') {
        sx = lcx
        sy = pick.ly + LABEL_H
        ex = Math.max(x + 8, Math.min(x + w - 8, lcx))
        ey = y - 2
      } else if (pick.side === 'bottom') {
        sx = lcx
        sy = pick.ly
        ex = Math.max(x + 8, Math.min(x + w - 8, lcx))
        ey = y + h + 2
      } else if (pick.side === 'right') {
        sx = pick.lx
        sy = lcy
        ex = x + w + 2
        ey = Math.max(y + 8, Math.min(y + h - 8, lcy))
      } else {
        sx = pick.lx + labelW
        sy = lcy
        ex = x - 2
        ey = Math.max(y + 8, Math.min(y + h - 8, lcy))
      }
      const line = document.createElementNS(NS, 'line')
      line.setAttribute('x1', String(sx))
      line.setAttribute('y1', String(sy))
      line.setAttribute('x2', String(ex))
      line.setAttribute('y2', String(ey))
      line.setAttribute('stroke', RED)
      line.setAttribute('stroke-width', '3')
      line.setAttribute('stroke-linecap', 'round')
      line.setAttribute('marker-end', 'url(#__ma_arrow)')
      svg.appendChild(line)

      // 标签胶囊
      const g = document.createElementNS(NS, 'g')
      g.setAttribute('filter', 'url(#__ma_shadow)')
      const pill = document.createElementNS(NS, 'rect')
      pill.setAttribute('x', String(pick.lx))
      pill.setAttribute('y', String(pick.ly))
      pill.setAttribute('width', String(labelW))
      pill.setAttribute('height', String(LABEL_H))
      pill.setAttribute('rx', String(LABEL_H / 2))
      pill.setAttribute('fill', RED)
      g.appendChild(pill)
      const circle = document.createElementNS(NS, 'circle')
      circle.setAttribute('cx', String(pick.lx + 17))
      circle.setAttribute('cy', String(pick.ly + LABEL_H / 2))
      circle.setAttribute('r', '12')
      circle.setAttribute('fill', '#fff')
      g.appendChild(circle)
      const num = document.createElementNS(NS, 'text')
      num.setAttribute('x', String(pick.lx + 17))
      num.setAttribute('y', String(pick.ly + LABEL_H / 2 + 5))
      num.setAttribute('text-anchor', 'middle')
      num.setAttribute('font-size', '14')
      num.setAttribute('font-weight', '700')
      num.setAttribute('fill', RED)
      num.textContent = String(i + 1)
      g.appendChild(num)
      const t = document.createElementNS(NS, 'text')
      t.setAttribute('x', String(pick.lx + 36))
      t.setAttribute('y', String(pick.ly + LABEL_H / 2 + 5))
      t.setAttribute('font-size', '15')
      t.setAttribute('font-weight', '600')
      t.setAttribute('fill', '#fff')
      t.textContent = text.slice(String(i + 1).length + 2)
      g.appendChild(t)
      svg.appendChild(g)
    })
    document.body.appendChild(svg)
  }, boxes)
}

async function clearAnnotations(page) {
  await page.evaluate(() => document.getElementById('__manual_annotations__')?.remove()).catch(() => {})
}

/** 截图：先叠标注，截完清掉。 */
async function shot(page, name, items = []) {
  await sleep(500)
  if (items.length) await annotate(page, items)
  await sleep(200)
  await page.screenshot({ path: path.join(OUT, `${name}.png`), type: 'png' })
  await clearAnnotations(page)
  console.log('saved', name)
}

/** 在个人面板里切换到指定空间（按空间名精确匹配）。 */
async function switchSpace(page, name) {
  await page.locator('.apptop__user-btn').click()
  await sleep(1000)
  await page.locator('#apptop-user-panel').getByText(name, { exact: true }).first().click()
  await sleep(3000)
  await page.keyboard.press('Escape')
}

// ───────────────────────── 游客页面 ─────────────────────────

async function guestShots(page) {
  await go(page, '/welcome')
  await shot(page, 'welcome', [
    { find: R('button', '开始创作'), label: '点击开始创作，进入首页' },
    { find: R('button', '登录'), label: '已有账号点这里登录', at: 'left' },
  ])

  await go(page, '/login')
  await shot(page, 'login-sms', [
    { find: T('短信登录'), label: '短信登录：手机号 + 验证码', at: 'left' },
    { find: T('密码登录'), label: '或切换到密码登录', at: 'right' },
    { find: T('免费注册'), label: '没有账号先注册', at: 'right' },
    { find: T('获取验证码'), label: '输入手机号后获取验证码', at: 'top' },
    { find: R('button', '登录'), label: '勾选协议后登录', at: 'bottom' },
    { find: T('忘记密码？'), label: '忘记密码在这里重置', at: 'right' },
  ])
  await tryStep('密码登录', async () => {
    await clickText(page, '密码登录')
    await shot(page, 'login-password', [
      { find: L('手机号'), label: '输入手机号', at: 'left' },
      { find: L('密码'), label: '输入密码', at: 'left' },
      { find: R('button', '登录'), label: '点击登录', at: 'bottom' },
    ])
  })
  await tryStep('注册弹窗', async () => {
    await clickText(page, '免费注册')
    // 弹窗在 DOM 末尾，用 .last() 避开背后登录表单里的同名输入框。
    const inModal = (css) => (page) => page.locator(css).last()
    await shot(page, 'register', [
      { find: inModal('input[placeholder="手机号"]'), label: '填写手机号', at: 'left' },
      { find: inModal('input[placeholder="密码"]'), label: '设置密码（可不填）', at: 'left' },
      {
        find: (page) => page.getByText('获取验证码', { exact: true }).last(),
        label: '获取并填入短信验证码',
        at: 'right',
      },
      {
        find: (page) => page.getByRole('button', { name: '注册', exact: true }).last(),
        label: '点击注册，自动登录',
        at: 'bottom',
      },
    ])
    await page.keyboard.press('Escape')
  })

  await go(page, '/smart')
  await tryStep('制作图片', async () => {
    await clickText(page, '制作图片')
    await shot(page, 'smart-entry-image-guest', [
      { find: T('制作图片'), label: '切换到「制作图片」', at: 'top' },
      { find: C('textarea'), label: '描述想要的营销图片', at: 'bottom' },
      { find: T('去制作'), label: '点击去制作', at: 'top' },
    ])
  })
}

// ───────────────────────── 登录态页面 ─────────────────────────

async function homeShots(page) {
  await go(page, '/home')
  await shot(page, 'home', [
    { find: R('button', '爆款成片'), label: '创作入口：爆款成片', at: 'right' },
    { find: T('快捷入口'), label: '首页快捷入口卡片', at: 'right' },
    { find: C('.apptop__member'), label: '会员中心：套餐与积分', at: 'left' },
    { find: C('.apptop__user-btn'), label: '头像：个人面板 / 切换空间', at: 'bottom' },
    { find: C('.home__tabs'), label: '模板库 / 历史项目 / IP / 需求市场', at: 'right' },
  ])
  await tryStep('个人面板', async () => {
    await page.locator('.apptop__user-btn').click()
    await sleep(1200)
    await shot(page, 'personal-panel', [
      { find: C('.apptop__user-btn'), label: '点击头像打开个人面板', at: 'left' },
      { find: T('积分明细'), label: '查看积分流水', at: 'left' },
      { find: T('切换空间'), label: '在这里切换个人 / 团队空间', at: 'left' },
      { find: T('个人空间'), label: '当前所在空间', at: 'left' },
    ])
    await page.keyboard.press('Escape')
  })
  await tryStep('会员中心', async () => {
    await page.locator('.apptop__member').click()
    await sleep(2500)
    await shot(page, 'member-center', [
      { find: T('基础版'), label: '个人版套餐', at: 'left' },
      { find: T('团队版'), label: '团队版：可创建团队', at: 'bottom' },
      { find: T('积分充值'), label: '购买积分包', at: 'right' },
      { find: R('button', '立即开通'), label: '选择套餐后开通', at: 'bottom' },
    ])
    await page.keyboard.press('Escape')
    await sleep(500)
  })
  await tryStep('历史项目', async () => {
    await page.locator('.home__tabs').getByText('历史项目', { exact: true }).first().click()
    await sleep(2000)
    await shot(page, 'home-history', [
      {
        find: () => page.locator('.home__tabs').getByText('历史项目', { exact: true }).first(),
        label: '最近生成的视频',
        at: 'top',
      },
    ])
  })
  await tryStep('IP', async () => {
    await page.locator('.home__tabs').getByText('IP', { exact: true }).first().click()
    await sleep(2000)
    await shot(page, 'home-ip', [
      {
        find: () => page.locator('.home__tabs').getByText('IP', { exact: true }).first(),
        label: 'IP 创作者列表',
        at: 'top',
      },
      { find: L('按领域筛选'), label: '按领域 / 平台 / 粉丝数筛选', at: 'top' },
    ])
  })
  await tryStep('需求市场', async () => {
    await page.locator('.home__tabs').getByText('需求市场', { exact: true }).first().click()
    await sleep(2000)
    await shot(page, 'home-market', [
      {
        find: () => page.locator('.home__tabs').getByText('需求市场', { exact: true }).first(),
        label: '需求市场',
        at: 'top',
      },
      { find: T('价格排序', false), label: '按价格 / 时间排序', at: 'top' },
      { find: R('button', '发布需求'), label: '点击发布需求', at: 'top' },
    ])
  })
  await tryStep('发布需求', async () => {
    await clickText(page, '发布需求')
    await sleep(1200)
    await shot(page, 'demand-publish', [
      { find: T('需求标题'), label: '填写标题与详细描述', at: 'left' },
      { find: T('产品素材'), label: '上传产品素材', at: 'left' },
      { find: T('报名截止时间'), label: '设置报名截止与交付时间', at: 'left' },
      { find: T('价格'), label: '填写单价与数量', at: 'left' },
      { find: R('button', '确定'), label: '确定发布', at: 'left' },
    ])
    await page.keyboard.press('Escape')
  })
  await tryStep('通知中心', async () => {
    await page.getByLabel(/通知/).first().click()
    await sleep(1200)
    await shot(page, 'notifications', [
      { find: L(/通知/), label: '点击铃铛查看通知', at: 'left' },
      { find: T('全部已读'), label: '一键全部已读', at: 'right' },
    ])
    await page.keyboard.press('Escape')
  })
  await tryStep('设置菜单', async () => {
    await page.locator('.app-sidebar__footer').getByText('设置').click()
    await sleep(800)
    await shot(page, 'settings-menu', [
      { find: () => page.locator('.app-sidebar__footer').getByText('设置'), label: '点击设置', at: 'right' },
      { find: T('个人中心'), label: '修改头像、昵称', at: 'right' },
      { find: T('修改密码'), label: '通过验证码改密码', at: 'right' },
      { find: T('退出登录'), label: '退出当前账号', at: 'right' },
    ])
    await clickText(page, '个人中心')
    await sleep(1000)
    await maskPhones(page)
    await shot(page, 'personal-center', [
      { find: L('更换头像'), label: '更换头像（JPG/PNG ≤2MB）', at: 'bottom' },
      { find: C('input[placeholder="请输入昵称"]'), label: '修改昵称', at: 'top' },
      { find: R('button', '保存'), label: '保存', at: 'bottom' },
    ])
    await page.keyboard.press('Escape')
  })
  await tryStep('加入空间', async () => {
    await clickText(page, '加入空间')
    await sleep(800)
    await shot(page, 'join-team', [
      { find: T('加入空间'), label: '侧栏「加入空间」', at: 'right' },
      { find: C('input[placeholder="输入团队邀请码"]'), label: '粘贴团队邀请码', at: 'top' },
      { find: R('button', '确认加入'), label: '确认加入', at: 'bottom' },
    ])
    await page.keyboard.press('Escape')
  })
}

async function teamShots(page) {
  if (!TEAM_SPACE) return
  await go(page, '/home')
  await tryStep('切换到团队空间', async () => {
    await switchSpace(page, TEAM_SPACE)
    await sleep(1500)
    await shot(page, 'home-team-space', [
      { find: L('打开空间数据看板'), label: '当前团队：点击打开数据看板', at: 'right' },
      { find: L('邀请成员'), label: '邀请成员 / 团队管理', at: 'right' },
      { find: T('加入空间'), label: '加入其他团队', at: 'right' },
    ])
    await tryStep('团队管理', async () => {
      await page.getByLabel('邀请成员').first().click()
      await sleep(2500)
      await maskPhones(page)
      await shot(page, 'team-manage', [
        { find: L('复制邀请码'), label: '复制邀请码发给成员', at: 'right' },
        { find: T('撤销邀请'), label: '撤销 / 重新生成邀请码', at: 'bottom' },
        { find: T('成员信息'), label: '成员列表', at: 'right' },
        { find: () => page.getByLabel('更多操作').nth(1), label: '成员操作：角色 / 配额 / 移出', at: 'left' },
        { find: L('更多操作'), label: '退出或解散空间', at: 'left' },
      ])
      await page.keyboard.press('Escape')
    })
    await go(page, '/team')
    await sleep(2000)
    await shot(page, 'team-dashboard', [
      { find: L('统计月份'), label: '选择统计月份', at: 'left' },
      { find: T('总生成视频数'), label: '核心指标', at: 'right' },
      { find: T('成员人数'), label: '成员 / 项目 / 积分消耗', at: 'top' },
    ])
    await go(page, '/home')
    await switchSpace(page, '个人空间')
  })
}

async function smartEntryShots(page) {
  await go(page, '/smart')
  // /smart 会恢复上次的创作草稿直接进编辑器；手册要的是空白入口，看到编辑器就点「创建新视频」。
  if ((await page.getByText('制作视频', { exact: true }).count()) === 0) {
    await tryStep('回到创作入口', async () => {
      await clickText(page, '创建新视频', { after: 2500 })
    })
  }
  await tryStep('收起任务面板', async () => {
    await page.getByLabel('收起任务管理').first().click({ timeout: 2000 })
    await sleep(800)
  })
  await shot(page, 'smart-entry', [
    { find: T('制作视频'), label: '创作类型：制作视频 / 制作图片', at: 'top' },
    { find: L('添加素材'), label: '添加素材：本地上传 / 素材库', at: 'left' },
    { find: C('textarea'), label: '描述你想要的视频', at: 'top' },
    { find: L(/生成模型|选择模型/), label: '先选模型', at: 'bottom' },
    { find: L(/创作参数/), label: '比例 / 时长 / 分辨率', at: 'bottom' },
    { find: R('button', '@'), label: '@ 引用素材', at: 'bottom' },
    { find: T('爆款脚本自动生成'), label: '选广告类型，多一步营销拆解', at: 'bottom' },
    { find: L('语音输入'), label: '语音输入', at: 'bottom' },
    { find: T('去制作'), label: '点击去制作', at: 'bottom' },
  ])
  await tryStep('爆款脚本', async () => {
    await clickText(page, '爆款脚本自动生成')
    await sleep(800)
    await shot(page, 'smart-skill', [
      { find: T('爆款脚本自动生成'), label: '点击展开', at: 'top' },
      { find: T('电商广告'), label: '选择广告类型', at: 'right' },
    ])
    await page.keyboard.press('Escape')
    await sleep(400)
  })
  await tryStep('模型选择', async () => {
    await page
      .getByLabel(/生成模型|选择模型/)
      .first()
      .click()
    await sleep(2500)
    await shot(page, 'smart-model-picker', [
      { find: L(/生成模型|选择模型/), label: '点击打开模型选择', at: 'bottom' },
      { find: T('脚本生成模型'), label: '为每个环节选一个模型', at: 'right' },
      { find: T('视频生成模型'), label: '选中后显示能力边界与预估消耗', at: 'right' },
    ])
    await page.keyboard.press('Escape')
  })
  await tryStep('帮助中心', async () => {
    await page.locator('img.hc-ball-icon').locator('xpath=..').click()
    await sleep(1000)
    await shot(page, 'help-center', [
      { find: C('img.hc-ball-icon, [class*="hc-ball"]'), label: '点击悬浮球', at: 'left' },
      { find: T('帮助中心'), label: '常见问题', at: 'left' },
      { find: T('学习中心'), label: '图文教程', at: 'left' },
      { find: T('意见反馈'), label: '提交反馈', at: 'left' },
      { find: T('智能客服'), label: '联系客服', at: 'bottom' },
    ])
    await clickText(page, '意见反馈')
    await sleep(800)
    await shot(page, 'help-feedback', [
      { find: T('反馈类型'), label: '选择反馈类型', at: 'left' },
      { find: C('textarea[placeholder*="反馈"]'), label: '填写反馈内容（≤200 字）', at: 'left' },
      { find: T('反馈历史'), label: '查看处理进度', at: 'top' },
    ])
    await page.keyboard.press('Escape')
  })
}

async function hotCopyShots(page) {
  await go(page, '/hot-copy')
  await shot(page, 'hotcopy-entry', [
    { find: T('上传爆款视频'), label: '1 条爆款源视频（≤200MB）', at: 'bottom' },
    { find: T('上传替换素材'), label: '1~9 张替换图片', at: 'top' },
    { find: C('textarea'), label: '描述替换意图', at: 'top' },
    { find: L(/生成模型|选择模型/), label: '选择视频模型', at: 'bottom' },
    { find: L(/创作参数/), label: '时长 / 分辨率 / 背景音', at: 'bottom' },
    { find: T('去制作'), label: '点击去制作', at: 'bottom' },
  ])
}

async function libraryShots(page) {
  await go(page, '/templates')
  await shot(page, 'templates', [
    { find: C('input[placeholder="搜索案例..."]'), label: '搜索案例', at: 'left' },
    {
      find: C('.home__masonry > *, .home__tpl, [class*="tpl-card"], [class*="case-card"]'),
      label: '悬停卡片：播放 / 下载 / 做同款',
      at: 'right',
    },
  ])

  await go(page, '/projects')
  await shot(page, 'projects', [
    { find: R('button', '新建项目'), label: '新建空项目', at: 'bottom' },
    { find: C('input[placeholder="搜索项目名称、团队"]'), label: '搜索项目', at: 'bottom' },
    { find: L('按创作流程筛选'), label: '按流程 / 类型 / 状态 / 模型筛选', at: 'bottom' },
    { find: C('.pm2-pcard'), label: '点击卡片进入项目视频', at: 'right' },
    {
      find: () => page.locator('.pm2-pcard').first().getByLabel('更多操作'),
      label: '重命名 / 成员权限 / 删除',
      at: 'right',
    },
  ])
  await tryStep('项目视频列表', async () => {
    await page.locator('.pm2-pcard').first().click()
    await page.waitForURL(/\/projects\/\d+\/videos/, { timeout: 8000 })
    await sleep(3000)
    await shot(page, 'project-videos', [
      { find: L('重命名项目'), label: '重命名项目', at: 'right' },
      { find: C('input[placeholder="搜索视频..."]'), label: '搜索 / 筛选 / 排序', at: 'right' },
      { find: R('button', /新建视频/), label: '在本项目下新建视频', at: 'bottom' },
      { find: C('.pvlist-card'), label: '视频卡片：点击播放', at: 'bottom' },
      { find: () => page.locator('.pvlist-card').first().getByLabel('更多操作'), label: '更多操作', at: 'right' },
    ])
    await tryStep('视频详情', async () => {
      await page.locator('.pvlist-card').first().getByLabel('更多操作').click()
      await sleep(600)
      await shot(page, 'project-video-menu', [
        {
          find: () => page.locator('.pvlist-card__menu button', { hasText: '查看详情' }),
          label: '查看详情',
          at: 'right',
        },
        {
          find: () => page.locator('.pvlist-card__menu button', { hasText: '进入编辑' }),
          label: '回到创作页继续修改',
          at: 'right',
        },
        { find: () => page.locator('.pvlist-card__menu button', { hasText: '下载视频' }), label: '下载', at: 'right' },
        { find: () => page.locator('.pvlist-card__menu button', { hasText: '删除视频' }), label: '删除', at: 'right' },
      ])
      await page.locator('.pvlist-card__menu button', { hasText: '查看详情' }).first().click()
      await page.waitForURL(/\/videos\/[^/?#]+/, { timeout: 8000 })
      await sleep(3000)
      await shot(page, 'video-detail', [
        { find: R('button', '进入编辑'), label: '进入编辑', at: 'bottom' },
        { find: R('button', '下载视频'), label: '下载视频', at: 'bottom' },
        { find: R('button', '删除视频'), label: '删除视频', at: 'bottom' },
        { find: T('基础信息'), label: '模型、分辨率、状态等信息', at: 'left' },
      ])
      await tryStep('进入编辑', async () => {
        await clickText(page, '进入编辑', { after: 4000 })
        await page.waitForURL(/\/(smart|hot-copy)\//, { timeout: 10000 })
        await sleep(5000)
        await tryStep('分镜脚本', async () => {
          await page.locator('[data-guide="smart-stepbar"]').getByText('分镜脚本').first().click()
          await sleep(3000)
          await shot(page, 'smart-script', [
            { find: C('[data-guide="smart-stepbar"]'), label: '步骤条：可切换已生成的步骤', at: 'bottom' },
            { find: T('画面描述'), label: '双击单元格即可修改', at: 'top' },
            { find: L('打开分镜回收站'), label: '分镜回收站', at: 'right' },
            { find: R('button', '生成视频'), label: '确认后生成视频', at: 'top' },
            { find: T('创建新视频'), label: '另起一个新视频', at: 'left' },
          ])
        })
        await tryStep('生成视频', async () => {
          await page.locator('[data-guide="smart-stepbar"]').getByText('生成视频').first().click()
          await sleep(3000)
          await shot(page, 'smart-video-stage', [
            { find: C('video'), label: '预览成片', at: 'left' },
            { find: T('历史生成'), label: '切换历史版本', at: 'right' },
            { find: T('整段视频修改'), label: '用大白话描述要改什么', at: 'right' },
            { find: T('AI一键润色'), label: 'AI 补全专业指令', at: 'left' },
            { find: R('button', '下载视频'), label: '下载', at: 'top' },
            { find: R('button', '确认修改'), label: '提交修改（显示预计费用）', at: 'top' },
            { find: T('生成多个视频'), label: '重新出片', at: 'top' },
          ])
        })
        await tryStep('任务管理', async () => {
          await page.getByLabel('展开任务管理').first().click()
          await sleep(1500)
          await shot(page, 'task-center', [
            { find: L('收起任务管理'), label: '收起 / 展开任务管理', at: 'right' },
            { find: T('正在生成'), label: '按状态 / 类型查看任务', at: 'bottom' },
            { find: T('查看全部视频'), label: '前往项目管理', at: 'top' },
          ])
        })
      })
    })
  })

  await go(page, '/resources')
  await shot(page, 'resources', [
    { find: C('.rm2-tabs'), label: '全部 / 我上传的 / 我生成的 / 我收藏的 / 真人素材库', at: 'bottom' },
    { find: C('input[placeholder*="搜索素材名称"]'), label: '搜索素材', at: 'bottom' },
    { find: T('选择本页'), label: '批量下载 / 删除', at: 'bottom' },
    { find: C('.resource-asset-card'), label: '悬停：预览 / 下载 / 发布作品 / 去创作 / 删除', at: 'right' },
  ])
  await tryStep('真人素材库', async () => {
    await page.locator('.rm2-tabs').getByText('真人素材库').click()
    await sleep(2500)
    await shot(page, 'real-person-library', [
      { find: () => page.locator('.rm2-tabs').getByText('真人素材库'), label: '真人素材库', at: 'bottom' },
      { find: T('创建新形象'), label: '创建新形象：认证后上传素材', at: 'right' },
    ])
    await tryStep('创建新形象', async () => {
      await clickText(page, '创建新形象')
      await sleep(1500)
      await shot(page, 'real-person-create', [
        { find: T('真人认证'), label: '第 1 步：真人认证', at: 'bottom' },
        { find: T('上传照片'), label: '第 2 步：上传照片 / 视频', at: 'bottom' },
        { find: C('input[placeholder="请输入真人形象名称"]'), label: '填写形象名称', at: 'top' },
        { find: T('我确认已取得本人授权，并同意进行真人身份认证'), label: '勾选授权确认', at: 'left' },
        { find: T('开始真人认证'), label: '扫码或人脸认证，约 1 分钟', at: 'bottom' },
      ])
      await page.keyboard.press('Escape')
    })
  })

  await canvasShots(page)
  await creditsShots(page)
}

/** 无限画布：列表 / 编辑器 / 添加菜单 / 节点面板 / 分享。 */
async function canvasShots(page) {
  await go(page, '/canvas')
  await shot(page, 'canvas-list', [
    { find: R('button', '新建画布'), label: '新建画布', at: 'left' },
    { find: C('.pm2-pcard'), label: '点击卡片打开画布', at: 'right' },
    { find: () => page.locator('.pm2-pcard').first().getByLabel('更多操作'), label: '编辑 / 归档 / 删除', at: 'right' },
  ])
  await tryStep('画布编辑器', async () => {
    await page.locator('.pm2-pcard').first().click()
    await page.waitForURL(/\/canvas\/\d+/, { timeout: 8000 })
    await sleep(5000)
    await shot(page, 'canvas-view', [
      { find: R('button', /^添加/), label: '添加节点 / 素材', at: 'right' },
      { find: R('button', /搜索/), label: '搜索节点（Ctrl+F）', at: 'right' },
      { find: R('button', /历史/), label: '历史生成结果', at: 'right' },
      { find: L('分享这块画布'), label: '生成只读分享链接', at: 'left' },
      { find: L('画布视图控制'), label: '缩放 / 网格 / 连线 / 小地图', at: 'right' },
      { find: L('画布缩略图'), label: '小地图：点击直达', at: 'right' },
    ])
    await tryStep('添加菜单', async () => {
      await page.getByRole('button', { name: /^添加/ }).first().click()
      await sleep(1000)
      await shot(page, 'canvas-add-menu', [
        { find: T('新建节点'), label: '新建空节点，内容靠生成', at: 'right' },
        { find: T('视频剪辑'), label: '把多段视频串成成片', at: 'right' },
        { find: T('添加素材'), label: '放入已有素材', at: 'right' },
        { find: T('本地上传'), label: '也可拖拽 / Ctrl+V 粘贴', at: 'right' },
      ])
      // Escape 关不掉这个菜单，再点一次「添加」按钮收起。
      await page.getByRole('button', { name: /^添加/ }).first().click()
      await sleep(600)
    })
    await tryStep('节点面板', async () => {
      const nodes = page.locator('.react-flow__node')
      const count = await nodes.count()
      let target = page.locator('.react-flow__node-video, .react-flow__node[data-type="video"]').first()
      if ((await target.count()) === 0) target = nodes.nth(Math.min(2, count - 1))
      await target.scrollIntoViewIfNeeded()
      await target.click({ force: true })
      await sleep(1500)
      await shot(page, 'canvas-node-panel', [
        { find: L('节点操作'), label: '节点工具栏：重命名 / 截帧 / 预览 / 下载 / 删除', at: 'top' },
        { find: C('textarea'), label: '提示词：输入 @ 引用参考图', at: 'top' },
        { find: T('AI 一键润色', false), label: 'AI 润色提示词', at: 'top' },
        { find: T('真人素材库'), label: '模型 / 真人素材 / 生成方式与参数', at: 'bottom' },
        {
          find: R('button', /约.*元|发送生成/),
          label: '发送生成（显示预估费用）',
          at: 'bottom',
        },
      ])
    })
    await tryStep('分享画布', async () => {
      await page.getByLabel('分享这块画布').first().click()
      await sleep(2000)
      await shot(page, 'canvas-share', [
        { find: L('分享这块画布'), label: '点击分享', at: 'left' },
        { find: R('button', /生成链接|重新生成链接/), label: '生成只读链接', at: 'bottom' },
      ])
      await page.keyboard.press('Escape')
    })
  })
}

/** 积分明细与我的合作。 */
async function creditsShots(page) {
  await go(page, '/credits')
  await shot(page, 'credits', [
    {
      find: (page) => page.locator('.credits__card').filter({ hasText: '可用余额' }).first(),
      label: '可用积分',
      at: 'bottom',
    },
    { find: R('button', '充值积分'), label: '充值积分', at: 'bottom' },
    {
      find: (page) => page.locator('.credits__card').filter({ hasText: '冻结中' }).first(),
      label: '生成中按预估先冻结',
      at: 'bottom',
    },
    { find: T('消费'), label: '按消费 / 退回 / 冻结筛选', at: 'right' },
  ])
  await go(page, '/collaborations')
  await shot(page, 'collaborations', [
    { find: T('我的发布'), label: '我发布的需求', at: 'bottom' },
    { find: T('我的接单'), label: '我提交的接单申请', at: 'right' },
    { find: T('详情'), label: '查看申请、接受 / 拒绝', at: 'left' },
    { find: T('取消'), label: '取消需求', at: 'right' },
  ])
}

// ───────────────────────── 入口 ─────────────────────────

async function runGuest() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
    locale: 'zh-CN',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  try {
    await guestShots(page)
  } finally {
    await browser.close()
  }
}

async function runAuth() {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: process.env.MANUAL_HEADLESS === '1',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
    locale: 'zh-CN',
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const page = context.pages()[0] || (await context.newPage())
  page.setDefaultTimeout(8000)
  try {
    await go(page, '/home')
    // 会话恢复是异步的：顶栏会先渲染游客态「登录」，几秒后才换成用户头像，必须等头像本身。
    await page
      .locator('.apptop__user')
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => {})
    const loggedIn = async () => (await page.locator('.apptop__user').count()) > 0
    if (!(await loggedIn())) {
      if (process.env.MANUAL_HEADLESS === '1') throw new Error('该 profile 没有登录态，请先有头运行并登录')
      await go(page, '/login')
      console.log('WAITING_FOR_LOGIN')
      const deadline = Date.now() + 20 * 60 * 1000
      while (Date.now() < deadline) {
        await sleep(2000)
        if (page.url().includes('/login')) continue
        if (await loggedIn()) break
      }
      if (!(await loggedIn())) throw new Error('登录超时')
    }
    console.log('LOGGED_IN')
    await homeShots(page)
    await teamShots(page)
    await smartEntryShots(page)
    await hotCopyShots(page)
    await libraryShots(page)
  } finally {
    await context.close()
  }
}

/** 只截爆款成片编辑器（分镜脚本 / 生成视频 / 任务管理）：从项目管理筛选「爆款成片」项目进入。 */
async function editorShots(page) {
  await go(page, '/projects')
  // 注意别点到侧栏同名的「爆款成片」导航，只在筛选组里找。
  await page.getByLabel('按创作流程筛选').getByText('爆款成片', { exact: true }).first().click()
  await sleep(2000)
  await page.locator('.pm2-pcard').first().click()
  await page.waitForURL(/\/projects\/\d+\/videos/, { timeout: 8000 })
  await sleep(3000)
  await page.locator('.pvlist-card').first().getByLabel('更多操作').click()
  await sleep(600)
  await page.locator('.pvlist-card__menu button', { hasText: '进入编辑' }).first().click()
  await page.waitForURL(/\/smart\//, { timeout: 10000 })
  await sleep(6000)
  // 编辑区定位器：只在 .smart__main 里找，避免左侧任务面板里的同名文字抢占。
  const main = () => page.locator('.smart__main')
  const MT = (text) => () => main().getByText(text, { exact: true }).locator('visible=true').first()
  const MR = (role, name) => () => main().getByRole(role, { name, exact: true }).first()
  const MC = (css) => () => main().locator(css).first()
  // 任务面板默认展开，先收起，让编辑区截图干净。
  await tryStep('收起任务面板', async () => {
    await page.getByLabel('收起任务管理').first().click({ timeout: 3000 })
    await sleep(800)
  })
  await tryStep('分镜脚本', async () => {
    await page.locator('[data-guide="smart-stepbar"]').getByText('分镜脚本').first().click()
    await sleep(3000)
    await shot(page, 'smart-script', [
      { find: C('[data-guide="smart-stepbar"]'), label: '步骤条：可切换已生成的步骤', at: 'bottom' },
      { find: MT('画面描述'), label: '双击单元格即可修改', at: 'top' },
      { find: MT('台词/旁白'), label: '台词 / 字幕 / 音效一并送进生成', at: 'top' },
      { find: L('打开分镜回收站'), label: '分镜回收站（可拖动）', at: 'right' },
      { find: MR('button', '生成视频'), label: '确认后生成视频', at: 'top' },
      { find: MT('创建新视频'), label: '另起一个新视频', at: 'left' },
    ])
  })
  await tryStep('生成视频', async () => {
    await page.locator('[data-guide="smart-stepbar"]').getByText('生成视频').first().click()
    await sleep(3000)
    await shot(page, 'smart-video-stage', [
      { find: MC('video'), label: '预览成片', at: 'left' },
      { find: MT('历史生成'), label: '切换历史版本', at: 'right' },
      { find: MT('整段视频修改'), label: '用大白话描述要改什么，AI 补全指令', at: 'left' },
      { find: MR('button', '下载视频'), label: '下载', at: 'top' },
      { find: MR('button', '确认修改'), label: '提交修改（显示预计费用）', at: 'top' },
      { find: MT('生成多个视频'), label: '重新出片', at: 'top' },
    ])
  })
  await tryStep('任务管理', async () => {
    await page.getByLabel('展开任务管理').first().click()
    await sleep(1500)
    await shot(page, 'task-center', [
      { find: L('收起任务管理'), label: '收起 / 展开任务管理', at: 'right' },
      { find: T('正在生成'), label: '按状态 / 类型查看任务', at: 'bottom' },
      { find: T('查看全部视频'), label: '前往项目管理', at: 'top' },
    ])
  })
}

async function runEditor() {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: process.env.MANUAL_HEADLESS === '1',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
    locale: 'zh-CN',
  })
  const page = context.pages()[0] || (await context.newPage())
  page.setDefaultTimeout(8000)
  try {
    await go(page, '/home')
    await page.locator('.apptop__user').first().waitFor({ timeout: 30000 })
    if (mode === 'smart') await smartEntryShots(page)
    else if (mode === 'canvas') await canvasShots(page)
    else await editorShots(page)
  } finally {
    await context.close()
  }
}

;(async () => {
  if (mode === 'guest' || mode === 'all') await runGuest()
  if (mode === 'auth' || mode === 'all') await runAuth()
  if (mode === 'editor' || mode === 'smart' || mode === 'canvas') await runEditor()
})().catch((e) => {
  console.error('FAILED', e)
  process.exit(1)
})
