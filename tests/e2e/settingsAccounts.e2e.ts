import { expect, test } from '@playwright/test'
import { launchWalletUi } from './walletUiHelpers'

test('Settings omits a representative seed address and retains the single-key address', async () => {
  const { app, page } = await launchWalletUi('accounts=1')
  try {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByText('Accounts', { exact: true })).toBeVisible()
    await expect(page.getByText('Imported key', { exact: true })).toBeVisible()
    await expect(page.getByText('classical-…ress', { exact: true })).toHaveCount(0)
    await expect(page.getByText('single-key…ress', { exact: true })).toBeVisible()
  } finally { await app.close() }
})
