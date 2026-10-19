import { randomUUID } from 'node:crypto'
import { balanceOf, type AddressInfo, type ChainTx, type Utxo } from '@qbtc/chain'
import { deserialize, fromHex, serializeForSighash, toHex, txid as computeTxid, TX_TYPE_STANDARD, TX_TYPE_TOKENS, type Network, type Transaction } from '@qbtc/crypto'
import type { StakingAddressView, StakingAlgo, StakingOwnerAlgo, StakingFundingRequest, StakingInfo, StakingOperationView, StakingPreview, StakingResult, StakingSnapshot, StakingWithdrawalRequest, StakingChainActivity } from '../../shared/staking'
import type { DelegateProfile } from '../brand/delegation'
import { decodeAddress } from '../brand/crypto'
import { isMature } from '../../shared/maturity'
import { buildTokenSendWithFee, feeForInputs, type ChangeBranch, type SpendableUtxo, type UnsignedInput, type UnsignedTx } from './buildTx'
import { decodeDelegatePubkeyhash, delegationAddress, delegationMark, delegationScripthash, encodeDelegatePubkeyhash, ownerPubkeyhash } from './delegation'
import { DelegationOperationManager, reservesStakingInputs, type DelegationOperationReader } from './DelegationOperationManager'
import type { DelegationJournal, DelegationOperation, DelegationRecord, DelegationStore } from './delegationStore'
import { withMaturity } from './maturity'
import type { GatheredUtxo } from './spendable'
import { toCryptoTransaction, type SignedTx } from './signTx'
import { SpendCoordinator } from './SpendCoordinator'
import { stakingDerivation, type StakingOwner } from './stakingKeys'
import { buildStakingFunding, buildStakingWithdrawal, delegatedInputBytes, signStakingWithdrawal, stakingDraftBytes, STAKING_MAX_TX_BYTES, withdrawalParts } from './stakingTransactions'
import { buildWithChange } from './buildWithChange'
import { feeForBytes } from './txSize'
import { StakingHistory } from './StakingHistory'
import { STAKE_MATURITY } from '../brand/staking'
import { isRecoveryOf, recoveryInputs } from './stakingRecovery'

export interface StakingReader extends DelegationOperationReader {
  getAddressInfo(address: string): Promise<AddressInfo>
  listUnspent(address: string): Promise<Utxo[]>
  getAddressTransactions(address: string, afterTxid?: string): Promise<ChainTx[]>
}
export interface StakingWallet {
  owners(): Promise<readonly StakingOwner[]>
  publicKey(owner: StakingOwner): Promise<Uint8Array>
  keypair(owner: StakingOwner): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }>
  importedDelegate?(): Promise<Uint8Array | undefined>
  fundingPool(): Promise<readonly GatheredUtxo[]>
  ordinaryInputAddress(input: UnsignedInput): Promise<string>
  /** Freezes and reservations outside staking; the recovery pair is handled here. */
  recoveryExcludedOutpoints?(): Promise<ReadonlySet<string>>
  changeAddress(algo: ChangeBranch): Promise<string>
  consumeChange(algo: ChangeBranch, address: string): Promise<void>
  feeRate(): Promise<number>
  signFunding(unsigned: UnsignedTx): Promise<SignedTx>
  signOrdinary?(unsigned: UnsignedTx): Promise<Transaction>
  excludedOutpoints?(): Promise<ReadonlySet<string>>
  changed(): void
}
interface HeldDraft { readonly record: DelegationRecord; readonly operation: DelegationOperation; readonly pool: readonly SpendableUtxo[] }

const sameOwner = (a: StakingOwner, b: StakingOwner): boolean => a.kind === b.kind && a.algo === b.algo &&
  (a.kind !== 'hd' || (b.kind === 'hd' && a.derivationId === b.derivationId && a.account === b.account))
const outpoint = (i: { txid: string; vout: number }): string => `${i.txid}:${i.vout}`
const messageOf = (error: unknown): string => error instanceof Error ? error.message : 'Staking data is unavailable.'
const publicOperation = (op: DelegationOperation): StakingOperationView => ({
  id: op.id, address: op.address, kind: op.kind, state: op.state, amountAtomic: op.amountAtomic,
  feeAtomic: op.feeAtomic, destination: op.destination, createdAt: op.createdAt,
  txid: op.txid, eligibleAt: op.eligibleAt, message: op.message,
  autoRetry: op.autoRetry, settled: op.settled,
  tokenId: op.tokenId, tokenAmountAtomic: op.tokenAmountAtomic, recoveryOf: op.recoveryOf,
})

export class DelegationService {
  private journal: DelegationJournal | null = null
  private initializing: Promise<void> | null = null
  private draft: HeldDraft | null = null
  private views: StakingAddressView[] = []
  private readonly chainActivity = new Map<string, readonly StakingChainActivity[]>()
  private refreshedAt: number | undefined
  private refreshError: string | undefined
  private refreshFlight: Promise<StakingSnapshot> | null = null
  private readonly publicKeys = new Map<string, Promise<Uint8Array>>()
  private readonly manager: DelegationOperationManager
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly history: StakingHistory

  constructor(private readonly deps: {
    network: Network; profiles: readonly DelegateProfile[]; reader: StakingReader;
    store: DelegationStore; wallet: StakingWallet; coordinator: SpendCoordinator
    maxTxBytes?: number
  }) {
    this.history = new StakingHistory(deps.reader, () => this.check())
    this.manager = new DelegationOperationManager({
      reader: deps.reader, check: () => this.check(), changed: () => deps.wallet.changed(),
      current: (id) => this.data().operations.find((op) => op.id === id),
      validateRecovery: async (op) => {
        const parent = this.data().operations.find((item) => item.id === op.recoveryOf)
        if (!isRecoveryOf(op, parent)) throw new Error('The recovery does not match its original operation.')
        const record = this.data().records.find((item) => item.address === parent.address)!
        await this.recoveryCoins(parent, record)
        const excluded = new Set([...this.data().operations.filter((item) => item.id !== parent.id && item.id !== op.id && reservesStakingInputs(item))
          .flatMap((item) => item.unsigned.inputs.map((input) => `${input.prevTxid}:${input.vout}`)), ...await deps.wallet.recoveryExcludedOutpoints?.() ?? []])
        this.check()
        if (op.unsigned.inputs.some((input) => excluded.has(`${input.prevTxid}:${input.vout}`))) throw new Error('The recovery coins are frozen or reserved by another operation.')
      },
      mutate: (work) => deps.coordinator.run(work),
      save: async (op) => this.save({ ...this.data(), operations: this.data().operations.map((o) => o.id === op.id ? op : o) }),
      consumeChange: async (op) => {
        if (op.changeAlgo !== undefined && op.changeAddress !== undefined) await deps.wallet.consumeChange(op.changeAlgo, op.changeAddress)
      },
    })
  }

  private check(): void { this.deps.coordinator.check() }
  private data(): DelegationJournal {
    if (this.journal === null) throw new Error('Staking has not been restored yet.')
    return this.journal
  }
  private async save(next: DelegationJournal): Promise<void> {
    this.check()
    await this.deps.store.save(next)
    this.check()
    this.journal = next
  }
  private pubkey(owner: StakingOwner): Promise<Uint8Array> {
    this.check()
    const id = JSON.stringify(owner)
    let pending = this.publicKeys.get(id)
    if (pending === undefined) {
      pending = this.deps.wallet.publicKey(owner).then((key) => { this.check(); return key })
      this.publicKeys.set(id, pending)
      void pending.catch(() => this.publicKeys.delete(id))
    }
    return pending
  }
  private profiles(): readonly DelegateProfile[] { return this.deps.profiles.filter((p) => p.network === this.deps.network) }
  private profile(record: DelegationRecord): DelegateProfile | undefined {
    const algo = record.owner.algo
    return algo === 'schnorr' ? undefined : this.profiles().find((p) => p.id === record.profileId && toHex(decodeDelegatePubkeyhash(p.hashes[algo], this.deps.network)) === record.delegateHashHex)
  }
  private async makeRecord(owner: StakingOwner, hash: Uint8Array, profileId?: string): Promise<DelegationRecord> {
    const ownerHash = ownerPubkeyhash(await this.pubkey(owner), owner.algo)
    this.check()
    return { address: delegationAddress(ownerHash, hash, this.deps.network), owner,
      ownerHashHex: toHex(ownerHash), delegateHashHex: toHex(hash), ...(profileId !== undefined ? { profileId } : {}) }
  }

  private ensure(): Promise<void> {
    this.check()
    if (this.journal !== null) return Promise.resolve()
    if (this.initializing !== null) return this.initializing
    const run = this.restore()
    this.initializing = run
    void run.then(() => { this.initializing = null }, () => { this.initializing = null })
    return run
  }
  private async restore(): Promise<void> {
    const [stored, owners, exactDelegate] = await Promise.all([
      this.deps.store.load(), this.deps.wallet.owners(), this.deps.wallet.importedDelegate?.(),
    ])
    this.check()
    const records = new Map<string, DelegationRecord>()
    for (const record of stored.records) {
      if (!owners.some((owner) => sameOwner(owner, record.owner))) throw new Error('A saved staking owner does not belong to this wallet.')
      const expected = await this.makeRecord(record.owner, fromHex(record.delegateHashHex), record.profileId)
      if (expected.address !== record.address || expected.ownerHashHex !== record.ownerHashHex) throw new Error('Staking recovery data does not match this wallet.')
      records.set(record.address, record)
    }
    for (const owner of owners) {
      for (const profile of owner.algo === 'schnorr' ? [] : this.profiles()) {
        const record = await this.makeRecord(owner, decodeDelegatePubkeyhash(profile.hashes[owner.algo as StakingAlgo], this.deps.network), profile.id)
        records.set(record.address, record)
      }
      if (exactDelegate !== undefined && owner.kind === 'key') {
        const record = await this.makeRecord(owner, exactDelegate)
        if (!records.has(record.address)) records.set(record.address, record)
      }
    }
    // Authenticate stored signed bytes against the reviewed transaction.
    for (const op of stored.operations) {
      if (op.rawHex === undefined) continue
      const signed = deserialize(fromHex(op.rawHex))
      if (toHex(computeTxid(signed)) !== op.txid || signed.txType !== (op.tokenId === undefined ? TX_TYPE_STANDARD : TX_TYPE_TOKENS) ||
        toHex(serializeForSighash(signed)) !== toHex(serializeForSighash(toCryptoTransaction(op.unsigned)))) {
        throw new Error('The saved staking transaction is inconsistent. Restore the wallet data before retrying.')
      }
    }
    this.check()
    this.journal = { ...stored, records: [...records.values()] }
  }

  async info(): Promise<StakingInfo> {
    this.check()
    const owners = await this.deps.wallet.owners()
    const exact = await this.deps.wallet.importedDelegate?.()
    this.check()
    const profiles = this.profiles()
    const profile = profiles.find((p) => p.status === 'active')
    // Without a service on this network only an imported delegated key has
    // staking coins to observe and withdraw; an ordinary key has nothing here.
    const enabled = owners.length > 0 && (exact !== undefined || profiles.length > 0)
    return { enabled, network: this.deps.network, algorithms: [...new Set(owners.map((o) => o.algo).filter((a): a is StakingAlgo => a !== 'schnorr'))],
      fundingEnabled: enabled && exact === undefined && profile?.fundingEnabled === true,
      minimumVerified: profile?.minimumVerified ?? false, minimumAtomic: profile?.minimumAtomic,
      serviceLabel: profile?.label, commission: profile?.commission, maturitySeconds: STAKE_MATURITY[this.deps.network],
      notice: exact !== undefined ? 'This imported delegated key can observe and withdraw its coins.' : profile?.fundingEnabled === false
        ? 'Funding is disabled until the service settings and withdrawal flow have been verified for this network.'
        : undefined,
    }
  }

  /** Public ownership, independent of normal receive/change discovery. */
  async addresses(): Promise<readonly { address: string; algo: StakingOwnerAlgo }[]> {
    await this.ensure()
    return this.data().records.map((r) => ({ address: r.address, algo: r.owner.algo }))
  }
  async reservedOutpoints(): Promise<ReadonlySet<string>> {
    await this.ensure()
    return new Set(this.data().operations.filter(reservesStakingInputs).flatMap((o) => o.unsigned.inputs.map((i) => `${i.prevTxid}:${i.vout}`)))
  }
  async reservations(): Promise<ReadonlyMap<string, string>> {
    await this.ensure()
    return new Map(this.data().operations.filter(reservesStakingInputs).flatMap((op) =>
      op.unsigned.inputs.map((input) => [`${input.prevTxid}:${input.vout}`, op.id] as const)))
  }
  async reservedChangeAddresses(): Promise<ReadonlySet<string>> {
    await this.ensure()
    return new Set(this.data().operations.filter(reservesStakingInputs).flatMap((op) => op.changeAddress === undefined ? [] : [op.changeAddress]))
  }
  async assertOrdinaryInputs(unsigned: UnsignedTx): Promise<void> {
    if (unsigned.inputs.some((i) => i.keyScript === 'delegated')) throw new Error('Send uses ordinary coins only. Unstake these coins in Staking first.')
    const reserved = await this.reservedOutpoints()
    if (unsigned.inputs.some((i) => reserved.has(`${i.prevTxid}:${i.vout}`))) throw new Error('Some inputs belong to a pending staking operation. Refresh and review the send again.')
  }

  /** Reading the view never signs or broadcasts. Refresh is a distinct action. */
  async list(): Promise<StakingSnapshot> {
    await this.ensure()
    return this.snapshot()
  }
  private snapshot(): StakingSnapshot {
    return { addresses: this.views, operations: this.data().operations.map(publicOperation), chainActivity: [...this.chainActivity.values()].flat(), refreshedAt: this.refreshedAt, error: this.refreshError }
  }
  refresh(): Promise<StakingSnapshot> {
    if (this.refreshFlight !== null) return this.refreshFlight
    const running = (async () => {
      await this.ensure()
      for (const op of [...this.data().operations]) await this.manager.reconcile(op)
      // Balance/history reads do not hold the spending gate or write the journal.
      // A user may compose a transaction while the node returns these views.
      const previous = new Map(this.views.map((v) => [v.address, v]))
      const views: StakingAddressView[] = []
      const observed = new Map<string, readonly StakingChainActivity[]>()
      for (const record of this.data().records) {
        const profile = this.profile(record)
        const base: StakingAddressView = { address: record.address, algo: record.owner.algo,
          serviceLabel: profile?.label ?? 'Imported service', delegatePubkeyhash: encodeDelegatePubkeyhash(fromHex(record.delegateHashHex), this.deps.network),
          ownerPubkeyhash: encodeDelegatePubkeyhash(fromHex(record.ownerHashHex), this.deps.network),
          legacy: profile?.status !== 'active' || (record.owner.kind === 'hd' && !stakingDerivation(record.owner.derivationId).active),
          canFund: (await this.info()).fundingEnabled && profile?.status === 'active' && (record.owner.kind !== 'hd' || stakingDerivation(record.owner.derivationId).active),
          balanceAtomic: '0', confirmedAtomic: '0', pendingAtomic: '0', matureAtomic: '0', maturingAtomic: '0', unknownAtomic: '0', slashed: false, stale: true }
        try {
          const result = await this.readView(record, base)
          views.push(result.view)
          observed.set(record.address, result.activity)
        }
        catch (error) {
          this.check()
          // Do not present cached observations as freshly confirmed after an
          // unsuccessful refresh. The journal and its reservations are separate.
          views.push({ ...(previous.get(record.address) ?? base), stale: true, error: messageOf(error) })
        }
      }
      this.check()
      this.views = views
      this.chainActivity.clear()
      for (const [address, activity] of observed) this.chainActivity.set(address, activity)
      this.refreshedAt = Date.now()
      this.refreshError = views.some((v) => v.stale) ? 'Some staking data could not be refreshed.' : undefined
      return this.snapshot()
    })()
    this.refreshFlight = running
    void running.then(() => { this.refreshFlight = null }, (error) => { this.refreshFlight = null; this.refreshError = messageOf(error) })
    return running
  }

  start(): void {
    this.check()
    if (this.timer !== undefined) return
    void this.refresh().catch(() => {})
    this.timer = setInterval(() => { void this.refresh().catch(() => {}) }, 30_000)
    this.timer.unref?.()
  }
  dispose(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    this.draft = null
    this.publicKeys.clear()
    this.chainActivity.clear()
  }

  private async coins(record: DelegationRecord, includeTokens = false): Promise<GatheredUtxo[]> {
    const utxos = await this.deps.reader.listUnspent(record.address)
    this.check()
    const inputBytes = delegatedInputBytes(await this.pubkey(record.owner), record.owner.algo, fromHex(record.ownerHashHex), fromHex(record.delegateHashHex))
    const coins = await withMaturity(utxos.filter((u) => includeTokens || u.tokenId === undefined).map((u) => ({
      txid: u.txid, vout: u.vout, value: u.value, confirmed: u.status.confirmed,
      blockHeight: u.status.blockHeight, address: record.address, chain: 0 as const, index: 0, algo: record.owner.algo, inputBytes, keyScript: 'delegated' as const,
      tokenId: u.tokenId, tokenAmount: u.tokenAmount,
    })), this.deps.reader, this.deps.network)
    this.check()
    return coins
  }
  private async readView(record: DelegationRecord, base: StakingAddressView): Promise<{ view: StakingAddressView; activity: readonly StakingChainActivity[] }> {
    const [allCoins, info] = await Promise.all([this.coins(record, true), this.deps.reader.getAddressInfo(record.address)])
    const coins = allCoins.filter((coin) => coin.tokenId === undefined)
    const excluded = new Set([...await this.reservedOutpoints(), ...await this.deps.wallet.excludedOutpoints?.() ?? []])
    const available = coins.filter((u) => u.confirmed && isMature(u) && !excluded.has(outpoint(u))).reduce((sum, u) => sum + u.value, 0n)
    const tokenBalances = new Map<string, bigint>()
    for (const coin of allCoins) if (coin.tokenId !== undefined) tokenBalances.set(coin.tokenId, (tokenBalances.get(coin.tokenId) ?? 0n) + (coin.tokenAmount ?? 0n))
    let confirmed = 0n, pending = 0n, mature = 0n, maturing = 0n, unknown = 0n
    let eligibleAt: number | undefined
    for (const coin of coins) {
      if (coin.confirmed) confirmed += coin.value
      else pending += coin.value
      if (coin.maturityUnknown) unknown += coin.value
      else if (coin.confirmed && isMature(coin)) mature += coin.value
      else if (coin.maturesAt !== undefined) { maturing += coin.value; eligibleAt = Math.max(eligibleAt ?? 0, coin.maturesAt) }
    }
    const { lastStake, slashed, complete: exhausted, activity } = await this.history.read(record.address,
      toHex(delegationScripthash(fromHex(record.ownerHashHex), fromHex(record.delegateHashHex))))
    let reward: string | undefined
    if (lastStake !== undefined) {
      try { reward = (await this.reward(record, lastStake)).toString() } catch { /* Do not invent an amount from incomplete prevouts. */ }
    }
    this.check()
    return { activity, view: { ...base, tokens: [...tokenBalances].map(([id, amount]) => ({ id, amountAtomic: amount.toString() })), stale: false, balanceAtomic: balanceOf(info).toString(), confirmedAtomic: confirmed.toString(),
      pendingAtomic: pending.toString(), matureAtomic: mature.toString(), availableAtomic: available.toString(), maturingAtomic: maturing.toString(), unknownAtomic: unknown.toString(),
      eligibleAt, slashed, lastStakeAt: lastStake?.status.blockTime, lastRewardAtomic: reward,
      historyIncomplete: !exhausted,
      rewardUnknown: (lastStake !== undefined && reward === undefined) || (lastStake === undefined && !exhausted) } }
  }
  private async reward(record: DelegationRecord, tx: ChainTx): Promise<bigint> {
    const hash = toHex(delegationScripthash(fromHex(record.ownerHashHex), fromHex(record.delegateHashHex)))
    const output = tx.vout.filter((o) => o.scripthash === hash || o.address === record.address).reduce((s, o) => s + o.value, 0n)
    let input = 0n
    // At most eight source requests at a time, with no mutable confirmation cache.
    let next = 0
    await Promise.all(Array.from({ length: Math.min(8, tx.vin.length) }, async () => {
      while (next < tx.vin.length) {
        const i = tx.vin[next++]!
        let value = i.prevoutValue, address = i.prevoutAddress, sh = i.prevoutScripthash
        if (value === undefined || (address === undefined && sh === undefined)) {
          const source = await this.deps.reader.getTransaction(i.txid)
          this.check()
          const out = source.txid === i.txid ? source.vout[i.vout] : undefined
          if (out === undefined) throw new Error('Missing reward input.')
          value = out.value; address = out.address; sh = out.scripthash
        }
        if (sh === hash || address === record.address) input += value
      }
    }))
    if (output < input) throw new Error('Invalid stake reward.')
    return output - input
  }

  async buildFunding(request: StakingFundingRequest): Promise<StakingPreview> {
    return this.deps.coordinator.run(async () => {
      this.draft = null
      await this.ensure()
      if (!['ecdsa', 'falcon512'].includes(request.algo) || !/^\d+$/.test(request.amountAtomic) || request.amountAtomic.length > 24) throw new Error('Enter a valid staking amount and algorithm.')
      const info = await this.info()
      if (!info.fundingEnabled) throw new Error(info.notice ?? 'Staking funding is not available.')
      const record = this.data().records.find((r) => r.owner.algo === request.algo && this.profile(r)?.status === 'active' &&
        (r.owner.kind !== 'hd' || stakingDerivation(r.owner.derivationId).active))
      if (record === undefined) throw new Error('No active staking owner is available.')
      const all = await this.fundingPool(request.sourceAddress)
      const parts = request.max === true ? withdrawalParts(all, record.address, this.deps.maxTxBytes, delegationMark(fromHex(record.ownerHashHex))) : [all]
      const pool = parts[0] ?? []
      const feeRate = await this.deps.wallet.feeRate()
      const { built, addresses } = await buildWithChange(record.address, (changeFor) => buildStakingFunding({
        pool, address: record.address, ownerHash: fromHex(record.ownerHashHex), amount: BigInt(request.amountAtomic),
        max: request.max === true, feeRate, changeAddresses: { ecdsa: changeFor('ecdsa'), falcon512: changeFor('falcon512') }, maxBytes: this.deps.maxTxBytes,
      }), (algo) => this.deps.wallet.changeAddress(algo))
      this.check()
      if (built.amountAtomic < BigInt(info.minimumAtomic ?? '0')) throw new Error(`The marked output must contain at least ${info.minimumAtomic} atomic units for this service profile.`)
      const preview: StakingPreview = { draftId: randomUUID(), kind: 'funding', address: record.address, algo: record.owner.algo,
        amountAtomic: built.amountAtomic.toString(), feeAtomic: built.feeAtomic.toString(), changeAtomic: built.changeAtomic.toString(), destination: record.address,
        sourceLabel: request.sourceAddress ?? 'Ordinary coins in this wallet', inputAlgorithms: [...new Set(built.unsigned.inputs.map((i) => i.algo))],
        inputCount: built.unsigned.inputs.length, sizeUpperBound: stakingDraftBytes(built.unsigned, pool), remainingParts: parts.length - 1,
        remainingAtomic: parts.slice(1).flat().reduce((sum, u) => sum + u.value, 0n).toString(),
        estimatedTotalFeeAtomic: parts.slice(1).reduce((sum, part) => sum + feeForInputs(part, feeRate, [{ value: 0n, scripthash: decodeAddress(record.address).scripthash, data: delegationMark(fromHex(record.ownerHashHex)) }]), built.feeAtomic).toString() }
      this.hold(record, built.unsigned, pool, feeRate, preview, built.changeAlgo,
        built.changeAlgo === undefined ? undefined : addresses[built.changeAlgo])
      return preview
    })
  }
  private async fundingPool(source?: string): Promise<readonly GatheredUtxo[]> {
    const reserved = await this.reservedOutpoints()
    const pool = (await this.deps.wallet.fundingPool()).filter((u) => u.tokenId === undefined && isMature(u) && u.confirmed && !reserved.has(outpoint(u)))
    this.check()
    return source === undefined ? pool : pool.filter((u) => u.address === source)
  }

  async buildWithdrawal(request: StakingWithdrawalRequest): Promise<StakingPreview> {
    return this.deps.coordinator.run(async () => {
      this.draft = null
      await this.ensure()
      if (!/^\d+$/.test(request.amountAtomic) || request.amountAtomic.length > 24 ||
        (request.max !== undefined && typeof request.max !== 'boolean')) throw new Error('Enter a valid unstake amount.')
      const address = request.address
      const record = this.data().records.find((r) => r.address === address)
      if (record === undefined) throw new Error('This delegation does not belong to this wallet.')
      if (request.tokenId !== undefined) return this.buildTokenWithdrawal(record, request.tokenId)
      const [all, reserved, excluded, destination, feeRate] = await Promise.all([
        this.coins(record), this.reservedOutpoints(), this.deps.wallet.excludedOutpoints?.() ?? new Set<string>(),
        this.deps.wallet.changeAddress(record.owner.algo === 'falcon512' ? 'falcon512' : 'ecdsa'), this.deps.wallet.feeRate(),
      ])
      this.check()
      const pool = all.filter((u) => u.confirmed && isMature(u) && !reserved.has(outpoint(u)) && !excluded.has(outpoint(u)))
      if (pool.length === 0) throw new Error('No staking coins are available to unstake now. Wait for confirmation or maturity, and check pending operations or frozen coins.')
      const parts = request.max === true ? withdrawalParts(pool, destination, this.deps.maxTxBytes) : [pool]
      const selected = parts[0]!
      const built = buildStakingWithdrawal({ pool: selected, address, destination, amount: BigInt(request.amountAtomic),
        max: request.max === true, feeRate, maxBytes: this.deps.maxTxBytes })
      const byId = new Map(pool.map((u) => [outpoint(u), u]))
      const earliest = Math.max(0, ...built.unsigned.inputs.map((i) => byId.get(`${i.prevTxid}:${i.vout}`)?.maturesAt ?? 0))
      const remaining = parts.slice(1).flat().reduce((s, u) => s + u.value, 0n)
      const shape = [{ value: 0n, scripthash: decodeAddress(destination).scripthash }]
      const remainingFees = parts.slice(1).map((part) => feeForInputs(part, feeRate, shape))
      const preview: StakingPreview = { draftId: randomUUID(), kind: 'withdrawal', address, algo: record.owner.algo,
        amountAtomic: built.amountAtomic.toString(), feeAtomic: built.feeAtomic.toString(), changeAtomic: built.changeAtomic.toString(), destination,
        sourceLabel: address, inputAlgorithms: [record.owner.algo], inputCount: built.unsigned.inputs.length, sizeUpperBound: stakingDraftBytes(built.unsigned, selected),
        eligibleAt: earliest > 0 ? earliest : undefined, remainingParts: parts.length - 1, remainingAtomic: remaining.toString(),
        stakingRemainingAtomic: (all.reduce((sum, u) => sum + u.value, 0n) - built.amountAtomic - built.feeAtomic).toString(),
        estimatedTotalFeeAtomic: remainingFees.reduce((a, b) => a + b, built.feeAtomic).toString() }
      this.hold(record, built.unsigned, selected, feeRate, preview, record.owner.algo === 'falcon512' ? 'falcon512' : 'ecdsa', destination)
      return preview
    })
  }
  private hold(record: DelegationRecord, unsigned: UnsignedTx, pool: readonly SpendableUtxo[], feeRate: number, preview: StakingPreview,
    changeAlgo?: ChangeBranch, changeAddress?: string): void {
    this.check()
    this.draft = { record, pool, operation: { ...preview, id: preview.draftId, state: 'prepared',
      createdAt: Date.now(), unsigned, feeRate, preview, changeAlgo, changeAddress } }
  }

  private async buildTokenWithdrawal(record: DelegationRecord, tokenId: string): Promise<StakingPreview> {
    if (!/^[0-9a-f]{64}$/.test(tokenId)) throw new Error('Invalid token identifier.')
    const [all, excluded, ordinary, destination, feeRate] = await Promise.all([
      this.coins(record, true), this.deps.wallet.excludedOutpoints?.() ?? new Set<string>(), this.fundingPool(),
      this.deps.wallet.changeAddress(record.owner.algo === 'falcon512' ? 'falcon512' : 'ecdsa'), this.deps.wallet.feeRate(),
    ])
    const reserved = await this.reservedOutpoints()
    this.check()
    const tokens = all.filter((u) => u.tokenId === tokenId && u.tokenAmount !== undefined && u.confirmed && isMature(u) && !excluded.has(outpoint(u)) && !reserved.has(outpoint(u)))
      .map((u) => ({ ...u, tokenAmount: u.tokenAmount! }))
    if (!tokens.length) throw new Error('No unfrozen, unreserved tokens are available to return.')
    if (!ordinary.length) throw new Error('Ordinary coins are needed for the network fee. Unstake some native coins first or receive coins at your ordinary address.')
    // Bound the token input part conservatively; the complete mixed draft is
    // checked again with its selected ordinary fee inputs below.
    const first = withdrawalParts(tokens, destination, Math.min(this.deps.maxTxBytes ?? STAKING_MAX_TX_BYTES, STAKING_MAX_TX_BYTES) - 4000)[0]! as typeof tokens
    let selected = first
    let built: ReturnType<typeof buildTokenSendWithFee>
    while (true) {
      const amount = selected.reduce((sum, u) => sum + (u.tokenAmount ?? 0n), 0n)
      built = buildTokenSendWithFee({ tokenHash: tokenId, tokenUtxos: selected.map((u) => ({ ...u, tokenAmount: (u as GatheredUtxo).tokenAmount! })),
        nativeUtxos: ordinary.map((u) => ({ ...u, keyScript: 'ordinary' as const })), recipient: destination, tokenAmount: amount,
        tokenChangeAddressFor: () => record.address, nativeChangeAddressFor: () => destination }, feeRate)
      if (stakingDraftBytes(built.unsigned, [...selected, ...ordinary]) <= Math.min(this.deps.maxTxBytes ?? STAKING_MAX_TX_BYTES, STAKING_MAX_TX_BYTES)) break
      if (selected.length === 1) throw new Error('The token return exceeds the sending limit. Consolidate ordinary fee coins first.')
      selected = selected.slice(0, -1)
    }
    const selectedIds = new Set(built.unsigned.inputs.map((input) => `${input.prevTxid}:${input.vout}`))
    const eligibleAt = Math.max(0, ...[...selected, ...ordinary].filter((u) => selectedIds.has(outpoint(u))).map((u) => u.maturesAt ?? 0))
    const preview: StakingPreview = { draftId: randomUUID(), kind: 'withdrawal', address: record.address, algo: record.owner.algo,
      tokenId, tokenAmountAtomic: built.tokenAmountAtomic.toString(), amountAtomic: '0', feeAtomic: built.feeAtomic.toString(),
      eligibleAt: eligibleAt || undefined, remainingTokenAmountAtomic: (all.filter((u) => u.tokenId === tokenId).reduce((sum, u) => sum + (u.tokenAmount ?? 0n), 0n) - built.tokenAmountAtomic).toString(),
      changeAtomic: built.nativeChangeAtomic.toString(), destination, sourceLabel: record.address,
      inputAlgorithms: [...new Set(built.unsigned.inputs.map((input) => input.algo))], inputCount: built.unsigned.inputs.length,
      sizeUpperBound: stakingDraftBytes(built.unsigned, [...selected, ...ordinary]), remainingParts: 0, remainingAtomic: '0', estimatedTotalFeeAtomic: built.feeAtomic.toString() }
    this.hold(record, built.unsigned, [...selected, ...ordinary], feeRate, preview, record.owner.algo === 'falcon512' ? 'falcon512' : 'ecdsa', destination)
    return preview
  }

  async confirm(draftId: string): Promise<StakingResult> {
    const ready = await this.deps.coordinator.run(async () => {
      await this.ensure()
      const existing = this.data().operations.find((o) => o.id === draftId)
      if (existing !== undefined) {
        return existing
      }
      const draft = this.draft
      if (draft === null || draft.operation.id !== draftId) throw new Error('This preview is no longer current. Review the transaction again.')
      const op = draft.operation
      const parent = op.recoveryOf === undefined ? undefined : this.data().operations.find((item) => item.id === op.recoveryOf)
      if (op.recoveryOf !== undefined && (parent === undefined || !['signed', 'pending'].includes(parent.state))) throw new Error('The original operation changed. Refresh and review its status again.')
      const available = parent !== undefined ? await this.recoveryCoins(parent, draft.record) : op.kind === 'funding' ? await this.fundingPool()
        : [...await this.coins(draft.record, op.tokenId !== undefined), ...(op.tokenId !== undefined ? await this.fundingPool() : [])].filter((u) => u.confirmed && isMature(u))
      const reserved = parent === undefined ? new Set([...await this.reservedOutpoints(), ...await this.deps.wallet.excludedOutpoints?.() ?? []])
        : new Set([...this.data().operations.filter((item) => item.id !== parent.id && reservesStakingInputs(item)).flatMap((item) => item.unsigned.inputs.map((input) => `${input.prevTxid}:${input.vout}`)), ...await this.deps.wallet.recoveryExcludedOutpoints?.() ?? []])
      const byId = new Map(available.map((u) => [outpoint(u), u]))
      for (const i of op.unsigned.inputs) {
        const current = byId.get(`${i.prevTxid}:${i.vout}`)
        const reviewed = draft.pool.find((u) => u.txid === i.prevTxid && u.vout === i.vout) as GatheredUtxo | undefined
        if (current === undefined || current.value.toString() !== i.valueAtomic || current.tokenId !== reviewed?.tokenId || current.tokenAmount !== reviewed?.tokenAmount || reserved.has(`${i.prevTxid}:${i.vout}`)) {
          this.draft = null
          throw new Error('The available coins changed. Review a new transaction.')
        }
      }
      if (op.kind === 'withdrawal') {
        const eligibleAt = Math.max(0, ...op.unsigned.inputs.map((i) => byId.get(`${i.prevTxid}:${i.vout}`)!.maturesAt ?? 0))
        if (eligibleAt !== (op.eligibleAt ?? 0)) {
          this.draft = null
          throw new Error('The maturity of these coins changed. Review a new return.')
        }
      }
      if (parent === undefined && op.changeAlgo !== undefined && await this.deps.wallet.changeAddress(op.changeAlgo) !== op.changeAddress) {
        this.draft = null
        throw new Error('The return or change address has advanced. Review a new transaction.')
      }
      this.check()
      await this.save({ ...this.data(), operations: [...this.data().operations.map((item) => item.id === parent?.id ? { ...item, autoRetry: false } : item), op] })
      this.draft = null
      let signed: SignedTx
      try {
        if (op.kind === 'funding' || parent?.kind === 'funding') signed = await this.deps.wallet.signFunding(op.unsigned)
        else {
          const key = await this.deps.wallet.keypair(draft.record.owner)
          try {
            this.check()
            if (toHex(ownerPubkeyhash(key.publicKey, draft.record.owner.algo)) !== draft.record.ownerHashHex) throw new Error('The staking owner key does not match the address.')
            const needsOrdinary = op.unsigned.inputs.some((input) => input.keyScript === 'ordinary')
            if (needsOrdinary && this.deps.wallet.signOrdinary === undefined) throw new Error('The ordinary fee signer is unavailable.')
            const ordinary = needsOrdinary ? await this.deps.wallet.signOrdinary!(op.unsigned) : undefined
            this.check()
            signed = await signStakingWithdrawal(op.unsigned, key, draft.record.owner.algo, fromHex(draft.record.ownerHashHex), fromHex(draft.record.delegateHashHex), this.deps.network, ordinary)
          } finally { key.privateKey.fill(0) }
        }
        this.check()
        const bytes = signed.rawHex.length / 2
        if (bytes > Math.min(this.deps.maxTxBytes ?? STAKING_MAX_TX_BYTES, STAKING_MAX_TX_BYTES) || BigInt(op.feeAtomic) < feeForBytes(bytes, op.feeRate)) throw new Error('The signed size or fee changed. Review a new transaction.')
      } catch (error) {
        this.check()
        await this.save({ ...this.data(), operations: this.data().operations.map((o) => o.id === op.id ? { ...o, state: 'abandoned', message: messageOf(error) } : o) })
        throw error
      }
      const ready: DelegationOperation = { ...op, ...signed, state: 'signed' }
      await this.save({ ...this.data(), operations: this.data().operations.map((o) => o.id === op.id ? ready : o) })
      return ready
    })
    const result = await this.manager.reconcile(ready, true)
    return { operationId: result.id, txid: result.txid, state: result.state }
  }

  async retry(operationId: string): Promise<StakingResult> { return this.confirm(operationId) }

  async setAutoRetry(id: string, enabled: boolean): Promise<void> {
    await this.deps.coordinator.run(async () => {
      await this.ensure()
      const op = this.data().operations.find((item) => item.id === id)
      if (op === undefined || !['signed', 'pending'].includes(op.state)) throw new Error('This operation is no longer awaiting submission.')
      await this.save({ ...this.data(), operations: this.data().operations.map((item) => item.id === id ? { ...item, autoRetry: enabled, autoAttemptBase: enabled ? item.attempts ?? 0 : item.autoAttemptBase } : item) })
    })
  }

  private async recoveryCoins(op: DelegationOperation, record: DelegationRecord): Promise<readonly GatheredUtxo[]> {
    const delegatedBytes = delegatedInputBytes(await this.pubkey(record.owner), record.owner.algo, fromHex(record.ownerHashHex), fromHex(record.delegateHashHex))
    return recoveryInputs({ original: op, record, reader: this.deps.reader, network: this.deps.network, delegatedBytes,
      ordinaryInputAddress: (input) => this.deps.wallet.ordinaryInputAddress(input), check: () => this.check() })
  }

  async buildRecovery(id: string): Promise<StakingPreview> {
    return this.deps.coordinator.run(async () => {
      this.draft = null
      await this.ensure()
      const op = this.data().operations.find((item) => item.id === id)
      if (op === undefined || !['signed', 'pending'].includes(op.state) || op.tokenId !== undefined || op.recoveryOf !== undefined) throw new Error('Only an unresolved native transfer can be recovered this way.')
      if (this.data().operations.some((item) => item.recoveryOf === id && reservesStakingInputs(item))) throw new Error('A recovery transaction already reserves these coins. Check its status.')
      const record = this.data().records.find((item) => item.address === op.address)!
      const pool = await this.recoveryCoins(op, record)
      // Reuse a known ordinary address so recovery remains possible when pending
      // operations already occupy the entire recoverable change-address gap.
      const destination = op.kind === 'funding' ? pool[0]!.address : op.destination
      const rate = await this.deps.wallet.feeRate()
      let feeRate = Math.max(rate, op.feeRate * 2)
      let built = buildStakingWithdrawal({ pool, address: record.address, destination, amount: 0n, max: true, feeRate, maxBytes: this.deps.maxTxBytes })
      // A previous dust remainder may have increased the absolute original fee.
      if (built.feeAtomic <= BigInt(op.feeAtomic)) {
        feeRate = Math.max(feeRate, Number(BigInt(op.feeAtomic) + 1n) / stakingDraftBytes(built.unsigned, pool))
        built = buildStakingWithdrawal({ pool, address: record.address, destination, amount: 0n, max: true, feeRate, maxBytes: this.deps.maxTxBytes })
      }
      const eligibleAt = Math.max(0, ...pool.map((u) => u.maturesAt ?? 0))
      const preview: StakingPreview = { draftId: randomUUID(), kind: 'withdrawal', recoveryOf: id, address: record.address, algo: record.owner.algo,
        amountAtomic: built.amountAtomic.toString(), feeAtomic: built.feeAtomic.toString(), changeAtomic: '0', destination,
        sourceLabel: op.preview.sourceLabel, inputAlgorithms: [...new Set(pool.map((u) => u.algo))], inputCount: pool.length,
        sizeUpperBound: stakingDraftBytes(built.unsigned, pool), eligibleAt: eligibleAt || undefined,
        remainingParts: 0, remainingAtomic: '0', estimatedTotalFeeAtomic: built.feeAtomic.toString() }
      this.hold(record, built.unsigned, pool, feeRate, preview,
        op.kind === 'funding' ? undefined : op.changeAlgo, op.kind === 'funding' ? undefined : destination)
      return preview
    })
  }
}
