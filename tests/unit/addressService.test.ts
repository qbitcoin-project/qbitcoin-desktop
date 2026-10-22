import { masterKeyFromSeed, mnemonicToSeed } from '@qbtc/crypto'
import { activeScheme } from '../../src/main/crypto'
import { describe, expect, it, vi } from 'vitest'
import { AddressService, type WalletVault } from '../../src/main/wallet/AddressService'
import { WalletMetaStore } from '../../src/main/wallet/meta'
import { CLASSICAL_PREFIX } from './brand/fixtures'
import type * as brandDelegation from '../../src/main/brand/delegation'

// Delegated keys run on test prefixes, so this test passes in every brand.
vi.mock('../../src/main/brand/delegation', async (original) => {
  const { TEST_DELEGATION } = await import('../fixtures/delegationPrefixes')
  return { ...await original<typeof brandDelegation>(), DELEGATION: TEST_DELEGATION }
})

const MASTER = masterKeyFromSeed(mnemonicToSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'))

// In-memory blob store + identity sealer. The real sealing is the Vault's job
// (covered by the crypto package); here we exercise index bookkeeping + the
// derivation wiring.
function fakes() {
  let blob: string | null = null
  const store = {
    read: async () => blob,
    write: async (b: string) => {
      blob = b
    },
  }
  const sealer = { sealData: async (p: string) => p, openData: async (b: string) => b }
  const vault: WalletVault = { getMasterKey: () => Promise.resolve(MASTER), on: () => () => {} }
  const service = new AddressService(vault, new WalletMetaStore(store, sealer), 'mainnet')
  return { service, readBlob: () => blob }
}

describe('AddressService', () => {
  it('returns a stable receive address at index 0 by default', async () => {
    const { service } = fakes()
    const a = await service.getReceiveAddress()
    const b = await service.getReceiveAddress()
    expect(a).toBe(b)
    expect(a.startsWith(CLASSICAL_PREFIX.mainnet)).toBe(true)
  })

  it('advances and persists the index on a new address', async () => {
    const { service, readBlob } = fakes()
    const first = await service.getReceiveAddress()
    const second = await service.getNewReceiveAddress()
    expect(second).not.toBe(first)
    // Indices are persisted per scheme (v2 meta); fresh addresses advance the ACTIVE one.
    expect(JSON.parse(readBlob()!)).toEqual({
      version: 2,
      schemes: { [activeScheme().id]: { receiveIndex: 1, changeIndex: 0, pqReceiveIndex: 0, pqChangeIndex: 0 } },
    })
    // The current receive address is now the advanced one.
    expect(await service.getReceiveAddress()).toBe(second)
  })

  it('lists every surfaced receive address with the current one flagged', async () => {
    const { service } = fakes()
    const first = await service.getReceiveAddress()
    const second = await service.getNewReceiveAddress()
    expect(await service.listReceiveAddresses()).toEqual([
      { address: first, index: 0, current: false },
      { address: second, index: 1, current: true },
    ])
  })

  it('refuses schnorr — HD wallets have no Schnorr branch', async () => {
    const { service } = fakes()
    await expect(service.getReceiveAddress('schnorr')).rejects.toThrow(/no Schnorr branch/)
    await expect(service.getNewReceiveAddress('schnorr')).rejects.toThrow(/no Schnorr branch/)
    await expect(service.listReceiveAddresses('schnorr')).rejects.toThrow(/no Schnorr branch/)
  })
})

// Change allocations must remain discoverable from only the seed, even after
// rejected sends and durable reservations from uncertain broadcasts.
it.each(['ecdsa', 'falcon512'] as const)('fills %s holes and refuses to issue beyond the recoverable pending gap', async (algo) => {
  const { deriveClassicalAddress, deriveFalconAddress } = await import('../../src/main/wallet/addresses')
  const { discoverChain, GAP_LIMIT_CHANGE } = await import('../../src/main/wallet/discovery')
  const { ZERO_STATS } = await import('../fixtures/staking')
  let blob: string | null = null
  const meta = new WalletMetaStore({ read: async () => blob, write: async (s) => { blob = s } }, { openData: async (s) => s, sealData: async (s) => s })
  const reserved = new Set<string>(), used = new Set<string>(), mempool = new Set<string>()
  const vault: WalletVault = { getMasterKey: async () => MASTER, on: () => () => {} }
  const lookup = { getAddressInfo: async (address: string) => ({ address, chain: { ...ZERO_STATS, fundedTxCount: used.has(address) ? 1 : 0 }, mempool: { ...ZERO_STATS, fundedTxCount: mempool.has(address) ? 1 : 0 }, tokens: {} }) }
  const create = () => new AddressService(vault, meta, 'testnet', 0, { lookup, reserved: async () => reserved, check: () => {} })
  const service = create()
  const address = () => algo === 'ecdsa' ? service.getChangeAddress() : service.getPqChangeAddress()
  const first = await address()
  for (let rejected = 0; rejected < 8; rejected++) {
    await service.recordChangeAddress(algo, await address())
    expect(await address()).toBe(first)
  }
  for (let pending = 0; pending < GAP_LIMIT_CHANGE; pending++) {
    const next = await address()
    expect(reserved.has(next)).toBe(false)
    reserved.add(next)
    mempool.add(next)
    await service.recordChangeAddress(algo, next)
  }
  const restored = create()
  await expect(algo === 'ecdsa' ? restored.getChangeAddress() : restored.getPqChangeAddress()).rejects.toThrow(/recoverable/)
  // Even accepted mempool changes cannot extend the gap until they confirm.
  mempool.clear()
  await expect(address()).rejects.toThrow(/recoverable/)
  reserved.delete(first)
  expect(await address()).toBe(first)
  used.add(first)
  const derive = (chain: 0 | 1, index: number) => (algo === 'ecdsa' ? deriveClassicalAddress : deriveFalconAddress)(MASTER, { account: 0, chain, index, network: 'testnet' })
  const lastPending = [...reserved].at(-1)!
  used.add(lastPending)
  const fromSeed = await discoverChain(derive, lookup, 1, 0, GAP_LIMIT_CHANGE)
  expect(fromSeed.some((a) => a.address === lastPending)).toBe(true)
  const next = await address()
  expect(reserved.has(next)).toBe(false)
  expect(fromSeed.some((a) => a.address === next)).toBe(true)
})
