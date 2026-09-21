/**
 * 爆款成片教程短片（CineArt 操作手册风格）：一条只讲一个动作，目标 5–12 秒。
 * 结果页复用已出片的项目（FINISHED_PROJECT），不真正消耗生成积分。
 * 等待（脚本流式生成、AI 润色）都放在两条 clip 之间，不进成片。
 */
const FINISHED_PROJECT = process.env.TUTORIAL_FINISHED_PROJECT || '1188'
const HIDE = `[class*="vstageDebugBtn"],.hc-ball{display:none!important}`

export default {
  name: '爆款成片',
  async run(t) {
    const { page, BASE } = t
    const clean = () => page.addStyleTag({ content: HIDE }).catch(() => {})

    // 准备：直接到入口页，不录
    await page.goto(`${BASE}/smart`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('textarea', { timeout: 15000 })
    if (/\/smart\/\d+/.test(page.url())) {
      await page.locator('button.smart__newvideo').click().catch(() => {})
      await page.waitForSelector('textarea', { timeout: 15000 })
    }
    await clean(); await t.wait(500)

    // 1 入口
    await t.clip('进入爆款成片')
    await t.say('点击左侧「爆款成片」')
    await t.click('button.app-sidebar__item:has-text("爆款成片")', { after: 900 })

    // 2 脚本模型
    await t.clip('选择脚本模型')
    await t.say('点击「选择模型」')
    await t.click('button:has-text("选择模型")', { after: 500 })
    await t.zoom('button:has-text("请选择模型") >> nth=0', 1.5, 100)
    await t.say('先选脚本模型')
    await t.click('button:has-text("请选择模型") >> nth=0', { after: 450 })
    await t.click('button[class*="_option"]:has-text("GPT")', { after: 700 })

    // 3 视频模型
    await t.clip('选择视频模型')
    await t.say('再选视频模型')
    await t.click('button:has-text("请选择模型") >> nth=0', { after: 500 })
    await t.moveTo('button[class*="_option"]:has-text("Seedance 2.0") >> nth=0', { ms: 700 })
    await t.wait(500)
    await t.click('button[class*="_option"]:has-text("Seedance 2.0") >> nth=0', { after: 700 })
    await t.zoom(null, 1, 0)
    await page.keyboard.press('Escape'); await t.wait(300)

    // 4 参数
    await t.clip('设置比例时长和分辨率')
    await t.say('点击参数按钮')
    await t.click('button:has-text("选择时长"), button:has-text("720p"), button:has-text("16:9")', { after: 500 })
    await t.zoom('button:has-text("16:9") >> nth=0', 1.35, 100)
    await t.say('选比例、时长和分辨率')
    const dur = page.locator('button:has-text("10s"), button:has-text("10 秒"), button:has-text("10秒")').first()
    if (await dur.count()) await t.click(dur, { after: 500 })
    else await t.wait(900)
    await t.zoom(null, 1, 0)
    await page.keyboard.press('Escape'); await t.wait(300)

    // 5 输入需求
    await t.clip('输入需求')
    await t.say('写一句需求，例如「制作篮球广告」')
    await t.type('textarea', '制作篮球广告', { delay: 70, after: 500 })

    // 6 去制作
    await t.clip('去制作')
    await t.say('点击「去制作」')
    await t.click('button:has-text("去制作")', { after: 1200 })
    await page.waitForURL(/\/smart\/\d+/, { timeout: 30000 }).catch(() => {})
    await clean()
    await t.say('项目自动创建，脚本开始生成', 1500)
    await t.cut()

    // —— 等脚本生成完（不录进任何 clip）——
    await page.locator('text=分镜脚本生成完成').first().waitFor({ timeout: 150000 }).catch(() => {})
    await t.wait(500)

    // 7 编辑分镜
    await t.clip('编辑分镜表')
    await t.say('分镜表里的内容都能直接改')
    const cell = page.locator('span.ie-display').nth(1)
    await t.click(cell, { after: 900 })
    await page.keyboard.press('Escape'); await t.wait(300)

    // 8 生成视频
    await t.clip('生成视频')
    await t.say('点击「生成视频」')
    await t.click('button.smart__btn-split--main:has-text("生成视频")', { after: 600 })
    await t.zoom('button:has-text("确认并生成")', 1.4, 100)
    await t.say('确认积分后点「确认并生成」')
    await t.moveTo('button:has-text("确认并生成")'); await t.wait(900)
    await t.cut()
    await t.zoom(null, 1, 0)

    // —— 不真花积分：取消，切到已出片项目（不录）——
    await page.locator('button:has-text("取消")').first().click().catch(() => {})
    await page.goto(`${BASE}/smart/${FINISHED_PROJECT}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('button[class*="vstageVer"]', { timeout: 20000 })
    await clean(); await t.wait(500)

    // 9 查看成片
    await t.clip('查看成片')
    await t.say('出片后在这里播放')
    await t.click('video', { after: 1500 })
    await t.click('video', { after: 300 })

    // 10 历史版本
    await t.clip('切换历史版本')
    await t.zoom('button[class*="vstageVer"] >> nth=0', 1.4, 100)
    await t.say('点右侧缩略图切换历史版本')
    await t.click('button[class*="vstageVer"] >> nth=0', { after: 800 })
    await t.click('button[class*="vstageVer"] >> nth=-1', { after: 600 })
    await t.zoom(null, 1, 0)

    // 11 整段修改
    await t.clip('整段视频修改')
    const mod = page.locator('textarea[class*="vstageModInput"]')
    await t.zoom(mod, 1.3, 0)
    await t.say('在「整段视频修改」里写要求')
    await t.click(mod, { after: 150 })
    await page.keyboard.press('Control+A'); await page.keyboard.press('Delete')
    await page.keyboard.type('把篮球换成足球', { delay: 70 })
    await t.wait(400)
    await t.say('点「AI一键润色」')
    await t.click('button:has-text("AI一键润色")', { after: 300 })
    await t.cut()

    // —— 等润色完成（不录）——
    await page.locator('button:has-text("润色中")').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})
    await t.wait(400)

    // 12 确认修改
    await t.clip('确认修改')
    await t.say('润色完成，点「确认修改」重新生成')
    await t.wait(900)
    await t.zoom(null, 1, 0)
    await t.zoom('button:has-text("确认修改")', 1.4, 100)
    await t.moveTo('button:has-text("确认修改")'); await t.wait(900)
    await t.zoom(null, 1, 0)

    // 13 创建新视频
    await t.clip('创建新视频')
    await t.say('点右上「创建新视频」开始下一条')
    await t.click('button.smart__newvideo', { after: 1000 })
    await t.say('', 200)
  },
}
