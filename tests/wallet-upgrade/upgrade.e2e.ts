import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { acceptPrivacy, focusedWindow } from '../e2e/privacyHelpers'
import type {} from '../../src/renderer/global'

test('upgrades an existing mainnet wallet with its original directory, vault, address and password', async () => {
  const previous = process.env.WALLET_PREVIOUS_BUILD
  if (!previous) throw new Error('Set WALLET_PREVIOUS_BUILD to the built main entry from the previous release.')
  const profile = test.info().outputPath('mainnet')
  mkdirSync(profile, { recursive: true })
  const password = 'example-upgrade-password'
  const launch = (entry: string) => electron.launch({
    args: [resolve(entry), '--use-mock-keychain', '--user-data-dir=' + profile],
    env: { ...process.env, WALLET_E2E_ROOT: profile },
  })
  let app = await launch(previous)
  try {
    let page = await focusedWindow(app)
    const button = (name: string) => page.getByRole('button', { name, exact: true })
    await button('I already have a wallet').click()
    await acceptPrivacy(page)
    await page.getByLabel('Recovery phrase').fill('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')
    await button('Continue').click()
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByLabel('Confirm password', { exact: true }).fill(password)
    await button('Restore wallet').click()
    await button('Open my wallet').click()
    await expect(button('Lock wallet')).toBeVisible()
    const receiveAddress = () => page.evaluate(async () => {
      const reply = await window.wallet.getReceiveAddress()
      if (!reply.ok || !reply.value) throw new Error('The unlocked wallet must have a receive address.')
      return reply.value
    })
    const address = await receiveAddress()
    const vaultPath = join(profile, 'wallets', 'default', 'vault.json')
    const encrypted = readFileSync(vaultPath)
    await app.close()

    app = await launch('test-results/stable-touch-id-app/main/index.js')
    page = await focusedWindow(app)
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await button('Unlock').click()
    await button('Enable Touch ID').click()
    await expect(button('Lock wallet')).toBeVisible()
    await button('Lock wallet').click()
    await button('Unlock with Touch ID').click()
    await expect(button('Lock wallet')).toBeVisible()
    expect(await receiveAddress()).toBe(address)
    await button('Lock wallet').click()
    await button('Use password').click()
    await page.getByLabel('Password', { exact: true }).fill(password)
    await button('Unlock').click()
    await expect(button('Lock wallet')).toBeVisible()
    expect(await receiveAddress()).toBe(address)
    expect(readFileSync(vaultPath)).toEqual(encrypted)
  } finally { await app.close() }
})
