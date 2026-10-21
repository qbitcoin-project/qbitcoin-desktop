import type { NodeEndpoint } from '@qbtc/chain'

// The public node endpoints this build ships. @qbtc/chain carries no URLs of
// its own — which nodes a wallet talks to is a deployment decision, so the
// list lives here and is handed to the chain client at startup.
//
// BRAND FILE: the endpoint list is a brand value - each brand ships its own
// public nodes. QBitcoin ships the project's public Esplora node for
// both networks; users can still add their own in Settings.
export const DEFAULT_NODES: readonly NodeEndpoint[] = [
  {
    name: 'qbitcoin.net',
    url: 'https://api.qbitcoin.net',
    protocol: 'esplora',
    network: 'mainnet',
    operator: 'QBitcoin Project',
    priority: 1,
  },
  {
    name: 'qbitcoin.net',
    url: 'https://api-testnet.qbitcoin.net',
    protocol: 'esplora',
    network: 'testnet',
    operator: 'QBitcoin Project',
    priority: 1,
  },
  // Future community-run Esplora nodes append here.
]
