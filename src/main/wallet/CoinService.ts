import type { UtxoView } from '../../shared/protocol'
import type { CoinMetaStore } from './coinMeta'
import type { GatheredUtxo } from './spendable'

export interface CoinDeps {
  gather(): Promise<GatheredUtxo[]>
  reservations?(): Promise<ReadonlyMap<string, string>>
  tipHeight(): Promise<number>
  meta: CoinMetaStore
}

// Coin-control inventory: lists the wallet's UTXOs with display fields and merged
// local metadata (label, frozen), and applies label/freeze changes. The view is
// what the renderer renders; amounts are strings, confirmations are derived from
// the chain tip.
export class CoinService {
  constructor(private readonly deps: CoinDeps) {}

  async list(): Promise<UtxoView[]> {
    const [utxos, tip, meta] = await Promise.all([this.deps.gather(), this.deps.tipHeight(), this.deps.meta.load()])
    let reservations: ReadonlyMap<string, string> = new Map()
    let unavailable = false
    try { reservations = await this.deps.reservations?.() ?? reservations } catch { unavailable = true }
    // Both native and token UTXOs are listed; a token UTXO has a zero native value
    // and carries its token id/amount (the renderer renders it as a token row and
    // keeps the native totals token-free). Coin-control selection stays native-only.
    return utxos.map((u) => {
      const outpoint = `${u.txid}:${String(u.vout)}`
      const entry = meta[outpoint] ?? {}
      const confirmations = u.confirmed && u.blockHeight !== undefined ? Math.max(0, tip - u.blockHeight + 1) : 0
      const view: UtxoView = {
        outpoint,
        address: u.address,
        valueAtomic: u.value.toString(),
        confirmations,
        algo: u.algo,
        label: entry.label,
        frozen: entry.frozen ?? false,
        ...(u.delegated ? { delegated: true } : {}),
        ...(reservations.has(outpoint) ? { reservedBy: reservations.get(outpoint)! } : {}),
        ...(unavailable || u.availabilityUnknown ? { availabilityUnknown: true } : {}),
        ...(u.maturesAt !== undefined ? { maturesAt: u.maturesAt } : {}),
        ...(u.maturityUnknown === true ? { maturityUnknown: true } : {}),
      }
      return u.tokenId !== undefined ? { ...view, tokenId: u.tokenId, tokenAmountAtomic: (u.tokenAmount ?? 0n).toString() } : view
    })
  }

  setLabel(outpoint: string, label: string): Promise<void> {
    return this.deps.meta.setLabel(outpoint, label)
  }

  setFrozen(outpoint: string, frozen: boolean): Promise<void> {
    return this.deps.meta.setFrozen(outpoint, frozen)
  }
}
