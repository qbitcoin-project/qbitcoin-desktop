import { brand } from '../../src/renderer/brand'
import { expect, test } from '@playwright/test'
import { launchWalletUi } from './walletUiHelpers'

const TICKER = brand.assetLabel.mainnet

test('the conversion form explains rate, fee and timing as information', async () => {
  const { app, page } = await launchWalletUi()
  try {
    await page.getByRole('button', { name: 'Convert', exact: true }).click()
    const note = page.getByRole('status').filter({ hasText: 'You’ll receive' })
    await expect(note).toHaveText(`You’ll receive ${TICKER} at the protocol rate at credit time, minus a ≈1% protocol fee, in about 3–4 hours.`)
    await expect(note).toHaveAttribute('data-variant', 'note')
    await expect(page.getByText(/one-way/)).toHaveCount(0)
  } finally { await app.close() }
})

test('the reverse conversion review says when it can no longer be cancelled', async () => {
  const { app, page } = await launchWalletUi()
  try {
    await page.getByRole('button', { name: 'Convert', exact: true }).click()
    await page.getByRole('tab', { name: /→ BTC/ }).click()
    await page.getByRole('textbox', { name: 'BTC destination address' }).fill('1BoatSLRHtKNngkdXEeobR76b53LETtpyT')
    await page.getByRole('textbox', { name: /^Amount in/ }).fill('0.5')
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    const note = page.getByRole('status').filter({ hasText: 'Once the service picks it up' })
    await expect(note).toHaveText('Once the service picks it up, this conversion can’t be cancelled.')
    await expect(note).toHaveAttribute('data-variant', 'note')
    await expect(page.getByText(/one-way/)).toHaveCount(0)
  } finally { await app.close() }
})
