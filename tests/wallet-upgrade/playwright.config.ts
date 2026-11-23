import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.', testMatch: 'upgrade.e2e.ts', outputDir: '../../test-results/wallet-upgrade',
  workers: 1, timeout: 60_000,
})
