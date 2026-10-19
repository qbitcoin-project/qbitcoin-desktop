import { brand } from '../../src/renderer/brand'
import { expect, test, type Page } from '@playwright/test'
import { launchWalletUi } from './walletUiHelpers'

const QBTC = brand.assetLabel.mainnet
const calls = (page: Page) => page.evaluate(() => (window as unknown as { walletUiTest: { calls: { method: string; args: unknown[] }[] } }).walletUiTest.calls)
const count = async (page: Page, method: string) => (await calls(page)).filter((c) => c.method === method).length
const openStaking = (page: Page) => page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Staking', exact: true }).click()

test('merges confirmed blockchain activity with journal operations, preserving pagination and read-only details', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-chain=1')
  try {
    await openStaking(page)
    const activity = page.getByRole('region', { name: 'Activity', exact: true })
    await expect(activity.getByText('Showing 5 of 8 operations', { exact: true })).toBeVisible()
    const reward = activity.locator('.staking-op').filter({ hasText: 'Stake reward' })
    await expect(reward).toContainText(`+0.000009 ${QBTC}`)
    const withdrawal = activity.locator('.staking-op').filter({ hasText: 'Staking withdrawal' })
    await expect(withdrawal).toContainText(`-0.00100003 ${QBTC}`)
    await activity.getByRole('button', { name: 'Show more', exact: true }).click()
    await expect(activity.getByText('Showing 8 of 8 operations', { exact: true })).toBeVisible()
    await expect(activity.locator('[data-op-toggle="journal-deposit"]')).toBeFocused()
    await expect(activity.locator('[data-op-toggle="chain-2"]')).toHaveCount(0)
    await expect(activity.locator('[data-op-toggle="journal-deposit"]')).toHaveCount(1)
    const missing = activity.locator('.staking-op').filter({ has: page.locator('[data-op-toggle="chain-1"]') })
    await missing.getByRole('button').first().click()
    await expect(missing).toContainText(`+0.001 ${QBTC}`)
    await expect(missing.getByText(/Found in the blockchain/)).toBeVisible()
    await expect(missing.getByRole('button', { name: /Check again|retries|recovery|Delegate again/ })).toHaveCount(0)
    await expect(activity.locator('[data-op-toggle="chain-3"]')).toContainText('Time unavailable')
    await expect(activity.locator('[data-op-toggle="chain-3"]')).toContainText('Amount unavailable')
    await activity.locator('[data-op-toggle="chain-4"]').click()
    await expect(activity.getByText('-0.4 TOK', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/staking-chain-activity.png' })
    expect(await count(page, 'stakingConfirm')).toBe(0)
    expect(await count(page, 'stakingRetry')).toBe(0)
    expect(await count(page, 'stakingBuildRecovery')).toBe(0)
  } finally { await app.close() }
})

test('marks partial blockchain history and removes orphaned observations on refresh without resetting expanded rows', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-chain=1')
  try {
    await openStaking(page)
    const activity = page.getByRole('region', { name: 'Activity', exact: true })
    await activity.getByRole('button', { name: 'Show more', exact: true }).click()
    await activity.locator('[data-op-toggle="chain-1"]').click()
    await page.evaluate(() => {
      const state = (window as unknown as { walletUiTest: { stakingChainActivity: { id: string }[]; stakingAddresses: { historyIncomplete?: boolean }[] } }).walletUiTest
      state.stakingAddresses[0]!.historyIncomplete = true
      state.stakingChainActivity.splice(state.stakingChainActivity.findIndex((entry) => entry.id === 'chain-8'), 1)
    })
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(activity.getByText('Showing 7 of 7 loaded operations', { exact: true })).toBeVisible()
    await expect(activity.getByText(/Blockchain history is incomplete/)).toBeVisible()
    await expect(activity.locator('[data-op-toggle="chain-8"]')).toHaveCount(0)
    await expect(activity.locator('[data-op-toggle="chain-1"]')).toHaveAttribute('aria-expanded', 'true')
    await expect(activity.locator('[data-op-toggle="journal-deposit"]')).toHaveCount(1)
  } finally { await app.close() }
})

for (const algo of ['ECDSA', 'Falcon-512']) test(`reviews and submits ${algo} delegation in its own dialog without a Receive shortcut`, async () => {
  const { app, page } = await launchWalletUi('staking=1')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(900, 560))
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Receive', exact: true }).click()
    await page.getByRole('tab', { name: algo, exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stake from this address' })).toHaveCount(0)
    await expect(page.getByText(algo === 'ECDSA' ? 'classical-test-address' : 'falcon-test-address', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy address', exact: true }).last()).toBeEnabled()
    await expect(page.getByRole('button', { name: 'New address', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'All addresses', exact: true })).toBeVisible()
    if (algo === 'ECDSA') {
      await page.getByRole('button', { name: 'All addresses', exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: 'docs/delegation-implementation/receive-without-staking.png' })
    }
    await openStaking(page)
    await page.getByRole('button', { name: 'Delegate coins', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delegate coins', exact: true })
    await expect(dialog.getByRole('tab', { name: 'ECDSA', exact: true })).toHaveAttribute('aria-selected', 'true')
    await dialog.getByRole('tab', { name: algo, exact: true }).click()
    await expect(dialog.getByRole('tab', { name: algo, exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByText(`Ordinary coins: 0.8991 ${QBTC}`, { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Use whole wallet' })).toHaveCount(0)
    const amount = dialog.getByRole('textbox', { name: /^Amount to delegate/ })
    await amount.fill('0.00099999')
    await dialog.getByRole('button', { name: 'Review delegation', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Below the minimum of 0.001.')
    expect(await count(page, 'stakingBuildFunding')).toBe(0)
    await amount.fill('0.001')
    await dialog.getByRole('button', { name: 'Review delegation', exact: true }).click()
    const review = dialog.getByRole('region', { name: 'Review delegation', exact: true })
    await expect(review.getByText('Ordinary coins in this wallet', { exact: true })).toBeVisible()
    await expect(review.getByRole('checkbox')).toHaveCount(0)
    await expect(review.getByText(/Your owner key controls spending/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Confirm delegation', exact: true })).toBeEnabled()
    expect(await count(page, 'stakingConfirm')).toBe(0)
    if (algo === 'ECDSA') await page.screenshot({ path: 'docs/delegation-implementation/staking-review-no-checkbox.png' })
    await dialog.getByRole('button', { name: 'Confirm delegation', exact: true }).click()
    const sent = dialog.getByRole('status').filter({ hasText: 'Transaction is awaiting confirmation.' })
    await expect(sent).toBeVisible()
    await expect(sent).toBeInViewport({ ratio: 1 })
    await expect(dialog.getByText('Transaction confirmed.', { exact: true })).toHaveCount(0)
    if (algo === 'ECDSA') await page.screenshot({ path: 'docs/delegation-implementation/staking-pending-feedback.png' })
    expect((await calls(page)).filter((c) => c.method === 'stakingBuildFunding').at(-1)?.args[0]).toEqual({ algo: algo === 'ECDSA' ? 'ecdsa' : 'falcon512', amountAtomic: '100000', max: false })
    expect(await count(page, 'stakingConfirm')).toBe(1)
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const row = page.getByRole('region', { name: 'Activity', exact: true }).getByRole('listitem').first()
    await expect(row).toContainText('Delegation')
    await expect(row).toContainText('Awaiting confirmation')
    await expect(row.getByRole('button').first()).toBeFocused()
    await row.getByRole('button', { name: 'Check again', exact: true }).click()
    await expect.poll(() => count(page, 'stakingRetry')).toBe(1)
  } finally { await app.close() }
})

test('Max returns available coins from a legacy delegation with parts and a conflict asks for a new unstake', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-conflict=1&staking-parts=1&staking-legacy=1')
  try {
    await openStaking(page)
    const keys = page.getByRole('region', { name: 'Delegations', exact: true })
    await expect(keys.getByRole('article', { name: 'ECDSA key', exact: true })).toContainText('Legacy delegation')
    await page.getByRole('button', { name: 'Unstake', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Unstake', exact: true })
    await dialog.getByRole('tab', { name: 'ECDSA', exact: true }).click()
    await dialog.getByRole('button', { name: 'Max', exact: true }).click()
    await dialog.getByRole('button', { name: 'Review unstake', exact: true }).click()
    const review = dialog.getByRole('region', { name: 'Review unstake', exact: true })
    await expect(review.getByText('ordinary-return-ecdsa', { exact: true })).toBeVisible()
    await expect(review.getByText('Remaining in staking', { exact: true })).toBeVisible()
    await expect(review.getByText(/Max needs 3 transactions/)).toBeVisible()
    await expect(review.getByRole('checkbox')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Confirm unstake', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('its inputs were spent by another transaction')
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    const attention = page.getByRole('region', { name: 'Needs your attention', exact: true })
    await expect(attention).toContainText('didn’t go through')
    await expect(page.getByText(/Operation saved/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Check again' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Activity', exact: true }).getByRole('listitem').first()).toContainText('Didn’t go through')
    await attention.getByRole('button', { name: 'Review a new unstake', exact: true }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('tab')).toHaveCount(0)
    await expect(dialog.getByText('From your ECDSA key', { exact: true })).toBeVisible()
  } finally { await app.close() }
})

test('staking feedback distinguishes insufficient funds from a confirmed transaction', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-confirmed=1')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(900, 560))
    await openStaking(page)
    await page.getByRole('button', { name: 'Delegate coins', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delegate coins', exact: true })
    const amount = dialog.getByRole('textbox', { name: /^Amount to delegate/ })
    await amount.fill('1')
    await dialog.getByRole('button', { name: 'Review delegation', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Not enough balance to cover this amount plus the network fee.')
    await expect(dialog.getByRole('alert')).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: 'docs/delegation-implementation/staking-error-feedback.png' })
    await amount.fill('0.001')
    await dialog.getByRole('button', { name: 'Review delegation', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Confirm delegation', exact: true }).click()
    await expect(dialog.getByRole('status').filter({ hasText: 'Transaction confirmed.' })).toBeVisible()
    await expect(dialog.getByRole('status').filter({ hasText: 'Transaction confirmed.' })).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: 'docs/delegation-implementation/staking-success-feedback.png' })
  } finally { await app.close() }
})

test('return and confirmation errors stay inside their dialogs', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-withdrawal-error=1&staking-confirm-error=1')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(900, 560))
    await openStaking(page)
    await page.getByRole('button', { name: 'Unstake', exact: true }).click()
    const unstake = page.getByRole('dialog', { name: 'Unstake', exact: true })
    await unstake.getByRole('button', { name: 'Max', exact: true }).click()
    await expect(unstake.getByRole('alert')).toHaveText('Refresh the balance before preparing a return.')
    await expect(unstake.getByRole('alert')).toBeInViewport({ ratio: 1 })
    await unstake.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Delegate coins', exact: true }).click()
    const delegate = page.getByRole('dialog', { name: 'Delegate coins', exact: true })
    await delegate.getByRole('textbox', { name: /^Amount to delegate/ }).fill('0.001')
    await delegate.getByRole('button', { name: 'Review delegation', exact: true }).click()
    await delegate.getByRole('button', { name: 'Confirm delegation', exact: true }).click()
    const review = delegate.getByRole('region', { name: 'Review delegation', exact: true })
    await expect(review.getByRole('alert')).toHaveText('The preview expired. Review the transaction again.')
    await expect(review.getByRole('alert')).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: 'docs/delegation-implementation/staking-review-error-feedback.png' })
  } finally { await app.close() }
})

test('gated funding keeps unstake available and still explains unverified terms', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-disabled=1&staking-unverified=1')
  try {
    await openStaking(page)
    await expect(page.getByText(/Funding is disabled until/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delegate coins' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Delegate with/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Unstake', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'How it works', exact: true }).click()
    const help = page.getByRole('dialog', { name: 'How staking works', exact: true })
    await expect(help.getByText(/not yet confirmed by the service/)).toBeVisible()
    await expect(help.getByText('Service commission', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Not provided by the service', { exact: true })).toHaveCount(0)
    await help.getByRole('button', { name: 'Got it', exact: true }).click()
    await page.screenshot({ path: 'docs/delegation-implementation/staking-gated.png', fullPage: true })
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Receive', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stake from this address' })).toHaveCount(0)
  } finally { await app.close() }
})

test('stale staking balances cannot be used for a return', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-stale=1')
  try {
    await openStaking(page)
    await expect(page.getByText(/Couldn’t update/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Unstake', exact: true })).toBeDisabled()
  } finally { await app.close() }
})

test('wallets without staking capability have no staking navigation or shortcut', async () => {
  const { app, page } = await launchWalletUi()
  try {
    await expect(page.getByText('Total balance', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Staking', exact: true })).toHaveCount(0)
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Receive', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stake from this address' })).toHaveCount(0)
  } finally { await app.close() }
})

for (const algo of ['ECDSA', 'Falcon-512']) test(`partial ${algo} unstake shows the net amount, fee and staking remainder; Max can be edited`, async () => {
  const { app, page } = await launchWalletUi('staking=1')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(900, 560))
    await openStaking(page)
    await page.getByRole('button', { name: 'Unstake', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Unstake', exact: true })
    await dialog.getByRole('tab', { name: algo, exact: true }).click()
    const amount = dialog.getByRole('textbox', { name: /^Amount you receive/ })
    await amount.focus()
    await dialog.getByRole('button', { name: 'Max', exact: true }).click()
    await expect(amount).toHaveValue('0.09999')
    await amount.fill('2')
    await dialog.getByRole('button', { name: 'Max', exact: true }).click()
    await expect(amount).toHaveValue('0.09999')
    await dialog.getByRole('button', { name: 'Max', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `docs/delegation-implementation/unstake-form-${algo}.png` })
    await amount.fill('0.1')
    await dialog.getByRole('button', { name: 'Review unstake', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Not enough balance')
    await expect(dialog.getByRole('alert')).toBeInViewport({ ratio: 1 })
    await amount.fill('0.03')
    await dialog.getByRole('button', { name: 'Review unstake', exact: true }).click()
    const review = dialog.getByRole('region', { name: 'Review unstake', exact: true })
    await expect(review.getByText(`0.03 ${QBTC}`, { exact: true })).toBeVisible()
    await expect(review.getByText(`0.00001 ${QBTC}`, { exact: true })).toBeVisible()
    await expect(review.getByText(`0.07089 ${QBTC}`, { exact: true })).toBeVisible()
    await expect(review.getByText('Ordinary change', { exact: true })).toHaveCount(0)
    expect((await calls(page)).filter((c) => c.method === 'stakingBuildWithdrawal').at(-1)?.args[0]).toMatchObject({ amountAtomic: '3000000', max: false })
    expect(await count(page, 'stakingConfirm')).toBe(0)
    await expect(review.getByRole('checkbox')).toHaveCount(0)
    await expect(review.getByText(/The requested amount returns to your ordinary wallet/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Confirm unstake', exact: true })).toBeEnabled()
    await page.screenshot({ path: `docs/delegation-implementation/partial-unstake-${algo}.png` })
    await dialog.getByRole('button', { name: 'Confirm unstake', exact: true }).click()
    await expect(dialog.getByRole('status').filter({ hasText: 'Transaction is awaiting confirmation.' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    const row = page.getByRole('region', { name: 'Activity', exact: true }).getByRole('listitem').first()
    await expect(row).toContainText('Unstake')
    await expect(row).toContainText('Awaiting confirmation')
  } finally { await app.close() }
})

test('locked-only staking balance disables unstake and explains when coins unlock', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-locked=1')
  try {
    await openStaking(page)
    await expect(page.getByRole('button', { name: 'Unstake', exact: true })).toBeDisabled()
    await expect(page.getByRole('textbox', { name: /^Amount you receive/ })).toHaveCount(0)
    await expect(page.getByText(/No coins are available to unstake now/).first()).toBeVisible()
    await expect(page.getByText(/unlock by/).first()).toBeVisible()
  } finally { await app.close() }
})

for (const kind of ['seed', 'key']) test(`${kind} Send explains a shortfall and opens Staking`, async () => {
  const { app, page } = await launchWalletUi(`staking=1&${kind}=1`)
  try {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByRole('textbox', { name: /^Amount in/ }).fill('2')
    await expect(page.getByText(/Send uses ordinary coins only/)).toBeVisible()
    await page.getByRole('button', { name: 'Go to Staking', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'In staking', exact: true })).toBeVisible()
  } finally { await app.close() }
})

test('unstake ignores backdrop clicks and keeps each key amount after close and review Back', async () => {
  const { app, page } = await launchWalletUi('staking=1')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(900, 560))
    await openStaking(page)
    const open = page.getByRole('button', { name: 'Unstake', exact: true })
    const dialog = page.getByRole('dialog', { name: 'Unstake', exact: true })
    const amount = dialog.getByRole('textbox', { name: /^Amount you receive/ })
    const from = (name: string) => dialog.getByRole('tab', { name, exact: true })
    await expect(page.getByRole('textbox', { name: /^Amount you receive/ })).toHaveCount(0)
    await expect(page.getByText(/^Updated /)).toBeVisible()
    await open.click()
    await expect(amount).toBeFocused()
    await expect(amount).not.toHaveAttribute('aria-invalid', 'true')
    await expect(from('ECDSA')).toHaveAttribute('aria-selected', 'true')
    await amount.fill('0.03')
    await page.mouse.click(15, 350)
    await expect(dialog).toBeVisible()
    await expect(amount).toHaveValue('0.03')
    await dialog.getByRole('button', { name: 'Close', exact: true }).focus()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Review unstake', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(open).toBeFocused()
    await open.click()
    await expect(amount).toHaveValue('0.03')
    await from('Falcon-512').click()
    await expect(amount).toHaveValue('')
    await amount.fill('0.04')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await open.click()
    await expect(from('Falcon-512')).toHaveAttribute('aria-selected', 'true')
    await expect(amount).toHaveValue('0.04')
    await from('ECDSA').click()
    await expect(amount).toHaveValue('0.03')
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await open.click()
    await expect(amount).toHaveValue('0.03')
    expect((await calls(page)).filter((c) => ['stakingBuildWithdrawal', 'stakingConfirm'].includes(c.method))).toHaveLength(0)
    await dialog.getByRole('button', { name: 'Review unstake', exact: true }).click()
    const review = dialog.getByRole('region', { name: 'Review unstake', exact: true })
    await expect(review).toBeVisible()
    await dialog.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(amount).toHaveValue('0.03')
    await expect(amount).toBeFocused()
    expect(await count(page, 'stakingConfirm')).toBe(0)
    await page.screenshot({ path: 'docs/delegation-implementation/unstake-dialog-retained.png' })
  } finally { await app.close() }
})

test('unstake amount stays neutral until invalid input is left or an empty form is submitted', async () => {
  const { app, page } = await launchWalletUi('staking=1')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(900, 560))
    // This fixture mounts WalletShell without the app's title bar/theme toggle.
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    await openStaking(page)
    await page.getByRole('button', { name: 'Unstake', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Unstake', exact: true })
    const amount = dialog.getByRole('textbox', { name: /^Amount you receive/ })
    const max = dialog.getByRole('button', { name: 'Max', exact: true })
    await expect(amount).toBeFocused()
    await expect(amount).toHaveValue('')
    await expect(amount).toHaveAttribute('placeholder', '0.00')
    await expect(amount).not.toHaveAttribute('aria-invalid', 'true')
    await page.keyboard.press('Tab')
    await expect(max).toBeFocused()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await amount.focus()
    await dialog.getByRole('heading', { name: 'Unstake', exact: true }).click()
    await expect(amount).not.toHaveAttribute('aria-invalid', 'true')
    await expect(dialog.getByText('Enter an amount or use Max.', { exact: true })).toBeHidden()
    await dialog.screenshot({ path: 'docs/delegation-implementation/unstake-amount-empty.png' })

    await dialog.getByRole('button', { name: 'Review unstake', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Enter an amount or use Max.')
    await expect(amount).toHaveAttribute('aria-invalid', 'true')
    await expect(amount).toBeFocused()
    expect((await calls(page)).filter((c) => ['stakingBuildWithdrawal', 'stakingConfirm'].includes(c.method))).toHaveLength(0)

    await amount.fill('0')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('alert')).toHaveText('Amount must be greater than zero.')
    await expect(amount).toHaveAttribute('aria-invalid', 'true')
    await amount.fill('')
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(amount).not.toHaveAttribute('aria-invalid', 'true')

    // Max must work on the first click even when leaving an invalid amount.
    await amount.fill('2')
    await max.click()
    await expect(amount).toHaveValue('0.09999')
    await expect(max).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(amount).not.toHaveAttribute('aria-invalid', 'true')
    await dialog.screenshot({ path: 'docs/delegation-implementation/unstake-amount-max.png' })
    await amount.fill('0.03')
    await page.keyboard.press('Tab')
    await expect(max).toHaveAttribute('aria-pressed', 'false')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
  } finally { await app.close() }
})

test('unstake cannot be dismissed while its calculation is pending', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-withdrawal-delayed=1')
  try {
    await openStaking(page)
    await page.getByRole('button', { name: 'Unstake', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Unstake', exact: true })
    await dialog.getByRole('textbox', { name: /^Amount you receive/ }).fill('0.03')
    await dialog.getByRole('button', { name: 'Review unstake', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Calculating…', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
    for (let n = 0; n < 5; n++) { await page.keyboard.press('Escape'); await expect(dialog).toBeVisible() }
    await page.mouse.click(15, 350)
    await expect(dialog).toBeVisible()
    await page.evaluate(() => (window as unknown as { walletUiTest: { releaseWithdrawal: () => void } }).walletUiTest.releaseWithdrawal())
    await expect(dialog.getByRole('region', { name: 'Review unstake', exact: true })).toBeVisible()
  } finally { await app.close() }
})

test('repeated Escape during a failed calculation keeps the error and permits reopening the saved amount', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-withdrawal-delayed=1&staking-withdrawal-error=1')
  try {
    await openStaking(page)
    const open = page.getByRole('button', { name: 'Unstake', exact: true })
    await open.click()
    const dialog = page.getByRole('dialog', { name: 'Unstake', exact: true })
    await dialog.getByRole('textbox', { name: /^Amount you receive/ }).fill('0.03')
    await dialog.getByRole('button', { name: 'Review unstake', exact: true }).click()
    for (let n = 0; n < 5; n++) { await page.keyboard.press('Escape'); await expect(dialog).toBeVisible() }
    await page.evaluate(() => (window as unknown as { walletUiTest: { releaseWithdrawal: () => void } }).walletUiTest.releaseWithdrawal())
    await expect(dialog.getByRole('alert')).toHaveText('Refresh the balance before preparing a return.')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await open.click()
    await expect(dialog.getByRole('textbox', { name: /^Amount you receive/ })).toHaveValue('0.03')
  } finally { await app.close() }
})

test('successful refresh clears errors from the failed staking reads', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-load-error=1')
  try {
    await openStaking(page)
    await expect(page.getByText('Temporary staking refresh failure')).toBeVisible()
    await page.evaluate(() => { (window as unknown as { walletUiTest: { stakingLoadError: boolean } }).walletUiTest.stakingLoadError = false })
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(page.getByText(/Temporary staking/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Unstake', exact: true })).toBeEnabled()
  } finally { await app.close() }
})

test('token return shows token units and an ordinary fee before explicit confirmation', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-tokens=1')
  try {
    await openStaking(page)
    await expect(page.getByText('1.23 TOK arrived at this staking address').first()).toBeVisible()
    await page.getByRole('button', { name: 'Return tokens', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Return tokens', exact: true })
    const review = dialog.getByRole('region', { name: 'Review token return', exact: true })
    await expect(review.getByText('1.23 TOK', { exact: true })).toBeVisible()
    await expect(review.getByText(/Ordinary coins pay the network fee/)).toBeVisible()
    expect(await count(page, 'stakingConfirm')).toBe(0)
    await dialog.getByRole('button', { name: 'Confirm token return', exact: true }).click()
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    const row = page.getByRole('region', { name: 'Activity', exact: true }).getByRole('listitem').first()
    await expect(row).toContainText('Token return')
    await expect(row).toContainText('1.23 TOK')
  } finally { await app.close() }
})

test('uncertain operation can pause retries and separately review a competing recovery', async () => {
  const { app, page } = await launchWalletUi('staking=1')
  try {
    await openStaking(page)
    await page.getByRole('button', { name: 'Delegate coins', exact: true }).click()
    const delegate = page.getByRole('dialog', { name: 'Delegate coins', exact: true })
    await delegate.getByRole('textbox', { name: /^Amount to delegate/ }).fill('0.001')
    await delegate.getByRole('button', { name: 'Review delegation', exact: true }).click()
    await delegate.getByRole('button', { name: 'Confirm delegation', exact: true }).click()
    await delegate.getByRole('button', { name: 'Done', exact: true }).click()
    const row = page.getByRole('region', { name: 'Activity', exact: true }).getByRole('listitem').first()
    await row.getByRole('button', { name: 'Pause retries', exact: true }).click()
    await expect(row.getByText(/Automatic retries are paused/)).toBeVisible()
    const attention = page.getByRole('region', { name: 'Needs your attention', exact: true })
    await expect(attention).toContainText('is paused')
    await row.getByRole('button', { name: 'Resume retries', exact: true }).click()
    await expect(row.getByRole('button', { name: 'Pause retries', exact: true })).toBeVisible()
    await expect(attention).toHaveCount(0)
    await row.getByRole('button', { name: 'Review recovery transfer', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Recovery transfer', exact: true })
    const review = dialog.getByRole('region', { name: 'Review recovery transfer', exact: true })
    await expect(review.getByText(/either may confirm first/)).toBeVisible()
    await expect(review.getByText(/cannot cancel a copy already in the network/)).toBeVisible()
    expect(await count(page, 'stakingConfirm')).toBe(1)
    await dialog.getByRole('button', { name: 'Confirm recovery transfer', exact: true }).click()
    expect(await count(page, 'stakingConfirm')).toBe(2)
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Activity', exact: true }).getByRole('listitem').first()).toContainText('Recovery transfer')
  } finally { await app.close() }
})

test('mature but reserved coins are not offered as available to unstake', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-reserved=1')
  try {
    await openStaking(page)
    await expect(page.getByRole('button', { name: 'Unstake', exact: true })).toBeDisabled()
    await expect(page.getByText('Frozen or reserved', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/frozen or reserved by a pending operation/).first()).toBeVisible()
  } finally { await app.close() }
})

for (const network of ['testnet', 'mainnet']) test(`omits unknown service commission on ${network}`, async () => {
  const { app, page } = await launchWalletUi(`staking=1&staking-unverified=1&${network === 'mainnet' ? 'staking-mainnet=1&staking-disabled=1' : ''}`)
  try {
    await openStaking(page)
    await expect(page.getByRole('heading', { name: 'In staking', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'How it works', exact: true }).click()
    const help = page.getByRole('dialog', { name: 'How staking works', exact: true })
    await expect(help.getByRole('listitem')).toHaveCount(3)
    await expect(help.getByText('Service commission', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Not provided by the service', { exact: true })).toHaveCount(0)
  } finally { await app.close() }
})

test('keeps a supplied zero commission visible', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-commission=0%25')
  try {
    await openStaking(page)
    await page.getByRole('button', { name: 'How it works', exact: true }).click()
    const help = page.getByRole('dialog', { name: 'How staking works', exact: true })
    await expect(help.getByText('Service commission', { exact: true })).toBeVisible()
    await expect(help.getByText('0%', { exact: true })).toBeVisible()
  } finally { await app.close() }
})

test('a single funded key is the summary itself and unstakes without choosing a key', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-single=1')
  try {
    await openStaking(page)
    const summary = page.getByRole('region', { name: 'In staking', exact: true })
    await expect(summary).toContainText(`0.1009 ${QBTC}`)
    await expect(summary).toContainText('ECDSA key, delegated to Test service')
    await expect(page.getByRole('region', { name: 'Delegations', exact: true })).toHaveCount(0)
    await summary.getByText('Address and details', { exact: true }).click()
    await expect(summary.getByText('delegation-ecdsa-test-address', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Unstake', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Unstake', exact: true })
    await expect(dialog.getByRole('tab')).toHaveCount(0)
    await expect(dialog.getByText('From your ECDSA key', { exact: true })).toBeVisible()
  } finally { await app.close() }
})

test('an empty staking page explains delegation and starts it in the dialog', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-empty=1')
  try {
    await openStaking(page)
    await expect(page.getByRole('heading', { name: 'Nothing in staking yet', exact: true })).toBeVisible()
    await expect(page.getByText(/you can unstake unlocked coins at any time/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Unstake', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Delegate coins', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Delegate coins', exact: true })).toBeVisible()
  } finally { await app.close() }
})

test('shows five latest operations and reveals five more at a time without losing actions or loaded rows on refresh', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-many=1')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(900, 560))
    await openStaking(page)
    const activity = page.getByRole('region', { name: 'Activity', exact: true })
    const rows = activity.getByRole('listitem'), more = activity.getByRole('button', { name: 'Show more', exact: true })
    await expect(rows).toHaveCount(5)
    await expect(rows.first()).toContainText(`0.02 ${QBTC}`)
    await expect(rows.first()).toContainText('Delegation')
    await expect(rows.last()).toContainText(`0.016 ${QBTC}`)
    await more.scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'docs/delegation-implementation/staking-five-operations.png' })
    for (const shown of [10, 15, 20]) {
      await more.focus()
      await page.keyboard.press('Enter')
      await expect(rows).toHaveCount(shown)
      await expect(rows.nth(shown - 5).getByRole('button').first()).toBeFocused()
      await expect(activity.getByRole('status').filter({ hasText: /^Showing/ })).toHaveText(`Showing ${shown} of 20 operations`)
    }
    await expect(more).toHaveCount(0)
    await expect(rows.last()).toContainText(`0.001 ${QBTC}`)
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(rows).toHaveCount(20)
    await rows.last().getByRole('button').first().click()
    await rows.last().getByRole('button', { name: 'Pause retries', exact: true }).click()
    await expect(rows.last().getByRole('button', { name: 'Resume retries', exact: true })).toBeVisible()
    await rows.last().getByRole('button', { name: 'Review recovery transfer', exact: true }).click()
    const recovery = page.getByRole('dialog', { name: 'Recovery transfer', exact: true })
    await expect(recovery.getByRole('region', { name: 'Review recovery transfer', exact: true })).toBeVisible()
    await recovery.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(recovery).toHaveCount(0)
    await expect(rows).toHaveCount(20)
    await page.getByRole('button', { name: 'Delegate coins', exact: true }).click()
    const delegate = page.getByRole('dialog', { name: 'Delegate coins', exact: true })
    await delegate.getByRole('textbox', { name: /^Amount to delegate/ }).fill('0.001')
    await delegate.getByRole('button', { name: 'Review delegation', exact: true }).click()
    await delegate.getByRole('button', { name: 'Confirm delegation', exact: true }).click()
    await delegate.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(rows.first()).toContainText('Awaiting confirmation')
    await expect(activity.getByRole('status').filter({ hasText: /^Showing/ })).toHaveText('Showing 20 of 21 operations')
    await expect(more).toBeVisible()
    await more.click()
    await expect(rows).toHaveCount(21)
    await expect(rows.last().getByRole('button').first()).toBeFocused()
    await expect(more).toHaveCount(0)
  } finally { await app.close() }
})

test('the reviewed key cannot change while its unstake is calculating', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-withdrawal-delayed=1')
  try {
    await openStaking(page)
    await page.getByRole('button', { name: 'Unstake', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Unstake', exact: true })
    await dialog.getByRole('textbox', { name: /^Amount you receive/ }).fill('0.03')
    await dialog.getByRole('button', { name: 'Review unstake', exact: true }).click()
    await expect(dialog.getByRole('tab', { name: 'Falcon-512', exact: true })).toBeDisabled()
    await page.evaluate(() => (window as unknown as { walletUiTest: { releaseWithdrawal: () => void } }).walletUiTest.releaseWithdrawal())
    const review = dialog.getByRole('region', { name: 'Review unstake', exact: true })
    await expect(review.getByText('ordinary-return-ecdsa', { exact: true })).toBeVisible()
  } finally { await app.close() }
})

test('choosing another unstake key keeps keyboard focus on the chosen key', async () => {
  const { app, page } = await launchWalletUi('staking=1')
  try {
    await openStaking(page)
    await page.getByRole('button', { name: 'Unstake', exact: true }).click()
    const falcon = page.getByRole('dialog', { name: 'Unstake', exact: true }).getByRole('tab', { name: 'Falcon-512', exact: true })
    await falcon.click()
    await expect(falcon).toHaveAttribute('aria-selected', 'true')
    await expect(falcon).toBeFocused()
  } finally { await app.close() }
})

test('a rejected delegation explains why in its result', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-rejected=1')
  try {
    await openStaking(page)
    await page.getByRole('button', { name: 'Delegate coins', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delegate coins', exact: true })
    await dialog.getByRole('textbox', { name: /^Amount to delegate/ }).fill('0.001')
    await dialog.getByRole('button', { name: 'Review delegation', exact: true }).click()
    await dialog.getByRole('button', { name: 'Confirm delegation', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Transaction rejected.')
    await expect(dialog.getByText(/exceeds the 2 MiB sending limit/)).toBeVisible()
  } finally { await app.close() }
})

test('a stale key offers no amount even when a failed unstake reopens it', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-stale=1&staking-failed=1')
  try {
    await openStaking(page)
    await page.getByRole('region', { name: 'Needs your attention', exact: true }).getByRole('button', { name: 'Review a new unstake', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Unstake', exact: true })
    await expect(dialog.getByText(/Available: refresh required/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Review unstake', exact: true })).toBeDisabled()
  } finally { await app.close() }
})

test('opening Staking shows a neutral check until the first balance read finishes', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-slow-refresh=1')
  try {
    await openStaking(page)
    await expect(page.getByText('Checking staking balances…', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Nothing in staking/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Unstake', exact: true })).toHaveCount(0)
    await page.evaluate(() => (window as unknown as { walletUiTest: { releaseRefresh: () => void } }).walletUiTest.releaseRefresh())
    await expect(page.getByRole('region', { name: 'In staking', exact: true })).toContainText(`0.2018 ${QBTC}`)
  } finally { await app.close() }
})

test('address details stack each label above its value inside a key card', async () => {
  const { app, page } = await launchWalletUi('staking=1')
  try {
    await openStaking(page)
    const card = page.getByRole('region', { name: 'Delegations', exact: true }).getByRole('article', { name: 'ECDSA key', exact: true })
    await card.getByText('Address and details', { exact: true }).click()
    const label = (await card.getByText('Staking address', { exact: true }).boundingBox())!
    const value = (await card.getByText('delegation-ecdsa-test-address', { exact: true }).boundingBox())!
    expect(value.y).toBeGreaterThanOrEqual(label.y + label.height - 1)
    expect(Math.abs(value.x - label.x)).toBeLessThan(2)
  } finally { await app.close() }
})

test('a new delegation appears in the summary as pending right after it is sent', async () => {
  const { app, page } = await launchWalletUi('staking=1&staking-single=1')
  try {
    await openStaking(page)
    await page.getByRole('button', { name: 'Delegate coins', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delegate coins', exact: true })
    await dialog.getByRole('textbox', { name: /^Amount to delegate/ }).fill('0.001')
    await dialog.getByRole('button', { name: 'Review delegation', exact: true }).click()
    await dialog.getByRole('button', { name: 'Confirm delegation', exact: true }).click()
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    const summary = page.getByRole('region', { name: 'In staking', exact: true })
    await expect(summary).toContainText(`0.1019 ${QBTC}`)
    await expect(summary.getByText('Pending', { exact: true }).first()).toBeVisible()
  } finally { await app.close() }
})

test('the key switch stands out from the dark dialog surface', async () => {
  const { app, page } = await launchWalletUi('staking=1')
  try {
    await openStaking(page)
    await page.getByRole('button', { name: 'Unstake', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Unstake', exact: true })
    const colors = await dialog.evaluate((element) => {
      const background = (node: Element | null) => node === null ? '' : getComputedStyle(node).backgroundColor
      return { dialog: background(element), track: background(element.querySelector('.segmented')), active: background(element.querySelector('.segmented-btn[data-active="true"]')) }
    })
    expect(colors.track).not.toBe(colors.dialog)
    expect(colors.active).not.toBe(colors.track)
    expect(colors.active).not.toBe(colors.dialog)
  } finally { await app.close() }
})

test('How it works explains staking in a dialog with readable steps', async () => {
  const { app, page } = await launchWalletUi('staking=1')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(900, 560))
    await openStaking(page)
    await expect(page.getByText('How staking works', { exact: true })).toHaveCount(0)
    const open = page.getByRole('button', { name: 'How it works', exact: true })
    await open.click()
    const help = page.getByRole('dialog', { name: 'How staking works', exact: true })
    const steps = help.getByRole('listitem')
    await expect(steps).toHaveCount(3)
    await expect(help.getByText(/Coins move to a staking address that your key controls/)).toBeVisible()
    expect((await steps.first().boundingBox())!.height).toBeLessThan(90)
    await help.screenshot({ path: 'docs/delegation-implementation/staking-help-dialog.png' })
    await help.getByRole('button', { name: 'Got it', exact: true }).click()
    await expect(help).toHaveCount(0)
    await expect(open).toBeFocused()
  } finally { await app.close() }
})

test('staking help opens only for a new click, without replaying it after navigation or refresh', async () => {
  const { app, page } = await launchWalletUi('staking=1')
  try {
    const help = page.getByRole('dialog', { name: 'How staking works', exact: true })
    const open = page.getByRole('button', { name: 'How it works', exact: true })
    const home = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Wallet', exact: true })
    await openStaking(page)
    await expect(page.getByRole('region', { name: 'In staking', exact: true })).toBeVisible()
    await expect(help).toHaveCount(0)

    await open.click()
    await expect(help).toBeVisible()
    await help.getByRole('button', { name: 'Got it', exact: true }).click()
    await expect(help).toHaveCount(0)

    // The shell retains its header state while Staking unmounts and remounts.
    await home.click()
    await openStaking(page)
    await expect(page.getByRole('region', { name: 'In staking', exact: true })).toBeVisible()
    await expect(help).toHaveCount(0)
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(help).toHaveCount(0)

    // Explicit opening still works repeatedly after returning to the page.
    await open.click()
    await expect(help).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(help).toHaveCount(0)
    await expect(open).toBeFocused()
    await open.click()
    await expect(help).toBeVisible()
    await help.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(help).toHaveCount(0)
    await home.click()
    await openStaking(page)
    await expect(page.getByRole('region', { name: 'In staking', exact: true })).toBeVisible()
    await expect(help).toHaveCount(0)
    expect(await count(page, 'stakingConfirm')).toBe(0)
  } finally { await app.close() }
})
