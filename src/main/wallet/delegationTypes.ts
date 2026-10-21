import type { Network } from '@qbtc/crypto'
import type { StakingAlgo } from '../../shared/staking'

// Shapes of the brand's delegation values (../brand/delegation.ts). Shared
// code: each brand fills in its own values.

/** Delegated-key WIF versions and the delegate pubkeyhash prefix of one network. */
export interface DelegationPrefixes {
  readonly wifHash256: number
  readonly wifHash160: number
  readonly pubkeyhashMagic: Uint8Array
}

export interface StakingDerivation {
  readonly id: string
  readonly schemeId: string
  readonly coinType: Readonly<Record<Network, number>>
  readonly falconHdInfo: string
  readonly active: boolean
}

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
