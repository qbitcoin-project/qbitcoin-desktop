import { ChainError, EsploraClient, MAX_BROADCAST_BYTES } from '@qbtc/chain'
import { deserialize, fromHex, masterKeyFromSeed, mnemonicToSeed, sighash, verifySiglistEntry } from '@qbtc/crypto'
import { describe, expect, it, vi } from 'vitest'
import { addressFromPubkey, decodeAddress, sighashCommitsTokenId } from '../../src/main/brand/crypto'
import { deriveStakingKey, fixedStakingOwners } from '../../src/main/wallet/stakingKeys'
import { buildSignedTransactionWithKey, importedKeyFromStored, ordinaryKeyAddress, signUnsignedTxWithKey } from '../../src/main/wallet/keyWallet'
import { buildSignedTransaction, deriveInputKeypair, signUnsignedTx } from '../../src/main/wallet/signTx'
import { validateDelegationJournal } from '../../src/main/wallet/delegationStore'
import { StakingHistory } from '../../src/main/wallet/StakingHistory'
import { SpendCoordinator } from '../../src/main/wallet/SpendCoordinator'
import { chainTx, stakingFixture, stakingProfile } from '../fixtures/staking'
import { delegatedKeyFixture } from '../fixtures/delegatedKey'
import type * as brandDelegation from '../../src/main/brand/delegation'

vi.mock('../../src/main/brand/delegation', async (original) => {
  const { TEST_STAKING_DERIVATION } = await import('../fixtures/stakingDerivation')
  return { ...await original<typeof brandDelegation>(), STAKING_DERIVATIONS: [TEST_STAKING_DERIVATION] }
})

const funding = { algo: 'ecdsa' as const, amountAtomic: '10000000' }
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }
const tokenId = 'ee'.repeat(32)

async function falconFixture() {
  const f = stakingFixture()
  const { wif } = await delegatedKeyFixture('falcon512', 32, 'testnet')
  const key = await importedKeyFromStored({ wif, address: '', algo: 'falcon512' }, 'testnet')
  f.wallet.owners = async () => [{ kind: 'key', algo: 'falcon512' }]
  f.wallet.publicKey = async () => key.publicKey.slice()
  f.wallet.keypair = async () => ({ privateKey: key.privateKey.slice(), publicKey: key.publicKey.slice() })
  return { ...f, key }
}

describe('transport bound and recoverable operations', () => {
  it('returns 60 Falcon inputs above the former 100 KB limit in a single signed transaction', async () => {
    const f = await falconFixture()
    try {
      const address = (await f.service.addresses())[0]!.address, id = 'ab'.repeat(32)
      f.transactions.set(id, chainTx(id))
      f.unspent.set(address, Array.from({ length: 60 }, (_, vout) => ({ txid: id, vout, value: 1000000n, status: { confirmed: true } })))
      const preview = await f.service.buildWithdrawal({ address, amountAtomic: '0', max: true })
      expect(preview.remainingParts).toBe(0)
      expect(preview.inputCount).toBe(60)
      expect(preview.sizeUpperBound).toBeLessThanOrEqual(MAX_BROADCAST_BYTES)
      await f.service.confirm(preview.draftId)
      const op = f.data().operations[0]!
      expect(op.rawHex!.length / 2).toBeGreaterThan(100000)
      expect(op.rawHex!.length / 2).toBeLessThanOrEqual(preview.sizeUpperBound)
      expect(deserialize(fromHex(op.rawHex!)).inputs).toHaveLength(preview.inputCount)
      expect((await f.service.reservedOutpoints()).size).toBe(preview.inputCount)
      await expect(f.service.buildWithdrawal({ address, amountAtomic: '59000000' })).rejects.toThrow()
    } finally { f.key.privateKey.fill(0) }
  })

  it('delegates 80 Falcon inputs above the former 100 KB limit with the registration marker', async () => {
    const f = await falconFixture()
    try {
      const ordinaryAddress = ordinaryKeyAddress(f.key, 'testnet')
      f.ordinary.splice(0, f.ordinary.length, ...Array.from({ length: 80 }, (_, vout) => ({ txid: 'ab'.repeat(32), vout, value: 1000000n, confirmed: true, address: ordinaryAddress, algo: 'falcon512' as const, chain: 0 as const, index: 0 })))
      f.wallet.signFunding = (unsigned) => signUnsignedTxWithKey(unsigned, { ...f.key, delegation: undefined }, 'testnet')
      const preview = await f.service.buildFunding({ algo: 'falcon512', amountAtomic: '0', max: true })
      expect(preview.remainingParts).toBe(0)
      expect(preview.inputCount).toBe(80)
      await f.service.confirm(preview.draftId)
      const raw = f.data().operations[0]!.rawHex!
      expect(raw.length / 2).toBeGreaterThan(100000)
      expect(raw.length / 2).toBeLessThanOrEqual(MAX_BROADCAST_BYTES)
      expect(deserialize(fromHex(raw)).outputs[0]!.data?.[0]).toBe(0x44)
    } finally { f.key.privateKey.fill(0) }
  })

  it('splits an unstake above 2 MiB, broadcasts the signed part through the installed SDK and restores its journal', async () => {
    const f = await falconFixture()
    try {
      const address = (await f.service.addresses())[0]!.address, id = 'ab'.repeat(32)
      f.transactions.set(id, chainTx(id))
      f.unspent.set(address, Array.from({ length: 1600 }, (_, vout) => ({ txid: id, vout, value: 1000000n, status: { confirmed: true } })))
      const preview = await f.service.buildWithdrawal({ address, amountAtomic: '0', max: true })
      expect(preview.remainingParts).toBeGreaterThan(0)
      expect(preview.sizeUpperBound).toBeLessThanOrEqual(MAX_BROADCAST_BYTES)
      expect(preview.inputCount).toBeLessThan(1600)
      await f.service.confirm(preview.draftId)
      const op = f.data().operations[0]!, raw = op.rawHex!
      expect(raw.length / 2).toBeGreaterThan(1_900_000)
      expect(raw.length / 2).toBeLessThanOrEqual(preview.sizeUpperBound)
      expect(deserialize(fromHex(raw)).inputs).toHaveLength(preview.inputCount)
      const fetchFn = vi.fn<typeof fetch>(async () => new Response(op.txid!, { status: 200 }))
      const client = new EsploraClient({ name: 'Test', url: 'https://node.example', network: 'testnet', protocol: 'esplora', operator: 'Test', priority: 1 }, { fetchImpl: fetchFn, maxRetries: 0 })
      await expect(client.broadcastTransaction(raw)).resolves.toBe(op.txid)
      expect(JSON.parse(String(fetchFn.mock.calls[0]![1]!.body)).hex).toBe(raw)
      f.setData(validateDelegationJournal(JSON.parse(JSON.stringify(f.data())), 'wallet', 'testnet'))
      const restarted = f.make(new SpendCoordinator())
      expect((await restarted.reservedOutpoints()).size).toBe(preview.inputCount)
      const next = await restarted.buildWithdrawal({ address, amountAtomic: '0', max: true })
      expect(preview.inputCount + next.inputCount).toBe(1600)
      expect(next.remainingParts).toBe(0)
    } finally { f.key.privateKey.fill(0) }
  })

  it('leaves the spending queue available during a slow background status read and avoids unchanged writes', async () => {
    const f = stakingFixture(), preview = await f.service.buildFunding(funding)
    await f.service.confirm(preview.draftId)
    const op = f.data().operations[0]!, pending = deferred<ReturnType<typeof chainTx>>()
    vi.mocked(f.reader.getTransaction).mockImplementationOnce(() => pending.promise)
    const refreshing = f.service.refresh()
    await vi.waitFor(() => expect(f.reader.getTransaction).toHaveBeenCalledTimes(2))
    expect(await f.coordinator.run(async () => 'user action')).toBe('user action')
    pending.resolve(chainTx(op.txid!)); await refreshing
    f.transactions.set(op.txid!, chainTx(op.txid!))
    vi.mocked(f.store.save).mockClear()
    await f.service.refresh(); await f.service.refresh()
    expect(f.store.save).not.toHaveBeenCalled()
  })

  it('does not abandon a preparation whose signature finishes while a refresh is queued', async () => {
    const f = stakingFixture(), signing = deferred<void>(), original = f.wallet.signFunding
    f.wallet.signFunding = async (tx) => { await signing.promise; return original(tx) }
    const draft = await f.service.buildFunding(funding), sending = f.service.confirm(draft.draftId)
    await vi.waitFor(() => expect(f.data().operations[0]?.state).toBe('prepared'))
    const refreshing = f.service.refresh()
    signing.resolve(); await Promise.all([sending, refreshing])
    expect(f.data().operations[0]!.state).toBe('pending')
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
  })

  it('settles at depth six without repeated writes and restores reservations on a deep reorg', async () => {
    const f = stakingFixture(), draft = await f.service.buildFunding(funding)
    await f.service.confirm(draft.draftId)
    const op = f.data().operations[0]!
    f.reader.getBlockchainInfo = async () => ({ tipHeight: 105 })
    f.transactions.set(op.txid!, chainTx(op.txid!, { status: { confirmed: true, blockHeight: 100 } }))
    await f.service.refresh()
    expect((await f.service.reservedOutpoints()).size).toBe(0)
    vi.mocked(f.store.save).mockClear()
    await f.service.refresh()
    expect(f.store.save).not.toHaveBeenCalled()
    f.transactions.delete(op.txid!)
    const restarted = f.make(new SpendCoordinator())
    await restarted.refresh()
    expect((await restarted.reservedOutpoints()).size).toBe(1)
    expect(f.data().operations[0]).toMatchObject({ settled: false, state: 'pending', autoRetry: false })
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
  })

  it('bounds automatic attempts, keeps uncertain bytes reserved, and resume never turns a later rejection into a first rejection', async () => {
    const f = stakingFixture()
    vi.mocked(f.reader.broadcastTransaction).mockRejectedValueOnce(new ChainError('timeout', 'lost response')).mockRejectedValue(new ChainError('broadcast_rejected', 'rejected', { status: 400 }))
    const draft = await f.service.buildFunding(funding)
    await f.service.confirm(draft.draftId)
    for (let i = 0; i < 7; i++) await f.service.retry(draft.draftId)
    const raw = f.data().operations[0]!.rawHex
    const time = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 900000)
    try { await f.service.refresh() } finally { time.mockRestore() }
    expect(f.data().operations[0]).toMatchObject({ attempts: 8, autoRetry: false, rawHex: raw })
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(8)
    await f.service.setAutoRetry(draft.draftId, true)
    await f.service.retry(draft.draftId)
    expect(f.data().operations[0]).toMatchObject({ state: 'pending', attempts: 9, autoAttemptBase: 8, rawHex: raw })
    expect((await f.service.reservedOutpoints()).size).toBe(1)
    expect(f.wallet.signFunding).toHaveBeenCalledTimes(1)
  })

  it('reviews recovery without sending, then pauses the original and returns exactly its inputs to an ordinary address', async () => {
    const f = stakingFixture()
    vi.mocked(f.reader.broadcastTransaction).mockRejectedValue(new ChainError('timeout', 'unknown'))
    const draft = await f.service.buildFunding(funding)
    await f.service.confirm(draft.draftId)
    const original = f.data().operations[0]!
    f.wallet.changeAddress = async () => { throw new Error('Pending changes fill the gap') }
    const preview = await f.service.buildRecovery(original.id)
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
    expect(f.data().operations[0]!.autoRetry).not.toBe(false)
    expect(BigInt(preview.feeAtomic)).toBeGreaterThan(BigInt(original.feeAtomic))
    expect(BigInt(preview.amountAtomic) + BigInt(preview.feeAtomic)).toBe(200000000n)
    await f.service.confirm(preview.draftId)
    const recovery = f.data().operations[1]!
    expect(recovery.unsigned.inputs).toEqual(original.unsigned.inputs)
    expect(deserialize(fromHex(recovery.rawHex!)).outputs[0]!.scripthash).toEqual(decodeAddress(f.key.address).scripthash)
    expect(f.data().operations[0]!.autoRetry).toBe(false)
    expect((await f.service.reservedOutpoints()).size).toBe(1)
    expect(validateDelegationJournal(f.data(), 'wallet', 'testnet')).toEqual(f.data())
    f.transactions.set(recovery.txid!, chainTx(recovery.txid!))
    for (const input of original.unsigned.inputs) f.spent.set(`${input.prevTxid}:${input.vout}`, { spent: true, txid: recovery.txid! })
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 900000)
    try { await f.service.refresh() } finally { now.mockRestore() }
    expect(f.data().operations[0]!.state).toBe('conflict')
    expect(f.data().operations[1]!.state).toBe('confirmed')
  })

  it('does not release the original reservation if a competing recovery is rejected and respects newly frozen coins', async () => {
    const f = stakingFixture()
    vi.mocked(f.reader.broadcastTransaction).mockRejectedValueOnce(new ChainError('timeout', 'unknown')).mockRejectedValue(new ChainError('broadcast_rejected', 'bad', { status: 400 }))
    const original = await f.service.buildFunding(funding)
    await f.service.confirm(original.draftId)
    const recovery = await f.service.buildRecovery(original.draftId)
    f.wallet.recoveryExcludedOutpoints = async () => new Set([`${f.ordinary[0]!.txid}:0`])
    await expect(f.service.confirm(recovery.draftId)).rejects.toThrow(/coins changed/)
    f.wallet.recoveryExcludedOutpoints = async () => new Set()
    const retry = await f.service.buildRecovery(original.draftId)
    expect((await f.service.confirm(retry.draftId)).state).toBe('rejected')
    expect((await f.service.reservedOutpoints()).size).toBe(1)
    expect(f.data().operations[0]!.state).toBe('pending')
  })

  it('still allows return when every configured service is retired', async () => {
    const f = stakingFixture({ profiles: [{ ...stakingProfile, status: 'legacy' }] })
    expect(await f.service.info()).toMatchObject({ enabled: true, fundingEnabled: false })
    const address = (await f.service.addresses())[0]!.address, id = 'ab'.repeat(32)
    f.transactions.set(id, chainTx(id))
    f.unspent.set(address, [{ txid: id, vout: 0, value: 1000000n, status: { confirmed: true } }])
    expect(BigInt((await f.service.buildWithdrawal({ address, amountAtomic: '0', max: true })).amountAtomic)).toBeGreaterThan(0n)
  })
})

for (const hd of [false, true]) for (const algo of ['ecdsa', 'falcon512'] as const) it(`returns ${algo} tokens for ${hd ? 'HD' : 'WIF'} with ordinary fee inputs and verifiable mixed signatures`, async () => {
  const f = stakingFixture(), master = masterKeyFromSeed(mnemonicToSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'))
  const { wif } = await delegatedKeyFixture(algo, 32, 'testnet')
  const key = await importedKeyFromStored({ wif, address: '', algo }, 'testnet')
  try {
    if (hd) {
      f.wallet.owners = async () => fixedStakingOwners(0)
      f.wallet.publicKey = async (owner) => { const pair = await deriveStakingKey(master, owner, 'testnet'); pair.privateKey.fill(0); return pair.publicKey }
      f.wallet.keypair = (owner) => deriveStakingKey(master, owner, 'testnet')
      f.wallet.signFunding = (tx) => signUnsignedTx(tx, master, 'testnet')
      f.wallet.signOrdinary = (tx) => buildSignedTransaction(tx, master, 'testnet', true)
    } else {
      f.wallet.owners = async () => [{ kind: 'key', algo }]
      f.wallet.publicKey = async () => key.publicKey.slice()
      f.wallet.keypair = async () => ({ privateKey: key.privateKey.slice(), publicKey: key.publicKey.slice() })
      f.wallet.importedDelegate = async () => key.delegation!.delegatePubkeyhash
      f.wallet.signFunding = (tx) => signUnsignedTxWithKey(tx, key, 'testnet')
      f.wallet.signOrdinary = (tx) => buildSignedTransactionWithKey(tx, key, 'testnet', true)
    }
    const feeAlgo = hd ? 'ecdsa' : algo
    const feeKey = hd ? await deriveInputKeypair(master, { account: 0, chain: 0, index: 0, algo: feeAlgo }, 'testnet') : key
    const ordinary = addressFromPubkey(feeKey.publicKey, feeAlgo, 'testnet')
    f.ordinary[0] = { ...f.ordinary[0]!, address: ordinary, algo: feeAlgo }
    f.wallet.changeAddress = async () => ordinary
    const address = (await f.service.addresses()).find((a) => a.algo === algo)!.address, id = 'ab'.repeat(32)
    f.transactions.set(id, chainTx(id, { version: 2, status: { confirmed: true, blockTime: 1700000000 } }))
    f.unspent.set(address, [0, 1].map((vout) => ({ txid: id, vout, value: 0n, tokenId, tokenAmount: 123n, status: { confirmed: true } })))
    f.wallet.excludedOutpoints = async () => new Set([`${id}:1`])
    const preview = await f.service.buildWithdrawal({ address, tokenId, amountAtomic: '0' })
    expect(preview).toMatchObject({ tokenAmountAtomic: '123', remainingTokenAmountAtomic: '123' })
    await f.service.confirm(preview.draftId)
    const op = f.data().operations[0]!, tx = deserialize(fromHex(op.rawHex!)), digest = sighash(tx, 1, sighashCommitsTokenId('testnet'))
    expect(validateDelegationJournal(f.data(), 'wallet', 'testnet')).toEqual(f.data())
    expect(tx.tokenHash).toEqual(fromHex(tokenId))
    for (const [index, input] of tx.inputs.entries()) {
      const pubkey = op.unsigned.inputs[index]!.keyScript === 'delegated' ? input.siglist![1]! : feeKey.publicKey
      expect(await verifySiglistEntry(input.siglist![0]!, digest, pubkey)).toBe(true)
    }
    expect(tx.outputs[0]!.scripthash).toEqual(decodeAddress(ordinary).scripthash)
    expect(op.rawHex!.length / 2).toBeLessThanOrEqual(preview.sizeUpperBound)
    expect((await f.service.reservedOutpoints()).size).toBe(2)
    await expect(f.service.buildWithdrawal({ address, tokenId, amountAtomic: '0' })).rejects.toThrow(/No unfrozen/)
    f.ordinary.length = 0
    f.wallet.excludedOutpoints = async () => new Set()
    await expect(f.service.buildWithdrawal({ address, tokenId, amountAtomic: '0' })).rejects.toThrow(/Ordinary coins are needed/)
    if (hd) feeKey.privateKey.fill(0)
  } finally { key.privateKey.fill(0); master.wipePrivateData() }
})

it('backfills bounded history, uses the confirmed anchor, and removes cached slashing after a reorg', async () => {
  let pages = Array.from({ length: 9 }, (_, i) => [chainTx(String(i), { version: i === 7 ? 5 : 1, status: { confirmed: true, blockHash: `block-${i}` } })])
  const reader = { getAddressTransactions: vi.fn(async (_address: string, cursor?: string) => pages[cursor === undefined ? 0 : Number(cursor) + 1] ?? []) }
  const history = new StakingHistory(reader, () => {})
  expect(await history.read('address')).toMatchObject({ complete: false, slashed: false })
  expect(reader.getAddressTransactions).toHaveBeenCalledTimes(4)
  for (let n = 0; n < 6; n++) await history.read('address')
  expect(await history.read('address')).toMatchObject({ complete: true, slashed: true })
  reader.getAddressTransactions.mockClear()
  await history.read('address')
  expect(reader.getAddressTransactions).toHaveBeenCalledTimes(1)
  pages = [[chainTx('0', { status: { confirmed: true, blockHash: 'different-block' } })]]
  expect(await history.read('address')).toMatchObject({ complete: true, slashed: false })
  expect(reader.getAddressTransactions).toHaveBeenCalledTimes(3)
})

it('reports maturity separately from the amount available after freezes and reservations', async () => {
  const f = stakingFixture(), address = (await f.service.addresses())[0]!.address, id = 'ab'.repeat(32)
  f.transactions.set(id, chainTx(id))
  f.unspent.set(address, [0, 1].map((vout) => ({ txid: id, vout, value: 10000000n, status: { confirmed: true } })))
  f.wallet.excludedOutpoints = async () => new Set([`${id}:1`])
  expect((await f.service.refresh()).addresses[0]).toMatchObject({ matureAtomic: '20000000', availableAtomic: '10000000' })
  const preview = await f.service.buildWithdrawal({ address, amountAtomic: '0', max: true })
  await f.service.confirm(preview.draftId)
  expect((await f.service.refresh()).addresses[0]).toMatchObject({ matureAtomic: '20000000', availableAtomic: '0' })
})
