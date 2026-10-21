import { describe, expect, it } from 'vitest'
import { decodeBase58Check, toHex } from '@qbtc/crypto'
import { DELEGATION } from '../../../src/main/brand/delegation'
import { encodeDelegatePubkeyhash } from '../../../src/main/wallet/delegation'
import { delegatedKeyFixture } from '../../fixtures/delegatedKey'

// BRAND FILE: these values belong to this chain's network parameters.
describe('delegated-key network parameters', () => {
  it('pins the WIF versions and public-hash prefixes', () => {
    expect(DELEGATION).not.toBeNull()
    expect(DELEGATION!.mainnet.wifHash256).toBe(0x8d)
    expect(DELEGATION!.mainnet.wifHash160).toBe(0x8e)
    expect(DELEGATION!.testnet.wifHash256).toBe(0xf0)
    expect(DELEGATION!.testnet.wifHash160).toBe(0xf1)
    expect(toHex(DELEGATION!.mainnet.pubkeyhashMagic)).toBe('2710')
    expect(toHex(DELEGATION!.testnet.pubkeyhashMagic)).toBe('3f00')
  })
  it.each([
    ['mainnet', 32, 0x8d, '6nAfodPCzaqTG4jb3PUP4WFXPeth3xNx1Vr9UPNrLroJzdsY9fJL'],
    ['mainnet', 20, 0x8e, '2CNzaJwvrgHXXg7JgsRZFhiVNvHCkYkPcySC'],
    ['testnet', 32, 0xf0, 'AKYhcgKcge1w2Kvj2hftBRPcyRtVbbcuuWa9BPJ7nSQHYghjfgfj'],
    ['testnet', 20, 0xf1, '2vtmkcmMSBD38qhR5jQUNjJqKuARb3M7PcAw'],
  ] as const)('encodes %s with %i-byte hashes', async (network, length, version, expectedHash) => {
    const { wif, delegate } = await delegatedKeyFixture('ecdsa', length, network)
    const decoded = decodeBase58Check(wif, 1)
    expect(decoded.version[0]).toBe(version)
    decoded.payload.fill(0)
    expect(encodeDelegatePubkeyhash(delegate, network)).toBe(expectedHash)
  })
})
