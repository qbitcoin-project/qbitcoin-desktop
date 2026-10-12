import { expect, test } from '@playwright/test'
import { launchWalletUi } from './walletUiHelpers'

test('Send rejects malformed and excessive amounts before requesting a fee', async () => {
  const { app, page } = await launchWalletUi()
  try {
    await page.getByRole('button', { name: 'Send', exact: true }).first().click()
    await page.getByLabel('Recipient address').fill('recipient-test-address')
    const amount = page.getByRole('textbox', { name: /^Amount in/ })
    const review = page.getByRole('button', { name: 'Review send', exact: true })
    for (const value of ['text', '0', '-1', '1.000000001', '9007199254740993', '2']) {
      await amount.fill(value)
      await amount.press('Tab')
      await expect(amount).toHaveAttribute('aria-invalid', 'true')
      await expect(review).toBeDisabled()
    }
    expect(await page.evaluate(() => (window as unknown as { walletUiTest: { calls: { method: string }[] } }).walletUiTest.calls.filter((c) => c.method === 'buildSend'))).toHaveLength(0)
    await expect(page.getByRole('alert')).toContainText('exceeds the available balance of 1')
    await amount.fill('0.5')
    await expect(review).toBeEnabled()
    await amount.fill('1')
    await expect(review).toBeDisabled()
    await expect(page.getByText('Amount plus the network fee exceeds your spendable balance.')).toBeVisible()
    await page.getByRole('button', { name: 'Max', exact: true }).click()
    await expect(amount).toHaveValue('0.99999')
    await expect(review).toBeEnabled()
    await page.getByRole('button', { name: 'Select asset' }).click()
    await page.getByRole('button', { name: 'TOK', exact: true }).click()
    await amount.fill('6')
    await amount.press('Tab')
    await expect(review).toBeDisabled()
    await expect(page.getByRole('alert')).toContainText('balance of 5')
    await amount.fill('5')
    await expect(review).toBeEnabled()
  } finally { await app.close() }
})

test('Convert validates both directions and recovers after correcting the amount', async () => {
  const { app, page } = await launchWalletUi()
  try {
    await page.getByRole('button', { name: 'Convert', exact: true }).click()
    await page.getByRole('button', { name: 'All ✓', exact: true }).click()
    const amount = page.getByRole('textbox', { name: /^Amount in/ })
    const review = page.getByRole('button', { name: 'Review conversion' })
    for (const value of ['text', '0', '-1', '0.000000001', '0.00001', '2']) {
      await amount.fill(value)
      await amount.press('Tab')
      await expect(amount).toHaveAttribute('aria-invalid', 'true')
      await expect(review).toBeDisabled()
    }
    await amount.fill('0.5')
    await expect(review).toBeEnabled()
    await review.click()
    await expect(page.getByText('Converting', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: /→ BTC/ }).click()
    await page.getByRole('textbox', { name: 'BTC destination address' }).fill('1BoatSLRHtKNngkdXEeobR76b53LETtpyT')
    for (const value of ['text', '0', '2']) {
      await amount.fill(value)
      await amount.press('Tab')
      await expect(amount).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByRole('button', { name: 'Review', exact: true })).toBeDisabled()
    }
    await amount.fill('0.5')
    await expect(page.getByRole('button', { name: 'Review', exact: true })).toBeEnabled()
  } finally { await app.close() }
})
