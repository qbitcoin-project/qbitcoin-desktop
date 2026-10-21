import { afterEach, describe, expect, it } from 'vitest'
import {
  decodeBase58Check, deserialize, encodeBase58Check, fromHex, hash160, hash256,
  SchnorrDisabledError, setSchnorrEnabled, SIGHASH, sighash, toHex, verifySiglistEntry,
} from '@qbtc/crypto'
import { addressFromPubkey, addressFromScripthash, decodeAddress, encodeWif, sighashCommitsTokenId } from '../../src/main/crypto'
import { DELEGATION } from '../../src/main/brand/delegation'
import { delegationAddress, delegationScript, delegationScripthash, encodeDelegatePubkeyhash, ownerPubkeyhash } from '../../src/main/wallet/delegation'
import { decodeWalletWif } from '../../src/main/wallet/keyWif'
import { createKeyAddressSource, importedKeyFromStored, inspectWifKey, keyInputBytes, keyReceiveOps, signUnsignedTxWithKey } from '../../src/main/wallet/keyWallet'
import { toCryptoTransaction } from '../../src/main/wallet/signTx'
import type { UnsignedTx } from '../../src/main/wallet/buildTx'
import { delegatedKeyFixture } from '../fixtures/delegatedKey'
import goldens from '../fixtures/delegation.json'

describe('delegation script compatibility', () => {
  // Scripts produced by running the node's pure delegation functions against
  // public synthetic hashes. Hashes independently computed with hashlib.
  it.each(goldens)('matches the node for $owner / $delegate', ({ owner, delegate, script, scripthash }) => {
    const o = fromHex(owner), d = fromHex(delegate)
    expect(toHex(delegationScript(o, d))).toBe(script)
    expect(toHex(delegationScripthash(o, d))).toBe(scripthash)
    for (const network of ['mainnet', 'testnet'] as const) {
      expect(delegationAddress(o, d, network)).toBe(addressFromScripthash(fromHex(scripthash), network))
    }
  })

  it.each([0, 19, 21, 31, 33])('rejects a %i-byte hash on either side', (length) => {
    expect(() => delegationScript(new Uint8Array(length), new Uint8Array(20))).toThrow(/pubkeyhash length/)
    expect(() => delegationScript(new Uint8Array(32), new Uint8Array(length))).toThrow(/pubkeyhash length/)
  })
})

describe('delegated WIF decoding and address discovery', () => {
  for (const network of ['mainnet', 'testnet'] as const) {
    for (const algo of ['ecdsa', 'falcon512'] as const) {
      it.each([20, 32] as const)(`${network} ${algo} with a %i-byte delegate hash round-trips and keeps one address`, async (length) => {
        const { wif, delegate } = await delegatedKeyFixture(algo, length, network)
        const decoded = decodeWalletWif(wif, network)
        expect(decoded.delegatePubkeyhash).toEqual(delegate)
        expect(decoded.payload).toHaveLength(algo === 'falcon512' ? 2178 : 32)
        decoded.payload.fill(0)
        const key = await importedKeyFromStored({ wif, algo, address: '' }, network)
        try {
          const owner = (algo === 'falcon512' ? hash256 : hash160)(key.publicKey)
          expect(key.address).toBe(delegationAddress(owner, delegate, network))
          expect(key.address).not.toBe(addressFromPubkey(key.publicKey, algo, network))
          const scriptHash = decodeAddress(key.address).scripthash
          expect(scriptHash).toHaveLength(algo === 'falcon512' || length === 32 ? 32 : 20)
          expect(await inspectWifKey(wif, network)).toEqual({ candidates: [algo], addresses: { [algo]: key.address }, delegatePubkeyhash: encodeDelegatePubkeyhash(delegate, network) })
          const source = createKeyAddressSource(async () => key)
          expect(await source.branches()).toEqual([{ kind: 'list', algo, addresses: [{ chain: 0, index: 0, address: key.address }] }])
          const receive = keyReceiveOps(async () => key)
          expect(await receive.getReceiveAddress()).toBe(key.address)
          expect(await receive.getNewReceiveAddress()).toBe(key.address)
          expect(await receive.listReceiveAddresses()).toEqual([{ address: key.address, index: 0, current: true }])
          await expect(importedKeyFromStored({ wif, algo, address: addressFromPubkey(key.publicKey, algo, network) }, network)).rejects.toThrow(/address mismatch/)
          await expect(inspectWifKey(wif, network === 'mainnet' ? 'testnet' : 'mainnet')).rejects.toThrow(/network|mainnet|testnet/)
        } finally { key.privateKey.fill(0) }
      })
    }
  }

  it('keeps ordinary WIFs unchanged', async () => {
    const wif = encodeWif(new Uint8Array(32).fill(1), 'mainnet')
    const key = await importedKeyFromStored({ wif, algo: 'ecdsa', address: '' }, 'mainnet')
    expect(key.delegation).toBeUndefined()
    expect(keyInputBytes(key)).toBeUndefined()
    expect(key.address).toBe(addressFromPubkey(key.publicKey, key.algo, 'mainnet'))
    expect((await inspectWifKey(wif, 'mainnet')).delegatePubkeyhash).toBeUndefined()
    key.privateKey.fill(0)
  })

  it('rejects corrupted checksums, invalid scalars, invalid lengths and unknown versions', async () => {
    const { wif } = await delegatedKeyFixture('ecdsa')
    const badChecksum = wif.slice(0, -1) + (wif.endsWith('1') ? '2' : '1')
    expect(() => decodeWalletWif(badChecksum, 'mainnet')).toThrow(/checksum/)
    expect(() => decodeWalletWif('not a WIF!', 'mainnet')).toThrow(/Base58/)
    for (const length of [0, 31, 33, 2177, 2179]) {
      const bad = encodeBase58Check(Uint8Array.of(DELEGATION.mainnet.wifHash256), new Uint8Array(length + 32).fill(1))
      expect(() => decodeWalletWif(bad, 'mainnet')).toThrow(/length/)
    }
    const scalarZero = encodeBase58Check(Uint8Array.of(DELEGATION.mainnet.wifHash160), new Uint8Array(52))
    expect(() => decodeWalletWif(scalarZero, 'mainnet')).toThrow(/valid secp256k1/)
    const unknown = encodeBase58Check(Uint8Array.of(0x01), new Uint8Array(64).fill(1))
    expect(() => decodeWalletWif(unknown, 'mainnet')).toThrow()
  })

  it('runs the Falcon key-pair self-check rather than accepting a valid envelope alone', async () => {
    const { wif } = await delegatedKeyFixture()
    const decoded = decodeBase58Check(wif, 1)
    decoded.payload[1300] ^= 1 // corrupt the public key, leave the private key intact
    const bad = encodeBase58Check(decoded.version, decoded.payload)
    decoded.payload.fill(0)
    await expect(inspectWifKey(bad, 'mainnet')).rejects.toThrow(/match|pair|check/)
    await expect(importedKeyFromStored({ wif: bad, algo: 'falcon512', address: '' }, 'mainnet')).rejects.toThrow()
  })
})

describe('delegated owner signing', () => {
  afterEach(() => setSchnorrEnabled(false))
  for (const algo of ['ecdsa', 'schnorr', 'falcon512'] as const) {
    for (const token of [false, true]) {
      it(`${algo} signs ${token ? 'token' : 'native'} sends through the owner branch`, async () => {
        const { wif, delegate } = await delegatedKeyFixture(algo)
        const key = await importedKeyFromStored({ wif, algo, address: '' }, 'mainnet')
        const unsigned: UnsignedTx = {
          inputs: [0, 1].map((n) => ({ prevTxid: String(n).repeat(64), vout: 300 + n, valueAtomic: '100000', algo, account: 0, chain: 0, index: 0 })),
          outputs: [{ valueAtomic: '190000', scripthash: toHex(decodeAddress(key.address).scripthash) }],
          ...(token ? { tokenHash: 'dd'.repeat(32) } : {}),
        }
        try {
          if (algo === 'schnorr') {
            expect((await inspectWifKey(wif, 'mainnet')).candidates).not.toContain('schnorr')
            expect((await inspectWifKey(wif, 'mainnet', { includeSchnorr: true })).addresses.schnorr).toBe(key.address)
            await expect(signUnsignedTxWithKey(unsigned, key, 'mainnet')).rejects.toThrow(SchnorrDisabledError)
            setSchnorrEnabled(true)
          }
          const signed = await signUnsignedTxWithKey(unsigned, key, 'mainnet')
          const tx = deserialize(fromHex(signed.rawHex))
          const digest = sighash(toCryptoTransaction(unsigned), SIGHASH.ALL, sighashCommitsTokenId('mainnet'))
          expect(tx.txType).toBe(token ? 4 : 1)
          for (const input of tx.inputs) {
            expect(input.redeemScript).toEqual(delegationScript(ownerPubkeyhash(key.publicKey, algo), delegate))
            expect(input.siglist).toHaveLength(3)
            expect(input.siglist![1]).toEqual(key.publicKey)
            expect(input.siglist![2]).toEqual(Uint8Array.of(1))
            expect(await verifySiglistEntry(input.siglist![0]!, digest, input.siglist![1]!)).toBe(true)
            const changed = { ...tx, outputs: [{ ...tx.outputs[0]!, value: 1n }] }
            expect(await verifySiglistEntry(input.siglist![0]!, sighash(changed, SIGHASH.ALL, sighashCommitsTokenId('mainnet')), key.publicKey)).toBe(false)
          }
          expect(key.privateKey.some((b) => b !== 0)).toBe(true)
          await expect(signUnsignedTxWithKey({ ...unsigned, inputs: [{ ...unsigned.inputs[0]!, algo: algo === 'ecdsa' ? 'falcon512' : 'ecdsa' }] }, key, 'mainnet')).rejects.toThrow(/expects/)
        } finally { key.privateKey.fill(0) }
      })
    }
  }
})
