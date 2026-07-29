import { coinTypeFor, type ChainProfile, type DerivationScheme } from '@qbtc/crypto'

// The chain profile: everything that makes this build's chain THIS chain from
// the wallet-crypto perspective — derivation schemes, address magic, WIF
// versions, HKDF labels, signed-message magic, conversion parameters.
// @qbtc/crypto ships no chain constants; this file injects ours, and ./crypto
// binds it into the facade the rest of main imports.
//
// BRAND FILE: like the node's chain parameters, brand branches edit these
// values in place. This is the QBitcoin brand.
//
// FROZEN on a shipped brand: every value here except the `upgrade` display
// limits is consensus- or storage-affecting — changing schemes, magic, HKDF
// labels or WIF versions after shipping strands user funds or data. Pin
// tests: tests/unit/brand/profile.test.ts.

/**
 * The QBitcoin derivation scheme. coin_type 2009 (SLIP-0044, obtained
 * 2026-07) on mainnet; testnet follows the BIP-44 convention with the
 * shared testnet coin_type 1 — which also keeps wallets created before
 * registration discoverable there (the placeholder derived everything
 * from coin_type 1). No wallet ever shipped deriving mainnet funds from
 * the placeholder, so there is no legacy scheme to carry.
 *
 * FROZEN once shipped: id, coin_types and the path shape hold user
 * funds — never change them; add a new scheme instead.
 */
export const SCHEME_QBT: DerivationScheme = {
  id: 'qbt-v1-slip44',
  coinType: { mainnet: 2009, testnet: 1 },
  label: 'QBitcoin v1 (SLIP-0044)',
  status: 'active',
  pathTemplate: (account, change, index, network) =>
    `m/44'/${coinTypeFor(SCHEME_QBT, network)}'/${account}'/${change}/${index}`,
}

export const PROFILE: ChainProfile = {
  /** Diagnostics-only label (error messages). Not consensus. */
  name: 'qbitcoin',

  /**
   * Address magic prefix per network, prepended to the scripthash before
   * Base58Check encoding. Lengths differ per network (the QBitcoin testnet
   * uses 3 bytes) — the decoder always takes the length from here.
   */
  addrMagic: {
    mainnet: Uint8Array.of(0x13, 0x9d),
    testnet: Uint8Array.of(0x04, 0x73, 0x89),
  },

  /**
   * Address-shape pre-filter per network, matching the node's own address
   * regexes byte for byte. Two shapes each: classical (HASH160-based) bq…
   * (35 chars) / btq… (36), post-quantum (HASH256-based) 3u[H-K]… (52) /
   * 3ua[2-4]… (53). The character classes are the EXACT reachable ranges for
   * the magic bytes above.
   */
  addressRegex: {
    mainnet: /^(?:bq[1-9A-HJ-NP-Za-km-z]{33}|3u[H-K][1-9A-HJ-NP-Za-km-z]{49})$/,
    testnet: /^(?:btq[1-9A-HJ-NP-Za-km-z]{33}|3ua[2-4][1-9A-HJ-NP-Za-km-z]{49})$/,
  },

  /** One-byte WIF version prefixes (Bitcoin-compatible envelope). */
  wifVersion: { mainnet: 0x80, testnet: 0xef },

  /**
   * Every derivation scheme this chain's wallets know about, in scan
   * priority order for funds discovery. Exactly one is 'active'.
   */
  schemes: [SCHEME_QBT],

  /**
   * The scheme that owns data persisted BEFORE storage became per-scheme
   * (wallet meta without a `schemes` map, version-1 watch descriptors). When
   * a brand adds a new active scheme this stays on the ORIGINAL one —
   * re-attributing old blobs would shift issued-index floors onto the wrong
   * branch.
   */
  metaV1SchemeId: SCHEME_QBT.id,

  /** HKDF label of the Falcon-512 keygen-seed derivation. Versioned. */
  falconHdInfo: 'qbt/pq/falcon512/v1',
  /** HKDF label of the app-data (address book etc.) encryption key. */
  appDataInfo: 'qbt/app-data/v1',
  /** Signed-message magic prefix — Bitcoin's convention, brand-flavored. */
  messageMagic: 'QBitcoin Signed Message:\n',

  /**
   * BTC→native upgrade and native→BTC downgrade parameters per NATIVE
   * network, or null while the brand has no conversion flow — the Convert
   * screen stays dormant then.
   */
  upgrade: null,
  downgrade: null,

  /**
   * When transaction sign data starts committing the token id, per network
   * (unix seconds): 0 = since genesis, null = never. Must mirror the brand
   * node's fork schedule — before the fork the node rejects signatures that
   * commit the id, after it those that omit it.
   */
  tokenSighashFork: { mainnet: 0, testnet: 0 },
}
