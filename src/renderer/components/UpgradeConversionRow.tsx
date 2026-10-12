import type { UpgradeEpisodeView } from '../../shared/protocol'
import { brand } from '../brand'
import { formatNative, formatToken, shortHash } from '../lib/format'
import { CopyValue } from '../ui'

export function UpgradeConversionRow({ episode, sourceLabel, nativeLabel, sourceExplorer }: {
  episode: UpgradeEpisodeView
  sourceLabel: string
  nativeLabel: string
  sourceExplorer: string | null
}) {
  const credit = episode.credit?.state === 'received' ? episode.credit : null
  const amount = credit !== null ? `${formatNative(credit.amountAtomic)} ${nativeLabel}` : `${formatToken(episode.lockValueSat, 8)} ${sourceLabel}`
  const txid = credit?.txid ?? episode.txid
  const explorer = credit !== null ? brand.explorerTxUrl : sourceExplorer
  const state = credit !== null ? 'Received'
    : !episode.confirmed ? `${sourceLabel} pending`
    : episode.credit?.state === 'unavailable' ? `${nativeLabel} credit status unavailable`
    : episode.confirmations !== undefined && episode.confirmations < 6 ? `${String(episode.confirmations)}/6 ${sourceLabel} confirmations`
    : `Awaiting ${nativeLabel} credit`
  const color = credit !== null ? 'var(--success)' : 'var(--warning)'

  return (
    <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <span aria-hidden="true" style={{ width: 7, height: 7, flex: 'none', borderRadius: '50%', background: color }} />
        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-900)' }}>{amount}</span>
        <span style={{ fontSize: 11.5, color, marginLeft: 'auto' }}>{state}</span>
        {explorer !== null && (
          <a
            className="content-refresh"
            style={{ height: 26, padding: '0 8px', fontSize: 11.5, textDecoration: 'none' }}
            href={`${explorer}${txid}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={credit !== null ? `View ${nativeLabel} credit in explorer` : `View ${sourceLabel} transaction in explorer`}
          >
            {credit !== null ? 'Explorer' : `${sourceLabel} transaction`}
          </a>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 7, fontSize: 11.5, color: 'var(--ink-500)' }}>
        {credit !== null && (
          <>
            <div>
              From {formatToken(episode.lockValueSat, 8)} {sourceLabel}
              {credit.blockTime !== undefined && (
                <> · <time dateTime={new Date(credit.blockTime * 1000).toISOString()}>{new Date(credit.blockTime * 1000).toLocaleString()}</time></>
              )}
            </div>
            <div>To <CopyValue text={credit.address} style={{ fontFamily: 'var(--mono)', overflowWrap: 'anywhere' }} /></div>
          </>
        )}
        <div>{credit !== null ? nativeLabel : sourceLabel} transaction: <CopyValue text={txid} display={shortHash(txid)} style={{ fontFamily: 'var(--mono)' }} /></div>
      </div>
    </div>
  )
}
