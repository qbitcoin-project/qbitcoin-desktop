import type { Network } from '@qbtc/crypto'
import type { StakingAlgo } from '../../shared/staking'

// BRAND FILE: delegated-key envelopes and public pubkeyhash prefixes from the
// chain's network parameters. Independent of the owner's signing algorithm.
export const DELEGATION: Readonly<Record<Network, {
  readonly wifHash256: number
  readonly wifHash160: number
  readonly pubkeyhashMagic: Uint8Array
}>> = {
  mainnet: { wifHash256: 0x8d, wifHash160: 0x8e, pubkeyhashMagic: Uint8Array.of(0x27, 0x10) },
  testnet: { wifHash256: 0xf0, wifHash160: 0xf1, pubkeyhashMagic: Uint8Array.of(0x3f, 0x00) },
}

export interface StakingDerivation {
  readonly id: string
  readonly schemeId: string
  readonly coinType: Readonly<Record<Network, number>>
  readonly falconHdInfo: string
  readonly active: boolean
}

// BRAND FILE: immutable recovery paths. Never edit a shipped entry; retain
// old shipped entries when adding a new active version. Staking uses branch 2
// in each account. None is listed yet: seed wallets get no staking
// owner keys until a brand adds its derivation.
export const STAKING_DERIVATIONS: readonly StakingDerivation[] = []

export interface DelegateProfile {
  readonly id: string
  readonly label: string
  readonly network: Network
  readonly hashes: Readonly<Record<StakingAlgo, string>>
  readonly status: 'active' | 'legacy'
  readonly minimumAtomic: string
  readonly minimumVerified: boolean
  readonly commission?: string
  readonly fundingEnabled: boolean
}

// BRAND FILE: public service identifiers, not payment addresses. No staking
// service is configured yet, so delegation funding stays unavailable.
export const DELEGATE_PROFILES: readonly DelegateProfile[] = []
