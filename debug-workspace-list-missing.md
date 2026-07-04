# Debug Session: workspace-list-missing
- **Status**: [OPEN]
- **Issue**: 个人面板和侧栏未显示完整空间列表，个人空间和多个团队缺失，切换到团队空间后数据看板显示暂无权限。
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-workspace-list-missing.ndjson

## Reproduction Steps
1. 登录系统，打开任意已登录页面。
2. 点击右上角头像，观察“切换空间”列表是否只显示当前空间。
3. 点击左侧“团队”进入空间数据看板，观察是否出现“当前身份暂无查看权限”。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | `loadWorkspaces()` 请求失败，前端静默回退到 `authSession.workspaces`，而会话里只带当前空间 | High | Low | Pending |
| B | `/api/v1/workspaces` 返回结构不是数组或 `items`，被 `extractPageItems()` 解析成空数组 | High | Low | Pending |
| C | `switchWorkspace()` 只改了 `activeWorkspaceOverrideId`，没有同步刷新当前空间的 `currentMember`，导致权限误判 | High | Low | Pending |
| D | `authSession.workspaces` 本身只有单个当前空间，导致个人面板与侧栏都展示不全 | Med | Low | Pending |
| E | 个人面板渲染前 `workspaces` 实际完整，但被组件层额外筛选或滚动截断 | Low | Low | Pending |

## Log Evidence
- `.dbg/trae-debug-log-workspace-list-missing.ndjson:1-2,5`
  - `loadWorkspaces failed`
  - `status: 500`
  - `message: 请求失败 (500)`
- `.dbg/trae-debug-log-workspace-list-missing.ndjson:3-4`
  - `workspaceId: 1`
  - `currentWorkspace: { id: 1, name: "dev" }`
  - `currentMember: null`
  - `currentRole: ""`
  - `canViewDashboard: false`

## Verification Conclusion
- **A Confirmed**: `loadWorkspaces()` 运行时直接失败，未拿到完整空间列表。
- **B Not Reached**: 由于接口先返回 `500`，本轮尚未进入“返回结构解析错误”的验证阶段。
- **C Confirmed**: 数据看板权限判断时，`currentMember` 为 `null`，当前角色为空，因此页面显示“暂无查看权限”。
- **D Highly Likely**: 修复后界面仍只显示 `dev`，说明当前会话可用的空间源依旧只有当前空间；即便前端合并会话空间与已加载空间，也没有额外团队可展示。
- **E Rejected**: 目前没有证据表明列表在 UI 层被截断；核心问题已出现在数据加载层。
