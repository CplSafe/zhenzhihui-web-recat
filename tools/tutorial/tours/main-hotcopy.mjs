/** 爆款复刻 · 主流程一条（目标 30–40 秒）：上传爆款视频 → 上传替换素材 → 选模型 → 去制作 → 看成片 */
const FINISHED = process.env.TUTORIAL_HOTCOPY_PROJECT || '1200'
const HIDE = `[class*="vstageDebugBtn"],.hc-ball,.notify__bell{display:none!important}`

export default {
  single: true,
  name: '爆款复刻主流程',
  async run(t) {
    const { page, BASE } = t
    const clean = () => page.addStyleTag({ content: HIDE }).catch(() => {})
    await page.goto(`${BASE}/hot-copy`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('button.hotcopy__tile', { timeout: 15000 })
    await page.locator('button.hotcopy__newVideoBtn').click().catch(() => {})
    await page.waitForTimeout(600)
    await clean(); await t.wait(300)

    await t.clip('爆款复刻')
    await t.say('点击「上传爆款视频」')
    await t.click('button.hotcopy__tile:has-text("上传爆款视频")', { after: 400 })
    await t.say('可以本地上传，也可以从素材库选')
    await t.click('button:has-text("素材库")', { after: 900 })
    const folder = page.locator('div.mlp-folder-card:has-text("生成视频成片方案")').first()
    await t.moveTo(folder); await page.mouse.dblclick((await folder.boundingBox()).x + 200, (await folder.boundingBox()).y + 50)
    await t.wait(1200)
    // 选第一个视频素材
    const item = page.locator('.mlp-asset-card, .mlp-item, [class*="mlp-asset"], [class*="asset-card"]').first()
    if (await item.count()) { await t.say('选一条爆款视频'); await t.click(item, { after: 500 }) }
    const ok = page.locator('button:has-text("确认"), button:has-text("确定"), button:has-text("使用")').last()
    if (await ok.count()) await t.click(ok, { after: 800 })
    else await page.locator('button.mlp-close-btn').click().catch(() => {})
    await t.wait(400)

    await t.say('再点「上传替换素材」，放上你的产品图')
    await t.moveTo('button.hotcopy__tile:has-text("上传替换素材")'); await t.wait(900)
    await t.say('选模型和参数，点击「去制作」')
    await t.moveTo('button:has-text("选择模型"), button[class*="_trigger"] >> nth=0'); await t.wait(500)
    await t.moveTo('button:has-text("去制作")'); await t.wait(800)
    await t.cut()

    await page.goto(`${BASE}/hot-copy/${FINISHED}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('button.hotcopy__send--resume', { timeout: 20000 })
    await page.locator('button.hotcopy__send--resume').click()
    await page.waitForSelector('video', { timeout: 20000 })
    await clean(); await t.wait(400)

    await t.clip('爆款复刻')
    await t.say('几分钟后出片：结构跟原片一致，主角换成了你的产品')
    await t.click('video', { after: 3500 })
    await t.say('底部可下载，或重新生成')
    await t.moveTo('button:has-text("下载视频")'); await t.wait(900)
    await t.say('', 200)
  },
}
