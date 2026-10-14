import { expect, test } from '@playwright/test'
import { launchWalletUi } from './walletUiHelpers'

test('Send separates maturing funds and Max uses only available native and token balances', async () => {
  const { app, page } = await launchWalletUi('maturity=1')
  try {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText(/^Available now 1 /)).toBeVisible()
    await expect(page.getByText(/^Maturing: 2 /)).toBeVisible()
    await expect(page.getByText('Confirms in ~10s')).toHaveCount(0)
    await page.getByLabel('Recipient address').fill('recipient-test-address')
    await page.getByRole('button', { name: 'Max', exact: true }).click()
    await expect(page.getByRole('textbox', { name: /^Amount in/ })).toHaveValue('0.99999')
    await page.getByRole('button', { name: 'Select asset' }).click()
    await page.getByRole('button', { name: 'TOK', exact: true }).click()
    await expect(page.getByText('Available now 5 TOK', { exact: true })).toBeVisible()
    await expect(page.getByText(/^Maturing: 7 TOK/)).toBeVisible()
    await page.getByRole('button', { name: 'Max', exact: true }).click()
    await expect(page.getByRole('textbox', { name: /^Amount in/ })).toHaveValue('5')
  } finally { await app.close() }
})

test('manual coin selection warns about maturity in the picker and review', async () => {
  const { app, page } = await launchWalletUi('maturity=1')
  try {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByLabel('Recipient address').fill('recipient-test-address')
    await page.getByRole('textbox', { name: /^Amount in/ }).fill('1.5')
    await page.getByRole('button', { name: /Coin control/ }).click()
    await page.getByRole('button', { name: /Maturing stake/ }).click()
    await expect(page.getByText(/confirmation will wait/)).toBeVisible()
    await page.getByRole('button', { name: 'Review send', exact: true }).click()
    await expect(page.getByText(/This transaction cannot confirm before/)).toBeVisible()
  } finally { await app.close() }
})

test('delegated sweep preserves its notice and maturity balance after leaving key entry', async () => {
  const { app, page } = await launchWalletUi('sweep=1')
  try {
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Enter private key', exact: true }).click()
    await dialog.getByLabel('Private key', { exact: true }).fill('synthetic-fixture-key')
    await expect(dialog.getByText('synthetic-delegate-public-hash', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(dialog.getByLabel('Private key', { exact: true })).toHaveCount(0)
    await expect(dialog.getByText('Delegated staking', { exact: true })).toBeVisible()
    await expect(dialog.getByText('synthetic-delegate-public-hash', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Available now', { exact: true })).toBeVisible()
    await expect(dialog.getByText(/^Maturing: 2 /)).toBeVisible()
  } finally { await app.close() }
})
