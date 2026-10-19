import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureTestStorage, TEST_BUILD } from '../../src/main/testBuild'
import { readNetworkProfile, writeNetworkProfile } from '../../src/main/vault/networkProfile'
import { loadBetaProfile, assertMacDistributionEnv } from '../../build/mac-beta.mjs'
import pkg from '../../package.json'

const dirs: string[] = []
function temporaryDir(): string {
  const parent = resolve('test-results/unit')
  mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'test-build-'))
  dirs.push(dir)
  return dir
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('test build storage', () => {
  it('leaves ordinary launches completely unchanged', () => {
    expect(TEST_BUILD).toBeNull()
    const app = { getPath: vi.fn(), setPath: vi.fn() }
    configureTestStorage(app)
    expect(app.getPath).not.toHaveBeenCalled()
    expect(app.setPath).not.toHaveBeenCalled()
  })

  it('isolates wallet and Chromium data and defaults only a new test installation to testnet', () => {
    const appData = temporaryDir()
    const ordinary = join(appData, 'fixture-wallet')
    mkdirSync(ordinary)
    writeNetworkProfile(ordinary, 'mainnet')
    writeFileSync(join(ordinary, 'vault.json'), 'existing wallet data')
    const app = { getPath: vi.fn(() => appData), setPath: vi.fn() }
    const identity = { productName: 'Fixture Wallet Test', dataDirName: 'fixture-wallet-test' }
    const testRoot = join(appData, identity.dataDirName)
    configureTestStorage(app, identity)
    expect(app.setPath.mock.calls).toEqual([['userData', testRoot], ['sessionData', testRoot]])
    expect(readNetworkProfile(testRoot)).toBe('testnet')
    writeNetworkProfile(testRoot, 'mainnet')
    configureTestStorage(app, identity)
    expect(readNetworkProfile(testRoot)).toBe('mainnet')
    expect(readFileSync(join(ordinary, 'vault.json'), 'utf8')).toBe('existing wallet data')
    expect(readNetworkProfile(ordinary)).toBe('mainnet')
  })

  it('rejects a path escape before reading or creating anything', () => {
    const app = { getPath: vi.fn(), setPath: vi.fn() }
    expect(() => configureTestStorage(app, { productName: 'Test', dataDirName: '../other-test' })).toThrow('Invalid test storage name')
    expect(app.getPath).not.toHaveBeenCalled()
  })
})

describe('macOS beta packaging', () => {
  it('uses consistent isolated metadata and builds only Apple Silicon without publishing', () => {
    const beta = loadBetaProfile(resolve('.'))
    const config = beta.config as {
      extends: unknown; publish: unknown; files: string[]; forceCodeSigning: boolean
      extraMetadata: { version: string; main: string; name: string }
      mac: { target: Array<{ target: string; arch: string[] }>; hardenedRuntime: boolean; notarize: boolean }
    }
    expect(beta.version).toMatch(/^\d+\.\d+\.\d+-beta\.\d+$/)
    expect(beta.version).not.toBe(pkg.version)
    expect(beta.notes.version).toBe(beta.version)
    expect(beta.notes.blocks.length).toBeGreaterThan(0)
    expect(config.extraMetadata.name).toBe(`${pkg.name}-test`)
    expect(beta.identity.dataDirName).toBe(config.extraMetadata.name)
    expect(config.extraMetadata.version).toBe(beta.version)
    expect(config.extraMetadata.main).toBe('./dist/beta-app/main/index.js')
    expect(config.files).toEqual(['dist/beta-app/**/*', 'package.json'])
    expect(config.extends).toBeNull()
    expect(config.publish).toBeNull()
    expect(config.forceCodeSigning).toBe(true)
    expect(config.mac.hardenedRuntime).toBe(true)
    expect(config.mac.notarize).toBe(true)
    expect(config.mac.target).toEqual([
      { target: 'dmg', arch: ['arm64'] }, { target: 'zip', arch: ['arm64'] },
    ])
    expect(pkg).not.toHaveProperty('productName')
  })

  it.each([
    {},
    { APPLE_ID: 'account' },
    { APPLE_API_KEY: 'key.p8', APPLE_KEYCHAIN_PROFILE: 'saved' },
    { APPLE_ID: 'account', APPLE_KEYCHAIN_PROFILE: 'saved' },
    { APPLE_KEYCHAIN_PROFILE: 'saved', CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  ])('refuses incomplete distribution setup: %j', (env) => {
    expect(() => assertMacDistributionEnv(env, 'darwin')).toThrow()
  })

  it.each([
    { APPLE_KEYCHAIN_PROFILE: 'saved' },
    { APPLE_KEYCHAIN_PROFILE: 'saved', APPLE_TEAM_ID: 'team' },
    { APPLE_API_KEY: 'key.p8', APPLE_API_KEY_ID: 'id', APPLE_API_ISSUER: 'issuer' },
    { APPLE_ID: 'account', APPLE_APP_SPECIFIC_PASSWORD: 'placeholder', APPLE_TEAM_ID: 'team' },
    { APPLE_KEYCHAIN_PROFILE: 'saved', CSC_LINK: 'certificate.p12', CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  ])('allows a complete configuration without reading its credentials: %j', (env) => {
    expect(() => assertMacDistributionEnv(env, 'darwin')).not.toThrow()
  })

  it('requires macOS for distribution', () => {
    expect(() => assertMacDistributionEnv({ APPLE_KEYCHAIN_PROFILE: 'saved' }, 'linux')).toThrow('macOS')
  })
})
