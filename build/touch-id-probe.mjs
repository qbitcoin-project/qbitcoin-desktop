// Native build, entitlement generation and signature checks shared by the macOS wallets.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { flipFuses, FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses'

export const touchIdFuses = {
  runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true,
}

export function keychainIdentity(rights, prefix, appId, wallet) {
  const identifier = prefix + '.' + appId
  const group = wallet ? identifier + '.vault-unlock' : identifier
  const permits = (pattern, value) => typeof pattern === 'string' && (pattern === value ||
    (pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1))))
  if (!permits(rights['com.apple.application-identifier'], identifier) ||
      !rights['keychain-access-groups']?.some(pattern => permits(pattern, group))) {
    throw new Error('The provisioning profile must authorize ' + identifier + ' and Keychain group ' + group)
  }
  return { identifier, group }
}

export async function verifyTouchIdFuses(appPath) {
  const wire = await getCurrentFuseWire(appPath)
  if (wire.version !== FuseVersion.V1) throw new Error('Unexpected Electron fuse version.')
  for (const [name, enabled] of Object.entries(touchIdFuses)) {
    const option = name[0].toUpperCase() + name.slice(1)
    if (wire[FuseV1Options[option]] !== (enabled ? 0x31 : 0x30)) {
      throw new Error('Unexpected Electron fuse setting: ' + option)
    }
  }
}

export async function applyTouchIdFuses(appPath) {
  const wire = { version: FuseVersion.V1 }
  for (const [name, value] of Object.entries(touchIdFuses)) {
    wire[FuseV1Options[name[0].toUpperCase() + name.slice(1)]] = value
  }
  await flipFuses(appPath, wire)
  await verifyTouchIdFuses(appPath)
}

export function compileTouchIdModule(root, binary, architectures, wallet) {
  if (process.platform !== 'darwin') throw new Error('Building the Touch ID module requires macOS.')
  mkdirSync(dirname(binary), { recursive: true })
  const headers = resolve(dirname(process.execPath), '../include/node')
  if (!existsSync(join(headers, 'node_api.h'))) throw new Error('Install Node.js with its Node-API headers before building Touch ID.')
  const args = []
  for (const arch of new Set(architectures)) {
    if (arch !== 'arm64' && arch !== 'x64') throw new Error('Unsupported Touch ID architecture: ' + arch)
    args.push('-arch', arch === 'x64' ? 'x86_64' : arch)
  }
  execFileSync('xcrun', ['--sdk', 'macosx', 'clang++', ...args, '-std=c++17', '-fobjc-arc', '-bundle',
    '-Wl,-undefined,dynamic_lookup', '-mmacosx-version-min=13.0', '-DNAPI_VERSION=8', '-I', headers,
    ...(wallet ? ['-DWALLET_TOUCH_ID=1'] : []), '-framework', 'Foundation', '-framework', 'Security', '-framework', 'LocalAuthentication',
    join(root, 'native/macos-touch-id/probe.mm'), '-o', binary], { stdio: 'inherit' })
}

export function writeSigningEntitlements(root, profile, appId, wallet, path) {
  const decoded = execFileSync('security', ['cms', '-D', '-i', resolve(profile)])
  const extract = (key, format) => execFileSync('plutil', ['-extract', key, format, '-o', '-', '--', '-'], { input: decoded, encoding: 'utf8' }).trim()
  const rights = JSON.parse(extract('Entitlements', 'json'))
  const prefix = JSON.parse(extract('ApplicationIdentifierPrefix', 'json'))[0]
  const team = rights['com.apple.developer.team-identifier']
  if (!/^[A-Z0-9]+$/.test(prefix ?? '') || !/^[A-Z0-9]+$/.test(team ?? '') || !/^[a-zA-Z0-9.-]+$/.test(appId)) {
    throw new Error('Invalid identity in the Developer ID profile.')
  }
  const { identifier, group } = keychainIdentity(rights, prefix, appId, wallet)
  const base = readFileSync(resolve(root, 'resources/entitlements.touch-id.plist'), 'utf8')
  writeFileSync(path, base.replace('</dict>', [
    '<key>com.apple.application-identifier</key><string>' + identifier + '</string>',
    '<key>com.apple.developer.team-identifier</key><string>' + team + '</string>',
    '<key>keychain-access-groups</key><array><string>' + group + '</string></array>', '</dict>',
  ].join('\n')))
}

export function buildProbe(root, config, distribute, wallet = false) {
  const output = resolve(root, config.directories.output)
  const moduleName = wallet ? 'touch-id-wallet.node' : 'touch-id-probe.node'
  const binary = resolve(root, 'dist/touch-id-native', moduleName)
  compileTouchIdModule(root, binary, config.mac.target.flatMap(target => target.arch), wallet)
  config.extraResources = [{ from: binary, to: moduleName }]
  config.electronFuses = { ...config.electronFuses, ...touchIdFuses }
  config.mac.entitlements = 'resources/entitlements.touch-id.plist'
  config.mac.entitlementsInherit = config.mac.entitlements
  mkdirSync(output, { recursive: true })
  if (!distribute) return
  const profile = process.env.TOUCH_ID_PROFILE
  if (!profile || !existsSync(profile)) throw new Error('Set TOUCH_ID_PROFILE to the Developer ID provisioning profile for ' + config.appId)
  const path = join(output, 'probe-entitlements.plist')
  writeSigningEntitlements(root, profile, config.appId, wallet, path)
  config.mac.entitlements = path
  config.mac.provisioningProfile = resolve(profile)
  config.mac.preAutoEntitlements = false
}

export async function verifyProbeBundle(appPath, config, wallet = false) {
  await verifyTouchIdFuses(appPath)
  const bundleId = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-',
    join(appPath, 'Contents/Info.plist')], { encoding: 'utf8' }).trim()
  if (bundleId !== config.appId) throw new Error('Unexpected signed bundle identifier: ' + bundleId)
  const embedded = readFileSync(join(appPath, 'Contents/embedded.provisionprofile'))
  if (!embedded.equals(readFileSync(config.mac.provisioningProfile))) throw new Error('Unexpected embedded provisioning profile.')
  const parse = input => JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input, encoding: 'utf8' }))
  const actual = parse(execFileSync('codesign', ['--display', '--entitlements', '-', '--xml', appPath]))
  const expected = parse(readFileSync(config.mac.entitlements))
  const identifier = expected['com.apple.application-identifier']
  if (actual['com.apple.security.cs.disable-library-validation'] || actual['com.apple.security.cs.allow-unsigned-executable-memory'] ||
      actual['com.apple.security.get-task-allow'] || actual['com.apple.application-identifier'] !== identifier ||
      actual['com.apple.developer.team-identifier'] !== expected['com.apple.developer.team-identifier'] ||
      actual['keychain-access-groups']?.length !== 1 || actual['keychain-access-groups'][0] !== expected['keychain-access-groups'][0]) {
    throw new Error('The signed application does not have its expected Keychain entitlement.')
  }
  const team = expected['com.apple.developer.team-identifier']
  const teamRequirement = '=anchor apple generic and certificate leaf[subject.OU] = "' + team + '"'
  execFileSync('codesign', ['--verify', '--strict', '-R', teamRequirement,
    join(appPath, 'Contents/Resources', wallet ? 'touch-id-wallet.node' : 'touch-id-probe.node')], { stdio: 'inherit' })
}
