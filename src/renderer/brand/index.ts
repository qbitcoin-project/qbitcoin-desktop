// Brand configuration for this build. Every user-visible brand value in the
// renderer must come from this module — screens and components never hardcode
// coin names, tickers, explorer URLs, or brand artwork. Mirrors the node's
// admin brand module: the common branch carries a neutral stub here and
// each brand branch overrides the values (and Logo.tsx) in its own stack.
//
// Deliberately JSX-free: non-UI code (lib/format.ts) and node-side test
// programs import this config, so the artwork lives in ./Logo (imported
// directly by UI code) instead of being re-exported here.

export interface BrandConfig {
  /**
   * Ticker shown next to amounts, per NATIVE network the wallet runs on —
   * e.g. "QBT" on mainnet but "tQBT" on testnet, so test coins are never
   * mistaken for real ones. Read it through `useAssetLabel()` (walletData),
   * never by indexing this record with a hardcoded network.
   */
  assetLabel: Readonly<Record<'mainnet' | 'testnet', string>>
  /** Human-readable coin/network name, e.g. "QBitcoin". The chain's name is
   *  the same on both networks — the network is shown separately. */
  assetName: string
  /** Product name shown in the titlebar and onboarding, e.g. "QBitcoin Wallet". */
  productName: string
  /** Onboarding subtitle line. */
  tagline: string
  /** Block-explorer transaction URL prefix (txid appended), or null when the
   *  chain has no public explorer yet — the UI hides explorer links then. */
  explorerTxUrl: string | null
  /**
   * Placeholder text for address inputs, per NATIVE network — the address
   * prefixes differ between mainnet and testnet, so a single hint would be
   * wrong on one of them. Read it through `useAddressPlaceholder()`.
   */
  addressPlaceholder: Readonly<Record<'mainnet' | 'testnet', string>>
  /** Default REST port of a self-hosted node, used in Settings hints. */
  nodeRestPort: number
  /** Source-chain upgrade flow (e.g. BTC→native conversion), or null when
   *  this brand has none — the Convert screen and nav entry stay hidden.
   *  Consensus values live in the chain profile (main/brand/profile.ts); this is only
   *  the renderer-facing presentation. */
  upgrade: {
    /**
     * Ticker of the source chain per NATIVE network the wallet runs on —
     * e.g. "BTC" on mainnet but "tBTC" on testnet, so test coins are never
     * mistaken for real ones.
     */
    sourceCoinLabel: Readonly<Record<'mainnet' | 'testnet', string>>
    /**
     * Explorer tx URL prefix of the SOURCE chain per NATIVE network the
     * wallet runs on (the source chain follows it: native testnet locks on
     * the source testnet), or null when no public explorer exists.
     */
    sourceExplorerTxUrl: Readonly<Record<'mainnet' | 'testnet', string>> | null
  } | null
}

export const brand: BrandConfig = {
  assetLabel: { mainnet: 'QBTC', testnet: 'tQBTC' },
  assetName: 'QBitcoin',
  productName: 'QBitcoin Wallet',
  tagline: "A quantum-safe home for your QBitcoin. Let's set up your wallet.",
  // No public explorer yet — the UI hides explorer links until there is one.
  explorerTxUrl: null,
  // Both address shapes the chain accepts, per network: classical (HASH160,
  // 35/36 chars) and post-quantum (HASH256, 52/53). Prefixes follow the
  // node's per-network ADDRESS_RE.
  addressPlaceholder: { mainnet: 'bq… or 3u…', testnet: 'btq… or 3ua…' },
  nodeRestPort: 9557,
  // QBitcoin upgrades from Bitcoin: the Convert screen is live (consensus
  // params: the chain profile's `upgrade`), episodes link to mempool.space —
  // the only public explorer that serves testnet4 as well.
  upgrade: {
    sourceCoinLabel: { mainnet: 'BTC', testnet: 'tBTC' },
    sourceExplorerTxUrl: {
      mainnet: 'https://mempool.space/tx/',
      testnet: 'https://mempool.space/testnet4/tx/',
    },
  },
}
