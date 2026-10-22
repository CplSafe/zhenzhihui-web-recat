import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const storage = path.join(root, '.codex/frontend-verification')
const digest = (text) => crypto.createHash('sha256').update(text).digest('hex')
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2))
  fs.renameSync(temporary, file)
}

// Hash content, not timestamps. Include tests/config so old results cannot certify new tests.
export function snapshot(base = root) {
  const files = {}
  const visit = (relative) => {
    const full = path.join(base, relative)
    if (!fs.existsSync(full)) return
    const stat = fs.lstatSync(full)
    if (stat.isSymbolicLink()) throw new Error(`Refusing verification through symlink: ${relative}`)
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(full).sort()) visit(`${relative}/${child}`)
    } else files[relative] = digest(fs.readFileSync(full))
  }
  for (const folder of ['src', 'public', 'e2e', 'tests', 'scripts']) visit(folder)
  for (const name of fs.readdirSync(base).sort()) {
    if (/^(package.*\.json|.*lock.*|index\.html|.*config\.[\w.]+|tsconfig.*\.json|\.env.*)$/.test(name)) visit(name)
  }
  return { files, fingerprint: digest(JSON.stringify(files)) }
}

export function changedFiles(before, after) {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].filter(
    (name) => before.files[name] !== after.files[name],
  )
}

const relevant = (name) =>
  /^(src\/|public\/|index\.html$|package.*\.json$|.*lock.*|.*config\.|tsconfig|\.env)/.test(name)
const instructions =
  '前端修改需按 docs/frontend-browser-verification.md 验证。运行 node.exe scripts/hooks/frontend-gate.mjs verify e2e/<相关用例>.spec.ts；查看生成的截图后运行 review <run-id> "已检查的页面与交互"。证据绑定当前代码。缺失时只能以“验收状态：未通过”开头，如实写明未验证范围、原因，不能声称完成。'

export function coversChanges(changed, tests = []) {
  if (!tests.length) return false
  const groups = [
    [/canvas/i, /canvas/],
    [/SmartCreate|\/smart[/A-Z.]|\/smart[^/]*\./i, /smart/],
    [/hotcopy|HotCopy|hot-copy/i, /hot-copy|authenticated-routes/],
    [
      /AuthContext|\/auth\/|\/router\/|App\.tsx|workspaceSession|useSafeWorkspaceSwitch/i,
      /auth-routing|authenticated-routes|workspace-switch/,
    ],
  ]
  return groups.every(
    ([source, spec]) => !changed.some((name) => source.test(name)) || tests.some((name) => spec.test(name)),
  )
}

export function stopDecision({ baseline, current, receipt, message = '', evidenceValid = false }) {
  const changed = changedFiles(baseline, current).filter(relevant)
  if (!changed.length) return {}
  if (
    receipt?.fingerprint === current.fingerprint &&
    receipt?.review &&
    evidenceValid &&
    coversChanges(changed, receipt.tests)
  )
    return {}
  // Explicit incomplete reports may stop; requiring a pass unconditionally would loop forever offline.
  if (
    message.trimStart().startsWith('验收状态：未通过') &&
    /未验证|失败|阻塞/.test(message) &&
    !/已完成|已经完成|全部完成|全部通过|均已通过|验证通过|验收通过|ready to ship|all tests pass/i.test(message)
  )
    return {}
  return {
    decision: 'block',
    reason: `前端验收未通过：${changed.slice(0, 8).join('、')}。缺少当前代码的成功浏览器测试及截图复核记录。${instructions} 不得把未完成的验收说成完成。`,
  }
}

function evidenceValid(receipt) {
  try {
    return (
      receipt?.passed > 0 &&
      receipt.artifacts.length > 0 &&
      receipt.artifacts.every((item) => digest(fs.readFileSync(item.path)) === item.hash) &&
      digest(fs.readFileSync(receipt.report.path)) === receipt.report.hash
    )
  } catch {
    return false
  }
}

export function normalizeProjectPath(value) {
  let resolved = path.resolve(value)
  if (process.platform === 'win32') {
    if (resolved.startsWith('\\\\?\\UNC\\')) resolved = '\\\\' + resolved.slice(8)
    else if (resolved.startsWith('\\\\?\\')) resolved = resolved.slice(4)
    resolved = resolved.toLowerCase()
  }
  return resolved
}

export function hook(input, { runtimeInvocation = false } = {}) {
  // Project-only: never alter behavior of other software/projects.
  const cwd = path.resolve(input.cwd || root)
  const accepted =
    normalizeProjectPath(cwd) === normalizeProjectPath(root) ||
    normalizeProjectPath(cwd).startsWith(normalizeProjectPath(root) + path.sep)
  // Only actual command-entry invocations produce audit records; imported unit tests do not.
  if (runtimeInvocation) {
    fs.mkdirSync(storage, { recursive: true })
    fs.appendFileSync(
      path.join(storage, 'runtime-events.jsonl'),
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event: input.hook_event_name,
        sessionId: input.session_id,
        toolUseId: input.tool_use_id,
        cwd,
        accepted,
        pid: process.pid,
      }) + '\n',
    )
  }
  if (!accepted) return {}
  const id = digest(String(input.session_id || 'unknown'))
  const statePath = path.join(storage, `session-${id}.json`)
  const current = snapshot()
  fs.mkdirSync(storage, { recursive: true })
  try {
    fs.writeFileSync(statePath, JSON.stringify(current), { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const event = input.hook_event_name
  if (event === 'SessionStart') return { hookSpecificOutput: { hookEventName: event, additionalContext: instructions } }
  if (event === 'Stop') {
    let receipt
    try {
      receipt = read(path.join(storage, 'approved.json'))
    } catch {
      /* no verified run */
    }
    const result = stopDecision({
      baseline: read(statePath),
      current,
      receipt,
      message: input.last_assistant_message,
      evidenceValid: evidenceValid(receipt),
    })
    // Keep baseline on incomplete reports so the next turn must still resolve outstanding changes.
    if (
      !result.decision &&
      receipt?.fingerprint === current.fingerprint &&
      receipt?.review &&
      evidenceValid(receipt) &&
      coversChanges(changedFiles(read(statePath), current).filter(relevant), receipt.tests)
    )
      write(statePath, current)
    return result
  }
  const changed = changedFiles(read(statePath), current).filter(relevant)
  return changed.length ? { hookSpecificOutput: { hookEventName: event, additionalContext: instructions } } : {}
}

function runNode(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Verification command failed (${result.status})`)
}

function collect(suites) {
  return suites.flatMap((suite) => [...(suite.specs || []), ...collect(suite.suites || [])])
}

function verify(tests) {
  if (!tests.length || tests.some((name) => !/^e2e\/[\w./-]+\.spec\.ts$/.test(name) || name.includes('..'))) {
    throw new Error('Provide explicit affected e2e/*.spec.ts files (no shell commands or arbitrary flags).')
  }
  for (const test of tests) if (!fs.existsSync(path.join(root, test))) throw new Error(`Missing test: ${test}`)
  const initial = snapshot()
  const port = Number(process.env.FRONTEND_VERIFY_PORT || 4273)
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('FRONTEND_VERIFY_PORT must be 1024..65535')
  // A new attempt supersedes earlier approval, including a failed rerun of identical source.
  fs.rmSync(path.join(storage, 'approved.json'), { force: true })
  const runId = crypto.randomUUID()
  write(path.join(storage, `${runId}.snapshot.json`), initial)
  const dir = path.join(root, 'test-results/frontend-gate', runId)
  fs.mkdirSync(dir, { recursive: true })
  const config = path.join(storage, `playwright-${runId}.config.ts`)
  fs.mkdirSync(storage, { recursive: true })
  // Base config is two levels above this generated config; keep owned production preview.
  fs.writeFileSync(
    config,
    `import base from '../../playwright.config'\nexport default { ...base, testDir: '../../e2e', outputDir: ${JSON.stringify(dir)}, retries: 0, forbidOnly: true, use: { ...base.use, baseURL: 'http://127.0.0.1:${port}', screenshot: 'on' }, webServer: { ...base.webServer, cwd: ${JSON.stringify(root)}, command: base.webServer.command.replaceAll('4173', '${port}'), url: 'http://127.0.0.1:${port}/home', reuseExistingServer: false }, reporter: [['list'], ['json', { outputFile: ${JSON.stringify(path.join(dir, 'report.json'))} }]] }\n`,
  )
  try {
    runNode(['node_modules/typescript/bin/tsc', '-b'])
    runNode(['node_modules/vite/bin/vite.js', 'build'])
    runNode(['node_modules/@playwright/test/cli.js', 'test', ...tests, '--config', config, '--project=chromium'])
    const reportPath = path.join(dir, 'report.json')
    const report = read(reportPath)
    const specs = collect(report.suites || [])
    if (
      report.errors?.length ||
      !specs.length ||
      specs.some(
        (s) =>
          !s.ok ||
          !s.tests.length ||
          s.tests.some(
            (test) =>
              test.expectedStatus !== 'passed' || test.results.length !== 1 || test.results[0].status !== 'passed',
          ),
      )
    )
      throw new Error('Report contains failed, skipped, expected-failure or empty tests')
    const artifacts = specs
      .flatMap((s) => s.tests.flatMap((t) => t.results.flatMap((r) => r.attachments || [])))
      .filter((a) => a.contentType === 'image/png' && a.path)
      .map((a) => ({ path: a.path, hash: digest(fs.readFileSync(a.path)) }))
    if (!artifacts.length) throw new Error('No screenshots available for review')
    const after = snapshot()
    if (after.fingerprint !== initial.fingerprint)
      throw new Error(`Source changed during verification; rerun: ${changedFiles(initial, after).join(', ')}`)
    const receipt = {
      runId,
      fingerprint: initial.fingerprint,
      tests,
      environment: 'Playwright; inspect test mocks; not proof of live backend generation',
      passed: specs.length,
      artifacts,
      report: { path: reportPath, hash: digest(fs.readFileSync(reportPath)) },
    }
    write(path.join(storage, `${runId}.json`), receipt)
    console.log(
      JSON.stringify(
        {
          runId,
          screenshots: artifacts.map((a) => a.path),
          next: 'Inspect screenshots and interactions, then run review <run-id> <specific review notes>',
        },
        null,
        2,
      ),
    )
  } finally {
    fs.rmSync(config, { force: true })
  }
}

function review(runId, notes) {
  if (!/^[\da-f-]{36}$/.test(runId || '') || !notes || notes.trim().length < 12)
    throw new Error('Provide run ID and specific page/interaction review notes (12+ characters)')
  const receipt = read(path.join(storage, `${runId}.json`))
  if (receipt.fingerprint !== snapshot().fingerprint || !evidenceValid(receipt))
    throw new Error('Evidence is missing, modified or stale; rerun verification')
  write(path.join(storage, 'approved.json'), { ...receipt, review: notes.trim(), reviewedAt: new Date().toISOString() })
  console.log(
    'Browser verification and visual review recorded for current source. This is not proof of live backend success.',
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2)
    if (mode === 'verify') verify(args)
    else if (mode === 'review') review(args[0], args.slice(1).join(' '))
    else if (mode === 'hook')
      console.log(JSON.stringify(hook(JSON.parse(fs.readFileSync(0, 'utf8')), { runtimeInvocation: true })))
    else throw new Error('Usage: frontend-gate.mjs hook | verify <e2e files> | review <run-id> <notes>')
  } catch (error) {
    // Hook infrastructure errors must not silently let Stop proceed.
    if (process.argv[2] === 'hook')
      console.log(
        JSON.stringify({
          decision: 'block',
          reason: `Frontend verification hook error: ${error.message}. Fix the hook or explicitly report verification blocked.`,
        }),
      )
    else {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}
