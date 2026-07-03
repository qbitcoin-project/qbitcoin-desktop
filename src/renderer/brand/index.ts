// Brand configuration for this build. Every user-visible brand value in the
// renderer must come from this module — screens and components never hardcode
// coin names, tickers, explorer URLs, or brand artwork. Mirrors the node's
// admin brand module: every brand value of the renderer lives here
// (artwork in Logo.tsx).
//
// Deliberately JSX-free: non-UI code (lib/format.ts) and node-side test
// programs import this config, so the artwork lives in ./Logo (imported
// directly by UI code) instead of being re-exported here.

export interface BrandConfig {
  /** Ticker shown next to amounts, e.g. "QBT". */
  assetLabel: string
  /** Human-readable coin/network name, e.g. "QBitcoin". */
  assetName: string
  /** Product name shown in the titlebar and onboarding, e.g. "QBitcoin Wallet". */
  productName: string
  /** Onboarding subtitle line. */
  tagline: string
  /** Block-explorer transaction URL prefix (txid appended), or null when the
   *  chain has no public explorer yet — the UI hides explorer links then. */
  explorerTxUrl: string | null
  /** Placeholder text for address inputs. */
  addressPlaceholder: string
  /** Default REST port of a self-hosted node, used in Settings hints. */
  nodeRestPort: number
}

// Neutral stub — each brand overrides these values in its brand files.
export const brand: BrandConfig = {
  assetLabel: 'COIN',
  assetName: 'Blockchain',
  productName: 'Wallet',
  tagline: "A quantum-safe home for your coins. Let's set up your wallet.",
  explorerTxUrl: null,
  addressPlaceholder: 'address…',
  nodeRestPort: 9557,
}
