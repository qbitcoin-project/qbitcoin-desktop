import { encodeBase58Check, hash160, hash256, opPushdata, type Algorithm, type Network, type TxInput } from '@qbtc/crypto'
import { addressFromScripthash } from '../brand/crypto'
import { DELEGATION } from '../brand/delegation'

const concat = (...parts: Uint8Array[]): Uint8Array => Uint8Array.from(parts.flatMap((p) => [...p]))

/** The owner branch witness, shared by signing and serialized-size estimation. */
export function delegatedOwnerInput(input: TxInput, signature: Uint8Array, publicKey: Uint8Array, redeemScript: Uint8Array): TxInput {
  return { ...input, redeemScript, siglist: [signature, publicKey, Uint8Array.of(1)] }
}

function hashOp(hash: Uint8Array): number {
  if (hash.length === 20) return 0xa9
  if (hash.length === 32) return 0xaa
  throw new Error(`Incorrect pubkeyhash length ${hash.length}.`)
}

/** Hash the public key itself, rather than a payment script. */
export function ownerPubkeyhash(publicKey: Uint8Array, algo: Algorithm): Uint8Array {
  return algo === 'falcon512' ? hash256(publicKey) : hash160(publicKey)
}

/** Byte-for-byte encoding of the node's delegated-staking covenant. */
export function delegationScript(owner: Uint8Array, delegate: Uint8Array): Uint8Array {
  return concat(
    Uint8Array.of(0x63, 0x76, hashOp(owner)), opPushdata(owner), Uint8Array.of(0x88, 0xac),
    // ELSE; TX_TYPE; push(pack_int(STAKE)); NUMEQUALVERIFY; INPUTSCRIPTHASH;
    // DUP; OUTPUTSVALUE; SWAP; INPUTSVALUE; GREATERTHANOREQUAL; VERIFY.
    Uint8Array.of(0x67, 0x7e), opPushdata(Uint8Array.of(0x02)),
    Uint8Array.of(0x9d, 0xbb, 0x76, 0xbd, 0x7c, 0xbc, 0xa2, 0x69, 0x76, hashOp(delegate)),
    opPushdata(delegate), Uint8Array.of(0x88, 0xac, 0x68),
  )
}

export function delegationScripthash(owner: Uint8Array, delegate: Uint8Array): Uint8Array {
  const script = delegationScript(owner, delegate)
  return owner.length === 20 && delegate.length === 20 ? hash160(script) : hash256(script)
}

export function delegationAddress(owner: Uint8Array, delegate: Uint8Array, network: Network): string {
  return addressFromScripthash(delegationScripthash(owner, delegate), network)
}

export function encodeDelegatePubkeyhash(hash: Uint8Array, network: Network): string {
  hashOp(hash)
  return encodeBase58Check(DELEGATION[network].pubkeyhashMagic, hash)
}
