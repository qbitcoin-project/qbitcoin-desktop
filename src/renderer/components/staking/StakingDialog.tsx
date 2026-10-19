import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { StakingAddressView, StakingAlgo, StakingInfo, StakingOperationState, StakingOperationView, StakingPreview, StakingResult } from '../../../shared/staking'
import { validateAmount } from '../../lib/amountValidation'
import { shortHash } from '../../lib/format'
import { keyName, operationTitle } from '../../lib/stakingView'
import { Alert, Button, CopyValue, Segmented } from '../../ui'
import { CloseIcon } from '../../ui/icons'
import { AmountField, KEY_HINT, KEY_SHORT, OPERATION_FEEDBACK, previewTitle, type StakingFormat } from './shared'

export type DialogMode =
  | { readonly kind: 'delegate' }
  | { readonly kind: 'unstake'; readonly address: string; readonly choose: boolean }
  | { readonly kind: 'tokens'; readonly address: string }
  | { readonly kind: 'recovery'; readonly opId: string }
export type DialogStep = 'form' | 'review' | 'result'
export interface AmountForm { readonly amount: string; readonly max: boolean }
export interface DelegateForm extends AmountForm { readonly algo: StakingAlgo }

const TITLE: Record<DialogMode['kind'], string> = { delegate: 'Delegate coins', unstake: 'Unstake', tokens: 'Return tokens', recovery: 'Recovery transfer' }
const CONFIRM: Record<DialogMode['kind'], string> = { delegate: 'Confirm delegation', unstake: 'Confirm unstake', tokens: 'Confirm token return', recovery: 'Confirm recovery transfer' }
const RESULT_VERB: Record<StakingOperationState, string> = {
  prepared: 'saved', signed: 'sent', pending: 'sent', confirmed: 'confirmed', conflict: 'didn’t go through', rejected: 'was rejected', abandoned: 'wasn’t completed',
}
const algoLabel = (algo: string): string => KEY_SHORT[algo as keyof typeof KEY_SHORT] ?? algo
const atTime = (seconds: number): string => new Date(seconds * 1000).toLocaleString()

export function StakingDialog(props: {
  mode: DialogMode; step: DialogStep; busy: boolean
  info: StakingInfo; addresses: readonly StakingAddressView[]; operations: readonly StakingOperationView[]
  preview: StakingPreview | null; result: StakingResult | null; error: string | null
  fmt: StakingFormat; ordinaryAtomic?: string
  delegateForm: DelegateForm; onDelegateForm: (form: DelegateForm) => void
  unstakeForm: AmountForm; onUnstakeForm: (form: AmountForm) => void
  onChooseAddress: (address: string) => void
  /** Calculates Max without a review; resolves to the filled amount when it succeeds. */
  onMax: () => Promise<boolean>
  onReview: (atomic: bigint, max: boolean) => void
  onBack: () => void; onConfirm: () => void; onDone: () => void; onClose: () => void
}) {
  const { mode, step, busy, preview, onClose } = props
  const titleId = useId(), formId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const stepRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current!
    const returnFocus = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      // React may remove the dialog before this cleanup, so restore explicitly.
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true })
    }
  }, [])
  // Each step takes focus: the amount for a form, the summary for review and result.
  useEffect(() => {
    if (step === 'form') amountRef.current?.focus()
    else stepRef.current?.focus({ preventScroll: true })
  }, [step])

  const unstakeEntry = mode.kind === 'unstake' ? props.addresses.find((a) => a.address === mode.address) : undefined
  const subtitle = mode.kind === 'delegate' ? `To ${props.info.serviceLabel ?? 'the staking service'}`
    : mode.kind === 'unstake' ? 'Coins return to your ordinary wallet'
    : mode.kind === 'tokens' ? 'Tokens return to your ordinary address' : 'A new transfer with a higher network fee'
  const unavailable = mode.kind === 'unstake' && (unstakeEntry === undefined || unstakeEntry.stale || BigInt(unstakeEntry.availableAtomic ?? unstakeEntry.matureAtomic) === 0n)

  let body: ReactNode = null, footer: ReactNode = null
  if (step === 'form') {
    body = mode.kind === 'delegate'
      ? <DelegateFormView {...props} formId={formId} amountRef={amountRef} />
      : unstakeEntry !== undefined ? <>
        <UnstakeFrom entry={unstakeEntry} choose={mode.kind === 'unstake' && mode.choose} addresses={props.addresses} busy={busy} onChooseAddress={props.onChooseAddress} />
        <UnstakeFormView key={unstakeEntry.address} {...props} entry={unstakeEntry} formId={formId} amountRef={amountRef} />
      </> : null
    footer = <>
      <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button type="submit" form={formId} disabled={busy || unavailable}>{busy ? 'Calculating…' : mode.kind === 'delegate' ? 'Review delegation' : 'Review unstake'}</Button>
    </>
  } else if (step === 'review' && preview !== null) {
    body = <ReviewView preview={preview} info={props.info} fmt={props.fmt} error={props.error} stepRef={stepRef} />
    const back = mode.kind === 'delegate' || mode.kind === 'unstake'
    footer = <>
      <Button variant="secondary" disabled={busy} onClick={back ? props.onBack : onClose}>{back ? 'Back' : 'Cancel'}</Button>
      <Button disabled={busy} onClick={props.onConfirm}>{busy ? 'Saving and sending…' : CONFIRM[mode.kind]}</Button>
    </>
  } else if (step === 'result' && props.result !== null) {
    body = <ResultView result={props.result} preview={preview} operations={props.operations} stepRef={stepRef} />
    footer = <><span /><Button onClick={props.onDone}>Done</Button></>
  }

  // Native modal focus and Escape; no light-dismiss or backdrop click handler.
  return <dialog ref={dialogRef} className={`staking-dialog staking-dialog--${mode.kind}`} aria-labelledby={titleId}
    closedby={busy ? 'none' : 'closerequest'}
    onKeyDown={(event) => { if (event.key === 'Escape' && busy) { event.preventDefault(); event.stopPropagation() } }}
    onClose={() => {
      const dialog = dialogRef.current
      // A close event can arrive after the dialog was shown again (StrictMode remounts).
      if (!dialog?.isConnected || dialog.open) return
      if (busy) dialog.showModal(); else onClose()
    }}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <div className="modal-head">
      <div className="staking-dialog-title"><h2 id={titleId}>{TITLE[mode.kind]}</h2><p className="modal-sub">{subtitle}</p></div>
      <button type="button" className="modal-close" aria-label="Close" disabled={busy} onClick={onClose}><CloseIcon size={18} /></button>
    </div>
    <div className="staking-dialog-body">
      {(mode.kind === 'delegate' || mode.kind === 'unstake') && <Steps step={step} />}
      {body}
    </div>
    <div className="staking-dialog-foot">{footer}</div>
  </dialog>
}

/** An action error scrolls into the dialog's visible area on small windows. */
function DialogError({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest' }) }, [text])
  return <div ref={ref} className="staking-feedback"><Alert variant="error">{text}</Alert></div>
}

function Steps({ step }: { step: DialogStep }) {
  const order: readonly DialogStep[] = ['form', 'review', 'result']
  const at = order.indexOf(step)
  return <ol className="staking-steps" aria-label="Progress">
    {['Amount', 'Review', 'Sent'].map((label, index) => <li key={label} aria-current={index === at ? 'step' : undefined}
      data-state={index === at ? 'current' : index < at ? 'done' : 'next'}><span aria-hidden="true">{index + 1}</span>{label}</li>)}
  </ol>
}

/** Neutral until the user leaves an invalid value or asks for a review. */
function useAmountState(value: string, validation: { atomic: bigint | null; error: string | null }) {
  const [touched, setTouched] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const error = validation.error ?? (value.trim() === '' ? 'Enter an amount or use Max.' : null)
  const shown = submitted ? error !== null : touched && validation.error !== null
  return { error, shown, touch: () => setTouched(true), submit: () => setSubmitted(true), reset: () => { setTouched(false); setSubmitted(false) } }
}

function DelegateFormView({ info, fmt, ordinaryAtomic, busy, error, delegateForm: form, onDelegateForm, onMax, onReview, formId, amountRef }: {
  info: StakingInfo; fmt: StakingFormat; ordinaryAtomic?: string; busy: boolean; error: string | null
  delegateForm: DelegateForm; onDelegateForm: (form: DelegateForm) => void
  onMax: () => Promise<boolean>; onReview: (atomic: bigint, max: boolean) => void
  formId: string; amountRef: RefObject<HTMLInputElement | null>
}) {
  const amountId = useId()
  const validation = validateAmount(form.amount, { minimum: info.minimumAtomic === undefined ? null : BigInt(info.minimumAtomic) })
  const amount = useAmountState(form.amount, validation)
  const help = `${info.minimumAtomic === undefined ? '' : `Minimum ${fmt.money(info.minimumAtomic)} per transfer. `}The network fee is paid from your ordinary coins.${info.minimumVerified ? '' : ' The service hasn’t confirmed this minimum yet.'}`
  const commission = info.commission?.trim()
  return <form id={formId} className="staking-dialog-form" noValidate onSubmit={(event) => {
    event.preventDefault(); amount.submit()
    if (validation.atomic !== null && validation.error === null) onReview(validation.atomic, form.max)
    else amountRef.current?.focus()
  }}>
    <fieldset className="staking-fields" disabled={busy}>
      <div>
        <div className="field-label">Owner key</div>
        <Segmented ariaLabel="Owner key" value={form.algo} onChange={(algo) => onDelegateForm({ ...form, algo, max: false })}
          options={info.algorithms.map((value) => ({ value, label: KEY_SHORT[value] }))} />
        <p className="staking-hint">{KEY_HINT[form.algo]}</p>
      </div>
      <AmountField id={amountId} label="Amount" ariaLabel={`Amount to delegate (${fmt.asset})`} asset={fmt.asset} value={form.amount} max={form.max}
        help={help} error={amount.error} shown={amount.shown} inputRef={amountRef} onBlur={amount.touch}
        onChange={(value) => { onDelegateForm({ ...form, amount: value, max: false }); amount.reset() }}
        onMax={() => void onMax().then((filled) => { if (filled) amount.reset() })} />
      {ordinaryAtomic !== undefined && <p className="staking-muted">Ordinary coins: {fmt.money(ordinaryAtomic)}</p>}
      {commission !== undefined && commission !== '' && <p className="staking-muted">Service commission: {commission}</p>}
    </fieldset>
    {error !== null && <DialogError text={error} />}
  </form>
}

/** Which key to unstake from. It stays outside the per-key form so focus survives a change, and is locked while busy. */
function UnstakeFrom({ entry, choose, addresses, busy, onChooseAddress }: {
  entry: StakingAddressView; choose: boolean; addresses: readonly StakingAddressView[]; busy: boolean; onChooseAddress: (address: string) => void
}) {
  const choices = addresses.filter((a) => !a.stale && BigInt(a.availableAtomic ?? a.matureAtomic) > 0n)
  if (!choose || choices.length < 2 || !choices.some((c) => c.address === entry.address)) return <p className="staking-muted">From your {keyName(entry.algo)}</p>
  return <fieldset className="staking-fields" disabled={busy}>
    <div><div className="field-label">From</div>
      <Segmented ariaLabel="Unstake from" value={entry.address} onChange={onChooseAddress}
        options={choices.map((c) => ({ value: c.address, label: c.legacy && choices.some((o) => o !== c && o.algo === c.algo) ? `${KEY_SHORT[c.algo]} (legacy)` : KEY_SHORT[c.algo] }))} /></div>
  </fieldset>
}

function UnstakeFormView({ entry, fmt, busy, error, unstakeForm: form, onUnstakeForm, onMax, onReview, formId, amountRef }: {
  entry: StakingAddressView; fmt: StakingFormat; busy: boolean; error: string | null
  unstakeForm: AmountForm; onUnstakeForm: (form: AmountForm) => void
  onMax: () => Promise<boolean>; onReview: (atomic: bigint, max: boolean) => void
  formId: string; amountRef: RefObject<HTMLInputElement | null>
}) {
  const amountId = useId()
  const available = BigInt(entry.availableAtomic ?? entry.matureAtomic)
  const validation = validateAmount(form.amount, { available })
  const amount = useAmountState(form.amount, validation)
  const unavailable = busy || entry.stale || available === 0n
  return <form id={formId} className="staking-dialog-form" noValidate onSubmit={(event) => {
    event.preventDefault(); amount.submit()
    if (!unavailable && validation.atomic !== null && validation.error === null) onReview(validation.atomic, form.max)
    else if (!unavailable) amountRef.current?.focus()
  }}>
    <fieldset className="staking-fields" disabled={unavailable}>
      <AmountField id={amountId} label="Amount you receive" ariaLabel={`Amount you receive (${fmt.asset})`} asset={fmt.asset} value={form.amount} max={form.max}
        help="The network fee is paid from staking; the remainder stays delegated." error={amount.error} shown={amount.shown}
        inputRef={amountRef} onBlur={amount.touch}
        onChange={(value) => { onUnstakeForm({ amount: value, max: false }); amount.reset() }}
        onMax={() => void onMax().then((filled) => { if (filled) amount.reset() })} />
      <p className="staking-muted">{entry.stale ? 'Available: refresh required before unstaking.' : `Available: ${fmt.money(available)} before fees. Max excludes frozen coins and coins reserved by pending operations.`}</p>
    </fieldset>
    {entry.stale && <Alert variant="warning">Staking data is stale. Close this window and refresh before continuing.</Alert>}
    {!entry.stale && available === 0n && <Alert>No coins are available to unstake now. Wait for confirmation or maturity.</Alert>}
    {error !== null && <DialogError text={error} />}
  </form>
}

function ReviewView({ preview, info, fmt, error, stepRef }: {
  preview: StakingPreview; info: StakingInfo; fmt: StakingFormat; error: string | null; stepRef: RefObject<HTMLElement | null>
}) {
  const funding = preview.kind === 'funding', token = preview.tokenId !== undefined
  const label = preview.recoveryOf !== undefined ? 'Review recovery transfer' : token ? 'Review token return' : funding ? 'Review delegation' : 'Review unstake'
  const hours = (info.maturitySeconds ?? 43200) / 3600
  return <section ref={stepRef} className="staking-review" aria-label={label} tabIndex={-1}>
    <dl className="staking-facts">
      <dt>Network</dt><dd>{info.network === 'testnet' ? 'Testnet' : 'Mainnet'}</dd>
      <dt>Owner key</dt><dd>{algoLabel(preview.algo)}</dd>
      <dt>From</dt><dd className={/\s/.test(preview.sourceLabel) ? undefined : 'staking-code'}>{preview.sourceLabel}</dd>
      <dt>{funding ? 'Delegation address' : 'Ordinary return address'}</dt><dd className="staking-code"><CopyValue text={preview.destination} /></dd>
      <dt>{funding ? 'Delegate' : 'You receive'}</dt><dd className="staking-strong">{token ? fmt.token(preview.tokenId!, preview.tokenAmountAtomic!) : fmt.money(preview.amountAtomic)}</dd>
      <dt>Network fee</dt><dd>{fmt.money(preview.feeAtomic)}</dd>
      {(funding || token) && preview.changeAtomic !== '0' && <><dt>Ordinary change</dt><dd>{fmt.money(preview.changeAtomic)}</dd></>}
      {!funding && preview.stakingRemainingAtomic !== undefined && <><dt>Remaining in staking</dt><dd>{fmt.money(preview.stakingRemainingAtomic)}</dd></>}
      {token && preview.remainingTokenAmountAtomic !== undefined && <><dt>Tokens remaining in staking</dt><dd>{fmt.token(preview.tokenId!, preview.remainingTokenAmountAtomic)}</dd></>}
      <dt>Inputs</dt><dd>{preview.inputCount} ({preview.inputAlgorithms.map(algoLabel).join(', ')})</dd>
    </dl>
    {preview.recoveryOf !== undefined ? <Alert variant="warning">This is a new transfer of the original reserved inputs back to your ordinary wallet, with a higher network fee. It competes with the original transaction; either may confirm first. Confirming pauses automatic retries of the original, but cannot cancel a copy already in the network. Reservations remain until the outcome is known.</Alert>
      : token ? <Alert>Return available tokens to your ordinary address. Ordinary coins pay the network fee; their change returns to the same ordinary address. Frozen or reserved tokens stay in staking. Large returns may require another separately reviewed transfer.</Alert>
      : funding ? <Alert>Your owner key controls spending. The service can stake these coins and their rewards. Stake outputs mature for {hours} hours; a confirmed deposit does not prove that the service accepted it.</Alert>
      : <Alert>
        The requested amount returns to your ordinary wallet; the network fee is paid from the staking coins. The remainder stays at the same staking address. Wait for confirmation before using the returned coins in Send. {preview.eligibleAt !== undefined && preview.eligibleAt * 1000 > Date.now()
          ? `The selected outputs cannot confirm before ${atTime(preview.eligibleAt)}. The node may reject an early submission. ` : ''}
        The validator may stake an input first. A conflict requires a new review; the wallet never signs a replacement automatically. New deposits after this preview are not included. Returning coins does not revoke this address permanently.
      </Alert>}
    {preview.remainingParts > 0 && <Alert variant="warning">
      Max needs {preview.remainingParts + 1} transactions for the currently available coins. You are approving the first part. Another {fmt.money(preview.remainingAtomic)} remains before fees; estimated total fees are {fmt.money(preview.estimatedTotalFeeAtomic)}. Review each following part separately.
    </Alert>}
    {error !== null && <DialogError text={error} />}
  </section>
}

function ResultView({ result, preview, operations, stepRef }: {
  result: StakingResult; preview: StakingPreview | null; operations: readonly StakingOperationView[]; stepRef: RefObject<HTMLElement | null>
}) {
  const op = operations.find((item) => item.id === result.operationId)
  const state = op?.state ?? result.state
  const feedback = OPERATION_FEEDBACK[state]
  const title = op !== undefined ? operationTitle(op) : preview !== null ? previewTitle(preview) : 'Transaction'
  const txid = op?.txid ?? result.txid
  return <section ref={stepRef} className="staking-result" aria-label="Result" tabIndex={-1}>
    <h3>{title} {RESULT_VERB[state]}</h3>
    <Alert variant={feedback.variant}>{feedback.text}</Alert>
    {op?.message !== undefined && <p className="staking-op-message">{op.message}</p>}
    {txid !== undefined && <p className="staking-muted">Transaction <CopyValue text={txid} display={shortHash(txid)} /></p>}
  </section>
}
