import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProbeController, type NativeProbe } from '../../src/main/touchId/controller'
import { freshSettings, type Settings } from '../../src/main/touchId/storage'
import { onSessionChange, REQUEST_MS } from '../../src/main/touchId/lifetime'
import type { ProbeLog } from '../../src/main/touchId/log'

const digest = 'a0'.repeat(32)
type Result = Awaited<ReturnType<NativeProbe['run']>>
function fixture(screenAvailable = () => true) {
  let disk = freshSettings()
  const native: NativeProbe = {
    availability: () => 'available', cancel: vi.fn(),
    run: vi.fn<NativeProbe['run']>(async action => action === 'silent' ? { kind: 'interactionRequired', code: -25308 } :
      { kind: 'ok', code: 0, ...(action === 'create' ? { digest } : {}) }),
  }
  const log = vi.fn<ProbeLog>()
  const make = () => new ProbeController(native, { read: () => disk, write: (s: Settings) => { disk = s } }, vi.fn(), screenAvailable, log)
  return { native, make, probe: make(), disk: () => disk, log }
}
function holdRead(native: NativeProbe) {
  let finish!: (r: Result) => void
  const wait = new Promise<Result>(resolve => { finish = resolve })
  vi.mocked(native.run).mockImplementationOnce(async () => wait)
  return () => finish({ kind: 'ok', code: 0 })
}

describe('isolated Touch ID test session', () => {
  afterEach(() => vi.useRealTimers())
  it('persists Later and reads the same item after restart, separately for unlock and approval', async () => {
    const { native, probe, make, disk } = fixture()
    await probe.run('later')
    expect(make().state().deferred).toBe(true)
    await probe.run('enroll')
    const binding = disk().binding!
    expect(binding).toMatchObject({ phase: 'active', digest })
    const restarted = make()
    expect(restarted.state().unlocked).toBe(false)
    expect((await restarted.run('silent')).message).toMatch(/PASS/)
    expect((await restarted.run('unlock')).unlocked).toBe(true)
    const { draft } = await restarted.run('prepare')
    const cmd = { action: 'approve', draftId: draft!.id } as const
    expect((await restarted.run(cmd)).approvals).toBe(1)
    expect((await restarted.run(cmd)).approvals).toBe(1)
    expect(vi.mocked(native.run).mock.calls.filter(([op]) => op === 'read').map(([, id]) => id)).toEqual(Array(3).fill(binding.id))
    expect((await restarted.run('reset')).binding).toBe('absent')
  })

  it.each(['ok', 'mismatch', 'missing'] as const)('does not pass silent read when Keychain reports %s', async kind => {
    const { native, probe } = fixture()
    await probe.run('enroll')
    vi.mocked(native.run).mockResolvedValueOnce({ kind, code: 0 })
    const state = await probe.run('silent')
    expect(state.message).toContain(kind === 'missing' ? 'Inconclusive' : 'FAIL')
    expect(state.unlocked).toBe(false)
  })

  it('rejects a late success after lock, even if the system did not cancel in time', async () => {
    const { native, probe } = fixture()
    await probe.run('enroll')
    const finish = holdRead(native)
    const pending = probe.run('unlock')
    await probe.run('lock')
    await expect(probe.run('unlock')).rejects.toThrow(/finish/)
    finish()
    expect((await pending).unlocked).toBe(false)
    expect(native.cancel).toHaveBeenCalledOnce()
  })

  it('refuses success for a stale document and requires a fresh approval after replacing a draft', async () => {
    const { probe } = fixture()
    await probe.run('enroll')
    expect((await probe.run('unlock', async () => false)).unlocked).toBe(false)
    await probe.run('unlock')
    const draft = (await probe.run('prepare')).draft!
    const altered = await probe.run({ action: 'replaceDuringApproval', draftId: draft.id })
    expect(altered.approvals).toBe(0)
    expect(altered.draft?.id).not.toBe(draft.id)
    expect((await probe.run({ action: 'approve', draftId: draft.id })).approvals).toBe(0)
  })

  it('offers password on a completed denial and stays on Touch ID after cancellation', async () => {
    const { native, probe } = fixture()
    await probe.run('enroll')
    vi.mocked(native.run).mockResolvedValueOnce({ kind: 'cancelled', code: -128 })
    expect((await probe.run('unlock')).passwordScreen).toBe(false)
    vi.mocked(native.run).mockResolvedValue({ kind: 'denied', code: -25293 })
    expect((await probe.run('unlock')).passwordScreen).toBe(true)
    expect((await probe.run('password')).unlocked).toBe(false)
  })

  it('retries incomplete enrollment cleanup after restart', async () => {
    const { native, probe, make, disk } = fixture()
    vi.mocked(native.run).mockResolvedValueOnce({ kind: 'ok', digest, code: 0 })
      .mockResolvedValueOnce({ kind: 'cancelled', code: -128 }).mockResolvedValueOnce({ kind: 'error', code: -1 })
    expect((await probe.run('enroll')).binding).toBe('removing')
    const id = disk().binding!.id
    await make().recover()
    expect(native.run).toHaveBeenLastCalledWith('cleanup', id, '', expect.any(String))
    expect(disk().binding).toBeNull()
  })

  it('offers the password route when macOS ends the prompt and locks biometrics', async () => {
    const { native, probe } = fixture()
    await probe.run('enroll')
    native.availability = () => 'lockout'
    vi.mocked(native.run).mockResolvedValueOnce({ kind: 'cancelled', code: -128 })
    expect(await probe.run('unlock')).toMatchObject({ unlocked: false, passwordScreen: true })
  })

  it.each(['lock-screen', 'unlock-screen', 'suspend', 'resume', 'user-did-resign-active', 'user-did-become-active'])(
    'revokes an approval on %s even when this is the only delivered event', async event => {
      const { native, probe, log } = fixture()
      const power = new EventEmitter()
      const detach = onSessionChange(power, reason => probe.interrupt(true, reason))
      await probe.run('enroll')
      await probe.run('unlock')
      const draft = (await probe.run('prepare')).draft!
      const finish = holdRead(native)
      const pending = probe.run({ action: 'approve', draftId: draft.id })
      power.emit(event)
      expect(probe.state()).toMatchObject({ unlocked: false, draft: null, approvals: 0 })
      expect(native.cancel).toHaveBeenCalledOnce()
      finish()
      expect(await pending).toMatchObject({ unlocked: false, approvals: 0, busy: false })
      expect(log).toHaveBeenCalledWith('result-discarded', expect.objectContaining({ cause: 'request-revoked' }))
      expect((await probe.run('unlock')).unlocked).toBe(true)
      detach()
      expect(power.listenerCount(event)).toBe(0)
    })

  it.each(['unlock', 'approve', 'enroll'] as const)('discards a successful %s response after its 30-second deadline', async action => {
    vi.useFakeTimers()
    const { native, probe } = fixture()
    let draftId = 0
    if (action !== 'enroll') await probe.run('enroll')
    if (action === 'approve') {
      await probe.run('unlock')
      draftId = (await probe.run('prepare')).draft!.id
    }
    if (action === 'enroll') vi.mocked(native.run).mockResolvedValueOnce({ kind: 'ok', code: 0, digest })
    const finish = holdRead(native)
    const pending = probe.run(action === 'approve' ? { action, draftId } : action)
    await vi.advanceTimersByTimeAsync(REQUEST_MS - 1)
    expect(native.cancel).not.toHaveBeenCalled()
    await probe.run('status')
    await vi.advanceTimersByTimeAsync(1)
    expect(native.cancel).toHaveBeenCalledOnce()
    finish()
    expect(await pending).toMatchObject({ unlocked: action === 'approve', approvals: 0, busy: false,
      binding: action === 'enroll' ? 'absent' : 'active', message: expect.stringContaining('expired') })
  })

  it('locks the entire session when the deadline passes during a gap in screen observation', async () => {
    vi.useFakeTimers()
    const { native, probe } = fixture()
    await probe.run('enroll')
    await probe.run('unlock')
    const draft = (await probe.run('prepare')).draft!
    const finish = holdRead(native)
    const pending = probe.run({ action: 'approve', draftId: draft.id })
    vi.setSystemTime(Date.now() + REQUEST_MS + 1)
    finish()
    expect(await pending).toMatchObject({ unlocked: false, busy: false, approvals: 0, draft: null })
  })

  it('checks the deadline on the reply when only the last timer tick is late', async () => {
    vi.useFakeTimers()
    const { native, probe } = fixture()
    await probe.run('enroll')
    const finish = holdRead(native)
    const pending = probe.run('unlock')
    await vi.advanceTimersByTimeAsync(REQUEST_MS - 250)
    vi.setSystemTime(Date.now() + 300)
    finish()
    expect(await pending).toMatchObject({ unlocked: false, busy: false, message: expect.stringContaining('expired') })
  })

  it('detects a locked screen while waiting without any Electron event, even if it is active again at completion', async () => {
    vi.useFakeTimers()
    let available = true
    const { native, probe } = fixture(() => available)
    await probe.run('enroll')
    const finish = holdRead(native)
    const pending = probe.run('unlock')
    available = false
    await vi.advanceTimersByTimeAsync(250)
    available = true
    finish()
    expect((await pending).unlocked).toBe(false)
    expect(native.cancel).toHaveBeenCalledOnce()
  })

  it('refuses an interrupted observation interval and rechecks screen availability on completion', async () => {
    vi.useFakeTimers()
    let available = true
    const { native, probe } = fixture(() => available)
    await probe.run('enroll')
    for (const cause of ['gap', 'screen']) {
      const finish = holdRead(native)
      const pending = probe.run('unlock')
      if (cause === 'gap') vi.setSystemTime(Date.now() + 4_000)
      else available = false
      finish()
      expect((await pending).unlocked).toBe(false)
    }
    expect(native.cancel).toHaveBeenCalledTimes(2)
  })

  it('logs correlated outcomes and codes while keeping native payloads and bindings out of diagnostics', async () => {
    const { native, probe, log, disk } = fixture()
    await probe.run('enroll')
    vi.mocked(native.run).mockResolvedValueOnce({ kind: 'denied', domain: 'LAError', code: -1 })
    const state = await probe.run('unlock')
    expect(state.message).toContain('LAError -1')
    expect(log).toHaveBeenCalledWith('native-result', { request: 2, action: 'read', kind: 'denied', domain: 'LAError', code: -1 })
    expect(log).toHaveBeenCalledWith('command-finish', { request: 2, revoked: false, unlocked: false, approvals: 0 })
    expect(JSON.stringify(log.mock.calls)).not.toContain(digest)
    expect(JSON.stringify(log.mock.calls)).not.toContain(disk().binding!.id)
  })

  it.each(['missing', 'mismatch', 'configuration', 'lockout', 'error'] as const)('keeps a %s protected read from unlocking or approving', async kind => {
    const { native, probe } = fixture()
    await probe.run('enroll')
    vi.mocked(native.run).mockResolvedValueOnce({ kind, code: -1 })
    expect(await probe.run('unlock')).toMatchObject({ unlocked: false, passwordScreen: true })
    await probe.run('back')
    await probe.run('unlock')
    const draft = (await probe.run('prepare')).draft!
    vi.mocked(native.run).mockResolvedValueOnce({ kind, code: -1 })
    expect(await probe.run({ action: 'approve', draftId: draft.id })).toMatchObject({ draft, approvals: 0 })
  })

  it('requires new approval after cancellation and rejects a concurrent approval of the same draft', async () => {
    const { native, probe } = fixture()
    await probe.run('enroll')
    await probe.run('unlock')
    const draft = (await probe.run('prepare')).draft!
    const approve = { action: 'approve' as const, draftId: draft.id }
    const finish = holdRead(native)
    const pending = probe.run(approve)
    await expect(probe.run(approve)).rejects.toThrow(/finish/)
    await probe.run('cancel')
    finish()
    expect(await pending).toMatchObject({ approvals: 0, draft })
    expect(await probe.run(approve)).toMatchObject({ approvals: 1, draft: null })
  })
})
