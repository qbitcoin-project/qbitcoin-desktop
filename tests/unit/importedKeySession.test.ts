import { describe, expect, it, vi } from 'vitest'
import { ImportedKeySession } from '../../src/main/wallet/ImportedKeySession'
import type { ImportedKey } from '../../src/main/wallet/keyWallet'
import type { StoredKey } from '../../src/main/wallet/keyStore'

const stored: StoredKey = { wif: 'test-only', algo: 'ecdsa', address: 'test-only' }
const freshKey = (): ImportedKey => ({ algo: 'ecdsa', address: stored.address, privateKey: new Uint8Array(32).fill(1), publicKey: new Uint8Array(33) })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { resolve, promise }
}

describe('imported key session lifetime', () => {
  it('deduplicates concurrent materialization and wipes the only key on disposal', async () => {
    const key = freshKey()
    const materialize = vi.fn(async () => key)
    const session = new ImportedKeySession(async () => stored, materialize)
    const keys = await Promise.all([session.get(), session.get(), session.get()])
    expect(keys.every((k) => k === key)).toBe(true)
    expect(materialize).toHaveBeenCalledTimes(1)
    session.dispose()
    expect(key.privateKey.every((b) => b === 0)).toBe(true)
    await expect(session.get()).rejects.toThrow(/ended/)
    expect(materialize).toHaveBeenCalledTimes(1)
  })

  it('never starts decoding after a pending storage read finishes in a disposed session', async () => {
    const read = deferred<StoredKey>()
    const materialize = vi.fn(async () => freshKey())
    const session = new ImportedKeySession(() => read.promise, materialize)
    const pending = session.get()
    session.dispose()
    read.resolve(stored)
    await expect(pending).rejects.toThrow(/ended/)
    expect(materialize).not.toHaveBeenCalled()
  })

  it('wipes a key that finishes materializing after disposal, without touching the replacement session', async () => {
    const oldKey = freshKey(), newKey = freshKey()
    const started = deferred<void>(), result = deferred<ImportedKey>()
    const oldSession = new ImportedKeySession(async () => stored, () => { started.resolve(); return result.promise })
    const pending = oldSession.get()
    await started.promise
    oldSession.dispose()
    const replacement = new ImportedKeySession(async () => stored, async () => newKey)
    await replacement.get()
    result.resolve(oldKey)
    await expect(pending).rejects.toThrow(/ended/)
    expect(oldKey.privateKey.every((b) => b === 0)).toBe(true)
    expect(newKey.privateKey.some((b) => b !== 0)).toBe(true)
    await expect(oldSession.get()).rejects.toThrow(/ended/)
    replacement.dispose()
  })

  it('allows a live session to retry a failed storage read', async () => {
    const key = freshKey()
    const load = vi.fn().mockRejectedValueOnce(new Error('Read failed')).mockResolvedValue(stored)
    const session = new ImportedKeySession(load, async () => key)
    await expect(session.get()).rejects.toThrow('Read failed')
    expect(await session.get()).toBe(key)
    session.dispose()
  })
})
