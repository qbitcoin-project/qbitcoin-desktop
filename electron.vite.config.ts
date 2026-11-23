import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { PRODUCTION_CSP } from './src/shared/csp'
import { parseChangelog } from './src/shared/changelog'
import { version } from './package.json'
import { loadBetaProfile } from './build/mac-beta.mjs'

const beta = process.env.WALLET_TEST_BUILD === '1' ? loadBetaProfile(__dirname) : null
const probe = process.env.TOUCH_ID_PROTOTYPE === '1'
const wallet = process.env.TOUCH_ID_WALLET === '1'
if ((probe || wallet) && !beta || (probe && wallet)) throw new Error('Select one Touch ID mode through the macOS beta build script.')
const betaDir = wallet ? 'dist/touch-id-wallet' : probe ? 'dist/touch-id-app' : 'dist/beta-app'
const identity = beta?.identity
if (wallet && identity) identity.dataDirName = identity.dataDirName.replace(/-test$/, '-touch-id-test')
const walletTouchId = beta ? wallet : existsSync(resolve(__dirname, 'build/brand/macos-wallet-touch-id.json'))
const renderer = resolve(__dirname, probe ? 'src/renderer/touchId' : 'src/renderer')
const changelog = parseChangelog(readFileSync(resolve(__dirname, 'CHANGELOG.md'), 'utf8'))

// Bake the production CSP into the built index.html as a <meta> tag — the form
// Electron documents for file://-loaded pages, where response headers don't
// reliably apply. Build-only: the dev server + HMR need a looser policy, and
// dev keeps its real boundary (sandbox + contextIsolation) regardless.
function injectCspMeta(): Plugin {
  return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: PRODUCTION_CSP },
            injectTo: 'head-prepend',
          },
        ],
      }
    },
  }
}

// Three independent builds: main (Node) and preload (CommonJS, required for a
// sandboxed preload) are kept lean via externalizeDepsPlugin; the renderer is a
// normal Vite + React app. The vault and crypto live in `main`.
export default defineConfig({
  main: {
    define: { __TEST_BUILD__: JSON.stringify(identity ?? null), __WALLET_TOUCH_ID__: JSON.stringify(walletTouchId) },
    // Bundle the @qbtc/* packages into main rather than externalizing them:
    // they are pure ESM (the main bundle is CJS), bundling keeps a single copy
    // of @qbtc/crypto shared by the vault and our own code (so its error
    // classes match across the boundary), and the Falcon WASM glue they import
    // dynamically lands in the bundle (see wallet/falconWasm.ts for how the
    // .wasm itself is located). Real npm deps stay external.
    plugins: [externalizeDepsPlugin({ exclude: ['@qbtc/crypto', '@qbtc/chain', '@qbtc/vault'] })],
    build: {
      ...(beta ? { outDir: resolve(__dirname, betaDir, 'main') } : {}),
      rollupOptions: { input: { index: resolve(__dirname, probe ? 'src/main/touchId/index.ts' : 'src/main/index.ts') } },
    },
  },
  preload: {
    define: { __WALLET_TOUCH_ID__: JSON.stringify(walletTouchId) },
    plugins: [externalizeDepsPlugin()],
    build: {
      ...(beta ? { outDir: resolve(__dirname, betaDir, 'preload') } : {}),
      rollupOptions: { input: { index: resolve(__dirname, probe ? 'src/preload/touchIdProbe.ts' : 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: renderer,
    define: {
      __APP_VERSION__: JSON.stringify(beta?.version ?? version),
      __CHANGELOG__: JSON.stringify(beta ? [beta.notes, ...changelog] : changelog),
    },
    build: {
      ...(beta ? { outDir: resolve(__dirname, betaDir, 'renderer') } : {}),
      rollupOptions: { input: { index: resolve(renderer, 'index.html') } },
      assetsInlineLimit: 0,
    },
    plugins: [react(), injectCspMeta()],
  },
})
