import { hkdfSync } from 'node:crypto'
import { derivePath, falcon512KeygenFromSeed, FALCON512_SEED_BYTES, type HDKey, type Network } from '@qbtc/crypto'
import { STAKING_DERIVATIONS } from '../brand/delegation'
import type { StakingDerivation } from './delegationTypes'
import type { StakingAlgo, StakingOwnerAlgo } from '../../shared/staking'

export type StakingOwner =
  | { readonly kind: 'hd'; readonly derivationId: string; readonly algo: StakingAlgo; readonly account: number }
  | { readonly kind: 'key'; readonly algo: StakingOwnerAlgo }

export function stakingDerivation(id: string): StakingDerivation {
  const version = STAKING_DERIVATIONS.find((s) => s.id === id)
  if (version === undefined) throw new Error('Unknown staking derivation version. This wallet does not support this delegation.')
  return version
}

function validAccount(account: unknown): account is number {
  return typeof account === 'number' && Number.isInteger(account) && account >= 0 && account < 0x80000000
}

export function stakingPath(owner: StakingOwner, network: Network): string {
  if (owner.kind !== 'hd') throw new Error('Imported keys have no staking HD path.')
  const version = stakingDerivation(owner.derivationId)
  if (!validAccount(owner.account)) throw new Error('Invalid staking account reference.')
  const account = owner.account
  const coin = version.coinType[network]
  return owner.algo === 'falcon512' ? `m/512'/${coin}'/${account}'/2'/0'` : `m/44'/${coin}'/${account}'/2/0`
}

/** The caller owns and wipes the returned private bytes, including late results. */
export async function deriveStakingKey(master: HDKey, owner: StakingOwner, network: Network): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  if (owner.kind !== 'hd') throw new Error('This staking owner needs an imported key.')
  const version = stakingDerivation(owner.derivationId)
  const child = derivePath(master, stakingPath(owner, network))
  let seed: Uint8Array | undefined
  try {
    if (child.privateKey === null || child.publicKey === null) throw new Error('Staking key is unavailable.')
    if (owner.algo === 'falcon512') {
      // Same mapping as the ordinary Falcon derivation, with an explicit staking
      // path: the SDK's receive/change helpers only accept branches 0 and 1.
      seed = new Uint8Array(hkdfSync('sha256', child.privateKey, new Uint8Array(), version.falconHdInfo, FALCON512_SEED_BYTES))
      child.wipePrivateData()
      return await falcon512KeygenFromSeed(seed)
    }
    return { privateKey: child.privateKey.slice(), publicKey: child.publicKey.slice() }
  } finally { child.wipePrivateData(); seed?.fill(0) }
}

export function fixedStakingOwners(account: number): readonly StakingOwner[] {
  if (!validAccount(account)) throw new Error('Invalid staking account reference.')
  return STAKING_DERIVATIONS.flatMap((v) => (['ecdsa', 'falcon512'] as const).map((algo) => ({
    kind: 'hd' as const, derivationId: v.id, algo, account,
  })))
}
