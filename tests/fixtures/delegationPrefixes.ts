import type { Network } from '@qbtc/crypto'
import type { DelegationPrefixes } from '../../src/main/wallet/delegationTypes'

// Delegation prefixes for shared tests, so delegated-key tests run the same way in
// every brand, including one that ships no delegated keys. Brand pins in
// tests/unit/brand test the real values.
export const TEST_DELEGATION: Readonly<Record<Network, DelegationPrefixes>> = {
  mainnet: { wifHash256: 0x8d, wifHash160: 0x8e, pubkeyhashMagic: Uint8Array.of(0x27, 0x10) },
  testnet: { wifHash256: 0xf0, wifHash160: 0xf1, pubkeyhashMagic: Uint8Array.of(0x3f, 0x00) },
}
