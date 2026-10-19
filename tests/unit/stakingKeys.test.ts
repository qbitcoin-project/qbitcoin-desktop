import { masterKeyFromSeed, mnemonicToSeed } from '@qbtc/crypto'
import { describe, expect, it, vi } from 'vitest'
import { deriveStakingKey, fixedStakingOwners, stakingPath, type StakingOwner } from '../../src/main/wallet/stakingKeys'
import { TEST_STAKING_DERIVATION } from '../fixtures/stakingDerivation'
import type * as brandDelegation from '../../src/main/brand/delegation'

vi.mock('../../src/main/brand/delegation', async (original) => {
  const { TEST_STAKING_DERIVATION } = await import('../fixtures/stakingDerivation')
  return { ...await original<typeof brandDelegation>(), STAKING_DERIVATIONS: [TEST_STAKING_DERIVATION] }
})

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const derivationId = TEST_STAKING_DERIVATION.id

describe('staking owner keys', () => {
  it('lists an ECDSA and a Falcon owner on branch 2 of the account', () => {
    for (const account of [0, 1]) {
      expect(fixedStakingOwners(account)).toEqual([
        { kind: 'hd', derivationId, algo: 'ecdsa', account },
        { kind: 'hd', derivationId, algo: 'falcon512', account },
      ])
    }
    expect(stakingPath({ kind: 'hd', derivationId, algo: 'ecdsa', account: 3 }, 'testnet')).toBe("m/44'/1'/3'/2/0")
    expect(stakingPath({ kind: 'hd', derivationId, algo: 'falcon512', account: 3 }, 'testnet')).toBe("m/512'/1'/3'/2'/0'")
  })

  it('rejects missing or invalid account references without falling back to another path', () => {
    for (const account of [undefined, -1, 0.5, 0x80000000, NaN, Infinity]) {
      expect(() => stakingPath({ kind: 'hd', derivationId, algo: 'ecdsa', account } as StakingOwner, 'testnet')).toThrow(/account/)
      if (account !== undefined) expect(() => fixedStakingOwners(account)).toThrow(/account/)
    }
    expect(stakingPath({ kind: 'hd', derivationId, algo: 'ecdsa', account: 0x7fffffff }, 'testnet')).toBe("m/44'/1'/2147483647'/2/0")
  })

  it.each(['mainnet', 'testnet'] as const)('rejects unknown derivations on %s without falling back to the active one', async (network) => {
    const master = masterKeyFromSeed(mnemonicToSeed(mnemonic))
    try {
      for (const algo of ['ecdsa', 'falcon512'] as const) {
        for (const id of ['staking-owner-v1', 'unknown-version']) {
          const owner = { kind: 'hd', derivationId: id, algo, account: 0 } as StakingOwner
          expect(() => stakingPath(owner, network)).toThrow(/Unknown staking derivation/)
          await expect(deriveStakingKey(master, owner, network)).rejects.toThrow(/Unknown staking derivation/)
        }
      }
    } finally { master.wipePrivateData() }
  })
})
