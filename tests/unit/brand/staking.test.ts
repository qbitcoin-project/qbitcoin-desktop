import { expect, it } from 'vitest'
import { STAKE_MATURITY } from '../../../src/main/brand/staking'

// BRAND TEST: these delays must match the node's chain parameters.
it('pins the staking and slashing maturity delay for each network', () => {
  expect(STAKE_MATURITY).toEqual({ mainnet: 43_200, testnet: 43_200 })
})
