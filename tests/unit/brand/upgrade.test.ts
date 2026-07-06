import { describe, expect, it } from 'vitest'
import { btcP2shP2wshMultisig, fromHex, toHex, type Network } from '@qbtc/crypto'
import { UPGRADE } from '../../../src/main/brand/crypto'

// QBitcoin brand assertions for the upgrade config. Lives only on the
// qbitcoin branch (brand stack): it pins the profile's `upgrade` values to the
// node's consensus constants — the federated 2-of-3 P2SH-P2WSH lock built
// from the operators' QBT_LOCK_PUBKEYS. The testnet address is confirmed
// against the LIVE Bitcoin testnet4 chain (the pool already holds funds on
// it); the mainnet chain is not launched yet.

/** The node's per-network federation operator pubkeys (chain parameters). */
const LOCK_PUBKEYS: Record<Network, readonly string[]> = {
  mainnet: [
    '024ee83659c56ad0663c324cbeaf4cf969ed2c8171af7b5f71afcef472321f22f7',
    '032a20877b907de2a1a9ee1ce5043f1dd324605a24c64e41663ce8905ac45d2f1c',
    '026463dbd08255e4c5930d889902cf0b02efba68c0de392c2cfe10e8e4f8e6bac6',
  ],
  testnet: [
    '032dccf5c2c79a5298dd7e1f1aaf9db35f0b2082c4a7ed599a2fb5bfad5b4e3f36',
    '03c7f19d0502dd1db33fb5298efbc16848d9c7431ee88fb0fb929205580395599a',
    '03acebbd33221306e9263cb6d03f7ed33e4bccbc85dc5bef7e49882351650b4909',
  ],
}

/** The node's QBT_LOCK_ADDR strings — derived from the same keys. */
const LOCK_ADDRESS: Record<Network, string> = {
  mainnet: '3QBTC3wxgSPUbKLqjZjh6aGwM3yKHWhaLU',
  testnet: '2MtQBTCa85CFPFa45Tc19DmuYa3XhfSuD8D',
}

describe('UPGRADE (QBitcoin brand)', () => {
  it('is configured for both networks', () => {
    expect(UPGRADE).not.toBeNull()
    expect(Object.keys(UPGRADE!).sort()).toEqual(['mainnet', 'testnet'])
  })

  for (const network of ['mainnet', 'testnet'] as const) {
    describe(network, () => {
      const cfg = () => UPGRADE![network]

      it('locks to the federated 2-of-3 P2SH-P2WSH of the operator pubkeys', () => {
        const lock = btcP2shP2wshMultisig(2, LOCK_PUBKEYS[network].map(fromHex), network)
        expect(cfg().lockScriptHex).toBe(toHex(lock.scriptPubKey))
      })

      it('renders the node-published deposit address from the same keys', () => {
        const lock = btcP2shP2wshMultisig(2, LOCK_PUBKEYS[network].map(fromHex), network)
        expect(lock.address).toBe(LOCK_ADDRESS[network])
      })

      it('keeps sane limits', () => {
        expect(cfg().minConvertValue).toBeGreaterThan(cfg().dustLimit)
        expect(cfg().feeTargetBlocks).toBeGreaterThan(0)
        expect(cfg().fallbackFeeRate).toBeGreaterThan(0)
      })
    })
  }
})
