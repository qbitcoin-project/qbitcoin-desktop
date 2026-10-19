import { useEffect, useId, useRef, type ReactNode } from 'react'
import type { StakingAddressView, StakingAlgo, StakingInfo } from '../../../shared/staking'
import { balanceParts, barSegments, hasHoldings, keyName, lastReward, relativeTime, type BalanceParts, type SegmentKind } from '../../lib/stakingView'
import { Alert, Button, CopyValue, Pill } from '../../ui'
import { CloseIcon } from '../../ui/icons'
import { Amount, clockTime, dateTime, KEY_HINT, KEY_SHORT, type StakingFormat } from './shared'

const SEGMENT_LABEL: Record<SegmentKind, string> = {
  available: 'Available now', held: 'Frozen or reserved', unlocking: 'Unlocking', unknown: 'Unknown', pending: 'Pending',
}
const lockHours = (info: StakingInfo): number => (info.maturitySeconds ?? 43200) / 3600
const isEligible = (entry: StakingAddressView): boolean => !entry.stale && BigInt(entry.availableAtomic ?? entry.matureAtomic) > 0n

/** "16:40" today, otherwise a short date with time. */
function unlockTime(seconds: number): string {
  const ms = seconds * 1000
  return new Date(ms).toDateString() === new Date().toDateString() ? clockTime(ms) : dateTime(ms)
}

/** Composition of the staked balance; the accessible name carries the numbers. */
export function BalanceBar({ parts, fmt, small = false }: { parts: BalanceParts; fmt: StakingFormat; small?: boolean }) {
  const segments = barSegments(parts)
  if (segments.length === 0) return <div className={`staking-bar staking-bar--empty${small ? ' staking-bar--small' : ''}`} aria-hidden="true" />
  return <div className={`staking-bar${small ? ' staking-bar--small' : ''}`} role="img"
    aria-label={segments.map((s) => `${SEGMENT_LABEL[s.kind]} ${fmt.money(s.atomic)}`).join(', ')}>
    {segments.map((s) => <span key={s.kind} className={`staking-segment staking-segment--${s.kind}`} style={{ flexGrow: s.share }} />)}
  </div>
}

function LegendItem({ kind, value, note }: { kind: SegmentKind; value: ReactNode; note: string }) {
  return <div><dt><i className={`staking-swatch staking-segment--${kind}`} aria-hidden="true" />{SEGMENT_LABEL[kind]}</dt><dd>{value}<span className="staking-note-line">{note}</span></dd></div>
}

function unlockNote(parts: BalanceParts, info: StakingInfo): string {
  if (parts.unlocking === 0n) return `coins lock for ${lockHours(info)} h after a stake`
  if (parts.unlockAt === undefined) return 'until the stake matures'
  const relative = relativeTime(parts.unlockAt, Date.now())
  return `all unlock by ${unlockTime(parts.unlockAt)}${relative === '' ? '' : `, ${relative}`}`
}

export function BalanceLegend({ parts, info, fmt }: { parts: BalanceParts; info: StakingInfo; fmt: StakingFormat }) {
  return <dl className="staking-legend">
    <LegendItem kind="available" value={<Amount fmt={fmt} atomic={parts.available} />} note="before the network fee" />
    {parts.held > 0n && <LegendItem kind="held" value={<Amount fmt={fmt} atomic={parts.held} />} note="manage freezes in Coins" />}
    <LegendItem kind="unlocking" value={parts.unlocking > 0n ? <Amount fmt={fmt} atomic={parts.unlocking} /> : <span className="staking-none">Nothing locked</span>} note={unlockNote(parts, info)} />
    {parts.unknown > 0n && <LegendItem kind="unknown" value={<Amount fmt={fmt} atomic={parts.unknown} />} note={parts.stale ? 'couldn’t update' : 'refresh to check'} />}
    {parts.pending > 0n && <LegendItem kind="pending" value={<Amount fmt={fmt} atomic={parts.pending} />} note="awaiting confirmation" />}
  </dl>
}

/** Why Unstake is unavailable, in the order the owner can act on it. */
function unavailableText(parts: BalanceParts): string {
  const reasons = ['No coins are available to unstake now.']
  if (parts.stale) reasons.push('Refresh to update the balance.')
  if (parts.unlocking > 0n && parts.unlockAt !== undefined) reasons.push(`Staked coins unlock by ${unlockTime(parts.unlockAt)}.`)
  if (parts.held > 0n) reasons.push('Some coins are frozen or reserved by a pending operation; frozen coins can be managed in Coins.')
  if (parts.pending > 0n) reasons.push('Pending coins can be unstaked after they confirm and mature.')
  return reasons.join(' ')
}

interface Actions {
  readonly busy: boolean
  readonly onTokens: (address: string, tokenId: string) => void
  readonly feedback: (target: string) => ReactNode
}

export function StakingSummary({ info, addresses, hasOperations, refreshedAt, fmt, busy, onUnstake, onDelegate, onTokens, feedback }: Actions & {
  info: StakingInfo; addresses: readonly StakingAddressView[]; hasOperations: boolean; refreshedAt?: number; fmt: StakingFormat
  onUnstake: () => void; onDelegate: () => void
}) {
  const live = addresses.filter(hasHoldings)
  if (live.length === 0) return <EmptySummary info={info} hasOperations={hasOperations} fmt={fmt} busy={busy} onDelegate={onDelegate} />
  const parts = balanceParts(live)
  const single = live.length === 1 ? live[0] : undefined
  const reward = lastReward(live)
  const eligible = live.some(isEligible)
  const service = info.serviceLabel ?? live[0]!.serviceLabel
  return <section className="staking-summary" aria-labelledby="staking-summary-title">
    <div className="staking-summary-top">
      <div className="staking-summary-total">
        <h2 id="staking-summary-title" className="staking-label">In staking</h2>
        <p className="staking-total"><Amount fmt={fmt} atomic={parts.balance} size="big" /></p>
        <p className="staking-meta">{single !== undefined ? `${keyName(single.algo)}, delegated to ${single.serviceLabel}` : `${live.length} owner keys, delegated to ${service}`}</p>
      </div>
      <div className="staking-summary-side">
        {parts.stale ? <Pill tone="warning">Couldn’t update</Pill> : refreshedAt !== undefined && <span className="staking-muted">Updated {clockTime(refreshedAt)}</span>}
        {reward !== undefined && <div className="staking-reward">
          <span className="staking-muted">Last reward</span>
          <span className="staking-reward-amount">{reward.atomic === undefined ? 'Unknown' : `+${fmt.money(reward.atomic)}`}</span>
          <span className="staking-muted">{dateTime(reward.at * 1000)}</span>
        </div>}
      </div>
    </div>
    {parts.stale && <Alert variant="warning">Couldn’t update the staking balance. Showing the last known amount; unstaking it is unavailable until it updates.</Alert>}
    <BalanceBar parts={parts} fmt={fmt} />
    <div className="staking-summary-foot">
      <BalanceLegend parts={parts} info={info} fmt={fmt} />
      <div className="staking-actions">
        <Button variant="secondary" disabled={busy || !eligible} onClick={onUnstake}>Unstake</Button>
        {info.fundingEnabled && <Button disabled={busy} onClick={onDelegate}>Delegate coins</Button>}
      </div>
    </div>
    {!eligible && <p className="staking-note">{unavailableText(parts)}</p>}
    {single !== undefined && <AddressExtras entry={single} fmt={fmt} busy={busy} onTokens={onTokens} feedback={feedback} />}
  </section>
}

/** Shown until the first read of the staking addresses, so an empty state never flashes. */
export function SummaryPlaceholder() {
  return <section className="staking-summary" aria-labelledby="staking-summary-title" aria-busy="true">
    <div className="staking-summary-total">
      <h2 id="staking-summary-title" className="staking-label">In staking</h2>
      <p className="staking-total"><span className="staking-placeholder" aria-hidden="true" /></p>
      <p className="staking-meta">Checking staking balances…</p>
    </div>
    <div className="staking-bar staking-bar--empty" aria-hidden="true" />
  </section>
}

function EmptySummary({ info, hasOperations, fmt, busy, onDelegate }: {
  info: StakingInfo; hasOperations: boolean; fmt: StakingFormat; busy: boolean; onDelegate: () => void
}) {
  return <section className="staking-summary staking-summary--empty" aria-labelledby="staking-empty-title">
    <div className="staking-empty-main">
      <h2 id="staking-empty-title" className="staking-empty-title">{hasOperations ? 'Nothing in staking now' : 'Nothing in staking yet'}</h2>
      <p>Delegate coins to {info.serviceLabel ?? 'the staking service'}. It stakes them for you, and rewards are added to your staking balance. Your key stays in control, so you can unstake unlocked coins at any time.</p>
      {info.fundingEnabled && <Button disabled={busy} onClick={onDelegate}>Delegate coins</Button>}
    </div>
    <StakingTerms info={info} fmt={fmt} className="staking-empty-terms" />
  </section>
}

/** Service terms as facts; an unknown commission is omitted, a supplied one (even 0%) is shown. */
export function StakingTerms({ info, fmt, className }: { info: StakingInfo; fmt: StakingFormat; className?: string }) {
  const commission = info.commission?.trim()
  return <dl className={`staking-facts${className === undefined ? '' : ` ${className}`}`}>
    <dt>Service</dt><dd>{info.serviceLabel ?? 'Imported service'}</dd>
    <dt>Minimum</dt><dd>{info.minimumAtomic === undefined ? 'Not verified' : `${fmt.money(info.minimumAtomic)} per transfer${info.minimumVerified ? '' : ', not yet confirmed by the service'}`}</dd>
    <dt>After each stake</dt><dd>Coins stay locked for {lockHours(info)} hours</dd>
    {commission !== undefined && commission !== '' && <><dt>Service commission</dt><dd>{commission}</dd></>}
    <dt>Network</dt><dd>{info.network === 'testnet' ? 'Testnet' : 'Mainnet'}</dd>
  </dl>
}

/** The explanation behind the header's How it works. Read-only, so outside clicks may close it. */
export function StakingHelpDialog({ info, fmt, onClose }: { info: StakingInfo; fmt: StakingFormat; onClose: () => void }) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current!
    const returnFocus = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true })
    }
  }, [])
  // Each step keeps its text in one grid cell beside the number.
  return <dialog ref={dialogRef} className="staking-dialog staking-help" closedby="any" aria-labelledby={titleId}
    onClose={() => { if (!dialogRef.current?.open) onClose() }}>
    <div className="modal-head">
      <div className="staking-dialog-title"><h2 id={titleId}>How staking works</h2><p className="modal-sub">{info.serviceLabel ?? 'Imported service'}</p></div>
      <button type="button" className="modal-close" aria-label="Close" onClick={() => dialogRef.current?.close()}><CloseIcon size={18} /></button>
    </div>
    <div className="staking-dialog-body">
      <ol className="staking-how-steps">
        <li><span><strong>You delegate.</strong> Coins move to a staking address that your key controls. The service gets permission to stake them, not to spend them.</span></li>
        <li><span><strong>The service stakes.</strong> Rewards are added to the same address. Coins used in a stake stay locked for {lockHours(info)} hours.</span></li>
        <li><span><strong>You unstake.</strong> Any unlocked amount returns to your ordinary wallet. The network fee is paid from staking.</span></li>
      </ol>
      <StakingTerms info={info} fmt={fmt} className="staking-help-terms" />
    </div>
    <div className="staking-dialog-foot"><span /><Button onClick={() => dialogRef.current?.close()}>Got it</Button></div>
  </dialog>
}

/** Per-key cards, shown when more than one key holds coins. */
export function StakingKeys({ info, addresses, fmt, busy, onDelegate, onTokens, feedback }: Actions & {
  info: StakingInfo; addresses: readonly StakingAddressView[]; fmt: StakingFormat; onDelegate: (algo: StakingAlgo) => void
}) {
  const live = addresses.filter(hasHoldings)
  if (live.length < 2) return null
  const unused = info.fundingEnabled ? addresses.filter((a) => !hasHoldings(a) && a.canFund && a.algo !== 'schnorr') : []
  return <section className="staking-keys" aria-labelledby="staking-keys-title">
    <h2 id="staking-keys-title" className="staking-section-title">Delegations</h2>
    <div className="staking-key-grid">
      {live.map((entry) => <KeyCard key={entry.address} entry={entry} fmt={fmt} busy={busy} onTokens={onTokens} feedback={feedback} />)}
      {unused.map((entry) => <UnusedKeyCard key={entry.address} entry={entry} busy={busy} onDelegate={onDelegate} />)}
    </div>
  </section>
}

function KeyPills({ entry }: { entry: StakingAddressView }) {
  return <span className="staking-key-pills">
    {entry.algo === 'falcon512' && <Pill tone="pq">Post-quantum</Pill>}
    {entry.legacy && <Pill>Legacy delegation</Pill>}
  </span>
}

function KeyCard({ entry, fmt, busy, onTokens, feedback }: Actions & { entry: StakingAddressView; fmt: StakingFormat }) {
  const titleId = useId()
  const parts = balanceParts([entry])
  return <article className="staking-key" aria-labelledby={titleId}>
    <header className="staking-key-head">
      <div><h3 id={titleId}>{keyName(entry.algo)}</h3><p className="staking-muted">{entry.serviceLabel}</p></div>
      <KeyPills entry={entry} />
    </header>
    <p className="staking-key-amount"><Amount fmt={fmt} atomic={entry.balanceAtomic} size="mid" /></p>
    {entry.stale ? <Alert variant="warning">Couldn’t update this balance. Unstaking from this key is unavailable until it updates.</Alert> : <>
      <BalanceBar parts={parts} fmt={fmt} small />
      <dl className="staking-key-facts">
        <div><dt>Available now</dt><dd><Amount fmt={fmt} atomic={parts.available} /></dd></div>
        <div><dt>Unlocking</dt><dd>{parts.unlocking > 0n ? <><Amount fmt={fmt} atomic={parts.unlocking} />{parts.unlockAt !== undefined && <span className="staking-note-line">by {unlockTime(parts.unlockAt)}</span>}</> : <span className="staking-none">Nothing locked</span>}</dd></div>
        {parts.pending > 0n && <div><dt>Pending</dt><dd><Amount fmt={fmt} atomic={parts.pending} /></dd></div>}
        {parts.held > 0n && <div><dt>Frozen or reserved</dt><dd><Amount fmt={fmt} atomic={parts.held} /></dd></div>}
      </dl>
    </>}
    <AddressExtras entry={entry} fmt={fmt} busy={busy} onTokens={onTokens} feedback={feedback} />
  </article>
}

function UnusedKeyCard({ entry, busy, onDelegate }: { entry: StakingAddressView; busy: boolean; onDelegate: (algo: StakingAlgo) => void }) {
  const titleId = useId()
  const algo = entry.algo as StakingAlgo
  return <article className="staking-key staking-key--unused" aria-labelledby={titleId}>
    <header className="staking-key-head"><div><h3 id={titleId}>{keyName(algo)}</h3><p className="staking-muted">Not used yet</p></div><KeyPills entry={entry} /></header>
    <p className="staking-muted">{KEY_HINT[algo]}</p>
    <button type="button" className="staking-link" disabled={busy} onClick={() => onDelegate(algo)}>Delegate with {KEY_SHORT[algo]}</button>
  </article>
}

/** Tokens, warnings and the address details that belong to one staking address. */
function AddressExtras({ entry, fmt, busy, onTokens, feedback }: Actions & { entry: StakingAddressView; fmt: StakingFormat }) {
  return <>
    {entry.error !== undefined && !entry.stale && <Alert variant="warning">{entry.error}</Alert>}
    {entry.stale && entry.error !== undefined && <p className="staking-muted">{entry.error}</p>}
    {entry.unknownAtomic !== '0' && !entry.stale && <Alert variant="warning">Availability unknown: {fmt.money(entry.unknownAtomic)}. Refresh before trying to unstake these coins.</Alert>}
    {entry.slashed && <Alert variant="warning">A slashing transaction was observed. Refund outputs can be returned by the owner after maturity.</Alert>}
    {(entry.tokens?.length ?? 0) > 0 && <div className="staking-tokens">
      {entry.tokens!.map((token) => <div className="staking-token" key={token.id}>
        <span><strong>{fmt.token(token.id, token.amountAtomic)}</strong> arrived at this staking address</span>
        <Button variant="secondary" size="sm" disabled={busy || entry.stale} onClick={() => onTokens(entry.address, token.id)}>Return tokens</Button>
      </div>)}
    </div>}
    {feedback(`address:${entry.address}`)}
    {entry.historyIncomplete === true && <p className="staking-muted">Older stake and slashing history is still being checked.</p>}
    <details className="staking-details">
      <summary>Address and details</summary>
      <div className="staking-details-body">
        {/* Label above value, so long addresses use the full width of a narrow card. */}
        <dl className="staking-detail-grid">
          <div className="staking-detail staking-detail--wide"><dt>Staking address</dt><dd className="staking-code"><CopyValue text={entry.address} /></dd></div>
          <div className="staking-detail"><dt>Confirmed</dt><dd>{entry.stale ? 'Refresh required' : fmt.money(entry.confirmedAtomic)}</dd></div>
          <div className="staking-detail"><dt>Pending</dt><dd>{entry.stale ? 'Refresh required' : fmt.money(entry.pendingAtomic)}</dd></div>
          <div className="staking-detail"><dt>Mature</dt><dd>{entry.stale ? 'Refresh required' : fmt.money(entry.matureAtomic)}<span className="staking-note-line">before freezes and reservations</span></dd></div>
          <div className="staking-detail"><dt>Last stake</dt><dd>{entry.lastStakeAt === undefined ? 'Not observed' : dateTime(entry.lastStakeAt * 1000)}</dd></div>
          <div className="staking-detail"><dt>Last reward</dt><dd>{entry.lastRewardAtomic === undefined ? entry.rewardUnknown === true ? 'Unknown: incomplete history' : 'Not observed' : fmt.money(entry.lastRewardAtomic)}</dd></div>
          <div className="staking-detail staking-detail--wide"><dt>Your owner ID</dt><dd className="staking-code"><CopyValue text={entry.ownerPubkeyhash} /></dd></div>
          <div className="staking-detail staking-detail--wide"><dt>Service ID</dt><dd className="staking-code"><CopyValue text={entry.delegatePubkeyhash} /></dd></div>
        </dl>
        <p className="staking-muted">“Updated” means the wallet read the blockchain. It doesn’t confirm that the service has started staking. Frozen coins can be managed in Coins; reserved coins wait for their operation in Activity.</p>
      </div>
    </details>
  </>
}
