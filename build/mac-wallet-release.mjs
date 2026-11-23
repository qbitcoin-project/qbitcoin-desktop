import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import setMacUpdateMinimum from './mac-update-info.cjs'
import { assertMacDistributionEnv } from './mac-beta.mjs'
import { applyTouchIdFuses, compileTouchIdModule, verifyProbeBundle, writeSigningEntitlements } from './touch-id-probe.mjs'

// These hooks are selected by the stable distribution config. Keep both
// architecture slices in the resource, including during universal packaging.
export function beforePack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.WALLET_TEST_BUILD === '1' || process.env.TOUCH_ID_PROTOTYPE === '1' || process.env.TOUCH_ID_WALLET === '1') {
    throw new Error('Clear the beta build flags before packaging the stable wallet.')
  }
  setMacUpdateMinimum(context)
  const { packager } = context
  const root = packager.projectDir
  const identity = join(root, 'build/brand/macos-wallet-touch-id.json')
  if (!existsSync(identity) || JSON.parse(readFileSync(identity, 'utf8')).appId !== packager.appInfo.id) {
    throw new Error('The macOS wallet unlock configuration must match the release bundle ID.')
  }
  const source = process.env.WALLET_TOUCH_ID_PROFILE
  if (!source || !existsSync(source)) throw new Error('Set WALLET_TOUCH_ID_PROFILE to the Developer ID profile for ' + packager.appInfo.id)
  assertMacDistributionEnv(process.env, process.platform)
  const mac = packager.platformSpecificBuildOptions
  const profile = resolve(root, mac.provisioningProfile)
  const entitlements = resolve(root, mac.entitlements)
  mkdirSync(dirname(profile), { recursive: true })
  copyFileSync(source, profile)
  writeSigningEntitlements(root, profile, packager.appInfo.id, true, entitlements)
  compileTouchIdModule(root, join(dirname(profile), 'touch-id-wallet.node'), ['arm64', 'x64'], true)
}

function appBundle(context) {
  return join(context.appOutDir, context.packager.appInfo.productFilename + '.app')
}

export async function afterPack(context) {
  if (context.electronPlatformName === 'darwin') await applyTouchIdFuses(appBundle(context))
}

export async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const { packager } = context
  const mac = packager.platformSpecificBuildOptions
  await verifyProbeBundle(appBundle(context), {
    appId: packager.appInfo.id,
    mac: { entitlements: resolve(packager.projectDir, mac.entitlements), provisioningProfile: resolve(packager.projectDir, mac.provisioningProfile) },
  }, true)
}
