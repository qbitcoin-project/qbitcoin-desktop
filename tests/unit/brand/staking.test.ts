import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { derivePath, masterKeyFromSeed, mnemonicToSeed, toHex } from '@qbtc/crypto'
import { describe, expect, it } from 'vitest'
import { DELEGATE_PROFILES, STAKING_DERIVATIONS } from '../../../src/main/brand/delegation'
import { deriveFalconKeypair, nativePath } from '../../../src/main/brand/crypto'
import { STAKE_MATURITY } from '../../../src/main/brand/staking'
import { decodeDelegatePubkeyhash, delegationAddress, ownerPubkeyhash } from '../../../src/main/wallet/delegation'
import { deriveStakingKey, fixedStakingOwners, stakingPath, type StakingOwner } from '../../../src/main/wallet/stakingKeys'

// BRAND TEST: these delays must match the node's chain parameters.
it('pins the staking and slashing maturity delay for each network', () => {
  expect(STAKE_MATURITY).toEqual({ mainnet: 43_200, testnet: 43_200 })
})

// BRAND TEST: immutable recovery vectors from the public BIP-39 test mnemonic.
// These pin this build's policy; they do not claim live validator acceptance.
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
// Independently generated from explicit paths and HKDF-SHA256 with the public test mnemonic.
const branchVectors = [
  {
    "network": "mainnet",
    "account": 0,
    "algo": "ecdsa",
    "path": "m/44'/2009'/0'/2/0",
    "owner": "f02d05ffef39b1f91f59a9bbda69a2e4471da0b5",
    "delegate": "0c7ff3de82903004a6c6cdd1124e4b02513a2296",
    "address": "bqNG3uyQ9rEx54f6WrHQvZV7kWTd9BoxMqf"
  },
  {
    "network": "mainnet",
    "account": 0,
    "algo": "falcon512",
    "path": "m/512'/2009'/0'/2'/0'",
    "owner": "2978f2152eca0b0d19877b404d75cc572c3adaad0f3e961b52eddb850ebc6b67",
    "delegate": "32d2c4f41f4cdd6ff276e86f9a3fadc1eea0b1b8cb566c05fda45c1b1bdb0dd4",
    "address": "3uJg4EK62hDsjzudrrDiqwba7ecvDvzej2M4isQXLBa5qotdHmhL",
    "falconSeed": "e29efe4f106b3b3e01637bd6114dcbd2d515b103ebfc1d753413058186601b7fa43d6f51a9f0b9b3e442b887eca65ac4"
  },
  {
    "network": "mainnet",
    "account": 1,
    "algo": "ecdsa",
    "path": "m/44'/2009'/1'/2/0",
    "owner": "6621820f8089fa00f4a24212ad4db310d561b6a7",
    "delegate": "0c7ff3de82903004a6c6cdd1124e4b02513a2296",
    "address": "bqeHZxpuBjdHTw9HZGH1ifS8Vmsd25dLRXB"
  },
  {
    "network": "mainnet",
    "account": 1,
    "algo": "falcon512",
    "path": "m/512'/2009'/1'/2'/0'",
    "owner": "1a419b4c4566ce3ce00d8f82db4ccc9d4155f562f279697122a77c5d043427d8",
    "delegate": "32d2c4f41f4cdd6ff276e86f9a3fadc1eea0b1b8cb566c05fda45c1b1bdb0dd4",
    "address": "3uK1ncMPoV6gVhA5gVcjWBfdEfmuF61CEdn4vsUCd9EqWvHiLga8",
    "falconSeed": "0af29d7d24eda90a40d2a063b3c5475680cb6e995e22861efa87468f8ac9b59cbf717a40241560534285f06800d11833"
  },
  {
    "network": "testnet",
    "account": 0,
    "algo": "ecdsa",
    "path": "m/44'/1'/0'/2/0",
    "owner": "9213230893ba239dd464acef9f73d1f4d4570777",
    "delegate": "f389023a1bfde17837f8998922651be48e7e03ca",
    "address": "btqjCxkT37X5Y3AUsAD4jgAqM7RE6CeRdfDh"
  },
  {
    "network": "testnet",
    "account": 0,
    "algo": "falcon512",
    "path": "m/512'/1'/0'/2'/0'",
    "owner": "db360187ec836b730ff5592f540c2d15f0a866f42358bb3a707f20f2ff019696",
    "delegate": "df7f173ff1edc8247e1b3116f821d5ec6ba5e81fd111bf4259988591b2ac956a",
    "address": "3ua4Dr4jmZGvH6yGae5bnK9iPBAJNb1dx4yeNwHxfdKXLN7hCRomj",
    "falconSeed": "44216ff972a4514eb1db463ae720f7ee57e270ad82180a8102ac5122424a48f0726fd9487d8efb31cc3b7c601f071282"
  },
  {
    "network": "testnet",
    "account": 1,
    "algo": "ecdsa",
    "path": "m/44'/1'/1'/2/0",
    "owner": "f6abf5fc2fab9b656aa4381db4bf6b16728fd2c1",
    "delegate": "f389023a1bfde17837f8998922651be48e7e03ca",
    "address": "btqhyBaiUHQj5Ls3stsYjMiwyf5jJhviFgQW"
  },
  {
    "network": "testnet",
    "account": 1,
    "algo": "falcon512",
    "path": "m/512'/1'/1'/2'/0'",
    "owner": "b52499d0fa0e23badb28b7c6e8eda54509747972507a51487cc8376992a8318c",
    "delegate": "df7f173ff1edc8247e1b3116f821d5ec6ba5e81fd111bf4259988591b2ac956a",
    "address": "3ua2yvZEcFWPEmFf3p2whT2hhkWGVLTeKjev2trqy2twBdpL2zWsS",
    "falconSeed": "e20af1f9c5e4ca2f2e0aa52e708ae2c843a6bc1162c00053474702c4147e3800b122bb0d116825866c44e49f59502928"
  }
] as const

describe('fixed staking recovery policy', () => {
  it('pins the registry independently of ordinary active derivation settings', () => {
    expect(STAKING_DERIVATIONS).toEqual([
      { id: 'staking-owner-v2', schemeId: 'qbt-v1-slip44', coinType: { mainnet: 2009, testnet: 1 }, falconHdInfo: 'qbt/pq/falcon512/v1', active: true },
    ])
    for (const account of [0, 1]) {
      expect(fixedStakingOwners(account)).toEqual([
        { kind: 'hd', derivationId: 'staking-owner-v2', algo: 'ecdsa', account },
        { kind: 'hd', derivationId: 'staking-owner-v2', algo: 'falcon512', account },
      ])
    }
    expect(() => stakingPath({ kind: 'hd', algo: 'ecdsa', derivationId: 'unknown-version', account: 0 }, 'testnet')).toThrow(/Unknown staking derivation/)
  })
  it.each(branchVectors)('pins branch 2 for $network account $account $algo', async (vector) => {
    const master = masterKeyFromSeed(mnemonicToSeed(mnemonic))
    const owner = { kind: 'hd', derivationId: 'staking-owner-v2', algo: vector.algo, account: vector.account } as const
    const key = await deriveStakingKey(master, owner, vector.network)
    try {
      expect(stakingPath(owner, vector.network)).toBe(vector.path)
      const hash = ownerPubkeyhash(key.publicKey, vector.algo)
      expect(toHex(hash)).toBe(vector.owner)
      const service = DELEGATE_PROFILES.find((p) => p.network === vector.network)!
      const delegate = decodeDelegatePubkeyhash(service.hashes[vector.algo], vector.network)
      expect(toHex(delegate)).toBe(vector.delegate)
      expect(delegationAddress(hash, delegate, vector.network)).toBe(vector.address)
      if ('falconSeed' in vector) {
        const child = derivePath(master, vector.path)
        const seed = hkdf(sha256, child.privateKey!, undefined, 'qbt/pq/falcon512/v1', 48)
        try { expect(toHex(seed)).toBe(vector.falconSeed) } finally { child.wipePrivateData(); seed.fill(0) }
      }
      for (const change of [0, 1] as const) {
        if (vector.algo === 'ecdsa') {
          const ordinary = derivePath(master, nativePath(vector.account, 0, vector.network, change))
          try { expect(toHex(ordinary.publicKey!)).not.toBe(toHex(key.publicKey)) } finally { ordinary.wipePrivateData() }
        } else {
          const ordinary = await deriveFalconKeypair(master, vector.account, change, 0, vector.network)
          try { expect(toHex(ordinary.publicKey)).not.toBe(toHex(key.publicKey)) } finally { ordinary.privateKey.fill(0) }
        }
      }
      const otherMaster = masterKeyFromSeed(mnemonicToSeed(mnemonic, 'public test passphrase'))
      try {
        const other = await deriveStakingKey(otherMaster, owner, vector.network)
        try { expect(toHex(ownerPubkeyhash(other.publicKey, vector.algo))).not.toBe(vector.owner) }
        finally { other.privateKey.fill(0) }
      } finally { otherMaster.wipePrivateData() }
    } finally { key.privateKey.fill(0); master.wipePrivateData() }
  })
  it('rejects missing or invalid account references without falling back to another path', () => {
    for (const account of [undefined, -1, 0.5, 0x80000000, NaN, Infinity]) {
      expect(() => stakingPath({ kind: 'hd', derivationId: 'staking-owner-v2', algo: 'ecdsa', account } as StakingOwner, 'testnet')).toThrow(/account/)
      if (account !== undefined) expect(() => fixedStakingOwners(account)).toThrow(/account/)
    }
    expect(stakingPath({ kind: 'hd', derivationId: 'staking-owner-v2', algo: 'ecdsa', account: 0x7fffffff }, 'testnet')).toBe("m/44'/1'/2147483647'/2/0")
  })
  it.each(['mainnet', 'testnet'] as const)('rejects retired test derivations on %s without falling back to branch 2', async (network) => {
    const master = masterKeyFromSeed(mnemonicToSeed(mnemonic))
    try {
      for (const algo of ['ecdsa', 'falcon512'] as const) {
        for (const account of [undefined, 0]) {
          const owner = { kind: 'hd', derivationId: 'staking-owner-v1', algo, account } as StakingOwner
          expect(() => stakingPath(owner, network)).toThrow(/Unknown staking derivation/)
          await expect(deriveStakingKey(master, owner, network)).rejects.toThrow(/Unknown staking derivation/)
        }
      }
    } finally { master.wipePrivateData() }
  })
  it('uses the confirmed 0.001 minimum for mainnet and testnet funding', () => {
    expect(DELEGATE_PROFILES.find((p) => p.network === 'mainnet')).toMatchObject({ minimumAtomic: '100000', fundingEnabled: true, minimumVerified: true })
    expect(DELEGATE_PROFILES.find((p) => p.network === 'mainnet')?.commission).toBeUndefined()
    expect(DELEGATE_PROFILES.find((p) => p.network === 'testnet')).toMatchObject({ minimumAtomic: '100000', fundingEnabled: true, minimumVerified: true })
  })
})
