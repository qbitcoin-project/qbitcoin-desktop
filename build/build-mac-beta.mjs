import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { loadBetaProfile, assertMacDistributionEnv } from './mac-beta.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
if (args.length !== 1 || !['--prepare-only', '--distribute'].includes(args[0])) {
  throw new Error('Use --prepare-only (compile only) or --distribute (sign and notarize).')
}
const distribute = args[0] === '--distribute'
const beta = loadBetaProfile(root)
const probe = process.env.TOUCH_ID_PROTOTYPE === '1'
const wallet = process.env.TOUCH_ID_WALLET === '1'
if (probe && wallet) throw new Error('Select one Touch ID beta mode.')
if (wallet) {
  const { Vault } = await import('@qbtc/vault')
  if (typeof Vault.prototype.verifyPassword !== 'function' || typeof Vault.prototype.enrollDeviceKey !== 'function' || typeof Vault.prototype.unlockWithDeviceKey !== 'function') {
    throw new Error('Install the pinned wallet dependencies with pnpm install --frozen-lockfile before building the Touch ID beta.')
  }
}
const probeTools = probe || wallet ? await import('./touch-id-probe.mjs') : null
if (probeTools) {
  const identityPath = join(root, 'build/brand/touch-id-prototype.json')
  if (wallet && !existsSync(identityPath)) throw new Error('This profile does not enable the Touch ID test wallet.')
  if (existsSync(identityPath)) {
    const { appId } = JSON.parse(readFileSync(identityPath, 'utf8'))
    if (typeof appId !== 'string' || !/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(appId)) {
      throw new Error('Invalid Touch ID prototype appId in ' + identityPath)
    }
    beta.config.appId = appId
  }
  beta.output += wallet ? '/touch-id-wallet' : '/touch-id'
  beta.config.directories.output = beta.output
  const dir = wallet ? 'dist/touch-id-wallet' : 'dist/touch-id-app'
  beta.config.files = [dir + '/**/*', 'package.json']
  beta.config.extraMetadata.main = './' + dir + '/main/index.js'
  if (wallet) beta.config.extraMetadata.name = beta.config.extraMetadata.name.replace(/-test$/, '-touch-id-test')
}
if (distribute) assertMacDistributionEnv(process.env, process.platform)
const output = resolve(root, beta.output)
// A failed repeat must not leave an old completion marker beside partial files.
if (distribute) rmSync(join(output, 'SHA256SUMS.txt'), { force: true })

function run(command, commandArgs, env = process.env) {
  const result = spawnSync(command, commandArgs, { cwd: root, env, stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function runBuildTool(name, args, env = process.env) {
  if (wallet) run(join(root, 'node_modules', '.bin', name), args, env)
  else run('pnpm', ['exec', name, ...args], env)
}

if (probeTools) probeTools.buildProbe(root, beta.config, distribute, wallet)
runBuildTool('electron-vite', ['build'], { ...process.env, WALLET_TEST_BUILD: '1' })
mkdirSync(output, { recursive: true })
const configPath = join(output, 'builder-config.json')
writeFileSync(configPath, `${JSON.stringify(beta.config, null, 2)}\n`)
const notes = beta.notes.blocks.map((block) => block.kind === 'list'
  ? block.items.map((item) => `- ${item}`).join('\n')
  : `${block.kind === 'heading' ? '## ' : ''}${block.text}`).join('\n\n')
writeFileSync(join(output, 'TESTING.md'), probeTools ? readFileSync(join(root, 'native/macos-touch-id', wallet ? 'WALLET.md' : 'TESTING.md')) :
  `# ${beta.identity.productName} ${beta.version}\n\n${notes}\n`)

if (distribute) {
  runBuildTool('electron-builder', ['--mac', '--config', configPath, '--publish', 'never'])
  const architectures = new Set(beta.config.mac.target.flatMap((target) => target.arch))
  for (const arch of architectures) {
    const folder = arch === 'x64' ? 'mac' : `mac-${arch}`
    const appPath = join(output, folder, `${beta.identity.productName}.app`)
    if (probeTools) await probeTools.verifyProbeBundle(appPath, beta.config, wallet)
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
    run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
    run('xcrun', ['stapler', 'validate', appPath])
  }
  const checksums = []
  for (const target of beta.config.mac.target) {
    for (const arch of target.arch) {
      const filename = beta.config.mac.artifactName
        .replace('${version}', beta.version).replace('${arch}', arch).replace('${ext}', target.target)
      const hash = createHash('sha256').update(readFileSync(join(output, filename))).digest('hex')
      checksums.push(`${hash}  ${filename}`)
    }
  }
  writeFileSync(join(output, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`)
  console.log(`Signed and notarized test artifacts verified: ${beta.output}`)
} else {
  console.log(`Prepared ${beta.identity.productName} ${beta.version}. No signing or packaging was performed.`)
  console.log(wallet ? 'Set TOUCH_ID_PROFILE and use TOUCH_ID_WALLET=1 pnpm dist:mac:beta to sign the test wallet.' : probe ? 'Set TOUCH_ID_PROFILE and run TOUCH_ID_PROTOTYPE=1 pnpm dist:mac:beta to sign the prototype.' :
    'Run pnpm dist:mac:beta yourself after configuring notarization; see docs/signing-macos.md.')
}
