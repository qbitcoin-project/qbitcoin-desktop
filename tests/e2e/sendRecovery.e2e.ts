import { expect, test, type Page } from '@playwright/test'
import { launchWalletUi } from './walletUiHelpers'

async function compose(page: Page) {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByLabel('Recipient address').fill('recipient-test-address')
  await page.getByRole('textbox', { name: /^Amount in/ }).fill('0.5')
}
const calls = (page: Page, method: string) => page.evaluate((name) => (window as unknown as { walletUiTest: { calls: { method: string }[] } }).walletUiTest.calls.filter((c) => c.method === name).length, method)

test('a definite rejection requires a fresh review instead of retrying the old draft', async () => {
  const { app, page } = await launchWalletUi('submission=rejected')
  try {
    await compose(page)
    await page.getByRole('button', { name: 'Review send', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm & send', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('Review required')
    await expect(page.getByRole('button', { name: 'Check again', exact: true })).toHaveCount(0)
    const builds = await calls(page, 'buildSend')
    await page.getByRole('button', { name: 'Review again', exact: true }).click()
    await page.getByRole('button', { name: 'Review send', exact: true }).click()
    expect(await calls(page, 'buildSend')).toBeGreaterThan(builds)
    expect(await calls(page, 'confirmSend')).toBe(1)
    await page.getByRole('button', { name: 'Confirm & send', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible()
  } finally { await app.close() }
})

test('an uncertain submission can be checked without building or reviewing another transaction', async () => {
  const { app, page } = await launchWalletUi('submission=unknown')
  try {
    await compose(page)
    await page.getByRole('button', { name: 'Review send', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm & send', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('Check submission status')
    await expect(page.getByRole('button', { name: 'Review again', exact: true })).toHaveCount(0)
    const builds = await calls(page, 'buildSend')
    await page.getByRole('button', { name: 'Check again', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible()
    expect(await calls(page, 'buildSend')).toBe(builds)
    expect(await calls(page, 'confirmSend')).toBe(2)
  } finally { await app.close() }
})

test('returning to Send can resolve a previously uncertain submission', async () => {
  const { app, page } = await launchWalletUi('submission=existing')
  try {
    await compose(page)
    await expect(page.getByRole('alert')).toHaveText('Check submission status')
    await page.getByRole('button', { name: 'Check again', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible()
  } finally { await app.close() }
})

for (const outcome of ['unknown', 'rejected']) {
  test(`private-key sweep handles a ${outcome} submission without reusing a rejected draft`, async () => {
    const { app, page } = await launchWalletUi(`sweep=1&submission=${outcome}`)
    try {
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Enter private key', exact: true }).click()
      await dialog.getByLabel('Private key', { exact: true }).fill('synthetic-fixture-key')
      await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
      await dialog.getByLabel('Recipient address').fill('recipient-test-address')
      await dialog.getByRole('button', { name: 'Max', exact: true }).click()
      await dialog.getByRole('button', { name: 'Review', exact: true }).click()
      await dialog.getByRole('button', { name: 'Send', exact: true }).click()
      if (outcome === 'unknown') {
        await expect(dialog.getByRole('alert')).toContainText('status is unknown')
        await expect(dialog.getByRole('button', { name: 'Back', exact: true })).toBeDisabled()
        await dialog.getByRole('button', { name: 'Check again', exact: true }).click()
        expect(await calls(page, 'sweepBuild')).toBe(1)
      } else {
        await expect(dialog.getByRole('alert')).toContainText('node rejected')
        await expect(dialog.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0)
        await dialog.getByRole('button', { name: 'Review', exact: true }).click()
        await dialog.getByRole('button', { name: 'Send', exact: true }).click()
        expect(await calls(page, 'sweepBuild')).toBe(2)
      }
      await expect(dialog.getByText('Transaction broadcast', { exact: true })).toBeVisible()
      expect(await calls(page, 'sweepConfirm')).toBe(2)
    } finally { await app.close() }
  })
}
