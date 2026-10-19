import type { AddressInfo, Utxo } from '@qbtc/chain'
import { deserialize, fromHex, getPublicKey, scriptP2PK, SIGHASH, sighash, toHex, verifySiglistEntry } from '@qbtc/crypto'
import { addressFromPubkey, decodeAddress, encodeWif, sighashCommitsTokenId } from '../../src/main/brand/crypto'
import { describe, expect, it } from 'vitest'
import { importedKeyFromStored, ordinaryKeyAddress, type ImportedKey } from '../../src/main/wallet/keyWallet'
import { createSweepSession, type SweepBackend } from '../../src/main/wallet/sweep'
import { delegatedKeyFixture } from '../fixtures/delegatedKey'

// A real ECDSA key so the session derives, signs and serializes for real —
// only the chain is faked.
const PRIV = fromHex('0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d')
const WIF = encodeWif(PRIV, 'mainnet')
const RECIPIENT = addressFromPubkey(getPublicKey(fromHex('11'.repeat(32))), 'ecdsa', 'mainnet')

async function makeKey(): Promise<ImportedKey> {
  return importedKeyFromStored({ wif: WIF, algo: 'ecdsa', address: '' }, 'mainnet')
}

const ZERO = { fundedTxCount: 0, fundedSum: 0n, spentTxCount: 0, spentSum: 0n }

function backend(key: ImportedKey, utxos: readonly Utxo[], onBroadcast?: (hex: string) => void): SweepBackend {
  const funded = utxos.reduce((s, u) => s + u.value, 0n)
  return {
    getBlockchainInfo: async () => ({ tipHeight: 1000, tipHash: 'hash', network: 'mainnet' }),
    getAddressInfo: async (address: string): Promise<AddressInfo> =>
      address === key.address
        ? { address, chain: { fundedTxCount: utxos.length, fundedSum: funded, spentTxCount: 0, spentSum: 0n }, mempool: ZERO, tokens: {} }
        : { address, chain: ZERO, mempool: ZERO, tokens: {} },
    getAddressTransactions: async () => [],
    getTransaction: async (txid: string) => {
      const source = utxos.find((coin) => coin.txid === txid)
      if (source) return { txid, version: 1, size: 200, fee: 0n, vin: [], vout: [], status: source.status }
      throw new Error(`no tx ${txid}`)
    },
    getTransactionHex: async () => '00',
    getFeeEstimates: async () => ({ '1': 12, '6': 5, '144': 1 }),
    getTokenInfo: async (id: string) => ({ id, decimals: 6 }),
    listUnspent: async (address: string) => (address === key.address ? [...utxos] : []),
    broadcastTransaction: async (rawHex: string) => {
      onBroadcast?.(rawHex)
      return { txid: 'broadcast-accepted' }
    },
  }
}

const utxo = (n: number, value: bigint): Utxo => ({ txid: String(n).padStart(2, '0').repeat(32).slice(0, 64), vout: n, value, status: { confirmed: true, blockHeight: 900 } })

describe('createSweepSession', () => {
  it('scans the balance of exactly the key address', async () => {
    const key = await makeKey()
    const session = createSweepSession(backend(key, [utxo(1, 60_000n), utxo(2, 40_000n)]), key, 'mainnet')
    expect(session.address).toBe(key.address)
    expect((await session.scanBalance()).balanceAtomic).toBe('100000')
  })

  it('sweeps everything with send-max: no change, signed with the key, broadcast', async () => {
    const key = await makeKey()
    let sent: string | null = null
    const session = createSweepSession(
      backend(key, [utxo(1, 60_000n), utxo(2, 40_000n)], (hex) => {
        sent = hex
      }),
      key,
      'mainnet',
    )
    const preview = await session.send.buildSend(RECIPIENT, 0n, undefined, true)
    expect(preview.changeAtomic).toBe('0')
    expect(BigInt(preview.amountAtomic) + BigInt(preview.feeAtomic)).toBe(100_000n)
    expect(preview.signature).toBe('ECDSA')

    const result = await session.send.confirmSend()
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/)
    expect(sent).not.toBeNull()
    // Every input carries the key's P2PK redeem script.
    expect(sent).toContain(toHex(scriptP2PK(key.publicKey)))
  })

  it('returns change from a partial send (to the key itself, by construction)', async () => {
    const key = await makeKey()
    const session = createSweepSession(backend(key, [utxo(1, 60_000n), utxo(2, 40_000n)]), key, 'mainnet')
    const preview = await session.send.buildSend(RECIPIENT, 30_000n, undefined, false)
    // amount + fee + change account for the selected inputs exactly.
    expect(BigInt(preview.amountAtomic)).toBe(30_000n)
    expect(BigInt(preview.amountAtomic) + BigInt(preview.feeAtomic) + BigInt(preview.changeAtomic)).toBe(BigInt(preview.totalAtomic) + BigInt(preview.changeAtomic))
    expect(BigInt(preview.changeAtomic)).toBeGreaterThan(0n)
  })

  it('dispose wipes the key and drops any held draft', async () => {
    const key = await makeKey()
    const session = createSweepSession(backend(key, [utxo(1, 60_000n)]), key, 'mainnet')
    await session.send.buildSend(RECIPIENT, 0n, undefined, true)
    session.dispose()
    expect(key.privateKey.every((b) => b === 0)).toBe(true)
    await expect(session.send.confirmSend()).rejects.toThrow(/No transaction to confirm/)
  })
})

describe('delegated-key sends and sweeps', () => {
  for (const algo of ['ecdsa', 'falcon512'] as const) {
    for (const length of [20, 32] as const) {
      for (const mode of ['auto', 'manual', 'max', 'token'] as const) {
        it(`${algo}/${length}: ${mode} pays for its serialized size and returns change to the ordinary owner address`, async () => {
          const { wif } = await delegatedKeyFixture(algo, length)
          const key = await importedKeyFromStored({ wif, algo, address: '' }, 'mainnet')
          const coins: Utxo[] = [utxo(1, 200_000n), utxo(2, 300_000n)]
          const tokenId = 'ef'.repeat(32)
          if (mode === 'token') coins.push({ ...utxo(3, 0n), tokenId, tokenAmount: 500n })
          let raw = ''
          const reader = backend(key, coins, (hex) => { raw = hex })
          const ordinary = ordinaryKeyAddress(key, 'mainnet')
          const ordinaryReader = backend({ ...key, address: ordinary }, coins)
          reader.getAddressInfo = async (address) => address === ordinary ? ordinaryReader.getAddressInfo(address) : backend(key, coins).getAddressInfo(address)
          reader.listUnspent = async (address) => address === ordinary ? coins : coins.map((u) => ({ ...u, txid: '99'.repeat(32) }))
          const session = createSweepSession(reader, key, 'mainnet')
          try {
            expect(session.delegatePubkeyhash).toBeDefined()
            expect(await session.scanBalance()).toMatchObject({ balanceAtomic: '1000000', availableAtomic: '500000' })
            await expect(session.send.buildSend(RECIPIENT, 900000n)).rejects.toThrow(/Not enough balance/)
            await expect(session.send.maxSendable(['99'.repeat(32) + ':1'])).rejects.toThrow(/Unstake/)
            const manual = mode === 'manual' ? coins.slice(0, 1).map((u) => `${u.txid}:${u.vout}`) : undefined
            const max = mode === 'max' ? await session.send.maxSendable() : undefined
            const preview = mode === 'token'
              ? await session.send.buildTokenSend(tokenId, RECIPIENT, 100n)
              : await session.send.buildSend(RECIPIENT, 40_000n, manual, mode === 'max')
            if (max !== undefined) {
              expect(preview.feeAtomic).toBe(max.feeAtomic)
              expect('amountAtomic' in preview && preview.amountAtomic).toBe(max.amountAtomic)
            }
            await session.send.confirmSend()
            const tx = deserialize(fromHex(raw))
            const fee = BigInt(preview.feeAtomic)
            // The session's fee estimate selects the backend's six-block rate.
            expect(fee).toBeGreaterThanOrEqual(BigInt(raw.length / 2 * 5))
            const ownHash = decodeAddress(addressFromPubkey(key.publicKey, algo, 'mainnet')).scripthash
            if (mode === 'max') expect(tx.outputs).toHaveLength(1)
            else expect(tx.outputs.slice(1).every((o) => toHex(o.scripthash) === toHex(ownHash))).toBe(true)
            if (mode === 'manual') {
              expect(tx.inputs).toHaveLength(1)
              expect(toHex(tx.inputs[0]!.txid)).toBe(coins[0]!.txid)
            }
            if (mode === 'token') {
              expect(tx.txType).toBe(4)
              expect(toHex(tx.tokenHash!)).toBe(tokenId)
              expect(tx.outputs.filter((o) => o.data?.[0] === 1)).toHaveLength(2)
            }
            const digest = sighash(tx, SIGHASH.ALL, sighashCommitsTokenId('mainnet'))
            for (const input of tx.inputs) {
              expect(input.redeemScript).toEqual(scriptP2PK(key.publicKey))
              expect(input.siglist).toHaveLength(1)
              expect(await verifySiglistEntry(input.siglist![0]!, digest, key.publicKey)).toBe(true)
            }
          } finally { session.dispose() }
          expect(key.privateKey.every((b) => b === 0)).toBe(true)
        })
      }
    }
  }
})
