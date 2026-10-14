import { Alert } from '../ui'

export function DelegationNotice({ delegatePubkeyhash }: { delegatePubkeyhash: string }) {
  return <Alert variant="caution">
    <span>
      <strong>Delegated staking</strong>
      <span style={{ display: 'block', margin: '6px 0' }}>This key controls a delegated address. The delegate can stake its coins; you can spend them. Recent staking outputs may need to mature before a send confirms.</span>
      <span style={{ display: 'block', fontSize: 12 }}>Delegate pubkeyhash</span>
      <code style={{ fontFamily: 'var(--mono)', fontSize: 12, wordBreak: 'break-all' }}>{delegatePubkeyhash}</code>
    </span>
  </Alert>
}
