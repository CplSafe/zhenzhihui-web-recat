# zhenzhihui-web-react

帧智汇 Web 前端 —— React 版本。由 [Vue 3 项目](https://github.com/CplSafe/zhenzhihui-web-recat) 迁移而来，技术栈 **React 18 + TypeScript + Vite**，做图文/视频 AIGC 生成。

## 技术栈

| 能力 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| 构建 | Vite 6 |
| 路由 | react-router v7（data router） |
| 状态 | Zustand |
| UI 组件 | Ant Design 5 |
| 拖拽 | dnd-kit（分镜 / 时间线） |
| 富文本 | @tiptap/react |
| Markdown 渲染 | streamdown |
| 视频播放 | plyr-react |
| 二维码 | qrcode.react |

## 本地开发

```sh
npm ci          # 需要 Node 20+
npm run dev     # 启动开发服务器（含 /api /auth /deepauth 代理）
```

如需指定监听地址：`npm run dev -- --host <ip> --port <port>`。

### 后端代理

开发代理目标默认 `http://localhost:9000`（业务）/ `http://localhost:8080`（DeepAuth）。
连真实后端时在项目根创建 `.env`（参考 [.env.example](.env.example)）：

```sh
VITE_ZZH_REMOTE_ORIGIN=https://your-business-host
VITE_DEEPAUTH_REMOTE_ORIGIN=https://your-deepauth-host
```

## 质量检查

```sh
npm run typecheck   # tsc -b（类型检查）
npm run lint        # eslint（错误会失败；迁移期 any/exhaustive-deps 为 warning）
npm run build       # tsc -b && vite build
```

CI（[.github/workflows/ci.yml](.github/workflows/ci.yml)）在 push / PR 到 `main` 时执行 typecheck + lint + build。

## 目录结构

```
src/
  api/          业务 / 鉴权 API 客户端（框架无关，逐字移植自 Vue 版）
  assets/ img/  图片资源
  auth/         AuthContext（会话初始化 / 登录登出）
  components/   组件（auth / billing / layout / creative / material / resource / space / team）
  composables/  自定义 hooks（useToast / useBilling / useStoryboardGeneration 等）
  router/       react-router 路由表
  stores/       Zustand stores（workspaceSession / materialLibrary / ui）
  styles/       全局 CSS（框架无关，原样复用自 Vue 版）
  utils/        纯逻辑工具
  views/        页面（Login / CreativeScript / CreativeEntry / Workbench / Project / Resource）
```

## 迁移说明与已知事项

完整的 Vue→React 映射、约定、逐文件状态与待复核事项见 [MIGRATION.md](MIGRATION.md)。要点：

- `src/api/*.ts` 顶部使用 `@ts-nocheck`（逐字移植的框架无关 JS，完整类型化为后续增量工作）。
- `streamdown` 内含 shiki / mermaid，按需懒加载为独立 chunk，首屏不受影响但产物体积偏大。
- 运行时尚未对接真实后端做全流程走查，建议接后端后逐页验证。
