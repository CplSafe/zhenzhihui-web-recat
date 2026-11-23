import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  expectNoUnexpectedApi,
  installStrictAuthenticatedApp,
  TEAM_WORKSPACE_NAME,
  WORKSPACE_ID,
} from './fixtures/strict-authenticated-app'

const canvasId = 701
const owner = {
  id: canvasId,
  title: '我的画布',
  user_id: 7,
  image_model_version_ids: [41],
  video_model_version_ids: [51],
}
const anotherCanvas = { id: 702, title: '同事的画布', user_id: 8 }

async function openSettings(page: Page, title = owner.title) {
  await page.getByRole('button', { name: `画布操作 ${title}` }).click()
  await page.getByRole('button', { name: '设置画布', exact: true }).click()
  return page.getByRole('dialog', { name: '设置画布' })
}

async function toggleOption(page: Page, dialog: Locator, field: string, option: string) {
  await dialog.getByRole('combobox', { name: field, exact: true }).click()
  const dropdown = page.locator('.ant-select-dropdown:visible')
  await dropdown.getByText(option, { exact: true }).click()
  await dropdown.getByRole('button', { name: '完成' }).click()
  await expect(dropdown).toHaveCount(0)
}

async function mockTeamMembers(page: Page) {
  await page.route(`**/api/v1/workspaces/${WORKSPACE_ID}/members`, (route) =>
    route.fulfill({
      json: {
        data: [
          { user_id: 7, nickname: 'E2E 用户', role: 'owner', status: 'enabled' },
          { user_id: 8, nickname: '原成员', role: 'member', status: 'enabled' },
          { user_id: 9, nickname: '新成员', role: 'member', status: 'enabled' },
        ],
      },
    }),
  )
}

test('创建者可统一编辑画布名称、模型和创作成员，成员保存失败后只重试未保存部分', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 840 })
  const api = await installStrictAuthenticatedApp(page)
  let canvas = { ...owner }
  let memberIds = [7, 8]
  const metadataWrites: unknown[] = []
  const memberWrites: unknown[] = []
  await page.route('**/api/v1/canvases?**', (route) => route.fulfill({ json: { items: [canvas, anotherCanvas] } }))
  await page.route(`**/api/v1/canvases/${canvasId}?**`, async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON()
      metadataWrites.push(body)
      canvas = { ...canvas, title: body.title, ...body.models }
    }
    await route.fulfill({ json: { data: canvas } })
  })
  await page.route(`**/api/v1/canvases/${canvasId}/members?**`, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      memberWrites.push(body)
      if (memberWrites.length === 1) {
        await route.fulfill({ status: 503, json: { message: '成员写入暂不可用' } })
        return
      }
      memberIds = memberIds.filter((id) => !body.remove_user_ids.includes(id)).concat(body.member_user_ids)
    }
    await route.fulfill({
      json: {
        data: { creator_id: 7, can_manage: true, members_restricted: true, member_user_ids: memberIds },
      },
    })
  })
  await mockTeamMembers(page)
  await page.route('**/api/v1/ai/models?**', (route) => {
    const operation = new URL(route.request().url()).searchParams.get('operation_code')
    const models =
      operation === 'image.text_to_image'
        ? [
            { id: 41, display_name: '原图像模型', operation_codes: [operation] },
            { id: 42, display_name: '新图像模型', operation_codes: [operation] },
          ]
        : operation === 'video.generate'
          ? [
              { id: 51, display_name: '原视频模型', operation_codes: [operation] },
              { id: 52, display_name: '新视频模型', operation_codes: [operation] },
            ]
          : []
    return route.fulfill({ json: { data: models } })
  })
  await page.goto('/canvas')
  const dialog = await openSettings(page)
  await expect(dialog.getByRole('textbox', { name: '画布名称' })).toHaveValue('我的画布')
  await expect(dialog.getByText('原图像模型', { exact: true })).toBeVisible()
  await expect(dialog.getByText('原视频模型', { exact: true })).toBeVisible()
  await expect(dialog.getByText('原成员', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '保存' })).toBeDisabled()
  await dialog.getByRole('textbox', { name: '画布名称' }).fill('   ')
  await expect(dialog.getByRole('button', { name: '保存' })).toBeDisabled()
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).toBeHidden()
  expect(metadataWrites).toEqual([])
  expect(memberWrites).toEqual([])

  await openSettings(page)
  await expect(dialog.getByRole('textbox', { name: '画布名称' })).toHaveValue('我的画布')
  await dialog.getByRole('textbox', { name: '画布名称' }).fill('统一设置后的画布')
  await toggleOption(page, dialog, '生图模型', '新图像模型')
  await toggleOption(page, dialog, '生视频模型', '新视频模型')
  await toggleOption(page, dialog, '选择创作成员', '原成员')
  await toggleOption(page, dialog, '选择创作成员', '新成员')
  const bounds = await dialog.boundingBox()
  expect(bounds?.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('canvas-settings-narrow.png') })

  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog.getByRole('alert')).toContainText('画布信息已保存。创作成员尚未保存。')
  await expect(page.getByRole('button', { name: '打开画布 统一设置后的画布' })).toBeVisible()
  await expect(dialog.getByText('新成员', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('canvas-settings-partial-save.png') })
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(dialog).toBeHidden()
  expect(metadataWrites).toEqual([
    {
      title: '统一设置后的画布',
      models: { image_model_version_ids: [41, 42], video_model_version_ids: [51, 52] },
      expected_models: { image_model_version_ids: [41], video_model_version_ids: [51] },
    },
  ])
  expect(memberWrites).toEqual(Array(2).fill({ member_user_ids: [9], remove_user_ids: [8] }))
  expect(memberIds).toEqual([7, 9])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.reload()
  await openSettings(page, '统一设置后的画布')
  await expect(dialog.getByRole('textbox', { name: '画布名称' })).toHaveValue('统一设置后的画布')
  await expect(dialog.getByText('新图像模型', { exact: true })).toBeVisible()
  await expect(dialog.getByText('新视频模型', { exact: true })).toBeVisible()
  await expect(dialog.getByText('新成员', { exact: true })).toBeVisible()
  await expect(dialog.getByText('原成员', { exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '保存' })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('canvas-settings-saved-desktop.png') })
  expectNoUnexpectedApi(api)
})

test('团队全体可创作的画布可缩小至指定成员，创建者始终保留', async ({ page }, testInfo) => {
  const api = await installStrictAuthenticatedApp(page)
  const canvas = { ...owner, image_model_version_ids: [], video_model_version_ids: [] }
  const memberWrites: unknown[] = []
  const access = { creator_id: 7, can_manage: true, members_restricted: false, member_user_ids: [7, 8, 9] }

  await page.route('**/api/v1/canvases?**', (route) => route.fulfill({ json: { items: [canvas] } }))
  await page.route(`**/api/v1/canvases/${canvasId}?**`, async (route) => {
    expect(route.request().method()).toBe('GET')
    await route.fulfill({ json: { data: canvas } })
  })
  await page.route(`**/api/v1/canvases/${canvasId}/members?**`, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      memberWrites.push(body)
      access.members_restricted = true
      access.member_user_ids = access.member_user_ids.filter((id) => !body.remove_user_ids.includes(id))
    }
    await route.fulfill({ json: { data: access } })
  })
  await mockTeamMembers(page)
  await page.goto('/canvas')
  const dialog = await openSettings(page)
  const allMembers = dialog.getByRole('radio', { name: '团队全体成员' })
  const selectedMembers = dialog.getByRole('radio', { name: '指定成员' })
  const memberPicker = dialog.getByRole('combobox', { name: '选择创作成员' })
  const save = dialog.getByRole('button', { name: '保存' })

  await expect(allMembers).toBeChecked()
  await expect(memberPicker).toHaveCount(0)
  await dialog.getByText('指定成员', { exact: true }).click()
  await expect(dialog.getByText('原成员', { exact: true })).toBeVisible()
  await expect(dialog.getByText('新成员', { exact: true })).toBeVisible()
  await expect(save).toBeDisabled()

  await dialog.getByText('团队全体成员', { exact: true }).click()
  await expect(memberPicker).toHaveCount(0)
  await expect(save).toBeDisabled()

  await dialog.getByText('指定成员', { exact: true }).click()
  await toggleOption(page, dialog, '选择创作成员', '原成员')
  await save.click()
  await expect(dialog).toBeHidden()
  expect(memberWrites).toEqual([{ member_user_ids: [], remove_user_ids: [8] }])
  expect(access.member_user_ids).toEqual([7, 9])

  await openSettings(page)
  await expect(selectedMembers).toBeChecked()
  await expect(allMembers).toBeDisabled()
  await expect(dialog.getByText('新成员', { exact: true })).toBeVisible()
  await expect(dialog.getByText('原成员', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('canvas-settings-specified-members.png') })
  expectNoUnexpectedApi(api)
})

for (const role of ['团队所有者', '普通成员']) {
  test(`${role}只能在自己创建的画布菜单中看到设置画布`, async ({ page }, testInfo) => {
    const api = await installStrictAuthenticatedApp(page)
    if (role === '普通成员') {
      const workspace = { id: WORKSPACE_ID, name: TEAM_WORKSPACE_NAME, type: 'team', owner_user_id: 8 }
      await page.route('**/api/v1/auth/session', (route) =>
        route.fulfill({ json: { code: 0, data: { workspace, workspaces: [workspace], expires_in: 3600 } } }),
      )
      await page.route(`**/api/v1/workspaces/${WORKSPACE_ID}/members`, (route) =>
        route.fulfill({ json: { data: [{ user_id: 7, workspace_id: WORKSPACE_ID, role: 'member' }] } }),
      )
    }
    await page.route('**/api/v1/canvases?**', (route) => route.fulfill({ json: { items: [anotherCanvas, owner] } }))
    await page.goto('/canvas')
    await page.getByRole('button', { name: '画布操作 同事的画布' }).click()
    await expect(page.getByRole('button', { name: '创建副本' })).toBeVisible()
    await expect(page.getByRole('button', { name: '设置画布', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '画布操作 我的画布' }).click()
    await expect(page.getByRole('button', { name: '设置画布', exact: true })).toBeVisible()

    await page.goto('/canvas?manage=1')
    const othersMenu = page
      .getByRole('button', { name: '打开画布 同事的画布' })
      .getByRole('button', { name: '更多操作' })
    await othersMenu.click()
    await expect(page.getByRole('button', { name: '创建副本' })).toBeVisible()
    await expect(page.getByRole('button', { name: '设置画布', exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('canvas-settings-absent-for-non-creator.png') })
    await page.getByRole('button', { name: '打开画布 我的画布' }).getByRole('button', { name: '更多操作' }).click()
    await expect(page.getByRole('button', { name: '设置画布', exact: true })).toBeVisible()
    expectNoUnexpectedApi(api)
  })
}

test('画布成员接口复核当前用户不是创建者时，即使可管理也不会显示表单或保存', async ({ page }) => {
  const api = await installStrictAuthenticatedApp(page)
  await page.route('**/api/v1/canvases?**', (route) => route.fulfill({ json: { items: [owner] } }))
  await page.route(`**/api/v1/canvases/${canvasId}?**`, async (route) => {
    expect(route.request().method()).toBe('GET')
    await route.fulfill({ json: { data: { ...owner, user_id: 8 } } })
  })
  await page.route(`**/api/v1/canvases/${canvasId}/members?**`, async (route) => {
    expect(route.request().method()).toBe('GET')
    await route.fulfill({
      json: { data: { creator_id: 8, can_manage: true, members_restricted: false, member_user_ids: [] } },
    })
  })
  await page.goto('/canvas')
  const dialog = await openSettings(page)
  await expect(dialog.getByRole('alert')).toContainText('仅画布创建者可修改画布设置')
  await expect(dialog.getByRole('textbox', { name: '画布名称' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '保存' })).toBeDisabled()
  expectNoUnexpectedApi(api)
})
