# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

帧智汇 (zhenzhihui) web frontend — a React 18 + TypeScript + Vite app for image/video AIGC generation. It was migrated **verbatim** from a Vue 3 + Pinia project (see `MIGRATION.md`); much of the code intentionally mirrors the Vue structure, which explains some idioms (loose `any` typing, `derive*` pure functions standing in for Vue `computed`, `@ts-nocheck` API clients). UI text and comments are in Chinese.

## Commands

```sh
npm ci              # install (Node 20+; see .nvmrc)
npm run dev         # Vite dev server with /api /auth /deepauth proxies
npm run typecheck   # tsc -b --noEmit
npm run lint        # eslint (lint:strict fails on warnings)
npm run format      # prettier --write .
npm run build       # tsc -b && vite build
```

Tests use **Vitest + Testing Library + MSW** (jsdom) under `tests/` — `tests/unit/` (pure logic, API clients) and `tests/component/` (rendered components), with shared MSW handlers in `tests/mocks/` and global setup in `tests/setup.ts`. Playwright browser flows live under `e2e/`.

```sh
npm test                    # unit + component tests (vitest run)
npm run test:typecheck      # tsc -p tsconfig.test.json
npm run test:coverage       # gated critical-module coverage
npm run test:coverage:all   # full-source coverage floor
npm run test:e2e            # production build + Chromium
npm run test:e2e:mobile     # mobile Chromium + mobile WebKit
```

Coverage is gated in **two tiers** (`vitest.config.ts` + the `test:coverage:all` flags): a strict per-file floor over an explicit allowlist of critical modules, and a looser global floor over all of `src/`. When you add regression tests for a business flow, add that module to the `coverage.include` allowlist rather than relying on the global floor.

CI (`.github/workflows/ci.yml`, push/PR to `main`) runs: `audit:ci` → `format:check` → app/test/e2e typechecks → `lint:strict` → gated + full coverage → `build` → `check:bundle` (client bundle policy) → Playwright across chromium/firefox/webkit/mobile-chromium/mobile-webkit. Husky + lint-staged run `eslint --fix` + `prettier` on staged `*.{ts,tsx}` pre-commit.

### Backend proxy / env

`npm run dev` proxies to a backend. Defaults: business API `http://localhost:9000`, DeepAuth `http://localhost:8080`. To point at a real backend, create `.env` (see `.env.example`):

```sh
VITE_ZZH_REMOTE_ORIGIN=https://your-business-host
VITE_DEEPAUTH_REMOTE_ORIGIN=https://your-deepauth-host
```

The proxy in `vite.config.ts` strips the `Origin` header, rewrites Set-Cookie domains, and fixes up OAuth redirect `Location` headers so SSO callbacks return to the dev origin. Proxy prefixes: `/api`, `/auth`, `/zzh-api` (→ business), `/deepauth` (→ DeepAuth).

## Architecture

Request flow: **views** orchestrate UI and call **composables** (feature hooks) and **api** clients; cross-cutting state lives in **Zustand stores**; pure logic lives in **utils**.

- **`src/api/`** — `business.ts` (2800+ lines; AI task submit/poll, asset management, project CRUD, version history, billing/wallet, storage upload) and `auth.ts` (login/register, SMS codes, sessions, DeepAuth QR login, team invites). Both are framework-agnostic clients ported verbatim and carry `@ts-nocheck` at the top — **intentional type debt**, see "Conventions". All requests go through a shared `requestJson` error handler. `business.ts` includes an upload-host allowlist (`ALLOWED_UPLOAD_HOST_PATTERNS`) guarding against redirect-to-internal-host attacks — keep it when touching upload code. The **智能成片 2.1** flow (see below) added focused clients alongside these: `smartScript.ts` (streaming shot-script gen), `smartShotImage.ts` (shot image gen + asset persistence + the shared `ensureAssetId`/`refreshAssetUrl`), `smartVideo.ts` (full-video gen, timeline prompt), `smartFaceBlur.ts`, `aiPolish.ts` (prompt/name polishing), `hotCopy.ts` (爆款复制 / `video.replicate`), plus `projectVideos.ts`, `banners.ts`, `templates.ts`, `feedback.ts`, `aiResponses.ts`. Later flows added `canvasApi.ts` (无限画布 `/api/v1/canvases`: list/create/detail, incremental element sync with `base_revision` optimistic locking — 409 means refetch `after_revision` and merge), `realPeople.ts` (真人素材 `/api/v1/real-people`, reuses `business.ts` auth + error handling), `communityIp.ts` (首页 IP 创作者 / 需求市场), and `requestTimeout.ts` (shared AbortSignal + timeout merging, `DEFAULT_API_REQUEST_TIMEOUT_MS`).

- **`src/auth/AuthContext.tsx`** — session bootstrap/refresh/login/logout via React Context (ported from `App.vue`). `App.tsx` (`AppShell`) is the root layout and holds the **central auth guard** keyed off each route's `handle.requiresAuth`. The browsable pages (`/home`, `/templates`, `/smart`, `/hot-copy`) are marked `requiresAuth: false` so they render for guests; actions that need a session call `useRequireAuth()` to gate just that action. Everything not explicitly marked `requiresAuth: false` requires a session — see the router bullet for the split. App entry is `/home` (index redirects there for users with a local session marker, `/welcome` otherwise; unknown paths fall back to `/home`). Once the first session check succeeds, background refreshes no longer unmount the page — otherwise an in-flight click would be lost to a loading flash.

- **`src/stores/`** (Zustand) — `workspaceSession.ts` (auth session, workspace list/switching, members, wallet, billing, app init), `ui.ts` (global toast/confirm + the 「功能待开放」 dialog via `openComingSoon`, plus the member-center / team-manage / join-team modal flags), `taskCenter.ts` (persisted cross-page state for 智能成片 / 爆款复制 / 图片 generation tasks — progress, results, failures; persisted per account and stripped of signed media URLs, which are re-resolved from project data after reload) and `guide.ts` (新手引导 spotlight steps; rendered by `components/guide/GuideOverlay.tsx`). Pattern from the Pinia migration: raw state fields + `derive*` **pure functions** for computed values + `use*` **selector hooks** for components. Non-reactive `let` closures from Pinia stores became module-level variables.

- **`src/router/index.tsx`** — react-router v7 data router, all pages `lazy`-loaded, with a `RouteErrorBoundary` that catches failed lazy chunks instead of white-screening. Guest-browsable (`requiresAuth:false`): `/welcome`, `/login`, `/home` (entry), `/templates`, `/smart/:id?`, `/hot-copy` + `/hot-copy/:id`, `/workspace-switch`, `*` → `/home`. Auth-required: `/real-person-video/:id?` (→ `SmartCreateView` with `flowMode="real-person"`), `/projects`, `/projects/:projectId/videos`, `/projects/:projectId/videos/:videoId`, `/resources`, `/team` (→ `SpaceDashboardView`), `/canvas` + `/canvas/:id`, and `/distribution` (additionally gated by `useDistributionAccess` — direct links are bounced to `/home` unless the backend confirms 分销 access). (The old legacy-creative `/creative*` and `/workbench` routes were removed — see MIGRATION.md.)

  The two creation routes wrap their views in **route-session** logic (`resolveSmartRouteSession` / `resolveHotCopyRouteSession`): the `/smart` → `/smart/:id` replace that follows first project creation must **keep the view mounted** (in-flight script / image / asset requests would otherwise lose their receiver), while switching projects, switching workspaces, or an explicit new-session navigation bumps a `version` used as the React `key` to force a clean remount. Touch this only with that invariant in mind.

- **`src/views/`** — the live generation pipelines:
  - **智能成片 2.1**: `SmartCreateView.tsx` (~10k lines) drives the pipeline — 营销思路拆解 (optional) → 分镜脚本 → 主体素材生成 → 镜头编排 → 整片视频生成 — backed by the `src/api/smart*` clients and `src/components/smart/**`, with history-version switching, segment re-edit, regenerate and download. The same view serves **真人成片** via the `flowMode="real-person"` prop. Drafts persist to both localStorage and backend (project-resolve + `draft_revision` optimistic-concurrency save chain is inlined in the view; see `doPutDraft`/`fetchRevision`).
  - **爆款复制**: `HotCopyCreateView.tsx` (~5k lines) is its sibling that feeds `video.replicate` (source video + 1–9 subject images → one-shot video).
  - **无限画布**: `CanvasListView.tsx` (per-workspace canvas list: create / delete / open) and `CanvasView.tsx` (~2.8k lines) — a **React Flow** (`@xyflow/react`) node-and-edge graph for composing AI generation pipelines, with `components/canvas/**` (node panel, floating toolbar, history panel, material picker) and `utils/canvas*.ts` (element ⇄ nodes/edges serialization, draft, generation, model params, structured text, task state) as its pure layer.
  - Other views: `HomeView` (entry + history), `TemplatesView` (模板库), `ProjectManagementView` + `ProjectVideoListView`/`ProjectVideoDetailView` (项目管理), `ResourceManagementView` (素材市场), `SpaceDashboardView` (团队数据看板, `/team`), `DistributionView` (邀请返利明细), `LoginView`, `SplashView`. **Note:** `SmartCreateView`/`HotCopyCreateView` still call `api/*` directly and each **inline** their own project-resolve + draft-save chain (no shared headless hook) — the largest open architecture debt. A `useCreativeProjectBackend` composable once held this but drifted out of use and was removed; if the two views are ever unified, re-extract from their live inline logic rather than resurrecting the stale file.

- **`src/composables/`** — feature hooks: `useAssetPreview`, `useRequireAuth` (gate an action behind login), `useSidebarNavigate` (shared `<AppSidebar>` routing), `useSwr` (lightweight cached fetch), `useToast`/`useConfirmDialog` (wrap the `ui` store), `useGenerationModelCatalog`/`useHotCopyModelCatalog` (workspace-scoped `/api/v1/ai/models` catalog → model-picker data; the frontend only maintains the stage → `operation_code` mapping), `useSafeWorkspaceSwitch` (unmount creation views before switching, so drafts are never mis-written across workspaces), `useWorkspaceMemberAccess`, `useDistributionAccess`, `useLogout`, `useLatestCallback`, `useBackgroundVideoSound`.

- **`src/components/`** — grouped by domain: `auth`, `layout` (`AppTopbar`), `home` (`AppSidebar`, `SidebarTeamGroup`), `smart` (the 智能成片 step UIs — each in its own subfolder, CSS Modules + Less), `hotcopy` (爆款复制 step UIs), `canvas` (无限画布 panels/toolbars), `task` (`TaskCenterCoordinator` + `TaskCenterDrawer`), `team` (team-manage / join-team modals), `guide` (`GuideOverlay`), `distribution`, `common` (small shared widgets: `AiBadge`, `InlineEdit`, `EllipsisText`, `VideoPreviewModal`, `Markdown`, `DraftSaveIndicator`, `HelpCenter`), `material` (`MaterialLibraryPicker`), `resource`. Global singletons are mounted once in `AppShell` and all lazy-loaded behind their open flag: `AppToast`, `AppConfirmDialog`, `ComingSoonDialog`, `MemberCenterModal`, `GlobalTeamManageModal`, `GlobalJoinTeamDialog`, `GuideOverlay`, `TaskCenterCoordinator` (restores in-flight AI video tasks after a reload) and `HelpCenter` (draggable 帮助中心 floating ball, shown only on authenticated non-login pages).

Key libraries: **antd** (UI, replaces element-plus; locale zh_CN, primary color `#5767e5` set in `main.tsx`), **@xyflow/react** (React Flow — 无限画布 graph), **dnd-kit** (镜头编排 `ShotList` drag), **react-markdown** + **remark-gfm** (Markdown render, see `src/components/common/Markdown.tsx`), **uqr** (QR codes), **dayjs**, **@openobserve/browser-rum** + **browser-logs** (frontend RUM/logging — route anything user-identifying through `utils/observabilitySanitizer.ts`). (The legacy-flow-only `@tiptap/*`, `plyr`/`plyr-react`, heavy `streamdown` and `qrcode.react` were removed — see MIGRATION.md.)

## Conventions

- Path alias `@/*` → `src/*` (in `tsconfig.app.json` and `vite.config.ts`).
- Styling conventions coexist — **match whichever the folder you're editing already uses**. Older components and views import a sibling plain `.css` (global class names). `src/components/smart/**` and `src/components/task/**` use **CSS Modules + Less** (`Component.module.less` imported as `styles`); `src/components/canvas/**` uses **CSS Modules with plain CSS** (`Component.module.css`). Global styles in `src/styles/` are framework-agnostic and reused as-is from the Vue version.
- Global Toast/Confirm via `useToast()` / `useConfirmDialog()` (`src/composables/useToast.ts`), backed by `src/stores/ui.ts`. Don't add ad-hoc toast implementations.
- Controlled props replace Vue `v-model` (`value` + `onChange`); parent events became callback props or Context.

### Type debt (intentional — do not "fix" wholesale)

- `src/api/auth.ts` and `src/api/business.ts` use `@ts-nocheck`; eslint relaxes `ban-ts-comment` and `no-unused-vars` for `src/api/**`. Full typing is planned incremental work.
- `tsconfig.app.json` is intentionally loosened during migration: `noImplicitAny:false`, `strictNullChecks:false`, `useUnknownInCatchVariables:false`. Tighten incrementally as files are properly typed.
- eslint disables `@typescript-eslint/no-explicit-any` and downgrades unused vars to warnings (`^_` prefix to ignore). `any` is widespread in store/API boundaries by design.
- `types` is restricted to `["vite/client"]` to keep `@types/node` from leaking browser-incorrect types (e.g. `setTimeout` returning `NodeJS.Timeout` instead of `number`).

### Known runtime caveats

- Coverage is uneven by design: the `vitest.config.ts` allowlist and the `e2e/` smoke specs cover shared/critical modules and routing, **not** the full creation pipelines. `SmartCreateView`/`HotCopyCreateView`/`CanvasView` remain largely untested end-to-end — when changing them, verify against a live backend page-by-page rather than trusting a green `npm test`.
- Signed media URLs expire. `taskCenter` strips them before persisting, and `smartShotImage.ts` exposes `ensureAssetId`/`refreshAssetUrl` for re-resolution — never persist a signed URL as durable state.
- Markdown rendering uses `react-markdown` + `remark-gfm` (`src/components/common/Markdown.tsx`); the old heavy `streamdown` (shiki + mermaid ~1.4MB) was removed. `npm run check:bundle` enforces a size budget in CI (a per-chunk ceiling on any single JS file plus a total across all route chunks; see `scripts/check-client-bundle.mjs`) — run it before adding a heavy dependency, and prefer `lazy()` for route-level code.
