import { type HDKey, type Network } from '@qbtc/crypto'
import { activeScheme } from '../brand/crypto'
import type { AddressAlgo, ReceiveAddressEntry } from '../../shared/protocol'
import { deriveClassicalAddress, deriveFalconAddress } from './addresses'
import { indicesFor, withIndices, type SchemeIndices, type WalletMeta, type WalletMetaStore } from './meta'
import { GAP_LIMIT_CHANGE, isActive, type AddressLookup } from './discovery'

// What the service needs to derive: the master key (read inside main only) and a way
// to know when to drop cached metadata. `getMasterKey` is async so a non-primary seed
// wallet can lazily open its sealed seed; the primary wallet resolves it synchronously.
export interface WalletVault {
  getMasterKey(): Promise<HDKey>
  on(listener: (event: { readonly type: string }) => void): () => void
}

// Hands out receive addresses for the unlocked wallet — always on the ACTIVE
// derivation scheme (legacy schemes are scan-only: their funds stay visible and
// spendable, but no fresh addresses are issued there). The master key is read
// from the Vault inside main and used to derive; ONLY the address string ever
// leaves this service. HD indices are cached while unlocked and persisted via
// the (sealed) meta store; the cache is dropped whenever the vault locks, is
// created, or is destroyed, so a different seed never reuses stale indices.
export class AddressService {
  private meta: WalletMeta | null = null
  private readonly selectedChange = new Map<'ecdsa' | 'falcon512', number>()

  constructor(
    private readonly vault: WalletVault,
    private readonly metaStore: WalletMetaStore,
    private readonly network: Network,
    readonly account = 0,
    private readonly allocation?: { lookup: AddressLookup; reserved(): Promise<ReadonlySet<string>>; check(): void },
  ) {
    this.vault.on((event) => {
      if (event.type === 'locked' || event.type === 'destroyed' || event.type === 'created') {
        this.meta = null
      }
    })
  }

  /** Current receive address for `algo` (default classical). Requires unlocked. */
  async getReceiveAddress(algo: AddressAlgo = 'ecdsa'): Promise<string> {
    assertDerivable(algo)
    const cur = await this.activeIndices()
    return this.deriveReceiveAt(algo, algo === 'falcon512' ? cur.pqReceiveIndex : cur.receiveIndex)
  }

  /** Advance the receive index for `algo`, persist it, and return its address. */
  async getNewReceiveAddress(algo: AddressAlgo = 'ecdsa'): Promise<string> {
    assertDerivable(algo)
    const cur = await this.activeIndices()
    const next: SchemeIndices =
      algo === 'falcon512' ? { ...cur, pqReceiveIndex: cur.pqReceiveIndex + 1 } : { ...cur, receiveIndex: cur.receiveIndex + 1 }
    await this.saveActiveIndices(next)
    return this.deriveReceiveAt(algo, algo === 'falcon512' ? next.pqReceiveIndex : next.receiveIndex)
  }

  /** Every receive address surfaced so far for `algo` (indices 0..current), current last. */
  async listReceiveAddresses(algo: AddressAlgo = 'ecdsa'): Promise<readonly ReceiveAddressEntry[]> {
    assertDerivable(algo)
    const cur = await this.activeIndices()
    const current = algo === 'falcon512' ? cur.pqReceiveIndex : cur.receiveIndex
    const out: ReceiveAddressEntry[] = []
    for (let index = 0; index <= current; index += 1) {
      out.push({ address: await this.deriveReceiveAt(algo, index), index, current: index === current })
    }
    return out
  }

  /** Derive a receive-chain address at `index` for the chosen algorithm. */
  private async deriveReceiveAt(algo: AddressAlgo, index: number): Promise<string> {
    const master = await this.vault.getMasterKey()
    const opts = { account: this.account, chain: 0 as const, index, network: this.network }
    return algo === 'falcon512' ? deriveFalconAddress(master, opts) : deriveClassicalAddress(master, opts)
  }

  /** Current change address (change chain, at the stored change index). */
  async getChangeAddress(): Promise<string> {
    if (this.allocation !== undefined) return this.recoverableChange('ecdsa')
    const cur = await this.activeIndices()
    return this.deriveAt(1, cur.changeIndex)
  }

  /** Advance the change index after a send that produced change. Persists. */
  async advanceChange(): Promise<void> {
    const cur = await this.activeIndices()
    await this.saveActiveIndices({ ...cur, changeIndex: Math.max(cur.changeIndex, (this.selectedChange.get('ecdsa') ?? cur.changeIndex) + 1) })
  }

  /** Current PQ (Falcon) change address (change chain, at the PQ change index). */
  async getPqChangeAddress(): Promise<string> {
    if (this.allocation !== undefined) return this.recoverableChange('falcon512')
    const cur = await this.activeIndices()
    const master = await this.vault.getMasterKey()
    return deriveFalconAddress(master, { account: this.account, chain: 1, index: cur.pqChangeIndex, network: this.network })
  }

  /** Advance the PQ change index after a PQ send that produced change. Persists. */
  async advancePqChange(): Promise<void> {
    const cur = await this.activeIndices()
    await this.saveActiveIndices({ ...cur, pqChangeIndex: Math.max(cur.pqChangeIndex, (this.selectedChange.get('falcon512') ?? cur.pqChangeIndex) + 1) })
  }

  /** Fill unused holes before issuing beyond the seed scanner's gap. Pending
   * signatures reserve their addresses durably; a full gap must settle first. */
  private async recoverableChange(algo: 'ecdsa' | 'falcon512'): Promise<string> {
    const policy = this.allocation!
    const reserved = await policy.reserved()
    const master = await this.vault.getMasterKey()
    let inactive = 0
    for (let index = 0; index < 1000; index++) {
      policy.check()
      const opts = { account: this.account, chain: 1 as const, index, network: this.network }
      const address = await (algo === 'falcon512' ? deriveFalconAddress(master, opts) : deriveClassicalAddress(master, opts))
      const info = await policy.lookup.getAddressInfo(address)
      policy.check()
      // Mempool history can disappear without ever confirming. It reserves the
      // address, but cannot extend the gap that a fresh seed restore can bridge.
      if (info.chain.fundedTxCount > 0 || info.chain.spentTxCount > 0) { inactive = 0; continue }
      if (!isActive(info) && !reserved.has(address)) {
        this.selectedChange.set(algo, index)
        return address
      }
      if (++inactive >= GAP_LIMIT_CHANGE) break
    }
    throw new Error('Pending transactions occupy the recoverable change-address range. Resolve their status before creating another transaction.')
  }

  async recordChangeAddress(algo: 'ecdsa' | 'falcon512', expected: string): Promise<void> {
    const master = await this.vault.getMasterKey()
    for (let index = 0; index < 1000; index++) {
      this.allocation?.check()
      const opts = { account: this.account, chain: 1 as const, index, network: this.network }
      const address = await (algo === 'falcon512' ? deriveFalconAddress(master, opts) : deriveClassicalAddress(master, opts))
      if (address !== expected) continue
      const cur = await this.activeIndices()
      const field = algo === 'falcon512' ? 'pqChangeIndex' : 'changeIndex'
      if (cur[field] < index + 1) await this.saveActiveIndices({ ...cur, [field]: index + 1 })
      return
    }
    throw new Error('The saved change address is outside the supported recovery range.')
  }

  private async deriveAt(chain: 0 | 1, index: number): Promise<string> {
    const master = await this.vault.getMasterKey()
    return deriveClassicalAddress(master, {
      account: this.account,
      chain,
      index,
      network: this.network,
    })
  }

  /** The active scheme's issued-index floors, read-only — lets callers
   *  enumerate every cell the wallet has handed out (e.g. covenant rescans). */
  async issuedIndices(): Promise<SchemeIndices> {
    return this.activeIndices()
  }

  private async ensureMeta(): Promise<WalletMeta> {
    if (this.meta === null) this.meta = await this.metaStore.load()
    return this.meta
  }

  /** The active scheme's issued-index floors (fresh addresses live only there). */
  private async activeIndices(): Promise<SchemeIndices> {
    return indicesFor(await this.ensureMeta(), activeScheme().id)
  }

  private async saveActiveIndices(indices: SchemeIndices): Promise<void> {
    const next = withIndices(await this.ensureMeta(), activeScheme().id, indices)
    this.allocation?.check()
    await this.metaStore.save(next)
    this.allocation?.check()
    this.meta = next
  }
}

// An HD wallet derives exactly two branches — classical (ECDSA) and PQ
// (Falcon-512). There is no Schnorr derivation path: Schnorr exists only on
// imported single keys (key wallets), which never reach this service. Refuse
// loudly instead of silently handing out classical addresses.
function assertDerivable(algo: AddressAlgo): void {
  if (algo === 'schnorr') {
    throw new Error('HD wallets have no Schnorr branch — Schnorr keys exist only as imported key wallets.')
  }
}
