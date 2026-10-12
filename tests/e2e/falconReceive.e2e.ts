import { expect, test } from '@playwright/test'
import { launchWalletUi } from './walletUiHelpers'

test('Falcon shortcut selects Falcon while ordinary Receive keeps its default', async () => {
  const { app, page } = await launchWalletUi()
  try {
    await page.getByRole('button', { name: 'View your Falcon address →' }).click()
    await expect(page.getByRole('tab', { name: 'Falcon-512' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('falcon-test-address', { exact: true })).toBeVisible()
    await expect(page.getByText('classical-test-address', { exact: true })).not.toBeVisible()
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Wallet', exact: true }).click()
    await page.getByRole('button', { name: 'Receive', exact: true }).last().click()
    await expect(page.getByRole('tab', { name: 'ECDSA', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('classical-test-address', { exact: true })).toBeVisible()
  } finally { await app.close() }
})

test('a classical single-key wallet does not advertise a Falcon address', async () => {
  const { app, page } = await launchWalletUi('key=1')
  try {
    await expect(page.getByText('Total balance', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'View your Falcon address →' })).toHaveCount(0)
  } finally { await app.close() }
})
