import { resolve } from 'node:path'
import { env } from 'node:process'
import config from '../../electron.vite.config.ts'

const beta = env.WALLET_TEST_BUILD === '1'
if (beta !== (env.TOUCH_ID_WALLET === '1') || env.TOUCH_ID_PROTOTYPE === '1') throw new Error('Select the stable wallet or its Touch ID beta.')
config.main.resolve = {
  alias: [{ find: /^\.\/walletKeychain$/, replacement: resolve('tests/wallet-touch-id/walletKeychain.fixture.ts') }],
}
for (const part of ['main', 'preload', 'renderer']) {
  config[part].build.outDir = resolve(beta ? 'test-results/wallet-touch-id-app' : 'test-results/stable-touch-id-app', part)
}
export default config
