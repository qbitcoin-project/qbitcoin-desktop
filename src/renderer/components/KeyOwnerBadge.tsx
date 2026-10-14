import type { WalletInfo } from '../../shared/protocol'
import { Pill } from '../ui'

export function KeyOwnerBadge({ wallet }: { wallet: WalletInfo | undefined }) {
  if (wallet?.kind !== 'key' || wallet.ownerAlgo === undefined) return null
  const name = wallet.ownerAlgo === 'falcon512' ? 'Falcon-512' : wallet.ownerAlgo === 'schnorr' ? 'Schnorr' : 'ECDSA'
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
    <Pill tone={wallet.ownerAlgo === 'falcon512' ? 'pq' : undefined}>Owner: {name}</Pill>
    {wallet.delegatePubkeyhash !== undefined && <Pill>Delegated staking</Pill>}
  </div>
}
