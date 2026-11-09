# 代码治理基线与候选清单

基线：2026-11-09，`db4d27a9984f4204e2dacf9d5eb263255da84586`。本记录是治理前快照；不代表当前主干或所有业务场景已通过验收。

## 规模和检查

- `src` 下 TS、TSX、CSS、Less：631 个文件、约 215,200 行；43 个文件超过 1,000 行。
- 规模最大的业务页面：`CanvasView.tsx` 12,713 行、`SmartCreateView.tsx` 9,601 行、`HotCopyCreateView.tsx` 5,481 行。大文件不等于死代码。
- 现有 `@ts-nocheck`：7 个 API 文件；类型债按仓库约定逐步处理。
- `npm run typecheck`、`npm run test:e2e:typecheck`：通过。
- `npm run test:typecheck`：失败，现有 `tests/directorStudio.test.tsx` 包含 Node 类型、ES 库及 Testing Library 查询参数类型错误。
- `npm run format:check`：失败，报告 `src/utils/canvasPullLoop.ts`、`tests/unit/canvasPullLoop.test.ts`、`temp-probe1440.cjs`。
- Chromium 生产构建基线：`frontend-gate verify e2e/authenticated-routes.spec.ts e2e/workspace-switch-isolation.spec.ts` 为 10 通过、4 失败。部分失败因 `PersonalPanel.pickWs` 切到团队后主动导航 `/team`，爆款复刻另有入口预期失败。证据：`test-results/frontend-gate/64bd5e98-6b97-4975-a916-00016221dcf9/`。用户随后明确普通切换不应进入团队看板，已按此修正；回归使用明确的编辑入口，并隔离测试夹具中与该场景无关的硬编码模板媒体，不放宽空间隔离断言。
- 覆盖率运行已发现重构前失败，包括 `CanvasNodePanel`、`CanvasAudioGenerator`、`CanvasVoiceLibrary`、`CanvasImageTools`、`HotCopyEntry`、`PersonalPanel`、`persistHotCopyResult`。`persistHotCopyResult.test.ts` 单独运行仍有 1 项失败；`CanvasVoiceLibrary.test.tsx` 单独运行 6 项失败。全量覆盖率和严格 lint 在运行中手动停止，因此没有完整报告，不能视为通过。未进行真实后端付费生成验证。

## 重复候选

采用忽略空行和整行注释、对跨文件相同 10 行窗口进行初筛，共发现 156 个候选窗口。相邻窗口相互重叠，不是 156 处独立重复，也不是全项目重复率；动态行为、参数和调用方仍需人工核对。

| 候选 | 位置 | 处理原则 | 风险 |
| --- | --- | --- | --- |
| 草稿版本号归一化 | `SmartCreateView.tsx` 的 `normRev`；`HotCopyCreateView.tsx` 的 `normRev` | 提取相同纯函数，保留无效值返回 `NaN` 的语义。项目初始化使用 0 兜底，不直接合并行为 | 中：涉及乐观锁 |
| 项目 / 素材记录解析 | `projectAssetAccess.ts`、`materialProjectFolders.ts` 的对象、JSON 和正整数解析 | 相同的三个纯函数集中到 `projectRecord.ts`；项目权限和素材归属判断保持各自原样 | 中：涉及素材隔离 |
| 弹窗焦点循环 | `VideoPreviewModal`、`AssetPreviewModal`、`TaskCenterDrawer`、`ImageChat`、画布预览 | 比较开启条件、焦点恢复、嵌套弹窗和 Escape 后再提取；先补关键行为验证 | 中：键盘可访问性 |
| 生成结果所有权与历史合并 | `persistVideoResult.ts`、`persistHotCopyResult.ts` | 先对照回调归属、历史版本、旧任务和冲突重试；只提取确认一致的纯判断 | 高：可能覆盖新结果 |
| 智能成片 / 爆款复刻草稿保存 | 两个创作页中的 revision、标题保存、草稿恢复 | 在现有 `creativeDraftSaveQueue` 和冲突工具基础上增量提取；保留各流程的合并策略 | 高：跨会话数据丢失 |
| 创作入口及模型目录 | `SmartEntry` / `HotCopyEntry`、两个 model catalog | 核对操作码、参数、缓存隔离和无模型行为；先抽共性纯逻辑，保留业务差异 | 中高 |
| 画布页面大模块 | `CanvasView.tsx`、`CanvasNodePanel.tsx` | 按交互、任务、同步、面板逐项拆分；保持序列化、修订和恢复契约 | 高 |

## 阶段验收

每次只修改可独立验证的边界，运行对应单元测试、类型检查、相关生产构建 Playwright 用例并查看截图；草稿和生成任务额外验证工作空间隔离、冲突、重复提交及恢复。模拟接口与真实后端结果分开报告。缺少付费测试授权时，不提交真实付费任务，并保留未验证说明。

## 已实施的首批边界

- 共享创作草稿版本号解析，保留各接口字段优先级、向下取整和无效值 `NaN`；不统一两个页面的保存及冲突合并策略。
- 共享项目和素材的对象、JSON 与标识解析，不改变访问权限或归组决策。
- 根据用户确认，普通切换团队不再自动跳转团队看板，显式查看团队数据入口保留。
- 应用类型检查、修改文件 ESLint / Prettier、5 个相关单元和组件测试文件共 34 项通过。生产构建 Chromium 模拟接口：`authenticated-routes.spec.ts`、`project-management-open.spec.ts` 和 `workspace-switch-isolation.spec.ts` 共 19 项通过；已检查切换、恢复与素材截图，验收记录 `764cc2f4-1071-4740-9ddc-e5a1ed4066fe`。这不覆盖真实后端或其他全项目基线失败。
