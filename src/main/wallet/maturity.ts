import type { ChainTx } from '@qbtc/chain'
import type { Network } from '@qbtc/crypto'
import type { MaturityInfo } from '../../shared/maturity'
import { STAKE_MATURITY } from '../brand/staking'
import type { GatheredUtxo } from './spendable'

/** UTXO responses omit the source transaction type. Resolve it once per txid,
 * with bounded concurrency. Unavailable source data must not look spendable. */
export async function withMaturity(coins: readonly GatheredUtxo[], backend: { getTransaction(txid: string): Promise<ChainTx> }, network: Network): Promise<GatheredUtxo[]> {
  const txids = [...new Set(coins.map((c) => c.txid))]
  const info = new Map<string, MaturityInfo>()
  let next = 0
  await Promise.all(Array.from({ length: Math.min(8, txids.length) }, async () => {
    while (next < txids.length) {
      const txid = txids[next++]!
      try {
        const tx = await backend.getTransaction(txid)
        if (tx.txid !== txid || !Number.isInteger(tx.version) || tx.version < 1 || tx.version > 8) throw new Error('Unknown source transaction')
        if (tx.version === 2 || tx.version === 5) {
          const time = tx.status.blockTime
          info.set(txid, tx.status.confirmed && time !== undefined && Number.isFinite(time) && time > 0
            ? { maturesAt: time + STAKE_MATURITY[network] } : { maturityUnknown: true })
        } else info.set(txid, {})
      } catch { info.set(txid, { maturityUnknown: true }) }
    }
  }))
  return coins.map((coin) => ({ ...coin, ...info.get(coin.txid) }))
}
