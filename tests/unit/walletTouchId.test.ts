import { afterEach, describe, expect, it, vi } from 'vitest'
import { WalletTouchId, type DeviceKeyVault, type WalletKeychain } from '../../src/main/touchId/wallet'
import { freshSettings, type Settings } from '../../src/main/touchId/storage'
import { SESSION_IDLE_MS } from '../../src/main/touchId/lifetime'

const firstEnrollment = '26:' + 'a'.repeat(64)
const otherEnrollment = '26:' + 'b'.repeat(64)

function setup(initial: Settings = freshSettings()) {
  let settings = initial
  let unlocked = true
  let file = 'ciphertext'
  const key = Buffer.alloc(32, 7)
  const run = vi.fn<WalletKeychain['run']>(async action => action === 'read' ? { kind: 'ok', key: Buffer.from(key) } : { kind: 'ok' })
  const availability = vi.fn<WalletKeychain['availability']>(() => ({ availability: 'available', enrollment: firstEnrollment }))
  const native: WalletKeychain = { availability, run, cancel: vi.fn() }
  const verifyPassword = vi.fn(async (password: string) => {
    if (!unlocked || password !== 'correct') throw new Error('Incorrect wallet password')
  })
  const vault: DeviceKeyVault = {
    isUnlocked: () => unlocked, verifyPassword,
    runDeviceOperation: action => action(() => {}),
    async enrollDeviceKey(password, save) {
      if (!unlocked || password !== 'correct') throw new Error('Password required')
      await save(key, file)
    },
    async unlockWithDeviceKey(read, check) {
      const bytes = await read(file)
      try { check(); if (!key.equals(bytes)) throw new Error('Wrong key'); unlocked = true } finally { bytes.fill(0) }
    },
  }
  const device = new WalletTouchId({ read: () => settings, write: next => { settings = next } }, native, vault, () => true, async () => file)
  return { device, native, run, availability, verifyPassword, lock: () => { unlocked = false }, unlocked: () => unlocked, replace: () => { file += 'changed' }, settings: () => settings }
}
const settingsOwner = {}
const focus = () => true
afterEach(() => { vi.useRealTimers() })

describe('wallet Touch ID', () => {
  it('requires a verified password and an explicit choice from the same document', async () => {
    vi.useFakeTimers()
    const t = setup()
    const owner = {}
    await expect(t.device.prepareEntry('wrong', owner, focus)).rejects.toThrow('Password required')
    await expect(t.device.enableAtEntry(owner, focus)).rejects.toThrow()
    expect(await t.device.prepareEntry('correct', owner, focus)).toBe(true)
    // Reading the offer does not spend the 30 seconds for the system prompt.
    await vi.advanceTimersByTimeAsync(35_000)
    expect(t.device.status(owner).entryReady).toBe(true)
    expect(t.device.status({}).entryReady).toBe(false)
    await expect(t.device.enableAtEntry({}, focus)).rejects.toThrow()
    expect(t.run).not.toHaveBeenCalled()
    await t.device.enableAtEntry(owner, focus)
    await expect(t.device.enableAtEntry(owner, focus)).rejects.toThrow()
    expect(t.run.mock.calls.map(call => call[0])).toEqual(['create'])
    expect(t.run.mock.calls[0][4]).toBeGreaterThan(29_000)
    expect(t.run.mock.calls[0][2]).toEqual(Buffer.alloc(32))
    expect(t.device.status().enabled).toBe(true)
  })

  it('removes a provisional Keychain item if the vault changes during the enrollment prompt', async () => {
    const t = setup()
    const owner = {}
    await t.device.prepareEntry('correct', owner, focus)
    t.run.mockImplementationOnce(async () => { t.replace(); return { kind: 'ok' } })
    await expect(t.device.enableAtEntry(owner, focus)).rejects.toThrow()
    expect(t.run.mock.calls.map(call => call[0])).toEqual(['create', 'cleanup'])
    expect(t.settings().binding).toBeNull()
  })

  it.each(['later', 'lock', 'expiry', 'replacement'])('revokes the entry offer on %s', async reason => {
    vi.useFakeTimers()
    const t = setup()
    const owner = {}
    await t.device.prepareEntry('correct', owner, focus)
    if (reason === 'later') t.device.defer()
    if (reason === 'lock') { t.lock(); t.device.cancel() }
    if (reason === 'expiry') await vi.advanceTimersByTimeAsync(SESSION_IDLE_MS + 1)
    if (reason === 'replacement') t.replace()
    await expect(t.device.enableAtEntry(owner, focus)).rejects.toThrow()
    expect(t.run).not.toHaveBeenCalled()
    expect(t.settings().binding).toBeNull()
    if (reason === 'later') expect(await t.device.prepareEntry('correct', owner, focus)).toBe(false)
  })

  it('can defer enrollment, connect later, unlock and remove the protected key', async () => {
    const t = setup()
    t.device.defer()
    expect(t.device.status().offer).toBe(false)
    await expect(t.device.enable('wrong', focus)).rejects.toThrow('Password required')
    expect(t.run).not.toHaveBeenCalled()
    await t.device.enable('correct', focus)
    expect(t.settings().binding?.phase).toBe('active')
    expect(JSON.stringify(t.settings())).not.toContain(Buffer.alloc(32, 7).toString('hex'))
    t.lock()
    await t.device.unlock(focus)
    expect(t.unlocked()).toBe(true)
    await expect(t.device.disable(settingsOwner, focus)).resolves.toBe('disabled')
    expect(t.run.mock.calls.slice(-2).map(call => call[0])).toEqual(['verify', 'cleanup'])
    expect(t.settings().binding).toBeNull()
  })

  it('rejects a changed file before asking Keychain for any data', async () => {
    const t = setup()
    await t.device.enable('correct', focus)
    t.lock(); t.replace()
    await expect(t.device.unlock(focus)).rejects.toThrow('wallet changed')
    expect(t.run.mock.calls.map(call => call[0])).toEqual(['create', 'cleanup'])
    expect(t.unlocked()).toBe(false)
  })

  it.each(['cancel', 'deadline'])('rejects and wipes a late key after %s', async cause => {
    vi.useFakeTimers()
    const t = setup()
    await t.device.enable('correct', focus)
    t.lock()
    const bytes = Buffer.alloc(32, 7)
    let respond!: (r: { kind: string; key: Buffer }) => void
    t.run.mockImplementationOnce(() => new Promise(resolve => { respond = resolve }))
    const operation = t.device.unlock(focus)
    await vi.advanceTimersByTimeAsync(0)
    if (cause === 'cancel') t.device.cancel()
    else await vi.advanceTimersByTimeAsync(30_001)
    respond({ kind: 'ok', key: bytes })
    await expect(operation).resolves.toBe('cancelled')
    expect(bytes).toEqual(Buffer.alloc(32))
    expect(t.unlocked()).toBe(false)
  })

  it.each(['denied', 'lockout', 'unavailable'])('offers password when macOS returns %s', async kind => {
    const t = setup()
    await t.device.enable('correct', focus)
    t.lock()
    t.run.mockResolvedValueOnce({ kind })
    expect(await t.device.unlock(focus)).toBe('password-required')
    expect(t.unlocked()).toBe(false)
    // The next request follows the current OS capability.
    expect(await t.device.unlock(focus)).toBe('unlocked')
  })

  it.each(['cancelled', 'denied', 'error'])('keeps the binding after %s and refuses a password bypass', async kind => {
    const t = setup()
    await t.device.enable('correct', focus)
    const before = t.settings()
    t.run.mockResolvedValueOnce({ kind })
    const attempt = t.device.disable(settingsOwner, focus)
    if (kind === 'error') await expect(attempt).rejects.toThrow()
    else await expect(attempt).resolves.toBe(kind)
    await expect(t.device.disable(settingsOwner, focus, 'correct')).rejects.toThrow('Start turning off Touch ID again')
    expect(t.verifyPassword).not.toHaveBeenCalled()
    expect(t.settings()).toEqual(before)
    expect(t.run.mock.calls.map(call => call[0])).toEqual(['create', 'verify'])
  })

  it.each(['lockout', 'notEnrolled', 'unavailable', 'missing'] as const)('requires a fresh password for %s', async reason => {
    const t = setup()
    await t.device.enable('correct', focus)
    if (reason === 'missing') t.run.mockResolvedValueOnce({ kind: 'missing' })
    else t.availability.mockReturnValue({ availability: reason })
    await expect(t.device.disable(settingsOwner, focus)).resolves.toBe('password-required')
    await expect(t.device.disable(settingsOwner, focus, 'wrong')).rejects.toThrow('Incorrect wallet password')
    expect(t.settings().binding?.phase).toBe('active')
    await expect(t.device.disable(settingsOwner, focus, 'correct')).resolves.toBe('disabled')
    expect(t.settings().binding).toBeNull()
    expect(t.verifyPassword.mock.calls).toEqual([['wrong'], ['correct']])
  })

  it('binds the password fallback to the initiating window and revokes it on cancellation', async () => {
    const t = setup()
    await t.device.enable('correct', focus)
    t.run.mockResolvedValueOnce({ kind: 'unavailable' })
    await expect(t.device.disable(settingsOwner, focus)).resolves.toBe('password-required')
    await expect(t.device.disable({}, focus, 'correct')).rejects.toThrow()
    t.device.cancel()
    await expect(t.device.disable(settingsOwner, focus, 'correct')).rejects.toThrow()
    expect(t.verifyPassword).not.toHaveBeenCalled()
    expect(t.settings().binding?.phase).toBe('active')
  })

  it.each(['deadline', 'lock', 'password'])('discards late disable confirmation after %s', async reason => {
    vi.useFakeTimers()
    const t = setup()
    await t.device.enable('correct', focus)
    let reply!: () => void
    const wait = new Promise<void>(resolve => { reply = resolve })
    if (reason === 'password') {
      t.availability.mockReturnValue({ availability: 'lockout' })
      await expect(t.device.disable(settingsOwner, focus)).resolves.toBe('password-required')
      t.verifyPassword.mockImplementationOnce(() => wait)
    } else t.run.mockImplementationOnce(async () => { await wait; return { kind: 'ok' } })
    const attempt = t.device.disable(settingsOwner, focus, reason === 'password' ? 'correct' : undefined)
    await vi.advanceTimersByTimeAsync(0)
    if (reason === 'deadline') await vi.advanceTimersByTimeAsync(30_001)
    else { t.lock(); t.device.cancel() }
    reply()
    await expect(attempt).resolves.toBe('cancelled')
    expect(t.settings().binding?.phase).toBe('active')
    expect(t.run.mock.calls.map(call => call[0])).not.toContain('cleanup')
  })

  it.each(['lockout', 'unavailable', 'notEnrolled'] as const)('recovers from %s without replacing the enrollment', async reason => {
    const t = setup()
    t.run.mockResolvedValueOnce({ kind: 'ok', enrollment: firstEnrollment })
    await t.device.enable('correct', focus)
    const before = t.settings()
    t.availability.mockReturnValueOnce({ availability: reason })
    expect(t.device.status()).toMatchObject({ enabled: true, availability: reason, needsSetup: false })
    expect(t.device.status()).toMatchObject({ enabled: true, availability: 'available', needsSetup: false })
    expect(t.settings()).toBe(before)
    expect(t.run.mock.calls.map(c => c[0])).toEqual(['create'])
  })

  it.each(['denied', 'itemUnavailable', 'interactionRequired', 'cancelled'])('does not replace an enrollment after %s', async kind => {
    const t = setup()
    await t.device.enable('correct', focus)
    t.lock()
    t.run.mockResolvedValueOnce({ kind })
    await t.device.unlock(focus)
    expect(t.device.status().needsSetup).toBe(false)
    await expect(t.device.unlock(focus)).resolves.toBe('unlocked')
    await expect(t.device.enable('correct', focus)).rejects.toThrow('already exists')
  })

  it('repairs a confirmed changed enrollment after a fresh password and a new touch', async () => {
    const t = setup()
    t.run.mockResolvedValueOnce({ kind: 'ok', enrollment: firstEnrollment })
    await t.device.enable('correct', focus)
    t.availability.mockReturnValue({ availability: 'available', enrollment: otherEnrollment })
    expect(t.device.status()).toMatchObject({ enabled: true, needsSetup: true, offer: false })
    expect(await t.device.unlock(focus)).toBe('password-required')
    await expect(t.device.enable('wrong', focus)).rejects.toThrow('Password required')
    expect(t.run.mock.calls.map(c => c[0])).toEqual(['create'])

    t.run.mockResolvedValueOnce({ kind: 'missing' }).mockResolvedValueOnce({ kind: 'cancelled' })
    await expect(t.device.enable('correct', focus)).rejects.toThrow('cancelled')
    expect(t.device.status().needsSetup).toBe(true)
    const restarted = setup(t.settings())
    restarted.availability.mockReturnValue({ availability: 'available', enrollment: otherEnrollment })
    expect(restarted.device.status().needsSetup).toBe(true)
    restarted.run.mockResolvedValueOnce({ kind: 'missing' }).mockResolvedValueOnce({ kind: 'ok', enrollment: otherEnrollment })
    await restarted.device.enable('correct', focus)
    expect(restarted.device.status().needsSetup).toBe(false)
    restarted.lock()
    expect(await restarted.device.unlock(focus)).toBe('unlocked')
    expect(restarted.run.mock.calls.map(c => c[0])).toEqual(['cleanup', 'create', 'read'])
  })

  it('recovers an interrupted repair and drops it when the vault was replaced', async () => {
    const t = setup()
    await t.device.enable('correct', focus)
    t.run.mockResolvedValueOnce({ kind: 'missing' })
    await t.device.unlock(focus)
    expect(t.device.status().needsSetup).toBe(true)
    expect(await t.device.disable(settingsOwner, focus)).toBe('password-required')
    let pending!: Settings
    t.run.mockImplementationOnce(async () => { pending = t.settings(); return { kind: 'ok' } })
    await t.device.enable('correct', focus)
    await expect(t.device.disable(settingsOwner, focus, 'correct')).rejects.toThrow('Start turning off Touch ID again')
    expect(pending.binding?.phase).toBe('creating')
    const restarted = setup(pending)
    expect(restarted.device.status()).toMatchObject({ enabled: true, needsSetup: true, offer: false })
    await restarted.device.recover('ciphertext')
    expect(restarted.device.status().needsSetup).toBe(true)
    const replaced = setup(pending)
    await replaced.device.recover(null)
    expect(replaced.settings().binding).toBeNull()
  })

  it('adopts a legacy or new OS baseline only after a successful protected read', async () => {
    const t = setup()
    await t.device.enable('correct', focus)
    for (const enrollment of [firstEnrollment, '27:' + 'c'.repeat(64)]) {
      t.availability.mockReturnValue({ availability: 'available', enrollment })
      const before = t.settings()
      expect(t.device.status().needsSetup).toBe(false)
      t.run.mockResolvedValueOnce({ kind: 'itemUnavailable' })
      await t.device.unlock(focus)
      expect(t.settings()).toBe(before)
      t.run.mockResolvedValueOnce({ kind: 'ok', key: Buffer.alloc(32, 7), enrollment })
      expect(await t.device.unlock(focus)).toBe('unlocked')
      expect(t.settings().binding).toMatchObject({ enrollment })
    }
  })
})
