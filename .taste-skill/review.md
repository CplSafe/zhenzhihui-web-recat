# Canvas list design review

Direction: framed-sheet; seed 114655837. No redraw. Keep existing brand and font.
Question: Which canvas should I continue, or how do I start a new one?
Face: a low-chroma green-grey frame taken from the existing brand.
Signature: real canvas output covers with title and updated date; honest “暂无预览” when no output exists.
Data: production uses the existing workspace API. Three named canvases in the E2E spec are test fixtures only.

Before: purple title/button/covers compete; mobile topbar wraps vertically; no direct action in empty state.
After: white inset sheet, restrained dark action, neutral cover wells, labelled collection/count, direct empty-state creation, compact mobile topbar.
Critique round 2:
1. Hierarchy: title, create action and canvas names are clear; no invented metrics.
2. Edges: equal gutters and 20px grid spacing; auto-fit removes the reserved fourth desktop column. Incomplete final rows remain honest library layout.
3. Colour: brand frame is quiet; real output retains its colours. Shared logo, membership badge and help widget retain product branding.
4. Figures: count derives from effectiveCanvases; dates are API values; tabular numerals.
5. Empty/missing: zero is 0; missing output says 暂无预览 and missing timestamp says 暂无更新.
6. Charts/legends: none.
7. Phone: menu/account remain available, single-column library, wrapped title/action, contained dialog.

Lint: 0 FAIL; warnings are date padding, two explicit shadow:none declarations and the floating modal shadow (permitted).
Inspector: not run; current Node is 20.19, skill requires 22+. Followed documented fallback: lint + production Playwright screenshots at 1440/768/390.
Browser scope: mocked authenticated API; list, menu keyboard activation, rename dialog opening/cancel, create validation, Escape, reopening/reset, viewport overflow and empty state.
Live backend creation/deletion and AI task generation not exercised; no API or generation logic changed.
