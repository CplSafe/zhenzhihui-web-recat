# 项目管理视频列表页改版方案

## 1. 目标

基于你提供的参考图，将当前 `项目管理` 页面改造成更接近“视频库列表页”的效果：

- 顶部显示面包屑，例如：`首页 / 项目管理 / 祎悦造型（12个视频）`
- 主操作区包含：
  - 搜索框
  - 排序下拉
  - 状态筛选下拉
  - 时长筛选下拉
  - `新建视频` 按钮
- 内容区使用统一的视频卡片网格，而不是当前“我的项目 + 待归类”双分区
- 卡片信息更完整：
  - 封面图
  - 播放按钮
  - 视频时长角标
  - 标题
  - 日期 / 作者 / 更新时间等元信息
  - 状态标签
  - 更多操作按钮
- 底部增加分页器与每页条数切换

这份文档只描述实现方案，不改现有业务代码。

---

## 2. 当前页面现状

当前页面入口：

- 页面文件：`src/views/ProjectManagementView.tsx`
- 样式文件：`src/styles/project-management.css`
- 路由入口：`src/router/index.tsx`

当前页面实际上分成两块：

1. `我的项目`
2. `待归类`

现有结构更偏“项目文件夹管理”，而参考图更偏“项目内视频列表管理”。

### 当前实现与目标效果的主要差异

| 维度 | 当前实现 | 目标效果 |
| --- | --- | --- |
| 页面层级 | 项目根列表 + 项目详情 | 某个项目下的视频列表 |
| 顶部信息 | 只有标题，没有完整面包屑 | 需要明确的面包屑导航 |
| 主操作区 | 无统一筛选工具栏 | 需要搜索、排序、状态、时长、创建按钮 |
| 列表形态 | 文件夹网格 + 待归类视频 | 统一视频卡片网格 |
| 卡片信息 | 只有标题，信息较少 | 需要时间、作者、状态、时长等 |
| 数据组织 | 从项目草稿中提取视频 | 需要面向视频列表的数据模型 |
| 翻页能力 | 无分页 | 需要分页和每页条数选择 |

---

## 3. 建议的实现方式

建议把这次效果拆成两层：

### 方案 A：在现有 `ProjectManagementView` 上直接改造

适合场景：

- 继续沿用 `/projects`
- 不新增新路由
- 希望尽量复用现有数据请求与跳转逻辑

优点：

- 改动集中
- 复用当前项目数据、工作空间数据、打开编辑页逻辑

缺点：

- 当前文件已经比较大，继续叠加会让维护成本更高
- “项目文件夹模式”和“视频库列表模式”会混在一起

### 方案 B：拆成“项目列表页 + 项目视频列表页”

适合场景：

- 想让结构更清晰
- 后续会继续扩展“项目内视频管理”

建议结构：

- `/projects`：保留项目列表
- `/projects/:projectId/videos`：新增项目内视频列表页

优点：

- 与参考图语义一致
- 页面职责清晰
- 筛选、分页、统计、批量操作后续更好扩展

缺点：

- 需要新增路由、页面文件和数据解析层

### 推荐

推荐使用 **方案 B**。

原因：

- 参考图本质上不是“项目列表页”，而是“某个项目下的视频列表页”
- 当前页面已有“项目”和“视频”两种概念，继续塞在一个组件里会越来越重
- 后续如果要做“视频删除 / 发布 / 草稿 / 审核 / 搜索 / 分页 / 批量操作”，独立页面更稳

---

## 4. 需要修改哪些文件

如果按推荐方案 B 实施，建议涉及以下文件。

### 4.1 路由层

需要修改：

- `src/router/index.tsx`

建议新增：

- `src/views/ProjectVideoListView.tsx`

用途：

- 新增 `/projects/:projectId/videos`
- 从项目列表点击某个项目后，进入这个视频列表页

---

### 4.2 页面视图层

需要新增或调整：

- `src/views/ProjectVideoListView.tsx`
- `src/views/ProjectManagementView.tsx`

职责建议：

- `ProjectManagementView.tsx`
  - 只负责展示“项目列表”
  - 点击项目后跳转到项目视频页
- `ProjectVideoListView.tsx`
  - 负责渲染参考图对应的“视频库列表页”

---

### 4.3 页面样式层

建议新增样式文件：

- `src/views/ProjectVideoListView.css`

也可以复用现有文件，但不推荐继续把新样式堆到：

- `src/styles/project-management.css`

原因：

- 现有 `project-management.css` 已经同时承担项目列表、详情、弹窗、灯箱等样式
- 新的视频列表页会新增大量工具栏、卡片、分页样式
- 分开后更容易维护

---

### 4.4 数据解析层

当前数据来源主要在：

- `src/api/business.ts`
- `src/views/ProjectManagementView.tsx`

当前页面里已有一些和项目草稿解析相关的方法：

- `normalizeCreativeProjectDraft`
- `extractUnclassified`
- `parseProjectDetail`
- `extractPreviewCandidates`

如果做视频列表页，建议把“项目草稿 -> 视频卡片列表”的解析逻辑抽出来，例如：

- `src/utils/projectVideos.ts`

建议新增方法：

- `extractProjectVideos(projectDetail)`
- `buildProjectVideoCards(draft)`
- `resolveVideoStatus(video)`
- `resolveVideoDuration(video)`
- `resolveVideoPoster(video)`

这样页面层只管渲染，不需要继续在视图文件里堆数据清洗逻辑。

---

### 4.5 通用组件层

建议新增组件：

- `src/components/project/ProjectVideoToolbar.tsx`
- `src/components/project/ProjectVideoCard.tsx`
- `src/components/project/ProjectVideoPagination.tsx`

如果暂时不想拆太细，也至少建议把卡片拆出来。

原因：

- 参考图的卡片信息明显比当前卡片复杂
- 卡片会包含封面、时长、状态、作者、时间、更多菜单
- 后续很可能还会复用到“最近视频”“草稿视频”“已发布视频”等场景

---

## 5. 页面结构建议

建议新页面结构如下：

```text
ProjectVideoListView
├─ AppSidebar
├─ AppTopbar
└─ main
   ├─ Breadcrumb
   ├─ Toolbar
   │  ├─ SearchInput
   │  ├─ SortSelect
   │  ├─ StatusSelect
   │  ├─ DurationSelect
   │  └─ CreateButton
   ├─ VideoGrid
   │  └─ ProjectVideoCard[]
   └─ Pagination
```

---

## 6. 参考图对应的具体改动点

### 6.1 顶部面包屑

参考效果：

- `首页 / 项目管理 / 祎悦造型（12个视频）`

实现建议：

- 用当前项目标题 + 视频数量生成最后一段
- 面包屑数据来自：
  - 项目名称：当前 project detail
  - 视频数：解析出的 `videoCards.length`

需要准备的数据：

- `projectTitle`
- `videoCount`

---

### 6.2 工具栏

参考效果包含：

- 搜索输入框
- 排序
- 状态
- 时长
- 新建视频

建议前端 state：

```ts
const [query, setQuery] = useState('')
const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt'>('updatedAt')
const [status, setStatus] = useState<'all' | 'draft' | 'reviewing' | 'published'>('all')
const [duration, setDuration] = useState<'all' | 'short' | 'mid' | 'long'>('all')
```

建议派生数据：

- `filteredVideos`
- `sortedVideos`
- `pagedVideos`

---

### 6.3 视频卡片

参考图的视频卡片建议包含字段：

```ts
interface ProjectVideoCardItem {
  id: number | string
  title: string
  coverUrl: string
  durationText: string
  status: 'draft' | 'reviewing' | 'published'
  statusText: string
  authorName: string
  createdAtText: string
  updatedAtText: string
  videoUrl: string
}
```

当前代码里已经能拿到部分信息：

- 标题：项目标题或视频标签
- 视频 URL：`videoVersions` / `videoHistoryList` / `generatedVideoUrl`
- 封面：可以从视频首帧、缩略图、或项目草稿封面衍生

缺失项：

- 状态
- 作者
- 视频时长
- 更细的时间字段

这些字段如果后端暂时没有，可先用以下策略兜底：

- 状态：从草稿来源推断
  - 有最终视频且发布字段存在 => `published`
  - 仅本地草稿 => `draft`
  - 正在处理中 => `reviewing`
- 作者：当前登录用户昵称
- 时长：从视频元数据解析，或先落文字占位
- 时间：优先 `updated_at`，没有则回退 `created_at`

---

### 6.4 状态标签视觉

参考图中的状态标签是重点视觉之一，建议统一成三类：

- `已发布`
- `草稿`
- `制作中`

建议样式：

- `published`：绿色浅底 + 绿色文字
- `draft`：灰色浅底 + 深灰文字
- `reviewing`：橙黄色浅底 + 橙色文字

这部分需要新增卡片状态样式类，例如：

- `.project-video-card__status`
- `.is-published`
- `.is-draft`
- `.is-reviewing`

---

### 6.5 分页

参考图底部包含：

- 页码
- 上下页
- 每页条数切换（20 / 50 / 100）

建议前端 state：

```ts
const [page, setPage] = useState(1)
const [pageSize, setPageSize] = useState(20)
```

建议派生：

```ts
const total = filteredVideos.length
const totalPages = Math.max(1, Math.ceil(total / pageSize))
const currentPageItems = filteredVideos.slice((page - 1) * pageSize, page * pageSize)
```

如果后端未来支持分页，再把这一层替换成服务端分页即可。

---

## 7. 数据层需要补什么

这次视觉改版真正的难点不是样式，而是 **视频卡片的数据模型**。

当前项目里，“视频”更多是嵌在项目草稿里，不是一个独立列表资源，所以如果要做成参考图那样完整的列表，建议至少补足以下字段：

### 最理想

后端直接提供：

- `video_id`
- `project_id`
- `title`
- `cover_url`
- `duration_seconds`
- `status`
- `author_name`
- `updated_at`
- `created_at`
- `video_url`

### 如果后端暂时不改

前端可先从项目详情草稿中做一次兼容映射：

- `title`：项目标题 + 版本标签
- `coverUrl`：视频首帧或项目封面
- `durationText`：先默认 `--:--`
- `status`：根据草稿状态推断
- `authorName`：当前 workspace 用户名
- `updatedAtText`：项目更新时间

这样可以先把页面效果做出来，但长期看，还是建议后端补一个“项目视频列表”接口。

---

## 8. 推荐实施步骤

### 第一步：拆页面职责

- 保留 `ProjectManagementView.tsx` 作为项目列表页
- 新增 `ProjectVideoListView.tsx` 作为项目内视频页

### 第二步：抽视频数据映射

- 新建 `src/utils/projectVideos.ts`
- 把项目草稿里的视频数据统一转换成卡片数据

### 第三步：搭建工具栏

- 搜索
- 排序
- 状态筛选
- 时长筛选
- 新建按钮

### 第四步：实现卡片网格

- 先做静态卡片布局
- 再接入真实数据

### 第五步：补分页

- 先做前端分页
- 后面有接口再切服务端分页

### 第六步：补交互

- 点击卡片进入编辑
- 更多菜单
- 下载
- hover 态

---

## 9. 具体改动清单

如果按推荐方案落地，预计改动如下。

### 新增文件

- `src/views/ProjectVideoListView.tsx`
- `src/views/ProjectVideoListView.css`
- `src/utils/projectVideos.ts`
- `src/components/project/ProjectVideoCard.tsx`
- `src/components/project/ProjectVideoToolbar.tsx`
- `src/components/project/ProjectVideoPagination.tsx`

### 修改文件

- `src/router/index.tsx`
- `src/views/ProjectManagementView.tsx`
- `src/components/home/AppSidebar.tsx`（如果需要补菜单高亮或跳转逻辑）

### 可选调整

- `src/api/business.ts`

如果后端补接口，则这里还需要新增：

- `listProjectVideos`
- `getProjectVideoDetail`

---

## 10. 视觉实现要点

为了尽可能贴近参考图，建议注意下面几点：

- 页面背景使用浅灰而不是纯白
- 工具栏元素高度统一，约 `36px ~ 40px`
- 卡片圆角统一在 `12px ~ 16px`
- 卡片阴影保持克制，hover 时略微抬升
- 状态标签要轻，不要过重描边
- 卡片信息区上下留白要比当前页面更紧凑
- 页码区尽量靠底部右侧，与每页数量选择同行

---

## 11. 风险点

### 风险 1：后端没有“视频列表”概念

影响：

- 页面能做出来，但筛选与分页本质上是前端本地计算

建议：

- 第一阶段先前端做映射
- 第二阶段补服务端接口

### 风险 2：视频时长和封面不稳定

影响：

- 卡片展示可能不完整

建议：

- 封面优先用已有缩略图或项目封面
- 时长先允许占位

### 风险 3：现有 `ProjectManagementView.tsx` 体积过大

影响：

- 继续堆逻辑会加重维护难度

建议：

- 新页面、新样式、新 utils 分拆

---

## 12. 验收标准

完成后，页面至少应满足：

- 能从项目列表进入项目视频列表页
- 顶部能正确显示面包屑与视频数量
- 工具栏包含搜索、排序、状态、时长、新建视频按钮
- 视频卡片展示封面、标题、时长、状态、基础元信息
- 列表支持分页
- 点击视频卡片可以继续进入编辑页
- 视觉风格整体接近你给的参考图，而不是当前的“文件夹管理页”

---

## 13. 结论

这套效果不是简单“改几个样式”就够，核心上需要把页面语义从：

- `项目列表 / 项目详情`

调整成：

- `项目列表 / 项目内视频列表`

也就是说，**最重要的不是 CSS，而是页面职责和视频数据模型的重组**。

如果你认可这个方向，下一步我可以继续为你产出：

1. 更具体的页面线框稿说明
2. 精确到组件级别的开发任务拆分
3. 直接可执行的实现计划文档
