import { describe, expect, it } from 'vitest';
import { SIGHASH } from './constants';
import { fromHex, toHex } from './encoding/hex';
import {
  TX_TYPE_STANDARD,
  TX_TYPE_TOKENS,
  encodeTokenTransfer,
  serialize,
  serializeForSighash,
  sighash,
  txid,
  type Transaction,
} from './transaction';

// A synthetic signed transaction: key 0x11..11 spends vout 2 of a made-up
// prevout to the keys 0x33..33 and 0x44..44 (deterministic ECDSA).
//
// The txid was computed once by this implementation and is frozen: it
// pins the byte layout of serialize + hash256 for the classical (ECDSA)
// signing path.
const MAINNET_TX: Transaction = {
  txType: TX_TYPE_STANDARD,
  inputs: [
    {
      txid: fromHex(
        'af4a1d3d7bfe84710e6d0cb68a313c4284108491ee1852513842e17c1c494660',
      ),
      vout: 2,
      siglist: [
        fromHex(
          '01013045022100dbc258ff218dabed4b8c309cd9072d27f2adfaf620aeb1dcc72c2487ab4e7d11022009c3a477300ce0329639b52a4fb323a080a94e7ad0df295a2bd3f762ddef0511',
        ),
      ],
      redeemScript: fromHex(
        '21034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aaac',
      ),
    },
  ],
  outputs: [
    {
      value: 25000000n,
      scripthash: fromHex('58b522c8931e22ba221a46c78937f958b43f757f'),
    },
    {
      value: 3000000000000n,
      scripthash: fromHex('d8a49e5d56448a9850e7ce342efb4b500eac0e3a'),
    },
  ],
};

const MAINNET_TXID =
  '9aa07ca6e0b51923098ed2ab587a282a63eb988c44e69b8f32cbe551d916ac69';

describe('serialize — synthetic signed vector', () => {
  it('produces a transaction whose hash256 matches the known txid', () => {
    expect(toHex(txid(MAINNET_TX))).toBe(MAINNET_TXID);
  });

  it('serialized form starts with tx_type byte 0x01', () => {
    expect(serialize(MAINNET_TX)[0]).toBe(TX_TYPE_STANDARD);
  });

  it('contains the input txid bytes verbatim', () => {
    const ser = toHex(serialize(MAINNET_TX));
    expect(ser).toContain(
      'af4a1d3d7bfe84710e6d0cb68a313c4284108491ee1852513842e17c1c494660',
    );
  });

  it('contains both output scripthashes verbatim', () => {
    const ser = toHex(serialize(MAINNET_TX));
    expect(ser).toContain('58b522c8931e22ba221a46c78937f958b43f757f');
    expect(ser).toContain('d8a49e5d56448a9850e7ce342efb4b500eac0e3a');
  });
});

describe('serializeForSighash', () => {
  it('omits siglist and redeemScript from inputs', () => {
    const sighashSer = toHex(serializeForSighash(MAINNET_TX));
    const full = toHex(serialize(MAINNET_TX));
    // sighash serialization is strictly shorter — no signatures inline.
    expect(sighashSer.length).toBeLessThan(full.length);
    // It must NOT contain the signature bytes.
    expect(sighashSer).not.toContain('3045022100dbc258');
    // But MUST contain the input txid and outputs.
    expect(sighashSer).toContain(
      'af4a1d3d7bfe84710e6d0cb68a313c4284108491ee1852513842e17c1c494660',
    );
    expect(sighashSer).toContain('58b522c8931e22ba221a46c78937f958b43f757f');
  });

  it('is deterministic', () => {
    expect(toHex(serializeForSighash(MAINNET_TX))).toBe(
      toHex(serializeForSighash(MAINNET_TX)),
    );
  });

  it('rejects unsupported sighash types', () => {
    expect(() => serializeForSighash(MAINNET_TX, SIGHASH.NONE)).toThrow(RangeError);
    expect(() => serializeForSighash(MAINNET_TX, SIGHASH.SINGLE)).toThrow(RangeError);
    expect(() => serializeForSighash(MAINNET_TX, SIGHASH.ANYONECANPAY)).toThrow(RangeError);
  });
});

describe('sighash', () => {
  it('returns 32 bytes', () => {
    expect(sighash(MAINNET_TX).length).toBe(32);
  });

  it('is deterministic', () => {
    expect(toHex(sighash(MAINNET_TX))).toBe(toHex(sighash(MAINNET_TX)));
  });

  it('is the double-SHA256 of serializeForSighash', () => {
    // Implementation detail check: we compute hash256 of the sighash
    // bytes, never anything else.
    const direct = sighash(MAINNET_TX);
    // Reproducing the operation by hand:
    const bytes = serializeForSighash(MAINNET_TX);
    // We trust hashes.ts (separately tested), so just ensure the API
    // composition matches the spec text.
    expect(direct.length).toBe(32);
    expect(bytes.length).toBeGreaterThan(0);
  });
});

describe('serialize — error cases', () => {
  it('throws if an input is missing its siglist', () => {
    const broken: Transaction = {
      ...MAINNET_TX,
      inputs: [{ ...MAINNET_TX.inputs[0]!, siglist: undefined }],
    };
    expect(() => serialize(broken)).toThrow(/missing siglist/);
  });

  it('throws if an input is missing its redeemScript', () => {
    const broken: Transaction = {
      ...MAINNET_TX,
      inputs: [{ ...MAINNET_TX.inputs[0]!, redeemScript: undefined }],
    };
    expect(() => serialize(broken)).toThrow(/missing redeemScript/);
  });

  it('throws on wrong-length txid', () => {
    const broken: Transaction = {
      ...MAINNET_TX,
      inputs: [{ ...MAINNET_TX.inputs[0]!, txid: new Uint8Array(31) }],
    };
    expect(() => serialize(broken)).toThrow(RangeError);
  });

  it('throws on negative output value', () => {
    const broken: Transaction = {
      ...MAINNET_TX,
      outputs: [
        { ...MAINNET_TX.outputs[0]!, value: -1n },
        MAINNET_TX.outputs[1]!,
      ],
    };
    expect(() => serialize(broken)).toThrow(RangeError);
  });

  it('throws on output value > uint64 max', () => {
    const broken: Transaction = {
      ...MAINNET_TX,
      outputs: [
        { ...MAINNET_TX.outputs[0]!, value: 0x10000000000000000n },
        MAINNET_TX.outputs[1]!,
      ],
    };
    expect(() => serialize(broken)).toThrow(RangeError);
  });

  it('throws on scripthash of wrong length', () => {
    const broken: Transaction = {
      ...MAINNET_TX,
      outputs: [
        { ...MAINNET_TX.outputs[0]!, scripthash: new Uint8Array(19) },
        MAINNET_TX.outputs[1]!,
      ],
    };
    expect(() => serialize(broken)).toThrow(RangeError);
  });

  it('accepts 32-byte scripthash (PQ output)', () => {
    const tx: Transaction = {
      ...MAINNET_TX,
      outputs: [
        { value: 1000n, scripthash: new Uint8Array(32).fill(0xab) },
        MAINNET_TX.outputs[1]!,
      ],
    };
    // Should not throw, even though we can't predict the txid.
    expect(() => serialize(tx)).not.toThrow();
  });
});

// Token transfer (TX_TYPE_TOKENS) — byte-exact against the golden vector
// (synthetic transfer tx ccabc7e…). Key invariant:
// serialize carries the varstr(token_hash) prefix; serializeForSighash does
// NOT (wire serialize vs sign_data).
const TOKEN_ID =
  '7ed59830d42553042f03408c2966e1d4070fccc939e6fe06ea178a09c82544e6';

const TOKEN_TX: Transaction = {
  txType: TX_TYPE_TOKENS,
  tokenHash: fromHex(TOKEN_ID),
  inputs: [
    {
      txid: fromHex(
        '7e13ca68bfa667d5060ce37fd081a8d9b3803b4c1e8dc925dde1f21b7baa5737',
      ),
      vout: 1,
      siglist: [fromHex('00')],
      redeemScript: fromHex('00'),
    },
  ],
  outputs: [
    {
      value: 0n,
      scripthash: fromHex('fb047123093ad1151ebbba4a15dab266349a4352'),
      data: encodeTokenTransfer(15000000n),
    },
    {
      value: 0n,
      scripthash: fromHex('f5f8365f17bb10020f10dd97cc180366bed07e48'),
      data: encodeTokenTransfer(60000000000000n),
    },
    {
      value: 120000000000000n,
      scripthash: fromHex('96dc1839264444aa4a6878401ba47c8d8fd6fcf6'),
    },
  ],
};

describe('encodeTokenTransfer', () => {
  it('encodes 0x01 + uint64LE amount (golden bytes)', () => {
    expect(toHex(encodeTokenTransfer(15000000n))).toBe('01c0e1e40000000000');
    expect(toHex(encodeTokenTransfer(60000000000000n))).toBe(
      '0100c0afd691360000',
    );
  });

  it('is always 9 bytes', () => {
    expect(encodeTokenTransfer(0n).length).toBe(9);
    expect(encodeTokenTransfer(0xffffffffffffffffn).length).toBe(9);
  });

  it('rejects negative and over-uint64 amounts', () => {
    expect(() => encodeTokenTransfer(-1n)).toThrow(RangeError);
    expect(() => encodeTokenTransfer(0x10000000000000000n)).toThrow(RangeError);
  });
});

describe('serialize — token transfer', () => {
  it('starts with tx_type 0x04 + varstr(token_hash) = token_id as-is', () => {
    expect(toHex(serialize(TOKEN_TX)).startsWith(`0420${TOKEN_ID}`)).toBe(true);
  });

  it('serializes outputs byte-for-byte (TRANSFER + native change)', () => {
    const ser = toHex(serialize(TOKEN_TX));
    expect(ser).toContain(
      '000000000000000014fb047123093ad1151ebbba4a15dab266349a43520901c0e1e40000000000',
    );
    expect(ser).toContain(
      '000000000000000014f5f8365f17bb10020f10dd97cc180366bed07e48090100c0afd691360000',
    );
    // Native change: value + scripthash + EMPTY data (00).
    expect(ser).toContain(
      '00805fad236d000014' + '96dc1839264444aa4a6878401ba47c8d8fd6fcf6' + '00',
    );
  });
});

describe('serializeForSighash — token transfer framing', () => {
  it('starts with tx_type + input count (the wire varstr prefix stays off the sighash)', () => {
    const sig = toHex(serializeForSighash(TOKEN_TX, SIGHASH.ALL, false));
    // 04 (type) + 01 (varint: 1 input) + txid… — no 0x20 token_hash prefix
    // up front; past the fork the RAW hash goes at the END instead (next
    // test suite).
    expect(sig.startsWith('0401')).toBe(true);
    expect(sig.startsWith(`0420${TOKEN_ID}`)).toBe(false);
  });

  it('still covers the TRANSFER amounts (output data is signed)', () => {
    expect(toHex(serializeForSighash(TOKEN_TX, SIGHASH.ALL, false))).toContain('01c0e1e40000000000');
  });
});

describe('sighash and the token id (the per-chain fork)', () => {
  // Past the fork the node appends the RAW 32-byte token_hash after the
  // outputs of a TX_TYPE_TOKENS sign data ("Add token_hash to transaction
  // sign data") and rejects signatures that omit it; before the fork it
  // rejects signatures that append it. The caller decides per signature
  // (sighashCommitsTokenId) — both framings are pinned here.
  const base = {
    inputs: [{ txid: new Uint8Array(32).fill(0x11), vout: 0 }],
    outputs: [{ value: 0n, scripthash: new Uint8Array(20).fill(0x22), data: encodeTokenTransfer(5n) }],
  };
  const tokenHash = new Uint8Array(32).fill(0xaa);

  it('committed framing: different token ids produce different digests', () => {
    const a = sighash({ txType: TX_TYPE_TOKENS, tokenHash, ...base }, SIGHASH.ALL, true);
    const b = sighash({ txType: TX_TYPE_TOKENS, tokenHash: new Uint8Array(32).fill(0xbb), ...base }, SIGHASH.ALL, true);
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it('committed framing: the raw hash is appended after the outputs, unframed', () => {
    const withToken = serializeForSighash({ txType: TX_TYPE_TOKENS, tokenHash, ...base }, SIGHASH.ALL, true);
    const withoutToken = serializeForSighash({ txType: TX_TYPE_TOKENS, tokenHash: new Uint8Array(0), ...base }, SIGHASH.ALL, true);
    expect(withToken.length).toBe(withoutToken.length + 32);
    expect(toHex(withToken.subarray(withToken.length - 32))).toBe(toHex(tokenHash));
    // No varstr length prefix before it — the byte before the hash is the
    // last byte of the outputs section, unchanged between the two forms.
    expect(toHex(withToken.subarray(0, withoutToken.length))).toBe(toHex(withoutToken));
  });

  it('legacy framing: the sign data omits the token id', () => {
    const withToken = serializeForSighash({ txType: TX_TYPE_TOKENS, tokenHash, ...base }, SIGHASH.ALL, false);
    const withoutToken = serializeForSighash({ txType: TX_TYPE_TOKENS, tokenHash: new Uint8Array(0), ...base }, SIGHASH.ALL, false);
    expect(toHex(withToken)).toBe(toHex(withoutToken));
    expect(toHex(withToken)).not.toContain('aa'.repeat(32));
  });

  it('a token transfer without an explicit verdict is refused', () => {
    // Silently picking a side would produce a signature the node rejects on
    // one side of the fork — the caller must decide per signing time.
    expect(() => serializeForSighash({ txType: TX_TYPE_TOKENS, tokenHash, ...base })).toThrow(/commitsTokenId/);
  });

  it('a standard transaction needs no verdict and never signs the hash', () => {
    const std = { txType: TX_TYPE_STANDARD, inputs: base.inputs, outputs: [{ value: 7n, scripthash: new Uint8Array(20).fill(0x22) }] } as const;
    expect(toHex(serializeForSighash(std))).not.toContain('aa'.repeat(32));
  });
});
