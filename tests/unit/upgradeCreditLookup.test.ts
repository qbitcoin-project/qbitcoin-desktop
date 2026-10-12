import type { ChainTx } from '@qbtc/chain'
import { describe, expect, it } from 'vitest'
import { UpgradeCreditLookup, upgradeOutpoint, type UpgradeCreditSource } from '../../src/main/wallet/UpgradeCreditLookup'

const BTC = 'ab'.repeat(32)
const NATIVE = 'cd'.repeat(32)
const HASH = '29'.repeat(32)
const ADDRESS = `native-${HASH}`
const source = (over: Partial<UpgradeCreditSource> = {}): UpgradeCreditSource => ({ txid: BTC, lockVout: 1, destScripthashHex: HASH, confirmed: true, ...over })
const creditTx = (over: Partial<ChainTx> = {}): ChainTx => ({
  txid: NATIVE, version: 3, vin: [], vout: [{ scripthash: HASH, value: 990_000n }], size: 200, fee: 0n,
  status: { confirmed: true, blockHeight: 1234, blockTime: 1700000000 },
  coinbaseInfo: { btcTxid: BTC, btcOutNum: 1, btcBlockHeight: 850100, valueSat: 1000000n },
  ...over,
})

function harness(state: { pages?: Record<string, readonly ChainTx[]>; details?: Record<string, ChainTx>; failAddress?: string } = {}) {
  const reads: { address: string; afterTxid?: string }[] = []
  const detailReads: string[] = []
  const lookup = new UpgradeCreditLookup({
    getAddressTransactions: async (address, afterTxid) => {
      reads.push({ address, afterTxid })
      if (address === state.failAddress) throw new Error('Node unavailable')
      return state.pages?.[`${address}:${afterTxid ?? ''}`] ?? []
    },
    getTransaction: async (txid) => {
      detailReads.push(txid)
      const tx = state.details?.[txid]
      if (tx === undefined) throw new Error('Transaction unavailable')
      return tx
    },
  }, (hash) => `native-${hash}`)
  return { lookup, reads, detailReads }
}

describe('UpgradeCreditLookup', () => {
  it('matches the BTC outpoint and reports only the native amount paid to the destination', async () => {
    const tx = creditTx({ vout: [
      { scripthash: HASH, value: 900_000n },
      { scripthash: HASH, value: 90_000n },
      { scripthash: '30'.repeat(32), value: 10_000n },
      { scripthash: HASH, value: 100n, tokenId: 'token' },
    ] })
    const { lookup } = harness({ pages: { [`${ADDRESS}:`]: [tx] } })
    expect((await lookup.find([source()])).get(upgradeOutpoint(source()))).toEqual({
      state: 'received', txid: NATIVE, amountAtomic: 990_000n, address: ADDRESS,
      blockHeight: 1234, blockTime: 1700000000,
    })
  })

  it.each(['wrong source', 'wrong output', 'wrong destination', 'ordinary transfer', 'unconfirmed'])('does not mistake %s for a completed conversion', async (kind) => {
    const tx = creditTx()
    const candidate = kind === 'wrong source' ? creditTx({ coinbaseInfo: { ...tx.coinbaseInfo!, btcTxid: 'ef'.repeat(32) } })
      : kind === 'wrong output' ? creditTx({ coinbaseInfo: { ...tx.coinbaseInfo!, btcOutNum: 0 } })
      : kind === 'wrong destination' ? creditTx({ vout: [{ scripthash: '30'.repeat(32), value: 990_000n }] })
      : kind === 'ordinary transfer' ? creditTx({ version: 1 })
      : creditTx({ status: { confirmed: false } })
    const { lookup } = harness({ pages: { [`${ADDRESS}:`]: [candidate] } })
    expect((await lookup.find([source()])).get(upgradeOutpoint(source()))).toEqual({ state: 'pending' })
  })

  it('finds older credits after unrelated transactions, including credits whose outputs were spent', async () => {
    const newer = creditTx({ txid: 'newer', version: 1 })
    const { lookup, reads } = harness({ pages: {
      [`${ADDRESS}:`]: [newer],
      [`${ADDRESS}:newer`]: [creditTx()],
    } })
    expect((await lookup.find([source()])).get(upgradeOutpoint(source()))?.state).toBe('received')
    expect(reads).toEqual([{ address: ADDRESS, afterTxid: undefined }, { address: ADDRESS, afterTxid: 'newer' }])
  })

  it('shares an address scan between conversions and hydrates missing provenance from transaction details', async () => {
    const otherBtc = 'ef'.repeat(32)
    const second = source({ txid: otherBtc })
    const tx2 = creditTx({ txid: 'second', coinbaseInfo: { ...creditTx().coinbaseInfo!, btcTxid: otherBtc } })
    const { lookup, reads, detailReads } = harness({
      pages: { [`${ADDRESS}:`]: [creditTx({ coinbaseInfo: undefined }), tx2] },
      details: { [NATIVE]: creditTx() },
    })
    const results = await lookup.find([source(), second])
    expect(results.get(upgradeOutpoint(source()))?.state).toBe('received')
    expect(results.get(upgradeOutpoint(second))?.state).toBe('received')
    expect(reads).toHaveLength(1)
    expect(detailReads).toEqual([NATIVE])
  })

  it.each([20, 32])('supports a %i-byte destination without relying on wallet address discovery', async (length) => {
    const hash = '12'.repeat(length)
    const external = source({ destScripthashHex: hash })
    const { lookup } = harness({ pages: { [`native-${hash}:`]: [creditTx({ vout: [{ scripthash: hash, value: 990_000n }] })] } })
    expect((await lookup.find([external])).get(upgradeOutpoint(external))).toMatchObject({ state: 'received', address: `native-${hash}` })
  })

  it('leaves a source transaction in the mempool pending without querying native history', async () => {
    const pending = source({ confirmed: false })
    const { lookup, reads } = harness()
    expect((await lookup.find([pending])).get(upgradeOutpoint(pending))).toEqual({ state: 'pending' })
    expect(reads).toEqual([])
  })

  it.each([null, 'invalid'])('reports an unavailable credit status for an unresolved destination (%s)', async (destScripthashHex) => {
    const episode = source({ destScripthashHex })
    const { lookup, reads } = harness()
    expect((await lookup.find([episode])).get(upgradeOutpoint(episode))).toEqual({ state: 'unavailable' })
    expect(reads).toEqual([])
  })

  it('isolates a failed destination lookup from other successfully matched conversions', async () => {
    const otherHash = '34'.repeat(32)
    const other = source({ txid: 'other', destScripthashHex: otherHash })
    const { lookup } = harness({ pages: { [`${ADDRESS}:`]: [creditTx()] }, failAddress: `native-${otherHash}` })
    const results = await lookup.find([source(), other])
    expect(results.get(upgradeOutpoint(source()))?.state).toBe('received')
    expect(results.get(upgradeOutpoint(other))).toEqual({ state: 'unavailable' })
  })

  it('does not report a missing credit as pending when transaction details could not be read', async () => {
    const { lookup } = harness({ pages: { [`${ADDRESS}:`]: [creditTx({ coinbaseInfo: undefined })] } })
    expect((await lookup.find([source()])).get(upgradeOutpoint(source()))).toEqual({ state: 'unavailable' })
  })

  it('stops a repeated history cursor without claiming the search was complete', async () => {
    const unrelated = creditTx({ txid: 'repeated', version: 1 })
    const { lookup, reads } = harness({ pages: { [`${ADDRESS}:`]: [unrelated], [`${ADDRESS}:repeated`]: [unrelated] } })
    expect((await lookup.find([source()])).get(upgradeOutpoint(source()))).toEqual({ state: 'unavailable' })
    expect(reads).toHaveLength(2)
  })

  it('rechecks the chain on refresh instead of retaining a credit removed by a reorg', async () => {
    const state = { pages: { [`${ADDRESS}:`]: [creditTx()] } }
    const { lookup } = harness(state)
    expect((await lookup.find([source()])).get(upgradeOutpoint(source()))?.state).toBe('received')
    state.pages[`${ADDRESS}:`] = []
    expect((await lookup.find([source()])).get(upgradeOutpoint(source()))).toEqual({ state: 'pending' })
  })
})
