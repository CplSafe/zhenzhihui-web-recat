import { expect, type Page, type Route } from '@playwright/test'

export const PERSONAL_WORKSPACE_ID = 1
export const WORKSPACE_ID = 21
export const SECOND_TEAM_WORKSPACE_ID = 22
export const PERSONAL_WORKSPACE_NAME = '个人空间'
export const TEAM_WORKSPACE_NAME = 'E2E 团队空间'
export const SECOND_TEAM_WORKSPACE_NAME = 'E2E 第二团队'
export const SMART_PROJECT_ID = 101
export const HOT_COPY_PROJECT_ID = 202
export const PROJECT_VIDEO_ID = 'e2e-video-1'

export type SeenRequest = {
  method: string
  path: string
  workspaceId: number
  projectId: number
}

export type ScopedRequestMatcher = {
  method?: string
  path: string
  workspaceId?: number
  projectId?: number
}

export type StrictApiState = {
  unexpected: string[]
  seen: SeenRequest[]
  paidTaskSubmissions: number
  draftWrites: number
}

// A real one-frame MP4 keeps Firefox from treating the fixture itself as a
// broken media endpoint and retrying it indefinitely. Source:
// https://gist.github.com/dmlap/5643609
const TINY_MP4 = Buffer.from(
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAr9tZGF0AAACoAYF//+c3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDEyNSAt' +
    'IEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMTIgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25z' +
    'OiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhl' +
    'ZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9t' +
    'YV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz02IGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0w' +
    'IGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2Vp' +
    'Z2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0yNCBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2Fo' +
    'ZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEu' +
    'MDAAgAAAAA9liIQAV/0TAAYdeBTXzg8AAALvbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAACoAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAA' +
    'AAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAhl0cmFrAAAAXHRraGQAAAAPAAAAAAAAAAAAAAABAAAAAAAAACoA' +
    'AAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAgAAAAIAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAAqAAAA' +
    'AAABAAAAAAGRbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAAgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIA' +
    'AAABPG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAPxzdGJsAAAAmHN0c2QAAAAAAAAAAQAA' +
    'AIhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAgACABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMmF2' +
    'Y0MBZAAK/+EAGWdkAAqs2V+WXAWyAAADAAIAAAMAYB4kSywBAAZo6+PLIsAAAAAYc3R0cwAAAAAAAAABAAAAAQAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAA' +
    'AAEAAAABAAAAFHN0c3oAAAAAAAACtwAAAAEAAAAUc3RjbwAAAAAAAAABAAAAMAAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBs' +
    'AAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNTQuNjMuMTA0',
  'base64',
)

async function fulfillTinyVideo(route: Route) {
  const rangeHeader = route.request().headers().range
  const match = rangeHeader?.match(/^bytes=(\d+)-(\d*)$/)
  if (!match) {
    await route.fulfill({
      status: 200,
      contentType: 'video/mp4',
      headers: {
        'accept-ranges': 'bytes',
        'content-length': String(TINY_MP4.length),
      },
      body: TINY_MP4,
    })
    return
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : TINY_MP4.length - 1
  if (!Number.isSafeInteger(start) || start < 0 || start >= TINY_MP4.length) {
    await route.fulfill({
      status: 416,
      headers: { 'content-range': `bytes */${TINY_MP4.length}` },
    })
    return
  }
  const end = Math.min(Math.max(start, requestedEnd), TINY_MP4.length - 1)
  const body = TINY_MP4.subarray(start, end + 1)
  await route.fulfill({
    status: 206,
    contentType: 'video/mp4',
    headers: {
      'accept-ranges': 'bytes',
      'content-length': String(body.length),
      'content-range': `bytes ${start}-${end}/${TINY_MP4.length}`,
    },
    body,
  })
}

const user = {
  id: 7,
  user_id: 7,
  nickname: 'E2E 用户',
  name: 'E2E 用户',
  mobile: '13800000000',
}

const teamWorkspace = {
  id: WORKSPACE_ID,
  name: TEAM_WORKSPACE_NAME,
  type: 'team',
  owner_user_id: user.id,
  status: 'active',
}

const personalWorkspace = {
  id: PERSONAL_WORKSPACE_ID,
  name: PERSONAL_WORKSPACE_NAME,
  type: 'personal',
  owner_user_id: user.id,
  status: 'active',
}

const secondTeamWorkspace = {
  id: SECOND_TEAM_WORKSPACE_ID,
  name: SECOND_TEAM_WORKSPACE_NAME,
  type: 'team',
  owner_user_id: user.id,
  status: 'active',
}

const workspaces = [personalWorkspace, teamWorkspace, secondTeamWorkspace]

const memberFor = (workspaceId: number) => ({
  user_id: user.id,
  workspace_id: workspaceId,
  role: 'owner',
  workspace_role: 'owner',
  nickname: user.nickname,
  mobile: user.mobile,
})

const projectVideo = {
  id: PROJECT_VIDEO_ID,
  projectId: SMART_PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  title: 'E2E 成片视频',
  coverUrl: '',
  videoUrl: `/api/v1/assets/601/download?workspace_id=${WORKSPACE_ID}`,
  videoAssetId: 601,
  ratio: '16:9',
  durationSeconds: 8,
  status: 'published',
  createdByName: user.nickname,
  createdByUserId: user.id,
  createdAt: '2026-07-20T08:00:00.000Z',
  updatedAt: '2026-07-20T08:05:00.000Z',
  sourceType: 'smart',
  flow: 'smart',
  manual: true,
}

const smartProject = {
  id: SMART_PROJECT_ID,
  project_id: SMART_PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  user_id: user.id,
  created_by_user_id: user.id,
  title: 'E2E 智能项目',
  name: 'E2E 智能项目',
  draft_revision: 4,
  created_at: '2026-07-20T08:00:00.000Z',
  updated_at: '2026-07-20T08:05:00.000Z',
  draft_json: {
    flow: 'smart',
    title: 'E2E 智能项目',
    currentStep: 'script',
    description: '刷新后应恢复的智能成片描述',
    projectVideoStore: { records: [projectVideo], overrides: {} },
    smart: {
      flow: 'smart',
      workspaceId: WORKSPACE_ID,
      projectId: SMART_PROJECT_ID,
      projectName: 'E2E 智能项目',
      requirement: '刷新后应恢复的智能成片描述',
      reqSummary: '稳定恢复测试',
      step: 0,
      entryMeta: { duration: '10s', ratio: '16:9', style: '写实', mode: 'video' },
      shots: [
        {
          id: 'shot-e2e-1',
          no: '镜头1',
          duration: '3s',
          desc: 'E2E 恢复分镜画面',
          line: '稳定恢复',
          subjects: [],
        },
      ],
      savedAt: Date.parse('2026-07-20T08:05:00.000Z'),
    },
  },
}

const hotCopyProject = {
  id: HOT_COPY_PROJECT_ID,
  project_id: HOT_COPY_PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  user_id: user.id,
  created_by_user_id: user.id,
  title: 'E2E 爆款项目',
  name: 'E2E 爆款项目',
  draft_revision: 6,
  created_at: '2026-07-20T09:00:00.000Z',
  updated_at: '2026-07-20T09:10:00.000Z',
  draft_json: {
    flow: 'hot-copy',
    title: 'E2E 爆款项目',
    currentStep: 'video',
    description: 'E2E 爆款恢复描述',
    generatedVideoUrl: `/api/v1/assets/602/download?workspace_id=${WORKSPACE_ID}`,
    generatedVideoAssetId: 602,
    videoHistoryList: [
      {
        url: `/api/v1/assets/602/download?workspace_id=${WORKSPACE_ID}`,
        assetId: 602,
        createdAt: '2026-07-20T09:10:00.000Z',
      },
    ],
    smart: {
      flow: 'hot-copy',
      started: true,
      step: 1,
      maxReached: 1,
      projectName: 'E2E 爆款项目',
      basePrompt: 'E2E 爆款恢复描述',
      entryInitial: {
        text: 'E2E 爆款恢复描述',
        videoSource: 'library',
        libraryVideo: {
          assetId: 501,
          name: 'E2E 源视频',
          url: `/api/v1/assets/501/download?workspace_id=${WORKSPACE_ID}`,
        },
        products: [
          {
            id: 'product-e2e-1',
            assetId: 502,
            name: 'E2E 替换商品',
            preview: `/api/v1/assets/502/download?workspace_id=${WORKSPACE_ID}`,
          },
        ],
        ratio: '16:9',
        durationSec: 10,
      },
      sourceVideo: {
        assetId: 501,
        url: `/api/v1/assets/501/download?workspace_id=${WORKSPACE_ID}`,
      },
      sourceVideoDurationSec: 8,
      sourceVideoDurationAssetId: 501,
      productAssetIds: [502],
      originalProductAssetIds: [502],
      fullVideoUrl: `/api/v1/assets/602/download?workspace_id=${WORKSPACE_ID}`,
      fullVideoAssetId: 602,
      videoVersions: [
        {
          url: `/api/v1/assets/602/download?workspace_id=${WORKSPACE_ID}`,
          assetId: 602,
          createdAt: '2026-07-20T09:10:00.000Z',
        },
      ],
      videoGenerating: false,
      vidGenTaskId: 0,
      videoGenerations: [],
      genRatio: '16:9',
      genDurationSec: 10,
    },
  },
}

const projects = [smartProject, hotCopyProject]

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function workspaceById(workspaceId: number) {
  return workspaces.find((workspace) => workspace.id === workspaceId) || teamWorkspace
}

function replaceWorkspaceScope(value: unknown, workspaceId: number): unknown {
  if (typeof value === 'string') return value.replace(/workspace_id=\d+/g, `workspace_id=${workspaceId}`)
  if (Array.isArray(value)) return value.map((item) => replaceWorkspaceScope(item, workspaceId))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceWorkspaceScope(item, workspaceId)]))
}

function projectsForWorkspace(workspaceId: number) {
  const scoped = replaceWorkspaceScope(clone(projects), workspaceId) as any[]
  for (const project of scoped) {
    project.workspace_id = workspaceId
    if (project.id === SMART_PROJECT_ID) {
      project.draft_json.smart.workspaceId = workspaceId
      const projectName =
        workspaceId === SECOND_TEAM_WORKSPACE_ID
          ? '团队 B 智能项目'
          : workspaceId === PERSONAL_WORKSPACE_ID
            ? '个人空间智能项目'
            : 'E2E 智能项目'
      const requirement =
        workspaceId === SECOND_TEAM_WORKSPACE_ID
          ? '团队 B 独立智能草稿'
          : workspaceId === PERSONAL_WORKSPACE_ID
            ? '个人空间独立智能草稿'
            : '刷新后应恢复的智能成片描述'
      project.title = projectName
      project.name = projectName
      project.draft_json.title = projectName
      project.draft_json.smart.projectName = projectName
      project.draft_json.description = requirement
      project.draft_json.smart.requirement = requirement
      project.draft_json.smart.shots[0].desc =
        workspaceId === SECOND_TEAM_WORKSPACE_ID
          ? '团队 B 独立分镜'
          : workspaceId === PERSONAL_WORKSPACE_ID
            ? '个人空间独立分镜'
            : 'E2E 恢复分镜画面'
      project.draft_json.projectVideoStore.records[0].workspaceId = workspaceId
    }
    if (project.id === HOT_COPY_PROJECT_ID) {
      const projectName =
        workspaceId === SECOND_TEAM_WORKSPACE_ID
          ? '团队 B 爆款项目'
          : workspaceId === PERSONAL_WORKSPACE_ID
            ? '个人空间爆款项目'
            : 'E2E 爆款项目'
      const description =
        workspaceId === SECOND_TEAM_WORKSPACE_ID
          ? '团队 B 独立爆款草稿'
          : workspaceId === PERSONAL_WORKSPACE_ID
            ? '个人空间独立爆款草稿'
            : 'E2E 爆款恢复描述'
      project.title = projectName
      project.name = projectName
      project.draft_json.title = projectName
      project.draft_json.smart.projectName = projectName
      project.draft_json.description = description
      project.draft_json.smart.basePrompt = description
      project.draft_json.smart.entryInitial.text = description
    }
  }
  return scoped
}

const json = (route: Route, data: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(status >= 400 ? data : { code: 0, data }),
  })

function projectIdFromPath(path: string): number {
  const matched = path.match(/^\/api\/v1\/creative\/projects\/(\d+)(?:\/draft)?$/)
  return Number(matched?.[1] || 0)
}

function isBackendRequest(url: URL): boolean {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/deepauth/')
}

export async function installStrictAuthenticatedApp(
  page: Page,
  options: { activeWorkspaceId?: number } = {},
): Promise<StrictApiState> {
  const initialWorkspaceId = Number(options.activeWorkspaceId || WORKSPACE_ID)
  const initialWorkspace = workspaceById(initialWorkspaceId)
  const state: StrictApiState = {
    unexpected: [],
    seen: [],
    paidTaskSubmissions: 0,
    draftWrites: 0,
  }

  await page.addInitScript(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.localStorage.setItem('zzh_has_auth_session', '1')
  })

  await page.route(isBackendRequest, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method().toUpperCase()
    const path = url.pathname

    const workspaceIdFromPath = path.match(/^\/api\/v1\/workspaces\/(\d+)(?:\/|$)/)?.[1]
    const workspaceId = Number(url.searchParams.get('workspace_id') || workspaceIdFromPath || 0)
    const projectId = projectIdFromPath(path)
    state.seen.push({ method, path, workspaceId, projectId })

    if (method === 'GET' && path === '/api/v1/auth/session') {
      await json(route, {
        workspace: initialWorkspace,
        workspaces,
        expires_in: 3600,
      })
      return
    }
    if (method === 'GET' && path === '/api/v1/me') {
      await json(route, { user })
      return
    }
    if (method === 'GET' && path === '/api/v1/workspaces') {
      await json(route, workspaces)
      return
    }
    const memberWorkspaceMatch = path.match(/^\/api\/v1\/workspaces\/(\d+)\/members$/)
    if (method === 'GET' && memberWorkspaceMatch) {
      await json(route, [memberFor(Number(memberWorkspaceMatch[1]))])
      return
    }
    if (method === 'GET' && path === '/api/v1/billing/plans') {
      await json(route, [
        {
          id: 10,
          code: 'team-e2e',
          name: 'E2E 团队版',
          plan_type: 'team',
          price_cents: 100,
          base_credits: 10000,
          status: 'active',
        },
      ])
      return
    }
    if (method === 'GET' && path === '/api/v1/billing/subscription') {
      await json(route, {
        active: true,
        plan_code: 'team-e2e',
        plan_name: 'E2E 团队版',
        plan_type: 'team',
        expires_at: '2027-07-20T00:00:00.000Z',
      })
      return
    }
    if (method === 'GET' && path === '/api/v1/billing/wallet') {
      await json(route, { available: 9000, balance: 9000 })
      return
    }
    if (method === 'GET' && path === '/api/v1/templates') {
      await json(route, [
        {
          id: 1,
          title: 'E2E 在线模板',
          video_url: `/api/v1/assets/603/download?workspace_id=${WORKSPACE_ID}`,
          ratio: '16:9',
          style: '写实',
          created_at: '2026-07-20T00:00:00.000Z',
        },
      ])
      return
    }
    if (method === 'GET' && path === '/api/v1/creative/projects') {
      const scopedProjects = projectsForWorkspace(workspaceId || initialWorkspaceId)
      await json(route, { items: scopedProjects, total: scopedProjects.length, offset: 0, limit: 100 })
      return
    }
    if (method === 'GET' && projectId > 0 && !path.endsWith('/draft')) {
      const project = projectsForWorkspace(workspaceId || initialWorkspaceId).find((item) => item.id === projectId)
      await json(route, project || { code: 'NOT_FOUND', message: 'project not found' }, project ? 200 : 404)
      return
    }
    if (method === 'PUT' && projectId > 0 && path.endsWith('/draft')) {
      state.draftWrites += 1
      const project = projectsForWorkspace(workspaceId || initialWorkspaceId).find((item) => item.id === projectId)
      await json(route, {
        ...(project || {}),
        draft_revision: Number(project?.draft_revision || 0) + state.draftWrites,
      })
      return
    }
    if (method === 'GET' && path === '/api/v1/assets') {
      await json(route, {
        items: [
          {
            id: 701,
            workspace_id: workspaceId || initialWorkspaceId,
            name: 'E2E 素材图片',
            type: 'image',
            mime_type: 'image/png',
            source: 'upload',
            status: 'active',
            created_at: '2026-07-20T07:00:00.000Z',
          },
        ],
        total: 1,
        offset: 0,
        limit: 24,
      })
      return
    }
    if (method === 'GET' && /^\/api\/v1\/assets\/\d+\/download$/.test(path)) {
      const isImage = path.includes('/701/') || path.includes('/502/')
      if (!isImage) {
        await fulfillTinyVideo(route)
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      })
      return
    }
    if (method === 'GET' && path === '/api/v1/ai/tasks') {
      const operation = url.searchParams.get('operation_code') || ''
      const items =
        operation === 'video.generate'
          ? [
              {
                id: 801,
                status: 'succeeded',
                operation_code: operation,
                result_json: {
                  asset_id: 601,
                  url: `/api/v1/assets/601/download?workspace_id=${workspaceId || initialWorkspaceId}`,
                },
                created_at: '2026-07-20T08:05:00.000Z',
              },
            ]
          : []
      await json(route, { items, total: items.length, offset: 0, limit: 100 })
      return
    }
    if (method === 'GET' && path === '/api/v1/ai/models') {
      // Restored editors probe operation availability for their cost preview.
      // An empty model list is a valid, non-billable response and must never
      // cause the E2E fixture to invent a paid generation task.
      await json(route, { items: [], total: 0 })
      return
    }
    if (method === 'POST' && path === '/api/v1/ai/tasks/estimate-cost') {
      await json(route, { estimated_cost: 100, balance: 9000, can_afford: true })
      return
    }
    if (method === 'POST' && path === '/api/v1/ai/responses') {
      state.paidTaskSubmissions += 1
      await json(route, { code: 'E2E_PAID_TASK_BLOCKED', message: 'paid task blocked by E2E' }, 409)
      return
    }
    if (method === 'GET' && /^\/api\/v1\/workspaces\/\d+\/overview$/.test(path)) {
      await json(route, {
        total: { member_count: 1, project_count: 2, total_credits: 300 },
        previous: { member_count: 1, project_count: 1, total_credits: 200 },
      })
      return
    }
    if (method === 'GET' && /^\/api\/v1\/workspaces\/\d+\/member-statistics$/.test(path)) {
      await json(route, [
        {
          user_id: user.id,
          nickname: user.nickname,
          project_count: 2,
          video_count: 1,
          total_credits: 300,
        },
      ])
      return
    }
    if (method === 'GET' && path === '/api/v1/billing/credit-ledgers') {
      await json(route, { items: [], total: 0, offset: 0, limit: 100 })
      return
    }

    state.unexpected.push(`${method} ${path}${url.search}`)
    await json(route, { code: 'UNEXPECTED_E2E_REQUEST', message: `${method} ${path} is not mocked` }, 500)
  })

  return state
}

export function expectNoUnexpectedApi(state: StrictApiState): void {
  expect(state.unexpected, `存在未声明 API 请求：\n${state.unexpected.join('\n')}`).toEqual([])
}

/**
 * Wait for a successful, tenant-scoped API response and for its body to finish.
 * Register this before navigation so lazy-route loading and mock fulfillment are
 * both part of the readiness condition instead of an arbitrary UI timeout.
 */
export async function waitForScopedApiResponse(page: Page, matcher: ScopedRequestMatcher) {
  const response = await page.waitForResponse((candidate) => {
    const request = candidate.request()
    const url = new URL(candidate.url())
    const method = request.method().toUpperCase()
    const path = url.pathname
    const workspaceIdFromPath = path.match(/^\/api\/v1\/workspaces\/(\d+)(?:\/|$)/)?.[1]
    const workspaceId = Number(url.searchParams.get('workspace_id') || workspaceIdFromPath || 0)
    const projectId = projectIdFromPath(path)

    return (
      candidate.ok() &&
      path === matcher.path &&
      (!matcher.method || method === matcher.method) &&
      (matcher.workspaceId === undefined || workspaceId === matcher.workspaceId) &&
      (matcher.projectId === undefined || projectId === matcher.projectId)
    )
  })

  await response.finished()
  return response
}

export function expectScopedRequest(state: StrictApiState, matcher: ScopedRequestMatcher): void {
  const matched = state.seen.some(
    (request) =>
      request.path === matcher.path &&
      (!matcher.method || request.method === matcher.method) &&
      (matcher.workspaceId === undefined || request.workspaceId === matcher.workspaceId) &&
      (matcher.projectId === undefined || request.projectId === matcher.projectId),
  )
  expect(matched, `未找到正确作用域请求：${JSON.stringify(matcher)}\n${JSON.stringify(state.seen, null, 2)}`).toBe(true)
}
