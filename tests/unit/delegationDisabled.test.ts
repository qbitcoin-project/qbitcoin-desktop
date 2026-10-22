import { encodeBase58Check } from '@qbtc/crypto'
import { describe, expect, it, vi } from 'vitest'
import { encodeWif } from '../../src/main/crypto'
import { encodeDelegatePubkeyhash } from '../../src/main/wallet/delegation'
import { decodeWalletWif } from '../../src/main/wallet/keyWif'
import { stakingFixture } from '../fixtures/staking'
import type * as brandDelegation from '../../src/main/brand/delegation'

// A brand that ships no delegated keys: every delegation value is switched off.
vi.mock('../../src/main/brand/delegation', async (original) => ({
  ...await original<typeof brandDelegation>(), DELEGATION: null, DELEGATE_PROFILES: [], STAKING_DERIVATIONS: [],
}))

const key = new Uint8Array(32).fill(1)

describe('a build without delegated keys', () => {
  it('rejects a delegated WIF as an unknown version', () => {
    const wif = encodeBase58Check(Uint8Array.of(0x8d), new Uint8Array([...key, ...new Uint8Array(32).fill(2)]))
    expect(() => decodeWalletWif(wif, 'mainnet')).toThrow(/Unknown WIF version byte 0x8d/)
  })

  it('still decodes an ordinary WIF', () => {
    const decoded = decodeWalletWif(encodeWif(key, 'mainnet'), 'mainnet')
    expect(decoded.payload).toEqual(key)
    expect(decoded.delegatePubkeyhash).toBeUndefined()
  })

  it('refuses to encode a delegate pubkeyhash', () => {
    expect(() => encodeDelegatePubkeyhash(new Uint8Array(20), 'mainnet')).toThrow('Delegated keys are not available in this build.')
  })

  it('keeps Staking hidden', async () => {
    const f = stakingFixture({ profiles: [] })
    expect(await f.service.info()).toMatchObject({ enabled: false, fundingEnabled: false })
  })
})
