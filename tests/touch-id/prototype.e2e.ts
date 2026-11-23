import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { focusedWindow } from '../e2e/privacyHelpers'

function launch(profile: string) {
  mkdirSync(profile, { recursive: true })
  return electron.launch({ args: [resolve('tests/touch-id/host.cjs'), '--use-mock-keychain', '--user-data-dir=' + profile],
    env: { ...process.env, PROBE_TEST_ROOT: profile } })
}

test('deferred enrollment, unlock, draft changes, late approval after wake, diagnostics and removal', async () => {
  const profile = test.info().outputPath('profile')
  let app = await launch(profile)
  try {
    let page = await focusedWindow(app)
    await page.getByRole('button', { name: 'Later', exact: true }).click()
    await app.close()
    app = await launch(profile)
    page = await focusedWindow(app)
    const click = (name: string) => page.getByRole('button', { name, exact: true }).click()
    await click('Enable in test settings')
    await expect(page.getByRole('status')).toContainText('Enrolled')
    await click('Try reading without a prompt')
    await expect(page.getByRole('status')).toContainText('PASS')
    await click('Unlock with Touch ID')
    await click('Prepare transfer')
    await click('Replace draft during prompt')
    await expect(page.getByRole('status')).toContainText('discarded')
    await click('Approve with Touch ID')
    await expect(page.getByText('Confirmed this run: 1')).toBeVisible()
    await click('Prepare transfer')
    await app.evaluate(({ app }) => app.emit('probe-test-hold'))
    await click('Approve with Touch ID')
    await expect(page.getByRole('status')).toContainText('Waiting for Touch ID')
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'))
    await expect(page.getByRole('status')).toContainText('locked')
    await app.evaluate(({ app }) => app.emit('probe-test-reply'))
    await expect(page.getByRole('button', { name: 'Unlock with Touch ID' })).toBeEnabled()
    await expect(page.getByText('Confirmed this run: 1')).toBeVisible()
    await click('Show test log in Finder')
    const file = readFileSync(join(profile, 'revealed.txt'), 'utf8')
    expect(basename(file)).toBe('touch-id-test.log')
    expect(file.startsWith(profile + '/')).toBe(true)
    const log = readFileSync(file, 'utf8')
    expect(log).toContain('"reason":"resume"')
    expect(log).toContain('"cause":"request-revoked"')
    expect(log).not.toContain(profile)
    await click('Remove test key')
    await expect(page.getByRole('status')).toContainText('removed')
  } finally { await app.close() }
})

test('expires an unanswered unlock after 30 real seconds and discards its late success', async () => {
  const app = await launch(test.info().outputPath('profile'))
  try {
    const page = await focusedWindow(app)
    await page.getByRole('button', { name: 'Enable Touch ID', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Enrolled')
    await app.evaluate(({ app }) => app.emit('probe-test-hold'))
    const start = Date.now()
    await page.getByRole('button', { name: 'Unlock with Touch ID' }).click()
    await expect(page.getByRole('status')).toContainText('expired', { timeout: 35_000 })
    expect(Date.now() - start).toBeGreaterThanOrEqual(30_000)
    await app.evaluate(({ app }) => app.emit('probe-test-reply'))
    await expect(page.getByRole('button', { name: 'Unlock with Touch ID' })).toBeEnabled()
    await expect(page.getByRole('heading', { name: 'Test session · locked' })).toBeVisible()
  } finally { await app.close() }
})

test('a pending unlock cannot complete after returning to the Mac even when only unlock-screen was delivered', async () => {
  const app = await launch(test.info().outputPath('profile'))
  try {
    const page = await focusedWindow(app)
    await page.getByRole('button', { name: 'Enable Touch ID', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Enrolled')
    await app.evaluate(({ app }) => app.emit('probe-test-hold'))
    const unlock = page.getByRole('button', { name: 'Unlock with Touch ID' })
    await unlock.click()
    await expect(page.getByRole('status')).toContainText('Waiting for Touch ID')
    await app.evaluate(({ powerMonitor, app }) => {
      powerMonitor.emit('unlock-screen')
      app.emit('probe-test-reply')
    })
    await expect(unlock).toBeEnabled()
    await expect(page.getByRole('heading', { name: 'Test session · locked' })).toBeVisible()
    await unlock.click()
    await expect(page.getByRole('heading', { name: 'Test session · unlocked' })).toBeVisible()
  } finally { await app.close() }
})
