import { createHash, randomUUID } from 'node:crypto'
import type { TouchIdDisableResult, TouchIdStatus, TouchIdUnlockResult } from '../../shared/walletTouchId'
import type { Availability } from '../../shared/touchIdProbe'
import type { RestorableVault } from '../vault/RestorableVault'
import { SESSION_IDLE_MS, watchRequest } from './lifetime'
import type { StateStore } from './storage'

export type DeviceKeyVault = Pick<RestorableVault,
  'isUnlocked' | 'verifyPassword' | 'runDeviceOperation' | 'enrollDeviceKey' | 'unlockWithDeviceKey'>
type NativeResult = { kind: string; key?: Buffer; enrollment?: string }
export interface WalletKeychain {
  availability(): { availability: Availability; enrollment?: string }
  cancel(): void
  run(action: 'create' | 'read' | 'verify' | 'cleanup', account: string, key: Buffer | null,
    reason: string, remainingMs?: number): Promise<NativeResult>
}

type SaveKey = Parameters<DeviceKeyVault['enrollDeviceKey']>[1]
const fingerprint = (serialized: string) => createHash('sha256').update(serialized).digest('hex')
class BiometricFailure extends Error {
  constructor(readonly kind: string) {
    super(kind === 'cancelled' ? 'Touch ID request expired or was cancelled.' : 'Touch ID could not verify this request.')
  }

  get unavailable(): boolean {
    return ['lockout', 'unavailable', 'missing', 'mismatch', 'itemUnavailable', 'interactionRequired'].includes(this.kind)
  }
}
const cancelled = () => new BiometricFailure('cancelled')

type Prompt = (action: 'read' | 'create' | 'verify', id: string, reason: string, key?: Buffer) => Promise<NativeResult>

export class WalletTouchId {
  private settings: ReturnType<StateStore['read']>
  private current?: { cancelled: boolean; guard: ReturnType<typeof watchRequest> }
  private disableFallback?: { owner: object; id: string; expires: number }
  private generation = 0
  private cleaning?: Promise<void>
  private entry?: { owner: object; key: Buffer; digest: string; guard: ReturnType<typeof watchRequest> }

  constructor(private readonly store: StateStore, private readonly native: WalletKeychain,
    private readonly vault: DeviceKeyVault, private readonly screenAvailable: () => boolean,
    private readonly readVault: () => Promise<string | null>) {
    this.settings = store.read()
  }

  private save(settings: typeof this.settings): void {
    this.store.write(settings)
    this.settings = settings
  }

  status(owner?: object): TouchIdStatus {
    const binding = this.settings.binding
    const repairPending = binding?.phase === 'creating' && binding.repairDigest !== undefined
    const enabled = binding?.phase === 'active' || repairPending
    const { availability, enrollment } = this.native.availability()
    // Apple can change the state hash across major OS versions. Rebaseline
    // those bindings only after Keychain accepts a protected read.
    if (binding?.phase === 'active' && availability === 'available' && binding.enrollment && enrollment &&
        binding.enrollment.split(':')[0] === enrollment.split(':')[0] && binding.enrollment !== enrollment) {
      this.requireSetup(binding.id)
    }
    const current = this.settings.binding
    const needsSetup = repairPending || (current?.phase === 'active' && current.needsSetup === true)
    const entry = this.entry
    const entryReady = !!entry && entry.owner === owner && entry.guard.check() && this.vault.isUnlocked()
    return { availability, enabled, needsSetup, entryReady, offer: availability === 'available' && !this.settings.deferred && !binding }
  }

  private requireSetup(id: string): void {
    const binding = this.settings.binding
    if (binding?.phase === 'active' && binding.id === id && !binding.needsSetup) {
      this.save({ ...this.settings, binding: { ...binding, needsSetup: true } })
    }
  }

  defer(): void {
    if (!this.vault.isUnlocked()) throw new Error('Unlock your wallet first.')
    this.cancel()
    this.save({ ...this.settings, deferred: true })
  }

  cancel(): void {
    this.generation++
    this.disableFallback = undefined
    this.clearEntry()
    if (!this.current) return
    this.current.cancelled = true
    this.current.guard.stop()
    this.native.cancel()
  }

  private clearEntry(): void {
    this.entry?.guard.stop()
    this.entry?.key.fill(0)
    this.entry = undefined
  }

  // Prepare only for the document that just submitted the password. Keychain
  // is untouched until the user explicitly chooses to enroll on the next screen.
  async prepareEntry(password: string, owner: object, focused: () => boolean): Promise<boolean> {
    if (!this.vault.isUnlocked() || this.current || !this.status().offer || !focused()) return false
    const generation = ++this.generation
    this.clearEntry()
    let prepared: { key: Buffer; digest: string } | undefined
    try {
      await this.vault.runDeviceOperation(async check => {
        if (generation !== this.generation || !focused()) throw cancelled()
        await this.vault.enrollDeviceKey(password, async (key, serialized) => {
          check()
          if (generation !== this.generation || !focused()) throw cancelled()
          prepared = { key: Buffer.from(key), digest: fingerprint(serialized) }
        })
      })
      if (!prepared || generation !== this.generation || this.current || !this.vault.isUnlocked() || !focused()) return false
      this.entry = { ...prepared, owner, guard: watchRequest(this.screenAvailable, () => this.clearEntry(), SESSION_IDLE_MS) }
      prepared = undefined
      return true
    } finally { prepared?.key.fill(0) }
  }

  async enableAtEntry(owner: object, focused: () => boolean): Promise<void> {
    const entry = this.entry
    if (!entry || owner !== entry.owner || !entry.guard.check() || !this.vault.isUnlocked()) throw cancelled()
    this.entry = undefined
    entry.guard.stop()
    const currentFile = async () => {
      const serialized = await this.readVault()
      if (!serialized || fingerprint(serialized) !== entry.digest) throw cancelled()
      return serialized
    }
    try {
      await this.enroll(focused, async save => {
        await save(entry.key, await currentFile())
        await currentFile()
      })
    } finally { entry.key.fill(0) }
  }

  invalidate(): void {
    this.cancel()
    const binding = this.settings.binding
    if (binding && binding.phase !== 'removing') {
      this.save({ ...this.settings, binding: { phase: 'removing', id: binding.id } })
    }
  }

  credentialsChanging(): void {
    this.invalidate()
    // A pending marker makes deletion retryable after a locked Keychain or a crash.
    void this.cleanup().catch(() => {})
  }

  async recover(serialized: string | null): Promise<void> {
    const binding = this.settings.binding
    const digest = binding?.phase === 'active' ? binding.digest : binding?.phase === 'creating' ? binding.repairDigest : undefined
    if (digest && (!serialized || digest !== fingerprint(serialized))) this.invalidate()
    await this.cleanup()
  }

  private cleanup(): Promise<void> {
    if (this.cleaning) return this.cleaning
    const binding = this.settings.binding
    if (!binding || binding.phase === 'active' || this.current) return Promise.resolve()
    this.cleaning = this.native.run('cleanup', binding.id, null, 'Remove the wallet unlock key').then(result => {
      if (result.kind !== 'ok' && result.kind !== 'missing') throw new Error('Could not remove the old Touch ID key. Try again.')
      const pending = this.settings.binding
      if (pending?.id !== binding.id || pending.phase === 'active') return
      // A failed or interrupted repair can be retried from Settings after cleanup.
      const restore = pending.phase === 'creating' && pending.repairDigest
      this.save({ ...this.settings, binding: restore ? { phase: 'active', id: binding.id, digest: restore, needsSetup: true } : null })
    }).finally(() => { this.cleaning = undefined })
    return this.cleaning
  }

  // The protected read, password check and any state change share the vault's
  // session queue. A late reply cannot commit after a lock or a file change.
  private async withRequest(focused: () => boolean, work: (authorize: () => void, prompt: Prompt) => Promise<void>): Promise<void> {
    if (this.current || !focused()) throw cancelled()
    const generation = this.generation
    await this.cleanup()
    if (this.current || this.generation !== generation || !focused()) throw cancelled()
    const guard = watchRequest(this.screenAvailable, () => this.cancel())
    const operation = { cancelled: false, guard }
    this.current = operation
    try {
      await this.vault.runDeviceOperation(async checkSession => {
        const authorize = () => {
          if (operation.cancelled || !guard.check() || !focused()) throw cancelled()
          checkSession()
        }
        const prompt: Prompt = async (action, id, reason, key) => {
          authorize()
          const result = await this.native.run(action, id, key ?? null, reason, guard.remainingMs())
          try {
            // Allow the wallet to regain focus when the system sheet closes.
            for (let i = 0; i < 12 && !operation.cancelled && !focused(); i++) await new Promise(r => setTimeout(r, 50))
            authorize()
            if (result.kind !== 'ok') {
              if (action !== 'create' && (result.kind === 'missing' || result.kind === 'mismatch')) this.requireSetup(id)
              throw new BiometricFailure(result.kind)
            }
            if (action !== 'read') result.key?.fill(0)
            return result
          } catch (error) { result.key?.fill(0); throw error }
        }
        authorize()
        await work(authorize, prompt)
      })
    } finally {
      guard.stop()
      this.current = undefined
      await this.cleanup()
    }
  }

  async disable(owner: object, focused: () => boolean, password?: string): Promise<TouchIdDisableResult> {
    let result: TouchIdDisableResult = 'disabled'
    try {
      await this.withRequest(focused, async (authorize, prompt) => {
        const status = this.status()
        const binding = this.settings.binding
        if (!this.vault.isUnlocked() || binding?.phase !== 'active') throw new Error('Unlock the wallet with an active Touch ID binding first.')
        if (password !== undefined) {
          const fallback = this.disableFallback
          if (!fallback || fallback.owner !== owner || fallback.id !== binding.id || performance.now() >= fallback.expires) {
            throw new Error('Start turning off Touch ID again.')
          }
          await this.vault.verifyPassword(password)
        } else {
          this.disableFallback = undefined
          let available = status.availability === 'available' && !status.needsSetup
          if (available) {
            try { await prompt('verify', binding.id, 'turn off Touch ID for this wallet') }
            catch (error) {
              if (!(error instanceof BiometricFailure) || !error.unavailable) throw error
              available = false
            }
          }
          if (!available) {
            authorize()
            this.disableFallback = { id: binding.id, owner, expires: performance.now() + SESSION_IDLE_MS }
            result = 'password-required'
            return
          }
        }

        authorize()
        if (!this.vault.isUnlocked() || this.settings.binding !== binding) throw cancelled()
        this.disableFallback = undefined
        this.clearEntry()
        this.save({ ...this.settings, deferred: true, binding: { phase: 'removing', id: binding.id } })
      })
    } catch (error) {
      if (error instanceof BiometricFailure && (error.kind === 'cancelled' || error.kind === 'denied')) return error.kind
      throw error
    }
    return result
  }

  private enroll(focused: () => boolean, obtainKey: (save: SaveKey) => Promise<void>, allowRepair = false): Promise<void> {
    return this.withRequest(focused, async (authorize, prompt) => {
      const status = this.status()
      const previous = this.settings.binding
      if (previous && !(allowRepair && previous.phase === 'active' && previous.needsSetup)) throw new Error('A Touch ID key already exists.')
      if (status.availability !== 'available') throw new Error('Touch ID is unavailable on this Mac.')
      const id = previous?.id ?? randomUUID()
      let digest: string | undefined
      let enrollment: string | undefined
      await obtainKey(async (key, serialized) => {
        authorize()
        digest = fingerprint(serialized)
        if (previous && previous.digest !== digest) throw new Error('The wallet changed. Open Settings again.')
        this.save({ ...this.settings, binding: { phase: 'creating', id, repairDigest: previous?.digest } })
        if (previous) {
          const removed = await this.native.run('cleanup', id, null, 'Replace the old wallet unlock key')
          authorize()
          if (removed.kind !== 'ok' && removed.kind !== 'missing') throw new Error('Could not replace the old Touch ID key. Try again.')
        }
        const result = await prompt('create', id, 'enable Touch ID for this wallet', Buffer.from(key.buffer, key.byteOffset, key.byteLength))
        enrollment = result.enrollment
      })
      authorize()
      if (!digest) throw new Error('The wallet key could not be enrolled.')
      this.save({ ...this.settings, binding: { phase: 'active', id, digest, enrollment } })
    })
  }

  enable(password: string, focused: () => boolean): Promise<void> {
    this.disableFallback = undefined
    this.clearEntry()
    return this.enroll(focused, save => this.vault.enrollDeviceKey(password, save), true)
  }

  async unlock(focused: () => boolean): Promise<TouchIdUnlockResult> {
    try {
      await this.withRequest(focused, async (authorize, prompt) => {
        const status = this.status()
        const binding = this.settings.binding
        if (binding?.phase !== 'active' || status.availability !== 'available' || status.needsSetup) throw new BiometricFailure('unavailable')
        await this.vault.unlockWithDeviceKey(async serialized => {
          if (fingerprint(serialized) !== binding.digest) { this.invalidate(); throw new Error('This wallet changed. Use your password to reconnect Touch ID.') }
          const { key, enrollment } = await prompt('read', binding.id, 'unlock this wallet')
          try {
            if (this.settings.binding !== binding) throw cancelled()
            if (key?.length !== 32) throw new Error('Invalid Touch ID key.')
            if (enrollment && enrollment !== binding.enrollment) this.save({ ...this.settings, binding: { ...binding, enrollment } })
            return key
          } catch (error) { key?.fill(0); throw error }
        }, authorize)
      })
      return 'unlocked'
    } catch (error) {
      if (error instanceof BiometricFailure) return error.kind === 'cancelled' ? 'cancelled' : 'password-required'
      throw error
    }
  }
}
