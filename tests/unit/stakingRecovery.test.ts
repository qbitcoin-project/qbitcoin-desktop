import { ChainError } from '@qbtc/chain'
import { deserialize, fromHex, masterKeyFromSeed, mnemonicToSeed, sighash, toHex, verifySiglistEntry } from '@qbtc/crypto'
import { describe, expect, it, vi } from 'vitest'
import { addressFromPubkey, decodeAddress, sighashCommitsTokenId } from '../../src/main/brand/crypto'
import { STAKE_MATURITY } from '../../src/main/brand/staking'
import { deriveStakingKey, fixedStakingOwners } from '../../src/main/wallet/stakingKeys'
import { importedKeyFromStored, ordinaryKeyAddress, signUnsignedTxWithKey } from '../../src/main/wallet/keyWallet'
import { deriveInputKeypair, signUnsignedTx } from '../../src/main/wallet/signTx'
import { validateDelegationJournal } from '../../src/main/wallet/delegationStore'
import { chainTx, stakingFixture } from '../fixtures/staking'
import { delegatedKeyFixture } from '../fixtures/delegatedKey'
import type * as brandDelegation from '../../src/main/brand/delegation'

vi.mock('../../src/main/brand/delegation', async (original) => {
  const { TEST_STAKING_DERIVATION } = await import('../fixtures/stakingDerivation')
  return { ...await original<typeof brandDelegation>(), STAKING_DERIVATIONS: [TEST_STAKING_DERIVATION] }
})

const funding = { algo: 'ecdsa' as const, amountAtomic: '10000000' }

async function pendingFunding() {
  const f = stakingFixture(), draft = await f.service.buildFunding(funding)
  await f.service.confirm(draft.draftId)
  const original = f.data().operations[0]!, input = original.unsigned.inputs[0]!, outpoint = `${input.prevTxid}:${input.vout}`
  f.spent.set(outpoint, { spent: true, txid: original.txid! })
  f.ordinary.length = 0
  return { ...f, original, input, outpoint }
}

for (const hd of [false, true]) for (const algo of ['ecdsa', 'falcon512'] as const) for (const kind of ['funding', 'withdrawal'] as const) {
  it(`recovers mempool ${kind} for ${hd ? 'HD' : 'WIF'} ${algo} after its inputs disappear from UTXO lists`, async () => {
    const f = stakingFixture(), master = masterKeyFromSeed(mnemonicToSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'))
    const { wif } = await delegatedKeyFixture(algo, 32, 'testnet')
    const key = await importedKeyFromStored({ wif, address: '', algo }, 'testnet')
    const ordinary = hd ? await deriveInputKeypair(master, { account: 0, chain: 1, index: 3, algo }, 'testnet') : key
    const ordinaryAddress = hd ? addressFromPubkey(ordinary.publicKey, algo, 'testnet') : ordinaryKeyAddress(key, 'testnet')
    try {
      if (hd) {
        f.wallet.owners = async () => fixedStakingOwners(0)
        f.wallet.publicKey = async (owner) => { const pair = await deriveStakingKey(master, owner, 'testnet'); pair.privateKey.fill(0); return pair.publicKey }
        f.wallet.keypair = (owner) => deriveStakingKey(master, owner, 'testnet')
        f.wallet.ordinaryInputAddress = async (input) => { const pair = await deriveInputKeypair(master, input, 'testnet'); pair.privateKey.fill(0); return addressFromPubkey(pair.publicKey, input.algo, 'testnet') }
        f.wallet.signFunding = vi.fn((tx) => signUnsignedTx(tx, master, 'testnet'))
      } else {
        f.wallet.owners = async () => [{ kind: 'key', algo }]
        f.wallet.publicKey = async () => key.publicKey.slice()
        f.wallet.keypair = async () => ({ privateKey: key.privateKey.slice(), publicKey: key.publicKey.slice() })
        f.wallet.ordinaryInputAddress = async () => ordinaryAddress
        f.wallet.signFunding = vi.fn((tx) => signUnsignedTxWithKey(tx, key, 'testnet'))
        if (kind === 'withdrawal') f.wallet.importedDelegate = async () => key.delegation!.delegatePubkeyhash
      }
      f.wallet.changeAddress = async () => ordinaryAddress
      const sourceId = 'ab'.repeat(32), address = (await f.service.addresses()).find((entry) => entry.algo === algo)!.address
      const sourceAddress = kind === 'funding' ? ordinaryAddress : address
      f.transactions.set(sourceId, chainTx(sourceId, { version: 2, vout: [{ value: 200000000n,
        address: sourceAddress, scripthash: toHex(decodeAddress(sourceAddress).scripthash) }] }))
      f.ordinary[0] = { txid: sourceId, vout: 0, value: 200000000n, confirmed: true, address: ordinaryAddress, algo, chain: 1, index: 3, keyScript: 'ordinary' }
      f.unspent.set(address, [{ txid: sourceId, vout: 0, value: 200000000n, status: { confirmed: true } }])
      const draft = kind === 'funding' ? await f.service.buildFunding({ ...funding, algo })
        : await f.service.buildWithdrawal({ address, amountAtomic: '10000000' })
      await f.service.confirm(draft.draftId)
      const original = f.data().operations[0]!
      f.spent.set(`${sourceId}:0`, { spent: true, txid: original.txid! })
      f.unspent.set(address, []); f.ordinary.length = 0
      // Reconstruct ownership from durable data, without a cached UTXO pool.
      const restarted = f.make(), preview = await restarted.buildRecovery(original.id)
      expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
      expect(f.data().operations).toHaveLength(1)
      expect(preview.destination).toBe(ordinaryAddress)
      expect(BigInt(preview.feeAtomic)).toBeGreaterThan(BigInt(original.feeAtomic))
      expect(BigInt(preview.amountAtomic) + BigInt(preview.feeAtomic)).toBe(200000000n)
      expect((await restarted.confirm(preview.draftId)).state).toBe('pending')
      const recovery = f.data().operations[1]!, tx = deserialize(fromHex(recovery.rawHex!))
      expect(recovery.unsigned.inputs).toEqual(original.unsigned.inputs)
      expect(tx.outputs).toHaveLength(1)
      expect(tx.outputs[0]!.scripthash).toEqual(decodeAddress(ordinaryAddress).scripthash)
      const digest = sighash(tx, 1, sighashCommitsTokenId('testnet'))
      const publicKey = kind === 'funding' ? ordinary.publicKey : tx.inputs[0]!.siglist![1]!
      expect(await verifySiglistEntry(tx.inputs[0]!.siglist![0]!, digest, publicKey)).toBe(true)
      expect(f.data().operations[0]!.autoRetry).toBe(false)
      expect((await restarted.reservedOutpoints()).size).toBe(1)
      expect(validateDelegationJournal(f.data(), 'wallet', 'testnet')).toEqual(f.data())
      expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(2)
    } finally { if (hd) ordinary.privateKey.fill(0); key.privateKey.fill(0); master.wipePrivateData() }
  })
}

describe('recovery revalidation and outcome', () => {
  it.each(['before preview', 'after preview', 'after signing'] as const)('does not broadcast recovery if the original confirms %s', async (when) => {
    const f = await pendingFunding()
    const confirmed = () => f.transactions.set(f.original.txid!, chainTx(f.original.txid!))
    if (when === 'before preview') {
      confirmed()
      await expect(f.service.buildRecovery(f.original.id)).rejects.toThrow(/already confirmed/)
    } else {
      const preview = await f.service.buildRecovery(f.original.id)
      if (when === 'after preview') {
        confirmed()
        await expect(f.service.confirm(preview.draftId)).rejects.toThrow(/already confirmed/)
      } else {
        const sign = f.wallet.signFunding
        f.wallet.signFunding = async (tx) => { const result = await sign(tx); confirmed(); return result }
        expect((await f.service.confirm(preview.draftId)).state).toBe('conflict')
      }
    }
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
  })

  it.each(['pending', 'confirmed', 'missing id'] as const)('refuses an unrelated %s spender', async (state) => {
    const f = await pendingFunding(), id = 'cc'.repeat(32)
    f.transactions.set(id, chainTx(id, { status: { confirmed: state === 'confirmed' } }))
    f.spent.set(f.outpoint, { spent: true, ...(state !== 'missing id' ? { txid: id } : {}) })
    await expect(f.service.buildRecovery(f.original.id)).rejects.toThrow(/Another transaction/)
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
  })

  it.each(['wrong value', 'wrong script', 'token', 'unconfirmed', 'missing output', 'immature', 'unknown maturity'] as const)('refuses a source output with %s', async (fault) => {
    const f = await pendingFunding()
    let source = structuredClone(f.transactions.get(f.input.prevTxid)!)
    if (fault === 'wrong value') source = { ...source, vout: [{ ...source.vout[0]!, value: source.vout[0]!.value + 1n }] }
    if (fault === 'wrong script') source = { ...source, vout: [{ ...source.vout[0]!, scripthash: 'ff'.repeat(20) }] }
    if (fault === 'token') source = { ...source, vout: [{ ...source.vout[0]!, tokenId: 'ff'.repeat(32) }] }
    if (fault === 'unconfirmed') source = { ...source, status: { confirmed: false } }
    if (fault === 'missing output') source = { ...source, vout: [] }
    if (fault === 'immature' || fault === 'unknown maturity') {
      source = { ...source, version: 2, status: { confirmed: true, ...(fault === 'immature' ? { blockTime: Math.floor(Date.now() / 1000) } : {}) } }
    }
    f.transactions.set(source.txid, source)
    await expect(f.service.buildRecovery(f.original.id)).rejects.toThrow(/could not be verified|not mature/)
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
  })

  it('allows an ordinary native output of a token transaction and checks stake maturity from its current source', async () => {
    const f = await pendingFunding(), source = f.transactions.get(f.input.prevTxid)!
    f.transactions.set(source.txid, { ...source, version: 4 })
    await expect(f.service.buildRecovery(f.original.id)).resolves.toMatchObject({ recoveryOf: f.original.id })
    f.transactions.set(source.txid, { ...source, version: 2, status: { confirmed: true, blockTime: Math.floor(Date.now() / 1000) - STAKE_MATURITY.testnet - 1 } })
    const preview = await f.service.buildRecovery(f.original.id)
    expect(preview.eligibleAt).toBeLessThan(Date.now() / 1000)
  })

  it('fails closed on source/outspend errors or inconsistent original status', async () => {
    const f = await pendingFunding(), read = f.reader.getTransaction
    f.reader.getTransaction = async (id) => { if (id === f.input.prevTxid) throw new ChainError('timeout', 'source timeout'); return read(id) }
    await expect(f.service.buildRecovery(f.original.id)).rejects.toThrow('source timeout')
    f.reader.getTransaction = read
    vi.mocked(f.reader.getOutspend).mockRejectedValueOnce(new ChainError('timeout', 'spend timeout'))
    await expect(f.service.buildRecovery(f.original.id)).rejects.toThrow('spend timeout')
    f.transactions.delete(f.original.txid!)
    await expect(f.service.buildRecovery(f.original.id)).rejects.toThrow('Not found')
    f.spent.delete(f.outpoint)
    await expect(f.service.buildRecovery(f.original.id)).resolves.toMatchObject({ recoveryOf: f.original.id })
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
  })

  it('rechecks frozen inputs immediately before sending and again on retry, without signing another recovery', async () => {
    const f = await pendingFunding(), preview = await f.service.buildRecovery(f.original.id), sign = f.wallet.signFunding
    f.wallet.signFunding = async (tx) => { const result = await sign(tx); f.wallet.recoveryExcludedOutpoints = async () => new Set([f.outpoint]); return result }
    expect((await f.service.confirm(preview.draftId)).state).toBe('signed')
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
    expect((await f.service.retry(preview.draftId)).state).toBe('signed')
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
    f.wallet.recoveryExcludedOutpoints = async () => new Set()
    expect((await f.service.retry(preview.draftId)).state).toBe('pending')
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(2)
    expect(sign).toHaveBeenCalledTimes(2)
  })

  it('retries identical recovery bytes after timeout and restart while the original remains in mempool', async () => {
    const f = await pendingFunding()
    vi.mocked(f.reader.broadcastTransaction).mockRejectedValue(new ChainError('timeout', 'lost response'))
    const preview = await f.service.buildRecovery(f.original.id)
    await f.service.confirm(preview.draftId)
    const raw = f.data().operations[1]!.rawHex
    await f.make().retry(preview.draftId)
    expect(vi.mocked(f.reader.broadcastTransaction).mock.calls.slice(1).map(([hex]) => hex)).toEqual([raw, raw])
    expect(f.wallet.signFunding).toHaveBeenCalledTimes(2)
    expect((await f.service.reservedOutpoints()).size).toBe(1)
  })

  it.each(['original', 'recovery'] as const)('observes %s winning even if the loser still appears pending, then restores reservations after a reorg', async (winnerName) => {
    const f = await pendingFunding(), preview = await f.service.buildRecovery(f.original.id)
    await f.service.confirm(preview.draftId)
    const recovery = f.data().operations[1]!, winner = winnerName === 'original' ? f.original : recovery, loser = winnerName === 'original' ? recovery : f.original
    f.transactions.set(winner.txid!, chainTx(winner.txid!, { status: { confirmed: true, blockHeight: 100 } }))
    f.spent.set(f.outpoint, { spent: true, txid: winner.txid! })
    f.reader.getBlockchainInfo = async () => ({ tipHeight: 105 })
    await f.service.refresh()
    expect(f.data().operations.find((op) => op.id === winner.id)).toMatchObject({ state: 'confirmed', settled: true })
    expect(f.data().operations.find((op) => op.id === loser.id)).toMatchObject({ state: 'conflict', autoRetry: false })
    expect((await f.service.reservedOutpoints()).size).toBe(0)
    f.transactions.set(winner.txid!, chainTx(winner.txid!, { status: { confirmed: false } }))
    const restarted = f.make()
    await restarted.refresh()
    expect(f.data().operations.every((op) => op.state === 'pending' && !op.settled && op.autoRetry === false)).toBe(true)
    expect((await restarted.reservedOutpoints()).has(f.outpoint)).toBe(true)
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(2)
    // The winner can switch after a reorg; the former conflict must be observed.
    f.transactions.set(loser.txid!, chainTx(loser.txid!))
    f.spent.set(f.outpoint, { spent: true, txid: loser.txid! })
    await restarted.refresh()
    expect(f.data().operations.find((op) => op.id === loser.id)!.state).toBe('confirmed')
    expect(f.data().operations.find((op) => op.id === winner.id)!.state).toBe('conflict')
  })

  it('does not bypass pending conflicts for an ordinary operation without a recovery link', async () => {
    const f = await pendingFunding(), foreign = 'dd'.repeat(32)
    f.transactions.delete(f.original.txid!)
    f.transactions.set(foreign, chainTx(foreign, { status: { confirmed: false } }))
    f.spent.set(f.outpoint, { spent: true, txid: foreign })
    await f.service.retry(f.original.id)
    expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
    expect(f.data().operations[0]!.message).toContain('competing transaction is pending')
  })
})

it('recovers mixed HD funding with both original derivation paths and one shared source read', async () => {
  const f = stakingFixture(), master = masterKeyFromSeed(mnemonicToSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'))
  const sourceId = 'ac'.repeat(32)
  try {
    f.wallet.owners = async () => fixedStakingOwners(0)
    f.wallet.publicKey = async (owner) => { const pair = await deriveStakingKey(master, owner, 'testnet'); pair.privateKey.fill(0); return pair.publicKey }
    f.wallet.ordinaryInputAddress = async (input) => { const pair = await deriveInputKeypair(master, input, 'testnet'); pair.privateKey.fill(0); return addressFromPubkey(pair.publicKey, input.algo, 'testnet') }
    f.wallet.signFunding = (tx) => signUnsignedTx(tx, master, 'testnet')
    f.ordinary.length = 0
    for (const [index, algo] of (['ecdsa', 'falcon512'] as const).entries()) {
      const pair = await deriveInputKeypair(master, { account: 0, chain: 1, index: index + 2, algo }, 'testnet')
      f.ordinary.push({ txid: sourceId, vout: index, value: 6000000n, confirmed: true, address: addressFromPubkey(pair.publicKey, algo, 'testnet'), algo, chain: 1, index: index + 2 })
      pair.privateKey.fill(0)
    }
    f.wallet.changeAddress = async (algo) => f.ordinary.find((coin) => coin.algo === algo)!.address
    f.transactions.set(sourceId, chainTx(sourceId, { vout: f.ordinary.map((coin) => ({ value: coin.value, address: coin.address, scripthash: toHex(decodeAddress(coin.address).scripthash) })) }))
    const preview = await f.service.buildFunding(funding)
    await f.service.confirm(preview.draftId)
    const original = f.data().operations[0]!
    expect(original.unsigned.inputs).toHaveLength(2)
    for (const input of original.unsigned.inputs) f.spent.set(`${input.prevTxid}:${input.vout}`, { spent: true, txid: original.txid! })
    f.ordinary.length = 0
    vi.mocked(f.reader.getTransaction).mockClear()
    const recovery = await f.service.buildRecovery(original.id)
    expect(vi.mocked(f.reader.getTransaction).mock.calls.filter(([id]) => id === sourceId)).toHaveLength(1)
    await f.service.confirm(recovery.draftId)
    const saved = f.data().operations[1]!, tx = deserialize(fromHex(saved.rawHex!)), digest = sighash(tx, 1, sighashCommitsTokenId('testnet'))
    expect(saved.unsigned.inputs).toEqual(original.unsigned.inputs)
    for (const [index, input] of saved.unsigned.inputs.entries()) {
      const pair = await deriveInputKeypair(master, input, 'testnet')
      try { expect(await verifySiglistEntry(tx.inputs[index]!.siglist![0]!, digest, pair.publicKey)).toBe(true) }
      finally { pair.privateKey.fill(0) }
    }
    expect(saved.state).toBe('pending')
  } finally { master.wipePrivateData() }
})

it('keeps reservations and refuses recovery when another wallet action reserved an input after review', async () => {
  const f = await pendingFunding(), preview = await f.service.buildRecovery(f.original.id)
  f.wallet.recoveryExcludedOutpoints = async () => new Set([f.outpoint])
  await expect(f.service.confirm(preview.draftId)).rejects.toThrow(/coins changed/)
  expect(f.data().operations).toHaveLength(1)
  expect((await f.service.reservedOutpoints()).has(f.outpoint)).toBe(true)
  expect(f.reader.broadcastTransaction).toHaveBeenCalledTimes(1)
})
