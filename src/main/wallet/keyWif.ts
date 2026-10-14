import {
  decodeBase58Check, FALCON512_KEYPAIR_BYTES, isValidPrivateKey,
  WifError, WifNetworkError, type DecodedWif, type Network,
} from '@qbtc/crypto'
import { PROFILE } from '../brand/profile'
import { DELEGATION } from '../brand/delegation'

export interface WalletWif extends DecodedWif {
  readonly delegatePubkeyhash?: Uint8Array
}

/** Decode once, then validate the ordinary or delegated envelope. Ordinary
 * payload rules match the crypto WIF codec, including compressed-key rejection.
 * All returned private bytes belong to the caller. */
export function decodeWalletWif(wif: string, network: Network): WalletWif {
  let decoded: ReturnType<typeof decodeBase58Check>
  try { decoded = decodeBase58Check(wif.trim(), 1) }
  catch { throw new WifError('Not a valid WIF string: invalid Base58 or checksum.') }
  const { payload, version } = decoded
  try {
    const detected = (['mainnet', 'testnet'] as const).find((n) =>
      version[0] === PROFILE.wifVersion[n] || version[0] === DELEGATION[n].wifHash160 || version[0] === DELEGATION[n].wifHash256)
    if (detected === undefined) throw new WifError(`Unknown WIF version byte 0x${version[0]!.toString(16).padStart(2, '0')}.`)
    if (detected !== network) throw new WifNetworkError(network, detected)
    const delegated = version[0] !== PROFILE.wifVersion[network]
    const hashLength = delegated ? (version[0] === DELEGATION[network].wifHash256 ? 32 : 20) : 0
    const keyLength = payload.length - hashLength
    if (keyLength !== 32 && keyLength !== FALCON512_KEYPAIR_BYTES) {
      if (!delegated && keyLength === 33 && payload[32] === 1) {
        throw new WifError("This looks like a Bitcoin compressed-key WIF (trailing 0x01 flag). This chain's WIF carries the raw 32-byte key with no flag.")
      }
      throw new WifError(delegated ? 'Invalid delegated private-key length.' : `Unsupported private-key payload: ${keyLength} bytes (expected 32 or ${FALCON512_KEYPAIR_BYTES}).`)
    }
    const key = payload.slice(0, keyLength)
    if (keyLength === 32 && !isValidPrivateKey(key)) {
      key.fill(0)
      throw new WifError('The 32-byte payload is not a valid secp256k1 private key.')
    }
    return {
      payload: key,
      candidates: keyLength === 32 ? ['ecdsa', 'schnorr'] : ['falcon512'],
      ...(delegated ? { delegatePubkeyhash: payload.slice(keyLength) } : {}),
    }
  } finally { payload.fill(0) }
}
