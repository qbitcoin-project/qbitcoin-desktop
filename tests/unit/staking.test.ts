import { ChainError } from '@qbtc/chain'
import { deserialize, fromHex, masterKeyFromSeed, mnemonicToSeed, scriptP2PK, setSchnorrEnabled, SIGHASH, sighash, toHex, verifySiglistEntry } from '@qbtc/crypto'
import { describe, expect, it, vi } from 'vitest'
import { addressFromPubkey, decodeAddress, sighashCommitsTokenId } from '../../src/main/brand/crypto'
import { delegationMark, parseDelegationMark, decodeDelegatePubkeyhash, encodeDelegatePubkeyhash, delegationScript, ownerPubkeyhash } from '../../src/main/wallet/delegation'
import { DelegationMetaStore, emptyDelegationJournal, validateDelegationJournal } from '../../src/main/wallet/delegationStore'
import { deriveStakingKey, fixedStakingOwners } from '../../src/main/wallet/stakingKeys'
import { SpendCoordinator } from '../../src/main/wallet/SpendCoordinator'
import { importedKeyFromStored, createKeyAddressSource, ordinaryKeyAddress, signUnsignedTxWithKey } from '../../src/main/wallet/keyWallet'
import { toCryptoTransaction } from '../../src/main/wallet/signTx'
import { feeForBytes } from '../../src/main/wallet/txSize'
import { delegatedKeyFixture } from '../fixtures/delegatedKey'
import { chainTx, stakingFixture, stakingProfile } from '../fixtures/staking'
import type * as brandDelegation from '../../src/main/brand/delegation'

vi.mock('../../src/main/brand/delegation', async (original) => {
  const { TEST_STAKING_DERIVATION } = await import('../fixtures/stakingDerivation')
  return { ...await original<typeof brandDelegation>(), STAKING_DERIVATIONS: [TEST_STAKING_DERIVATION] }
})

const funding = { algo: 'ecdsa' as const, amountAtomic: '10000000' }
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

describe('registration envelope', () => {
  it.each([20, 32])('uses raw %i-byte owner hashes after D and strict network public identifiers', (size) => {
    const hash = new Uint8Array(size).fill(12)
    expect(delegationMark(hash)).toEqual(Uint8Array.of(0x44, ...hash))
    expect(parseDelegationMark(delegationMark(hash))).toEqual(hash)
    const encoded = encodeDelegatePubkeyhash(hash, 'testnet')
    expect(decodeDelegatePubkeyhash(encoded, 'testnet')).toEqual(hash)
    expect(() => decodeDelegatePubkeyhash(encoded, 'mainnet')).toThrow()
    expect(() => decodeDelegatePubkeyhash(encoded.slice(0, -1) + '0', 'testnet')).toThrow()
    expect(parseDelegationMark(Uint8Array.of(0x45, ...hash))).toBeNull()
  })
})

describe('delegation preparation and persistence', () => {
  it('funds a separate owner from ordinary coins, writes the marker only on that output, and persists before sending', async () => {
    const f = stakingFixture()
    const draft = await f.service.buildFunding(funding)
    expect(draft.sourceLabel).toBe('Ordinary coins in this wallet')
    expect(draft.address).not.toBe(f.key.address)
    expect(f.reader.broadcastTransaction).not.toHaveBeenCalled()
    await expect(f.service.confirm('a different preview')).rejects.toThrow(/no longer current/)
    const result = await f.service.confirm(draft.draftId)
    expect(result.state).toBe('pending')
    expect(f.events).toEqual(['save:prepared', 'sign', 'save:signed', 'change', 'save:signed', 'save:pending', 'broadcast', 'save:pending'])
    const op = f.data().operations[0]!
    const tx = deserialize(fromHex(op.rawHex!))
    expect(tx.outputs[0]!.data).toEqual(delegationMark(ownerPubkeyhash(f.key.publicKey, 'ecdsa')))
    expect(tx.outputs[1]!.data).toBeUndefined()
    expect(tx.outputs[0]!.scripthash).toEqual(decodeAddress(draft.address).scripthash)
    expect(tx.outputs[1]!.scripthash).toEqual(decodeAddress(f.key.address).scripthash)
    expect(BigInt(draft.feeAtomic)).toBeGreaterThanOrEqual(feeForBytes(op.rawHex!.length / 2, 1))
    expect(op.rawHex!.length / 2).toBeLessThanOrEqual(draft.sizeUpperBound)
    await expect(f.service.assertOrdinaryInputs(op.unsigned)).rejects.toThrow(/pending staking/)
    await f.service.confirm(draft.draftId)
    expect(f.wallet.signFunding).toHaveBeenCalledTimes(1)
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
  })

  it.each(['100000', '10000000'])('respects an optional source filter, minimum of %s atomic units, maturity and maximum including the marked output fee', async (minimumAtomic) => {
    const f = stakingFixture({ profiles: [{ ...stakingProfile, minimumAtomic }] })
    await expect(f.service.buildFunding({ ...funding, sourceAddress: 'another address' })).rejects.toThrow()
    await expect(f.service.buildFunding({ ...funding, amountAtomic: (BigInt(minimumAtomic) - 1n).toString() })).rejects.toThrow(/at least/)
    const minimumPreview = await f.service.buildFunding({ ...funding, amountAtomic: minimumAtomic })
    expect(minimumPreview.amountAtomic).toBe(minimumAtomic)
    expect(BigInt(minimumPreview.amountAtomic) + BigInt(minimumPreview.feeAtomic) + BigInt(minimumPreview.changeAtomic)).toBe(200000000n)
    f.ordinary.push({ ...f.ordinary[0]!, txid: '22'.repeat(32), maturesAt: Date.now() / 1000 + 1000 })
    const preview = await f.service.buildFunding({ ...funding, sourceAddress: f.key.address, max: true, amountAtomic: '0' })
    expect(preview.inputCount).toBe(1)
    expect(BigInt(preview.amountAtomic) + BigInt(preview.feeAtomic)).toBe(200000000n)
    expect(preview.changeAtomic).toBe('0')
  })

  it('fails before broadcast on prepared or signed persistence failure', async () => {
    for (const failOn of [1, 2]) {
      const f = stakingFixture(), save = f.store.save
      let writes = 0
      f.store.save = async (data) => { if (++writes === failOn) throw new Error('Disk full'); await save(data) }
      const draft = await f.service.buildFunding(funding)
      await expect(f.service.confirm(draft.draftId)).rejects.toThrow(/Disk full/)
      expect(f.reader.broadcastTransaction).not.toHaveBeenCalled()
      expect(f.wallet.signFunding).toHaveBeenCalledTimes(failOn === 1 ? 0 : 1)
      const restored = f.make(new SpendCoordinator())
      await restored.refresh()
      expect(f.reader.broadcastTransaction).not.toHaveBeenCalled()
      if (failOn === 2) expect((await restored.list()).operations[0]!.state).toBe('abandoned')
    }
  })

  it('retries the exact persisted wire bytes after an accepted-but-lost response and a restart', async () => {
    const f = stakingFixture()
    let raw = ''
    vi.mocked(f.reader.broadcastTransaction).mockImplementation(async (hex) => { raw = hex; throw new ChainError('timeout', 'timeout') })
    const draft = await f.service.buildFunding(funding)
    await f.service.confirm(draft.draftId)
    const saved = f.data().operations[0]!
    expect(saved.rawHex).toBe(raw)
    const restored = f.make(new SpendCoordinator())
    await restored.retry(saved.id)
    expect(f.reader.broadcastTransaction).toHaveBeenLastCalledWith(raw)
    expect(f.wallet.signFunding).toHaveBeenCalledTimes(1)
    expect(f.wallet.consumeChange).toHaveBeenCalledTimes(1)
    expect((await restored.reservedOutpoints()).size).toBe(1)
  })

  it('does not treat a failed status read as absence or broadcast from list', async () => {
    const f = stakingFixture()
    vi.mocked(f.reader.getTransaction).mockRejectedValue(new ChainError('network', 'offline'))
    const draft = await f.service.buildFunding(funding)
    await f.service.confirm(draft.draftId)
    expect(f.data().operations[0]!.state).toBe('signed')
    expect(f.reader.broadcastTransaction).not.toHaveBeenCalled()
    await f.service.list()
    expect(f.reader.broadcastTransaction).not.toHaveBeenCalled()
  })

  it('keeps an accepted transaction when the broadcast reply is lost', async () => {
    const f = stakingFixture(), original = f.reader.broadcastTransaction
    f.reader.broadcastTransaction = async (raw) => { await original(raw); throw new ChainError('timeout', 'lost reply') }
    const draft = await f.service.buildFunding(funding)
    expect((await f.service.confirm(draft.draftId)).state).toBe('pending')
    expect(f.data().operations[0]!.message).toBeUndefined()
  })

  it('distinguishes explicit first rejection from uncertain submission and needs new review', async () => {
    const f = stakingFixture()
    vi.mocked(f.reader.broadcastTransaction).mockRejectedValue(new ChainError('broadcast_rejected', 'bad transaction', { status: 400 }))
    const draft = await f.service.buildFunding(funding)
    expect((await f.service.confirm(draft.draftId)).state).toBe('rejected')
    expect((await f.service.reservedOutpoints()).size).toBe(0)
    await f.service.retry(draft.draftId)
    expect(f.wallet.signFunding).toHaveBeenCalledTimes(1)
  })

  it('refuses stale coins and changed return addresses before signing', async () => {
    const f = stakingFixture()
    const draft = await f.service.buildFunding(funding)
    vi.mocked(f.wallet.changeAddress).mockResolvedValue(addressFromPubkey(new Uint8Array(33).fill(2), 'ecdsa', 'testnet'))
    await expect(f.service.confirm(draft.draftId)).rejects.toThrow(/address has advanced/)
    vi.mocked(f.wallet.changeAddress).mockResolvedValue(f.key.address)
    const next = await f.service.buildFunding(funding)
    f.ordinary.length = 0
    await expect(f.service.confirm(next.draftId)).rejects.toThrow(/coins changed/)
    expect(f.wallet.signFunding).not.toHaveBeenCalled()
  })

  it('queues parallel work and rejects queued and late signatures after lock', async () => {
    const f = stakingFixture(), signature = deferred<Awaited<ReturnType<typeof f.wallet.signFunding>>>()
    vi.mocked(f.wallet.signFunding).mockImplementation(() => signature.promise)
    const draft = await f.service.buildFunding(funding)
    const sending = f.service.confirm(draft.draftId)
    await vi.waitFor(() => expect(f.wallet.signFunding).toHaveBeenCalled())
    const queued = f.service.confirm(draft.draftId)
    const ordinary = f.coordinator.run(async () => 'ordinary send')
    f.coordinator.dispose(); f.service.dispose()
    signature.resolve({ rawHex: '00', txid: '00'.repeat(32) })
    await Promise.all([sending, queued, ordinary].map((work) => expect(work).rejects.toThrow(/session ended/)))
    expect(f.reader.broadcastTransaction).not.toHaveBeenCalled()
  })
})

describe('owner return and recovery', () => {
  it.each(['ecdsa', 'falcon512'] as const)('restores saved v2 %s operations and returns their coins with the same owner key', async (algo) => {
    const master = masterKeyFromSeed(mnemonicToSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'))
    const owner = { kind: 'hd', derivationId: 'staking-owner-v2', algo, account: 0 } as const
    const f = stakingFixture()
    const pair = await deriveStakingKey(master, owner, 'testnet')
    try {
      f.wallet.owners = async () => fixedStakingOwners(0)
      f.wallet.publicKey = async (ref) => { const key = await deriveStakingKey(master, ref, 'testnet'); key.privateKey.fill(0); return key.publicKey }
      f.wallet.keypair = async (ref) => deriveStakingKey(master, ref, 'testnet')
      const draft = await f.service.buildFunding({ ...funding, algo })
      await f.service.confirm(draft.draftId)
      const original = f.data().operations[0]!
      const saved = structuredClone(f.data())
      expect(saved.records.find((r) => r.address === draft.address)?.owner).toEqual(owner)
      let disk = JSON.stringify(saved)
      const store = new DelegationMetaStore({ read: async () => disk, write: async (blob) => { disk = blob } },
        { openData: async (blob) => blob, sealData: async (blob) => blob }, 'wallet', 'testnet')
      f.store.load = () => store.load()
      const save = f.store.save
      f.store.save = async (data) => { await store.save(data); await save(data) }
      const restored = f.make(new SpendCoordinator())
      expect(await restored.addresses()).toHaveLength(2)
      expect(await restored.reservedOutpoints()).toContain('11'.repeat(32) + ':0')
      await expect(restored.assertOrdinaryInputs(original.unsigned)).rejects.toThrow(/pending staking operation/)
      await expect(restored.assertOrdinaryInputs({ ...original.unsigned, inputs: original.unsigned.inputs.map((i) => ({ ...i, prevTxid: '22'.repeat(32) })) })).resolves.toBeUndefined()
      f.transactions.set(original.txid!, chainTx(original.txid!))
      f.unspent.set(draft.address, [{ txid: original.txid!, vout: 0, value: BigInt(draft.amountAtomic), status: { confirmed: true } }])
      const snapshot = await restored.refresh()
      expect(snapshot.operations[0]).toMatchObject({ id: original.id, txid: original.txid, state: 'confirmed' })
      expect(f.data().operations[0]!.rawHex).toBe(original.rawHex)
      expect(snapshot.addresses.find((a) => a.address === draft.address)).toMatchObject({ legacy: false, canFund: true, confirmedAtomic: draft.amountAtomic, stale: false })
      expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
      f.ordinary[0] = { ...f.ordinary[0]!, txid: '22'.repeat(32) }
      const active = await restored.buildFunding({ ...funding, algo })
      expect(active.address).toBe(draft.address)
      const withdrawal = await restored.buildWithdrawal({ address: draft.address, amountAtomic: '4000000' })
      expect(withdrawal.destination).toBe(f.key.address)
      expect(withdrawal.amountAtomic).toBe('4000000')
      expect(BigInt(withdrawal.stakingRemainingAtomic!)).toBe(BigInt(draft.amountAtomic) - 4000000n - BigInt(withdrawal.feeAtomic))
      await restored.confirm(withdrawal.draftId)
      const sent = f.data().operations.at(-1)!, signed = deserialize(fromHex(sent.rawHex!))
      expect(toHex(signed.inputs[0]!.siglist![1]!)).toBe(toHex(pair.publicKey))
      expect(sent.unsigned.outputs[1]).toEqual({ valueAtomic: withdrawal.changeAtomic, scripthash: toHex(decodeAddress(draft.address).scripthash) })
      expect(sent.rawHex!.length / 2).toBeLessThanOrEqual(withdrawal.sizeUpperBound)
      const restarted = f.make(new SpendCoordinator())
      await restarted.retry(withdrawal.draftId)
      expect(f.data().operations.at(-1)!.rawHex).toBe(sent.rawHex)
      expect(await verifySiglistEntry(signed.inputs[0]!.siglist![0]!, sighash(toCryptoTransaction(sent.unsigned)), signed.inputs[0]!.siglist![1]!)).toBe(true)
      expect((await store.load()).operations).toHaveLength(2)
      // Other accounts and altered address metadata cannot claim the saved keys.
      f.wallet.owners = async () => fixedStakingOwners(1)
      await expect(f.make(new SpendCoordinator()).addresses()).rejects.toThrow(/does not belong/)
      f.wallet.owners = async () => fixedStakingOwners(0)
      disk = JSON.stringify({ ...saved, records: saved.records.map((r) => r.address === draft.address ? { ...r, ownerHashHex: '00'.repeat(algo === 'ecdsa' ? 20 : 32) } : r) })
      await expect(f.make(new SpendCoordinator()).addresses()).rejects.toThrow(/does not match/)
    } finally { pair.privateKey.fill(0); master.wipePrivateData() }
  })

  it.each([0, 1])('recovers account %i branch 2 for active and retired services from only the seed, without ordinary discovery or surviving markers', async (account) => {
    const old = { ...stakingProfile, id: 'old-service', status: 'legacy' as const,
      hashes: { ecdsa: encodeDelegatePubkeyhash(new Uint8Array(20).fill(90), 'testnet'), falcon512: encodeDelegatePubkeyhash(new Uint8Array(32).fill(91), 'testnet') } }
    const f = stakingFixture({ profiles: [stakingProfile, old] })
    const master = masterKeyFromSeed(mnemonicToSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'))
    f.wallet.owners = async () => fixedStakingOwners(account)
    f.wallet.publicKey = async (owner) => { const key = await deriveStakingKey(master, owner, 'testnet'); key.privateKey.fill(0); return key.publicKey }
    f.wallet.keypair = async (owner) => deriveStakingKey(master, owner, 'testnet')
    try {
      const addresses = await f.service.addresses()
      expect(addresses).toHaveLength(4)
      for (const algo of ['ecdsa', 'falcon512'] as const) {
        const draft = await f.service.buildFunding({ ...funding, algo })
        await f.service.refresh()
        const entry = (await f.service.list()).addresses.find((r) => r.address === draft.address)!
        expect(entry.algo).toBe(algo)
        expect(entry.serviceLabel).toBe(stakingProfile.label)
        expect(f.store.save).not.toHaveBeenCalled()
      }
      for (const [index, entry] of addresses.entries()) {
        const id = (index + 1).toString(16).padStart(64, '0')
        f.unspent.set(entry.address, [{ txid: id, vout: 0, value: 10000000n, status: { confirmed: true } }])
        f.transactions.set(id, chainTx(id))
      }
      f.ordinary.length = 0
      f.setData(emptyDelegationJournal('wallet', 'testnet'))
      const restored = f.make(new SpendCoordinator())
      const snapshot = await restored.refresh()
      expect(snapshot.addresses.map((a) => a.address)).toEqual(addresses.map((a) => a.address))
      expect(snapshot.addresses.every((a) => a.balanceAtomic === '10000000')).toBe(true)
      expect(snapshot.addresses.filter((a) => a.legacy)).toHaveLength(2)
      expect(snapshot.addresses.filter((a) => a.canFund)).toHaveLength(2)
      expect(f.wallet.fundingPool).toHaveBeenCalledTimes(2)
      expect(f.reader.broadcastTransaction).not.toHaveBeenCalled()
      for (const entry of snapshot.addresses) {
        const draft = await restored.buildWithdrawal({ address: entry.address, amountAtomic: '0', max: true })
        await restored.confirm(draft.draftId)
        const op = f.data().operations.at(-1)!, signed = deserialize(fromHex(op.rawHex!))
        const record = f.data().records.find((r) => r.address === entry.address)!
        expect(toHex(ownerPubkeyhash(signed.inputs[0]!.siglist![1]!, entry.algo))).toBe(record.ownerHashHex)
        expect(op.rawHex!.length / 2).toBeLessThanOrEqual(draft.sizeUpperBound)
        expect(await verifySiglistEntry(signed.inputs[0]!.siglist![0]!, sighash(toCryptoTransaction(op.unsigned)), signed.inputs[0]!.siglist![1]!)).toBe(true)
      }
    } finally { master.wipePrivateData() }
  })

  async function funded(f = stakingFixture(), type = 2) {
    const address = (await f.service.addresses())[0]!.address
    const id = '33'.repeat(32)
    f.unspent.set(address, [{ txid: id, vout: 0, value: 10090000n, status: { confirmed: true } }])
    f.transactions.set(id, chainTx(id, { version: type, status: { confirmed: true, blockTime: Math.floor(Date.now() / 1000) - 13 * 3600 } }))
    return { ...f, address, id }
  }
  it('finds an empty candidate later without a live registration marker, retains history reward after spending, and marks stale data', async () => {
    const f = stakingFixture()
    expect((await f.service.refresh()).addresses[0]!.balanceAtomic).toBe('0')
    const g = await funded(f)
    f.transactions.set(g.id, chainTx(g.id, { version: 2, status: { confirmed: true, blockTime: Math.floor(Date.now() / 1000) - 3600 } }))
    const stake = chainTx(g.id, { version: 2, vin: [{ txid: '44'.repeat(32), vout: 0, prevoutValue: 10000000n, prevoutAddress: g.address }],
      vout: [{ value: 10090000n, address: g.address, scripthash: toHex(decodeAddress(g.address).scripthash) }] })
    f.history.set(g.address, [stake])
    let view = (await f.service.refresh()).addresses[0]!
    expect(view).toMatchObject({ balanceAtomic: '10090000', maturingAtomic: '10090000', matureAtomic: '0', lastRewardAtomic: '90000' })
    f.unspent.set(g.address, [])
    view = (await f.service.refresh()).addresses[0]!
    expect(view.lastRewardAtomic).toBe('90000')
    vi.mocked(f.reader.listUnspent).mockRejectedValue(new Error('offline'))
    view = (await f.service.refresh()).addresses[0]!
    expect(view).toMatchObject({ stale: true, lastRewardAtomic: '90000', error: 'offline' })
  })

  it('returns all selected coins minus fee through a verifiable owner witness to an ordinary address', async () => {
    const f = await funded()
    const draft = await f.service.buildWithdrawal({ address: f.address, amountAtomic: '0', max: true })
    expect(draft.destination).toBe(f.key.address)
    expect(draft.eligibleAt).toBeLessThan(Date.now() / 1000)
    expect(BigInt(draft.amountAtomic) + BigInt(draft.feeAtomic)).toBe(10090000n)
    await f.service.confirm(draft.draftId)
    const op = f.data().operations[0]!, signed = deserialize(fromHex(op.rawHex!)), input = signed.inputs[0]!
    expect(input.redeemScript).toEqual(delegationScript(ownerPubkeyhash(f.key.publicKey, 'ecdsa'), decodeDelegatePubkeyhash(stakingProfile.hashes.ecdsa, 'testnet')))
    expect(input.siglist![2]).toEqual(Uint8Array.of(1))
    expect(await verifySiglistEntry(input.siglist![0]!, sighash(toCryptoTransaction(op.unsigned), SIGHASH.ALL, sighashCommitsTokenId('testnet')), f.key.publicKey)).toBe(true)
    const pair = await vi.mocked(f.wallet.keypair).mock.results[0]!.value as Awaited<ReturnType<typeof f.wallet.keypair>>
    expect(pair.privateKey.every((b) => b === 0)).toBe(true)
  })

  it('requires a new review after a competing stake, without signing another return', async () => {
    const f = await funded()
    const draft = await f.service.buildWithdrawal({ address: f.address, amountAtomic: '0', max: true })
    vi.mocked(f.reader.broadcastTransaction).mockRejectedValue(new ChainError('timeout', 'offline'))
    await f.service.confirm(draft.draftId)
    const other = '55'.repeat(32)
    f.spent.set(`${f.id}:0`, { spent: true, txid: other })
    f.transactions.set(other, chainTx(other, { version: 2 }))
    expect((await f.service.retry(draft.draftId)).state).toBe('conflict')
    expect(f.wallet.keypair).toHaveBeenCalledTimes(1)
    expect((await f.service.reservedOutpoints()).size).toBe(0)
  })

  it('wipes a withdrawal keypair that finishes deriving after lock', async () => {
    const f = await funded()
    const key = deferred<{ privateKey: Uint8Array; publicKey: Uint8Array }>()
    vi.mocked(f.wallet.keypair).mockImplementation(() => key.promise)
    const draft = await f.service.buildWithdrawal({ address: f.address, amountAtomic: '0', max: true })
    const confirming = f.service.confirm(draft.draftId)
    await vi.waitFor(() => expect(f.wallet.keypair).toHaveBeenCalled())
    f.coordinator.dispose(); f.service.dispose()
    const pair = { privateKey: f.key.privateKey.slice(), publicKey: f.key.publicKey.slice() }
    key.resolve(pair)
    await expect(confirming).rejects.toThrow(/session ended/)
    expect(pair.privateKey.every((byte) => byte === 0)).toBe(true)
    expect(f.reader.broadcastTransaction).not.toHaveBeenCalled()
  })

  it('keeps reward unknown until missing prevouts can be resolved and refreshes confirmations', async () => {
    const f = await funded(), prev = '98'.repeat(32)
    const stake = chainTx(f.id, { version: 2, vin: [{ txid: prev, vout: 0 }],
      vout: [{ address: f.address, scripthash: '', value: 10090000n }] })
    f.history.set(f.address, [stake])
    expect((await f.service.refresh()).addresses[0]).toMatchObject({ rewardUnknown: true, lastRewardAtomic: undefined })
    f.transactions.set(prev, chainTx(prev, { vout: [{ address: f.address, scripthash: '', value: 10000000n }] }))
    expect((await f.service.refresh()).addresses[0]).toMatchObject({ rewardUnknown: false, lastRewardAtomic: '90000' })
    f.history.set(f.address, [{ ...stake, status: { confirmed: false } }])
    expect((await f.service.refresh()).addresses[0]!.lastRewardAtomic).toBeUndefined()
  })

  it('rechecks confirmed withdrawals after reorg and reuses their bytes', async () => {
    const f = await funded()
    const draft = await f.service.buildWithdrawal({ address: f.address, amountAtomic: '0', max: true })
    const sent = await f.service.confirm(draft.draftId)
    const raw = f.data().operations[0]!.rawHex!
    f.transactions.set(sent.txid!, chainTx(sent.txid!))
    expect((await f.service.retry(draft.draftId)).state).toBe('confirmed')
    f.transactions.delete(sent.txid!)
    expect((await f.service.retry(draft.draftId)).state).toBe('pending')
    expect(f.reader.broadcastTransaction).toHaveBeenLastCalledWith(raw)
    expect(f.wallet.keypair).toHaveBeenCalledTimes(1)
  })

  it('blocks unknown maturity, pending deposits, changed maturity, and foreign addresses', async () => {
    const f = await funded()
    await expect(f.service.buildWithdrawal({ address: f.key.address, amountAtomic: '0', max: true })).rejects.toThrow(/does not belong/)
    const draft = await f.service.buildWithdrawal({ address: f.address, amountAtomic: '0', max: true })
    f.transactions.set(f.id, chainTx(f.id, { version: 2, status: { confirmed: true, blockTime: Math.floor(Date.now() / 1000) } }))
    await expect(f.service.confirm(draft.draftId)).rejects.toThrow(/coins changed/)
    f.transactions.delete(f.id)
    await expect(f.service.buildWithdrawal({ address: f.address, amountAtomic: '0', max: true })).rejects.toThrow(/No staking coins are available/)
    f.unspent.set(f.address, [{ txid: f.id, vout: 0, value: 10090000n, status: { confirmed: false } }])
    await expect(f.service.buildWithdrawal({ address: f.address, amountAtomic: '0', max: true })).rejects.toThrow(/No staking coins are available/)
  })

  it('makes spendable slashing refunds returnable and reports slashing separately', async () => {
    const f = await funded(undefined, 5)
    f.transactions.set(f.id, chainTx(f.id, { version: 5 }))
    f.history.set(f.address, [f.transactions.get(f.id)!])
    expect((await f.service.refresh()).addresses[0]).toMatchObject({ slashed: true, matureAtomic: '10090000', lastRewardAtomic: undefined })
    expect((await f.service.buildWithdrawal({ address: f.address, amountAtomic: '0', max: true })).amountAtomic).not.toBe('0')
  })

  it('returns an exact partial amount, preserves tiny change, and leaves other UTXOs untouched', async () => {
    const f = await funded(undefined, 1)
    f.unspent.get(f.address)!.push({ txid: f.id, vout: 1, value: 20000000n, status: { confirmed: true } })
    const draft = await f.service.buildWithdrawal({ address: f.address, amountAtomic: '5000000' })
    expect(draft.amountAtomic).toBe('5000000')
    expect(draft.inputCount).toBe(1)
    expect(BigInt(draft.stakingRemainingAtomic!)).toBe(30090000n - 5000000n - BigInt(draft.feeAtomic))
    await f.service.confirm(draft.draftId)
    const op = f.data().operations[0]!
    expect(op.unsigned.outputs).toEqual([
      { valueAtomic: '5000000', scripthash: toHex(decodeAddress(f.key.address).scripthash) },
      { valueAtomic: draft.changeAtomic, scripthash: toHex(decodeAddress(f.address).scripthash) },
    ])
    expect((await f.service.reservedOutpoints()).size).toBe(1)
    const remainingCoin = f.unspent.get(f.address)!.find((u) => !op.unsigned.inputs.some((i) => i.vout === u.vout))!
    // Reuse the two-output fee: even a one-atomic remainder stays delegated.
    const tiny = await f.service.buildWithdrawal({ address: f.address, amountAtomic: (remainingCoin.value - BigInt(draft.feeAtomic) - 1n).toString() })
    expect(tiny.changeAtomic).toBe('1')
    expect(tiny.feeAtomic).toBe(draft.feeAtomic)
  })

  it('Max and partial return exclude locked, unknown, pending, frozen and reserved coins', async () => {
    const f = await funded(undefined, 1)
    const locked = '44'.repeat(32), unknown = '55'.repeat(32), pending = '66'.repeat(32)
    f.transactions.set(locked, chainTx(locked, { version: 2, status: { confirmed: true, blockTime: Math.floor(Date.now() / 1000) } }))
    f.transactions.set(pending, chainTx(pending, { status: { confirmed: false } }))
    f.unspent.get(f.address)!.push(
      { txid: locked, vout: 0, value: 10000000n, status: { confirmed: true } },
      { txid: unknown, vout: 0, value: 20000000n, status: { confirmed: true } },
      { txid: pending, vout: 0, value: 30000000n, status: { confirmed: false } },
      { txid: f.id, vout: 1, value: 40000000n, status: { confirmed: true } },
    )
    f.wallet.excludedOutpoints = async () => new Set([`${f.id}:1`])
    const max = await f.service.buildWithdrawal({ address: f.address, amountAtomic: '0', max: true })
    expect(BigInt(max.amountAtomic) + BigInt(max.feeAtomic)).toBe(10090000n)
    expect(max.stakingRemainingAtomic).toBe('100000000')
    await expect(f.service.buildWithdrawal({ address: f.address, amountAtomic: '10090000' })).rejects.toThrow(/Not enough balance/)
    const partial = await f.service.buildWithdrawal({ address: f.address, amountAtomic: '1000' })
    await f.service.confirm(partial.draftId)
    expect(f.data().operations[0]!.unsigned.inputs.map((i) => `${i.prevTxid}:${i.vout}`)).toEqual([`${f.id}:0`])
    await expect(f.service.buildWithdrawal({ address: f.address, amountAtomic: '0', max: true })).rejects.toThrow(/No staking coins/)
  })

  it('rejects invalid amounts and a newly frozen input before signing', async () => {
    const f = await funded()
    for (const amountAtomic of ['0', '-1', '1.1', '1e6', '', '1'.repeat(25)]) {
      await expect(f.service.buildWithdrawal({ address: f.address, amountAtomic })).rejects.toThrow()
    }
    const draft = await f.service.buildWithdrawal({ address: f.address, amountAtomic: '1000' })
    f.wallet.excludedOutpoints = async () => new Set([`${f.id}:0`])
    await expect(f.service.confirm(draft.draftId)).rejects.toThrow(/coins changed/)
    expect(f.wallet.keypair).not.toHaveBeenCalled()
  })

  it('partitions large returns, reserves only the approved part and keeps new deposits out of the signature', async () => {
    const f = await funded(stakingFixture({ maxTxBytes: 650 }), 1)
    f.unspent.set(f.address, Array.from({ length: 6 }, (_, vout) => ({ txid: f.id, vout, value: 10000000n, status: { confirmed: true } })))
    const preview = await f.service.buildWithdrawal({ address: f.address, amountAtomic: '0', max: true })
    expect(preview.remainingParts).toBeGreaterThan(0)
    expect(preview.sizeUpperBound).toBeLessThanOrEqual(650)
    f.unspent.get(f.address)!.push({ txid: f.id, vout: 8, value: 10000000n, status: { confirmed: true } })
    await f.service.confirm(preview.draftId)
    expect(f.data().operations[0]!.unsigned.inputs).toHaveLength(preview.inputCount)
    expect((await f.service.reservedOutpoints()).size).toBe(preview.inputCount)
    expect((await f.service.buildWithdrawal({ address: f.address, amountAtomic: '0', max: true })).inputCount).toBeGreaterThan(0)
  })
})

describe('journal validation and delegated-key return tracking', () => {
  it.each(['ecdsa', 'falcon512'] as const)('rejects retired %s records with or without operations without rewriting the journal', async (algo) => {
    const f = stakingFixture(), draft = await f.service.buildFunding(funding)
    await f.service.confirm(draft.draftId)
    const current = f.data()
    let disk = JSON.stringify(current)
    const write = vi.fn(async (blob: string) => { disk = blob })
    const store = new DelegationMetaStore({ read: async () => disk, write },
      { openData: async (blob) => blob, sealData: async (blob) => blob }, 'wallet', 'testnet')
    f.store.load = () => store.load()
    for (const derivationId of ['staking-owner-v1', 'unknown-version']) {
      for (const operations of [[], current.operations]) {
        disk = JSON.stringify({ ...current, operations, records: current.records.map((r) => ({ ...r,
          owner: { kind: 'hd', derivationId, algo }, ownerHashHex: '11'.repeat(algo === 'ecdsa' ? 20 : 32) })) })
        const original = disk
        await expect(store.load()).rejects.toThrow(/Unknown staking derivation/)
        await expect(f.make(new SpendCoordinator()).refresh()).rejects.toThrow(/Unknown staking derivation/)
        expect(disk).toBe(original)
      }
    }
    expect(write).not.toHaveBeenCalled()
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
    disk = JSON.stringify({ ...current, operations: [{ address: current.records[0]!.address, state: 'pending' }] })
    await expect(store.load()).rejects.toThrow(/Invalid operation/)
  })

  it('restores branch 2 and authenticates the account in saved owners', async () => {
    const f = stakingFixture()
    const master = masterKeyFromSeed(mnemonicToSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'))
    f.wallet.owners = async () => fixedStakingOwners(0)
    f.wallet.publicKey = async (owner) => {
      const key = await deriveStakingKey(master, owner, 'testnet')
      try { return key.publicKey } finally { key.privateKey.fill(0) }
    }
    try {
      const initial = await f.service.buildFunding(funding)
      await f.service.confirm(initial.draftId)
      expect(f.data().records).toHaveLength(2)
      const active = f.data().records.find((r) => r.owner.kind === 'hd' && r.owner.derivationId === 'staking-owner-v2')!
      const valid = structuredClone(f.data())
      for (const account of [undefined, -1, 0.5, 0x80000000]) {
        const records = valid.records.map((r) => r.address === active.address ? { ...r, owner: { ...r.owner, account } } : r)
        expect(() => validateDelegationJournal({ ...valid, records }, 'wallet', 'testnet')).toThrow(/Staking data/)
      }
      const tampered = { ...valid, records: valid.records.map((r) => r.address === active.address ? { ...r, owner: { ...r.owner, account: 1 } } : r) }
      f.setData(tampered)
      await expect(f.make(new SpendCoordinator()).addresses()).rejects.toThrow(/does not belong/)
      // Even with both accounts available, the address must authenticate the full reference.
      f.wallet.owners = async () => [...fixedStakingOwners(0), ...fixedStakingOwners(1)]
      await expect(f.make(new SpendCoordinator()).addresses()).rejects.toThrow(/does not match/)
      f.setData(emptyDelegationJournal('wallet', 'testnet'))
      const current = (await f.make(new SpendCoordinator()).refresh()).addresses
      expect(current).toHaveLength(4)
      expect(new Set(current.map((r) => r.ownerPubkeyhash)).size).toBe(4)
      expect(new Set(current.map((r) => r.address)).size).toBe(4)
    } finally { master.wipePrivateData() }
  })

  it('rejects damaged, cross-wallet and inconsistent signed records instead of dropping them', async () => {
    const f = stakingFixture(), draft = await f.service.buildFunding(funding)
    await f.service.confirm(draft.draftId)
    const valid = f.data()
    expect(validateDelegationJournal(valid, 'wallet', 'testnet')).toEqual(valid)
    expect(() => validateDelegationJournal(valid, 'another wallet', 'testnet')).toThrow(/different wallet/)
    expect(() => validateDelegationJournal(valid, 'wallet', 'mainnet')).toThrow(/different network/)
    expect(() => validateDelegationJournal({ ...valid, operations: [...valid.operations, valid.operations[0]] }, 'wallet', 'testnet')).toThrow(/Staking data/)
    f.setData({ ...valid, operations: [{ ...valid.operations[0]!, txid: 'ff'.repeat(32) }] })
    await expect(f.make(new SpendCoordinator()).addresses()).rejects.toThrow(/inconsistent/)
    const store = new DelegationMetaStore({ read: async () => '{', write: async () => {} }, { openData: async (b) => b, sealData: async (b) => b }, 'wallet', 'testnet')
    await expect(store.load()).rejects.toThrow()
    expect(f.wallet.signFunding).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['ecdsa', false], ['falcon512', false], ['ecdsa', true], ['falcon512', true], ['schnorr', true],
  ] as const)('%s WIF (delegated=%s) unstakes partially to its ordinary address with exact covenant change', async (algo, delegated) => {
    const { wif } = await delegatedKeyFixture(algo, 32, 'testnet')
    if (algo === 'schnorr') setSchnorrEnabled(true)
    const key = await importedKeyFromStored({ wif, algo, address: '' }, 'testnet')
    const ordinary = ordinaryKeyAddress(key, 'testnet')
    const f = stakingFixture()
    f.ordinary.length = 0
    f.wallet.owners = async () => [{ kind: 'key', algo }]
    f.wallet.publicKey = async () => key.publicKey.slice()
    f.wallet.keypair = vi.fn(async () => ({ privateKey: key.privateKey.slice(), publicKey: key.publicKey.slice() }))
    f.wallet.changeAddress = async () => ordinary
    if (delegated) f.wallet.importedDelegate = async () => key.delegation!.delegatePubkeyhash
    try {
      const addresses = await f.service.addresses()
      const address = delegated ? key.address : addresses[0]!.address
      expect(addresses.some((a) => a.address === address)).toBe(true)
      if (delegated) expect(await f.service.info()).toMatchObject({ enabled: true, fundingEnabled: false })
      const id = '77'.repeat(32)
      f.transactions.set(id, chainTx(id))
      f.unspent.set(address, [{ txid: id, vout: 0, value: 1000000n, status: { confirmed: true } }])
      const preview = await f.service.buildWithdrawal({ address, amountAtomic: '300000' })
      expect(preview.destination).toBe(ordinary)
      expect(preview.amountAtomic).toBe('300000')
      await f.service.confirm(preview.draftId)
      const op = f.data().operations[0]!, tx = deserialize(fromHex(op.rawHex!))
      expect(op.unsigned.outputs[1]).toEqual({ scripthash: toHex(decodeAddress(address).scripthash), valueAtomic: preview.changeAtomic })
      expect(BigInt(preview.changeAtomic) + 300000n + BigInt(preview.feeAtomic)).toBe(1000000n)
      expect(tx.inputs[0]!.siglist![2]).toEqual(Uint8Array.of(1))
      expect(await verifySiglistEntry(tx.inputs[0]!.siglist![0]!, sighash(tx, SIGHASH.ALL, sighashCommitsTokenId('testnet')), key.publicKey)).toBe(true)
      expect(BigInt(preview.feeAtomic)).toBeGreaterThanOrEqual(feeForBytes(op.rawHex!.length / 2, 1))
      expect(validateDelegationJournal(JSON.parse(JSON.stringify(f.data())), 'wallet', 'testnet').operations[0]!.preview).toEqual(preview)
      const restored = f.make(new SpendCoordinator())
      await restored.retry(preview.draftId)
      expect(f.wallet.keypair).toHaveBeenCalledTimes(1)
      expect(f.data().operations[0]!.rawHex).toBe(op.rawHex)
    } finally { key.privateKey.fill(0); setSchnorrEnabled(false) }
  })

  it.each(['ecdsa', 'falcon512'] as const)('tracks and signs ordinary returned coins alongside a delegated %s WIF', async (algo) => {
    const { wif } = await delegatedKeyFixture(algo, 32, 'testnet')
    const key = await importedKeyFromStored({ wif, algo, address: '' }, 'testnet')
    try {
      const branch = (await createKeyAddressSource(async () => key, 'testnet').branches())[0]!
      const ordinary = addressFromPubkey(key.publicKey, algo, 'testnet')
      expect(ordinaryKeyAddress(key, 'testnet')).toBe(ordinary)
      expect(ordinaryKeyAddress(key, 'testnet')).not.toBe(key.address)
      expect(branch).toMatchObject({ kind: 'list', addresses: [{ address: key.address }, { address: ordinary }] })
      const unsigned = { inputs: [0, 1].map((vout) => ({ prevTxid: '12'.repeat(32), vout, valueAtomic: '10000', account: 0, chain: 0 as const, index: 0, algo,
        keyScript: vout === 0 ? 'delegated' as const : 'ordinary' as const })), outputs: [{ valueAtomic: '15000', scripthash: toHex(decodeAddress(ordinary).scripthash) }] }
      const signed = deserialize(fromHex((await signUnsignedTxWithKey(unsigned, key, 'testnet')).rawHex))
      expect(signed.inputs[0]!.redeemScript).toEqual(key.delegation!.redeemScript)
      expect(signed.inputs[1]!.redeemScript).toEqual(scriptP2PK(key.publicKey))
      expect(signed.inputs[1]!.siglist).toHaveLength(1)
      for (const input of signed.inputs) expect(await verifySiglistEntry(input.siglist![0]!, sighash(toCryptoTransaction(unsigned), SIGHASH.ALL, sighashCommitsTokenId('testnet')), key.publicKey)).toBe(true)
    } finally { key.privateKey.fill(0) }
  })
})

describe('staking availability without a configured service', () => {
  it('keeps Staking hidden for an ordinary imported key', async () => {
    const f = stakingFixture({ profiles: [] })
    expect(await f.service.info()).toMatchObject({ enabled: false, fundingEnabled: false })
  })

  it('keeps Staking available to an imported delegated key so it can withdraw', async () => {
    const { wif } = await delegatedKeyFixture('ecdsa', 32, 'testnet')
    const key = await importedKeyFromStored({ wif, algo: 'ecdsa', address: '' }, 'testnet')
    try {
      const f = stakingFixture({ profiles: [] })
      f.wallet.importedDelegate = async () => key.delegation!.delegatePubkeyhash
      expect(await f.service.info()).toMatchObject({ enabled: true, fundingEnabled: false })
    } finally { key.privateKey.fill(0) }
  })
})
