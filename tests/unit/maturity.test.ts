import { describe, expect, it, vi } from 'vitest'
import type { ChainTx } from '@qbtc/chain'
import { withMaturity } from '../../src/main/wallet/maturity'
import { isMature } from '../../src/shared/maturity'
import { STAKE_MATURITY } from '../../src/main/brand/staking'
import type { GatheredUtxo } from '../../src/main/wallet/spendable'

const blockTime = 1_700_000_000
const coin = (txid: string, vout = 0): GatheredUtxo => ({ txid, vout, value: 1_000_000n, address: 'addr', algo: 'ecdsa', chain: 0, index: 0, confirmed: true })
const tx = (txid: string, version = 1, time: number | undefined = blockTime): ChainTx => ({
  txid, version, vin: [], vout: [], size: 200, fee: 0n, status: { confirmed: true, blockTime: time },
})

describe('source output maturity', () => {
  it.each(['mainnet', 'testnet'] as const)('uses funding block time for both stake and slashing on %s', async (network) => {
    const backend = { getTransaction: vi.fn(async (id: string) => tx(id, id === 'stake' ? 2 : 5)) }
    const coins = await withMaturity([coin('stake'), coin('stake', 1), coin('slash')], backend, network)
    expect(backend.getTransaction).toHaveBeenCalledTimes(2)
    for (const c of coins) {
      expect(c.maturesAt).toBe(blockTime + STAKE_MATURITY[network])
      expect(isMature(c, c.maturesAt! - 1)).toBe(false)
      expect(isMature(c, c.maturesAt)).toBe(true)
    }
  })

  it.each([1, 3, 4, 6, 7, 8])('does not delay transaction type %i, including mempool outputs', async (version) => {
    const [c] = await withMaturity([coin('ordinary')], { getTransaction: async (id) => ({ ...tx(id, version), status: { confirmed: false } }) }, 'mainnet')
    expect(c?.maturesAt).toBeUndefined()
    expect(isMature(c!)).toBe(true)
  })

  it('fails closed for missing, mismatched or unknown source data', async () => {
    for (const source of [tx('wrong-id'), tx('id', 0), tx('id', NaN), tx('id', 9),
      { ...tx('id', 2), status: { confirmed: false } },
      { ...tx('id', 5), status: { confirmed: true } }, tx('id', 2, NaN), tx('id', 2, 0)]) {
      const [c] = await withMaturity([coin('id')], { getTransaction: async () => source }, 'mainnet')
      expect(c?.maturityUnknown).toBe(true)
      expect(isMature(c!)).toBe(false)
    }
    const [c] = await withMaturity([coin('id')], { getTransaction: async () => { throw new Error('offline') } }, 'mainnet')
    expect(c?.maturityUnknown).toBe(true)
  })

  it('limits concurrent source lookups while retaining every output', async () => {
    let active = 0
    let peak = 0
    const coins = Array.from({ length: 25 }, (_, i) => coin(String(i)))
    const result = await withMaturity(coins, { getTransaction: async (id) => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return tx(id)
    } }, 'mainnet')
    expect(peak).toBeLessThanOrEqual(8)
    expect(result).toEqual(coins)
  })
})
