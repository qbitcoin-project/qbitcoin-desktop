import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
const scriptPath = join(projectRoot, 'build/brand.mjs')
const fixtureParent = join(projectRoot, 'test-results')
const commandEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '' }

let root: string

function write(name: string, content: string | Buffer) {
  const path = join(root, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
function writeJson(name: string, value: unknown) { write(name, `${JSON.stringify(value, null, 2)}\n`) }
function git(...args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: commandEnv })
  expect(result.status, result.stderr).toBe(0)
}
function check() { return spawnSync(process.execPath, [scriptPath, 'check'], { cwd: root, encoding: 'utf8', env: commandEnv }) }
function passes() {
  const result = check()
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toMatchObject({ brandCheck: 'ok' })
}
function fails(...expected: string[]) {
  const result = check()
  expect(result.status, result.stdout).not.toBe(0)
  for (const text of expected) expect(result.stderr).toContain(text)
}

beforeEach(() => {
  mkdirSync(fixtureParent, { recursive: true })
  root = mkdtempSync(join(fixtureParent, 'brand-check-'))
  writeJson('release.config.json', {
    schemaVersion: 1, brand: 'north', releaseBranch: 'north', tagPrefix: 'north-v', packageName: 'north-wallet',
    productName: 'North Wallet', aliases: ['North', 'northscan.org'], upstreamScopes: [],
  })
  writeJson('build/brand-paths.json', {
    schemaVersion: 1,
    markedDirectories: ['src/main/brand/', 'tests/unit/brand/'],
    paths: ['releases/', 'README.md', 'release.config.json'],
    packageKeys: ['name', 'version', 'description', 'author'],
    allowed: ['@north/'],
  })
  writeJson('package.json', {
    name: 'north-wallet', version: '1.0.0', description: 'North Wallet for the desktop', author: 'North',
    dependencies: { '@north/crypto': '1.0.0' },
  })
  write('README.md', '# North Wallet\n')
  write('src/main/brand/profile.ts', '// BRAND FILE: this chain\'s values.\nexport const NAME = \'North\'\n')
  write('src/a.ts', 'export const a = 1\n')
  writeJson('changes/own-change.json', { id: 'own-change', scope: 'north', type: 'added', bump: 'minor', text: 'North Wallet adds a feature.' })
  git('init', '--quiet', '--template=')
  git('add', '--all')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Create fixture')
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('brand separation check', () => {
  it('passes when brand names stay in brand paths', () => {
    passes()
  })

  it('reports a brand name or explorer domain outside brand paths with file and line', () => {
    write('src/a.ts', 'export const a = 1\nexport const site = \'https://northscan.org/tx/\'\n')
    write('src/b.ts', 'export const label = \'North\'\n')
    fails('src/a.ts:2: brand name "northscan.org"', 'src/b.ts:1: brand name "North"')
  })

  it('ignores allowed package scopes, package brand keys and own-brand notes', () => {
    write('src/c.ts', 'export { tool } from \'@north/crypto\'\n')
    passes()
  })

  it('requires the marker in every brand-folder file', () => {
    write('src/main/brand/extra.ts', 'export const EXTRA = 1\n')
    fails('src/main/brand/extra.ts:1: missing BRAND FILE marker')
  })

  it('rejects the marker outside brand paths', () => {
    write('src/d.ts', '// BRAND FILE: misplaced.\nexport const d = 1\n')
    fails('src/d.ts:1: BRAND FILE marker outside brand paths')
  })

  it('skips binary files', () => {
    write('src/mark.bin', Buffer.concat([Buffer.from('North'), Buffer.from([0, 1, 2])]))
    passes()
  })

  it('checks new untracked files too', () => {
    write('src/new.ts', 'export const fresh = \'North\'\n')
    fails('src/new.ts:1: brand name "North"')
  })

  it('finds a testnet ticker only when it is listed as an alias', () => {
    write('src/e.ts', 'export const fee = \'0.1 tNRT\'\n')
    passes()
    writeJson('release.config.json', {
      schemaVersion: 1, brand: 'north', releaseBranch: 'north', tagPrefix: 'north-v', packageName: 'north-wallet',
      productName: 'North Wallet', aliases: ['North', 'NRT', 'tNRT', 'northscan.org'], upstreamScopes: [],
    })
    fails('src/e.ts:1: brand name "tNRT"')
  })
})
