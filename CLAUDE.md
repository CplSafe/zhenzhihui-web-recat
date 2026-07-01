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

There is **no test suite**. CI (`.github/workflows/ci.yml`) runs typecheck + lint + build on push/PR to `main`. Husky + lint-staged run `eslint --fix` + `prettier` on staged `*.{ts,tsx}` pre-commit.

### Backend proxy / env

`npm run dev` proxies to a backend. Defaults: business API `http://localhost:9000`, DeepAuth `http://localhost:8080`. To point at a real backend, create `.env` (see `.env.example`):

```sh
VITE_ZZH_REMOTE_ORIGIN=https://your-business-host
VITE_DEEPAUTH_REMOTE_ORIGIN=https://your-deepauth-host
```

The proxy in `vite.config.ts` strips the `Origin` header, rewrites Set-Cookie domains, and fixes up OAuth redirect `Location` headers so SSO callbacks return to the dev origin. Proxy prefixes: `/api`, `/auth`, `/zzh-api` (→ business), `/deepauth` (→ DeepAuth).

## Architecture

Request flow: **views** orchestrate UI and call **composables** (feature hooks) and **api** clients; cross-cutting state lives in **Zustand stores**; pure logic lives in **utils**.

- **`src/api/`** — `business.ts` (2300+ lines; AI task submit/poll, asset management, project CRUD, version history, billing/wallet, storage upload) and `auth.ts` (login/register, SMS codes, sessions, DeepAuth QR login, team invites). Both are framework-agnostic clients ported verbatim and carry `@ts-nocheck` at the top — **intentional type debt**, see "Conventions". All requests go through a shared `requestJson` error handler. `business.ts` includes an upload-host allowlist (`ALLOWED_UPLOAD_HOST_PATTERNS`) guarding against redirect-to-internal-host attacks — keep it when touching upload code. The **智能成片 2.1** flow (see below) added focused clients alongside these: `smartScript.ts` (streaming shot-script gen), `smartShotImage.ts` (shot image gen + asset persistence + the shared `ensureAssetId`/`refreshAssetUrl`), `smartVideo.ts` (full-video gen, timeline prompt), `smartFaceBlur.ts`, `aiPolish.ts` (prompt/name polishing), `hotCopy.ts` (爆款复制 / `video.replicate`), plus `projectVideos.ts`, `banners.ts`, `templates.ts`, `feedback.ts`, `aiResponses.ts`.

- **`src/auth/AuthContext.tsx`** — session bootstrap/refresh/login/logout via React Context (ported from `App.vue`). `App.tsx` (`AppShell`) is the root layout and holds the **central auth guard** keyed off each route's `handle.requiresAuth`. The browsable pages (`/home`, `/templates`, `/smart`, `/hot-copy`) are marked `requiresAuth: false` so they render for guests; actions that need a session call `useRequireAuth()` to gate just that action. `/projects`, `/resources` and the project-video routes still require auth. App entry is `/home` (index redirects there; unknown paths fall back to `/home`).

- **`src/stores/`** (Zustand) — `workspaceSession.ts` (auth session, workspace list/switching, members, wallet, billing, app init) and `ui.ts` (global toast/confirm + the 「功能待开放」 dialog via `openComingSoon`). Pattern from the Pinia migration: raw state fields + `derive*` **pure functions** for computed values + `use*` **selector hooks** for components. Non-reactive `let` closures from Pinia stores became module-level variables.

- **`src/router/index.tsx`** — react-router v7 data router, all pages `lazy`-loaded. Routes: `/welcome` + `/login` (`requiresAuth:false`), `/home` (entry), `/templates`, `/smart` + `/smart/:id` (→ `SmartCreateView`, 智能成片 2.1), `/hot-copy` + `/hot-copy/:id` (→ `HotCopyCreateView`, 爆款复制), `/projects`, `/projects/:projectId/videos`, `/projects/:projectId/videos/:videoId`, `/resources`; `*` → `/home`. (The old legacy-creative `/creative*` and `/workbench` routes were removed — see MIGRATION.md.)

- **`src/views/`** — the two live generation pipelines, both **2.1**:
  - **智能成片 2.1**: `SmartCreateView.tsx` (2800+ lines) drives a 4-step pipeline — 分镜脚本 → 准备素材 → 镜头编排 → 视频生成 — backed by the `src/api/smart*` clients and `src/components/smart/**`. Drafts persist to both localStorage and backend (project-resolve + `draft_revision` optimistic-concurrency save chain is inlined in the view; see `doPutDraft`/`fetchRevision`).
  - **爆款复制**: `HotCopyCreateView.tsx` is its sibling that feeds `video.replicate` (source video + 1–9 subject images → one-shot video).
  - Other views: `HomeView` (entry + history), `TemplatesView` (模板库), `ProjectManagementView` + `ProjectVideoListView`/`ProjectVideoDetailView` (项目管理), `ResourceManagementView` (素材市场), `LoginView`, `SplashView`. **Note:** `SmartCreateView`/`HotCopyCreateView` still call `api/*` directly and each **inline** their own project-resolve + draft-save chain (no shared headless hook) — the largest open architecture debt. A `useCreativeProjectBackend` composable once held this but drifted out of use and was removed; if the two views are ever unified, re-extract from their live inline logic rather than resurrecting the stale file.

- **`src/composables/`** — feature hooks: `useAssetPreview`, `useRequireAuth` (gate an action behind login), `useSidebarNavigate` (shared `<AppSidebar>` routing), `useSwr` (lightweight cached fetch), `useToast`/`useConfirmDialog` (wrap the `ui` store).

- **`src/components/`** — grouped by domain: `auth`, `layout` (`AppTopbar`), `home` (`AppSidebar`), `smart` (the 智能成片 2.1 step UIs — each in its own subfolder, CSS Modules + Less), `hotcopy` (爆款复制 step UIs), `common` (small shared widgets: `AiBadge`, `InlineEdit`, `EllipsisText`, `VideoPreviewModal`, `Markdown`), `material` (`MaterialLibraryPicker`), `resource`, `space`, `creative` (now only `CreativeSidebar`, reused by 项目管理). Global singletons `AppToast`, `AppConfirmDialog`, `ComingSoonDialog`, `MemberCenterModal` and `HelpCenter` (draggable 帮助中心 floating ball, shown only on authenticated non-login pages) are mounted once in `AppShell`.

Key libraries: **antd** (UI, replaces element-plus; locale zh_CN, primary color `#5767e5` set in `main.tsx`), **dnd-kit** (镜头编排 `ShotList` drag), **react-markdown** + **remark-gfm** (Markdown render, see `src/components/common/Markdown.tsx`), **qrcode.react** (payment QR). (The legacy-flow-only `@tiptap/*`, `plyr`/`plyr-react` and heavy `streamdown` were removed — see MIGRATION.md.)

## Conventions

- Path alias `@/*` → `src/*` (in `tsconfig.app.json` and `vite.config.ts`).
- Two styling conventions coexist. Older components import a sibling plain `.css` (global class names). Newer `src/components/smart/**` components use **CSS Modules + Less** (`Component.module.less` imported as `styles`) — match whichever convention the folder you're editing already uses. Global styles in `src/styles/` are framework-agnostic and reused as-is from the Vue version.
- Global Toast/Confirm via `useToast()` / `useConfirmDialog()` (`src/composables/useToast.ts`), backed by `src/stores/ui.ts`. Don't add ad-hoc toast implementations.
- Controlled props replace Vue `v-model` (`value` + `onChange`); parent events became callback props or Context.

### Type debt (intentional — do not "fix" wholesale)

- `src/api/auth.ts` and `src/api/business.ts` use `@ts-nocheck`; eslint relaxes `ban-ts-comment` and `no-unused-vars` for `src/api/**`. Full typing is planned incremental work.
- `tsconfig.app.json` is intentionally loosened during migration: `noImplicitAny:false`, `strictNullChecks:false`, `useUnknownInCatchVariables:false`. Tighten incrementally as files are properly typed.
- eslint disables `@typescript-eslint/no-explicit-any` and downgrades unused vars to warnings (`^_` prefix to ignore). `any` is widespread in store/API boundaries by design.
- `types` is restricted to `["vite/client"]` to keep `@types/node` from leaking browser-incorrect types (e.g. `setTimeout` returning `NodeJS.Timeout` instead of `number`).

### Known runtime caveats (from MIGRATION.md)

- The migration is build-verified but **not yet runtime-verified against a live backend** — verify the live flows (智能成片 / 爆款复制 / 项目管理 / 素材市场) page-by-page when wiring a real backend. (Only these four are live; the billing-admin / team-management UIs were ported but never wired and have since been removed — see MIGRATION.md. `workspaceSession` still carries wallet/billing state used by `MemberCenterModal`.)
- Markdown rendering uses `react-markdown` + `remark-gfm` (`src/components/common/Markdown.tsx`); the old heavy `streamdown` (shiki + mermaid ~1.4MB) was removed.
