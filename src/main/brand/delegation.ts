import type { Network } from '@qbtc/crypto'
import type { DelegateProfile, DelegationPrefixes, StakingDerivation } from '../wallet/delegationTypes'

// BRAND FILE: delegated-key envelopes and public pubkeyhash prefixes from the
// chain's network parameters. Independent of the owner's signing algorithm.
// A brand without delegated keys sets null and ships no DELEGATE_PROFILES.
export const DELEGATION: Readonly<Record<Network, DelegationPrefixes>> | null = {
  mainnet: { wifHash256: 0x8d, wifHash160: 0x8e, pubkeyhashMagic: Uint8Array.of(0x27, 0x10) },
  testnet: { wifHash256: 0xf0, wifHash160: 0xf1, pubkeyhashMagic: Uint8Array.of(0x3f, 0x00) },
}

// BRAND FILE: immutable recovery paths. Never edit a shipped entry; retain
// old shipped entries when adding a new active version. Staking uses branch 2
// in each account.
export const STAKING_DERIVATIONS: readonly StakingDerivation[] = [{
  id: 'staking-owner-v2', schemeId: 'qbt-v1-slip44',
  coinType: { mainnet: 2009, testnet: 1 }, falconHdInfo: 'qbt/pq/falcon512/v1', active: true,
}]

// BRAND FILE: public service identifiers, not payment addresses. Funding is
// open on both networks, with a confirmed minimum of 0.001 coins per deposit.
export const DELEGATE_PROFILES: readonly DelegateProfile[] = [
  {
    id: 'qbt-testnet-service-v1', label: 'QBitcoin staking service', network: 'testnet',
    hashes: { ecdsa: '2vtxEqTSm1kacvSys13JyNBJLJfxNijDRxWy', falcon512: 'AKZRT5sqJx9eQJTW6mD1Toi7TojxPorMorjnHoaN5iZCSeh8NH9R' },
    status: 'active', minimumAtomic: '100000', minimumVerified: true, fundingEnabled: true,
  },
  {
    id: 'qbt-mainnet-service-v1', label: 'QBitcoin staking service', network: 'mainnet',
    hashes: { ecdsa: '2CNozvhUpk5zxsnXS6PtoMcKPu3gjxcFPNy6', falcon512: '6nA5bL9H8FZA1HbV1PK73QZhCjBBMBZxJFrrLb9sUdWAgXPok9rv' },
    status: 'active', minimumAtomic: '100000', minimumVerified: true, fundingEnabled: true,
  },
]
