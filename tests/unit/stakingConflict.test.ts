import { ChainError } from '@qbtc/chain'
import { describe, expect, it, vi } from 'vitest'
import { SpendCoordinator } from '../../src/main/wallet/SpendCoordinator'
import { chainTx, stakingFixture } from '../fixtures/staking'

async function conflicted(kind: 'funding' | 'withdrawal') {
  const f = stakingFixture()
  const address = (await f.service.addresses())[0]!.address
  const source = 'bb'.repeat(32), competitor = 'cc'.repeat(32)
  f.transactions.set(source, chainTx(source))
  f.unspent.set(address, [{ txid: source, vout: 0, value: 200000000n, status: { confirmed: true } }])
  const preview = kind === 'funding'
    ? await f.service.buildFunding({ algo: 'ecdsa', amountAtomic: '10000000' })
    : await f.service.buildWithdrawal({ address, amountAtomic: '10000000' })
  await f.service.confirm(preview.draftId)
  const original = f.data().operations[0]!, input = original.unsigned.inputs[0]!
  const outpoint = `${input.prevTxid}:${input.vout}`
  // A validator stake can win the race with an ordinary withdrawal.
  f.transactions.set(competitor, chainTx(competitor, { version: kind === 'withdrawal' ? 2 : 1 }))
  f.spent.set(outpoint, { spent: true, txid: competitor })
  await f.service.refresh()
  expect(f.data().operations[0]).toMatchObject({ state: 'conflict', autoRetry: false })
  expect((await f.service.reservedOutpoints()).size).toBe(0)
  return { ...f, original, competitor, outpoint }
}

describe.each(['funding', 'withdrawal'] as const)('%s conflicts after a reorg', (kind) => {
  it.each(['confirmed', 'pending', 'absent', 'pending competitor'] as const)('observes the original becoming %s after restart, without signing or broadcasting', async (state) => {
    const f = await conflicted(kind)
    f.transactions.delete(f.competitor)
    f.spent.clear()
    if (state === 'absent' || state === 'pending competitor') f.transactions.delete(f.original.txid!)
    else f.transactions.set(f.original.txid!, chainTx(f.original.txid!, { status: { confirmed: state === 'confirmed', blockHeight: 100 } }))
    if (state === 'pending competitor') {
      f.transactions.set(f.competitor, chainTx(f.competitor, { status: { confirmed: false } }))
      f.spent.set(f.outpoint, { spent: true, txid: f.competitor })
    }
    f.reader.getBlockchainInfo = async () => ({ tipHeight: 100 })
    vi.mocked(f.wallet.signFunding).mockClear()
    vi.mocked(f.wallet.keypair).mockClear()
    const restarted = f.make(new SpendCoordinator())
    await restarted.refresh()
    expect(f.data().operations[0]).toMatchObject({ state: state === 'confirmed' ? 'confirmed' : 'pending',
      settled: false, autoRetry: false, rawHex: f.original.rawHex, txid: f.original.txid })
    expect((await restarted.reservedOutpoints()).has(f.outpoint)).toBe(true)
    await expect(restarted.assertOrdinaryInputs(f.original.unsigned)).rejects.toThrow()
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
    expect(f.wallet.signFunding).not.toHaveBeenCalled()
    expect(f.wallet.keypair).not.toHaveBeenCalled()
    if (state === 'confirmed') {
      f.reader.getBlockchainInfo = async () => ({ tipHeight: 105 })
      await restarted.refresh()
      expect((await restarted.reservedOutpoints()).size).toBe(0)
      expect(f.data().operations[0]!.settled).toBe(true)
    }
  })

  it('continues observing an unchanged confirmed competitor without rewriting the journal or submitting', async () => {
    const f = await conflicted(kind)
    vi.mocked(f.store.save).mockClear()
    vi.mocked(f.reader.getOutspend).mockClear()
    await f.service.refresh()
    await f.service.refresh()
    expect(f.reader.getOutspend).toHaveBeenCalledTimes(2)
    expect(f.store.save).not.toHaveBeenCalled()
    expect(f.data().operations[0]!.state).toBe('conflict')
    expect((await f.service.reservedOutpoints()).size).toBe(0)
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
  })

  it.each(['transaction', 'outspend'] as const)('reserves again and pauses on a failed %s lookup', async (lookup) => {
    const f = await conflicted(kind)
    if (lookup === 'transaction') vi.mocked(f.reader.getTransaction).mockRejectedValueOnce(new ChainError('network', 'Offline'))
    else vi.mocked(f.reader.getOutspend).mockRejectedValueOnce(new ChainError('network', 'Offline'))
    await f.service.refresh()
    expect(f.data().operations[0]).toMatchObject({ state: 'pending', settled: false, autoRetry: false, message: 'Offline' })
    expect((await f.make(new SpendCoordinator()).reservedOutpoints()).has(f.outpoint)).toBe(true)
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
  })

  it('uses a first forced check only to restore state, then resubmits exact bytes on a separate explicit retry', async () => {
    const f = await conflicted(kind)
    f.transactions.clear()
    f.spent.clear()
    const restarted = f.make(new SpendCoordinator())
    await restarted.retry(f.original.id)
    expect(f.data().operations[0]).toMatchObject({ state: 'pending', autoRetry: false })
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
    await restarted.retry(f.original.id)
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(2)
    expect(f.reader.broadcastTransaction).toHaveBeenLastCalledWith(f.original.rawHex)
  })
})
