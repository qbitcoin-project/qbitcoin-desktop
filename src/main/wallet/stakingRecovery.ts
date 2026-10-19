import { ChainError, type ChainTx } from '@qbtc/chain'
import { toHex, type Network } from '@qbtc/crypto'
import { decodeAddress } from '../brand/crypto'
import { STAKE_MATURITY } from '../brand/staking'
import { isMature } from '../../shared/maturity'
import type { UnsignedInput } from './buildTx'
import type { DelegationOperation, DelegationRecord } from './delegationStore'
import type { DelegationOperationReader } from './DelegationOperationManager'
import type { GatheredUtxo } from './spendable'

/** The exception to ordinary conflict handling is limited to this exact pair. */
export function isRecoveryOf(recovery: DelegationOperation, original: DelegationOperation | undefined): original is DelegationOperation {
  if (original === undefined || recovery.recoveryOf !== original.id || original.recoveryOf !== undefined ||
    recovery.kind !== 'withdrawal' || recovery.tokenId !== undefined || original.tokenId !== undefined ||
    recovery.address !== original.address || original.txid === undefined ||
    recovery.unsigned.inputs.length !== original.unsigned.inputs.length) return false
  const inputs = new Map(original.unsigned.inputs.map((i) => [`${i.prevTxid}:${i.vout}`, i.valueAtomic]))
  return recovery.unsigned.inputs.every((i) => inputs.get(`${i.prevTxid}:${i.vout}`) === i.valueAtomic)
}

/** Address UTXO lists hide mempool-spent coins. Authenticate the saved inputs
 * against their confirmed source outputs and the current spending transaction. */
export async function recoveryInputs(args: {
  original: DelegationOperation; record: DelegationRecord; reader: DelegationOperationReader;
  network: Network; ordinaryInputAddress(input: UnsignedInput): Promise<string>;
  delegatedBytes: number; check(): void
}): Promise<GatheredUtxo[]> {
  const { original, reader, check } = args
  if (original.txid === undefined || original.rawHex === undefined || original.tokenId !== undefined || original.recoveryOf !== undefined) {
    throw new Error('The original signed operation is unavailable.')
  }
  let published: ChainTx | undefined
  try { published = await reader.getTransaction(original.txid) }
  catch (error) { if (!(error instanceof ChainError && error.status === 404)) throw error }
  check()
  if (published !== undefined && (published.txid !== original.txid || published.status.confirmed)) {
    throw new Error('The original transaction changed or already confirmed. Refresh its status before recovery.')
  }
  const sources = new Map<string, Promise<ChainTx>>()
  const coins: GatheredUtxo[] = new Array(original.unsigned.inputs.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(8, coins.length) }, async () => {
    while (next < coins.length) {
      const index = next++, input = original.unsigned.inputs[index]!
      check()
      if (!sources.has(input.prevTxid)) sources.set(input.prevTxid, reader.getTransaction(input.prevTxid))
      const source = await sources.get(input.prevTxid)!
      check()
      const output = source.vout[input.vout]
      const delegated = original.kind === 'withdrawal'
      if (delegated ? input.keyScript !== 'delegated' || input.algo !== args.record.owner.algo : input.keyScript === 'delegated') {
        throw new Error('The original input ownership is inconsistent.')
      }
      const address = delegated ? args.record.address : await args.ordinaryInputAddress(input)
      check()
      if (source.txid !== input.prevTxid || !source.status.confirmed || !Number.isInteger(source.version) ||
        source.version < 1 || source.version > 8 || output === undefined ||
        output.value !== BigInt(input.valueAtomic) || output.tokenId !== undefined || output.tokenAmount !== undefined ||
        output.scripthash !== toHex(decodeAddress(address).scripthash) ||
        (output.address !== undefined && output.address !== address)) {
        throw new Error('The original input value, ownership or confirmation could not be verified.')
      }
      const stake = source.version === 2 || source.version === 5, time = source.status.blockTime
      const coin: GatheredUtxo = { txid: input.prevTxid, vout: input.vout, value: output.value,
        algo: input.algo, chain: input.chain, index: input.index, scheme: input.scheme,
        keyScript: input.keyScript, address, confirmed: true, blockHeight: source.status.blockHeight,
        ...(delegated ? { inputBytes: args.delegatedBytes, delegated: true } : {}),
        ...(stake ? time !== undefined && Number.isFinite(time) && time > 0
          ? { maturesAt: time + STAKE_MATURITY[args.network] } : { maturityUnknown: true } : {}),
      }
      if (!isMature(coin)) throw new Error('The original coins are not mature. Refresh before recovery.')
      const spend = await reader.getOutspend(input.prevTxid, input.vout)
      check()
      if (spend.spent) {
        if (spend.txid !== original.txid) throw new Error('Another transaction spends an original input. Refresh before recovery.')
        // Re-read after outspend so a confirmation since the first check cannot pass.
        const spender = await reader.getTransaction(original.txid!)
        check()
        if (spender.txid !== original.txid || spender.status.confirmed) {
          throw new Error('The original transaction already confirmed. Refresh its status before recovery.')
        }
      }
      coins[index] = coin
    }
  }))
  check()
  return coins
}
