# 无限画布接入 DeepAgentStudio

本组件位于 `src/components/director/`，独立验收入口为 `/director`。它是直接渲染的 React 组件，不使用 iframe。无限画布宿主负责位置、显隐和画布数据加载，组件负责对话、历史、模型/Skill/模式选择、上传、审批、任务、文档和结果展示。后端负责 MCP 授权、生成、计费、持久化与节点写入。

## 1. 最小接入

```tsx
import { useCallback, useState } from 'react'
import DeepAgentStudio from '@/components/director/DeepAgentStudio'
import type { DeepAgentStudioProps } from '@/components/director/DeepAgentStudio'

interface Props {
  userId: number
  workspaceId: number
  canvasId: number
  // 用宿主现有的画布读取流程刷新节点和连线；不得直接覆盖未保存编辑。
  onRefreshCanvas: (canvasId: number, revision: number) => void
}

export function CanvasAgentDock({ userId, workspaceId, canvasId, onRefreshCanvas }: Props) {
  const [open, setOpen] = useState(true)
  const onCanvasChange = useCallback<NonNullable<DeepAgentStudioProps['onCanvasChange']>>(
    snapshot => {
      // 历史会话可能属于另一张画布；不要把它的节点灌进当前画布。
      if (snapshot.id !== canvasId || !Number.isSafeInteger(snapshot.revision)) return
      onRefreshCanvas(canvasId, snapshot.revision)
    },
    [canvasId, onRefreshCanvas],
  )

  return (
    <>
      <aside
        hidden={!open}
        className="canvas-agent-dock nodrag nopan nowheel"
        onPointerDown={event => event.stopPropagation()}
        onWheel={event => event.stopPropagation()}
        onKeyDown={event => event.stopPropagation()}
      >
        <DeepAgentStudio
          key={`${userId}:${workspaceId}:${canvasId}`}
          apiBase="/agent-studio"
          workspaceId={workspaceId}
          canvasId={canvasId}
          onCanvasChange={onCanvasChange}
          onCollapse={() => setOpen(false)}
        />
      </aside>
      {!open && <button onClick={() => setOpen(true)}>打开导演</button>}
    </>
  )
}
```

```css
/* 放在画布视口容器内；视口容器需要 position: relative。 */
.canvas-agent-dock {
  position: absolute;
  right: 20px;
  bottom: 20px;
  width: min(400px, calc(100% - 32px));
  z-index: 30;
}
.canvas-agent-dock[hidden] { display: none; }
```

收起仅改变 `hidden`，不卸载组件，不停止后台任务，不清空草稿。仅在业务登录完成后挂载；退出登录时卸载组件。切换账号、workspace 或 canvas 时改变 `key`，清理上一个视图的草稿与订阅；历史会话仍保存在服务端。不要每次收到节点更新就改变 `key`。画布快捷键也应忽略输入框以及导演弹层中的事件；弹层使用 Portal，宿主不能只靠 DOM 父子关系判断。

## 2. Props 契约

| 参数 | 类型 | 行为 |
| --- | --- | --- |
| `apiBase` | `string`，默认 `/agent-studio` | 只允许同源路径，不能传远程完整 URL、token 或查询串。 |
| `workspaceId` | `number`，可选 | 站内画布的真实空间 ID；与 `canvasId` 同传时默认复用业务登录。后端校验成员资格，不信任前端传值。OAuth 模式下仅校验已有授权是否匹配。 |
| `canvasId` | `number`，可选 | 站内必须传真实业务画布 ID，所有会话读写限制在当前画布。不是项目 ID 或前端 UUID。OAuth 独立模式省略时由后端创建/沿用画布。不能迁移历史会话。 |
| `authMode` | `business` 或 `oauth`，可选 | 同时有 workspace/canvas 时默认 `business`，否则默认 `oauth`。显式 `business` 必须同时有两个有效 ID。登录失败不回退 OAuth。 |
| `onCanvasChange` | `(snapshot) => void` | 收到会话画布视图时通知宿主，见下文。不是写入请求，也不代表所有内容通过质量检查。 |
| `onCollapse` | `() => void` | 用户点击收起；由宿主保存显隐状态。 |
| `className` | `string` | 组件根容器的附加样式类。CSS Module 不修改业务画布的全局样式。 |

组件没有 `onNodeFocus`、外部受控 `runId` 或注入原始 MCP tools 的接口。不要按不存在的接口接入。若需要点击聊天素材定位节点，应新增显式回调并测试，不通过监听内部 DOM 猜测资产或节点。

## 3. 画布事件不是可直接覆盖的业务画布快照

实际 `onCanvasChange` 数据示例：

```json
{
  "id": 40,
  "title": "制作画布",
  "revision": 28,
  "nodes": [
    {
      "id": "业务element_id",
      "kind": "video",
      "title": "镜头01",
      "x": 400,
      "y": 80,
      "width": 340,
      "height": 400,
      "asset_id": 3706,
      "status": "succeeded",
      "url": "https://example.invalid/signed-media-url"
    }
  ],
  "refreshed_at": 1793940000,
  "media_urls_ephemeral": true
}
```

这是后端 `Production.get_canvas()` 输出的**展示投影**。它包含当前画布非连线节点的展示字段，但过滤了 edge，也不包含原始节点完整 payload。早期绑定状态还可能只有 `id/title/revision`。禁止直接 `setNodes(snapshot.nodes)` 后把这个对象保存回业务画布，否则会丢失连线和其他字段。

推荐宿主按 `id/revision` 使现有画布缓存失效，再使用业务画布原有完整读取/分页协议加载节点、连线和修订号。刷新时保留本地视口、选中项和未提交拖动；存在本地未保存修改时走原有冲突合并流程。相同修订的重复通知不得追加重复节点；较旧修订不能覆盖新画布。URL 是短期签名，不是资产身份；以 `asset_id`/`element_id` 关联数据，不持久化签名 URL。

Agent 已在后端将制作文档、任务、图片和视频写入绑定画布。前端收到事件后仅同步展示，不能为同一结果再次创建业务节点。手动“同步画布”走既有后端修订/幂等校验，不绕过冲突。

## 4. 会话、实时通道与交互

组件已实现以下请求，宿主无需重复监听或提交：

| 请求（相对 `apiBase`） | 用途 |
| --- | --- |
| `GET /` | 初始化 HttpOnly Studio 会话 cookie |
| `GET /api/state`、`GET /api/catalog` | 历史、绑定空间、可用模型和公开 Skill 元数据 |
| `POST /api/connect` | 仅 OAuth 模式获取授权地址；站内模式不会调用，也拒绝此操作 |
| `POST /api/runs` | 新消息/后续轮次，包含 `selection`、Skill 名、附件引用和可选 `canvas_id` |
| `GET /api/runs/{id}` | 恢复事件、文档、批次、待确认内容、费用和 cursor |
| `WS /api/runs/{id}/ws?after={cursor}` | 订阅持久事件；断线续读，不重提生成 |
| `POST /api/runs/{id}/resume` | 回答、审批或恢复；审批绑定 `decision_id` |
| `POST /api/runs/{id}/stop` | 停止后续步骤，已提交任务可能继续结算 |
| `GET /api/runs/{id}/assets/{assetId}` | 刷新本会话素材链接，不生成素材 |

手动模式使用真实审批卡；自动模式允许当前授权内自动调用，必要缺失信息仍可提问。任务失败和结果未知不是一回事：断线只恢复读取，失败媒体重试要显式申请和确认，不由宿主自动点击“重试”。`complete` 表示本轮结束，不代表整部剧已完成或质量验收通过。

`RUN_STATE` 更新执行状态；`ACTIVITY_SNAPSHOT` **替换**费用快照；事件按稳定 ID upsert，cursor 旧帧被忽略。费用不能把旧帧反复累加；预留与实际结算分别展示。当前文本通过已完成消息和进度事件反馈，没有 token delta 时不伪造打字流。

上下文圆环只提供 hover/键盘聚焦提示，不打开详情弹窗。读取 `GET run.context`，并通过 `MESSAGE_UPSERT kind=context` 更新；旧回执缺少容量时，只允许用相同 `model_id` 的目录容量补齐。后端优先读取 `params_schema.context_profile.max_input_tokens`，否则精确匹配已核对的官方型号（GPT-5.6 Terra 为 1,050,000 tokens，[官方说明](https://developers.openai.com/api/docs/models/gpt-5.6-terra)）。有真实 `input_tokens` 回执时，用容量减去本次输入及已报告的输出计算剩余比例；不是累计 token，也不是下一次请求的精确预测。未知型号不套用其他型号容量。`status=compacting` 时显示“正在整理上下文”。

用户会话与后台执行轮次分离：`GET /api/state` 每个 `conversation_id` 只返回最新执行 `id`，标题沿用会话首轮；分页按会话计数。续聊仍提交 `previous`，它必须是最新轮，否则返回 409。`GET /api/runs/{id}` / 流首帧携带 `history_events`，前端按 `[...history_events, ...events]` 展示，历史事件 ID 带原轮次前缀；当前轮的流式更新仅更新 `events`，费用快照只结算当前轮。历史文档、素材及审批原记录保留；模型继承原对话和既有压缩摘要，不重新总结计费。只有点击新建、不传 `previous` 时开始独立会话。

压缩回执仍为 `cost` 事件，`data.tool=model.generate_text`、`data.purpose=context_compaction`，在对话中显示“整理上下文”，纳入现有实际费用快照，不另加固定压缩费。压缩摘要内容不渲染在用户聊天；剧本、素材与审批的原始记录由后端保留。

工具卡只显示人类可读的用途、状态、实际费用与 token 回执，不展开原始请求/响应 JSON。审批卡显示创作描述、时长、清晰度、声音与参考素材数量，批准时原样提交后端冻结的 `arguments` 与 `decision_id`。修改意见走回复/重新规划，不允许直接编辑幂等键、空间或工具代码。

## 5. 本地联调与部署边界

本地启动 Studio 时允许当前前端 origin，例如：

```sh
uv run agent-studio/run.py --mcp-url https://zzh-dev.zhongdahengrui.com --port 8090 --frontend-origin http://127.0.0.1:8080
```

上面命令在**后端仓库**运行。前端仓库现有 Vite 已代理 `/agent-studio` 到8090并启用 WebSocket，保持 Host/Origin，不要为了连通而移除校验。前端运行后访问 `http://127.0.0.1:8080/director`。实际画布 `/canvas/:id` 已挂载 `CanvasDirectorDock`，底部创作工具栏右侧、独立于工具栏外的豆豆 Logo 按需打开对话窗；收起保留草稿，切换账号/空间/画布重建实例。Agent 的 revision 通知触发现有完整增量同步，保留保存队列、冲突合并和本地未提交编辑；不直接使用聊天投影覆盖节点。没有 workspace/canvas 参数的独立 `/director` 仍通过设置连接 OAuth。嵌入画布时先在业务站登录；浏览器业务 Cookie 必须可发送到同源 `/agent-studio`，由代理转发给 Agent。Agent 的 `--mcp-url` 必须指向签发该业务会话的后端环境。本地前端连测试后端时，在本地业务登录页登录获得本地域 Cookie，仅在测试域登录不会把 Cookie 自动带给 localhost。不能把账号密码或 MCP token 写进组件配置。

推送前端 `dev` 只交付组件代码，不会自动部署 Python Agent 服务。当前 Studio 是单进程测试服务，支持显式指定的 HTTPS origin，并始终仅监听 loopback；不能直接公开 8090 端口或宣称支持生产水平扩容。线上接入需先落实服务部署、持久存储、认证会话、正确外部 OAuth 回调地址和可信 origin；反代还须支持 `/agent-studio` 的 HTTP 与 WebSocket Upgrade、保留 Origin、合理超时，并与后端 mount 一致。不得移除 Host/Origin/CSRF/权限校验来绕过部署问题。

## 6. 站内业务登录衔接

前端同时传 `workspaceId/canvasId` 即可，无需申请 MCP 授权。组件 HTTP 请求附带 `X-Agent-Auth: business`、`X-Agent-Workspace-Id`、`X-Agent-Canvas-Id`；WebSocket 使用 `auth=business&workspace_id=...&canvas_id=...`。这些只是定位信息，不是授权凭证。Cookie 使用同源发送；URL 不得放 token。

Agent 每次请求/长连接周期检查都将当前业务登录交给固定 MCP 后端的 `POST /api/v1/mcp/studio-session` 验证，后端校验真实登录、启用用户/成员、空间和有效画布。首次创建只属于该用户/空间的专用 MCP 连接，access/refresh token 留在 Agent 私有存储。后台调用继续经过原 MCP scope、套餐、余额、幂等和计费检查；建立连接本身不调用模型、不扣积分。历史列表限制为当前用户、空间和画布，不删除其他画布的会话。

专用 access token 仍走原 MCP 刷新；24 小时连接到期或撤销后，只有重新验证业务登录和画布权限，才可重新建立专用连接，原会话/素材/任务不变。并发请求共用身份锁，不重复签发。外部客户端的注册、PKCE、授权页和刷新逻辑保持原样。

业务登录 401 时只对读取请求复用宿主现有的单飞登录刷新，并最多重读一次。生成、审批和上传不自动重放。旧 WebSocket 握手 Cookie 失效时，先用当前浏览器 Cookie 读取原会话，成功才按最新 cursor 重连；真正退出/无权访问会停止并清理当前展示。用户重新登录后可在设置点击“重新检查业务登录”恢复订阅，不能自动点击“恢复执行”或重新生成。

本功能需要配套更新 **Go 业务后端、Python Agent 与 React 组件**；只推前端不会使旧后端具备该接口。无需增加配置文件，沿用现有业务登录配置、MCP URL、同源代理与 origin 参数。代理必须转发业务 Cookie 和 WebSocket 握手 Cookie；不要把所有请求强行标记为 business，也不要把 Agent 私有 MCP 凭证下发给浏览器。

## 7. 交付验收

- 已登录业务站后带 workspace/canvas 进入组件，直接可用且不出现第二次 MCP 授权；未登录、无权限或已归档画布无法建立连接。
- 登录续期、长连接重建、专用连接到期、切换账号/空间/画布均不串会话；仅持 Studio Cookie 不能绕过业务登录。
- 独立入口和外部客户端仍走 OAuth；错误 workspace 无法发起任务。
- 新建、历史切换、收起/恢复，草稿和后台任务行为符合上述约定。
- 选择 Banana Pro / Seedance2.5、Skill 与模式；未选 Skill 不泄露内置提示词。
- 人工批准/拒绝绑定原 `decision_id`；网络结果不明确时不重复提交。
- 文档按当前 revision 展示/编辑，冲突不静默覆盖；素材签名失效可以刷新。
- 事件重复、断线重连、切换会话不重复计费、不串会话。
- Agent 加节点后画布重新加载完整业务数据，原连线和用户已有节点不丢失。
- 移动窄屏和短窗口不遮挡发送、审批与四个空态入口；弹层不触发画布拖动。

组件回归测试：`tests/directorStudio.test.tsx`。本次实测使用已有会话和媒体，不重新付费生成。独立预览页与嵌入模式共用同一组件；原 `/agent` 功能保持独立。

pro 测试站：`https://zzh-dev.zhongdahengrui.com/canvas`；独立 OAuth 入口 `/director`。线上代理必须保持业务 Cookie、Host/Origin 与 `/agent-studio` 路径，普通请求128KiB、附件10MiB。HTTPS下Studio Cookie为Secure且限定mount路径。测试服务单进程、状态独立持久化，不复制本地账号token。

### 豆豆状态与动效

欢迎页展示持续呼吸、眨眼的豆豆；进入会话后在状态栏展示紧凑版本。表情由现有 run 状态、批次节点和任务回执驱动，包括思考、素材生成/合并、待确认、完成、暂停、异常及实时连接中断，不解析聊天文案，不新增接口调用或计费。任务回执以时间戳判新旧，合并使用独立的 `merge_id`。

豆豆是自动播放的状态形象，没有点击暂停、悬停提示或背景框。面板收起、离开可见区域或浏览器页面隐藏时自动暂停；系统开启减少动态效果时显示静态表情。DeepAgentStudio 宿主无需传入新的属性或管理动画定时器。画布的 CanvasDirectorDock 由 opened/onCollapse 控制显隐，CanvasFloatingToolbar 的 onToggleDirector/directorOpen 负责入口；账号、空间与画布绑定保持隔离。


### 画布底部布局

`CanvasBottomBar` 统一布局视图控制与创作工具，按实际可用宽度（包含用户界面缩放）自动分行，避免两组独立绝对定位互相覆盖。`CanvasFloatingToolbar` 的豆豆入口是工具栏旁的独立圆形按钮。左侧仅常驻整理画布、小地图、连线、磁吸和真实缩放百分比，顺序固定。百分比点击直接回到 100%，不增加菜单；其余入口从本区域隐藏。图标几何参考 LibTV 实际页面，整理按钮复用现有可撤销的 arrangeNodes，不触发生成或计费。

### DoDo Agent 附件与弹层

- 用户界面统一使用 `DoDo Agent`；模型仍在“模型”面板选择，输入区不重复展示图片/视频模型标签。
- 输入框“＋”打开本地上传/素材库菜单。本地上传仍走原附件接口；素材库按图片、视频、音频分页读取当前绑定空间，选择后复用原资产 ID，不重新上传或生成。文档继续使用本地上传解析。
- `GET /agent-studio/api/library?type=image&offset=0` 返回 `{items,total}`，每页 30 项；`POST /agent-studio/api/attachments/library` 接收 `{asset_ids:[...]}`，返回 `{attachments:[...]}`，最多 8 项。组件继续发送业务空间/画布请求头及同源会话，外部连接继续使用既有 OAuth 会话。
- 服务端逐项执行 MCP `asset.get` 校验后整体登记附件；以账号、空间、资产派生稳定附件 ID。附件在送入模型前按资产 ID 去重，上传和素材库选择同一图片也只引用一次。
- 模型、Skill、模式及附件菜单的 body portal 层级为 1600，高于画布面板 1200 和底部菜单 1450。宿主调整层级时必须同时检查这些弹层；原生 dialog 使用浏览器顶层。关闭弹层不丢草稿，取消素材选择后迟到响应不会回填。

### 对话与实时进度

对话正文由 `assistant` 事件提供，原样按 Markdown 展示。不要把工具回执或费用记录替换成回答正文。`model.generate_text` 的 `cost` 事件展示紧凑的“正在思考 / 思考”状态；积分保留在可展开明细和本轮费用中，token 与任务编号不在聊天正文展示。

目前 WebSocket 传输的是持久化事件和任务状态；推理任务完成后才产生完整 `assistant` 正文，并非上游 token delta。不要用打字动画冒充模型文字流式返回。恢复连接沿用事件游标，不重新提交推理或媒体任务。

### 当前发布状态（2026-11-06）

本次发布暂时隐藏无限画布的 DoDo Agent。`CanvasView` 中 `showCanvasDirector=false` 同时关闭独立入口和 `CanvasDirectorDock` 挂载，不创建 Agent 会话或免授权连接。组件与独立调试页保留，历史会话不删除；下一版本恢复时统一打开此开关。


### 刷新与当前会话

页面在当前浏览器标签页的 `sessionStorage` 中只记录当前会话 ID。`GET /api/state` 返回的 `session_scope` 由服务端依据已认证的账号、工作空间、MCP 资源和站内画布生成；它只是界面隔离标识，不是授权凭证。React 组件额外按 API 地址与画布隔离。

刷新后读取原会话快照并重新订阅已有进度，不调用发送、恢复执行或生成接口。点击“新建会话”移除当前选择，再刷新仍为空白；历史会话继续保留。不可访问的会话（403/404）会移除本地选择，暂时的网络错误保留选择供刷新重连。浏览器禁用存储时聊天仍可用，但不能记住选择。此功能不在浏览器存放消息正文、素材或 token；关闭标签页后的跨设备恢复请使用历史记录。
