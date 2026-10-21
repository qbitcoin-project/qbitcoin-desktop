import {
  falconKeypairFromWifPayload,
  encodeSiglistEntry,
  getPublicKey,
  schnorrGetPublicKey,
  serialize,
  SIGHASH,
  sighash,
  signWithAlgorithm,
  signTransaction,
  scriptP2PK,
  toHex,
  txid as computeTxid,
  type Algorithm,
  type Network,
  type SigningInput,
  type Transaction,
} from '@qbtc/crypto'
import {
  addressFromPubkey,
  sighashCommitsTokenId,
} from '../crypto'
import type { AddressOps } from '../vault/orchestrator'
import type { AddressSource } from './AddressSource'
import type { UnsignedTx } from './buildTx'
import type { StoredKey } from './keyStore'
import { toCryptoTransaction, type SignedTx } from './signTx'
import { decodeWalletWif, type WalletWif } from './keyWif'
import { delegatedOwnerInput, delegationAddress, delegationScript, encodeDelegatePubkeyhash, ownerPubkeyhash } from './delegation'
import { serializedInputBytes, signaturePlaceholder } from './txSize'

// A single imported private key (kind: 'key' wallet) — the building blocks.
//
// A key wallet has one fixed owner key: no HD tree or fresh addresses.
// A delegated WIF also tracks the ordinary address of that key so returned
// coins remain visible and spendable. Change returns to the ordinary address,
// so spending returned coins cannot delegate their change again. Raw signing
// keys stay in main; WIF backup is a separate, explicit
// password-authenticated operation in WalletBackupService.

/** An imported key, materialized for a session: raw key material + address. */
export interface ImportedKey {
  readonly algo: Algorithm
  /** SECRET. Owned by the session cache; wiped on lock/switch. */
  readonly privateKey: Uint8Array
  readonly publicKey: Uint8Array
  readonly address: string
  readonly delegation?: {
    readonly delegatePubkeyhash: Uint8Array
    readonly redeemScript: Uint8Array
  }
}

/** Return/change never grants staking permission to the service again. */
export function ordinaryKeyAddress(key: ImportedKey, network: Network): string {
  return addressFromPubkey(key.publicKey, key.algo, network)
}

/**
 * Materialize a stored key: decode the WIF, derive the public key for the
 * stored algorithm, and recompute the address. The recomputed address is
 * compared against the stored one — a mismatch means the blob was tampered
 * with or produced by an incompatible build, and must not be spent from.
 *
 * Async: a Falcon key runs its pair self-check in WASM.
 */
export async function importedKeyFromStored(stored: StoredKey, network: Network): Promise<ImportedKey> {
  return materializeKey(stored, decodeWalletWif(stored.wif, network), network)
}

/** Choose the algorithm and materialize a pasted key from the same decode. */
export async function importedKeyFromWif(wif: string, network: Network, algoHint?: Algorithm): Promise<ImportedKey> {
  const decoded = decodeWalletWif(wif, network)
  return materializeKey({ wif, algo: algoHint ?? decoded.candidates[0]!, address: '' }, decoded, network)
}

async function materializeKey(stored: StoredKey, decoded: WalletWif, network: Network): Promise<ImportedKey> {
  const { payload, candidates, delegatePubkeyhash } = decoded
  if (!candidates.includes(stored.algo)) {
    payload.fill(0)
    throw new Error(`This key cannot be used as ${stored.algo}.`)
  }

  let materialized: ImportedKey | undefined
  try {
    let key: ImportedKey
    if (stored.algo === 'falcon512') {
      const kp = await falconKeypairFromWifPayload(payload)
      payload.fill(0) // the keypair holds its own copies
      key = { algo: stored.algo, privateKey: kp.privateKey, publicKey: kp.publicKey, address: addressFromPubkey(kp.publicKey, stored.algo, network) }
    } else {
      // For classical keys the payload IS the private key — hand it over (the
      // session cache owns and wipes it).
      const publicKey = stored.algo === 'schnorr' ? schnorrGetPublicKey(payload) : getPublicKey(payload)
      key = { algo: stored.algo, privateKey: payload, publicKey, address: addressFromPubkey(publicKey, stored.algo, network) }
    }
    materialized = key
    if (delegatePubkeyhash !== undefined) {
      const owner = ownerPubkeyhash(key.publicKey, key.algo)
      key = { ...key, address: delegationAddress(owner, delegatePubkeyhash, network), delegation: {
        delegatePubkeyhash, redeemScript: delegationScript(owner, delegatePubkeyhash),
      } }
    }

    if (stored.address !== '' && key.address !== stored.address) {
      key.privateKey.fill(0)
      throw new Error('Stored key data is inconsistent (address mismatch) — refusing to use it.')
    }
    if (stored.delegatePubkeyhash !== undefined &&
        (delegatePubkeyhash === undefined || stored.delegatePubkeyhash !== encodeDelegatePubkeyhash(delegatePubkeyhash, network))) {
      throw new Error('Stored key data is inconsistent (delegate mismatch) — refusing to use it.')
    }
    return key
  } catch (error) {
    materialized?.privateKey.fill(0)
    payload.fill(0)
    throw error
  }
}

/** Fixed primary address plus the ordinary return address of a delegated WIF. */
export function createKeyAddressSource(getKey: () => Promise<ImportedKey>, network?: Network): AddressSource {
  return {
    branches: async () => {
      const key = await getKey()
      return [{ kind: 'list', algo: key.algo, addresses: [
        { chain: 0, index: 0, address: key.address },
        ...(key.delegation !== undefined && network !== undefined
          ? [{ chain: 1 as const, index: 0, address: ordinaryKeyAddress(key, network) }] : []),
      ] }]
    },
    // The session owns the key cache; nothing extra to drop here.
    reset: () => undefined,
  }
}

// Receive ops for a key wallet: there is only ever the one address. "New
// address" cannot advance anything (no derivation), so it returns the same
// address — mirroring how watch wallets behave.
export function keyReceiveOps(getKey: () => Promise<ImportedKey>): AddressOps {
  const address = async (): Promise<string> => (await getKey()).address
  return {
    getReceiveAddress: () => address(),
    getNewReceiveAddress: () => address(),
    listReceiveAddresses: async () => [{ address: await address(), index: 0, current: true }],
  }
}

/** What a pasted WIF could be: candidate algorithms + the address each would watch. */
export interface KeyCandidates {
  readonly candidates: readonly Algorithm[]
  readonly addresses: Partial<Record<Algorithm, string>>
  readonly delegatePubkeyhash?: string
}

/**
 * Inspect a WIF without persisting anything: which algorithms the payload
 * admits and the single address each candidate would give — so the import UI
 * can show the address for confirmation before anything is saved. Schnorr is
 * listed only when explicitly included (the feature flag decides upstream).
 */
export async function inspectWifKey(wif: string, network: Network, opts?: { readonly includeSchnorr?: boolean }): Promise<KeyCandidates> {
  const { payload, candidates, delegatePubkeyhash } = decodeWalletWif(wif, network)
  const offered = candidates.filter((a) => a !== 'schnorr' || opts?.includeSchnorr === true)
  const addresses: Partial<Record<Algorithm, string>> = {}
  try {
    for (const algo of offered) {
      let publicKey: Uint8Array
      if (algo === 'falcon512') {
        const kp = await falconKeypairFromWifPayload(payload)
        kp.privateKey.fill(0)
        publicKey = kp.publicKey
      } else {
        publicKey = algo === 'schnorr' ? schnorrGetPublicKey(payload) : getPublicKey(payload)
      }
      addresses[algo] = delegatePubkeyhash === undefined
        ? addressFromPubkey(publicKey, algo, network)
        : delegationAddress(ownerPubkeyhash(publicKey, algo), delegatePubkeyhash, network)
    }
  } finally {
    payload.fill(0)
  }
  return { candidates: offered, addresses, ...(delegatePubkeyhash !== undefined ? { delegatePubkeyhash: encodeDelegatePubkeyhash(delegatePubkeyhash, network) } : {}) }
}

/**
 * Sign every input of a draft with the imported key. Unlike the HD signer
 * (signTx.ts), the key is session-cached and NOT wiped after signing — the
 * session owns its lifetime (wiped on lock/switch).
 *
 * A key wallet's discovery only ever surfaces its own address, so every input
 * must match the key's algorithm; a mismatch means a programming error and is
 * refused loudly.
 */
export async function buildSignedTransactionWithKey(unsigned: UnsignedTx, key: ImportedKey, network: Network, ordinaryOnly = false): Promise<Transaction> {
  const tx = toCryptoTransaction(unsigned)
  unsigned.inputs.forEach((input, index) => {
    if (input.algo !== key.algo) {
      throw new Error(`Input ${index} expects a ${input.algo} key, but the imported key is ${key.algo}.`)
    }
  })
  let signed: Transaction
  const delegation = key.delegation
  if (delegation === undefined || ordinaryOnly) {
    const signers: SigningInput[] = unsigned.inputs.map((input, inputIndex) => ({ input, inputIndex })).filter(({ input }) => !ordinaryOnly || input.keyScript !== 'delegated').map(({ inputIndex }) => ({ inputIndex, privateKey: key.privateKey, publicKey: key.publicKey, algo: key.algo }))
    signed = await signTransaction(tx, signers, SIGHASH.ALL, sighashCommitsTokenId(network))
  }
  else {
    const digest = sighash(tx, SIGHASH.ALL, sighashCommitsTokenId(network))
    const signature = encodeSiglistEntry(SIGHASH.ALL, key.algo, await signWithAlgorithm(digest, key.privateKey, key.algo))
    signed = { ...tx, inputs: tx.inputs.map((input, i) => unsigned.inputs[i]!.keyScript === 'ordinary'
      ? { ...input, redeemScript: scriptP2PK(key.publicKey), siglist: [signature] }
      : delegatedOwnerInput(input, signature, key.publicKey, delegation.redeemScript)) }
  }
  return signed
}

export async function signUnsignedTxWithKey(unsigned: UnsignedTx, key: ImportedKey, network: Network): Promise<SignedTx> {
  const signed = await buildSignedTransactionWithKey(unsigned, key, network)
  return { rawHex: toHex(serialize(signed)), txid: toHex(computeTxid(signed)) }
}

/** Upper bound for the serialized delegated input, including the owner public
 * key and branch selector. Ordinary inputs are sized by the shared estimator. */
export function keyInputBytes(key: ImportedKey): number | undefined {
  if (key.delegation === undefined) return undefined
  return serializedInputBytes(delegatedOwnerInput({ txid: new Uint8Array(32), vout: 0xffffffff },
    signaturePlaceholder(key.algo), key.publicKey, key.delegation.redeemScript))
}
