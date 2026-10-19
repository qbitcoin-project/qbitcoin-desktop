import type { MaxSendable, SendPreview, SendResult, TokenSendPreview } from '../../shared/protocol'
import { buildSend, buildTokenSendWithFee, estimateSendFee, InsufficientFundsError, type ChangeBranch, type SpendableTokenUtxo, type SpendableUtxo, type UnsignedTx } from './buildTx'
import type { GatheredUtxo } from './spendable'
import type { SignedTx } from './signTx'
import { ChainError } from '@qbtc/chain'
import { isMature } from '../../shared/maturity'
import { SendNeedsReviewError, SendUncertainError } from '../../shared/sendErrors'
import { assertBroadcastSize } from './transactionLimits'
import { draftSizeUpperBound } from './buildTx'
import { buildWithChange } from './buildWithChange'

// Dependencies, injected so the service is testable without crypto or network.
export interface SendDeps {
  gather(): Promise<GatheredUtxo[]>
  /** Fee rate in atomic units per vByte. */
  feeRate(): Promise<number>
  /** Outpoints (`txid:vout`) the user froze — excluded from automatic selection. */
  frozen(): Promise<ReadonlySet<string>>
  reserved?(): Promise<ReadonlySet<string>>
  /** A fresh classical (ECDSA) change address. */
  getChangeAddress(): Promise<string>
  /** A fresh post-quantum (Falcon) change address. */
  getPqChangeAddress(): Promise<string>
  /** Advance the change index on the HD branch the change output used. A key
   *  wallet has no branches to advance — its implementation is a no-op. */
  advanceChange(algo: ChangeBranch): Promise<void>
  sign(unsigned: UnsignedTx): Promise<SignedTx>
  broadcast(rawHex: string): Promise<string>
  /** Called after a successful broadcast so a cached spend pool can be dropped. */
  onSpent?(): void
  /** Invalidate cached inputs after any broadcast failure. */
  onBroadcastFailure?(): void
  /** True only when the exact locally signed transaction is known by the node. */
  isKnownTransaction?(txid: string): Promise<boolean>
  /** Recheck shared reservations before the first signature of this draft. */
  assertInputs?(unsigned: UnsignedTx): Promise<void>
}

const outpointOf = (u: SpendableUtxo): string => `${u.txid}:${String(u.vout)}`

// Orchestrates a send in two steps. buildSend assembles and HOLDS an unsigned
// draft and returns a preview to review; confirmSend signs that held draft,
// broadcasts it, and advances the change index. With an explicit `outpoints`
// set the user spends exactly those coins (manual coin control); otherwise the
// service auto-selects from the unfrozen pool. The held draft carries no secrets;
// signing happens only on confirm, in main, with keys derived from the Vault.
export class SendService {
  // The held draft: the unsigned tx plus which change branches to advance on confirm
  // (one for a native send; up to two — token + native — for a token send).
  private pending: { unsigned: UnsignedTx; advance: readonly ChangeBranch[]; recipient: string;
    signed?: SignedTx; uncertain?: boolean; accepted?: boolean; advanced?: number } | null = null
  private confirming: Promise<SendResult> | null = null
  private generation = 0

  constructor(private readonly deps: SendDeps) {}

  async buildSend(recipient: string, amountAtomic: bigint, outpoints?: readonly string[], sendMax = false): Promise<SendPreview> {
    this.startBuild()
    const generation = this.generation
    const { utxos, manualInputs } = await this.resolveInputs(outpoints)
    const rate = await this.deps.feeRate()
    // One estimator for every path (auto / manual / send-max), sized to the
    // actual inputs and change shape, so the preview fee equals the built fee
    // and auto and manual agree on the same coin set. Throws InsufficientFunds
    // here (before building) when even a changeless send can't be funded.

    const { built } = await buildWithChange(recipient, (changeAddressFor) => {
      const feeAtomic = estimateSendFee({ utxos, manualInputs, amountAtomic, feeRatePerVByte: rate, sendMax, recipient, changeAddressFor })
      return buildSend({ utxos, manualInputs, recipient, amountAtomic, feeAtomic, sendMax, changeAddressFor })
    }, (algo) => algo === 'falcon512' ? this.deps.getPqChangeAddress() : this.deps.getChangeAddress())
    this.checkBuild(generation)
    assertBroadcastSize(draftSizeUpperBound(manualInputs ?? utxos, built.unsigned))
    this.pending = {
      unsigned: built.unsigned,
      advance: built.changeAtomic > 0n && built.changeAlgo !== undefined ? [built.changeAlgo] : [],
      recipient,
    }
    // Report which signature scheme(s) the chosen inputs use, for the review.
    const algos = new Set(built.unsigned.inputs.map((i) => i.algo))
    const signature = [...algos].map((a) => (a === 'falcon512' ? 'Falcon-512' : a === 'schnorr' ? 'Schnorr' : 'ECDSA')).join(' + ')
    return {
      ...(manualInputs !== undefined && manualInputs.some((u) => !isMature(u))
        ? { maturesAt: Math.max(...manualInputs.map((u) => u.maturesAt ?? 0)) } : {}),
      recipient,
      amountAtomic: built.amountAtomic.toString(),
      feeAtomic: built.feeAtomic.toString(),
      changeAtomic: built.changeAtomic.toString(),
      totalAtomic: built.totalAtomic.toString(),
      signature,
    }
  }

  // Resolve the spend pool: a manual set (validated, frozen rejected) when
  // `outpoints` is given, otherwise every unfrozen coin. Shared by buildSend and
  // maxSendable so both honour the same freeze rules and availability checks.
  private async resolveInputs(outpoints?: readonly string[]): Promise<{ utxos: readonly GatheredUtxo[]; manualInputs?: readonly GatheredUtxo[] }> {
    // Native sends spend native UTXOs only — token UTXOs (value 0) are filtered out;
    // the token-send path selects those by token id instead.
    const gathered = await this.deps.gather()
    if (outpoints?.some((o) => gathered.some((u) => outpointOf(u) === o && u.keyScript === 'delegated'))) {
      throw new Error('Send uses ordinary coins only. Unstake these coins in Staking first.')
    }
    const all = gathered.filter((u) => u.tokenId === undefined && u.keyScript !== 'delegated')
    const frozen = await this.deps.frozen()
    const reserved = await this.deps.reserved?.() ?? new Set<string>()
    if (outpoints !== undefined && outpoints.length > 0) {
      const wanted = new Set(outpoints)
      if ([...wanted].some((o) => reserved.has(o))) throw new Error('These coins are reserved by an unfinished transaction. Resolve it in Staking before spending them.')
      if ([...wanted].some((o) => frozen.has(o))) {
        throw new Error('Frozen coins can’t be spent. Unfreeze them first.')
      }
      const manual = all.filter((u) => wanted.has(outpointOf(u)))
      if (manual.length !== wanted.size) {
        throw new Error('Some selected coins are no longer available.')
      }
      if (manual.some((u) => u.maturityUnknown === true)) throw new Error('Could not verify when some selected coins become spendable. Refresh and try again.')
      return { utxos: [], manualInputs: manual }
    }
    return { utxos: all.filter((u) => !frozen.has(outpointOf(u)) && !reserved.has(outpointOf(u)) && isMature(u)) }
  }

  // The largest amount sendable in one transaction: the whole spendable pool (or
  // the manually chosen coins) minus the fee for spending all of them, with no
  // change. Recipient-free and holds no draft — it just sizes the Max button.
  async maxSendable(outpoints?: readonly string[]): Promise<MaxSendable> {
    const { utxos, manualInputs } = await this.resolveInputs(outpoints)
    const inputs = manualInputs ?? utxos
    const rate = await this.deps.feeRate()
    // Send-max produces a single output (no change), so price it that way — the
    // same shape confirmSend will build.
    const feeAtomic = estimateSendFee({ utxos, manualInputs, amountAtomic: 0n, feeRatePerVByte: rate, sendMax: true })
    const sum = inputs.reduce((total, u) => total + u.value, 0n)
    const amountAtomic = sum - feeAtomic
    if (amountAtomic <= 0n) {
      throw new InsufficientFundsError(feeAtomic, sum)
    }
    return { amountAtomic: amountAtomic.toString(), feeAtomic: feeAtomic.toString() }
  }

  // Build and hold a token transfer. Token UTXOs of the chosen token cover the
  // amount (with token change to self); unfrozen native coin pays the fee (token
  // UTXOs are value 0). Price each complete draft until its native inputs pay for
  // the final transaction. Holds it for confirmSend; advances both change branches.
  async buildTokenSend(tokenId: string, recipient: string, tokenAmount: bigint): Promise<TokenSendPreview> {
    this.startBuild()
    const generation = this.generation
    const all = (await this.deps.gather()).filter((u) => u.keyScript !== 'delegated')
    const frozen = new Set([...await this.deps.frozen(), ...await this.deps.reserved?.() ?? []])
    const tokenUtxos: SpendableTokenUtxo[] = all
      .filter((u) => u.tokenId === tokenId && u.tokenAmount !== undefined && !frozen.has(outpointOf(u)) && isMature(u))
      .map((u) => ({ ...u, tokenAmount: u.tokenAmount as bigint }))
    const nativeUtxos = all.filter((u) => u.tokenId === undefined && !frozen.has(outpointOf(u)) && isMature(u))

    const rate = await this.deps.feeRate()

    const { built } = await buildWithChange(recipient, (changeFor) => buildTokenSendWithFee({
      tokenHash: tokenId,
      tokenUtxos,
      nativeUtxos,
      recipient,
      tokenAmount,
      tokenChangeAddressFor: changeFor,
      nativeChangeAddressFor: changeFor,
    }, rate), (algo) => algo === 'falcon512' ? this.deps.getPqChangeAddress() : this.deps.getChangeAddress())
    this.checkBuild(generation)
    assertBroadcastSize(draftSizeUpperBound([...tokenUtxos, ...nativeUtxos], built.unsigned))
    this.pending = {
      unsigned: built.unsigned,
      advance: [...new Set([built.tokenChangeAlgo, built.nativeChangeAlgo].filter((a): a is ChangeBranch => a !== undefined))],
      recipient,
    }
    const algos = new Set(built.unsigned.inputs.map((i) => i.algo))
    const signature = [...algos].map((a) => (a === 'falcon512' ? 'Falcon-512' : a === 'schnorr' ? 'Schnorr' : 'ECDSA')).join(' + ')
    return {
      recipient,
      tokenId,
      tokenAmountAtomic: built.tokenAmountAtomic.toString(),
      feeAtomic: built.feeAtomic.toString(),
      signature,
    }
  }

  confirmSend(): Promise<SendResult> {
    if (this.confirming !== null) return this.confirming
    const running = this.confirm()
    this.confirming = running
    void running.then(() => { if (this.confirming === running) this.confirming = null }, () => { if (this.confirming === running) this.confirming = null })
    return running
  }

  private async confirm(): Promise<SendResult> {
    const pending = this.pending
    if (pending === null) {
      throw new Error('No transaction to confirm. Build a send first.')
    }
    const generation = this.generation
    const check = (): void => {
      if (generation !== this.generation || this.pending !== pending) throw new Error('The send session has ended. Review the transaction again.')
    }
    // A retry must retain the exact wire bytes: Falcon signatures are randomized,
    // so signing the same draft again can produce a different transaction id.
    if (pending.signed === undefined) {
      await this.deps.assertInputs?.(pending.unsigned)
      check()
      pending.signed = await this.deps.sign(pending.unsigned)
    }
    check()
    const signed = pending.signed
    try { assertBroadcastSize(signed.rawHex.length / 2) }
    catch (error) { this.pending = null; throw new SendNeedsReviewError(error instanceof Error ? error.message : 'Transaction too large.') }
    const known = async (): Promise<boolean> => {
      try { return await this.deps.isKnownTransaction?.(signed.txid) === true } catch { return false }
    }
    if (!pending.accepted) {
      const wasUncertain = pending.uncertain === true
      if (wasUncertain && await known()) pending.accepted = true
      check()
      if (!pending.accepted) {
        try {
          await this.deps.broadcast(signed.rawHex)
          pending.accepted = true
        } catch (error) {
          this.deps.onBroadcastFailure?.()
          if (await known()) pending.accepted = true
          check()
          if (!pending.accepted) {
            const rejected = error instanceof ChainError &&
              (error.code === 'invalid_argument' || (error.code === 'broadcast_rejected' && (error.status === 400 || error.status === 422)))
            if (rejected && !wasUncertain) {
              this.pending = null
              throw new SendNeedsReviewError('The node rejected this transaction. Refresh the available coins and review a new transaction before sending.')
            }
            pending.uncertain = true
            throw new SendUncertainError(`The submission status is unknown. Check again to look up or resend the same transaction (${signed.txid}).`)
          }
        }
      }
      check()
      this.deps.onSpent?.()
    }
    // Accepted transactions are never broadcast again if updating local change
    // metadata fails; a retry only finishes that bookkeeping.
    while ((pending.advanced ?? 0) < pending.advance.length) {
      await this.deps.advanceChange(pending.advance[pending.advanced ?? 0]!)
      check()
      pending.advanced = (pending.advanced ?? 0) + 1
    }
    this.pending = null
    return { txid: signed.txid }
  }

  /** Drop any held draft (e.g. on lock/destroy). */
  reset(): void {
    this.generation++
    this.pending = null
    this.confirming = null
  }

  reservedOutpoints(): ReadonlySet<string> {
    return new Set(this.pending?.signed === undefined && this.confirming === null ? []
      : this.pending?.unsigned.inputs.map((i) => `${i.prevTxid}:${i.vout}`) ?? [])
  }

  reservedOutputHashes(): readonly string[] {
    return this.pending?.signed === undefined ? [] : this.pending.unsigned.outputs.map((o) => o.scripthash)
  }

  private startBuild(): void {
    if (this.pending?.uncertain || this.pending?.accepted) throw new SendUncertainError(`Resolve the previous submission before building another transaction (${this.pending.signed!.txid}).`)
    if (this.confirming !== null) throw new Error('A transaction is already being sent.')
    this.generation++
    this.pending = null
  }

  private checkBuild(generation: number): void {
    if (generation !== this.generation) throw new Error('This transaction preview is no longer current. Review it again.')
  }
}
