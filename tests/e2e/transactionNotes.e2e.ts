import { expect, test, type Page } from '@playwright/test'
import { launchWalletUi } from './walletUiHelpers'

async function writes(page: Page, method = 'setTxLabel') {
  return page.evaluate((name) => (window as unknown as { walletUiTest: { calls: { method: string; args: unknown[] }[] } }).walletUiTest.calls.filter((c) => c.method === name), method)
}

for (const screen of ['Wallet', 'Activity']) {
  test(`${screen}: Escape discards a note; Enter and blur save it once`, async () => {
    const { app, page } = await launchWalletUi('notes=1')
    try {
      if (screen === 'Activity') await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: screen, exact: true }).click()
      const edit = page.getByRole('button', { name: 'Edit transaction note', exact: true })
      const input = page.getByRole('textbox', { name: 'Transaction note', exact: true })
      await edit.click()
      await expect(input).toHaveAttribute('placeholder', 'Add transaction note')
      await input.fill('Discard this draft')
      await input.press('Escape')
      await expect(input).toHaveCount(0)
      await expect(edit).toBeFocused()
      expect(await writes(page)).toHaveLength(0)
      await edit.press('Enter')
      await expect(page.getByRole('dialog', { name: 'Transaction detail' })).toHaveCount(0)
      await input.fill('Saved transaction note')
      await input.press('Enter')
      await expect(page.getByText('Saved transaction note', { exact: true })).toBeVisible()
      expect(await writes(page)).toHaveLength(1)
      await edit.click()
      await input.fill('Saved on blur')
      await input.press('Tab')
      await expect(input).toHaveCount(0)
      await expect(page.getByText('Saved on blur', { exact: true })).toBeVisible()
      expect(await writes(page)).toHaveLength(2)
    } finally { await app.close() }
  })
}

test('drawer cancels the note before closing and displays saved and cleared notes immediately', async () => {
  const { app, page } = await launchWalletUi('notes=1')
  try {
    await page.locator('.activity-row').click()
    const drawer = page.getByRole('dialog', { name: 'Transaction detail' })
    await drawer.getByRole('button', { name: 'Add transaction note', exact: true }).click()
    const input = drawer.getByRole('textbox', { name: 'Transaction note', exact: true })
    await input.fill('Cancelled note')
    await input.press('Escape')
    await expect(drawer).toBeVisible()
    await expect(input).toHaveCount(0)
    expect(await writes(page)).toHaveLength(0)
    const add = drawer.getByRole('button', { name: 'Add transaction note', exact: true })
    await expect(add).toBeFocused()
    await add.press('Enter')
    await input.fill('Keep this note')
    // IME confirmation must neither save an incomplete draft nor close the drawer.
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
    await expect(input).toBeVisible()
    await input.dispatchEvent('keydown', { key: 'Escape', isComposing: true })
    await expect(input).toBeVisible()
    await expect(drawer).toBeVisible()
    expect(await writes(page)).toHaveLength(0)
    await input.press('Enter')
    const saved = drawer.getByRole('button', { name: 'Keep this note', exact: true })
    await expect(saved).toBeVisible()
    expect(await writes(page)).toHaveLength(1)
    await saved.click()
    await expect(input).toHaveValue('Keep this note')
    await input.fill('')
    await input.press('Enter')
    await expect(add).toBeVisible()
    expect(await writes(page)).toHaveLength(2)
    await add.click()
    await page.screenshot({ path: test.info().outputPath('transaction-note.png') })
    await input.press('Escape')
    await expect(add).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
  } finally { await app.close() }
})

test('Escape also discards a coin label without persisting it', async () => {
  const { app, page } = await launchWalletUi()
  try {
    await page.getByRole('button', { name: 'Coins', exact: true }).click()
    const edit = page.getByRole('button', { name: 'Edit label', exact: true }).first()
    await edit.click()
    const input = page.getByRole('textbox', { name: 'Coin label', exact: true })
    await input.fill('Discard coin draft')
    await input.press('Escape')
    await expect(input).toHaveCount(0)
    await expect(edit).toBeFocused()
    expect(await writes(page, 'setCoinLabel')).toHaveLength(0)
  } finally { await app.close() }
})
