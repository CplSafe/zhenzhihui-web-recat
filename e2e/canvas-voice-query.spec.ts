import { expect, test } from '@playwright/test'
import { expectNoUnexpectedApi } from './fixtures/strict-authenticated-app'

import { setupVoiceLibrary as setup } from './fixtures/canvas-voice-library'

for (const width of [1440, 768]) {
  test(`我的音色添加入口、表单取消及提交训练 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const { modal, createRequests, errors, consoleErrors, state } = await setup(page)
    await expect(modal.getByRole('button', { name: '添加音色', exact: true })).toHaveCount(0)
    await modal.getByRole('button', { name: '我的音色', exact: true }).click()
    await expect(modal.getByRole('button', { name: '添加音色', exact: true })).toBeEnabled()
    await page.evaluate(() =>
      localStorage.setItem(
        'zzh:voice-samples:7:21',
        JSON.stringify([{ assetId: 55, title: '测试录音', lastUsedAt: Date.now() }]),
      ),
    )
    // 使用有效的模拟 WAV，避免预览样本请求访问真实后端。
    const wav = Buffer.alloc(576044)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(576036, 4)
    wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(24000, 24)
    wav.writeUInt32LE(48000, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(576000, 40)
    await page.route('**/api/v1/assets/55/download?**', (route) =>
      route.fulfill({ contentType: 'audio/wav', body: wav }),
    )
    await modal.getByRole('button', { name: '添加音色', exact: true }).click()
    await expect(modal.getByLabel('复刻供应商')).toHaveValue('minimax')
    await expect(modal.getByLabel('复刻供应商').locator('option')).toHaveText(['MiniMax'])
    await expect(modal.getByText('创建专属音色', { exact: true })).toBeVisible()
    await expect(modal.getByRole('button', { name: '提交复刻' })).toBeDisabled()
    await modal.getByRole('button', { name: '取消', exact: true }).click()
    await expect(modal.getByRole('button', { name: '我的音色', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await modal.getByRole('textbox', { name: '搜索音色' }).fill('旧筛选')
    await modal.getByRole('button', { name: '添加音色', exact: true }).click()
    await expect(modal.getByLabel('复刻供应商')).toHaveValue('minimax')
    await expect(modal.getByLabel('复刻供应商').locator('option')).toHaveText(['MiniMax'])
    await modal.getByLabel('音色名称', { exact: true }).fill('新建专属旁白')
    await modal.getByLabel('选择本机声音样本').selectOption('55')
    await expect(modal.getByRole('button', { name: '提交复刻' })).toBeDisabled()
    await modal.getByRole('checkbox', { name: '我确认声音属于本人或已获得音色复刻授权' }).check()
    const screenshot = testInfo.outputPath(`voice-create-${width}.png`)
    await modal.screenshot({ path: screenshot, animations: 'disabled' })
    await testInfo.attach(`添加音色表单 ${width}px`, { path: screenshot, contentType: 'image/png' })
    const bounds = await modal.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    await modal.getByRole('button', { name: '提交复刻' }).click()
    await expect(modal.getByText(/音色创建请求已提交/)).toBeVisible()
    await expect(modal.getByRole('textbox', { name: '搜索音色' })).toHaveValue('')
    await expect(modal.getByRole('checkbox', { name: '只看当前模型兼容音色' })).not.toBeChecked()
    await expect(modal.getByText('新建专属旁白', { exact: true })).toBeVisible()
    await expect(modal.getByText('训练中', { exact: true })).toBeVisible()
    expect(createRequests).toHaveLength(1)
    expect(errors).toEqual([])
    expect(consoleErrors).toEqual([])
    expect(state.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(state)
  })
}

for (const width of [1440, 768, 390]) {
  test(`我的音色布局、连续筛选、详情焦点与选用 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const { modal, errors, consoleErrors, state } = await setup(page)
    await modal.getByRole('button', { name: '我的音色', exact: true }).click()
    const card = modal.locator('article')
    await expect(card).toHaveCount(1)
    const search = modal.getByRole('textbox', { name: '搜索音色' })
    const provider = modal.getByRole('combobox', { name: '音色供应商' })
    await expect(provider).toBeEnabled()
    await search.fill('我的')
    await expect(provider).toBeEnabled()
    await search.fill('我的旁白')
    await expect(card).toHaveCount(1)
    await expect(modal.getByText('共 1 个音色 · 第 1 页')).toBeVisible()
    const searchBounds = (await search.boundingBox())!
    // 对齐检查使用整个 Select；combobox 是内部搜索框，自带垂直内边距。
    const providerBounds = (await modal.locator('.ant-select[aria-label="音色供应商"]').boundingBox())!
    if (width <= 600) expect(providerBounds.y).toBeGreaterThanOrEqual(searchBounds.y + searchBounds.height - 1)
    else expect(Math.abs(providerBounds.y - searchBounds.y)).toBeLessThan(2)
    expect(Math.abs(providerBounds.height - searchBounds.height)).toBeLessThan(2)
    const gridBounds = (await card.locator('..').boundingBox())!
    const cardBounds = (await card.boundingBox())!
    expect(Math.abs(gridBounds.width - cardBounds.width)).toBeLessThan(2)
    expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    const add = modal.getByRole('button', { name: '添加音色', exact: true })
    const addBounds = (await add.boundingBox())!
    expect(addBounds.y + addBounds.height).toBeLessThanOrEqual(searchBounds.y)
    await expect(card.getByRole('button', { name: '选用', exact: true })).toBeInViewport()
    await modal.screenshot({ path: testInfo.outputPath(`my-voices-${width}.png`), animations: 'disabled' })
    await testInfo.attach(`我的音色布局 ${width}px`, {
      path: testInfo.outputPath(`my-voices-${width}.png`),
      contentType: 'image/png',
    })
    await expect(modal.getByRole('combobox', { name: '音色语种' })).toHaveCount(0)
    await modal.getByRole('button', { name: '更多筛选', exact: true }).click()
    await expect(modal.getByRole('combobox', { name: '音色语种' })).toBeEnabled()
    await modal.getByRole('button', { name: '收起筛选', exact: true }).click()
    await expect(modal.getByRole('combobox', { name: '音色语种' })).toHaveCount(0)
    const details = card.getByRole('button', { name: '详情', exact: true })
    await details.click()
    const detail = modal.getByLabel('音色详情')
    await expect(detail).toBeFocused()
    await expect(detail).toContainText('我的旁白')
    await detail.getByRole('button', { name: '收起详情' }).click()
    await expect(details).toBeFocused()
    await expect(detail).toHaveCount(0)
    await card.getByRole('button', { name: '选用', exact: true }).click()
    await expect(modal).toBeHidden()
    await expect(page.locator('.react-flow__node[data-id="audio"]')).toHaveClass(/selected/)
    expect(errors).toEqual([])
    expect(consoleErrors).toEqual([])
    expect(state.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(state)
  })
}

for (const width of [1440, 768]) {
  test(`音色库筛选搜索分页和关闭恢复 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const { modal, requests, errors, consoleErrors, state } = await setup(page)
    const cards = modal.locator('article')
    await expect(cards).toHaveCount(20)
    await expect(modal.getByText('共 45 个音色 · 第 1 页')).toBeVisible()
    await modal.getByRole('button', { name: '下一页' }).click()
    await expect(cards.first().getByText('公共旁白 21', { exact: true })).toBeVisible()
    await modal.getByRole('button', { name: '下一页' }).click()
    await expect(cards).toHaveCount(5)
    await expect(modal.getByRole('button', { name: '下一页' })).toBeDisabled()
    await modal.getByRole('textbox', { name: '搜索音色' }).fill('公共旁白 01')
    await expect(cards).toHaveCount(1)
    await expect(modal.getByText('共 1 个音色 · 第 1 页')).toBeVisible()
    await modal.getByRole('textbox', { name: '搜索音色' }).fill('不存在的旁白')
    await expect(modal.getByText('暂无符合条件的音色。')).toBeVisible()
    await modal.getByRole('button', { name: '清除筛选' }).click()
    await expect(cards).toHaveCount(20)
    const language = modal.getByRole('combobox', { name: '音色语种' })
    await expect(language).toBeEnabled()
    await language.click()
    const dropdown = page.locator('.ant-select-dropdown:visible')
    await expect(dropdown).toBeVisible()
    const modalLayer = await modal.evaluate((element) =>
      Number(getComputedStyle(element.closest('.ant-modal-wrap')!).zIndex),
    )
    const dropdownLayer = await dropdown.evaluate((element) => Number(getComputedStyle(element).zIndex))
    expect(modalLayer).toBe(2200)
    expect(dropdownLayer).toBeGreaterThan(modalLayer)
    await dropdown.screenshot({ path: testInfo.outputPath(`voice-dropdown-${width}.png`), animations: 'disabled' })
    await testInfo.attach(`音色筛选下拉 ${width}px`, {
      path: testInfo.outputPath(`voice-dropdown-${width}.png`),
      contentType: 'image/png',
    })
    await page.getByTitle('英语（en）', { exact: true }).click()
    await expect(modal.getByText('共 22 个音色 · 第 1 页')).toBeVisible()
    await modal.getByRole('button', { name: '更多筛选', exact: true }).click()
    const features = modal.getByRole('combobox', { name: '音色声音特征' })
    await expect(features).toBeEnabled()
    await features.click()
    await page.getByTitle('清亮', { exact: true }).click()
    await expect
      .poll(() =>
        requests.some(
          (url) =>
            url.pathname.endsWith('/voices') &&
            url.searchParams.get('language') === 'en' &&
            url.searchParams.getAll('voice_feature').includes('清亮'),
        ),
      )
      .toBe(true)
    await page.keyboard.press('Escape')
    await expect(modal).toBeVisible()
    const bounds = await modal.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath(`voice-query-${width}.png`) })
    await testInfo.attach(`音色库筛选结果 ${width}px`, {
      path: testInfo.outputPath(`voice-query-${width}.png`),
      contentType: 'image/png',
    })
    await modal.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(modal).toBeHidden()
    await expect(page.locator('.react-flow__node[data-id="audio"]')).toHaveClass(/selected/)
    expect(errors).toEqual([])
    expect(consoleErrors).toEqual([])
    expect(state.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(state)
  })
}

test('筛选选项失败可独立重试，列表查询保留可用', async ({ page }) => {
  const { modal, requests, errors, consoleErrors, state } = await setup(page, true)
  await expect(modal.getByRole('alert')).toContainText('筛选选项加载失败')
  await expect(modal.locator('article')).toHaveCount(20)
  await modal.getByRole('button', { name: '重试筛选' }).click()
  await expect(modal.getByRole('combobox', { name: '音色语种' })).toBeEnabled()
  await expect(modal.getByRole('alert')).toHaveCount(0)
  expect(requests.filter((url) => url.pathname.endsWith('/voices'))).toHaveLength(1)
  expect(errors).toEqual([])
  // 此场景故意返回一次 503；其他控制台错误仍然导致失败。
  expect(consoleErrors.every((message) => message.includes('503'))).toBe(true)
  expect(state.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(state)
})

test('我的音色与收藏使用真实查询契约，添加取消收藏后可刷新列表', async ({ page }, testInfo) => {
  const { modal, requests, errors, consoleErrors, state } = await setup(page)
  await expect(modal.locator('article')).toHaveCount(20)
  await modal.getByRole('button', { name: '下一页' }).click()
  await expect(modal.getByText(/第 2 页/)).toBeVisible()
  await modal.getByRole('button', { name: '我的音色', exact: true }).click()
  await expect(modal.locator('article')).toHaveCount(1)
  await expect(modal.getByText('我的旁白', { exact: true })).toBeVisible()
  await expect(modal.getByText('共 1 个音色 · 第 1 页')).toBeVisible()
  expect(
    requests.some(
      (url) =>
        url.pathname.endsWith('/voices') &&
        url.searchParams.get('source') === 'cloned' &&
        url.searchParams.get('offset') === '0',
    ),
  ).toBe(true)
  for (const name of ['创建音色', '编辑', '删除', '同步', '重试训练']) {
    await expect(modal.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  await modal.getByRole('button', { name: '收藏 我的旁白', exact: true }).click()
  await expect(modal.getByRole('button', { name: '取消收藏 我的旁白' })).toBeVisible()
  await modal.getByRole('group', { name: '音色分类' }).getByRole('button', { name: '收藏', exact: true }).click()
  await expect(modal.locator('article')).toHaveCount(1)
  expect(
    requests.some(
      (url) =>
        url.pathname.endsWith('/voices') &&
        url.searchParams.get('favorites') === 'true' &&
        !url.searchParams.has('source'),
    ),
  ).toBe(true)
  await modal.getByRole('textbox', { name: '搜索音色' }).fill('我的旁白')
  await expect
    .poll(() =>
      requests.some(
        (url) =>
          url.pathname.endsWith('/voices') &&
          url.searchParams.get('q') === '我的旁白' &&
          url.searchParams.get('favorites') === 'true',
      ),
    )
    .toBe(true)
  await expect(modal.locator('article')).toHaveCount(1)
  const screenshot = testInfo.outputPath('voice-favorites.png')
  await modal.screenshot({ path: screenshot, animations: 'disabled' })
  await testInfo.attach('我的音色收藏结果', { path: screenshot, contentType: 'image/png' })
  await modal.getByRole('button', { name: '清除筛选' }).click()
  await expect(modal.locator('article')).toHaveCount(1)
  await modal.getByRole('button', { name: '取消收藏 我的旁白' }).click()
  await expect(modal.getByText(/暂无符合条件的收藏/)).toBeVisible()
  expect(errors).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(state.paidTaskSubmissions).toBe(0)
  expectNoUnexpectedApi(state)
})

for (const width of [1440, 768]) {
  test(`音色创建拒绝显示诊断并保留表单 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const { modal, createRequests, errors, consoleErrors, state } = await setup(page)
    await modal.getByRole('button', { name: '我的音色', exact: true }).click()
    await page.evaluate(() =>
      localStorage.setItem(
        'zzh:voice-samples:7:21',
        JSON.stringify([{ assetId: 55, title: '测试录音', lastUsedAt: Date.now() }]),
      ),
    )
    // 使用有效的模拟 WAV，避免预览样本请求访问真实后端。
    const wav = Buffer.alloc(576044)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(576036, 4)
    wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(24000, 24)
    wav.writeUInt32LE(48000, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(576000, 40)
    await page.route('**/api/v1/assets/55/download?**', (route) =>
      route.fulfill({ contentType: 'audio/wav', body: wav }),
    )
    await modal.getByRole('button', { name: '添加音色', exact: true }).click()
    await expect(modal.getByLabel('复刻供应商')).toHaveValue('minimax')
    await expect(modal.getByLabel('复刻供应商').locator('option')).toHaveText(['MiniMax'])
    await modal.getByLabel('音色名称', { exact: true }).fill('待排查音色')
    await modal.getByLabel('选择本机声音样本').selectOption('55')
    await modal.getByRole('checkbox', { name: '我确认声音属于本人或已获得音色复刻授权' }).check()
    const submitted: Record<string, unknown>[] = []
    await page.route('**/api/v1/voices?*', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      submitted.push(route.request().postDataJSON())
      expect(submitted.at(-1)).not.toHaveProperty('language')
      expect(submitted.at(-1)).not.toHaveProperty('gender')
      expect(submitted.at(-1)).not.toHaveProperty('description')
      return route.fulfill({
        status: 400,
        headers: { 'x-request-id': 'voice-check-123' },
        json: {
          code: 400,
          code_string: 'INVALID_VOICE_INPUT',
          message: '音色参数或录音素材无效',
        },
      })
    })
    await modal.getByRole('button', { name: '提交复刻' }).click()
    await expect(modal.getByRole('alert')).toContainText('音色创建失败：音色参数或录音素材无效')
    await expect(modal.getByRole('alert')).toContainText(
      'HTTP 400；错误码 INVALID_VOICE_INPUT；请求编号 voice-check-123',
    )
    await expect(modal.getByLabel('音色名称', { exact: true })).toHaveValue('待排查音色')
    await expect(modal.getByLabel('选择本机声音样本')).toHaveValue('55')
    await expect(modal.getByRole('checkbox', { name: '我确认声音属于本人或已获得音色复刻授权' })).toBeChecked()
    await modal.screenshot({ path: testInfo.outputPath(`voice-rejected-${width}.png`) })
    await page.unroute('**/api/v1/voices?*')
    await modal.getByRole('button', { name: '提交复刻' }).click()
    await expect(modal.getByText(/音色创建请求已提交/)).toBeVisible()
    expect(createRequests).toHaveLength(1)
    expect(createRequests[0].idempotency_key).toBe(submitted[0].idempotency_key)
    expect(errors).toEqual([])
    expect(consoleErrors.every((message) => message.includes('400'))).toBe(true)
    expect(state.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(state)
  })
}

for (const width of [1440, 768]) {
  test(`MiniMax阻止5秒录音并以正确供应商提交合规样本 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const { modal, createRequests, errors, consoleErrors, state } = await setup(page)
    await page.evaluate(() =>
      localStorage.setItem(
        'zzh:voice-samples:7:21',
        JSON.stringify([{ assetId: 55, title: '复刻样本', lastUsedAt: Date.now() }]),
      ),
    )
    let seconds = 5
    await page.route('**/api/v1/assets/55/download?**', (route) => {
      const bytes = 24000 * 2 * seconds
      const wav = Buffer.alloc(44 + bytes)
      wav.write('RIFF', 0)
      wav.writeUInt32LE(36 + bytes, 4)
      wav.write('WAVEfmt ', 8)
      wav.writeUInt32LE(16, 16)
      wav.writeUInt16LE(1, 20)
      wav.writeUInt16LE(1, 22)
      wav.writeUInt32LE(24000, 24)
      wav.writeUInt32LE(48000, 28)
      wav.writeUInt16LE(2, 32)
      wav.writeUInt16LE(16, 34)
      wav.write('data', 36)
      wav.writeUInt32LE(bytes, 40)
      return route.fulfill({ contentType: 'audio/wav', body: wav })
    })
    await modal.getByRole('button', { name: '我的音色', exact: true }).click()
    await modal.getByRole('button', { name: '添加音色', exact: true }).click()
    await expect(modal.getByLabel('复刻供应商')).toHaveValue('minimax')
    await expect(modal.getByLabel('复刻供应商').locator('option')).toHaveText(['MiniMax'])
    await modal.getByText('供应商计费与激活说明', { exact: true }).click()
    await expect(modal.getByText(/首次合成会产生音色费用/)).toBeVisible()
    await modal.getByLabel('音色名称', { exact: true }).fill('你好')
    await modal.getByLabel('选择本机声音样本').selectOption('55')
    await expect(modal.getByRole('alert')).toContainText('当前为 5.0 秒')
    await modal.getByRole('checkbox', { name: '我确认声音属于本人或已获得音色复刻授权' }).check()
    await expect(modal.getByRole('button', { name: '提交复刻' })).toBeDisabled()
    expect(createRequests).toHaveLength(0)
    await modal.getByRole('alert').scrollIntoViewIfNeeded()
    await modal.screenshot({ path: testInfo.outputPath(`minimax-short-${width}.png`) })
    seconds = 12
    await modal.getByLabel('选择本机声音样本').selectOption('0')
    await expect(modal.getByLabel('试听训练录音')).toHaveCount(0)
    await modal.getByLabel('选择本机声音样本').selectOption('55')
    await expect(modal.getByRole('alert')).toHaveCount(0)
    await modal.getByRole('checkbox', { name: '我确认声音属于本人或已获得音色复刻授权' }).check()
    await expect(modal.getByRole('button', { name: '提交复刻' })).toBeEnabled()
    await modal.getByRole('button', { name: '提交复刻' }).click()
    await expect(modal.getByText('你好', { exact: true })).toBeVisible()
    await expect(modal.getByText('训练中', { exact: true })).toBeVisible()
    expect(createRequests).toHaveLength(1)
    expect(createRequests[0]).toMatchObject({
      provider: 'minimax',
      name: '你好',
      sample_asset_id: 55,
      workspace_id: 21,
    })
    expect(errors).toEqual([])
    expect(consoleErrors).toEqual([])
    expect(state.paidTaskSubmissions).toBe(0)
    expectNoUnexpectedApi(state)
  })
}
