import { ChainError, type ChainTx, type Outspend } from '@qbtc/chain'
import type { DelegationOperation } from './delegationStore'
import { MAX_BROADCAST_BYTES } from './transactionLimits'
import { isRecoveryOf } from './stakingRecovery'

export interface DelegationOperationReader {
  getTransaction(txid: string): Promise<ChainTx>
  getOutspend(txid: string, vout: number): Promise<Outspend>
  broadcastTransaction(rawHex: string): Promise<{ txid: string }>
  getBlockchainInfo?(): Promise<{ tipHeight: number }>
}
export const reservesStakingInputs = (op: DelegationOperation): boolean =>
  !['conflict', 'rejected', 'abandoned'].includes(op.state) && !op.settled
const TERMINAL_DEPTH = 6
const AUTO_ATTEMPTS = 8

/** Network observations never hold the spending queue. Only durable changes and
 * address bookkeeping do; each operation has one reconciliation in flight. */
export class DelegationOperationManager {
  private readonly flights = new Map<string, Promise<DelegationOperation>>()
  private readonly settledChecks = new Map<string, number>()
  constructor(private readonly deps: {
    reader: DelegationOperationReader
    save(op: DelegationOperation): Promise<void>
    current?(id: string): DelegationOperation | undefined
    validateRecovery?(op: DelegationOperation): Promise<void>
    mutate?<T>(work: () => Promise<T>): Promise<T>
    consumeChange(op: DelegationOperation): Promise<void>
    check(): void
    changed(): void
    now?: () => number
  }) {}

  reconcile(original: DelegationOperation, force = false): Promise<DelegationOperation> {
    const previous = this.flights.get(original.id)
    if (previous !== undefined) return force ? previous.then((op) => op.state === 'signed' ? this.reconcile(op, true) : op) : previous
    const run = this.run(original, force)
    this.flights.set(original.id, run)
    void run.then(() => this.flights.delete(original.id), () => this.flights.delete(original.id))
    return run
  }

  private async run(original: DelegationOperation, force: boolean): Promise<DelegationOperation> {
    let op = this.deps.current?.(original.id) ?? original
    const check = this.deps.check
    const mutate = <T,>(work: () => Promise<T>): Promise<T> => this.deps.mutate?.(work) ?? work()
    const save = async (patch: Partial<DelegationOperation>): Promise<void> => mutate(async () => {
      check()
      op = this.deps.current?.(op.id) ?? op
      if (original.state === 'prepared' && patch.state === 'abandoned' && op.state !== 'prepared') return
      if (Object.entries(patch).every(([key, value]) => op[key as keyof DelegationOperation] === value)) return
      const next = { ...op, ...patch }
      await this.deps.save(next)
      op = next
      check()
      this.deps.changed()
    })
    const now = this.deps.now?.() ?? Date.now()
    check()
    if (op.state === 'prepared') {
      await save({ state: 'abandoned', message: 'Signing did not finish. Review a new transaction.' })
      return op
    }
    if (['rejected', 'abandoned'].includes(op.state) || op.rawHex === undefined || op.txid === undefined) return op
    // A confirmed competitor can disappear after a reorg. Recheck every signed
    // conflict on the normal refresh cycle, without automatically resubmitting.
    const wasConflict = op.state === 'conflict'
    if (op.settled && !force && now - (this.settledChecks.get(op.id) ?? 0) < 600_000) return op
    let knownPending = false
    try {
      // Do not submit saved bytes that exceed the transport limit.
      if (op.rawHex.length / 2 > MAX_BROADCAST_BYTES) {
        await save({ state: 'rejected', settled: false, message: 'The saved transaction exceeds the 2 MiB sending limit. It was not sent. Review a smaller part.' })
        return op
      }
      let known: ChainTx | undefined
      try { known = await this.deps.reader.getTransaction(op.txid) }
      catch (error) { if (!(error instanceof ChainError && error.status === 404)) throw error }
      check()
      if (known !== undefined) {
        if (known.txid !== op.txid) throw new Error('Unexpected transaction response.')
        if (known.status.confirmed) {
          const tip = known.status.blockHeight === undefined ? undefined : await this.deps.reader.getBlockchainInfo?.()
          const settled = tip !== undefined && known.status.blockHeight !== undefined && tip.tipHeight - known.status.blockHeight + 1 >= TERMINAL_DEPTH
          await save({ state: 'confirmed', settled, message: undefined, ...(wasConflict ? { autoRetry: false } : {}) })
          if (settled) this.settledChecks.set(op.id, now)
          return op
        }
        knownPending = true
      }
      if (op.settled) {
        await save({ state: 'pending', settled: false, autoRetry: false, message: 'A previously confirmed transaction is no longer on this chain. Inputs are reserved again. Check its status before resubmitting.' })
      }
      const delay = Math.min(600_000, 30_000 * 2 ** Math.min(5, op.attempts ?? 0))
      if (!wasConflict && known === undefined && !force && op.lastAttemptAt !== undefined && now - op.lastAttemptAt < delay) return op
      // Pausing stops submission, not observation of confirmed competitors.
      for (const input of op.unsigned.inputs) {
        const spent = await this.deps.reader.getOutspend(input.prevTxid, input.vout)
        check()
        if (!spent.spent) continue
        if (spent.txid === op.txid && known !== undefined) continue
        if (spent.txid === undefined || spent.txid === op.txid) throw new Error('The transaction status is not yet consistent.')
        const other = await this.deps.reader.getTransaction(spent.txid)
        check()
        if (other.txid !== spent.txid) throw new Error('The transaction status is not yet consistent.')
        if (!other.status.confirmed) {
          const parent = op.recoveryOf === undefined ? undefined : this.deps.current?.(op.recoveryOf)
          if (isRecoveryOf(op, parent) && parent.txid === other.txid) continue
          throw new Error('A competing transaction is pending. Wait for its status to resolve.')
        }
        await save({ state: 'conflict', settled: false, autoRetry: false, message: 'The inputs were spent by another transaction. Refresh and review a new operation.' })
        return op
      }
      if (known !== undefined) {
        await save({ state: 'pending', settled: false, message: undefined, ...(wasConflict ? { autoRetry: false } : {}) })
        return op
      }
      if (op.state === 'conflict') await save({ state: 'pending', settled: false, autoRetry: false,
        message: 'The previous conflict is no longer confirmed. Inputs are reserved again. Check the operation before resubmitting.' })
      if (wasConflict) return op
      if (!force && op.autoRetry === false) return op
      if (!force && (op.attempts ?? 0) - (op.autoAttemptBase ?? 0) >= AUTO_ATTEMPTS) {
        await save({ autoRetry: false, message: 'Automatic retries have stopped. The transaction may still confirm; its inputs remain reserved. Check again or review a recovery transfer.' })
        return op
      }
      if (op.changeAddress !== undefined && !op.changeConsumed) {
        await mutate(async () => { check(); await this.deps.consumeChange(op); check() })
        await save({ changeConsumed: true })
      }
      if (op.recoveryOf !== undefined) {
        if (this.deps.validateRecovery === undefined) throw new Error('Recovery validation is unavailable.')
        await this.deps.validateRecovery(op)
        check()
      }
      const firstAttempt = (op.attempts ?? 0) === 0
      await save({ state: 'pending', attempts: (op.attempts ?? 0) + 1, lastAttemptAt: now, message: 'Checking submission status.' })
      check()
      if (!force && this.deps.current?.(op.id)?.autoRetry === false) return this.deps.current(op.id)!
      try {
        const sent = await this.deps.reader.broadcastTransaction(op.rawHex!)
        check()
        if (sent.txid !== op.txid) throw new Error('The node returned an unexpected transaction identifier.')
        await save({ message: undefined })
      } catch (error) {
        check()
        let found: ChainTx | undefined
        try { found = await this.deps.reader.getTransaction(op.txid!) } catch { /* Absence is not established by a failed read. */ }
        check()
        if (found?.txid === op.txid) {
          await save({ state: found.status.confirmed ? 'confirmed' : 'pending', message: undefined })
        } else if (firstAttempt && error instanceof ChainError &&
          (error.code === 'invalid_argument' || (error.code === 'broadcast_rejected' && (error.status === 400 || error.status === 422)))) {
          await save({ state: 'rejected', message: error.code === 'invalid_argument'
            ? 'The transaction was rejected locally before sending. Review a new transaction.'
            : 'The node rejected this transaction. Review a new operation; the wallet will not sign a replacement automatically.' })
        } else {
          await save({ message: 'Submission is uncertain. Inputs remain reserved. Check this transaction or review a recovery transfer; a timeout does not cancel it.' })
        }
      }
    } catch (error) {
      check()
      // A stale conflict must not leave inputs spendable when chain reads fail
      // or only an unconfirmed competitor is visible. Keep the exact signed tx.
      await save({ ...(wasConflict || knownPending ? { state: 'pending', settled: false } as const : {}),
        ...(wasConflict ? { autoRetry: false } : {}),
        message: error instanceof Error ? error.message : 'Could not verify the transaction status.' })
    }
    return op
  }
}
