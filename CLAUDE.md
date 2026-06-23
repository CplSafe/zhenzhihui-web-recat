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

- **`src/api/`** — `business.ts` (2300+ lines; AI task submit/poll, asset management, project CRUD, version history, billing/wallet, storage upload) and `auth.ts` (login/register, SMS codes, sessions, DeepAuth QR login, team invites). Both are framework-agnostic clients ported verbatim and carry `@ts-nocheck` at the top — **intentional type debt**, see "Conventions". All requests go through a shared `requestJson` error handler. `business.ts` includes an upload-host allowlist (`ALLOWED_UPLOAD_HOST_PATTERNS`) guarding against redirect-to-internal-host attacks — keep it when touching upload code.

- **`src/auth/AuthContext.tsx`** — session bootstrap/refresh/login/logout via React Context (ported from `App.vue`). `App.tsx` (`AppShell`) is the root layout and holds the **central auth guard**: routes require auth by default; only `/login` sets `handle.requiresAuth: false`.

- **`src/stores/`** (Zustand) — `workspaceSession.ts` (auth session, workspace list/switching, members, wallet, billing, app init), `materialLibrary.ts`, `ui.ts` (global toast/confirm). Pattern from the Pinia migration: raw state fields + `derive*` **pure functions** for computed values + `use*` **selector hooks** for components. Non-reactive `let` closures from Pinia stores became module-level variables.

- **`src/router/index.tsx`** — react-router v7 data router, all pages `lazy`-loaded. Key routes: `/login`, `/creative` (entry), `/creative/blank` and `/creative/:id` (both → `CreativeScriptView`), `/projects`, `/resources`, `/workbench`.

- **`src/views/`** — `CreativeScriptView.tsx` (4300+ lines) is the central orchestrator: the full pipeline of prompt → script generation (with storyboard-word JSON) → storyboard image gen (edit/replace/insert/version history) → timeline editing → video gen/publish. Drafts persist to both localStorage and backend.

- **`src/composables/`** — feature hooks (named like Vue composables): `useStoryboardGeneration`, `useVideoGeneration`, `useScriptPrompts`, `useBilling`, `useTaskPolling`, `useTaskAbort`, `useAssetPreview`, `useWorkflowPersistence`. `useToast`/`useConfirmDialog` wrap the `ui` store.

- **`src/components/`** — grouped by domain: `auth`, `billing`, `layout`, `creative` (the largest — storyboard/timeline/video panels), `material`, `resource`, `space`, `team`. Global singletons `AppToast` and `AppConfirmDialog` are mounted once in `AppShell`.

Key libraries: **antd** (UI, replaces element-plus; locale zh_CN, primary color `#5767e5` set in `main.tsx`), **dnd-kit** (storyboard/timeline drag), **@tiptap/react** (rich-text in `GeneratedScriptPanel`), **streamdown** (script Markdown render), **plyr-react** (video), **qrcode.react** (payment QR).

## Conventions

- Path alias `@/*` → `src/*` (in `tsconfig.app.json` and `vite.config.ts`).
- Each component's scoped styles live in a sibling `.css` imported by the component. Global styles in `src/styles/` are framework-agnostic and reused as-is from the Vue version.
- Global Toast/Confirm via `useToast()` / `useConfirmDialog()` (`src/composables/useToast.ts`), backed by `src/stores/ui.ts`. Don't add ad-hoc toast implementations.
- Controlled props replace Vue `v-model` (`value` + `onChange`); parent events became callback props or Context.

### Type debt (intentional — do not "fix" wholesale)

- `src/api/auth.ts` and `src/api/business.ts` use `@ts-nocheck`; eslint relaxes `ban-ts-comment` and `no-unused-vars` for `src/api/**`. Full typing is planned incremental work.
- `tsconfig.app.json` is intentionally loosened during migration: `noImplicitAny:false`, `strictNullChecks:false`, `useUnknownInCatchVariables:false`. Tighten incrementally as files are properly typed.
- eslint disables `@typescript-eslint/no-explicit-any` and downgrades unused vars to warnings (`^_` prefix to ignore). `any` is widespread in store/API boundaries by design.
- `types` is restricted to `["vite/client"]` to keep `@types/node` from leaking browser-incorrect types (e.g. `setTimeout` returning `NodeJS.Timeout` instead of `number`).

### Known runtime caveats (from MIGRATION.md)

- The migration is build-verified but **not yet runtime-verified against a live backend** — verify generation/billing/team flows page-by-page when wiring a real backend.
- `streamdown` bundles shiki + mermaid (mermaid chunk ~1.4MB), lazy-loaded as separate chunks. If Markdown diagrams/highlighting aren't needed, consider trimming or a lighter renderer.
