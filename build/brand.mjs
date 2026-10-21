// Brand separation check: the current brand's names stay inside brand paths,
// and every file in a marked brand folder says it belongs to the brand. The
// layout lives in build/brand-paths.json. Read-only; run from the project root.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

const root = realpathSync(process.cwd())
const json = (value) => `${JSON.stringify(value, null, 2)}\n`
const fail = (message) => { throw new Error(message) }
const marker = /^\s*(?:\/\/|\/\*|\*|#|<!--)\s*BRAND FILE:/

function document(name) { return JSON.parse(readFileSync(join(root, name), 'utf8')) }

function layout() {
  const value = document('build/brand-paths.json')
  const keys = ['schemaVersion', 'markedDirectories', 'paths', 'packageKeys', 'allowed']
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join() !== [...keys].sort().join() || value.schemaVersion !== 1) fail('Invalid build/brand-paths.json')
  for (const key of keys.slice(1)) if (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== 'string' || !item)) fail('Invalid build/brand-paths.json')
  if (value.markedDirectories.some((folder) => !folder.endsWith('/'))) fail('Marked brand folders must end with /')
  return value
}

const within = (name, entries) => entries.some((entry) => entry.endsWith('/') ? name.startsWith(entry) : name === entry)

function check() {
  const paths = layout()
  const cfg = document('release.config.json')
  const names = [...new Set([cfg.brand, cfg.productName, ...(cfg.aliases ?? [])].filter(Boolean))]
  const pattern = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const brandName = names.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'iu') : null
  // package.json keeps brand values in a few top-level keys; the rest is shared.
  const packageKey = new RegExp(`^ {2}"(?:${paths.packageKeys.join('|')})"\\s*:`)
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const files = [...new Set(listed.split('\0').filter(Boolean))].sort().filter((name) => existsSync(join(root, name)))
  const problems = []
  for (const name of files) {
    const bytes = readFileSync(join(root, name))
    if (bytes.subarray(0, 8000).includes(0)) continue
    const lines = bytes.toString('utf8').split('\n')
    if (within(name, paths.markedDirectories)) {
      if (!lines.some((line) => marker.test(line))) problems.push(`${name}:1: missing BRAND FILE marker`)
      continue
    }
    if (within(name, paths.paths)) continue
    if (/^changes\/[^/]+\.json$/.test(name) && JSON.parse(lines.join('\n'))?.scope === cfg.brand) continue
    lines.forEach((line, index) => {
      if (marker.test(line)) problems.push(`${name}:${index + 1}: BRAND FILE marker outside brand paths`)
      if (!brandName || (name === 'package.json' && packageKey.test(line))) return
      const found = brandName.exec(paths.allowed.reduce((rest, allowed) => rest.split(allowed).join(' '), line))
      if (found) problems.push(`${name}:${index + 1}: brand name "${found[0]}" outside brand paths`)
    })
  }
  if (problems.length) fail(problems.join('\n'))
  return { brandCheck: 'ok', files: files.length }
}

try {
  if (process.argv.length !== 3 || process.argv[2] !== 'check') fail('Usage: node build/brand.mjs check')
  process.stdout.write(json(check()))
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
