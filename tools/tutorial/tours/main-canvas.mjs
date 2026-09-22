/** 无限画布 · 功能全览一条（目标 70–90 秒）
 *  A 新画布：工具栏 → 图片节点（提示词 / AI 润色 / 放大 / 比例）→ 拖出视频节点（@引用 / 模型参数 / 真人素材库）
 *  B 已有画布「测试」：节点操作条 → 放大预览 + 截取此帧 → 框选 → 创建剪辑时间线 → 剪辑器 → 素材库 / 历史 / 搜索 → 自动保存 / 分享
 *  生成按钮只悬停，不消耗积分。 */
const HIDE = `.hc-ball,.notify__bell{display:none!important}`
const RESULT_CANVAS = process.env.TUTORIAL_CANVAS_NAME || '测试'

export default {
  single: true,
  name: '无限画布功能全览',
  async run(t) {
    const { page, BASE } = t
    const clean = () => page.addStyleTag({ content: HIDE }).catch(() => {})
    const opt = async (fn) => { try { await fn() } catch (e) { console.warn('跳过:', e.message.split('\n')[0]) } }

    // ── A. 新建画布 ──
    await page.goto(`${BASE}/canvas`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('button.pm2-new-btn', { timeout: 15000 })
    await clean(); await t.wait(300)
    await t.clip('无限画布')
    await t.say('点击「新建画布」，起名创建')
    await t.click('button.pm2-new-btn', { after: 400 })
    await t.type('input[placeholder*="画布名称"]', '教程演示', { delay: 50, after: 150 })
    await t.click('button:has-text("创建画布")', { after: 300 })
    await page.waitForURL(/\/canvas\/\d+/, { timeout: 20000 })
    await page.waitForSelector('button[class*="toolBtn"]', { timeout: 20000 })
    await clean(); await t.wait(400)

    await t.say('左侧工具栏：添加节点、平移、拖拽、框选、搜索、素材库、历史')
    for (const n of ['添加', '平移', '框选', '搜索', '素材', '历史']) { await t.moveTo(`button[class*="toolBtn"]:has-text("${n}")`, { ms: 220 }); await t.wait(180) }
    await t.wait(300)

    await t.say('点「+」添加图片节点')
    await t.click('button[class*="toolBtn"]:has-text("添加")', { after: 350 })
    await t.click('button[class*="addMenuItem"]:has-text("图片节点")', { after: 800 })
    await t.say('写提示词，点「AI 一键润色」自动补全主体、环境、风格')
    await t.type('textarea[class*="_textarea"]', '花园温室里的银发少女，白裙，柔光', { delay: 40, after: 250 })
    await t.click('button[class*="polishBtn"]:has-text("润色")', { after: 300 })
    await t.cut()
    await page.locator('button[class*="polishBtn"]:has-text("润色中")').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})
    await t.wait(300)
    await t.clip('无限画布')
    await t.say('长文本可以「放大」编辑；底部选模型和比例，然后生成')
    await opt(() => t.click('button[class*="expandBtn"]', { after: 900 }))
    await opt(() => t.click('button[class*="expandBtn"]', { after: 300 }))
    await t.moveTo('button[class*="_selector"] >> nth=0'); await t.wait(350)
    await t.moveTo('button[class*="_selector"] >> nth=1'); await t.wait(350)
    await t.moveTo('button[class*="generateBtn"]'); await t.wait(700)

    await t.say('从节点右侧「+」拖出视频节点，自动继承上游图片作参考')
    await t.click('button.canvas-handle-icon--right', { after: 400 })
    await t.click('button.canvas-add-menu__item:has-text("视频节点")', { after: 900 })
    await t.say('输入 @ 可以引用参考素材')
    const ta = page.locator('textarea[class*="_textarea"]').last()
    await t.click(ta, { after: 150 })
    await page.keyboard.type('让 ', { delay: 50 })
    await page.keyboard.type('@', { delay: 50 }); await t.wait(900)
    await opt(async () => { const it = page.locator('[class*="mention"] [role=option], [class*="mention"] button, [class*="Mention"] li').first(); if (await it.count()) await t.click(it, { after: 300 }) })
    await page.keyboard.press('Escape').catch(() => {})
    await page.keyboard.type('缓缓转身，微风拂过花丛', { delay: 40 }); await t.wait(300)
    await t.say('选视频模型和参数，也可以从「真人素材库」选人物，然后生成')
    await t.moveTo(page.locator('button[class*="_selector"]').nth(-2)); await t.wait(300)
    await opt(async () => { await t.moveTo('button:has-text("真人素材库")'); await t.wait(400) })
    await t.moveTo(page.locator('button[class*="generateBtn"]').last()); await t.wait(700)
    await t.cut()

    // ── B. 已有结果的画布 ──
    await page.goto(`${BASE}/canvas`, { waitUntil: 'domcontentloaded' })
    await page.locator(`div.pm2-pcard:has-text("${RESULT_CANVAS}")`).first().click()
    await page.waitForSelector('button.canvas-node-play-btn', { timeout: 20000 })
    await clean(); await t.wait(800)
    const play = page.locator('button.canvas-node-play-btn').first()
    await t.clip('无限画布')
    await t.zoom(play, 2.4, 0)
    await t.say('生成结果直接显示在节点里，点击播放')
    await t.click(play, { after: 2200 })
    await t.say('选中节点，上方操作条：重命名、截取画面、放大预览、下载、删除')
    // 点节点标题选中（坐标实时取，缩放下也准确）
    await t.click(page.locator('span.ie-display:has-text("视频")').first(), { after: 600 })
    for (let i = 0; i < 5; i++) { await opt(async () => { await t.moveTo(page.locator('button[class*="_action_"]').nth(i), { ms: 220 }); await t.wait(200) }) }
    await t.zoom(null, 1, 0)
    await t.say('「放大预览」里拖到任意一帧，点「截取此帧」，生成图片节点接下一镜')
    await t.click('button:has-text("放大预览")', { after: 1000 })
    await opt(async () => { const v = page.locator('video').last(); const b = await v.boundingBox(); await page.mouse.click(b.x + b.width * 0.5, b.y + b.height - 12); await t.wait(500) })
    await t.click('button:has-text("截取此帧")', { after: 1200 })
    await opt(() => t.click('button[class*="_close"]', { after: 500 }))
    await page.keyboard.press('Escape').catch(() => {}); await t.wait(300)

    await t.say('用「框选」选中多个视频，点「创建剪辑时间线」')
    await t.click('button[class*="toolBtn"]:has-text("框选")', { after: 300 })
    await page.mouse.move(600, 150); await page.mouse.down()
    for (let i = 1; i <= 12; i++) { const x = 600 + (1500 - 600) * i / 12, y = 150 + (800 - 150) * i / 12; await page.mouse.move(x, y); await page.evaluate(([x, y]) => window.__tut.move(x, y), [x, y]); await t.wait(40) }
    await page.mouse.up(); await t.wait(700)
    await opt(() => t.click('button:has-text("创建剪辑时间线")', { after: 1200 }))
    await t.say('双击时间线节点打开剪辑器：裁剪、换序，合成为一条视频')
    await opt(async () => {
      const tl = page.locator('span.ie-display:has-text("视频剪辑")').last()
      const b = await tl.boundingBox(); await t.moveTo(tl); await page.mouse.dblclick(b.x + 20, b.y + 60); await t.wait(1500)
      await opt(async () => { await t.moveTo('button:has-text("合成")'); await t.wait(600) })
      await page.keyboard.press('Escape'); await t.wait(400)
    })

    await t.say('「素材库」直接选用已有图片视频，「历史」回看每次生成，「搜索」按提示词找节点')
    await t.click('button[class*="toolBtn"]:has-text("素材")', { after: 900 }); await page.keyboard.press('Escape'); await t.wait(300)
    await t.click('button[class*="toolBtn"]:has-text("历史")', { after: 900 }); await opt(() => t.click('button[class*="_closeBtn"]', { after: 200 }))
    await t.click('button[class*="toolBtn"]:has-text("搜索")', { after: 500 }); await page.keyboard.type('少女', { delay: 60 }); await t.wait(600); await page.keyboard.press('Escape')
    await t.say('所有改动自动保存到云端，右上角可分享画布')
    await t.moveTo('button.canvas-share-btn'); await t.wait(1000)
    await t.say('', 200)
  },
}
