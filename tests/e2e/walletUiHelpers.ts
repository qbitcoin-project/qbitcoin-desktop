import { dirname, join, resolve } from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { _electron as electron } from '@playwright/test'
import { freshUserData } from './privacyHelpers'

let bundle: Promise<unknown> | undefined

export async function launchWalletUi(query = '') {
  const root = process.cwd()
  const fixtures = join(root, 'tests/e2e/fixtures')
  const outDir = join(root, 'test-results/wallet-ui-bundle')
  bundle ??= build({
    configFile: false,
    root: fixtures,
    base: './',
    logLevel: 'error',
    define: { __APP_VERSION__: '"test"', __CHANGELOG__: '[]' },
    plugins: [react(), {
      name: 'wallet-test-api',
      enforce: 'pre',
      resolveId(id, importer) {
        if (importer && resolve(dirname(importer), id) === join(root, 'src/renderer/lib/wallet')) return join(fixtures, 'wallet-mock.js')
        return null
      },
    }],
    build: { outDir, emptyOutDir: true, rollupOptions: { input: join(fixtures, 'wallet-ui.html') } },
  })
  await bundle
  const app = await electron.launch({ args: [join(fixtures, 'wallet-ui-host.cjs'), join(outDir, 'wallet-ui.html'), freshUserData(), query] })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.reload()
    await page.waitForFunction(() => document.querySelector('#root')?.childElementCount, undefined, { timeout: 5000 }).catch(() => { throw new Error(`Wallet fixture failed to render: ${errors.join('; ')}`) })
    return { app, page }
  } catch (error) {
    await app.close()
    throw error
  }
}
