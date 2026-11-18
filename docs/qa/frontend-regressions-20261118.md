# Frontend regression audit — 2026-11-18

Baseline: `8774030`. The previous TEST deployment had 68 failing assertions, all reproduced on its predecessor `e7c1821`. These were investigated, not skipped.

| Existing failures | Cause and treatment |
| --- | --- |
| Audio generation 24; image tools 10; retry 2; image preview 1 | Renamed controls, asynchronous candidate discovery, and image overlays requiring a loaded image. Tests now enter through current accessible controls and simulate actual image loading. Original quote, authorization, workspace, parameter, and one-submission assertions remain. |
| Angle editor 1; image tools 1 | The current back-view prompt preserves objects and their orientation explicitly. Tests now assert the current prompt and still verify preview/quote/submission consistency. |
| Canvas list 3; rename 3 | Management moved to `?manage=1`; the default route is a creation entry with recent cards. Rename is now disabled for other owners rather than allowing a click to display a toast. Tests target management and require no mutation for forbidden rename. |
| Node panel 3; video project navigation 1 | Reference chips use accessible buttons; preflight includes a resolved thumbnail URL; edit navigation includes `hotCopyEdit`. Exact request/navigation expectations now include these fields. |
| Voice library 6 | The old model/sample tabs were removed by product changes (already fixed to `custom` in `53a1078`). Replaced obsolete tests with unified server-library integration checks: browse without choosing, permission/running gates, real voice ID, server revalidation and non-ready results. Removed unreachable old-tab branches without reopening them. |
| Hot-copy parameters 4; floating menus 3; task center 1 | Duration is now an accessible discrete slider, menus use a screen-coordinate portal, and refinement has its own tab. Tests exercise those current interactions and retain parameter persistence, viewport bounds and task separation. |
| Completed-entry cleanup 1 | The fixture called an actively processing project “completed.” It now supplies a terminal generation. Existing active-task protection remains tested and unchanged. |
| Model restriction metadata/catalog/dropdown 4 | **Real user-facing bug:** discrete options such as 5/10/15 seconds were shown as 5–15. Only consecutive integer options may now be summarized as a range; gaps and fractional options stay explicit. |

## Additional bug found while investigating

Canvas cover loading discarded a pending response whenever visibility changed, but retained its “loaded” marker. Scrolling could therefore leave a valid cover blank permanently. The loader now keeps requests across visibility changes, accepts results only for the current workspace/id/revision, and uses a shared limit of three pending requests. Failed covers leave a placeholder and do not cause an automatic request loop.

A deterministic delayed-response regression failed before this fix. Additional cases cover concurrent slots, workspace changes/return, and failure without looping. All media/voice API calls in these tests are mocked; no inference, media generation or ASR is performed.

## Release boundary

Frontend only, TEST first. Preserve backend/Agent/admin, cloud database and existing media. Keep previous static assets and the prior frontend symlink for rollback. Production is outside this release.

## Validation setup

Integrated the concurrent `3b5b9b3` registration-code fix before packaging, preserving the new account workflow. All 18 files covering the original 68 failures pass (383 assertions). Production build and changed-file ESLint pass.

Full-suite execution also exposed test timing assumptions: Ant Design CSS transitions do not complete in JSDOM, so voice-library tests disable motion via the real ConfigProvider while retaining visibility checks; ImageChat's caret test now waits for the first insertion's animation-frame focus before simulating a later cursor move. Its 27 tests pass without changing input behavior or weakening caret assertions.

Review and simplify covered permissions, estimates/paid submission, retry idempotency, asynchronous workspace isolation and regressions. No billing/generation behavior changed. Independent spec/standards review found no blockers; mandatory backend `make verify` and 9 hook tests passed in the unchanged isolated backend worktree.

Final merged snapshot: **4,195 / 4,195 tests pass across 355 files**, zero failures or skipped tests. Production build, changed-file ESLint, diff whitespace checks, review/simplify gate and 9 hook tests pass.
