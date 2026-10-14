import {
  COMPRESSED_PUBLIC_KEY_BYTES, encodeSiglistEntry, encodeVarint,
  FALCON512_PUBLIC_KEY_BYTES, FALCON512_SIG_MAX_BYTES, SCHNORR_PUBLIC_KEY_BYTES,
  SCHNORR_SIGNATURE_BYTES, scriptP2PK, serialize, SIGHASH, TX_TYPE_STANDARD,
  TX_TYPE_TOKENS, type Algorithm, type TxInput, type TxOutput,
} from '@qbtc/crypto'

// DER may use 72 bytes; Falcon uses compressed, variable-length signatures.
const ECDSA_SIGNATURE_MAX_BYTES = 72
export function signaturePlaceholder(algo: Algorithm): Uint8Array {
  const size = algo === 'falcon512' ? FALCON512_SIG_MAX_BYTES
    : algo === 'schnorr' ? SCHNORR_SIGNATURE_BYTES : ECDSA_SIGNATURE_MAX_BYTES
  return encodeSiglistEntry(SIGHASH.ALL, algo, new Uint8Array(size))
}

export function serializedInputBytes(input: TxInput): number {
  const base = { txType: TX_TYPE_STANDARD, inputs: [], outputs: [] } as const
  return serialize({ ...base, inputs: [input] }).length - serialize(base).length
}

// Cache the fixed part of each ordinary input. The vout varint is added below.
const ordinaryBytes: Record<Algorithm, number> = Object.fromEntries(
  (['ecdsa', 'schnorr', 'falcon512'] as const).map((algo) => {
    const pubkeySize = algo === 'falcon512' ? FALCON512_PUBLIC_KEY_BYTES
      : algo === 'schnorr' ? SCHNORR_PUBLIC_KEY_BYTES : COMPRESSED_PUBLIC_KEY_BYTES
    return [algo, serializedInputBytes({ txid: new Uint8Array(32), vout: 0,
      redeemScript: scriptP2PK(new Uint8Array(pubkeySize)), siglist: [signaturePlaceholder(algo)],
    }) - encodeVarint(0).length]
  }),
) as Record<Algorithm, number>

/** Upper bound from the wire serializer, without generating keys or signatures.
 * Output hashes/data and token prefix belong to the transaction, not its inputs. */
export function transactionSizeUpperBound(
  inputs: readonly { readonly algo: Algorithm; readonly vout: number; readonly inputBytes?: number }[],
  outputs: readonly TxOutput[],
  token = false,
): number {
  const frame = serialize({ txType: token ? TX_TYPE_TOKENS : TX_TYPE_STANDARD,
    inputs: [], outputs, ...(token ? { tokenHash: new Uint8Array(32) } : {}),
  }).length + encodeVarint(inputs.length).length - encodeVarint(0).length
  return frame + inputs.reduce((sum, u) => sum + (u.inputBytes ?? ordinaryBytes[u.algo] + encodeVarint(u.vout).length), 0)
}

export function feeForBytes(bytes: number, rate: number): bigint {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid network fee rate.')
  return BigInt(Math.max(1, Math.ceil(bytes * rate)))
}
