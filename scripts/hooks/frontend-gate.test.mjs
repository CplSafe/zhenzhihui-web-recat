import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  snapshot,
  changedFiles,
  stopDecision,
  hook,
  coversChanges,
  normalizeProjectPath,
  verificationBuildDirectory,
} from './frontend-gate.mjs'

const baseline = { files: { 'src/page.tsx': 'old' }, fingerprint: 'old' }
const current = { files: { 'src/page.tsx': 'new' }, fingerprint: 'new' }
const decision = (options = {}) => stopDecision({ baseline, current, message: '已完成', ...options })

test('Windows long-path and drive-letter casing resolve to the same project path', () => {
  if (process.platform !== 'win32') return
  assert.equal(normalizeProjectPath('F:\\project\\frontend'), normalizeProjectPath('\\\\?\\f:\\project\\frontend'))
  assert.equal(
    normalizeProjectPath('\\\\server\\share\\frontend'),
    normalizeProjectPath('\\\\?\\UNC\\server\\share\\frontend'),
  )
  assert.notEqual(normalizeProjectPath('F:\\project\\frontend'), normalizeProjectPath('F:\\project\\frontend-other'))
})

test('missing evidence blocks completion, including automatic continuations', () => {
  assert.equal(decision().decision, 'block')
  assert.equal(decision({ receipt: { fingerprint: 'new' } }).decision, 'block')
})
test('stale evidence cannot certify new source', () => {
  assert.equal(decision({ receipt: { fingerprint: 'old', review: 'checked' }, evidenceValid: true }).decision, 'block')
})
test('tests alone are insufficient without screenshot review', () => {
  assert.equal(decision({ receipt: { fingerprint: 'new' }, evidenceValid: true }).decision, 'block')
})
test('deleted or tampered artifacts block completion', () => {
  assert.equal(decision({ receipt: { fingerprint: 'new', review: 'checked' }, evidenceValid: false }).decision, 'block')
})
test('current evidence plus review allows completion', () => {
  assert.deepEqual(
    decision({
      receipt: { fingerprint: 'new', review: 'checked', tests: ['e2e/home.smoke.spec.ts'] },
      evidenceValid: true,
    }),
    {},
  )
})
test('unrelated homepage tests cannot certify canvas or auth changes', () => {
  assert.equal(coversChanges(['src/views/CanvasView.tsx'], ['e2e/home.smoke.spec.ts']), false)
  assert.equal(coversChanges(['src/views/CanvasView.tsx'], ['e2e/canvas-hd.spec.ts']), true)
  assert.equal(coversChanges(['src/auth/AuthContext.tsx'], ['e2e/canvas-hd.spec.ts']), false)
  assert.equal(coversChanges(['src/views/SmartCreateView.tsx'], ['e2e/smart-entry-reset.spec.ts']), true)
})
test('honest incomplete report can stop without infinite retries', () => {
  assert.deepEqual(decision({ message: '验收状态：未通过\n未验证：浏览器启动失败，原因与下一步已列明。' }), {})
  assert.equal(decision({ message: '验收状态：未通过\n未验证，但全部完成。' }).decision, 'block')
})
test('documentation-only and unchanged sessions do not demand a browser', () => {
  assert.deepEqual(decision({ current: baseline }), {})
  assert.deepEqual(decision({ current: { ...baseline, files: { ...baseline.files, 'docs/guide.md': 'new' } } }), {})
})
test('other projects are not affected', () => {
  assert.deepEqual(hook({ cwd: os.tmpdir(), hook_event_name: 'Stop', session_id: 'test' }), {})
})
test('hash detects edits, deletions, new untracked source, test/config changes; ignores artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-hook-test-'))
  try {
    fs.mkdirSync(path.join(dir, 'src'))
    fs.mkdirSync(path.join(dir, 'e2e'))
    fs.mkdirSync(path.join(dir, 'test-results'))
    fs.writeFileSync(path.join(dir, 'src/a.tsx'), 'one')
    const first = snapshot(dir)
    fs.writeFileSync(path.join(dir, 'test-results/result.json'), 'evidence')
    assert.equal(snapshot(dir).fingerprint, first.fingerprint)
    fs.writeFileSync(path.join(dir, 'src/a.tsx'), 'two')
    fs.writeFileSync(path.join(dir, 'src/new.css'), 'new')
    fs.writeFileSync(path.join(dir, 'e2e/a.spec.ts'), 'test')
    fs.writeFileSync(path.join(dir, 'playwright.config.ts'), 'config')
    assert.equal(changedFiles(first, snapshot(dir)).length, 4)
    fs.rmSync(path.join(dir, 'src/a.tsx'))
    assert.ok(changedFiles(first, snapshot(dir)).includes('src/a.tsx'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('each verification builds into its own safe directory instead of the shared dist', () => {
  const a = verificationBuildDirectory('11111111-1111-4111-8111-111111111111')
  const b = verificationBuildDirectory('22222222-2222-4222-8222-222222222222')
  assert.notEqual(a, b)
  assert.ok(a.startsWith('.codex/frontend-verification/build-'))
  assert.throws(() => verificationBuildDirectory('../dist'))
})
