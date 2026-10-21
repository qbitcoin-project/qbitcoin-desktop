// BRAND FILE: the renderer's brand values. Each brand keeps its own copy of
// this file; the shape lives in ../lib/brandConfig.ts. Every user-visible
// brand value in the renderer must come from this module - screens and
// components never hardcode coin names, tickers, explorer URLs, or brand
// artwork.
//
// Deliberately JSX-free: non-UI code (lib/format.ts) and node-side test
// programs import this config, so the artwork lives in ./Logo (imported
// directly by UI code) instead of being re-exported here.
import type { BrandConfig } from '../lib/brandConfig'

export const brand: BrandConfig = {
  assetLabel: { mainnet: 'QBTC', testnet: 'tQBTC' },
  assetName: 'QBitcoin',
  productName: 'QBitcoin Wallet',
  tagline: "A quantum-safe home for your QBitcoin. Let's set up your wallet.",
  explorerTxUrl: 'https://qbtcscan.org/tx/',
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
