import { describe, expect, it } from 'vitest'
import { disassembleScript } from '../../src/renderer/lib/script'

describe('disassembleScript', () => {
  it('decodes a P2PK redeem script (pushdata + OP_CHECKSIG)', () => {
    const pubkey = '034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa'
    expect(disassembleScript(`21${pubkey}ac`)).toBe(`OP_PUSHBYTES_33 ${pubkey} OP_CHECKSIG`)
  })

  it('decodes a P2PKH script', () => {
    const h160 = 'defdc651f607ebd7fc7ae1aacde8e632f40fd64f'
    expect(disassembleScript(`76a914${h160}88ac`)).toBe(`OP_DUP OP_HASH160 OP_PUSHBYTES_20 ${h160} OP_EQUALVERIFY OP_CHECKSIG`)
  })

  it('decodes OP_PUSHDATA1 with an explicit length byte', () => {
    expect(disassembleScript('4c0401020304')).toBe('OP_PUSHDATA1 01020304')
  })

  it('names small-number opcodes (OP_1..OP_16)', () => {
    expect(disassembleScript('5152')).toBe('OP_1 OP_2')
  })

  it('labels unknown opcodes by hex', () => {
    expect(disassembleScript('ff')).toBe('OP_UNKNOWN(0xff)')
  })

  it('returns the input unchanged for malformed (odd-length) hex', () => {
    expect(disassembleScript('abc')).toBe('abc')
  })

  it('returns empty for empty input', () => {
    expect(disassembleScript('')).toBe('')
  })
})
