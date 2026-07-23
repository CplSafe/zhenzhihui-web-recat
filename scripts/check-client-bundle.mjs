import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { build, loadEnv } from 'vite'

const ROOT_DIR = process.cwd()
const DIST_DIR = path.resolve(ROOT_DIR, 'dist')
const MAX_SINGLE_JS_BYTES = 460 * 1024
const MAX_TOTAL_JS_GZIP_BYTES = 750 * 1024
const MAX_IMAGE_BYTES = 450 * 1024
const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'])
const FORBIDDEN_CLIENT_ENV_KEY =
  /VITE_(?:AI_[A-Z0-9_]*|ZZH_REMOTE_ORIGIN|DEEPAUTH_REMOTE_ORIGIN|SSO_REMOTE_ORIGIN|ZZH_API_BASE_URL|DEEPAUTH_API_BASE_URL)/g
const BACKEND_ENV_KEYS = [
  'ZZH_REMOTE_ORIGIN',
  'DEEPAUTH_REMOTE_ORIGIN',
  'SSO_REMOTE_ORIGIN',
  'AI_MODEL_ORIGIN',
  'AI_VL_ORIGIN',
  'AI_IMG_ORIGIN',
  // Legacy aliases are deliberately injected too: accepting them in Vite's
  // Node config must never make them public client configuration again.
  'VITE_ZZH_REMOTE_ORIGIN',
  'VITE_DEEPAUTH_REMOTE_ORIGIN',
  'VITE_SSO_REMOTE_ORIGIN',
  'VITE_AI_MODEL_ORIGIN',
  'VITE_AI_VL_ORIGIN',
  'VITE_AI_IMG_ORIGIN',
  'VITE_ZZH_API_BASE_URL',
  'VITE_DEEPAUTH_API_BASE_URL',
]
const SENTINEL_HOST_SUFFIX = 'client-backend-origin-sentinel.invalid'

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    return entry.isDirectory() ? walkFiles(absolutePath) : [absolutePath]
  })
}

function valueVariants(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return []
  const variants = new Set([trimmed, trimmed.replace(/\/+$/, '')])
  try {
    variants.add(new URL(trimmed).origin)
  } catch {
    // A malformed configured value is handled by vite.config.ts validation.
  }
  return [...variants].filter((candidate) => candidate.length >= 8)
}

function inspectBundle(label, sensitiveValues = [], bundleDirectory = DIST_DIR) {
  if (!fs.existsSync(bundleDirectory)) {
    throw new Error(`${path.relative(ROOT_DIR, bundleDirectory) || bundleDirectory} does not exist.`)
  }

  const files = walkFiles(bundleDirectory)
  const javascriptFiles = files.filter((file) => path.extname(file) === '.js')
  const imageFiles = files.filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
  const inspectedTextFiles = files.filter((file) => ['.css', '.html', '.js'].includes(path.extname(file)))

  if (!javascriptFiles.length) throw new Error(`${bundleDirectory} contains no JavaScript files.`)

  const javascriptStats = javascriptFiles.map((file) => {
    const contents = fs.readFileSync(file)
    return { file, rawBytes: contents.byteLength, gzipBytes: gzipSync(contents).byteLength }
  })
  const largestJavaScript = javascriptStats.reduce((largest, current) =>
    current.rawBytes > largest.rawBytes ? current : largest,
  )
  const totalJavaScriptGzipBytes = javascriptStats.reduce((total, current) => total + current.gzipBytes, 0)
  const largestImage = imageFiles
    .map((file) => ({ file, rawBytes: fs.statSync(file).size }))
    .sort((left, right) => right.rawBytes - left.rawBytes)[0]

  const leakedEnvironmentKeys = new Set()
  const leakedEnvironmentValues = new Set()
  for (const file of inspectedTextFiles) {
    const contents = fs.readFileSync(file, 'utf8')
    for (const match of contents.matchAll(FORBIDDEN_CLIENT_ENV_KEY)) leakedEnvironmentKeys.add(match[0])
    for (const [name, value] of sensitiveValues) {
      if (valueVariants(value).some((candidate) => contents.includes(candidate))) leakedEnvironmentValues.add(name)
    }
  }

  const failures = []
  if (largestJavaScript.rawBytes > MAX_SINGLE_JS_BYTES) {
    failures.push(
      `largest JavaScript chunk ${formatKiB(largestJavaScript.rawBytes)} exceeds ${formatKiB(MAX_SINGLE_JS_BYTES)}`,
    )
  }
  if (totalJavaScriptGzipBytes > MAX_TOTAL_JS_GZIP_BYTES) {
    failures.push(
      `total JavaScript gzip ${formatKiB(totalJavaScriptGzipBytes)} exceeds ${formatKiB(MAX_TOTAL_JS_GZIP_BYTES)}`,
    )
  }
  if (largestImage && largestImage.rawBytes > MAX_IMAGE_BYTES) {
    failures.push(`largest image ${formatKiB(largestImage.rawBytes)} exceeds ${formatKiB(MAX_IMAGE_BYTES)}`)
  }
  if (leakedEnvironmentKeys.size) {
    failures.push(`forbidden client environment keys found: ${[...leakedEnvironmentKeys].sort().join(', ')}`)
  }
  if (leakedEnvironmentValues.size) {
    failures.push(
      `backend environment values were compiled into client files: ${[...leakedEnvironmentValues].sort().join(', ')}`,
    )
  }

  console.log(
    `[${label}] Largest JavaScript: ${formatKiB(largestJavaScript.rawBytes)} (${path.relative(bundleDirectory, largestJavaScript.file)})`,
  )
  console.log(`[${label}] Total JavaScript gzip: ${formatKiB(totalJavaScriptGzipBytes)}`)
  console.log(
    largestImage
      ? `[${label}] Largest image: ${formatKiB(largestImage.rawBytes)} (${path.relative(bundleDirectory, largestImage.file)})`
      : `[${label}] Largest image: none`,
  )
  console.log(
    `[${label}] Forbidden backend keys/values: ${leakedEnvironmentKeys.size + leakedEnvironmentValues.size || 'none'}`,
  )

  if (failures.length) throw new Error(failures.map((failure) => `- ${failure}`).join('\n'))
}

function configuredBackendValues() {
  const env = loadEnv('production', ROOT_DIR, '')
  return BACKEND_ENV_KEYS.map((name) => [name, env[name] || process.env[name] || '']).filter(([, value]) =>
    /^https?:\/\//i.test(String(value).trim()),
  )
}

async function inspectBackendSentinelBundle() {
  const previousValues = new Map(BACKEND_ENV_KEYS.map((name) => [name, process.env[name]]))
  const sentinelDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'zzh-client-bundle-sentinel-'))
  try {
    BACKEND_ENV_KEYS.forEach((name, index) => {
      process.env[name] = `https://${index}.${SENTINEL_HOST_SUFFIX}`
    })
    await build({
      root: ROOT_DIR,
      mode: 'bundle-sentinel',
      logLevel: 'warn',
      build: { outDir: sentinelDirectory, emptyOutDir: true },
    })
    inspectBundle('sentinel', [['backend-origin-sentinel', SENTINEL_HOST_SUFFIX]], sentinelDirectory)
  } finally {
    for (const [name, value] of previousValues) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    fs.rmSync(sentinelDirectory, { recursive: true, force: true })
  }
}

try {
  inspectBundle('production', configuredBackendValues())
  await inspectBackendSentinelBundle()
  console.log('Client bundle check passed.')
} catch (error) {
  console.error(`Client bundle check failed:\n${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
