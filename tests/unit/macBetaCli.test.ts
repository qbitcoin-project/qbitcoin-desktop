import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function fixture(): { root: string; output: string; env: NodeJS.ProcessEnv } {
  const parent = resolve('test-results/unit')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(join(parent, 'beta-cli-'))
  dirs.push(root)
  for (const path of ['build', 'releases', 'bin']) mkdirSync(join(root, path))
  for (const file of ['build-mac-beta.mjs', 'mac-beta.mjs']) copyFileSync(resolve('build', file), join(root, 'build', file))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture-wallet', version: '1.0.0' }))
  writeFileSync(join(root, 'electron-builder.beta.json'), JSON.stringify({
    extends: null, appId: 'org.example.fixture.test', productName: 'Fixture Wallet Test', publish: null, forceCodeSigning: true,
    directories: { output: 'release/beta' },
    extraMetadata: { name: 'fixture-wallet-test', productName: 'Fixture Wallet Test', version: '1.1.0-beta.1', main: './dist/beta-app/main/index.js' },
    mac: {
      notarize: true, hardenedRuntime: true,
      target: [{ target: 'dmg', arch: ['arm64'] }, { target: 'zip', arch: ['arm64'] }],
      artifactName: 'Fixture-Wallet-Test-${version}-${arch}.${ext}',
    },
  }))
  mkdirSync(join(root, 'build/brand'))
  writeFileSync(join(root, 'build/brand/touch-id-prototype.json'), JSON.stringify({ appId: 'org.example.fixture.probe' }))
  writeFileSync(join(root, 'releases/beta-notes.json'), JSON.stringify({ date: '2026-01-01', blocks: [{ kind: 'paragraph', text: 'Test notes.' }] }))
  // No real build, Electron, certificate or notarization tool is invoked.
  writeFileSync(join(root, 'bin/pnpm'), `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.CALL_LOG, JSON.stringify(process.argv.slice(2)) + '\\n')
process.exit(Number(process.env.STUB_EXIT || 0))
`, { mode: 0o755 })
  for (const tool of ['codesign', 'spctl', 'xcrun']) {
    writeFileSync(join(root, 'bin', tool), `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.VERIFY_LOG, JSON.stringify([${JSON.stringify(tool)}, ...process.argv.slice(2)]) + '\\n')
if (!require('node:fs').existsSync(process.argv.at(-1))) process.exit(1)
`, { mode: 0o755 })
  }
  const env = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, CALL_LOG: join(root, 'calls.jsonl') }
  for (const key of Object.keys(env)) {
    if (key.startsWith('APPLE_') || key.startsWith('CSC_') || key.startsWith('TOUCH_ID_') || key === 'WALLET_TEST_BUILD') delete env[key as keyof typeof env]
  }
  return { root, output: join(root, 'release/beta/1.1.0-beta.1'), env }
}

describe.runIf(process.platform !== 'win32')('beta build CLI (stubbed subprocess)', () => {
  it('prepare-only invokes only the compiler and never starts distribution', () => {
    const { root, output, env } = fixture()
    const result = spawnSync(process.execPath, ['build/build-mac-beta.mjs', '--prepare-only'], { cwd: root, env, encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(join(root, 'calls.jsonl'), 'utf8')).toBe('["exec","electron-vite","build"]\n')
    expect(JSON.parse(readFileSync(join(output, 'builder-config.json'), 'utf8'))).toMatchObject({ appId: 'org.example.fixture.test', publish: null })
    expect(readFileSync(join(output, 'TESTING.md'), 'utf8')).toContain('1.1.0-beta.1')
    expect(existsSync(join(output, 'SHA256SUMS.txt'))).toBe(false)
  })

  it('refuses distribution before spawning anything when notarization is not configured', () => {
    const { root, env } = fixture()
    const result = spawnSync(process.execPath, ['build/build-mac-beta.mjs', '--distribute'], { cwd: root, env, encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(existsSync(join(root, 'calls.jsonl'))).toBe(false)
  })

  it('stages the isolated prototype entry points and manual in a separate output directory', () => {
    const { root, output, env } = fixture()
    writeFileSync(join(root, 'build/touch-id-probe.mjs'), 'export function buildProbe() {}')
    mkdirSync(join(root, 'native/macos-touch-id'), { recursive: true })
    writeFileSync(join(root, 'native/macos-touch-id/TESTING.md'), 'Prototype checks')
    const result = spawnSync(process.execPath, ['build/build-mac-beta.mjs', '--prepare-only'], {
      cwd: root, env: { ...env, TOUCH_ID_PROTOTYPE: '1' }, encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    const settings = JSON.parse(readFileSync(join(output, 'touch-id/builder-config.json'), 'utf8'))
    expect(settings.appId).toBe('org.example.fixture.probe')
    expect(settings.extraMetadata.main).toBe('./dist/touch-id-app/main/index.js')
    expect(settings.files).toEqual(['dist/touch-id-app/**/*', 'package.json'])
    expect(readFileSync(join(output, 'touch-id/TESTING.md'), 'utf8')).toBe('Prototype checks')
    expect(existsSync(join(output, 'builder-config.json'))).toBe(false)
  })

  it('prepares the wallet with the installed vault package and its own data and artifact paths', () => {
    const { root, output, env } = fixture()
    for (const path of ['native/macos-touch-id', 'node_modules/.bin']) {
      mkdirSync(join(root, path), { recursive: true })
    }
    writeFileSync(join(root, 'build/touch-id-probe.mjs'), 'export function buildProbe() {}')
    writeFileSync(join(root, 'native/macos-touch-id/WALLET.md'), 'Wallet checks')
    copyFileSync(join(root, 'bin/pnpm'), join(root, 'node_modules/.bin/electron-vite'))
    const result = spawnSync(process.execPath, ['build/build-mac-beta.mjs', '--prepare-only'], {
      cwd: root, env: { ...env, TOUCH_ID_WALLET: '1' }, encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(join(root, 'calls.jsonl'), 'utf8')).toBe('["build"]\n')
    const settings = JSON.parse(readFileSync(join(output, 'touch-id-wallet/builder-config.json'), 'utf8'))
    expect(settings.extraMetadata).toMatchObject({ name: 'fixture-wallet-touch-id-test', main: './dist/touch-id-wallet/main/index.js' })
    expect(readFileSync(join(output, 'touch-id-wallet/TESTING.md'), 'utf8')).toBe('Wallet checks')
  })

  it.runIf(process.platform === 'darwin')('removes an old completion marker even when recompilation fails', () => {
    const { root, output, env } = fixture()
    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, 'SHA256SUMS.txt'), 'old successful build')
    const result = spawnSync(process.execPath, ['build/build-mac-beta.mjs', '--distribute'], {
      cwd: root, env: { ...env, APPLE_KEYCHAIN_PROFILE: 'unused-fixture', STUB_EXIT: '1' }, encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(existsSync(join(output, 'SHA256SUMS.txt'))).toBe(false)
    expect(readFileSync(join(root, 'calls.jsonl'), 'utf8')).toBe('["exec","electron-vite","build"]\n')
  })

  it.runIf(process.platform === 'darwin')('accepts API credentials and verifies only the configured architecture (all tools stubbed)', () => {
    const { root, output, env } = fixture()
    const appPath = join(output, 'mac-arm64', 'Fixture Wallet Test.app')
    mkdirSync(appPath, { recursive: true })
    for (const ext of ['dmg', 'zip']) writeFileSync(join(output, `Fixture-Wallet-Test-1.1.0-beta.1-arm64.${ext}`), 'fixture artifact')
    const verificationLog = join(root, 'verification.jsonl')
    const result = spawnSync(process.execPath, ['build/build-mac-beta.mjs', '--distribute'], {
      cwd: root, encoding: 'utf8', env: {
        ...env, VERIFY_LOG: verificationLog,
        APPLE_API_ISSUER: 'fixture-issuer', APPLE_API_KEY_ID: 'fixture-id', APPLE_API_KEY: 'unused-fixture.p8',
      },
    })
    expect(result.status, result.stderr).toBe(0)
    const calls = readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(calls[1]).toEqual(['exec', 'electron-builder', '--mac', '--config', join(output, 'builder-config.json'), '--publish', 'never'])
    const checks = readFileSync(verificationLog, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[])
    expect(checks.map(args => args[0])).toEqual(['codesign', 'spctl', 'xcrun'])
    expect(checks.every(args => args.at(-1) === appPath)).toBe(true)
    const hashes = readFileSync(join(output, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')
    expect(hashes).toHaveLength(2)
    expect(hashes.every(line => /^[a-f0-9]{64} {2}Fixture-Wallet-Test-1\.1\.0-beta\.1-arm64\.(dmg|zip)$/.test(line))).toBe(true)
  })
})
