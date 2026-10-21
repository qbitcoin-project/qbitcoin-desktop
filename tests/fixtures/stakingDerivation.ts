import type { StakingDerivation } from '../../src/main/wallet/delegationTypes'

// Staking derivation for brand-independent tests. Shared code ships none;
// each brand pins its own values in tests/unit/brand/staking.test.ts.
export const TEST_STAKING_DERIVATION: StakingDerivation = {
  id: 'staking-owner-v2', schemeId: 'test-staking-scheme', coinType: { mainnet: 0, testnet: 1 },
  falconHdInfo: 'test/pq/falcon512/v1', active: true,
}
