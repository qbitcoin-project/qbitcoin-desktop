import { expect, it } from 'vitest'
import { DELEGATE_PROFILES, STAKING_DERIVATIONS } from '../../../src/main/brand/delegation'
import { STAKE_MATURITY } from '../../../src/main/brand/staking'

// BRAND TEST: these delays must match the node's chain parameters.
it('pins the staking and slashing maturity delay for each network', () => {
  expect(STAKE_MATURITY).toEqual({ mainnet: 43_200, testnet: 43_200 })
})

// BRAND TEST: no staking service is configured yet, so seed wallets
// derive no staking owner keys and delegation funding stays unavailable.
it('ships no staking derivations or delegate profiles', () => {
  expect(STAKING_DERIVATIONS).toEqual([])
  expect(DELEGATE_PROFILES).toEqual([])
})
