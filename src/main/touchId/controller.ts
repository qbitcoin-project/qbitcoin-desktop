import { randomUUID } from 'node:crypto'
import type { Availability, Command, ProbeState } from '../../shared/touchIdProbe'
import type { Settings, StateStore } from './storage'
import { REQUEST_MS, watchRequest } from './lifetime'
import type { ProbeLog } from './log'

interface NativeResult {
  kind: 'ok' | 'cancelled' | 'denied' | 'lockout' | 'missing' | 'interactionRequired' | 'configuration' | 'mismatch' | 'error'
  code: number
  domain?: 'LAError'
  digest?: string
}
export interface NativeProbe {
  availability(): Availability
  run(action: 'create' | 'read' | 'silent' | 'remove' | 'cleanup', id: string, digest: string, reason: string, remainingMs?: number): Promise<NativeResult>
  cancel(): void
}

const reasons = {
  cancelled: 'Touch ID was cancelled.', denied: 'Touch ID did not verify.',
  lockout: 'Touch ID is locked.', missing: 'The test item is missing or was invalidated. Reset it to enroll again.',
  interactionRequired: 'Interaction was required.', configuration: 'Check the signed app entitlements and embedded profile.',
  mismatch: 'The returned key did not match.', error: 'Keychain access failed.',
}

export class ProbeController {
  private settings: Settings
  private generation = 0
  private activeRequest?: number
  private revision = 0
  private busy = false
  private unlocked = false
  private passwordScreen = false
  private approvals = 0
  private draftId = 0
  private draft: ProbeState['draft'] = null
  private message = 'Ready.'
  private guard?: ReturnType<typeof watchRequest>
  constructor(private readonly native: NativeProbe, private readonly store: StateStore,
    private readonly publish: (state: ProbeState) => void,
    private readonly screenAvailable: () => boolean = () => true,
    private readonly log: ProbeLog = () => {}) { this.settings = store.read() }

  get isBusy(): boolean { return this.busy }
  state(): ProbeState {
    return { revision: this.revision, availability: this.native.availability(), binding: this.settings.binding?.phase ?? 'absent',
      deferred: this.settings.deferred, unlocked: this.unlocked, passwordScreen: this.passwordScreen,
      busy: this.busy, draft: this.draft, approvals: this.approvals, message: this.message }
  }

  private notify(): void { this.revision++; this.publish(this.state()) }
  private save(settings: Settings): void { this.store.write(settings); this.settings = settings }
  private makeDraft(): void {
    const id = ++this.draftId
    this.draft = { id, amount: id % 2 ? '12' : '24', recipient: id % 2 ? 'Sample recipient A' : 'Sample recipient B' }
  }

  interrupt(lock: boolean, reason = lock ? 'manual-lock' : 'manual-cancel'): void {
    const request = this.activeRequest ?? 0
    this.log('interrupt', { request, reason, busy: this.busy })
    this.generation++
    this.guard?.stop()
    if (this.busy) {
      this.log('native-cancel', { request })
      this.native.cancel()
    }
    if (lock) {
      this.unlocked = false
      this.draft = null
      this.passwordScreen = false
    }
    this.message = reason === 'request-timeout' ? 'Touch ID request expired. Start a new request.' :
      lock ? 'Test session locked.' : 'Request cancelled.'
    this.notify()
  }

  async recover(): Promise<void> {
    const binding = this.settings.binding
    if (!binding || binding.phase === 'active') return
    try {
      await this.remove(binding.id, 'cleanup')
      this.message = 'Incomplete test enrollment removed.'
    } catch (error) {
      this.message = 'Use Remove test key to finish cleanup. ' + (error instanceof Error ? error.message : '')
    }
  }

  async run(command: Command, documentActive: () => Promise<boolean> = async () => true): Promise<ProbeState> {
    if (command === 'status') return this.state()
    if (command === 'lock' || command === 'cancel') {
      this.interrupt(command === 'lock')
      return this.state()
    }
    if (this.busy) throw new Error('Wait for the current system request to finish.')
    const generation = ++this.generation
    const guarded = command === 'enroll' || command === 'unlock' || command === 'reset' || typeof command === 'object'
    this.busy = true
    this.activeRequest = generation
    this.message = guarded ? `Waiting for Touch ID (up to ${REQUEST_MS / 1000} seconds)…` : 'Waiting for the current request…'
    this.notify()
    const guard = guarded ? watchRequest(this.screenAvailable, reason => this.interrupt(reason !== 'request-timeout', reason)) : undefined
    this.guard = guard
    const valid = () => generation === this.generation && (!guard || guard.check())
    const current = async (): Promise<boolean> => valid() && await documentActive() && valid()
    const binding = this.settings.binding
    this.log('command-start', { request: generation, action: typeof command === 'object' ? command.action : command })
    try {
      if (!valid()) throw new Error('Touch ID request is no longer active.')
      if (command === 'enroll') {
        await this.enroll(current)
      } else if (command === 'reset') {
        this.unlocked = false
        this.draft = null
        this.passwordScreen = false
        if (binding) await this.remove(binding.id, 'remove')
        this.message = 'Test item removed.'
      } else if (command === 'later') {
        this.save({ ...this.settings, deferred: true })
        this.message = 'Touch ID can be enabled in test settings.'
      } else if (command === 'password' || command === 'back') {
        this.passwordScreen = command === 'password'
        this.message = this.passwordScreen ? 'Wallet password fallback reached. No password is collected in this test.' : 'Ready.'
      } else if (command === 'prepare') {
        if (!this.unlocked) throw new Error('Unlock the test session first.')
        this.makeDraft()
        this.message = 'Review the sample transfer.'
      } else {
        await this.read(command, generation, current)
      }
    } catch (error) {
      if (generation === this.generation) this.message = error instanceof Error ? error.message : 'Test operation failed.'
    } finally {
      guard?.stop()
      this.guard = undefined
      this.busy = false
      this.activeRequest = undefined
      this.log('command-finish', { request: generation, revoked: generation !== this.generation, unlocked: this.unlocked, approvals: this.approvals })
      this.notify()
    }
    return this.state()
  }

  private async enroll(current: () => Promise<boolean>): Promise<void> {
    if (this.settings.binding) throw new Error('Reset the existing test item first.')
    if (this.native.availability() !== 'available') throw new Error('Set up Touch ID on this Mac to enroll.')
    const id = randomUUID()
    this.save({ ...this.settings, binding: { id, phase: 'creating' } })
    try {
      const created = await this.callNative('create', id, '', 'create the test key')
      if (created.kind !== 'ok') throw new Error(this.describe(created))
      if (!created.digest || !/^[0-9a-f]{64}$/.test(created.digest)) throw new Error('Missing test key fingerprint.')
      if (!await current()) throw new Error('Enrollment was interrupted.')
      const read = await this.callNative('read', id, created.digest, 'enable Touch ID for this test')
      if (!await current()) throw new Error('Enrollment was interrupted.')
      if (read.kind !== 'ok') throw new Error(this.describe(read))
      this.save({ version: 1, deferred: true, binding: { phase: 'active', id, digest: created.digest } })
      this.message = 'Enrolled. The protected test key matched.'
    } catch (error) {
      await this.remove(id, 'cleanup')
      throw error
    }
  }

  private async read(command: 'unlock' | 'silent' | Extract<Command, { draftId: number }>,
    generation: number, current: () => Promise<boolean>): Promise<void> {
    const binding = this.settings.binding
    if (binding?.phase !== 'active') throw new Error('Enroll a test key first.')
    const draft = this.draft
    const approving = typeof command === 'object'
    if (approving && (!this.unlocked || !draft || draft.id !== command.draftId)) throw new Error('Review the current transfer.')
    if (command === 'unlock' && this.unlocked) throw new Error('Lock the test session first.')
    const reason = approving && draft ? 'approve ' + draft.amount + ' test units to ' + draft.recipient : 'unlock the test session'
    const pending = this.callNative(command === 'silent' ? 'silent' : 'read', binding.id, binding.digest, reason)
    // Replace the reviewed draft while the native request is outstanding.
    if (approving && command.action === 'replaceDuringApproval') {
      this.makeDraft()
      this.notify()
    }
    const result = await pending
    if (!await current()) {
      this.log('result-discarded', { request: generation, cause: generation === this.generation ? 'window-inactive' : 'request-revoked' })
      if (generation === this.generation) this.message = 'Request discarded because its window is no longer active.'
    } else if (command === 'silent') {
      this.message = result.kind === 'interactionRequired' ? 'PASS: silent read refused (OSStatus ' + result.code + ').' :
        result.kind === 'ok' || result.kind === 'mismatch' ? 'FAIL: Keychain returned data without Touch ID.' :
        'Inconclusive: ' + this.describe(result)
    } else if (result.kind !== 'ok') {
      this.message = this.describe(result)
      if (command === 'unlock') {
        this.passwordScreen = result.kind !== 'cancelled' || this.native.availability() !== 'available'
      }
    } else if (approving) {
      if (this.draft !== draft) {
        this.log('result-discarded', { request: generation, cause: 'draft-changed' })
        this.message = 'Transfer changed. Approval discarded. Review again.'
      }
      else { this.approvals++; this.draft = null; this.message = 'Sample transfer approved once.' }
    } else {
      this.unlocked = true
      this.passwordScreen = false
      this.message = 'Unlocked. The protected test key matched.'
    }
  }

  private describe(result: NativeResult): string {
    return (result.kind === 'ok' ? 'Key matched.' : reasons[result.kind]) + ' (' + (result.domain ?? 'OSStatus') + ' ' + result.code + ')'
  }
  private async callNative(action: Parameters<NativeProbe['run']>[0], id: string, digest: string, reason: string): Promise<NativeResult> {
    const request = this.activeRequest ?? 0
    this.log('native-start', { request, action })
    const result = action === 'read' ? await this.native.run(action, id, digest, reason, this.guard!.remainingMs()) :
      await this.native.run(action, id, digest, reason)
    this.log('native-result', { request, action, kind: result.kind, domain: result.domain ?? 'OSStatus', code: result.code })
    return result
  }
  private async remove(id: string, action: 'remove' | 'cleanup'): Promise<void> {
    this.save({ ...this.settings, binding: { phase: 'removing', id } })
    const removed = await this.callNative(action, id, '', 'remove the test key')
    if (removed.kind !== 'ok') throw new Error(this.describe(removed))
    this.save({ ...this.settings, binding: null })
  }
}
