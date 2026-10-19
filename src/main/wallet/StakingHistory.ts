import type { ChainTx } from '@qbtc/chain'
import type { StakingChainActivity } from '../../shared/staking'
import { stakingChainActivity } from './stakingActivity'

interface HistoryReader {
  getAddressTransactions(address: string, afterTxid?: string): Promise<ChainTx[]>
}
interface Snapshot {
  head?: ChainTx
  lastStake?: ChainTx
  slashed: boolean
  complete: boolean
  cursor?: string
  activity: readonly StakingChainActivity[]
}
const sameBlock = (a: ChainTx, b: ChainTx): boolean => a.txid === b.txid &&
  a.status.blockHash !== undefined && a.status.blockHash === b.status.blockHash

/** Retain compact movements, not pages of large union transactions. A matching
 * confirmed anchor links cached ancestry; a reorg rebuilds the summary. Older
 * history is backfilled a page at a time rather than rescanned every tick. */
export class StakingHistory {
  private readonly snapshots = new Map<string, Snapshot>()
  constructor(private readonly reader: HistoryReader, private readonly check: () => void) {}

  async read(address: string, scripthash?: string): Promise<Snapshot> {
    const old = this.snapshots.get(address)
    const first = (await this.reader.getAddressTransactions(address)).filter((tx) => tx.status.confirmed)
    this.check()
    const head = first[0]
    let state: Snapshot = { head, slashed: false, complete: head === undefined, activity: [] }
    const activity = new Map<string, StakingChainActivity>()
    const absorb = (page: readonly ChainTx[]): void => {
      state.lastStake ??= page.find((tx) => tx.version === 2)
      state.slashed ||= page.some((tx) => tx.version === 5)
      for (const tx of page) activity.set(tx.txid, stakingChainActivity(address, scripthash, tx))
    }
    let page = first
    let linked = false
    // Bound new activity too: a long offline interval must not monopolize IO.
    for (let count = 0; count < 4; count++) {
      absorb(page)
      if (old?.head !== undefined && page.some((tx) => sameBlock(tx, old.head!))) {
        state = { ...old, head, lastStake: state.lastStake ?? old.lastStake, slashed: state.slashed || old.slashed }
        for (const entry of old.activity) if (!activity.has(entry.txid)) activity.set(entry.txid, entry)
        linked = true
        break
      }
      const cursor = page.at(-1)?.txid
      if (cursor === undefined) { state.complete = true; break }
      if (cursor === state.cursor) break
      state.cursor = cursor
      if (count === 3) break
      page = (await this.reader.getAddressTransactions(address, cursor)).filter((tx) => tx.status.confirmed)
      this.check()
    }
    if (linked && !state.complete && state.cursor !== undefined) {
      const older = (await this.reader.getAddressTransactions(address, state.cursor)).filter((tx) => tx.status.confirmed)
      this.check()
      absorb(older)
      const next = older.at(-1)?.txid
      if (next === undefined) state.complete = true
      else state.cursor = next
    }
    state.activity = [...activity.values()]
    this.snapshots.set(address, state)
    return state
  }
}
