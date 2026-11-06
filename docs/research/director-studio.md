# Director Studio component

## Routes and ownership

The observed LibTV `/canvas` Agent panel maps to `/director`. This entry is independent of the existing `/agent` product-analysis chat; it uses the Deep Agents service and MCP authorization. `src/components/director/DeepAgentStudio.tsx` is reusable in a canvas sidebar or another host. Its CSS module does not modify business page styles.

```tsx
<DeepAgentStudio
  apiBase="/agent-studio"
  workspaceId={workspaceId}
  canvasId={canvasId}
  onCanvasChange={snapshot => refreshCanvasFromSnapshot(snapshot)}
  onCollapse={() => setDirectorOpen(false)}
/>
```

`workspaceId` guards against accidental use of an authorization for another workspace; the backend remains authoritative. Passing `canvasId` binds the new conversation to that existing canvas. Omitting it lets the backend create one when the first message is sent. The host must treat `onCanvasChange` as a **display projection / refresh notification**, not a full business-canvas snapshot: edges and original payload fields are omitted. Refresh through the existing business-canvas read protocol; never save this projection over the original canvas. See [无限画布接入文档](../director-canvas-integration.md). Switching between conversation and results never generates media.

## Service connection

The component bootstraps its HttpOnly session through `GET /agent-studio/`, then requests `api/state` and `api/catalog`. The development proxy and backend mount must both be configured for this same-origin prefix. It does not call business `/api/v1/agent`, expose MCP tokens, or use an iframe. The existing 8090 single-process Studio is a local test service; this component does not make it a public multi-tenant deployment.

OAuth starts with `POST /agent-studio/api/connect`; the returned HTTP(S) authorization URL is opened by the browser. OAuth returns through the mount's callback. No credentials or Skill bodies are saved in localStorage.

Mutations carry `X-Agent-Request: 1` and same-origin cookies. Creation uses model IDs fetched from the real catalog. Initial preferences match **Nano Banana Pro** and **Seedance 2.5** by name; if those models are unavailable the user must choose an available one. The text model is selected by the backend and shown read-only.

## Event integration

1. `GET /api/runs/{id}` restores events, documents, batches, canvas, pending approval, billing and the persistent cursor.
2. Open `WS /api/runs/{id}/ws?after={cursor}`. Same-origin session cookies authenticate the handshake.
3. `RUN_STATE` updates state and pending approval. `complete` means the current dialogue turn ended, not that the entire production passed inspection.
4. Stable event IDs replace task cards. Document/node/batch IDs replace their matching objects. `ACTIVITY_SNAPSHOT` replaces the billing snapshot; repeated frames never add charges.
5. Reconnects only subscribe to the original cursor, back off 1–15 seconds and stop after five consecutive failures. They never call generate/resume. Selecting another conversation closes the old socket and ignores its late frames.
6. Known transient text failures expose a separate explicit retry action using `retry_inference_task_id`; ordinary resume only reconciles existing tasks. Failed media nodes request a new batch attempt and return to approval.

HTTP creation failures with an unknown outcome block another immediate send. Refresh history and locate the accepted conversation before intentionally creating another one.

## Interaction evidence and remaining differences

The reference is the owner-authorized LibTV captures documented in the backend repository's `docs/research/libtv-agent.json`: dark floating panel, history toolbar, start actions, bottom composer, model/Skill/mode controls, structured question cards, per-batch approval, persistent task/results and canvas updates. The component uses the actual Studio contract instead of imitating LibTV's private API names.

Our backend currently returns execution events and completed text, **not token-level text deltas**. The UI does not animate invented streaming text. Image/video/result cards use actual returned URLs; a successful response does not claim speech transcription or perfect visual quality. Native audio presence and any inspection notes stay separate from task success.

The first implementation includes history/new, reference images and script documents, mode/model/Skill selection, approvals, parallel batch status, failure recovery, settled versus reserved credits, result video playback, versioned production-document editing and canvas refresh callbacks. The component has no notification-permission prompt, external sharing command, private Skill-content viewer, or arbitrary subagent control. Those behaviors were not added as decorative nonfunctional controls.

Upload constraints mirror the service: at most eight attachments per creation, ten MB per file. Document updates preserve draft text on errors and use revision plus a stable save key. A conflict requires the operator to compare/reload the server version rather than silently overwrite it.

## Verification

Use Node 22 for this repository's existing Vitest/jsdom dependencies. Component and event contract tests live in `tests/directorStudio.test.tsx`. They exercise actual HTTP shapes with test-only responses: mode/model binding, approval identity, replay deduplication, cost replacement, workspace isolation, explicit inference retry and socket cleanup. These tests do not call paid models. Browser checks must also cover the real local connected state before claiming end-to-end readiness.

### Local browser verification (2026-11-05)

Read-only inspection of the authorized workspace54 episode through `/director` verified history restoration, live WebSocket updates, 3/3 plus1/1 completed batch cards, actual settled-cost snapshots, production-document tabs, and disabled document edits while running. On a390×844 viewport the results view reported4images,4clips and1merged video without horizontal overflow. All four images loaded (natural width1376); all five video elements reached readyState4 with no media error. Measured merged duration45.269333seconds at720×1280; individual clips measured15.072,8.064,12.064 and10.048seconds. This is media load/metadata verification, not proof of dialogue accuracy. No paid generation, retry, approval or stop was sent in this browser check.

Historical signed URLs had expired during the first inspection. Cards now prefer fresh canvas URLs by asset ID and can refresh through the run-bound asset-read endpoint; one automatic refresh is allowed per failed media asset, followed by an explicit retry button. Refreshing a URL never creates a generation task or changes the immutable event journal.

The subsequent real manual followup exercised the mode selector, message submission, persisted approval card, rejection and approval against the same authorized account. Rejected inspection did not run. A new approved merge reused the four existing clips in the order3612,3611,3610,3613 and produced asset3633; its inspection required a separate approval. Both the backend inspection and browser measured1280×720,45.269333seconds with audio; the old portrait asset3614 remains available. Both videos reached readyState4 and the mobile view had no horizontal overflow. This followup settled10.766text-inference credits,0image and0video-generation credits. It verifies real manual merge/inspection, not a second full paid image/video production. Dialogue transcription remains unverified.

The backend fixes required by these checks are async inference and merge-aspect preservation (3742e16), plus manual remerge/native receipt recovery (b7d02fd). New local service code must be restarted; the TEST API/worker were updated, while PRODUCTION was untouched. A restart temporarily interrupts sockets; after the bounded reconnect attempts are exhausted, reopening the history entry restores the persisted state without submitting new work.

The production build, application/test type checks, changed-file lint and14new component/contract tests passed. A full existing suite returned317passing files/3856passing tests and19failing files/132failing tests. Those same19files were rerun against a clean archive of the unchanged `origin/dev` base: all132failures reproduced. Existing bundle budgets also fail on that base (largest686.89KiB,totalgzip1425.32KiB); this component build was683.58KiB/1439.37KiB. Budget limits and unrelated source/tests were not weakened. These known baseline failures must not be described as a fully green frontend verification.

### Conversation UI parity and component delivery (2026-11-06)

Used the `clone-website` skill from `JCodesMore/ai-website-cloner-template`; the installed SKILL.md was byte-identical to its current upstream version. All visual interactions used Codex's built-in browser. Compared the source and component at580×766 and checked390×640: all four starter actions and send control were on-screen; the Skill popover measured366px wide at x12–378 with no horizontal overflow. Fixed root dialog/popover box sizing after the first narrow-screen comparison.

Verified actual history, current-revision document preview, collapse/restore, anchored pickers and context receipts. Completed/cancelled batches now start collapsed. The existing14-shot run plus3replacement clips and2merged versions loaded19video players at readyState4 without media errors; both merged versions measured158.965333seconds. These are existing assets, not new generation or a renewed quality inspection. The actual latest text input was12,782tokens; cumulative usage remained7,233.545credits. Automatic summary remains disabled and context capacity remains unknown, so no remaining percentage is invented.

Targeted verification:26React tests, changed-file lint/type checking and production build passed; existing bundle-size warnings remain. Integration contract and safe canvas-refresh example: [无限画布接入文档](../director-canvas-integration.md). The component is reusable; `/director` only provides a floating preview host. Sharing/plugins/reaction persistence and automatic context summarization are not implemented by this UI batch.
