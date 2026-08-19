// QBitcoin brand assertions for the downgrade config. Lives only on the
// qbitcoin branch (brand stack): it pins the covenant scripts and addresses
// derived from DOWNGRADE to the values the chain actually uses — the
// federation era (2-of-3 Falcon-512 CHECKMULTISIG, hash256 scripthashes)
// and, on testnet, the retired single-key era whose pins were confirmed
// against the LIVE chain while it was current (both legacy addresses carry
// real freeze history; the wallet still reclaims from them).
import { describe, expect, it } from 'vitest';
import { addressFromScripthash } from './address';
import { DOWNGRADE, type Network } from './constants';
import { downgradeScript, federationFreezeScript, federationScripthash, freezeScript, reclaimScripthash } from './downgrade';
import { fromHex, toHex } from './encoding/hex';

const FED_FREEZE_PINS: Record<Network, { scripthash: string; address: string }> = {
  mainnet: {
    scripthash: 'f726dac17e09d66ca2f85f180e64e612320a69c53684a99d91e84b7230f4809c',
    address: '3uK3avZ7ZjDR6LoxKW6My8R7tBgJ3PwAqzcmqD2w7vBH5JQmeAnP',
  },
  testnet: {
    scripthash: '91c754d43de0158f4a4edec4bc4b044c4ef59a7d513e40d464610ea26ec2675a',
    address: '3ua3cQhw2DvL3URBPuXAmL2oWmLu8yD7Y8hQEQkKHmb6F6fFxRpWk',
  },
};

// The downgrade script carries no keys — one script, one hash256 for both
// networks; only the address encoding differs.
const FED_DOWNGRADE_SCRIPTHASH = '78a077ced25f89951c2cc06f630443b991095e976a0b6a8034c3a2f95dca82ca';
const FED_DOWNGRADE_ADDRESS: Record<Network, string> = {
  mainnet: '3uJ5s1mzUXAAoaWzWqRkLmqhBE45eK7USekQFAeNZ4uCbnVsidm4',
  testnet: '3ua3RLEiXuekdeSwhoZuXzdPCRYnNFzioFhexo3geZ7tECekzjmFS',
};

// The retired single-key era (testnet only) — hash160 scripthashes.
const LEGACY_FREEZE_SCRIPTHASH = 'b7f8632e19bc365891c6fc9d235c484ac4eb65c7';
const LEGACY_FREEZE_ADDRESS = 'btqiMyhbhoQkpyoNZg6shibpg7AkZ1q1XvXD';
const LEGACY_DOWNGRADE_SCRIPTHASH = '6846cc3d3d7507a7b5ba3d900f2dd19d625d0752';
const LEGACY_DOWNGRADE_ADDRESS = 'btqb6baJTy1acQcaSFwrxU6tXqVrwtyfbpxk';

describe('DOWNGRADE brand pins', () => {
  it('is configured with the consensus windows and three Falcon keys each', () => {
    expect(DOWNGRADE).not.toBeNull();
    for (const net of ['mainnet', 'testnet'] as const) {
      expect(DOWNGRADE![net].freezeSeconds).toBe(48 * 3600);
      expect(DOWNGRADE![net].outputSeconds).toBe(7 * 24 * 3600);
      expect(DOWNGRADE![net].freezePubkeysHex).toHaveLength(3);
      for (const key of DOWNGRADE![net].freezePubkeysHex) {
        // Falcon-512 public keys: 0x09 header + 896 body bytes.
        expect(key).toMatch(/^09[0-9a-f]{1792}$/);
      }
    }
  });

  it('the federation freeze script derives the pinned scripthash and address', () => {
    for (const net of ['mainnet', 'testnet'] as const) {
      const cfg = DOWNGRADE![net];
      const sh = federationScripthash(federationFreezeScript(cfg.freezePubkeysHex.map(fromHex), cfg.freezeSeconds));
      expect(toHex(sh)).toBe(FED_FREEZE_PINS[net].scripthash);
      expect(addressFromScripthash(sh, net)).toBe(FED_FREEZE_PINS[net].address);
    }
  });

  it('the downgrade script derives one hash256, addressed per network', () => {
    for (const net of ['mainnet', 'testnet'] as const) {
      const sh = federationScripthash(downgradeScript(DOWNGRADE![net].outputSeconds));
      expect(toHex(sh)).toBe(FED_DOWNGRADE_SCRIPTHASH);
      expect(addressFromScripthash(sh, net)).toBe(FED_DOWNGRADE_ADDRESS[net]);
    }
  });

  it('keeps the retired single-key era reclaimable on testnet only', () => {
    expect(DOWNGRADE!.mainnet.legacyLockPubkeyHex).toBeUndefined();
    const legacyKey = DOWNGRADE!.testnet.legacyLockPubkeyHex!;
    expect(legacyKey).toBe('02943a59688f1eceb1d068f6ac0ff84c8f17b2c3714269aec2185422cd61b748b6');
    const freezeSh = reclaimScripthash(freezeScript(fromHex(legacyKey), DOWNGRADE!.testnet.freezeSeconds));
    expect(toHex(freezeSh)).toBe(LEGACY_FREEZE_SCRIPTHASH);
    expect(addressFromScripthash(freezeSh, 'testnet')).toBe(LEGACY_FREEZE_ADDRESS);
    const downgradeSh = reclaimScripthash(downgradeScript(DOWNGRADE!.testnet.outputSeconds));
    expect(toHex(downgradeSh)).toBe(LEGACY_DOWNGRADE_SCRIPTHASH);
    expect(addressFromScripthash(downgradeSh, 'testnet')).toBe(LEGACY_DOWNGRADE_ADDRESS);
  });
});
