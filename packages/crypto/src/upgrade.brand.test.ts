// QBitcoin brand assertions for the upgrade config. Lives only on the
// qbitcoin branch (brand stack): it pins the wallet's UPGRADE values to
// the node's consensus constants (its chain parameters,
// where QBT_LOCK_SCRIPT = P2PKH of hash160(QBT_LOCK_PUBKEY), per network).
import { describe, expect, it } from 'vitest';
import { btcP2pkhAddress } from './btc/address';
import { UPGRADE, type Network } from './constants';
import { fromHex, toHex } from './encoding/hex';
import { hash160 } from './hashes';

/** The node's per-network lock pubkeys (chain parameters). */
const LOCK_PUBKEY: Record<Network, string> = {
  mainnet: '03c3fe5cc51c8c1d6b04ec0fe00d3487863c0eec33ac6360095700868d66de19ff',
  testnet: '02943a59688f1eceb1d068f6ac0ff84c8f17b2c3714269aec2185422cd61b748b6',
};

// Script-derived deposit addresses. NODE BUG (reported; partially fixed
// 2026-07): the node's mainnet QBT_LOCK_ADDR (1QBTC1vwR9…) is STILL a
// vanity string whose embedded hash does not match the lock script.
// Consensus (Coinbase::get_scripthash) follows the SCRIPT, so any manual
// instructions must show these addresses. The testnet QBT_LOCK_ADDR is
// consistent and equals the value below.
const LOCK_ADDRESS: Record<Network, string> = {
  mainnet: '1Btj5NJcNPQNKZibXoXcuJos5bMS1UspJH',
  testnet: 'mqbtcT4awjiAjrxMyGNnbdusCdCpMkryxv',
};

describe('UPGRADE (QBitcoin brand)', () => {
  it('is configured for both networks', () => {
    expect(UPGRADE).not.toBeNull();
    expect(Object.keys(UPGRADE!).sort()).toEqual(['mainnet', 'testnet']);
  });

  for (const network of ['mainnet', 'testnet'] as const) {
    describe(network, () => {
      const cfg = () => UPGRADE![network];

      it('locks to P2PKH of hash160(the node QBT_LOCK_PUBKEY)', () => {
        // OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG
        const expected = hash160(fromHex(LOCK_PUBKEY[network]));
        expect(cfg().lockScriptHex).toBe(`76a914${toHex(expected)}88ac`);
      });

      it('renders the SCRIPT-derived deposit address', () => {
        const pubkeyhash = fromHex(cfg().lockScriptHex.slice(6, 46));
        expect(btcP2pkhAddress(pubkeyhash, network)).toBe(LOCK_ADDRESS[network]);
      });

      it('keeps sane limits', () => {
        expect(cfg().minConvertValue).toBeGreaterThan(cfg().dustLimit);
        expect(cfg().feeTargetBlocks).toBeGreaterThan(0);
        expect(cfg().fallbackFeeRate).toBeGreaterThan(0);
      });
    });
  }
});
