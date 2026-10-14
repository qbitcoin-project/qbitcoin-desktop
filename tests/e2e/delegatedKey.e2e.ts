import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { delegatedKeyFixture } from '../fixtures/delegatedKey'
import { importedKeyFromStored } from '../../src/main/wallet/keyWallet'
import { encodeDelegatePubkeyhash } from '../../src/main/wallet/delegation'
import { acceptPrivacy, focusApp, focusedWindow, freshUserData } from './privacyHelpers'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const PASSWORD = 'delegated-test-password'
const PRIMARY = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

for (const algo of ['ecdsa', 'falcon512'] as const) {
  test(`${algo} delegated import, receive, send notice and complete backup survive restart`, async () => {
    test.setTimeout(90_000)
    const userData = freshUserData()
    const args = [join(process.cwd(), 'tests/e2e/privacy-harness.cjs'), `--user-data-dir=${userData}`]
    let app = await electron.launch({ args })
    const fixture = await delegatedKeyFixture(algo)
    const wrongNetwork = await delegatedKeyFixture(algo, 32, 'testnet')
    const key = await importedKeyFromStored({ wif: fixture.wif, algo, address: '' }, 'mainnet')
    const address = key.address
    key.privateKey.fill(0)
    try {
      let page = await focusedWindow(app)
      await page.getByRole('button', { name: 'I already have a wallet' }).click()
      await acceptPrivacy(page)
      await page.getByLabel('Recovery phrase').fill(PRIMARY)
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
      await page.getByLabel('Confirm password', { exact: true }).fill(PASSWORD)
      await page.getByRole('button', { name: 'Restore wallet', exact: true }).click()
      await page.getByRole('button', { name: 'Open my wallet' }).click()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Add wallet', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('tab', { name: 'Private key', exact: true }).click()
      await acceptPrivacy(dialog)
      await dialog.getByLabel('Wallet name').fill('Delegated owner')
      await dialog.getByLabel('Private key', { exact: true }).fill(wrongNetwork.wif)
      await expect(dialog.getByLabel('Private key', { exact: true })).toHaveAccessibleDescription(/testnet/)
      await expect(dialog.getByRole('button', { name: 'Add wallet', exact: true })).toBeDisabled()
      await dialog.getByLabel('Private key', { exact: true }).fill(fixture.wif)
      await expect(dialog.getByText('Delegated staking', { exact: true })).toBeVisible()
      await expect(dialog.locator('code')).toHaveText([address, encodeDelegatePubkeyhash(fixture.delegate, 'mainnet')])
      await dialog.getByRole('button', { name: 'Add wallet', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page.locator('.wallet-switch')).toContainText('Delegated owner')
      await page.getByLabel('Primary').getByRole('button', { name: 'Wallet', exact: true }).click()
      await page.getByLabel('Primary').getByRole('button', { name: 'Receive', exact: true }).click()
      await expect(page.getByText(address, { exact: true })).toBeVisible()
      await page.getByLabel('Primary').getByRole('button', { name: 'Send', exact: true }).click()
      await expect(page.getByText('Delegated staking', { exact: true })).toBeVisible()
      await expect(page.getByText(/Recent staking outputs may need to mature/)).toBeVisible()
      await page.getByRole('button', { name: 'Lock wallet', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible()
      // Unlock in the same process must create a fresh imported-key session.
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
      await page.getByRole('button', { name: 'Unlock', exact: true }).click()
      await page.getByLabel('Primary').getByRole('button', { name: 'Receive', exact: true }).click()
      await expect(page.getByText(address, { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Lock wallet', exact: true }).click()
      await app.close()
      app = await electron.launch({ args })
      page = await focusedWindow(app)
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
      await page.getByRole('button', { name: 'Unlock', exact: true }).click()
      await expect(page.locator('.wallet-switch')).toContainText('Delegated owner')
      await page.getByLabel('Primary').getByRole('button', { name: 'Receive', exact: true }).click()
      await expect(page.getByText(address, { exact: true })).toBeVisible()
      await page.getByLabel('Primary').getByRole('button', { name: 'Send', exact: true }).click()
      await expect(page.getByText(encodeDelegatePubkeyhash(fixture.delegate, 'mainnet'), { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Reveal', exact: true }).click()
      await page.getByLabel('Wallet password', { exact: true }).fill(PASSWORD)
      await focusApp(page)
      await page.getByRole('button', { name: 'Show private key', exact: true }).click()
      await expect(page.getByTestId('backup-secret')).toBeVisible()
      expect(await page.getByTestId('backup-secret').textContent() === fixture.wif).toBe(true)
      await expect(page.getByText(`Address: ${address}`, { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Hide now', exact: true }).click()
      expect(await page.evaluate((value) => document.documentElement.outerHTML.includes(value), fixture.wif)).toBe(false)
    } finally { await app.close() }
  })
}
