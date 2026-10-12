import type { ChainTx } from '@qbtc/chain'

export interface UpgradeCreditSource {
  readonly txid: string
  readonly lockVout: number
  readonly destScripthashHex: string | null
  readonly confirmed: boolean
}

export type UpgradeCredit =
  | { readonly state: 'pending' | 'unavailable' }
  | {
      readonly state: 'received'
      readonly txid: string
      readonly amountAtomic: bigint
      readonly address: string
      readonly blockHeight?: number
      readonly blockTime?: number
    }

interface CreditBackend {
  getAddressTransactions(address: string, afterTxid?: string): Promise<readonly ChainTx[]>
  getTransaction(txid: string): Promise<ChainTx>
}

export function upgradeOutpoint(source: UpgradeCreditSource): string {
  return `${source.txid.toLowerCase()}:${String(source.lockVout)}`
}

// Match native coinbases by their BTC outpoint provenance, never by amount or
// time. Read destination history (including spent credits and older pages), so
// restoring the wallet needs no local record and external destinations work too.
export class UpgradeCreditLookup {
  constructor(
    private readonly backend: CreditBackend,
    private readonly addressFor: (scripthashHex: string) => string,
  ) {}

  async find(sources: readonly UpgradeCreditSource[]): Promise<ReadonlyMap<string, UpgradeCredit>> {
    const results = new Map<string, UpgradeCredit>()
    const groups = new Map<string, UpgradeCreditSource[]>()
    for (const source of sources) {
      const key = upgradeOutpoint(source)
      if (!source.confirmed) {
        results.set(key, { state: 'pending' })
      } else if (source.destScripthashHex === null || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(source.destScripthashHex)) {
        // Without a usable destination, absence of a match cannot prove that
        // the protocol has not already credited a fallback address.
        results.set(key, { state: 'unavailable' })
      } else {
        const hash = source.destScripthashHex.toLowerCase()
        const group = groups.get(hash) ?? []
        group.push(source)
        groups.set(hash, group)
      }
    }

    // Some nodes omit provenance from address history but expose it on /tx.
    // Deduplicate those reads for this refresh only; the next refresh must see
    // reorgs and node changes instead of trusting a permanently cached credit.
    const details = new Map<string, Promise<ChainTx>>()
    await Promise.all([...groups].map(async ([hash, group]) => {
      const remaining = new Set(group.map(upgradeOutpoint))
      let complete = true
      try {
        const address = this.addressFor(hash)
        let afterTxid: string | undefined
        const cursors = new Set<string>()
        while (remaining.size > 0) {
          const batch = await this.backend.getAddressTransactions(address, afterTxid)
          for (const item of batch) {
            if (!item.status.confirmed || item.version !== 3) continue
            let tx = item
            if (tx.coinbaseInfo === undefined) {
              let detail = details.get(tx.txid)
              if (detail === undefined) {
                detail = this.backend.getTransaction(tx.txid)
                details.set(tx.txid, detail)
              }
              try { tx = await detail } catch { complete = false; continue }
            }
            const origin = tx.coinbaseInfo
            if (!tx.status.confirmed || tx.version !== 3 || origin === undefined) continue
            const key = `${origin.btcTxid.toLowerCase()}:${String(origin.btcOutNum)}`
            if (!remaining.has(key)) continue
            const amountAtomic = tx.vout
              .filter((output) => output.tokenId === undefined && output.scripthash.toLowerCase() === hash)
              .reduce((total, output) => total + output.value, 0n)
            if (amountAtomic <= 0n) continue
            results.set(key, {
              state: 'received', txid: tx.txid, amountAtomic, address,
              ...(tx.status.blockHeight !== undefined ? { blockHeight: tx.status.blockHeight } : {}),
              ...(tx.status.blockTime !== undefined ? { blockTime: tx.status.blockTime } : {}),
            })
            remaining.delete(key)
          }
          if (remaining.size === 0) break
          const confirmed = batch.filter((tx) => tx.status.confirmed)
          const next = confirmed.at(-1)?.txid
          if (next === undefined) break
          if (cursors.has(next)) { complete = false; break }
          cursors.add(next)
          afterTxid = next
        }
      } catch {
        // Native-node failure must not hide BTC balances or disable conversion.
        complete = false
      }
      for (const key of remaining) results.set(key, { state: complete ? 'pending' : 'unavailable' })
    }))
    return results
  }
}
