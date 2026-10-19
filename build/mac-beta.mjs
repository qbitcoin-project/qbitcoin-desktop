// Pure build planning. No certificate access, subprocesses or credential reads.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function loadBetaProfile(root) {
  const config = JSON.parse(readFileSync(join(root, 'electron-builder.beta.json'), 'utf8'))
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const notes = JSON.parse(readFileSync(join(root, 'releases/beta-notes.json'), 'utf8'))
  const { name, version, productName, main } = config.extraMetadata
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.[1-9]\d*$/.test(version)) {
    throw new Error('The test build must have an explicit X.Y.Z-beta.N version.')
  }
  if (name !== `${pkg.name}-test` || productName !== config.productName || main !== './dist/beta-app/main/index.js') {
    throw new Error('The test build must use its own name, identity and compiled entry point.')
  }
  if (config.publish !== null || config.forceCodeSigning !== true || config.mac.notarize !== true || config.mac.hardenedRuntime !== true) {
    throw new Error('Test distribution requires signing and notarization, with publishing disabled.')
  }
  const output = `release/beta/${version}`
  return {
    config: { ...config, directories: { ...config.directories, output } },
    identity: { productName, dataDirName: name },
    version,
    notes: { ...notes, version },
    output,
  }
}

// electron-builder may silently skip notarization without credentials. Require
// one complete method before a user explicitly starts distribution packaging.
export function assertMacDistributionEnv(env, platform) {
  if (platform !== 'darwin') throw new Error('Signed macOS packaging must run on macOS.')
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false' && !env.CSC_LINK) {
    throw new Error('Certificate discovery is disabled and no signing certificate is configured.')
  }
  if (env.APPLE_ID || env.APPLE_APP_SPECIFIC_PASSWORD) {
    if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) return
    throw new Error('Set all three APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID values.')
  }
  if (env.APPLE_API_KEY || env.APPLE_API_KEY_ID || env.APPLE_API_ISSUER) {
    if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) return
    throw new Error('Set all three APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER values.')
  }
  if (env.APPLE_KEYCHAIN_PROFILE) return
  throw new Error('Configure APPLE_KEYCHAIN_PROFILE or another complete notarization method. See docs/signing-macos.md.')
}

