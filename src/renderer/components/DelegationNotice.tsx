import { Alert } from '../ui'

export function DelegationNotice({ delegatePubkeyhash, requiresImport = false }: { delegatePubkeyhash: string; requiresImport?: boolean }) {
  return <Alert variant="caution">
    <span>
      <strong>Delegated staking</strong>
      <span style={{ display: 'block', margin: '6px 0' }}>This key controls a delegated address. Send uses only ordinary coins. {requiresImport ? 'Import this key as a wallet and unstake in Staking before sending delegated coins.' : 'Use Staking to unstake before sending delegated coins.'} Locked outputs must mature first.</span>
      <span style={{ display: 'block', fontSize: 12 }}>Delegate pubkeyhash</span>
      <code style={{ fontFamily: 'var(--mono)', fontSize: 12, wordBreak: 'break-all' }}>{delegatePubkeyhash}</code>
    </span>
  </Alert>
}
