import { expect, test } from '@playwright/test'
import { launchWalletUi } from './walletUiHelpers'

test('transaction flow remains readable with incomplete staking ownership', async () => {
  const { app, page } = await launchWalletUi('notes=1&staking-index-error=1')
  try {
    await page.locator('.activity-row').click()
    const drawer = page.getByRole('dialog', { name: 'Transaction detail' })
    await expect(drawer.getByRole('status')).toContainText('staking addresses could not be checked')
    await expect(drawer.getByText('Outputs (2)', { exact: true })).toBeVisible()
    await expect(drawer.getByText('YOU', { exact: true })).toHaveCount(1)
    await expect(drawer.getByText('Ownership unknown', { exact: true })).toHaveCount(1)
    const unknown = drawer.locator('div').filter({ has: page.getByText('Ownership unknown', { exact: true }) }).filter({ hasText: 'unresolved-delegation-address' }).last()
    await expect(unknown.getByText(/^(received|change|sent)$/)).toHaveCount(0)
    await expect(drawer.getByRole('button', { name: 'Copy txid', exact: true })).toBeVisible()
    await page.screenshot({ path: 'docs/delegation-implementation/transaction-partial-ownership.png', fullPage: true })
  } finally { await app.close() }
})
