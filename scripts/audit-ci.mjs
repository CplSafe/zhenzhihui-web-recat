import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

const AUDIT_LEVEL = 'moderate'
const REGISTRY = 'https://registry.npmjs.org'
const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 }
const AUDIT_LEVEL_RANK = SEVERITY_RANK[AUDIT_LEVEL]
// Documented exceptions for advisories that do not apply to this application.
// Key: `<package>:<GHSA-ID>`. Pin `versions` to the exact installed versions the
// analysis covers, so a later bump re-blocks until someone re-checks it.
// Entries belong here only while no fixed release exists — prefer upgrading.
const ALLOWED_ADVISORIES = new Map([])

function runAudit() {
  const npmCli = process.env.npm_execpath
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const args = npmCli
    ? [npmCli, 'audit', '--audit-level', AUDIT_LEVEL, '--json', '--registry', REGISTRY]
    : ['audit', '--audit-level', AUDIT_LEVEL, '--json', '--registry', REGISTRY]
  return spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, npm_config_registry: REGISTRY },
    maxBuffer: 20 * 1024 * 1024,
    shell: !npmCli && process.platform === 'win32',
  })
}

function advisoryId(advisory) {
  const match = String(advisory?.url || '').match(/GHSA-[\w-]+/i)
  return match?.[0]?.toUpperCase() || ''
}

function installedVersion(packageName, lockfile) {
  return String(lockfile?.packages?.[`node_modules/${packageName}`]?.version || '')
}

const result = runAudit()
if (result.error) {
  console.error(`Dependency audit could not start: ${result.error.message}`)
  process.exit(1)
}

let report
try {
  report = JSON.parse(result.stdout || '{}')
} catch {
  console.error('Dependency audit returned invalid JSON.')
  if (result.stderr) console.error(result.stderr.trim())
  process.exit(1)
}

if (report.error) {
  console.error(`Dependency audit failed: ${report.error.summary || report.error.message || 'unknown npm error'}`)
  process.exit(1)
}

const lockfile = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
const vulnerabilities = report.vulnerabilities || {}
const accepted = []
const memo = new Map()

function isBlocking(packageName, parents = new Set()) {
  if (memo.has(packageName)) return memo.get(packageName)
  const vulnerability = vulnerabilities[packageName]
  if (!vulnerability || SEVERITY_RANK[vulnerability.severity] < AUDIT_LEVEL_RANK) {
    memo.set(packageName, false)
    return false
  }
  if (parents.has(packageName)) return true

  const nextParents = new Set(parents).add(packageName)
  let blocking = false
  for (const via of vulnerability.via || []) {
    if (typeof via === 'string') {
      blocking ||= isBlocking(via, nextParents)
      continue
    }

    const id = advisoryId(via)
    const exception = ALLOWED_ADVISORIES.get(`${packageName}:${id}`)
    const version = installedVersion(packageName, lockfile)
    if (exception?.versions.has(version)) {
      accepted.push({ id, packageName, reason: exception.reason, severity: via.severity, version })
    } else if (SEVERITY_RANK[via.severity || vulnerability.severity] >= AUDIT_LEVEL_RANK) {
      blocking = true
    }
  }

  memo.set(packageName, blocking)
  return blocking
}

const blockingPackages = Object.keys(vulnerabilities).filter((packageName) => isBlocking(packageName))
const acceptedUnique = [
  ...new Map(accepted.map((item) => [`${item.packageName}:${item.id}:${item.version}`, item])).values(),
]

for (const item of acceptedUnique) {
  console.warn(`Accepted ${item.severity} advisory ${item.id} for ${item.packageName}@${item.version}: ${item.reason}`)
}

if (blockingPackages.length) {
  console.error(`Dependency audit found blocking vulnerabilities in: ${blockingPackages.sort().join(', ')}`)
  process.exit(1)
}

if (result.status !== 0 && result.status !== 1) {
  console.error(result.stderr.trim() || `Dependency audit exited with status ${result.status}.`)
  process.exit(1)
}

console.log(
  acceptedUnique.length
    ? `Dependency audit passed with ${acceptedUnique.length} documented non-applicable advisory exception.`
    : 'Dependency audit passed with no vulnerabilities at or above the configured threshold.',
)
