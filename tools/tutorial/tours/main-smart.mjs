/** 爆款成片 · 主流程一条（目标 35–45 秒）：选模型 → 写需求 → 去制作 → 分镜 → 生成视频 → 看成片 */
const FINISHED = process.env.TUTORIAL_FINISHED_PROJECT || '1188'
const HIDE = `[class*="vstageDebugBtn"],.hc-ball,.notify__bell{display:none!important}`

export default {
  single: true,
  name: '爆款成片主流程',
  async run(t) {
    const { page, BASE } = t
    const clean = () => page.addStyleTag({ content: HIDE }).catch(() => {})
    await page.goto(`${BASE}/smart`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('textarea', { timeout: 15000 })
    if (/\/smart\/\d+/.test(page.url())) { await page.locator('button.smart__newvideo').click().catch(() => {}); await page.waitForSelector('textarea') }
    await clean(); await t.wait(400)

    await t.clip('爆款成片')
    await t.say('点击「选择模型」')
    await t.click('button:has-text("选择模型")', { after: 400 })
    await t.zoom('button:has-text("请选择模型") >> nth=0', 1.45, 0)
    await t.say('先选脚本模型，再选视频模型')
    await t.click('button:has-text("请选择模型") >> nth=0', { after: 350 })
    await t.click('button[class*="_option"]:has-text("GPT")', { after: 450 })
    await t.click('button:has-text("请选择模型") >> nth=0', { after: 350 })
    await t.click('button[class*="_option"]:has-text("Seedance 2.0") >> nth=0', { after: 450 })
    await t.zoom(null, 1, 0)
    await page.keyboard.press('Escape'); await t.wait(250)

    await t.say('设置比例、时长和分辨率')
    await t.click('button:has-text("选择时长"), button:has-text("720p"), button:has-text("16:9")', { after: 450 })
    const dur = page.locator('button:has-text("10s"), button:has-text("10 秒"), button:has-text("10秒")').first()
    if (await dur.count()) await t.click(dur, { after: 400 })
    await page.keyboard.press('Escape'); await t.wait(250)

    await t.say('写一句需求')
    await t.type('textarea', '制作篮球广告', { delay: 60, after: 350 })
    await t.say('点击「去制作」')
    await t.click('button:has-text("去制作")', { after: 800 })
    await page.waitForURL(/\/smart\/\d+/, { timeout: 30000 }).catch(() => {})
    await clean()
    await t.say('AI 开始生成分镜脚本', 1200)
    await t.cut()
    await page.locator('text=分镜脚本生成完成').first().waitFor({ timeout: 150000 }).catch(() => {})
    await t.wait(400)

    await t.clip('爆款成片')
    await t.say('分镜脚本生成完成，内容可直接修改')
    await t.click(page.locator('span.ie-display').nth(1), { after: 700 })
    await page.keyboard.press('Escape'); await t.wait(200)
    await t.say('点击「生成视频」')
    await t.click('button.smart__btn-split--main:has-text("生成视频")', { after: 500 })
    await t.zoom('button:has-text("确认并生成")', 1.4, 0)
    await t.say('点「确认并生成」')
    await t.moveTo('button:has-text("确认并生成")'); await t.wait(700)
    await t.cut()
    await t.zoom(null, 1, 0)
    await page.locator('button:has-text("取消")').first().click().catch(() => {})
    await page.goto(`${BASE}/smart/${FINISHED}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('button[class*="vstageVer"]', { timeout: 20000 })
    await clean(); await t.wait(400)

    await t.clip('爆款成片')
    await t.say('几分钟后成片生成，点击播放')
    await t.click('video', { after: 2500 })
    await t.say('右侧可切换历史版本，底部下载视频')
    await t.click('button[class*="vstageVer"] >> nth=0', { after: 700 })
    await t.moveTo('button:has-text("下载视频")'); await t.wait(900)
    await t.say('', 200)
  },
}
