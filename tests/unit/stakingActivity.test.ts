import type { ChainTx, ChainTxIn, ChainTxOut } from '@qbtc/chain'
import { describe, expect, it, vi } from 'vitest'
import { decodeAddress } from '../../src/main/crypto'
import { stakingChainActivity } from '../../src/main/wallet/stakingActivity'
import { StakingHistory } from '../../src/main/wallet/StakingHistory'
import { mergeStakingActivity } from '../../src/renderer/lib/stakingView'
import type { StakingChainActivity, StakingOperationView } from '../../src/shared/staking'
import { chainTx, stakingFixture } from '../fixtures/staking'
import type * as brandDelegation from '../../src/main/brand/delegation'

// Delegated keys run on test prefixes, so this test passes in every brand.
vi.mock('../../src/main/brand/delegation', async (original) => {
  const { TEST_DELEGATION } = await import('../fixtures/delegationPrefixes')
  return { ...await original<typeof brandDelegation>(), DELEGATION: TEST_DELEGATION }
})

const address = 'staking-owner', hash = 'ab'.repeat(20)
const input = (value: bigint, patch: Partial<ChainTxIn> = {}): ChainTxIn => ({ txid: 'previous', vout: 0, prevoutValue: value, prevoutAddress: address, prevoutScripthash: hash, ...patch })
const output = (value: bigint, patch: Partial<ChainTxOut> = {}): ChainTxOut => ({ value, address, scripthash: hash, ...patch })
const tx = (id: string, patch: Partial<ChainTx> = {}): ChainTx => chainTx(id, {
  status: { confirmed: true, blockHash: `block-${id}`, blockHeight: 100, blockTime: 1700000000 },
  vin: [input(1000000n, { prevoutAddress: 'ordinary', prevoutScripthash: 'other' })],
  vout: [output(100000n)], ...patch,
})
const project = (patch: Partial<ChainTx> = {}) => stakingChainActivity(address, hash, tx('deposit', patch))

describe('confirmed staking movements', () => {
  it('sums all deposit outputs at the address, ignoring ordinary change and other owners', () => {
    expect(project({ vout: [output(100000n), output(200000n), output(700000n, { address: 'other', scripthash: 'other' })] }))
      .toMatchObject({ kind: 'deposit', balanceChangeAtomic: '300000', createdAt: 1700000000000, blockHeight: 100 })
  })
  it('recognizes the covenant hash when decoded addresses are absent', () => {
    expect(project({ vin: [input(300000n, { prevoutAddress: undefined })], vout: [output(199997n, { address: undefined })], fee: 3n }))
      .toMatchObject({ kind: 'withdrawal', balanceChangeAtomic: '-100003', feeAtomic: '3' })
  })
  it('shows only the owner reward, excluding restaked principal and the service output', () => {
    expect(project({ version: 2, vin: [input(10000000n)], vout: [output(10000900n), output(100n, { address: 'service', scripthash: 'other' })], fee: -1000n }))
      .toMatchObject({ kind: 'stake', balanceChangeAtomic: '900', feeAtomic: undefined })
  })
  it('accounts for full withdrawal and slashing as negative address changes', () => {
    expect(project({ vin: [input(500000n)], vout: [], fee: 3n })).toMatchObject({ kind: 'withdrawal', balanceChangeAtomic: '-500000' })
    expect(project({ version: 5, vin: [input(500000n)], vout: [output(450000n)] })).toMatchObject({ kind: 'slashing', balanceChangeAtomic: '-50000' })
  })
  it('does not mislabel a self-transfer as a new deposit', () => {
    expect(project({ vin: [input(100000n)], vout: [output(100000n)] })).toMatchObject({ kind: 'transaction', balanceChangeAtomic: '0' })
  })
  it.each([
    { prevoutValue: undefined },
    { prevoutAddress: undefined, prevoutScripthash: undefined },
  ])('keeps amounts and direction unknown with missing previous-output data: %j', (patch) => {
    expect(project({ vin: [input(200000n, patch)] })).toMatchObject({ kind: 'transaction', balanceChangeAtomic: undefined })
  })
  it('keeps token quantities separate from native coin fees and supports multiple tokens', () => {
    const observed = project({ version: 4, vin: [input(0n, { prevoutTokenId: 'token-a', prevoutTokenAmount: 50n })],
      vout: [output(0n, { tokenId: 'token-a', tokenAmount: 10n }), output(0n, { tokenId: 'token-b', tokenAmount: 7n })] })
    expect(observed).toMatchObject({ kind: 'transaction', balanceChangeAtomic: '0', tokenChanges: [{ id: 'token-a', amountAtomic: '-40' }, { id: 'token-b', amountAtomic: '7' }] })
    expect(project({ vout: [output(0n, { tokenId: 'token-a' })] }).tokenChanges).toEqual([{ id: 'token-a', amountAtomic: undefined }])
  })
  it('does not invent a date if the node omits block time', () => {
    expect(project({ status: { confirmed: true } }).createdAt).toBeUndefined()
  })
})

describe('history discovery and reorgs', () => {
  it('backfills all compact observations, deduplicates page overlaps, and excludes mempool entries', async () => {
    const pages = Array.from({ length: 9 }, (_, index) => tx(String(index)))
    const reader = { getAddressTransactions: vi.fn(async (_address: string, cursor?: string) => cursor === undefined
      ? [tx('pending', { status: { confirmed: false } }), pages[0]!]
      : pages[Number(cursor) + 1] ? [pages[Number(cursor)]!, pages[Number(cursor) + 1]!] : []) }
    const history = new StakingHistory(reader, () => {})
    expect(await history.read(address, hash)).toMatchObject({ complete: false, activity: expect.any(Array) })
    expect(reader.getAddressTransactions).toHaveBeenCalledTimes(4)
    for (let n = 0; n < 6; n++) await history.read(address, hash)
    const complete = await history.read(address, hash)
    expect(complete.complete).toBe(true)
    expect(complete.activity.map((entry) => entry.txid)).toEqual(pages.map((entry) => entry.txid))
    expect(JSON.stringify(complete.activity)).not.toContain('vin')
    reader.getAddressTransactions.mockClear()
    expect((await history.read(address, hash)).activity).toEqual(complete.activity)
    expect(reader.getAddressTransactions).toHaveBeenCalledTimes(1)
  })
  it('removes orphaned observations, handles re-inclusion and clears history on an empty chain', async () => {
    let pages = [tx('old'), tx('older')]
    const history = new StakingHistory({ getAddressTransactions: async (_address, cursor) => cursor === undefined ? pages : [] }, () => {})
    expect((await history.read(address, hash)).activity).toHaveLength(2)
    pages = [tx('replacement')]
    expect((await history.read(address, hash)).activity.map((entry) => entry.txid)).toEqual(['replacement'])
    pages = [tx('old', { status: { confirmed: true, blockHash: 'new-block', blockTime: 1800000000 } })]
    expect((await history.read(address, hash)).activity[0]).toMatchObject({ txid: 'old', createdAt: 1800000000000 })
    pages = []
    expect(await history.read(address, hash)).toMatchObject({ activity: [], complete: true })
  })
  it('does not claim completeness when pagination repeats the same page', async () => {
    const history = new StakingHistory({ getAddressTransactions: async () => [tx('repeat')] }, () => {})
    expect(await history.read(address, hash)).toMatchObject({ complete: false, activity: [expect.objectContaining({ txid: 'repeat' })] })
    expect((await history.read(address, hash)).complete).toBe(false)
  })
  it('rebuilds after restart without writing observations to the journal or signing', async () => {
    const f = stakingFixture(), stakingAddress = (await f.service.addresses())[0]!.address
    const values = [1000000n, 1000000n, 200000n, 100000n]
    const entries = values.map((value, index) => tx(String(index), { vout: [output(value, { address: stakingAddress })] }))
    f.history.set(stakingAddress, entries)
    f.unspent.set(stakingAddress, entries.map((entry, index) => ({ txid: entry.txid, vout: 0, value: values[index]!, status: { confirmed: true } })))
    for (const entry of entries) f.transactions.set(entry.txid, entry)
    vi.mocked(f.store.save).mockClear()
    const snapshot = await f.service.refresh()
    expect(snapshot.addresses[0]?.balanceAtomic).toBe('2300000')
    expect(snapshot.chainActivity?.map((entry) => entry.balanceChangeAtomic)).toEqual(['1000000', '1000000', '200000', '100000'])
    expect(snapshot.operations).toEqual([])
    expect((await f.make().refresh()).chainActivity).toEqual(snapshot.chainActivity)
    expect(f.data().operations).toEqual([])
    expect(f.store.save).not.toHaveBeenCalled()
    expect(f.wallet.signFunding).not.toHaveBeenCalled()
    expect(f.reader.broadcastTransaction).not.toHaveBeenCalled()
    expect(await f.service.reservedOutpoints()).toEqual(new Set())
  })
  it('hides unverified cached observations during a read failure and recovers on refresh', async () => {
    const f = stakingFixture(), stakingAddress = (await f.service.addresses())[0]!.address
    f.history.set(stakingAddress, [tx('deposit', { vout: [output(100000n, { address: stakingAddress })] })])
    expect((await f.service.refresh()).chainActivity).toHaveLength(1)
    vi.mocked(f.reader.getAddressTransactions).mockRejectedValueOnce(new Error('Offline'))
    const failed = await f.service.refresh()
    expect(failed.addresses[0]?.stale).toBe(true)
    expect(failed.chainActivity).toEqual([])
    expect((await f.service.refresh()).chainActivity).toHaveLength(1)
  })
  it('passes a covenant hash to discovery so an address-less output is still recognized', async () => {
    const f = stakingFixture(), stakingAddress = (await f.service.addresses())[0]!.address
    const sh = Buffer.from(decodeAddress(stakingAddress).scripthash).toString('hex')
    f.history.set(stakingAddress, [tx('deposit', { vout: [output(100000n, { address: undefined, scripthash: sh })] })])
    expect((await f.service.refresh()).chainActivity?.[0]?.balanceChangeAtomic).toBe('100000')
  })
})

describe('merged activity', () => {
  const local = (patch: Partial<StakingOperationView> = {}): StakingOperationView => ({
    id: 'local', address, txid: 'deposit', kind: 'funding', state: 'confirmed', amountAtomic: '100000', feeAtomic: '3', destination: address, createdAt: 1700000000000, ...patch,
  })
  it('fills the missing 0.001 deposit while keeping journal entries, retries and recovery relationships intact', () => {
    const operations = [local({ id: 'a', txid: 'a', amountAtomic: '200000' }), local({ id: 'b', txid: 'b', amountAtomic: '1000000' }), local({ id: 'c', txid: 'c', amountAtomic: '1000000' })]
    const observed = ['a', 'b', 'c', 'missing'].map((id) => stakingChainActivity(address, hash, tx(id)))
    const merged = mergeStakingActivity(operations, observed)
    expect(merged).toHaveLength(4)
    expect(merged).toContain(operations[0])
    expect(merged).toContain(observed[3])
    const pending = local({ state: 'pending', autoRetry: false, recoveryOf: 'original' })
    expect(mergeStakingActivity([pending], [project()])).toEqual([pending])
  })
  it('deduplicates by transaction and address, retains both sides of a transfer between keys, and sorts unknown dates last', () => {
    const first = project(), second: StakingChainActivity = { ...first, id: 'other-owner', address: 'other-owner', createdAt: undefined }
    const operation = local()
    expect(mergeStakingActivity([operation], [first, first, second])).toEqual([operation, second])
    expect(mergeStakingActivity([], [first, first])).toEqual([first])
    expect(mergeStakingActivity([local({ id: 'older', createdAt: 1 }), local({ id: 'newer', createdAt: 3 })], [{ ...first, createdAt: 2, txid: 'other' }]).map((item) => item.id))
      .toEqual(['newer', first.id, 'older'])
  })
})
