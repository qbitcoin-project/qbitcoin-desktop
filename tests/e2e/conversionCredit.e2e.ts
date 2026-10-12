import { expect, test } from '@playwright/test'
import { brand } from '../../src/renderer/brand'
import { launchWalletUi } from './walletUiHelpers'

const nativeLabel = brand.assetLabel.mainnet

test('conversion history switches from a labelled BTC link to the native coinbase when credit arrives', async () => {
  const { app, page } = await launchWalletUi('credits=1')
  try {
    await page.clock.install()
    await page.reload()
    await page.getByRole('button', { name: 'Convert', exact: true }).click()
    const history = page.locator('section').filter({ has: page.getByText('3 · Conversions', { exact: true }) })
    await expect(history.getByText(`Awaiting ${nativeLabel} credit`, { exact: true })).toBeVisible()
    await expect(history.getByRole('link', { name: 'View BTC transaction in explorer' })).toHaveAttribute('href', `https://source.example/tx/${'aa'.repeat(32)}`)
    await expect(history.getByRole('link', { name: `View ${nativeLabel} credit in explorer` })).toHaveCount(0)

    await page.evaluate(() => { (window as unknown as { walletUiTest: { creditState: string } }).walletUiTest.creditState = 'received' })
    await page.clock.fastForward(30_000)
    await expect(history.getByText('Received', { exact: true })).toBeVisible()
    await expect(history.getByText(`2.5 ${nativeLabel}`, { exact: true })).toBeVisible()
    await expect(history.getByText('native-conversion-destination', { exact: true })).toBeVisible()
    await expect(history.locator('time')).toHaveAttribute('datetime', '2023-11-14T22:13:20.000Z')
    const explorer = history.getByRole('link', { name: `View ${nativeLabel} credit in explorer` })
    await expect(explorer).toHaveAttribute('href', `https://native.example/tx/${'cc'.repeat(32)}`)
    await expect(explorer).toHaveAttribute('target', '_blank')
    await expect(history.getByRole('link', { name: 'View BTC transaction in explorer' })).toHaveCount(0)
    await history.screenshot({ path: test.info().outputPath('received-conversion.png') })

    // A failed refresh must not leave a stale success or present a BTC link as a native credit.
    await page.evaluate(() => { (window as unknown as { walletUiTest: { creditState: string } }).walletUiTest.creditState = 'unavailable' })
    await page.clock.fastForward(30_000)
    await expect(history.getByText(`${nativeLabel} credit status unavailable`, { exact: true })).toBeVisible()
    await expect(explorer).toHaveCount(0)
    await expect(history.getByRole('link', { name: 'View BTC transaction in explorer' })).toHaveAttribute('href', `https://source.example/tx/${'aa'.repeat(32)}`)
  } finally { await app.close() }
})

test('a received conversion without a configured native explorer retains credit details without a misleading BTC fallback', async () => {
  const { app, page } = await launchWalletUi('credits=1&credit=received&no-explorer=1')
  try {
    await page.getByRole('button', { name: 'Convert', exact: true }).click()
    const history = page.locator('section').filter({ has: page.getByText('3 · Conversions', { exact: true }) })
    await expect(history.getByText('Received', { exact: true })).toBeVisible()
    await expect(history.getByText(`2.5 ${nativeLabel}`, { exact: true })).toBeVisible()
    await expect(history.getByText('native-conversion-destination', { exact: true })).toBeVisible()
    await expect(history.getByRole('link')).toHaveCount(0)
    await expect(history.getByRole('button', { name: 'cccccccc…cccccc' })).toBeVisible()
  } finally { await app.close() }
})
