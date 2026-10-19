import type { StakingAddressView, StakingChainActivity, StakingOperationView, StakingOwnerAlgo } from '../../shared/staking'

export type StakingActivityEntry = StakingOperationView | StakingChainActivity
export const isChainActivity = (entry: StakingActivityEntry): entry is StakingChainActivity => 'source' in entry && entry.source === 'chain'

/** Journal entries retain their intent/actions. Chain observations only fill
 * gaps, separately for each staking address touched by a transaction. */
export function mergeStakingActivity(operations: readonly StakingOperationView[], observed: readonly StakingChainActivity[] = []): StakingActivityEntry[] {
  const key = (entry: { txid?: string; address: string }): string => `${entry.address}:${entry.txid}`
  const known = new Set(operations.filter((op) => op.txid !== undefined).map(key))
  const chain = new Map(observed.filter((entry) => !known.has(key(entry))).map((entry) => [key(entry), entry]))
  const merged: StakingActivityEntry[] = [...operations].reverse()
  merged.push(...chain.values())
  return merged.sort((a, b) => (b.createdAt ?? -1) - (a.createdAt ?? -1))
}

export function chainActivityTitle(entry: StakingChainActivity): string {
  switch (entry.kind) {
    case 'deposit': return 'Staking deposit'
    case 'withdrawal': return 'Staking withdrawal'
    case 'stake': return 'Stake reward'
    case 'slashing': return 'Slashing'
    case 'transaction': return entry.tokenChanges.length > 0 ? 'Token transaction' : 'Staking transaction'
  }
}

/** What the summary bar shows: every native coin at the staking addresses,
 * split by whether the owner can unstake it now. Atomic integers throughout. */
export interface BalanceParts {
  readonly balance: bigint
  /** Mature, confirmed and neither frozen nor reserved by a pending operation. */
  readonly available: bigint
  /** Mature but frozen by the user or reserved by a pending operation. */
  readonly held: bigint
  /** Staked recently and still inside the stake maturity window. */
  readonly unlocking: bigint
  /** Maturity could not be determined, or the address could not be refreshed. */
  readonly unknown: bigint
  /** Incoming and not yet confirmed. */
  readonly pending: bigint
  readonly stale: boolean
  /** When the last unlocking coin matures (unix seconds). */
  readonly unlockAt?: number
}

export type SegmentKind = 'available' | 'held' | 'unlocking' | 'unknown' | 'pending'
export interface BarSegment { readonly kind: SegmentKind; readonly atomic: bigint; readonly share: number }

const big = (value: string | undefined): bigint => BigInt(value ?? '0')

export function balanceParts(addresses: readonly StakingAddressView[]): BalanceParts {
  let balance = 0n, available = 0n, held = 0n, unlocking = 0n, unknown = 0n, pending = 0n
  let stale = false
  let unlockAt: number | undefined
  for (const entry of addresses) {
    balance += big(entry.balanceAtomic)
    // A stale view may be a previous read: never offer it as spendable.
    if (entry.stale) { stale = true; unknown += big(entry.balanceAtomic); continue }
    const mature = big(entry.matureAtomic)
    const free = entry.availableAtomic === undefined ? mature : big(entry.availableAtomic)
    available += free
    held += mature > free ? mature - free : 0n
    unlocking += big(entry.maturingAtomic)
    unknown += big(entry.unknownAtomic)
    pending += big(entry.pendingAtomic)
    if (big(entry.maturingAtomic) > 0n && entry.eligibleAt !== undefined) unlockAt = Math.max(unlockAt ?? 0, entry.eligibleAt)
  }
  return { balance, available, held, unlocking, unknown, pending, stale, unlockAt }
}

const SEGMENT_ORDER: readonly SegmentKind[] = ['available', 'held', 'unlocking', 'unknown', 'pending']

export function barSegments(parts: BalanceParts): BarSegment[] {
  const present = SEGMENT_ORDER.map((kind) => ({ kind, atomic: parts[kind] })).filter((s) => s.atomic > 0n)
  const total = present.reduce((sum, s) => sum + s.atomic, 0n)
  return present.map((s) => ({ ...s, share: Number(s.atomic) / Number(total) }))
}

/** An address worth showing: anything on it, or data we could not read. */
export function hasHoldings(entry: StakingAddressView): boolean {
  return entry.stale || big(entry.balanceAtomic) > 0n || big(entry.pendingAtomic) > 0n || (entry.tokens?.length ?? 0) > 0
}

export function lastReward(addresses: readonly StakingAddressView[]): { at: number; atomic?: string; algo: StakingOwnerAlgo } | undefined {
  const latest = addresses.filter((a) => a.lastStakeAt !== undefined).sort((a, b) => b.lastStakeAt! - a.lastStakeAt!)[0]
  if (latest === undefined) return undefined
  return { at: latest.lastStakeAt!, atomic: latest.rewardUnknown === true ? undefined : latest.lastRewardAtomic, algo: latest.algo }
}

export function keyName(algo: StakingOwnerAlgo): string {
  return algo === 'falcon512' ? 'Falcon-512 key' : algo === 'schnorr' ? 'Schnorr key' : 'ECDSA key'
}

export function operationTitle(op: StakingOperationView): string {
  if (op.recoveryOf !== undefined) return 'Recovery transfer'
  if (op.tokenId !== undefined) return 'Token return'
  return op.kind === 'funding' ? 'Delegation' : 'Unstake'
}

export type StatusTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger'
export interface OperationStatus { readonly label: string; readonly tone: StatusTone }

const isActive = (op: StakingOperationView): boolean => op.state === 'prepared' || op.state === 'signed' || op.state === 'pending'
const isProblem = (op: StakingOperationView): boolean => op.state === 'conflict' || op.state === 'rejected' || op.state === 'abandoned'
const recoveryOf = (op: StakingOperationView, all: readonly StakingOperationView[]): StakingOperationView | undefined =>
  all.filter((item) => item.recoveryOf === op.id).sort((a, b) => b.createdAt - a.createdAt)[0]

/** Exactly one side of an original/recovery pair can confirm. A recovery that
 * conflicted or was refused while its original confirmed lost by design, and so
 * did an original whose recovery confirmed. */
function replaced(op: StakingOperationView, all: readonly StakingOperationView[]): boolean {
  if (op.recoveryOf !== undefined) return isProblem(op) && all.find((item) => item.id === op.recoveryOf)?.state === 'confirmed'
  return op.state === 'conflict' && all.some((item) => item.recoveryOf === op.id && item.state === 'confirmed')
}

export function operationStatus(op: StakingOperationView, all: readonly StakingOperationView[]): OperationStatus {
  if (replaced(op, all)) return { label: 'Replaced', tone: 'neutral' }
  if (isActive(op)) {
    const recovery = recoveryOf(op, all)
    if (recovery !== undefined && isActive(recovery)) return { label: 'Recovery sent', tone: 'progress' }
    if (op.autoRetry === false) return { label: 'Retries paused', tone: 'warning' }
  }
  switch (op.state) {
    case 'prepared': return { label: 'Not sent', tone: 'neutral' }
    case 'signed': return { label: 'Sending', tone: 'progress' }
    case 'pending': return { label: 'Awaiting confirmation', tone: 'progress' }
    case 'confirmed': return { label: 'Confirmed', tone: 'success' }
    case 'conflict': return { label: 'Didn’t go through', tone: 'danger' }
    case 'rejected': return { label: 'Rejected', tone: 'danger' }
    case 'abandoned': return { label: 'Not completed', tone: 'danger' }
  }
}

/** Same address, same direction, same token: a newer attempt answers an older failure. */
const lane = (op: StakingOperationView): string => `${op.address}|${op.kind}|${op.tokenId ?? ''}`

/** Operations the owner has to act on. Terminal failures stop counting once a
 * newer attempt exists in their lane; stopped retries stop counting once a
 * recovery transfer is under way or has confirmed. */
export function needsAttention(op: StakingOperationView, all: readonly StakingOperationView[]): boolean {
  if (isProblem(op)) {
    // A failed recovery leaves its original paused, and the original asks for the decision.
    if (op.recoveryOf !== undefined || replaced(op, all)) return false
    return !all.some((item) => item.id !== op.id && lane(item) === lane(op) && item.createdAt > op.createdAt)
  }
  if (isActive(op) && op.autoRetry === false) {
    const recovery = recoveryOf(op, all)
    return recovery === undefined || !(isActive(recovery) || recovery.state === 'confirmed')
  }
  return false
}

/** Newest first; on equal times the later journal entry comes first. */
export function sortOperations(all: readonly StakingOperationView[]): StakingOperationView[] {
  return [...all].reverse().sort((a, b) => b.createdAt - a.createdAt)
}

/** "in 4 h 12 min" for a future unix time, or an empty string once it has passed. */
export function relativeTime(targetSeconds: number, nowMs: number): string {
  const seconds = targetSeconds - nowMs / 1000
  if (seconds <= 0) return ''
  if (seconds < 60) return 'in under a minute'
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  if (hours === 0) return `in ${rest} min`
  return rest === 0 ? `in ${hours} h` : `in ${hours} h ${rest} min`
}
