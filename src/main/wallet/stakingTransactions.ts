import { encodeSiglistEntry, serialize, sighash, SIGHASH, signWithAlgorithm, toHex, txid, type Network, type Transaction } from '@qbtc/crypto'
import { decodeAddress, sighashCommitsTokenId } from '../brand/crypto'
import type { StakingOwnerAlgo } from '../../shared/staking'
import { buildSend, draftSizeUpperBound, feeForDraft, type BuiltSend, type SpendableUtxo, type UnsignedTx, type ChangeBranch } from './buildTx'
import { delegatedOwnerInput, delegationMark, delegationScript } from './delegation'
import { toCryptoTransaction, type SignedTx } from './signTx'
import { serializedInputBytes, signaturePlaceholder, transactionSizeUpperBound } from './txSize'
import { MAX_BROADCAST_BYTES } from './transactionLimits'

export const STAKING_MAX_TX_BYTES = MAX_BROADCAST_BYTES

export function delegatedInputBytes(publicKey: Uint8Array, algo: StakingOwnerAlgo, ownerHash: Uint8Array, delegateHash: Uint8Array): number {
  return serializedInputBytes(delegatedOwnerInput({ txid: new Uint8Array(32), vout: 0xffffffff },
    signaturePlaceholder(algo), publicKey, delegationScript(ownerHash, delegateHash)))
}

export function stakingDraftBytes(unsigned: UnsignedTx, pool: readonly SpendableUtxo[]): number {
  return draftSizeUpperBound(pool, unsigned)
}

export function buildStakingFunding(args: {
  pool: readonly SpendableUtxo[]; address: string; ownerHash: Uint8Array; amount: bigint;
  max: boolean; feeRate: number; changeAddresses: Readonly<Record<ChangeBranch, string>>; maxBytes?: number
}): BuiltSend {
  let fee = 0n
  for (let attempt = 0; attempt < 64; attempt++) {
    const built = buildSend({ utxos: args.pool, recipient: args.address, amountAtomic: args.amount,
      feeAtomic: fee, sendMax: args.max, changeAddressFor: (algo) => args.changeAddresses[algo] })
    const unsigned: UnsignedTx = { ...built.unsigned, outputs: built.unsigned.outputs.map((o, i) =>
      i === 0 ? { ...o, data: toHex(delegationMark(args.ownerHash)) } : o) }
    const required = feeForDraft(args.pool, unsigned, args.feeRate)
    if (built.feeAtomic >= required) {
      if (stakingDraftBytes(unsigned, args.pool) > Math.min(args.maxBytes ?? STAKING_MAX_TX_BYTES, STAKING_MAX_TX_BYTES)) throw new Error('This transaction is too large. Select a smaller source or delegate a smaller amount.')
      return { ...built, unsigned }
    }
    fee = required > fee ? required : fee + 1n
  }
  throw new Error('Could not calculate a stable staking fee. Refresh and try again.')
}

/** Return the requested net amount; every remaining atomic unit stays delegated. */
export function buildStakingWithdrawal(args: {
  pool: readonly SpendableUtxo[]; address: string; destination: string; amount: bigint;
  max: boolean; feeRate: number; maxBytes?: number
}): BuiltSend {
  let fee = 0n
  for (let attempt = 0; attempt < 64; attempt++) {
    const built = buildSend({ utxos: args.pool, recipient: args.destination, amountAtomic: args.amount,
      feeAtomic: fee, sendMax: args.max, changeAddress: args.address, dustAtomic: 0n })
    const required = feeForDraft(args.pool, built.unsigned, args.feeRate)
    if (built.feeAtomic >= required) {
      if (stakingDraftBytes(built.unsigned, args.pool) > Math.min(args.maxBytes ?? STAKING_MAX_TX_BYTES, STAKING_MAX_TX_BYTES)) {
        throw new Error('This unstake is too large for one transaction. Choose a smaller amount or use Max to review the first part.')
      }
      return built
    }
    fee = required
  }
  throw new Error('Could not calculate a stable unstake fee. Refresh and try again.')
}

export async function signStakingWithdrawal(unsigned: UnsignedTx, key: { privateKey: Uint8Array; publicKey: Uint8Array }, algo: StakingOwnerAlgo,
  ownerHash: Uint8Array, delegateHash: Uint8Array, network: Network, ordinary?: Transaction): Promise<SignedTx> {
  const tx = toCryptoTransaction(unsigned)
  const signature = encodeSiglistEntry(SIGHASH.ALL, algo,
    await signWithAlgorithm(sighash(tx, SIGHASH.ALL, sighashCommitsTokenId(network)), key.privateKey, algo))
  const script = delegationScript(ownerHash, delegateHash)
  const ordinaryInputs = ordinary?.inputs
  const signed = { ...tx, inputs: tx.inputs.map((input, index) => {
    if (unsigned.inputs[index]!.keyScript !== 'ordinary') return delegatedOwnerInput(input, signature, key.publicKey, script)
    const signed = ordinaryInputs?.[index]
    if (signed?.siglist === undefined) throw new Error('Missing ordinary fee-input signature.')
    return signed
  }) }
  return { rawHex: toHex(serialize(signed)), txid: toHex(txid(signed)) }
}

/** Partition a full return by its actual witness-size bound, preserving inputs. */
export function withdrawalParts(pool: readonly SpendableUtxo[], destination: string, maxBytes = STAKING_MAX_TX_BYTES, data?: Uint8Array): readonly SpendableUtxo[][] {
  maxBytes = Math.min(maxBytes, STAKING_MAX_TX_BYTES)
  const output = { value: 0n, scripthash: decodeAddress(destination).scripthash, ...(data === undefined ? {} : { data }) }
  const parts: SpendableUtxo[][] = []
  let part: SpendableUtxo[] = []
  // Linear grouping: the serializer's framing is small; verify each final part
  // exactly, including the changing input-count varint.
  let bytes = transactionSizeUpperBound([], [output]) + 10
  for (const input of [...pool].sort((a, b) => a.txid.localeCompare(b.txid) || a.vout - b.vout)) {
    const size = transactionSizeUpperBound([input], []) - transactionSizeUpperBound([], [])
    if (size + 100 > maxBytes) throw new Error('A staking input exceeds the transaction size limit.')
    if (part.length > 0 && bytes + size > maxBytes) { parts.push(part); part = []; bytes = transactionSizeUpperBound([], [output]) + 10 }
    part.push(input)
    bytes += size
  }
  if (part.length > 0) parts.push(part)
  for (const inputs of parts) if (transactionSizeUpperBound(inputs, [output]) > maxBytes) throw new Error('Staking withdrawal exceeds the transaction size limit.')
  return parts
}
