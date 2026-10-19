/** Public staking models. Private keys and unsigned signing data stay in main. */
export type StakingAlgo = 'ecdsa' | 'falcon512'
/** Schnorr is supported only for returning an imported delegated WIF. */
export type StakingOwnerAlgo = StakingAlgo | 'schnorr'
export interface StakingInfo {
  readonly enabled: boolean
  readonly network: 'mainnet' | 'testnet'
  readonly fundingEnabled: boolean
  readonly serviceLabel?: string
  readonly minimumAtomic?: string
  readonly minimumVerified: boolean
  readonly commission?: string
  readonly maturitySeconds?: number
  readonly algorithms: readonly StakingAlgo[]
  readonly notice?: string
}
export type StakingOperationState = 'prepared' | 'signed' | 'pending' | 'confirmed' | 'conflict' | 'rejected' | 'abandoned'
export interface StakingOperationView {
  readonly tokenId?: string
  readonly tokenAmountAtomic?: string
  readonly recoveryOf?: string
  readonly id: string
  readonly address: string
  readonly kind: 'funding' | 'withdrawal'
  readonly state: StakingOperationState
  readonly amountAtomic: string
  readonly feeAtomic: string
  readonly destination: string
  readonly createdAt: number
  readonly txid?: string
  readonly eligibleAt?: number
  readonly message?: string
  readonly autoRetry?: boolean
  readonly settled?: boolean
}
/** Read-only evidence from the confirmed chain, never a signing/retry intent. */
export interface StakingChainActivity {
  readonly source: 'chain'
  readonly id: string
  readonly address: string
  readonly txid: string
  readonly kind: 'deposit' | 'withdrawal' | 'stake' | 'slashing' | 'transaction'
  /** Net change at this address, including any native fee paid from it.
   * Missing prevouts leave the amount unknown, never guessed from outputs. */
  readonly balanceChangeAtomic?: string
  readonly tokenChanges: readonly { id: string; amountAtomic?: string }[]
  readonly feeAtomic?: string
  readonly createdAt?: number
  readonly blockHeight?: number
}
export interface StakingAddressView {
  readonly historyIncomplete?: boolean
  readonly tokens?: readonly { id: string; amountAtomic: string }[]
  readonly address: string
  readonly algo: StakingOwnerAlgo
  readonly serviceLabel: string
  readonly delegatePubkeyhash: string
  readonly ownerPubkeyhash: string
  readonly legacy: boolean
  readonly canFund: boolean
  readonly balanceAtomic: string
  readonly confirmedAtomic: string
  readonly pendingAtomic: string
  readonly matureAtomic: string
  /** Mature native coins excluding user freezes and pending-operation inputs. */
  readonly availableAtomic?: string
  readonly maturingAtomic: string
  readonly unknownAtomic: string
  readonly eligibleAt?: number
  readonly lastStakeAt?: number
  readonly lastRewardAtomic?: string
  readonly rewardUnknown?: boolean
  readonly slashed: boolean
  readonly stale: boolean
  readonly error?: string
}
export interface StakingSnapshot {
  readonly addresses: readonly StakingAddressView[]
  readonly operations: readonly StakingOperationView[]
  readonly chainActivity?: readonly StakingChainActivity[]
  readonly refreshedAt?: number
  readonly error?: string
}
export interface StakingFundingRequest {
  readonly algo: StakingAlgo
  readonly amountAtomic: string
  readonly max?: boolean
  readonly sourceAddress?: string
}
export interface StakingWithdrawalRequest {
  /** Return tokens to the ordinary wallet, using ordinary coins for the fee. */
  readonly tokenId?: string
  readonly address: string
  /** Net amount returned to the ordinary wallet; ignored for Max. */
  readonly amountAtomic: string
  readonly max?: boolean
}
export interface StakingPreview {
  readonly remainingTokenAmountAtomic?: string
  readonly tokenId?: string
  readonly tokenAmountAtomic?: string
  readonly recoveryOf?: string
  readonly draftId: string
  readonly kind: 'funding' | 'withdrawal'
  readonly address: string
  readonly algo: StakingOwnerAlgo
  readonly amountAtomic: string
  readonly feeAtomic: string
  readonly changeAtomic: string
  readonly destination: string
  readonly sourceLabel: string
  readonly inputAlgorithms: readonly string[]
  readonly inputCount: number
  readonly sizeUpperBound: number
  readonly eligibleAt?: number
  /** Total left at the delegation, including coins unavailable for this unstake. */
  readonly stakingRemainingAtomic?: string
  readonly remainingParts: number
  readonly remainingAtomic: string
  readonly estimatedTotalFeeAtomic: string
}
export interface StakingResult { readonly operationId: string; readonly txid?: string; readonly state: StakingOperationState }
