import type { Ref } from 'react'
import type { StakingAlgo, StakingOperationState, StakingOwnerAlgo, StakingPreview } from '../../../shared/staking'
import type { OperationStatus } from '../../lib/stakingView'
import { Pill, type PillTone } from '../../ui'

/** Display helpers the Staking page hands to its parts. */
export interface StakingFormat {
  readonly asset: string
  /** Native amount without the ticker: "0.1009". */
  number(atomic: string | bigint): string
  /** Native amount with the ticker: "0.1009 COIN". */
  money(atomic: string | bigint): string
  /** Token amount with its ticker, or atomic units when the token is unknown. */
  token(id: string, atomic: string): string
}

export const KEY_SHORT: Record<StakingOwnerAlgo, string> = { ecdsa: 'ECDSA', falcon512: 'Falcon-512', schnorr: 'Schnorr' }
export const KEY_HINT: Record<StakingAlgo, string> = {
  ecdsa: 'Classic signatures. Smaller transactions and lower fees.',
  falcon512: 'Quantum-resistant signatures. Larger transactions and higher fees.',
}

export const OPERATION_FEEDBACK: Record<StakingOperationState, { variant: 'success' | 'info' | 'error'; text: string }> = {
  prepared: { variant: 'info', text: 'Transaction prepared. It has not been sent yet.' },
  signed: { variant: 'info', text: 'Transaction saved. Network acceptance has not been confirmed yet.' },
  pending: { variant: 'info', text: 'Transaction is awaiting confirmation.' },
  confirmed: { variant: 'success', text: 'Transaction confirmed.' },
  conflict: { variant: 'error', text: 'Transaction could not complete: its inputs were spent by another transaction. Refresh and review a new transaction.' },
  rejected: { variant: 'error', text: 'Transaction rejected. See the details below before trying again.' },
  abandoned: { variant: 'error', text: 'Transaction was not completed. Review a new transaction to continue.' },
}

export function previewTitle(preview: StakingPreview): string {
  if (preview.recoveryOf !== undefined) return 'Recovery transfer'
  if (preview.tokenId !== undefined) return 'Token return'
  return preview.kind === 'funding' ? 'Delegation' : 'Unstake'
}

/** The number at display weight with a quieter ticker; the text reads "0.1009 COIN". */
export function Amount({ fmt, atomic, size }: { fmt: StakingFormat; atomic: string | bigint; size?: 'big' | 'mid' }) {
  return <span className={`staking-amount${size === undefined ? '' : ` staking-amount--${size}`}`}>
    <span className="staking-amount-number">{fmt.number(atomic)}</span> <span className="staking-amount-ticker">{fmt.asset}</span>
  </span>
}

const PILL_TONE: Record<OperationStatus['tone'], PillTone> = { neutral: 'neutral', progress: 'neutral', success: 'success', warning: 'warning', danger: 'danger' }

export function StatusPill({ status }: { status: OperationStatus }) {
  return <Pill tone={PILL_TONE[status.tone]} icon={status.tone === 'progress' ? <span className="staking-progress-dot" aria-hidden="true" /> : undefined}>{status.label}</Pill>
}

export const clockTime = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** "Today, 14:02", "Yesterday, 18:30", or a short date with time. */
export function dateTime(ms: number, now = Date.now()): string {
  const date = new Date(ms), today = new Date(now), yesterday = new Date(now)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return `Today, ${clockTime(ms)}`
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${clockTime(ms)}`
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit' })
}

/** Send-style amount input: large number, ticker and Max inside the field. The
 * help text and the error share one slot so the actions below never move. */
export function AmountField({ id, label, ariaLabel, asset, value, max, help, error, shown, inputRef, onChange, onBlur, onMax }: {
  id: string; label: string; ariaLabel: string; asset: string; value: string; max: boolean; help: string
  /** The message for the current value, kept in the slot even while hidden. */
  error: string | null
  /** Whether the error is shown now (after blur or a review request). */
  shown: boolean
  inputRef: Ref<HTMLInputElement>
  onChange: (value: string) => void; onBlur: () => void; onMax: () => void
}) {
  const hintId = `${id}-hint`
  return <div>
    <label className="field-label staking-amount-label" htmlFor={id}>{label}</label>
    <div className={`field-wrap staking-amount-field${shown ? ' field-wrap--error' : ''}`}>
      <input ref={inputRef} id={id} inputMode="decimal" autoComplete="off" placeholder="0.00" value={value}
        aria-label={ariaLabel} aria-invalid={shown || undefined} aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
      <span className="staking-amount-asset">{asset}</span>
      <button type="button" className="staking-amount-max" aria-pressed={max} onClick={onMax}>Max</button>
    </div>
    <div id={hintId} className={`field-hint staking-amount-hint${shown ? ' field-hint--error' : ''}`}>
      <span style={{ visibility: shown ? 'hidden' : 'visible' }}>{help}</span>
      <span role={shown ? 'alert' : undefined} style={{ visibility: shown ? 'visible' : 'hidden' }}>{error}</span>
    </div>
  </div>
}
