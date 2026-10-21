// The shape of the renderer's brand values. Shared code: each brand fills in
// its own values in ../brand/index.ts.

export interface BrandConfig {
  /**
   * Ticker shown next to amounts, per NATIVE network the wallet runs on -
   * e.g. "COIN" on mainnet but "tCOIN" on testnet, so test coins are never
   * mistaken for real ones. Read it through `useAssetLabel()` (walletData),
   * never by indexing this record with a hardcoded network.
   */
  assetLabel: Readonly<Record<'mainnet' | 'testnet', string>>
  /** Human-readable coin/network name. The chain's name is the same on both
   *  networks - the network is shown separately. */
  assetName: string
  /** Product name shown in the titlebar and onboarding. */
  productName: string
  /** Onboarding subtitle line. */
  tagline: string
  /** Block-explorer transaction URL prefix (txid appended), or null when the
   *  chain has no public explorer yet - the UI hides explorer links then. */
  explorerTxUrl: string | null
  /**
   * Placeholder text for address inputs, per NATIVE network - the address
   * prefixes differ between mainnet and testnet, so a single hint would be
   * wrong on one of them. Read it through `useAddressPlaceholder()`.
   */
  addressPlaceholder: Readonly<Record<'mainnet' | 'testnet', string>>
  /** Default REST port of a self-hosted node, used in Settings hints. */
  nodeRestPort: number
  /** Source-chain upgrade flow (e.g. BTC→native conversion), or null when
   *  this brand has none - the Convert screen and nav entry stay hidden.
   *  Consensus values live in the chain profile (main/brand/profile.ts); this is only
   *  the renderer-facing presentation. */
  upgrade: {
    /**
     * Ticker of the source chain per NATIVE network the wallet runs on -
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
