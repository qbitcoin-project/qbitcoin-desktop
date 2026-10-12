import { expect, test } from '@playwright/test'
import { launchWalletUi } from './walletUiHelpers'

test('a mempool-only deposit enables full and partial conversion', async () => {
  const { app, page } = await launchWalletUi('pending=1')
  try {
    await page.getByRole('button', { name: 'Convert', exact: true }).click()
    const amount = page.getByRole('textbox', { name: 'Amount in BTC' })
    const review = page.getByRole('button', { name: 'Review conversion' })
    await expect(amount).toHaveValue('1')
    await expect(page.getByText('includes 1 pending', { exact: true })).toBeVisible()
    await expect(review).toBeEnabled()
    await review.click()
    await expect(page.getByText('Converting', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: 'All ✓', exact: true }).click()
    await amount.fill('0.5')
    await expect(review).toBeEnabled()
    await review.click()
    await expect(page.getByText('0.5 BTC', { exact: true })).toBeVisible()
  } finally { await app.close() }
})

test('a disappeared deposit reports an error when confirming an open review', async () => {
  const { app, page } = await launchWalletUi('pending=1')
  try {
    await page.clock.install()
    await page.reload()
    await page.getByRole('button', { name: 'Convert', exact: true }).click()
    await page.getByRole('button', { name: 'Review conversion' }).click()
    await expect(page.getByText('Converting', { exact: true })).toBeVisible()
    await page.evaluate(() => { (window as unknown as { walletUiTest: { depositAvailable: boolean } }).walletUiTest.depositAvailable = false })
    await page.clock.fastForward(30_000)
    await expect(page.getByText('includes 1 pending', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: /^Convert / }).click()
    await expect(page.getByText('Nothing to convert: no BTC available on the staging address.', { exact: true })).toBeVisible()
  } finally { await app.close() }
})
