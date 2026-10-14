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

test('Convert excludes maturing and unverified coins before requesting a return plan', async () => {
  const { app, page } = await launchWalletUi('maturity=1')
  try {
    await page.getByRole('button', { name: 'Convert', exact: true }).click()
    await page.getByRole('tab', { name: /→ BTC/ }).click()
    await expect(page.getByText(/^Up to 1 .* spendable/)).toBeVisible()
    await page.getByRole('textbox', { name: 'BTC destination address' }).fill('1BoatSLRHtKNngkdXEeobR76b53LETtpyT')
    const amount = page.getByRole('textbox', { name: /^Amount in/ })
    const review = page.getByRole('button', { name: 'Review', exact: true })
    await amount.fill('2')
    await amount.press('Tab')
    await expect(amount).toHaveAttribute('aria-invalid', 'true')
    await expect(amount).toHaveAccessibleDescription('Amount exceeds the available balance of 1.')
    await expect(review).toBeDisabled()
    const planCalls = () => page.evaluate(() => (window as unknown as { walletUiTest: { calls: { method: string; args: unknown[] }[] } }).walletUiTest.calls.filter((c) => c.method === 'downgradePlan'))
    expect(await planCalls()).toHaveLength(0)
    await amount.fill('0.5')
    await expect(review).toBeEnabled()
    await review.click()
    await expect(page.getByText('Converting', { exact: true })).toBeVisible()
    expect(await planCalls()).toEqual([{ method: 'downgradePlan', args: ['50000000'] }])
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
