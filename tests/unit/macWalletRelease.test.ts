import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { afterPack, afterSign, beforePack } from '../../build/mac-wallet-release.mjs'
import { applyTouchIdFuses, compileTouchIdModule, verifyProbeBundle, writeSigningEntitlements } from '../../build/touch-id-probe.mjs'

vi.mock('../../build/mac-beta.mjs', () => ({ assertMacDistributionEnv: vi.fn() }))
vi.mock('../../build/touch-id-probe.mjs', () => ({
  compileTouchIdModule: vi.fn(), writeSigningEntitlements: vi.fn(), applyTouchIdFuses: vi.fn(), verifyProbeBundle: vi.fn(),
}))

const appId = 'org.example.release'
const mac = { minimumSystemVersion: '13.0.0', provisioningProfile: 'stage/wallet.provisionprofile', entitlements: 'stage/entitlements.plist' }
let root: string
function fixture() {
  const parent = resolve('test-results/unit')
  mkdirSync(parent, { recursive: true })
  root = mkdtempSync(join(parent, 'stable-signing-'))
  mkdirSync(join(root, 'build/brand'), { recursive: true })
  writeFileSync(join(root, 'build/brand/macos-wallet-touch-id.json'), JSON.stringify({ appId }))
  return { electronPlatformName: 'darwin', appOutDir: root, packager: {
    config: {}, projectDir: root, appInfo: { id: appId, productFilename: 'Fixture' }, platformSpecificBuildOptions: { ...mac },
  } }
}
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); if (root) rmSync(root, { recursive: true, force: true }) })

it('stages the selected stable profile and both native slices and verifies the actual output bundle', async () => {
  const context = fixture()
  for (const key of ['WALLET_TEST_BUILD', 'TOUCH_ID_WALLET', 'TOUCH_ID_PROTOTYPE']) vi.stubEnv(key, '0')
  const input = join(root, 'production.provisionprofile')
  writeFileSync(input, 'fixture-profile')
  vi.stubEnv('WALLET_TOUCH_ID_PROFILE', input)
  beforePack(context)
  const profile = join(root, mac.provisioningProfile)
  const entitlements = join(root, mac.entitlements)
  expect(readFileSync(profile, 'utf8')).toBe('fixture-profile')
  expect(writeSigningEntitlements).toHaveBeenCalledWith(root, profile, appId, true, entitlements)
  expect(compileTouchIdModule).toHaveBeenCalledWith(root, join(root, 'stage/touch-id-wallet.node'), ['arm64', 'x64'], true)
  await afterPack(context)
  await afterSign(context)
  expect(applyTouchIdFuses).toHaveBeenCalledWith(join(root, 'Fixture.app'))
  expect(verifyProbeBundle).toHaveBeenCalledWith(join(root, 'Fixture.app'), { appId, mac: { entitlements, provisioningProfile: profile } }, true)
})

it('keeps the stable packaging hooks out of other platforms and rejects beta flags on macOS', async () => {
  const context = fixture()
  vi.stubEnv('WALLET_TEST_BUILD', '1')
  for (const platform of ['win32', 'linux']) {
    const other = { ...context, electronPlatformName: platform }
    beforePack(other)
    await afterPack(other)
    await afterSign(other)
  }
  expect(() => beforePack(context)).toThrow('beta build flags')
  expect(compileTouchIdModule).not.toHaveBeenCalled()
  expect(applyTouchIdFuses).not.toHaveBeenCalled()
  expect(verifyProbeBundle).not.toHaveBeenCalled()
})
