# 项目管理视频列表页改版详细实施说明

## 1. 文档目的

这份文档是上一版方案的细化版，目标是把“你给的参考图”拆成可执行的开发说明。

它重点回答 6 个问题：

1. 当前代码到底是什么结构
2. 为什么不能只改样式
3. 应该新增哪些页面、组件、工具函数
4. 每个组件需要什么数据、暴露什么事件
5. 当前后端数据如何映射成参考图需要的卡片数据
6. 实施时建议按什么顺序推进

这份文档仍然 **不修改业务代码**，只作为详细设计说明。

---

## 2. 当前代码现状拆解

### 2.1 当前路由结构

当前项目管理页只有一个入口：

- `src/router/index.tsx`
- 路由：`/projects`

当前路由文件里和这个场景相关的页面有：

- `/projects` -> `ProjectManagementView`
- `/smart/:id` -> 智能成片编辑页
- `/creative/:id` -> 分步创作编辑页

也就是说，当前系统里只有：

- 项目管理总页
- 两种编辑页

还没有“项目内视频列表页”这个中间层。

### 2.2 当前 `ProjectManagementView` 实际承担的职责

当前页面文件：

- `src/views/ProjectManagementView.tsx`

它同时承担了 5 类职责：

1. 页面壳渲染
2. 项目列表加载
3. 创建项目
4. 项目详情解析
5. 视频下载、删除、拖拽等交互

它内部当前已经包含这些状态：

- 侧边栏状态
- 项目列表状态
- 创建项目弹窗状态
- 项目详情状态
- 分镜预览状态
- 删除菜单状态
- 拖拽归类状态

换句话说，它已经是一个偏重的“复合页面组件”。

### 2.3 当前页面的两种视图模式

当前页面内部实际上不是一个页面，而是两个模式切换：

```ts
const [viewMode, setViewMode] = useState<'root' | 'detail'>('root')
```

也就是：

- `root`：项目根列表
- `detail`：项目详情

而你给的参考图，其实更像是：

- `project video list`：项目内视频列表

这说明参考图对应的页面语义，并不等于当前 `detail` 模式。

---

## 3. 为什么不能只改样式

如果只是视觉微调，通常只需要改：

- DOM 结构
- CSS

但这次不是。

因为参考图和当前页面的差异不仅是“长得不像”，而是“页面语义不同”。

### 3.1 当前页面语义

当前页面表达的是：

- 用户有哪些项目
- 某个项目里有哪些分镜和视频历史

### 3.2 参考图语义

参考图表达的是：

- 某个项目下面有哪些视频
- 这些视频可以被搜索、筛选、排序、分页、创建

### 3.3 这带来的结构性变化

所以这次改版必须补的不是单个 className，而是：

- 一个新的页面层级
- 一种新的列表数据模型
- 一套新的筛选状态
- 一套新的分页逻辑
- 一套新的卡片字段结构

也就是说，真正需要调整的是：

- `页面职责`
- `数据结构`
- `交互结构`

而 CSS 只是最后一层。

---

## 4. 推荐目标结构

建议最后形成下面这套路由和页面职责。

### 4.1 路由结构

```text
/projects
  项目列表页

/projects/:projectId/videos
  项目内视频列表页

/smart/:id
  智能成片编辑页

/creative/:id
  分步创作编辑页
```

### 4.2 页面职责拆分

#### 页面 1：项目列表页

文件：

- `src/views/ProjectManagementView.tsx`

职责：

- 展示项目文件夹列表
- 支持创建项目
- 支持删除项目
- 点击某个项目进入项目视频页

不再负责：

- 项目详情视频播放器
- 分镜详情
- 视频历史列表

#### 页面 2：项目内视频列表页

文件建议新增：

- `src/views/ProjectVideoListView.tsx`

职责：

- 面包屑
- 搜索
- 排序
- 状态筛选
- 时长筛选
- 新建视频按钮
- 视频卡片网格
- 分页
- 点击进入编辑

#### 页面 3：编辑页

仍然沿用：

- `src/views/SmartCreateView.tsx`
- `src/views/CreativeScriptView.tsx`

---

## 5. 建议新增/修改的文件清单

## 5.1 必改文件

- `src/router/index.tsx`
- `src/views/ProjectManagementView.tsx`

## 5.2 强烈建议新增

- `src/views/ProjectVideoListView.tsx`
- `src/views/ProjectVideoListView.css`
- `src/utils/projectVideos.ts`

## 5.3 建议新增组件

- `src/components/project/ProjectVideoToolbar.tsx`
- `src/components/project/ProjectVideoCard.tsx`
- `src/components/project/ProjectVideoPagination.tsx`
- `src/components/project/ProjectBreadcrumb.tsx`

## 5.4 可选新增

- `src/components/project/ProjectVideoEmpty.tsx`
- `src/components/project/ProjectVideoStatusTag.tsx`
- `src/components/project/ProjectVideoMoreMenu.tsx`

---

## 6. 目录建议

推荐最终目录形态如下：

```text
src/
  components/
    project/
      ProjectBreadcrumb.tsx
      ProjectVideoToolbar.tsx
      ProjectVideoCard.tsx
      ProjectVideoPagination.tsx
      ProjectVideoEmpty.tsx
      ProjectVideoStatusTag.tsx
      ProjectVideoMoreMenu.tsx
  utils/
    projectVideos.ts
  views/
    ProjectManagementView.tsx
    ProjectVideoListView.tsx
    ProjectVideoListView.css
```

---

## 7. 页面拆分后的职责说明

## 7.1 `ProjectManagementView.tsx`

建议保留的能力：

- 加载项目列表
- 创建项目
- 删除项目
- 项目封面拼图
- 项目排序

建议删掉或迁出的能力：

- `viewMode === 'detail'` 的整块详情内容
- `detailShots`
- `detailVideos`
- `detailFlow`
- `activeVideoIdx`
- `bigImg`
- `openFolder` 中对详情数据的解析

项目点击后建议改成：

```ts
navigate(`/projects/${project.id}/videos`)
```

如果需要继续带上工作空间参数，可以保留：

```ts
const qs = workspaceId ? `?workspace_id=${workspaceId}` : ''
navigate(`/projects/${project.id}/videos${qs}`)
```

## 7.2 `ProjectVideoListView.tsx`

这个页面建议只做一件事：

- 把某个项目里的视频，用参考图风格展示成可筛选、可分页的列表页

这个页面里建议出现的状态：

```ts
const [loading, setLoading] = useState(false)
const [projectTitle, setProjectTitle] = useState('')
const [videoCards, setVideoCards] = useState<ProjectVideoCardItem[]>([])
const [query, setQuery] = useState('')
const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt'>('updatedAt')
const [status, setStatus] = useState<'all' | 'draft' | 'reviewing' | 'published'>('all')
const [duration, setDuration] = useState<'all' | 'short' | 'mid' | 'long'>('all')
const [page, setPage] = useState(1)
const [pageSize, setPageSize] = useState(20)
```

建议保留的引用值：

```ts
const workspaceId = useWorkspaceId()
const navigate = useNavigate()
const params = useParams()
```

---

## 8. 推荐的数据结构

## 8.1 页面级数据结构

建议把项目视频页的列表项统一映射为：

```ts
export interface ProjectVideoCardItem {
  id: string
  projectId: number
  projectTitle: string
  versionLabel: string
  title: string
  coverUrl: string
  videoUrl: string
  durationSeconds: number
  durationText: string
  status: 'draft' | 'reviewing' | 'published'
  statusText: string
  authorName: string
  createdAt: number
  createdAtText: string
  updatedAt: number
  updatedAtText: string
  flow: 'smart' | 'legacy'
  canEdit: boolean
  canDownload: boolean
}
```

解释：

- `id`
  - 列表唯一键
  - 不能只用 `projectId`
  - 因为一个项目可能有多个视频版本
- `versionLabel`
  - 用于显示“版本 1 / 版本 2 / 最终版”
- `title`
  - 卡片显示标题
  - 可以是项目名，也可以是项目名 + 版本名
- `flow`
  - 决定点击“进入编辑”时跳到 `/smart/:id` 还是 `/creative/:id`

---

## 8.2 筛选状态结构

建议定义：

```ts
type VideoSortKey = 'updatedAt' | 'createdAt'
type VideoStatusFilter = 'all' | 'draft' | 'reviewing' | 'published'
type VideoDurationFilter = 'all' | 'short' | 'mid' | 'long'
```

解释建议：

- `short`: `0 ~ 15s`
- `mid`: `16 ~ 60s`
- `long`: `60s+`

---

## 9. 数据来源怎么映射

当前系统里，视频不是单独接口资源，而是藏在项目草稿里。

因此需要一层映射，把“项目草稿”转成“视频列表卡片”。

## 9.1 当前可用数据来源

当前页面中已经有这些可复用能力：

- `normalizeCreativeProjectDraft(payload)`
- `parseProjectDetail(draft)`
- `getCreativeProject({ projectId, workspaceId })`
- `getAssetDownloadUrl({ workspaceId, assetId })`

这些可以继续利用，但建议不要直接在新页面里复制粘贴。

更好的做法是统一放到：

- `src/utils/projectVideos.ts`

## 9.2 推荐工具函数设计

建议新增这些函数：

### `normalizeProjectDraft`

```ts
export function normalizeProjectDraft(payload: any): any
```

职责：

- 兼容多种后端字段：
  - `draft_json`
  - `draftJson`
  - `draft`
  - `data.draft_json`
  - `data.draft`

### `extractProjectVideoVersions`

```ts
export function extractProjectVideoVersions(draft: any): any[]
```

职责：

- 从以下字段里找视频版本：
  - `draft.smart.videoVersions`
  - `draft.videoHistoryList`
  - `draft.video_history_list`
  - `draft.generatedVideoUrl`

### `resolveProjectVideoFlow`

```ts
export function resolveProjectVideoFlow(draft: any): 'smart' | 'legacy'
```

职责：

- 兼容 `draft.flow`
- 兼容 `draft.smart.flow`
- 没有时默认 `smart`

### `resolveProjectVideoStatus`

```ts
export function resolveProjectVideoStatus(input: any): {
  status: 'draft' | 'reviewing' | 'published'
  statusText: string
}
```

建议规则：

- 如果有明确发布字段 -> `published`
- 如果存在生成任务未完成 -> `reviewing`
- 其他默认 `draft`

### `resolveProjectVideoPoster`

```ts
export function resolveProjectVideoPoster(input: any): string
```

优先级建议：

1. `cover_url`
2. `thumbnail_url`
3. `poster`
4. 项目草稿封面
5. 空字符串

### `buildProjectVideoCards`

```ts
export function buildProjectVideoCards(options: {
  project: any
  draft: any
  currentUserName?: string
}): ProjectVideoCardItem[]
```

职责：

- 输出最终页面使用的卡片数组

---

## 10. 卡片字段映射规则建议

下面给出更细的映射建议。

| 页面字段 | 建议来源 | 兜底方案 |
| --- | --- | --- |
| `projectId` | `project.id` | `0` |
| `projectTitle` | `project.title / project.name` | `未命名项目` |
| `versionLabel` | 视频版本索引/后端标签 | `版本 X` |
| `title` | `projectTitle + versionLabel` 或单项目标题 | `未命名视频` |
| `coverUrl` | `cover_url / thumbnail_url / poster` | 空 |
| `videoUrl` | `video.url / src / generatedVideoUrl` | 空 |
| `durationSeconds` | 后端字段或前端解析 | `0` |
| `durationText` | 格式化秒数 | `--:--` |
| `status` | 发布/处理中/草稿状态推断 | `draft` |
| `statusText` | 中文文案 | `草稿` |
| `authorName` | 当前登录用户名 | `未知作者` |
| `updatedAt` | `updated_at / updatedAt` | `created_at` |
| `createdAt` | `created_at / createdAt` | `0` |
| `flow` | `draft.flow / draft.smart.flow` | `smart` |

---

## 11. 页面组件设计

## 11.1 `ProjectBreadcrumb`

建议职责：

- 显示 `首页 / 项目管理 / 某项目（N个视频）`

建议 props：

```ts
interface ProjectBreadcrumbProps {
  projectTitle: string
  videoCount: number
  onBackToProjects?: () => void
}
```

说明：

- `首页` 不一定真的跳 `/home`
- 如果你想和业务语义一致，也可以改成：
  - `首页 / 项目管理 / 某项目`
- 如果希望点击更直观：
  - `项目管理 / 某项目（12个视频）`

## 11.2 `ProjectVideoToolbar`

建议 props：

```ts
interface ProjectVideoToolbarProps {
  query: string
  sortBy: VideoSortKey
  status: VideoStatusFilter
  duration: VideoDurationFilter
  onQueryChange: (value: string) => void
  onSortChange: (value: VideoSortKey) => void
  onStatusChange: (value: VideoStatusFilter) => void
  onDurationChange: (value: VideoDurationFilter) => void
  onCreateVideo: () => void
}
```

组件内部包含：

- 搜索框
- 排序下拉
- 状态下拉
- 时长下拉
- 新建视频按钮

## 11.3 `ProjectVideoCard`

建议 props：

```ts
interface ProjectVideoCardProps {
  item: ProjectVideoCardItem
  onOpen: (item: ProjectVideoCardItem) => void
  onDownload: (item: ProjectVideoCardItem) => void
  onMore: (item: ProjectVideoCardItem) => void
}
```

卡片内部结构建议：

```text
card
├─ cover
│  ├─ image
│  ├─ play button
│  ├─ duration badge
│  └─ more button
├─ title
├─ meta row
│  ├─ date
│  ├─ author
│  └─ updated time
└─ status tag
```

## 11.4 `ProjectVideoPagination`

建议 props：

```ts
interface ProjectVideoPaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}
```

建议能力：

- 上一页
- 下一页
- 页码列表
- 每页 20 / 50 / 100

---

## 12. `ProjectVideoListView` 页面内部逻辑建议

## 12.1 页面加载流程

建议流程：

1. 从路由参数拿 `projectId`
2. 从 store 拿 `workspaceId`
3. 请求项目详情 `getCreativeProject`
4. 解析草稿 `normalizeProjectDraft`
5. 转成卡片数组 `buildProjectVideoCards`
6. 写入页面状态

伪代码：

```ts
useEffect(() => {
  async function run() {
    if (!projectId || !workspaceId) return
    setLoading(true)
    try {
      const project = await getCreativeProject({ projectId, workspaceId })
      const draft = normalizeProjectDraft(project)
      const cards = buildProjectVideoCards({
        project,
        draft,
        currentUserName,
      })
      setProjectTitle(project.title || project.name || '未命名项目')
      setVideoCards(cards)
    } finally {
      setLoading(false)
    }
  }
  run()
}, [projectId, workspaceId])
```

## 12.2 筛选与分页计算

建议用 `useMemo` 派生：

```ts
const filteredVideos = useMemo(() => {
  return videoCards
    .filter(matchQuery)
    .filter(matchStatus)
    .filter(matchDuration)
    .sort(sortVideos)
}, [videoCards, query, status, duration, sortBy])

const total = filteredVideos.length
const totalPages = Math.max(1, Math.ceil(total / pageSize))
const safePage = Math.min(page, totalPages)
const pagedVideos = filteredVideos.slice((safePage - 1) * pageSize, safePage * pageSize)
```

当搜索和筛选条件变化时，建议把页码重置到第一页：

```ts
useEffect(() => {
  setPage(1)
}, [query, sortBy, status, duration, pageSize])
```

## 12.3 卡片点击行为

建议规则：

- 点击封面或标题 -> 进入编辑页
- 点击下载按钮 -> 下载视频
- 点击更多按钮 -> 打开菜单

编辑页跳转逻辑：

```ts
function openEditor(item: ProjectVideoCardItem) {
  const qs = workspaceId ? `?workspace_id=${workspaceId}` : ''
  if (item.flow === 'legacy') {
    navigate(`/creative/${item.projectId}${qs}`)
    return
  }
  navigate(`/smart/${item.projectId}${qs}`)
}
```

说明：

- 这里本质仍然是按项目进入编辑，不是按单个视频版本进入编辑
- 如果未来后端补了“videoId 编辑入口”，再继续细分

---

## 13. 样式实现建议

## 13.1 页面布局

建议新页面整体结构：

- 外层继续复用 `AppSidebar + AppTopbar`
- 中间主体区宽度撑满
- 内容区顶部是面包屑和工具栏
- 下方是卡片网格
- 最下方是分页

建议类名：

- `.project-video-page`
- `.project-video-shell`
- `.project-video-main`
- `.project-video-breadcrumb`
- `.project-video-toolbar`
- `.project-video-grid`
- `.project-video-pagination`

## 13.2 卡片样式建议

建议尺寸：

- 卡片宽：自适应网格
- 封面比例：`16 / 10`
- 圆角：`14px`
- hover：轻微上浮 + 轻阴影

建议状态标签类：

- `.project-video-status`
- `.project-video-status.is-published`
- `.project-video-status.is-draft`
- `.project-video-status.is-reviewing`

建议元信息行：

- 使用较浅灰色
- 字号 12px~13px
- 同一行不超过 3 段

## 13.3 工具栏样式建议

建议：

- 搜索框在左
- 三个筛选器靠中间
- `新建视频` 按钮靠右

工具栏类名：

- `.project-video-toolbar__search`
- `.project-video-toolbar__filters`
- `.project-video-toolbar__create`

---

## 14. “新建视频”按钮怎么处理

参考图里有 `新建视频` 按钮，这里需要业务定义。

## 14.1 最简单方案

点击后直接跳：

- `/smart`

或者：

- `/creative`

然后由编辑页完成新项目创建。

优点：

- 快
- 不用新增复杂业务

缺点：

- 不一定和“当前项目下新建视频”语义完全一致

## 14.2 更贴近业务的方案

点击后弹出选择：

- 智能成片
- 分步创作

再进入对应页面，并把当前项目信息带过去。

## 14.3 推荐

第一阶段建议用最简单方案：

- `新建视频` -> `/smart`

等后续需要严格挂载到“当前项目”再补完整流程。

---

## 15. 旧详情页内容怎么处理

当前 `ProjectManagementView` 里有一整套详情视图：

- 视频播放器
- 视频历史版本
- 分镜网格
- 分镜大图预览

这些内容处理有两种方向。

## 15.1 方向 A：移除旧详情

做法：

- 点击项目直接进入新视频列表页
- 原详情模式删除

优点：

- 页面职责更干净

缺点：

- 老功能入口变化较大

## 15.2 方向 B：保留详情，但不作为主入口

做法：

- 项目列表点击进入“视频列表页”
- 视频列表页里通过 `更多操作` 提供“查看项目详情”

优点：

- 老能力不丢

缺点：

- 多一层维护成本

## 15.3 推荐

建议第一阶段：

- 先保留旧详情相关代码
- 但项目列表主入口改去视频列表页

这样迁移风险更小。

---

## 16. 实施顺序建议

## 阶段 1：建立新路由和新页面骨架

目标：

- 新页面可打开
- 只显示空壳布局

改动：

- `src/router/index.tsx`
- `src/views/ProjectVideoListView.tsx`
- `src/views/ProjectVideoListView.css`

产出：

- 能访问 `/projects/:projectId/videos`

## 阶段 2：抽数据映射层

目标：

- 先把“项目草稿 -> 视频卡片数组”跑通

改动：

- `src/utils/projectVideos.ts`

产出：

- 控制台打印出结构稳定的 `ProjectVideoCardItem[]`

## 阶段 3：完成工具栏和列表静态结构

目标：

- 页面长得像参考图

改动：

- `ProjectBreadcrumb`
- `ProjectVideoToolbar`
- `ProjectVideoCard`
- `ProjectVideoPagination`

产出：

- UI 基本对齐

## 阶段 4：接入搜索、筛选、分页

目标：

- 列表可用

改动：

- `ProjectVideoListView.tsx`

产出：

- 搜索、排序、筛选、分页全部可工作

## 阶段 5：把项目列表入口切过去

目标：

- 从 `/projects` 点击某个项目进入视频页

改动：

- `ProjectManagementView.tsx`

产出：

- 用户使用路径成型

## 阶段 6：补细节交互

目标：

- 页面完成度更高

可补内容：

- 更多菜单
- 空状态
- 加载骨架
- 错误提示
- 下载逻辑复用

---

## 17. 风险与兼容性说明

## 17.1 风险：一个项目可能没有“多个独立视频”

现状下很多项目可能只有：

- 一个最终视频
- 若干历史版本

因此参考图里的“12 个视频”，在现有业务里可能对应的是：

- 同项目的历史视频版本
- 或项目草稿里拆出来的多个视频结果

建议产品层先确认：

- 页面展示的是“项目内的所有视频版本”
- 还是“项目内多个真正独立的视频条目”

## 17.2 风险：封面图不一定稳定

因为当前更多是项目草稿结构，不是标准视频资源列表。

建议第一阶段允许：

- 无封面时展示占位图
- 无时长时展示 `--:--`

## 17.3 风险：分页只是前端分页

如果项目视频非常多，前端分页会有性能上限。

不过第一阶段通常足够。

---

## 18. 验收清单

开发完成后，建议按下面清单验收。

### 页面结构

- 能从项目列表进入项目视频列表页
- 新页面有面包屑
- 新页面有工具栏
- 新页面有视频卡片网格
- 新页面有分页区

### 数据展示

- 能正确显示项目名
- 能正确显示视频数量
- 能显示视频标题
- 能显示封面
- 能显示状态标签
- 能显示作者/时间等元信息

### 交互

- 搜索有效
- 状态筛选有效
- 时长筛选有效
- 排序有效
- 分页有效
- 点击卡片可进入编辑页
- 点击下载可下载视频

### 容错

- 没有视频时显示空状态
- 接口失败时有错误提示
- 缺失封面时不崩
- 缺失时长时不崩

---

## 19. 最终建议

这次改版最稳妥的落地方式不是“在旧页面上硬改出参考图”，而是：

1. 保留现有项目列表页
2. 新增一个项目内视频列表页
3. 把视频数据映射层单独抽出来
4. 再用独立组件把参考图搭出来

如果只追求“先看到效果”，最小闭环做法是：

1. 新建 `ProjectVideoListView`
2. 新建 `projectVideos.ts`
3. 新建卡片、工具栏、分页三个组件
4. 让 `/projects` 点击项目跳过去

这样是最符合你当前诉求、同时又最不容易把现有页面搞乱的方式。

---

## 20. 你现在可以怎么用这份文档

这份文档可以直接用于三种场景：

### 场景 1：你自己评审方向

重点看：

- 第 4 节：推荐目标结构
- 第 5 节：文件改动清单
- 第 16 节：实施顺序

### 场景 2：交给开发同学

重点看：

- 第 8 节：推荐的数据结构
- 第 9 节：数据来源怎么映射
- 第 11 节：页面组件设计
- 第 12 节：页面内部逻辑建议

### 场景 3：让我继续直接实现

你只要确认两件事：

1. 是否采用“新增 `ProjectVideoListView`”方案
2. `新建视频` 按钮第一阶段是否先直接跳 `/smart`

确认后我就可以按这份详细文档直接开始落代码。
