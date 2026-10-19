import { deserialize, fromHex, masterKeyFromSeed, mnemonicToSeed, toHex } from '@qbtc/crypto'
import { describe, expect, it, vi } from 'vitest'
import { addressFromPubkey, addressFromScripthash, decodeAddress } from '../../src/main/brand/crypto'
import { AddressService } from '../../src/main/wallet/AddressService'
import { WalletMetaStore } from '../../src/main/wallet/meta'
import { GAP_LIMIT_CHANGE } from '../../src/main/wallet/discovery'
import { deriveInputKeypair, signUnsignedTx } from '../../src/main/wallet/signTx'
import { SendService, type SendDeps } from '../../src/main/wallet/SendService'
import { buildSend, feeForDraft, type ChangeBranch, type UnsignedTx } from '../../src/main/wallet/buildTx'
import { buildWithChange } from '../../src/main/wallet/buildWithChange'
import { stakingFixture, ZERO_STATS } from '../fixtures/staking'

const master = masterKeyFromSeed(mnemonicToSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'))
const recipient = addressFromScripthash(new Uint8Array(20).fill(3), 'testnet')
const other = (algo: ChangeBranch): ChangeBranch => algo === 'ecdsa' ? 'falcon512' : 'ecdsa'

async function fixture(algo: ChangeBranch, full: readonly ChangeBranch[]) {
  let blob: string | null = null
  const meta = new WalletMetaStore({ read: async () => blob, write: async (s) => { blob = s } }, { openData: async (s) => s, sealData: async (s) => s })
  const reserved = new Set<string>()
  const addresses = new AddressService({ getMasterKey: async () => master, on: () => () => {} }, meta, 'testnet', 0, {
    lookup: { getAddressInfo: async (address) => ({ address, chain: ZERO_STATS, mempool: ZERO_STATS, tokens: {} }) },
    reserved: async () => reserved, check: () => {},
  })
  const allocate = (branch: ChangeBranch) => branch === 'ecdsa' ? addresses.getChangeAddress() : addresses.getPqChangeAddress()
  for (const branch of full) for (let i = 0; i < GAP_LIMIT_CHANGE; i++) reserved.add(await allocate(branch))
  const f = stakingFixture()
  const pair = await deriveInputKeypair(master, { account: 0, chain: 0, index: 0, algo }, 'testnet')
  const address = addressFromPubkey(pair.publicKey, algo, 'testnet')
  pair.privateKey.fill(0)
  f.ordinary[0] = { ...f.ordinary[0]!, address, algo }
  const changeAddress = vi.fn(allocate)
  f.wallet.changeAddress = changeAddress
  f.wallet.consumeChange = (branch, expected) => addresses.recordChangeAddress(branch, expected)
  f.wallet.signFunding = (unsigned) => signUnsignedTx(unsigned, master, 'testnet')
  const signed: UnsignedTx[] = []
  const deps: SendDeps = {
    gather: async () => f.ordinary, feeRate: async () => 1, frozen: async () => new Set(),
    getChangeAddress: () => changeAddress('ecdsa'), getPqChangeAddress: () => changeAddress('falcon512'),
    advanceChange: (branch) => branch === 'ecdsa' ? addresses.advanceChange() : addresses.advancePqChange(),
    sign: async (unsigned) => { signed.push(unsigned); return signUnsignedTx(unsigned, master, 'testnet') },
    broadcast: vi.fn(async () => 'signed-tx'),
  }
  return { ...f, addresses, allocate, changeAddress, send: new SendService(deps), deps, signed }
}

describe.each(['ecdsa', 'falcon512'] as const)('only required %s change is allocated', (algo) => {
  it('funds staking with the other branch full and signs only real wallet outputs', async () => {
    const f = await fixture(algo, [other(algo)]), expected = await f.allocate(algo)
    const preview = await f.service.buildFunding({ algo: 'ecdsa', amountAtomic: '10000000' })
    expect(f.changeAddress.mock.calls).toEqual([[algo]])
    await f.service.confirm(preview.draftId)
    const op = f.data().operations[0]!
    expect(op.changeAddress).toBe(expected)
    expect(op.changeAlgo).toBe(algo)
    const signed = deserialize(fromHex(op.rawHex!))
    expect(toHex(signed.outputs[1]!.scripthash)).toBe(toHex(decodeAddress(expected).scripthash))
    expect(BigInt(preview.feeAtomic)).toBeGreaterThanOrEqual(feeForDraft(f.ordinary, op.unsigned, 1))
    expect(signed.outputs[0]!.data?.[0]).toBe(0x44)
    expect(f.changeAddress.mock.calls).toEqual([[algo], [algo]]) // recheck only the selected branch before signing
  })

  it('sends ordinary coins with the other branch full, including manual selection', async () => {
    const f = await fixture(algo, [other(algo)]), expected = await f.allocate(algo)
    for (const manual of [false, true]) {
      const preview = await f.send.buildSend(recipient, 10000000n, manual ? [`${f.ordinary[0]!.txid}:0`] : undefined)
      await f.send.confirmSend()
      const unsigned = f.signed.at(-1)!
      expect(unsigned.outputs[1]!.scripthash).toBe(toHex(decodeAddress(expected).scripthash))
      expect(BigInt(preview.feeAtomic)).toBeGreaterThanOrEqual(feeForDraft(f.ordinary, unsigned, 1))
    }
    expect(f.changeAddress.mock.calls).toEqual([[algo], [algo]])
  })

  it('allows funding Max and Send Max with both change gaps full and does not allocate change', async () => {
    const f = await fixture(algo, ['ecdsa', 'falcon512'])
    const preview = await f.service.buildFunding({ algo: 'ecdsa', amountAtomic: '0', max: true })
    expect(preview.changeAtomic).toBe('0')
    await f.service.confirm(preview.draftId)
    expect(f.data().operations[0]!.unsigned.outputs).toHaveLength(1)
    expect(f.changeAddress).not.toHaveBeenCalled()
    const ordinary = await fixture(algo, ['ecdsa', 'falcon512'])
    const max = await ordinary.send.maxSendable()
    expect((await ordinary.send.buildSend(recipient, 0n, undefined, true)).amountAtomic).toBe(max.amountAtomic)
    await ordinary.send.confirmSend()
    expect(ordinary.signed[0]!.outputs).toHaveLength(1)
    expect(ordinary.changeAddress).not.toHaveBeenCalled()
  })

  it('still blocks a full branch when the transaction actually needs its change', async () => {
    const f = await fixture(algo, [algo])
    await expect(f.service.buildFunding({ algo: 'ecdsa', amountAtomic: '10000000' })).rejects.toThrow(/recoverable change-address range/)
    await expect(f.send.buildSend(recipient, 10000000n)).rejects.toThrow(/recoverable change-address range/)
    expect(f.reader.broadcastTransaction).not.toHaveBeenCalled()
    expect(f.deps.broadcast).not.toHaveBeenCalled()
    expect(f.changeAddress.mock.calls).toEqual([[algo], [algo]])
  })

  it('allows an explicitly entered changeless amount with both gaps full', async () => {
    const f = await fixture(algo, ['ecdsa', 'falcon512'])
    const max = await f.send.maxSendable()
    const preview = await f.send.buildSend(recipient, BigInt(max.amountAtomic))
    await f.send.confirmSend()
    expect(preview.changeAtomic).toBe('0')
    expect(f.signed[0]!.outputs).toHaveLength(1)
    expect(f.changeAddress).not.toHaveBeenCalled()
  })

  it('gets one shared address for token and native change without requesting the other branch', async () => {
    const f = await fixture(algo, [other(algo)]), tokenId = 'ab'.repeat(32), expected = await f.allocate(algo)
    const token = { ...f.ordinary[0]!, txid: 'ac'.repeat(32), value: 0n, tokenId, tokenAmount: 100n }
    f.ordinary.push(token)
    const preview = await f.send.buildTokenSend(tokenId, recipient, 30n)
    await f.send.confirmSend()
    const unsigned = f.signed[0]!
    expect(unsigned.outputs).toHaveLength(3)
    expect(unsigned.outputs.slice(1).map((o) => o.scripthash)).toEqual(Array(2).fill(toHex(decodeAddress(expected).scripthash)))
    expect(BigInt(preview.feeAtomic)).toBeGreaterThanOrEqual(feeForDraft(f.ordinary, unsigned, 1))
    expect(f.changeAddress.mock.calls).toEqual([[algo]])
  })
})

it('allocates both branches when token and native change actually require different algorithms', async () => {
  const f = await fixture('ecdsa', []), tokenId = 'bc'.repeat(32)
  const pair = await deriveInputKeypair(master, { account: 0, chain: 0, index: 0, algo: 'falcon512' }, 'testnet')
  const address = addressFromPubkey(pair.publicKey, 'falcon512', 'testnet')
  pair.privateKey.fill(0)
  f.ordinary.push({ ...f.ordinary[0]!, txid: 'bd'.repeat(32), value: 0n, algo: 'falcon512', address, tokenId, tokenAmount: 100n })
  const expected = [await f.allocate('falcon512'), await f.allocate('ecdsa')]
  const preview = await f.send.buildTokenSend(tokenId, recipient, 30n)
  await f.send.confirmSend()
  const unsigned = f.signed[0]!
  expect(unsigned.outputs.slice(1).map((o) => o.scripthash)).toEqual(expected.map((a) => toHex(decodeAddress(a).scripthash)))
  expect(BigInt(preview.feeAtomic)).toBeGreaterThanOrEqual(feeForDraft(f.ordinary, unsigned, 1))
  expect(f.changeAddress.mock.calls).toEqual([['falcon512'], ['ecdsa']])
})

it('does not mistake a recipient equal to a planning hash for a change output', async () => {
  const zeroRecipient = addressFromScripthash(new Uint8Array(20), 'testnet')
  const f = await fixture('ecdsa', [])
  const { built } = await buildWithChange(zeroRecipient, (changeAddressFor) => buildSend({
    utxos: f.ordinary, recipient: zeroRecipient, amountAtomic: 10000000n, feeAtomic: 1000n, changeAddressFor,
  }), f.changeAddress)
  expect(built.unsigned.outputs[0]!.scripthash).toBe('00'.repeat(20))
  expect(built.unsigned.outputs[1]!.scripthash).not.toBe('00'.repeat(20))
})

it('allocates by the final inputs after the fee makes an initially selected Falcon coin insufficient', async () => {
  const f = await fixture('ecdsa', ['falcon512'])
  const pair = await deriveInputKeypair(master, { account: 0, chain: 0, index: 0, algo: 'falcon512' }, 'testnet')
  const address = addressFromPubkey(pair.publicKey, 'falcon512', 'testnet')
  pair.privateKey.fill(0)
  f.ordinary.push({ ...f.ordinary[0]!, txid: 'de'.repeat(32), value: 10000500n, algo: 'falcon512', address })
  const send = await f.send.buildSend(recipient, 10000000n)
  expect(send.signature).toBe('ECDSA')
  const funding = await f.service.buildFunding({ algo: 'ecdsa', amountAtomic: '10000000' })
  expect(funding.inputAlgorithms).toEqual(['ecdsa'])
  expect(f.changeAddress.mock.calls).toEqual([['ecdsa'], ['ecdsa']])
})

it('sends the exact token balance with dust folded into the native fee even when both gaps are full', async () => {
  const f = await fixture('ecdsa', ['ecdsa', 'falcon512']), tokenId = 'ad'.repeat(32)
  f.ordinary[0] = { ...f.ordinary[0]!, value: 1000n }
  f.ordinary.push({ ...f.ordinary[0]!, txid: 'ae'.repeat(32), value: 0n, tokenId, tokenAmount: 100n })
  const preview = await f.send.buildTokenSend(tokenId, recipient, 100n)
  await f.send.confirmSend()
  expect(f.signed[0]!.outputs).toHaveLength(1)
  expect(BigInt(preview.feeAtomic)).toBeGreaterThanOrEqual(feeForDraft(f.ordinary, f.signed[0]!, 1))
  expect(f.changeAddress).not.toHaveBeenCalled()
})

it.each(['network', 'algorithm'] as const)('refuses a mismatched %s change address before a draft can be held or signed', async (mismatch) => {
  const f = await fixture('ecdsa', [])
  f.deps.getChangeAddress = async () => addressFromScripthash(new Uint8Array(mismatch === 'algorithm' ? 32 : 20).fill(4), mismatch === 'network' ? 'mainnet' : 'testnet')
  await expect(f.send.buildSend(recipient, 10000000n)).rejects.toThrow(/does not match/)
  await expect(f.send.confirmSend()).rejects.toThrow(/No transaction/)
  expect(f.signed).toHaveLength(0)
})
