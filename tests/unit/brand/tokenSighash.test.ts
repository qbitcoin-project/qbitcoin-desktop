import { describe, expect, it } from 'vitest'
import { sighashCommitsTokenId } from '../../../src/main/brand/crypto'
import { PROFILE } from '../../../src/main/brand/profile'

// QBitcoin's node commits the token id in its transaction sign data from
// the start (its token-sighash change is ungated on this chain); a wallet
// signing without it would have every token transfer rejected. The framing
// itself is pinned upstream by @qbtc/crypto's transaction tests.
describe('QBitcoin token sighash', () => {
  it('signs the token id on both networks, since genesis', () => {
    expect(PROFILE.tokenSighashFork).toEqual({ mainnet: 0, testnet: 0 })
    expect(sighashCommitsTokenId('mainnet')).toBe(true)
    expect(sighashCommitsTokenId('testnet')).toBe(true)
  })
})
