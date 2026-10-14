import { describe, expect, it } from 'vitest'
import { encodeWif } from '../../src/main/brand/crypto'
import { importedKeyFromStored } from '../../src/main/wallet/keyWallet'
import { encodeDelegatePubkeyhash } from '../../src/main/wallet/delegation'
import { delegatedKeyFixture } from '../fixtures/delegatedKey'

describe('saved public key metadata', () => {
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
