import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  outputDir: '../../test-results/touch-id',
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
})
