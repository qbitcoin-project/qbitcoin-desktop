import { afterEach, describe, expect, it, vi } from 'vitest'
import * as crypto from '@qbtc/crypto'
import { decodeWif, encodeWif } from '../../src/main/crypto'
import { PROFILE } from '../../src/main/brand/profile'
import { decodeWalletWif } from '../../src/main/wallet/keyWif'
import { importedKeyFromStored, importedKeyFromWif } from '../../src/main/wallet/keyWallet'
import { encodeDelegatePubkeyhash } from '../../src/main/wallet/delegation'
import { delegatedKeyFixture } from '../fixtures/delegatedKey'
import type * as brandDelegation from '../../src/main/brand/delegation'

// Delegated keys run on test prefixes, so this test passes in every brand.
vi.mock('../../src/main/brand/delegation', async (original) => {
  const { TEST_DELEGATION } = await import('../fixtures/delegationPrefixes')
  return { ...await original<typeof brandDelegation>(), DELEGATION: TEST_DELEGATION }
})

vi.mock('@qbtc/crypto', async (original) => {
  const actual = await original<typeof crypto>()
  return { ...actual, decodeBase58Check: vi.fn(actual.decodeBase58Check) }
})
afterEach(() => vi.clearAllMocks())

describe('single-pass wallet WIF decoding', () => {
  it.each(['mainnet', 'testnet'] as const)('preserves ordinary validation on %s', (network) => {
    const version = Uint8Array.of(PROFILE.wifVersion[network])
    const cases = [
      encodeWif(new Uint8Array(32).fill(1), network),
      encodeWif(new Uint8Array(32).fill(1), network === 'mainnet' ? 'testnet' : 'mainnet'),
      crypto.encodeBase58Check(version, new Uint8Array(32)),
      crypto.encodeBase58Check(version, new Uint8Array(32).fill(255)),
      crypto.encodeBase58Check(version, new Uint8Array(33).fill(1)),
      crypto.encodeBase58Check(version, new Uint8Array(31).fill(1)),
      crypto.encodeBase58Check(Uint8Array.of(1), new Uint8Array(32).fill(1)),
    ]
    for (const wif of cases) {
      let expected: crypto.DecodedWif
      try { expected = decodeWif(wif, network) }
      catch (error) {
        expect(() => decodeWalletWif(wif, network)).toThrow((error as Error).message)
        continue
      }
      const actual = decodeWalletWif(` ${wif}\n`, network)
      expect(actual).toEqual(expected)
      expected.payload.fill(0); actual.payload.fill(0)
    }
  })

  it.each([false, true])('decodes a Falcon WIF once, including during materialization (delegated=%s)', async (delegated) => {
    const fixture = await delegatedKeyFixture()
    let wif = fixture.wif
    if (!delegated) {
      const decoded = decodeWalletWif(wif, 'mainnet')
      wif = encodeWif(decoded.payload, 'mainnet')
      decoded.payload.fill(0)
    }
    vi.clearAllMocks()
    const key = await importedKeyFromWif(wif, 'mainnet')
    try {
      expect(crypto.decodeBase58Check).toHaveBeenCalledTimes(1)
      // The envelope buffer belongs to the decoder and is erased on success.
      const raw = vi.mocked(crypto.decodeBase58Check).mock.results[0]!.value as ReturnType<typeof crypto.decodeBase58Check>
      expect(raw.payload.every((b) => b === 0)).toBe(true)
    } finally { key.privateKey.fill(0) }
  })

  it('cross-checks saved public delegate metadata against WIF before using the key', async () => {
    const { wif, delegate } = await delegatedKeyFixture('ecdsa')
    const stored = { wif, algo: 'ecdsa' as const, address: '', delegatePubkeyhash: encodeDelegatePubkeyhash(delegate, 'mainnet') }
    const key = await importedKeyFromStored(stored, 'mainnet')
    key.privateKey.fill(0)
    await expect(importedKeyFromStored({ ...stored, delegatePubkeyhash: 'different-delegate' }, 'mainnet')).rejects.toThrow(/delegate mismatch/)
    const ordinary = encodeWif(new Uint8Array(32).fill(1), 'mainnet')
    await expect(importedKeyFromStored({ ...stored, wif: ordinary }, 'mainnet')).rejects.toThrow(/delegate mismatch/)
  })
})
