import type { Network } from '@qbtc/crypto'

// BRAND FILE: delegated-key envelopes and public pubkeyhash prefixes from the
// chain's network parameters. Independent of the owner's signing algorithm.
export const DELEGATION: Readonly<Record<Network, {
  readonly wifHash256: number
  readonly wifHash160: number
  readonly pubkeyhashMagic: Uint8Array
}>> = {
  mainnet: { wifHash256: 0x8d, wifHash160: 0x8e, pubkeyhashMagic: Uint8Array.of(0x27, 0x10) },
  testnet: { wifHash256: 0xf0, wifHash160: 0xf1, pubkeyhashMagic: Uint8Array.of(0x3f, 0x00) },
}
