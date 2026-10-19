import type { ChainTx } from '@qbtc/chain'
import type { StakingChainActivity } from '../../shared/staking'

/** Project a transaction to a small address-level balance movement. Do not
 * retain witnesses, treat change as a fresh deposit, or count restaked principal
 * as a reward. Incomplete prevouts cannot establish a direction or an amount. */
export function stakingChainActivity(address: string, hash: string | undefined, tx: ChainTx): StakingChainActivity {
  const ours = (addr?: string, sh?: string): boolean => addr === address || (hash !== undefined && sh === hash)
  let native = 0n
  const tokens = new Map<string, bigint>()
  const unknownTokens = new Set<string>()
  const addToken = (id: string, value: bigint | undefined, sign: bigint): void => {
    tokens.set(id, (tokens.get(id) ?? 0n) + (value ?? 0n) * sign)
    if (value === undefined) unknownTokens.add(id)
  }
  let complete = true
  for (const input of tx.vin) {
    if (input.prevoutValue === undefined || (input.prevoutAddress === undefined && input.prevoutScripthash === undefined)) complete = false
    if (!ours(input.prevoutAddress, input.prevoutScripthash)) continue
    if (input.prevoutTokenId !== undefined) addToken(input.prevoutTokenId, input.prevoutTokenAmount, -1n)
    else native -= input.prevoutValue ?? 0n
  }
  for (const output of tx.vout) {
    if (!ours(output.address, output.scripthash)) continue
    if (output.tokenId !== undefined) addToken(output.tokenId, output.tokenAmount, 1n)
    else native += output.value
  }
  const kind = tx.version === 2 ? 'stake' : tx.version === 5 ? 'slashing' :
    !complete || native === 0n ? 'transaction' : native > 0n ? 'deposit' : 'withdrawal'
  return {
    source: 'chain', id: `chain:${address}:${tx.txid}`, address, txid: tx.txid, kind,
    balanceChangeAtomic: complete ? native.toString() : undefined,
    tokenChanges: [...tokens].map(([id, amount]) => ({ id, amountAtomic: complete && !unknownTokens.has(id) ? amount.toString() : undefined })),
    // A stake's negative transaction fee represents issuance, not a user fee.
    feeAtomic: tx.fee >= 0n ? tx.fee.toString() : undefined,
    createdAt: tx.status.blockTime === undefined ? undefined : tx.status.blockTime * 1000,
    blockHeight: tx.status.blockHeight,
  }
}
