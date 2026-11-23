import { defineConfig } from '@playwright/test'
import config from '../touch-id/playwright.config'
export default defineConfig({ ...config, outputDir: '../../test-results/touch-id-wallet' })
