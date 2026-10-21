// BRAND FILE: this chain's sample values for the shared unit tests.

/** Leading characters of a classical address, per network. */
export const CLASSICAL_PREFIX = { mainnet: 'bq', testnet: 'btq' } as const

// Real classical mainnet addresses (derived from the abandon…about vector), so
// decodeAddress accepts them and produces 20-byte scripthashes.
export const SAMPLE_RECIPIENT = 'bqhHWtW8DUJWfCvik4BgagviXbMyyNBhLnV'
export const SAMPLE_CHANGE = 'bqaghDewzjiedo8mH7whakka5nSgRvT7Wr7'
// A real mainnet Falcon (PQ) address - decodeAddress yields a 32-byte scripthash.
export const SAMPLE_PQ_CHANGE = '3uHLRPLv1MZEPMWqYe73rfLhgzzC35jiD1XsFhcgnveoko1pWLN4'
