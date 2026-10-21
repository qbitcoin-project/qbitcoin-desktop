import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deserialize, fromHex, setSchnorrEnabled } from '@qbtc/crypto'
import { addressFromScripthash, encodeWif } from '../../src/main/crypto'
import { SendService } from '../../src/main/wallet/SendService'
import { buildSend, estimateSendFee, feeForDraft, InsufficientFundsError } from '../../src/main/wallet/buildTx'
import { decodeWalletWif } from '../../src/main/wallet/keyWif'
import { importedKeyFromWif, keyInputBytes, ordinaryKeyAddress, signUnsignedTxWithKey, type ImportedKey } from '../../src/main/wallet/keyWallet'
import type { GatheredUtxo } from '../../src/main/wallet/spendable'
import { delegatedKeyFixture } from '../fixtures/delegatedKey'

const TOKEN = 'ab'.repeat(32)
const keys = new Map<string, ImportedKey>()
beforeAll(async () => {
  setSchnorrEnabled(true)
  for (const algo of ['ecdsa', 'schnorr', 'falcon512'] as const) {
    const { wif } = await delegatedKeyFixture(algo)
    keys.set(`${algo}-delegated`, await importedKeyFromWif(wif, 'mainnet', algo))
    const decoded = decodeWalletWif(wif, 'mainnet')
    const ordinary = encodeWif(decoded.payload, 'mainnet')
    decoded.payload.fill(0)
    keys.set(`${algo}-ordinary`, await importedKeyFromWif(ordinary, 'mainnet', algo))
  }
})
afterAll(() => { for (const key of keys.values()) key.privateKey.fill(0); setSchnorrEnabled(false) })

const coin = (key: ImportedKey, n: number, value: bigint): GatheredUtxo => ({
  txid: n.toString(16).padStart(64, '0'), vout: n % 2 === 0 ? 65536 : 253,
  value, algo: key.algo, chain: 0, index: 0, address: key.address, confirmed: true,
  ...(keyInputBytes(key) !== undefined ? { inputBytes: keyInputBytes(key) } : {}),
})
function service(key: ImportedKey, coins: GatheredUtxo[], rate: number) {
  const sent: string[] = []
  // Exercise covenant witness sizes too, but return change to the ordinary
  // owner address as the wallet does; change is not another delegated output.
  const change = ordinaryKeyAddress(key, 'mainnet')
  const svc = new SendService({ gather: async () => coins, feeRate: async () => rate, frozen: async () => new Set(),
    getChangeAddress: async () => change, getPqChangeAddress: async () => change, advanceChange: async () => {},
    sign: (unsigned) => signUnsignedTxWithKey(unsigned, key, 'mainnet'),
    broadcast: async (raw) => { sent.push(raw); return 'test-txid' },
  })
  return { svc, sent }
}
function assertPaid(raw: string, fee: string, rate: number, coins: GatheredUtxo[]) {
  const bytes = fromHex(raw), tx = deserialize(bytes)
  const inputSum = tx.inputs.reduce((s, i) => s + coins.find((c) => c.txid === Buffer.from(i.txid).toString('hex') && c.vout === i.vout)!.value, 0n)
  const paid = inputSum - tx.outputs.reduce((s, o) => s + o.value, 0n)
  expect(paid).toBe(BigInt(fee))
  expect(paid).toBeGreaterThanOrEqual(BigInt(Math.ceil(bytes.length * rate)))
  return tx
}

describe('fees cover real signed transactions', () => {
  for (const algo of ['ecdsa', 'schnorr', 'falcon512'] as const) {
    for (const kind of ['ordinary', 'delegated'] as const) {
      it(`${algo} ${kind}: automatic, manual, Max and tokens pay the requested rate for both output hash lengths`, async () => {
        const key = keys.get(`${algo}-${kind}`)!
        const rate = 5.25
        for (const hashLength of [20, 32]) {
          const recipient = addressFromScripthash(new Uint8Array(hashLength).fill(3), 'mainnet')
          const native = [coin(key, 1, 200_000n), coin(key, 2, 300_000n)]
          for (const mode of ['auto', 'manual', 'max'] as const) {
            const { svc, sent } = service(key, native, rate)
            const preview = await svc.buildSend(recipient, 350_000n,
              mode === 'manual' ? native.map((u) => `${u.txid}:${u.vout}`) : undefined, mode === 'max')
            await svc.confirmSend()
            assertPaid(sent[0]!, preview.feeAtomic, rate, native)
          }
          for (const amount of [100n, 500n]) {
            const coins = [...native, { ...coin(key, 3, 0n), tokenId: TOKEN, tokenAmount: 500n }]
            const { svc, sent } = service(key, coins, rate)
            const preview = await svc.buildTokenSend(TOKEN, recipient, amount)
            await svc.confirmSend()
            assertPaid(sent[0]!, preview.feeAtomic, rate, coins)
          }
        }
      })
    }
  }

  it.each([['ecdsa', 1500n], ['falcon512', 12000n]] as const)('reselects fragmented %s fee inputs until the entire token transaction is funded', async (algo, value) => {
    const key = keys.get(`${algo}-delegated`)!
    const coins = [
      ...Array.from({ length: 30 }, (_, i) => coin(key, i + 1, value)),
      { ...coin(key, 31, 0n), tokenId: TOKEN, tokenAmount: 500n },
    ]
    const { svc, sent } = service(key, coins, 5)
    const preview = await svc.buildTokenSend(TOKEN, key.address, 100n)
    await svc.confirmSend()
    const tx = assertPaid(sent[0]!, preview.feeAtomic, 5, coins)
    expect(tx.inputs.length).toBeGreaterThanOrEqual(4)
  })

  it('rejects a token draft whose inputs cover the initial estimate but cannot pay their own final size', async () => {
    const key = keys.get('falcon512-delegated')!
    const coins = [coin(key, 1, 12000n), { ...coin(key, 2, 0n), tokenId: TOKEN, tokenAmount: 500n }]
    const { svc, sent } = service(key, coins, 5)
    await expect(svc.buildTokenSend(TOKEN, key.address, 100n)).rejects.toThrow(InsufficientFundsError)
    expect(sent).toEqual([])
  })

  it('covers the input-count varint transition at 253 inputs', async () => {
    const key = keys.get('ecdsa-ordinary')!
    const coins = Array.from({ length: 253 }, (_, i) => coin(key, i + 1, 5000n))
    const { svc, sent } = service(key, coins, 1)
    const preview = await svc.buildSend(key.address, 0n, undefined, true)
    await svc.confirmSend()
    expect(assertPaid(sent[0]!, preview.feeAtomic, 1, coins).inputs).toHaveLength(253)
  })

  it('prices change correctly at the dust boundary instead of creating an underpriced second output', async () => {
    const key = keys.get('ecdsa-ordinary')!
    const coins = [coin(key, 1, 100_000n)]
    for (let remainder = 1100n; remainder < 1350n; remainder++) {
      const amount = 100_000n - remainder
      const fee = estimateSendFee({ utxos: coins, amountAtomic: amount, feeRatePerVByte: 1,
        recipient: key.address, changeAddressFor: () => key.address })
      const built = buildSend({ utxos: coins, recipient: key.address, amountAtomic: amount, feeAtomic: fee, changeAddress: key.address })
      expect(built.feeAtomic).toBeGreaterThanOrEqual(feeForDraft(coins, built.unsigned, 1))
    }
  })
})
