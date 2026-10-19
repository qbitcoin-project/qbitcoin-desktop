import { describe, expect, it } from 'vitest'
import type { StakingAddressView, StakingOperationView } from '../../src/shared/staking'
import {
  balanceParts, barSegments, hasHoldings, keyName, lastReward, needsAttention, operationStatus, operationTitle, relativeTime, sortOperations,
} from '../../src/renderer/lib/stakingView'

const address = (overrides: Partial<StakingAddressView> = {}): StakingAddressView => ({
  address: 'delegation-ecdsa', algo: 'ecdsa', serviceLabel: 'Test service', delegatePubkeyhash: 'service', ownerPubkeyhash: 'owner',
  legacy: false, canFund: true, balanceAtomic: '0', confirmedAtomic: '0', pendingAtomic: '0', matureAtomic: '0', availableAtomic: '0',
  maturingAtomic: '0', unknownAtomic: '0', slashed: false, stale: false, ...overrides,
})
const op = (overrides: Partial<StakingOperationView> = {}): StakingOperationView => ({
  id: 'op', address: 'delegation-ecdsa', kind: 'withdrawal', state: 'confirmed', amountAtomic: '3000000', feeAtomic: '1000',
  destination: 'ordinary', createdAt: 1000, ...overrides,
})

describe('balanceParts', () => {
  it('splits one address into available, unlocking and its unlock time', () => {
    const parts = balanceParts([address({ balanceAtomic: '10090000', confirmedAtomic: '10090000', matureAtomic: '10000000', availableAtomic: '10000000', maturingAtomic: '90000', eligibleAt: 1700 })])
    expect(parts).toEqual({ balance: 10090000n, available: 10000000n, held: 0n, unlocking: 90000n, unknown: 0n, pending: 0n, stale: false, unlockAt: 1700 })
  })

  it('counts mature coins that are frozen or reserved as held, not available', () => {
    const parts = balanceParts([address({ balanceAtomic: '10000000', matureAtomic: '10000000', availableAtomic: '2500000' })])
    expect(parts.available).toBe(2500000n)
    expect(parts.held).toBe(7500000n)
  })

  it('treats mature coins as available when a view has no availability field', () => {
    const parts = balanceParts([address({ balanceAtomic: '4000000', matureAtomic: '4000000', availableAtomic: undefined })])
    expect(parts.available).toBe(4000000n)
    expect(parts.held).toBe(0n)
  })

  it('shows a stale balance as unknown and never as available', () => {
    const parts = balanceParts([address({ stale: true, balanceAtomic: '7500000', matureAtomic: '7500000', availableAtomic: '7500000', maturingAtomic: '0', eligibleAt: 5000 })])
    expect(parts).toMatchObject({ balance: 7500000n, available: 0n, held: 0n, unlocking: 0n, unknown: 7500000n, stale: true, unlockAt: undefined })
  })

  it('sums several addresses and reports when the last coin unlocks', () => {
    const parts = balanceParts([
      address({ balanceAtomic: '10090000', matureAtomic: '10000000', availableAtomic: '10000000', maturingAtomic: '90000', eligibleAt: 1700 }),
      address({ address: 'delegation-falcon', algo: 'falcon512', balanceAtomic: '25000000', confirmedAtomic: '20000000', pendingAtomic: '5000000',
        matureAtomic: '19000000', availableAtomic: '19000000', maturingAtomic: '1000000', unknownAtomic: '0', eligibleAt: 2100 }),
    ])
    expect(parts).toEqual({ balance: 35090000n, available: 29000000n, held: 0n, unlocking: 1090000n, unknown: 0n, pending: 5000000n, stale: false, unlockAt: 2100 })
  })

  it('keeps coins of unknown maturity apart from unlocking ones', () => {
    const parts = balanceParts([address({ balanceAtomic: '3000000', unknownAtomic: '3000000' })])
    expect(parts.unknown).toBe(3000000n)
    expect(parts.unlocking).toBe(0n)
  })
})

describe('barSegments', () => {
  it('returns non-empty parts in display order with shares summing to one', () => {
    const segments = barSegments({ balance: 100n, available: 60n, held: 10n, unlocking: 20n, unknown: 0n, pending: 10n, stale: false })
    expect(segments.map((s) => s.kind)).toEqual(['available', 'held', 'unlocking', 'pending'])
    expect(segments.map((s) => s.share)).toEqual([0.6, 0.1, 0.2, 0.1])
  })

  it('is empty when nothing is delegated', () => {
    expect(barSegments({ balance: 0n, available: 0n, held: 0n, unlocking: 0n, unknown: 0n, pending: 0n, stale: false })).toEqual([])
  })
})

describe('hasHoldings', () => {
  it('ignores an unused address', () => {
    expect(hasHoldings(address())).toBe(false)
  })

  it('keeps addresses with tokens, pending deposits or unreadable data', () => {
    expect(hasHoldings(address({ tokens: [{ id: 'token', amountAtomic: '123' }] }))).toBe(true)
    expect(hasHoldings(address({ pendingAtomic: '5000000' }))).toBe(true)
    expect(hasHoldings(address({ stale: true }))).toBe(true)
    expect(hasHoldings(address({ balanceAtomic: '1' }))).toBe(true)
  })
})

describe('lastReward', () => {
  it('uses the most recent observed stake across addresses', () => {
    const reward = lastReward([
      address({ lastStakeAt: 100, lastRewardAtomic: '5' }),
      address({ address: 'delegation-falcon', algo: 'falcon512', lastStakeAt: 200, lastRewardAtomic: '90000' }),
    ])
    expect(reward).toEqual({ at: 200, atomic: '90000', algo: 'falcon512' })
  })

  it('reports an unknown amount instead of inventing one', () => {
    expect(lastReward([address({ lastStakeAt: 100, rewardUnknown: true })])).toEqual({ at: 100, atomic: undefined, algo: 'ecdsa' })
  })

  it('is absent before the first stake', () => {
    expect(lastReward([address()])).toBeUndefined()
  })
})

describe('operation labels', () => {
  it('names each operation by what it does', () => {
    expect(operationTitle(op({ kind: 'funding' }))).toBe('Delegation')
    expect(operationTitle(op({ kind: 'withdrawal' }))).toBe('Unstake')
    expect(operationTitle(op({ tokenId: 'token' }))).toBe('Token return')
    expect(operationTitle(op({ recoveryOf: 'original' }))).toBe('Recovery transfer')
  })

  it('describes states in words', () => {
    const status = (o: StakingOperationView) => operationStatus(o, [o])
    expect(status(op({ state: 'prepared' }))).toEqual({ label: 'Not sent', tone: 'neutral' })
    expect(status(op({ state: 'signed' }))).toEqual({ label: 'Sending', tone: 'progress' })
    expect(status(op({ state: 'pending' }))).toEqual({ label: 'Awaiting confirmation', tone: 'progress' })
    expect(status(op({ state: 'pending', autoRetry: false }))).toEqual({ label: 'Retries paused', tone: 'warning' })
    expect(status(op({ state: 'confirmed' }))).toEqual({ label: 'Confirmed', tone: 'success' })
    expect(status(op({ state: 'conflict' }))).toEqual({ label: 'Didn’t go through', tone: 'danger' })
    expect(status(op({ state: 'rejected' }))).toEqual({ label: 'Rejected', tone: 'danger' })
    expect(status(op({ state: 'abandoned' }))).toEqual({ label: 'Not completed', tone: 'danger' })
  })

  it('marks the losing side of a recovery pair as replaced', () => {
    const original = op({ id: 'original', kind: 'funding', state: 'confirmed' })
    const recovery = op({ id: 'recovery', recoveryOf: 'original', state: 'conflict', createdAt: 2000 })
    expect(operationStatus(recovery, [original, recovery])).toEqual({ label: 'Replaced', tone: 'neutral' })
    const lost = op({ id: 'original', kind: 'funding', state: 'conflict' })
    const won = op({ id: 'recovery', recoveryOf: 'original', state: 'confirmed', createdAt: 2000 })
    expect(operationStatus(lost, [lost, won])).toEqual({ label: 'Replaced', tone: 'neutral' })
  })

  it('marks a recovery that lost to its confirmed original as replaced', () => {
    const original = op({ id: 'original', kind: 'funding', state: 'confirmed' })
    const refused = op({ id: 'recovery', recoveryOf: 'original', state: 'rejected', createdAt: 2000 })
    expect(operationStatus(refused, [original, refused])).toEqual({ label: 'Replaced', tone: 'neutral' })
  })

  it('shows a pending recovery on its original transfer', () => {
    const original = op({ id: 'original', kind: 'funding', state: 'pending', autoRetry: false })
    const recovery = op({ id: 'recovery', recoveryOf: 'original', state: 'pending', createdAt: 2000 })
    expect(operationStatus(original, [original, recovery])).toEqual({ label: 'Recovery sent', tone: 'progress' })
  })
})

describe('needsAttention', () => {
  it('flags a failed unstake until a newer unstake from the same address exists', () => {
    const failed = op({ id: 'failed', state: 'conflict', createdAt: 1000 })
    expect(needsAttention(failed, [failed])).toBe(true)
    const retried = op({ id: 'retried', state: 'pending', createdAt: 2000 })
    expect(needsAttention(failed, [failed, retried])).toBe(false)
  })

  it('is not cleared by newer operations of another kind, address or token', () => {
    const failed = op({ id: 'failed', state: 'rejected', createdAt: 1000 })
    const others = [
      op({ id: 'funding', kind: 'funding', createdAt: 2000 }),
      op({ id: 'elsewhere', address: 'delegation-falcon', createdAt: 3000 }),
      op({ id: 'tokens', tokenId: 'token', createdAt: 4000 }),
    ]
    expect(needsAttention(failed, [failed, ...others])).toBe(true)
  })

  it('ignores the expected conflict inside a recovery pair', () => {
    const original = op({ id: 'original', kind: 'funding', state: 'conflict' })
    const recovery = op({ id: 'recovery', recoveryOf: 'original', state: 'confirmed', createdAt: 2000 })
    expect(needsAttention(original, [original, recovery])).toBe(false)
  })

  it('flags a transfer whose retries stopped until a recovery is under way', () => {
    const stuck = op({ id: 'stuck', kind: 'funding', state: 'pending', autoRetry: false })
    expect(needsAttention(stuck, [stuck])).toBe(true)
    const recovering = op({ id: 'recovery', recoveryOf: 'stuck', state: 'pending', createdAt: 2000 })
    expect(needsAttention(stuck, [stuck, recovering])).toBe(false)
    const refused = op({ id: 'recovery', recoveryOf: 'stuck', state: 'rejected', createdAt: 2000 })
    expect(needsAttention(stuck, [stuck, refused])).toBe(true)
  })

  it('never flags a failed recovery itself; its original carries the decision', () => {
    const confirmed = op({ id: 'original', kind: 'funding', state: 'confirmed' })
    const rejected = op({ id: 'recovery', recoveryOf: 'original', state: 'rejected', createdAt: 2000 })
    expect(needsAttention(rejected, [confirmed, rejected])).toBe(false)
    const paused = op({ id: 'original', kind: 'funding', state: 'pending', autoRetry: false })
    const abandoned = op({ id: 'recovery', recoveryOf: 'original', state: 'abandoned', createdAt: 2000 })
    expect(needsAttention(abandoned, [paused, abandoned])).toBe(false)
    expect(needsAttention(paused, [paused, abandoned])).toBe(true)
  })

  it('leaves healthy operations alone', () => {
    for (const healthy of [op({ state: 'pending' }), op({ state: 'pending', autoRetry: true }), op({ state: 'confirmed' })]) {
      expect(needsAttention(healthy, [healthy])).toBe(false)
    }
  })
})

describe('sortOperations', () => {
  it('lists newest first and keeps later journal entries first on equal times', () => {
    const ops = [op({ id: 'a', createdAt: 1 }), op({ id: 'b', createdAt: 3 }), op({ id: 'c', createdAt: 2 }), op({ id: 'd', createdAt: 3 })]
    expect(sortOperations(ops).map((o) => o.id)).toEqual(['d', 'b', 'c', 'a'])
  })
})

describe('relativeTime', () => {
  const now = 1_000_000_000
  it('rounds to hours and minutes ahead', () => {
    expect(relativeTime(now / 1000 + 4 * 3600 + 12 * 60 + 30, now)).toBe('in 4 h 12 min')
    expect(relativeTime(now / 1000 + 2 * 3600, now)).toBe('in 2 h')
    expect(relativeTime(now / 1000 + 45 * 60, now)).toBe('in 45 min')
    expect(relativeTime(now / 1000 + 30, now)).toBe('in under a minute')
  })

  it('is empty once the time has passed', () => {
    expect(relativeTime(now / 1000 - 5, now)).toBe('')
  })
})

describe('keyName', () => {
  it('names the owner key by its signature scheme', () => {
    expect(keyName('ecdsa')).toBe('ECDSA key')
    expect(keyName('falcon512')).toBe('Falcon-512 key')
    expect(keyName('schnorr')).toBe('Schnorr key')
  })
})
