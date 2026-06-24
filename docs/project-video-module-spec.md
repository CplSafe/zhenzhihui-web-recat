# 项目视频管理模块规格文档

## 1. 目标定义

本模块的目标不是“把当前项目管理页改得更像一张设计图”，而是**新增一套与设计图语义一致的项目视频管理模块**，同时满足以下两个要求：

- 视觉层面：尽可能接近你提供的参考图
- 业务层面：页面中的“视频”必须是真实可管理的独立业务实体，而不是项目草稿里临时拼出来的结果

本模块的最终定位是：

- 用户进入 `项目管理`
- 选择某个项目
- 查看该项目下的独立视频列表
- 对视频进行搜索、筛选、排序、分页、创建、查看详情、编辑、发布等操作

---

## 2. 已确认的产品口径

基于你刚才确认的需求，本模块采用以下产品定义。

### 2.1 视频定义

页面中的“12个视频”代表：

- 某个项目下的 **12条独立视频记录**

不是：

- 同一个项目的历史版本列表
- 单纯从草稿里临时提取的视频结果

### 2.2 新建视频动作

“新建视频”按钮代表：

- 在当前项目下创建一条新视频记录

不是：

- 直接跳到某个旧编辑页开始创建后再猜测归属

### 2.3 状态体系

第一版统一采用三态：

- `draft`：草稿
- `processing`：制作中
- `published`：已发布

### 2.4 卡片点击行为

点击视频卡片默认行为：

- 进入 `视频详情页`

而不是：

- 直接进入编辑页

视频详情页再提供：

- 进入编辑
- 发布
- 删除
- 下载

---

## 3. 与现有项目的关系

### 3.1 现有结构

当前项目相关页面主要有：

- `src/views/ProjectManagementView.tsx`
- `src/views/SmartCreateView.tsx`
- `src/views/CreativeScriptView.tsx`

当前项目管理页的语义是：

- 项目列表
- 项目详情（视频 + 分镜）

而目标页面语义是：

- 项目列表
- 项目下视频列表
- 单个视频详情

### 3.2 为什么不能只改现有页面

因为当前 `ProjectManagementView` 里的“视频”并不是独立实体，而是依附于项目草稿和历史结果。

如果只改样式，会出现以下问题：

- 页面长得像设计图，但数据语义不对
- 卡片里的“视频”无法稳定搜索、筛选、分页
- “新建视频”没有明确落点
- “视频详情页”无法建立稳定的路由和数据模型

因此这次必须新增模块，不建议继续把全部逻辑堆在现有 `ProjectManagementView` 中。

---

## 4. 模块边界

本模块建议命名为：

- `项目视频管理模块`

负责：

- 项目下视频列表
- 视频详情
- 视频创建入口
- 视频状态管理
- 页面级搜索/筛选/排序/分页

不负责：

- 智能成片编辑核心能力
- 分步创作编辑核心能力
- 分镜编辑器内部编排
- 项目本身的创建/删除逻辑

这些能力继续由现有模块负责。

---

## 5. 最终信息架构

建议最终形成如下结构：

```text
项目管理
├─ 项目列表页
│  └─ 点击项目
│
├─ 项目视频列表页
│  ├─ 搜索
│  ├─ 排序
│  ├─ 状态筛选
│  ├─ 时长筛选
│  ├─ 新建视频
│  └─ 点击某个视频
│
└─ 视频详情页
   ├─ 视频预览
   ├─ 基础信息
   ├─ 状态展示
   ├─ 下载
   ├─ 删除
   ├─ 发布
   └─ 进入编辑
```

---

## 6. 路由设计

## 6.1 路由清单

建议新增以下路由：

```text
/projects
  项目列表页

/projects/:projectId/videos
  项目下视频列表页

/projects/:projectId/videos/:videoId
  视频详情页
```

可选新增：

```text
/projects/:projectId/videos/:videoId/edit
  视频编辑中转页
```

但第一版不是必须，可以在详情页里直接跳转到现有编辑页。

## 6.2 路由文件改动

需要修改：

- `src/router/index.tsx`

建议新增懒加载页面：

- `ProjectVideoListView`
- `ProjectVideoDetailView`

伪代码：

```ts
const ProjectVideoListView = lazy(() => import('../views/ProjectVideoListView'))
const ProjectVideoDetailView = lazy(() => import('../views/ProjectVideoDetailView'))
```

路由建议：

```ts
{ path: 'projects/:projectId/videos', element: lazyPage(<ProjectVideoListView />) }
{ path: 'projects/:projectId/videos/:videoId', element: lazyPage(<ProjectVideoDetailView />) }
```

---

## 7. 页面清单与职责

## 7.1 页面一：项目列表页

文件：

- `src/views/ProjectManagementView.tsx`

职责：

- 展示项目列表
- 创建项目
- 删除项目
- 进入某个项目的视频列表

不再作为主入口承载：

- 项目详情视频区
- 项目详情分镜区

建议项目点击行为改为：

```ts
navigate(`/projects/${project.id}/videos`)
```

## 7.2 页面二：项目视频列表页

建议新增：

- `src/views/ProjectVideoListView.tsx`
- `src/views/ProjectVideoListView.css`

职责：

- 展示某个项目下的所有独立视频
- 对视频列表做搜索、筛选、排序、分页
- 从当前项目创建新视频
- 点击某条视频进入详情

## 7.3 页面三：视频详情页

建议新增：

- `src/views/ProjectVideoDetailView.tsx`
- `src/views/ProjectVideoDetailView.css`

职责：

- 展示单视频预览与信息
- 承载视频操作入口
- 作为列表卡片与编辑页之间的业务过渡层

---

## 8. 前端文件规划

## 8.1 页面文件

- `src/views/ProjectManagementView.tsx`
- `src/views/ProjectVideoListView.tsx`
- `src/views/ProjectVideoDetailView.tsx`

## 8.2 样式文件

- `src/views/ProjectVideoListView.css`
- `src/views/ProjectVideoDetailView.css`

## 8.3 组件文件

建议新增目录：

- `src/components/project/`

建议组件：

- `ProjectBreadcrumb.tsx`
- `ProjectVideoToolbar.tsx`
- `ProjectVideoCard.tsx`
- `ProjectVideoPagination.tsx`
- `ProjectVideoStatusTag.tsx`
- `ProjectVideoEmpty.tsx`
- `ProjectVideoMeta.tsx`
- `ProjectVideoHeader.tsx`
- `ProjectVideoActionBar.tsx`

## 8.4 数据工具文件

- `src/utils/projectVideos.ts`
- `src/utils/projectVideoStatus.ts`

## 8.5 接口文件

建议新增：

- `src/api/projectVideos.ts`

如果想继续统一放在 `business.ts` 也可以，但从维护性上更建议拆出独立文件。

---

## 9. 核心业务实体定义

## 9.1 项目实体

继续沿用现有项目概念：

```ts
interface Project {
  id: number
  workspaceId: number
  title: string
  createdAt: string
  updatedAt: string
}
```

## 9.2 视频实体

这是本次模块最关键的业务实体。

建议定义：

```ts
export interface ProjectVideo {
  id: number
  projectId: number
  workspaceId: number
  title: string
  coverUrl: string
  videoUrl: string
  durationSeconds: number
  status: 'draft' | 'processing' | 'published'
  createdBy: number
  createdByName: string
  createdAt: string
  updatedAt: string
}
```

## 9.3 视频详情实体

建议在详情页使用扩展结构：

```ts
export interface ProjectVideoDetail extends ProjectVideo {
  description?: string
  publishUrl?: string
  sourceType?: 'smart' | 'creative'
  lastEditedAt?: string
  tags?: string[]
}
```

---

## 10. 页面展示模型

为了避免页面直接依赖后端原始结构，建议为前端 UI 再做一层 ViewModel。

## 10.1 列表卡片模型

```ts
export interface ProjectVideoCardItem {
  id: number
  projectId: number
  title: string
  coverUrl: string
  videoUrl: string
  durationSeconds: number
  durationText: string
  status: 'draft' | 'processing' | 'published'
  statusText: string
  createdByName: string
  createdAtText: string
  updatedAtText: string
}
```

### 字段说明

- `durationText`
  - 用于显示 `03:15`
- `statusText`
  - 用于显示 `草稿 / 制作中 / 已发布`
- `createdAtText`
  - 用于显示日期
- `updatedAtText`
  - 用于显示修改时间

---

## 11. 状态体系定义

## 11.1 状态枚举

第一版统一使用：

```ts
type ProjectVideoStatus = 'draft' | 'processing' | 'published'
```

## 11.2 状态语义

### `draft`

含义：

- 已创建但未完成生成或未发布

展示文案：

- `草稿`

视觉建议：

- 灰色浅底
- 深灰文字

### `processing`

含义：

- 正在生成、处理中、待完成

展示文案：

- `制作中`

视觉建议：

- 橙黄色浅底
- 橙色文字

### `published`

含义：

- 已发布或已完成发布动作

展示文案：

- `已发布`

视觉建议：

- 绿色浅底
- 绿色文字

---

## 12. 前端交互定义

## 12.1 项目列表页

### 点击项目卡片

行为：

- 进入项目视频列表页

跳转：

```ts
/projects/:projectId/videos
```

### 点击创建项目

行为：

- 沿用当前已有逻辑

---

## 12.2 项目视频列表页

### 顶部面包屑

结构：

- `首页 / 项目管理 / 项目名称（12个视频）`

行为：

- 点击 `项目管理` 返回 `/projects`

### 搜索框

行为：

- 关键字按视频标题过滤

字段：

- `title`

### 排序下拉

第一版建议支持：

- 按修改时间排序
- 按创建时间排序

### 状态筛选

第一版建议支持：

- 全部
- 草稿
- 制作中
- 已发布

### 时长筛选

第一版建议支持：

- 全部
- 短视频
- 中视频
- 长视频

建议规则：

- `short`: `0-15s`
- `mid`: `16-60s`
- `long`: `61s+`

### 新建视频

行为：

- 在当前项目下创建视频记录
- 创建成功后跳入编辑流程

### 点击卡片

行为：

- 进入视频详情页

跳转：

```ts
/projects/:projectId/videos/:videoId
```

---

## 12.3 视频详情页

### 页面展示内容

建议包含：

- 返回按钮
- 视频标题
- 状态标签
- 主视频播放器
- 基础信息区
- 操作区

### 操作区建议

- 编辑
- 下载
- 发布
- 删除

### 点击编辑

如果视频源自智能成片：

- 进入 `/smart/:id`

如果视频源自分步创作：

- 进入 `/creative/:id`

如果第一版没有独立 `videoId -> 编辑实体` 的映射，就先按 `projectId` 跳。

---

## 13. 页面组件设计

## 13.1 `ProjectBreadcrumb`

职责：

- 展示面包屑

建议 props：

```ts
interface ProjectBreadcrumbProps {
  projectTitle: string
  videoCount: number
  onBackToProjects: () => void
}
```

## 13.2 `ProjectVideoToolbar`

职责：

- 承载搜索、筛选、排序、创建按钮

建议 props：

```ts
interface ProjectVideoToolbarProps {
  query: string
  sortBy: 'updatedAt' | 'createdAt'
  status: 'all' | 'draft' | 'processing' | 'published'
  duration: 'all' | 'short' | 'mid' | 'long'
  onQueryChange: (value: string) => void
  onSortChange: (value: 'updatedAt' | 'createdAt') => void
  onStatusChange: (value: 'all' | 'draft' | 'processing' | 'published') => void
  onDurationChange: (value: 'all' | 'short' | 'mid' | 'long') => void
  onCreateVideo: () => void
}
```

## 13.3 `ProjectVideoCard`

职责：

- 展示单个视频卡片

建议 props：

```ts
interface ProjectVideoCardProps {
  item: ProjectVideoCardItem
  onOpen: (item: ProjectVideoCardItem) => void
  onMore?: (item: ProjectVideoCardItem) => void
}
```

卡片结构建议：

```text
ProjectVideoCard
├─ Cover
│  ├─ Img
│  ├─ Play Button
│  ├─ Duration Badge
│  └─ More Button
├─ Title
├─ Meta Row
└─ Status Tag
```

## 13.4 `ProjectVideoPagination`

职责：

- 承载页码切换与每页条数切换

建议 props：

```ts
interface ProjectVideoPaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}
```

---

## 14. 列表页状态设计

建议 `ProjectVideoListView` 维护以下状态：

```ts
const [loading, setLoading] = useState(false)
const [projectTitle, setProjectTitle] = useState('')
const [videoCards, setVideoCards] = useState<ProjectVideoCardItem[]>([])

const [query, setQuery] = useState('')
const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt'>('updatedAt')
const [status, setStatus] = useState<'all' | 'draft' | 'processing' | 'published'>('all')
const [duration, setDuration] = useState<'all' | 'short' | 'mid' | 'long'>('all')

const [page, setPage] = useState(1)
const [pageSize, setPageSize] = useState(20)
```

建议派生状态：

```ts
const filteredCards = useMemo(...)
const total = filteredCards.length
const totalPages = Math.max(1, Math.ceil(total / pageSize))
const currentItems = filteredCards.slice(...)
```

筛选条件变化时：

```ts
useEffect(() => {
  setPage(1)
}, [query, sortBy, status, duration, pageSize])
```

---

## 15. 详情页状态设计

建议 `ProjectVideoDetailView` 维护以下状态：

```ts
const [loading, setLoading] = useState(false)
const [detail, setDetail] = useState<ProjectVideoDetail | null>(null)
const [deleting, setDeleting] = useState(false)
const [publishing, setPublishing] = useState(false)
```

---

## 16. 接口设计

如果要实现真正的业务还原，建议后端提供独立视频接口。

## 16.1 查询项目下视频列表

### 接口

```text
GET /api/v1/projects/:projectId/videos
```

### Query 参数

```ts
{
  query?: string
  status?: 'draft' | 'processing' | 'published'
  duration?: 'short' | 'mid' | 'long'
  sortBy?: 'updatedAt' | 'createdAt'
  page?: number
  pageSize?: number
}
```

### 返回结构建议

```ts
{
  list: ProjectVideo[]
  total: number
  page: number
  pageSize: number
}
```

## 16.2 创建视频

### 接口

```text
POST /api/v1/projects/:projectId/videos
```

### 请求体建议

```ts
{
  title?: string
  sourceType?: 'smart' | 'creative'
}
```

### 返回

```ts
ProjectVideo
```

## 16.3 获取视频详情

### 接口

```text
GET /api/v1/projects/:projectId/videos/:videoId
```

### 返回

```ts
ProjectVideoDetail
```

## 16.4 更新视频

### 接口

```text
PATCH /api/v1/projects/:projectId/videos/:videoId
```

### 支持字段

- `title`
- `status`

## 16.5 发布视频

### 接口

```text
POST /api/v1/projects/:projectId/videos/:videoId/publish
```

### 返回

- 发布后的 `ProjectVideoDetail`

## 16.6 删除视频

### 接口

```text
DELETE /api/v1/projects/:projectId/videos/:videoId
```

---

## 17. 前端 API 层建议

建议在：

- `src/api/projectVideos.ts`

中新增以下方法：

```ts
export async function listProjectVideos(...)
export async function createProjectVideo(...)
export async function getProjectVideo(...)
export async function updateProjectVideo(...)
export async function publishProjectVideo(...)
export async function deleteProjectVideo(...)
```

---

## 18. 数据兼容策略

如果后端暂时还没有独立视频接口，可以分两阶段做。

## 阶段 A：兼容现有数据

前端先从项目草稿中抽取视频，构造伪独立视频列表。

优点：

- 可以尽快把页面视觉和交互搭出来

缺点：

- 业务仍然不是真正独立实体

## 阶段 B：切换独立接口

后端补独立视频接口后，前端列表和详情切换到新接口。

优点：

- 真正实现视觉与业务双还原

建议最终目标必须落到阶段 B。

---

## 19. 视觉规格要求

## 19.1 列表页目标

视觉目标是尽量接近你给的参考图，重点包括：

- 浅灰背景
- 简洁的面包屑
- 紧凑的顶部筛选工具栏
- 统一规则的视频卡片
- 明确的状态标签颜色
- 底部分页与每页条数切换

## 19.2 视觉还原重点

优先还原以下部分：

- 工具栏布局
- 卡片比例
- 卡片信息层级
- 状态标签
- 底部分页位置
- 主体留白与间距

## 19.3 可以接受的差异

第一版允许少量差异：

- 个别卡片封面不完全一致
- 字体渲染有平台差异
- 某些图标不完全一致但风格一致

---

## 20. 详情页视觉建议

详情页不一定有参考图，但建议延续同一设计体系。

建议结构：

```text
ProjectVideoDetailView
├─ Breadcrumb
├─ Header
│  ├─ Title
│  ├─ Status
│  └─ Actions
├─ Main
│  ├─ Video Player
│  └─ Meta Panel
└─ Footer Actions
```

建议信息包括：

- 视频标题
- 所属项目
- 创建人
- 创建时间
- 更新时间
- 状态
- 时长

---

## 21. 新建视频流程

## 21.1 理想流程

1. 用户在项目视频列表页点击 `新建视频`
2. 系统在当前项目下创建视频记录，初始状态为 `draft`
3. 返回新建的视频 `videoId`
4. 进入对应编辑流程
5. 编辑完成后回流到该视频详情页或列表页

## 21.2 第一版可行流程

1. 创建一条空的视频记录
2. 默认 `sourceType = smart`
3. 跳到智能成片页
4. 保存完成后该视频记录更新为真实内容

如果后续还要支持分步创作，可在新建时增加：

- `创建方式选择`

---

## 22. 列表页开发顺序

## 第一步：补路由

改动：

- `src/router/index.tsx`

目标：

- 可以打开空白的项目视频列表页和详情页

## 第二步：搭页面骨架

新增：

- `ProjectVideoListView.tsx`
- `ProjectVideoDetailView.tsx`
- 对应 CSS

目标：

- 页面结构跑通

## 第三步：补组件

新增：

- `ProjectBreadcrumb`
- `ProjectVideoToolbar`
- `ProjectVideoCard`
- `ProjectVideoPagination`

目标：

- UI 结构接近设计图

## 第四步：接列表数据

新增：

- `src/api/projectVideos.ts`

目标：

- 列表页展示真实数据

## 第五步：接详情数据

目标：

- 详情页展示真实数据

## 第六步：接创建、删除、发布动作

目标：

- 业务闭环完整

---

## 23. 验收标准

## 23.1 视觉验收

- 页面整体布局与参考图高度接近
- 工具栏结构完整
- 卡片网格结构完整
- 状态标签风格正确
- 分页位置与结构正确

## 23.2 业务验收

- 项目列表点击进入项目下视频列表
- 列表展示的是独立视频，而不是临时拼装的历史片段
- 可以从当前项目下创建视频
- 可以查看视频详情
- 可以从详情页进入编辑
- 可以发布视频
- 可以删除视频

## 23.3 数据验收

- 搜索按标题工作
- 状态筛选工作
- 时长筛选工作
- 排序工作
- 分页工作

---

## 24. 风险与注意事项

## 风险 1：后端暂时没有独立视频接口

影响：

- 第一版只能做兼容型实现

建议：

- 把兼容实现当过渡方案，目标仍然是补接口

## 风险 2：编辑页和视频实体未完全绑定

影响：

- 详情页到编辑页的映射可能暂时还是按 `projectId`

建议：

- 在视频实体中补充 `sourceType` 和编辑映射关系

## 风险 3：状态更新链路未打通

影响：

- 列表状态、详情状态、编辑状态可能不同步

建议：

- 所有状态变更以视频实体为准，不要前端自己长期推断

---

## 25. 最终结论

如果目标是“视觉和业务都还原”，正确做法不是继续修补当前项目详情页，而是：

- 保留现有项目管理页做项目列表
- 新增项目视频列表页
- 新增视频详情页
- 把视频升级成独立业务实体
- 补独立的列表、详情、创建、发布、删除接口

只有这样，才能真正实现：

- 视觉像你上传的图
- 业务也与图中的语义一致

这套方案是一次**模块级升级**，不是简单页面改版。
