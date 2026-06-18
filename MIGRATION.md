# Vue → React 迁移指南

将 `zhenzhihui-web`（Vue 3 + Vite + Pinia）迁移到 `zhenzhihui-web-react`
（React 18 + TS + Vite + Zustand + react-router v7 + dnd-kit + tiptap）。

## 技术栈映射

| Vue 现状 | React 替换 | 说明 |
| --- | --- | --- |
| Vue 3 SFC | React 18 + TSX 函数组件 | |
| vue-router 4 | react-router-dom v7（data router） | `RouterView`→`<Outlet/>`；`meta.requiresAuth`→`handle.requiresAuth` |
| Pinia | Zustand | composition store → raw state + 派生纯函数 + selector hooks |
| element-plus | Ant Design (antd) | tooltip/form/input/select/button/dialog/collapse/checkbox |
| 原生 HTML5 拖拽 | @dnd-kit/core + sortable | Timeline/Storyboard/Video 面板 |
| contenteditable | @tiptap/react + starter-kit | GeneratedScriptPanel 富文本 |
| streamdown-vue | streamdown | Vercel 原生 React 版 |
| plyr | plyr-react | VideoGenerationPanel |
| qrcode | qrcode.react | BillingModal |
| composables（ref/computed/watch） | 自定义 hooks（useState/useMemo/useEffect） | |
| 全局样式 .css | 原样复用 | 框架无关，直接 import |

## 约定

- 路径别名 `@/*` → `src/*`（见 tsconfig.app.json / vite.config.ts）。
- 组件 scoped `<style>` → 同名 `.css` 文件，与组件同目录 import。
- 全局 Toast / Confirm → `src/stores/ui.ts`（zustand），顶层挂载 `<AppToast/>` `<AppConfirmDialog/>`，
  组件经 `useToast()` / `useConfirmDialog()`（`src/composables/useToast.ts`）调用。
- Vue 的 `emit('login-success')` 等父子事件 → React Context（见 `src/auth/AuthContext.tsx`）或回调 props。
- `v-model:x` → `value={x} onChange={...}` 受控 props。

## 已完成（地基，构建已验证 ✅）

- 配置：package.json / tsconfig.\* / vite.config.ts / index.html / .env.example
- `src/styles/*`、`src/assets/*`、`src/img/*`、`public/*`：原样复用
- `src/utils/*.ts`：14 个 util，逐字移植 + 少量类型标注
- `src/api/auth.ts` `src/api/business.ts`：逐字移植（**`@ts-nocheck`**，见下）
- `src/stores/workspaceSession.ts`：Pinia composition store → zustand（派生值为 `derive*` 纯函数 + `use*` selector hooks）
- `src/stores/materialLibrary.ts`：zustand
- `src/stores/ui.ts` + `src/components/AppToast.tsx` + `AppConfirmDialog.tsx`：全局 Toast/Confirm
- `src/auth/AuthContext.tsx`：会话初始化/刷新/登录登出（移植自 App.vue 脚本）
- `src/App.tsx` + `src/App.css`：根布局、跳转守卫、全局单例挂载
- `src/router/index.tsx`：7 条路由，全部 lazy 懒加载
- `src/main.tsx`：RouterProvider + antd ConfigProvider（locale zh_CN，主色 #5767e5）

## 迁移状态：全部完成 ✅（tsc 0 错误，vite build 绿，dev server 启动并服务正常）

全部 42 个视图/组件/composable 已由 15 个并行 agent + 1 个整合修复 agent 迁移完成：
- 6 视图：LoginView / CreativeEntryView / WorkbenchView / ProjectManagementView / ResourceManagementView / CreativeScriptView（3253 行）
- 28 组件：auth(4) / billing(1) / layout(3) / space(1) / team(1) / resource(2) / material(1) / creative(15)
- 8 composable → hooks：useBilling / useScriptPrompts / useStoryboardGeneration / useVideoGeneration / useTaskPolling / useTaskAbort / useAssetPreview / useWorkflowPersistence

特性库已落地：dnd-kit（Storyboard/Timeline 拖拽）、@tiptap/react（GeneratedScriptPanel 富文本）、streamdown（脚本 Markdown 渲染）、plyr-react（视频播放）、qrcode.react（支付二维码）、antd（替换 element-plus）。

### 遗留事项 / 待人工复核（不阻塞构建，影响运行时细节）
- **运行时验证未做**：build/编译/启动已通过，但未对接真实后端点击走查。建议 `npm run dev`（代理同原项目）后逐页验证生成/计费/团队等交互。
- API 两文件 `@ts-nocheck` 类型债务（见下）；少数调用点用了 `as any`。
- **streamdown 体积大**：内含 shiki/mermaid，按语言/图表懒加载为独立 chunk（mermaid chunk ~1.4MB）。如不需 Markdown 内的图表/众多语言高亮，建议后续按需裁剪或换轻量 Markdown 渲染。
- LoginView：协议同意后提交因 React setState 异步，新增了 submitXxxAfterAgree 内联路径（行为等价，略有重复），可整合去重。
- SpaceSelectPanel：展开/折叠过渡动画被省略（无 transition 依赖），如需动效需补 CSS。
- BillingModal：二维码用 QRCodeCanvas 直绘，与原 qrcode dataURL 像素级略有差异；antd Form 与 draft 同步建议复核。

## （历史）原计划待迁移清单 —— 现已全部完成

| 视图/组件 | 行数 | 依赖要点 |
| --- | --- | --- |
| LoginView + auth/(AuthHeroPanel,LoginFormCard,RegisterFormCard,AgreementModal) | ~1470 | 表单、倒计时、图形验证码、SSO |
| layout/AppLayout (+CreateTeamDialog,JoinTeamDialog) | ~1220 | 外壳、侧边栏、空间切换 |
| space/SpaceSelectPanel、team/TeamManagementModal | ~1450 | |
| CreativeEntryView、WorkbenchView | ~910 | |
| ProjectManagementView、ResourceManagementView | ~2200 | |
| creative/* 面板群（Storyboard/Timeline/Video/Script/...） | ~10000 | **dnd-kit** 拖拽、**tiptap** 富文本、**plyr-react** 播放、**streamdown** 渲染 |
| CreativeScriptView | 4251 | 主编排视图 |
| billing/BillingModal（+qrcode.react）、material/*、resource/* | ~6300 | |
| 特性 composables：useStoryboardGeneration / useVideoGeneration / useBilling / useScriptPrompts / useTaskPolling / useTaskAbort / useAssetPreview / useWorkflowPersistence | ~2800 | 随对应视图一并移植为 hooks |

## 类型债务（有意为之）

- `src/api/auth.ts`、`src/api/business.ts` 顶部 `@ts-nocheck`：逐字移植的框架无关 JS 客户端
  （动态 Error 子类字段、`= {}` 默认解构参数）。运行时逻辑与原项目一致，类型化列为后续增量工作。
- tsconfig.app.json 暂时放宽：`strictNullChecks:false`、`noImplicitAny:false`、`useUnknownInCatchVariables:false`。
  随组件迁移逐步收紧。

## 命令

```sh
npm install
npm run dev        # 开发（含 /api /auth /deepauth 代理，配置同原项目）
npm run typecheck  # tsc -b --noEmit
npm run build      # tsc -b && vite build
```
