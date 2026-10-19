import { Fragment, type ReactNode } from 'react'
import type { StakingAddressView, StakingChainActivity, StakingInfo, StakingOperationView } from '../../../shared/staking'
import { brand } from '../../brand'
import { shortHash } from '../../lib/format'
import { chainActivityTitle, isChainActivity, keyName, mergeStakingActivity, needsAttention, operationStatus, operationTitle, sortOperations } from '../../lib/stakingView'
import { Button, CopyValue } from '../../ui'
import { AlertIcon, ChevDownIcon, CoinsIcon, ExternalIcon, ReceiveIcon, RetryIcon, SendIcon } from '../../ui/icons'
import { Amount, dateTime, KEY_SHORT, StatusPill, type StakingFormat } from './shared'

export interface OperationActions {
  readonly busy: boolean
  readonly onRetry: (op: StakingOperationView, target: string) => void
  readonly onAutoRetry: (op: StakingOperationView, enabled: boolean, target: string) => void
  readonly onRecovery: (op: StakingOperationView, target: string) => void
  /** Opens a fresh review for a failed operation's key (and amount). */
  readonly onNewAttempt: (op: StakingOperationView) => void
  readonly feedback: (target: string) => ReactNode
}

const isActive = (op: StakingOperationView): boolean => op.state === 'prepared' || op.state === 'signed' || op.state === 'pending'
const isFailed = (op: StakingOperationView): boolean => op.state === 'conflict' || op.state === 'rejected' || op.state === 'abandoned'
const recoveryUnderway = (op: StakingOperationView, all: readonly StakingOperationView[]): boolean =>
  all.some((item) => item.recoveryOf === op.id && (isActive(item) || item.state === 'confirmed'))
/** The node only rebuilds an unresolved native transfer, and only one recovery at a time. */
const canRecover = (op: StakingOperationView, all: readonly StakingOperationView[]): boolean =>
  (op.state === 'signed' || op.state === 'pending') && op.tokenId === undefined && op.recoveryOf === undefined && !recoveryUnderway(op, all)
const amountText = (op: StakingOperationView, fmt: StakingFormat): string =>
  op.tokenId !== undefined ? fmt.token(op.tokenId, op.tokenAmountAtomic ?? '0') : fmt.money(op.amountAtomic)
const PAUSED_NOTE = 'Automatic retries are paused. The signed transaction may still confirm; its inputs remain reserved.'

function newAttemptLabel(op: StakingOperationView, info: StakingInfo): string | null {
  if (op.tokenId !== undefined || op.recoveryOf !== undefined) return null
  if (op.kind === 'withdrawal') return 'Review a new unstake'
  return info.fundingEnabled ? 'Delegate again' : null
}

/** Buttons for one operation; the same set serves a row and the attention strip. */
function OperationButtons({ op, all, info, target, actions, compact = false }: {
  op: StakingOperationView; all: readonly StakingOperationView[]; info: StakingInfo; target: string; actions: OperationActions; compact?: boolean
}) {
  const buttons: ReactNode[] = []
  const attention = needsAttention(op, all)
  if (isFailed(op) && attention) {
    const label = newAttemptLabel(op, info)
    if (label !== null) buttons.push(<Button key="again" size="sm" disabled={actions.busy} onClick={() => actions.onNewAttempt(op)}>{label}</Button>)
  }
  if ((op.state === 'signed' || op.state === 'pending') && !recoveryUnderway(op, all)) {
    buttons.push(<Button key="check" variant="secondary" size="sm" disabled={actions.busy} onClick={() => actions.onRetry(op, target)}>Check again</Button>)
    buttons.push(<Button key="auto" variant="secondary" size="sm" disabled={actions.busy} onClick={() => actions.onAutoRetry(op, op.autoRetry === false, target)}>{op.autoRetry === false ? 'Resume retries' : 'Pause retries'}</Button>)
    if (canRecover(op, all)) buttons.push(<Button key="recover" variant="secondary" size="sm" disabled={actions.busy} onClick={() => actions.onRecovery(op, target)}>Review recovery transfer</Button>)
  }
  if (!compact && op.txid !== undefined && brand.explorerTxUrl !== null) {
    const url = brand.explorerTxUrl + op.txid
    buttons.push(<button key="explorer" type="button" className="staking-link" onClick={() => window.open(url, '_blank', 'noopener')}><ExternalIcon size={14} />Open in explorer</button>)
  }
  return buttons.length === 0 ? null : <div className="staking-op-actions">{buttons}</div>
}

function attentionTitle(op: StakingOperationView, fmt: StakingFormat): string {
  const subject = `${operationTitle(op)} of ${amountText(op, fmt)}`
  if (op.state === 'conflict') return `${subject} didn’t go through`
  if (op.state === 'rejected') return `${subject} was rejected`
  if (op.state === 'abandoned') return `${subject} wasn’t completed`
  return `${subject} is paused`
}

/** Operations the owner has to act on, with the action beside each. */
export function AttentionStrip({ operations, info, fmt, actions }: { operations: readonly StakingOperationView[]; info: StakingInfo; fmt: StakingFormat; actions: OperationActions }) {
  const items = sortOperations(operations).filter((op) => needsAttention(op, operations))
  if (items.length === 0) return null
  return <section className="staking-attention" aria-label="Needs your attention">
    {items.map((op) => <div className="staking-attention-item" key={op.id}>
      <span className="staking-attention-icon" aria-hidden="true"><AlertIcon size={16} /></span>
      <div className="staking-attention-text">
        <p className="staking-attention-title">{attentionTitle(op, fmt)}</p>
        <p>{op.message ?? (isFailed(op) ? 'Another transaction spent the same coins first, so nothing changed.' : PAUSED_NOTE)}</p>
        {actions.feedback(`attention:${op.id}`)}
      </div>
      <OperationButtons op={op} all={operations} info={info} target={`attention:${op.id}`} actions={actions} compact />
    </div>)}
  </section>
}

const ICON = { funding: SendIcon, withdrawal: ReceiveIcon, token: CoinsIcon, recovery: RetryIcon }

/** Observations have no retry/recovery controls: the chain cannot reconstruct
 * the original user intent or the signed bytes kept by the local journal. */
function ChainActivityRow({ entry, addresses, fmt, open, onToggle }: {
  entry: StakingChainActivity; addresses: readonly StakingAddressView[]; fmt: StakingFormat; open: boolean; onToggle: (id: string) => void
}) {
  const algo = addresses.find((a) => a.address === entry.address)?.algo
  const detailsId = `staking-op-details-${entry.id}`
  const delta = entry.balanceChangeAtomic
  const amount = delta === undefined ? 'Amount unavailable' : `${BigInt(delta) > 0n ? '+' : ''}${fmt.money(delta)}`
  const Icon = entry.kind === 'slashing' ? AlertIcon : entry.kind === 'withdrawal' ? SendIcon : ReceiveIcon
  return <li className="staking-op" data-tone="success">
    <button type="button" className="staking-op-toggle" aria-expanded={open} aria-controls={detailsId} data-op-toggle={entry.id} onClick={() => onToggle(entry.id)}>
      <span className="staking-op-icon" aria-hidden="true"><Icon size={16} /></span>
      <span className="staking-op-main">
        <span className="staking-op-title">{chainActivityTitle(entry)}</span>
        <span className="staking-op-sub">{algo === undefined ? '' : `${KEY_SHORT[algo]}, `}{entry.createdAt === undefined ? 'Time unavailable' : dateTime(entry.createdAt)}</span>
      </span>
      <span className="staking-op-amount">{entry.tokenChanges.length > 0 && delta === '0' ? 'Token movement' : amount}</span>
      <StatusPill status={{ label: 'Confirmed', tone: 'success' }} />
      <span className="staking-op-chevron" aria-hidden="true"><ChevDownIcon size={16} /></span>
    </button>
    <div id={detailsId} className="staking-op-details" hidden={!open}>
      <dl className="staking-facts">
        {algo !== undefined && <><dt>Owner key</dt><dd>{keyName(algo)}</dd></>}
        <dt>Transaction</dt><dd className="staking-code"><CopyValue text={entry.txid} display={shortHash(entry.txid)} /></dd>
        <dt>Staking address</dt><dd className="staking-code"><CopyValue text={entry.address} /></dd>
        <dt>Balance change</dt><dd>{amount}</dd>
        {entry.tokenChanges.map((token) => <Fragment key={token.id}>
          <dt>Token balance change</dt><dd>{token.amountAtomic === undefined ? `Amount unavailable (${shortHash(token.id)})` : `${BigInt(token.amountAtomic) > 0n ? '+' : ''}${fmt.token(token.id, token.amountAtomic)}`}</dd>
        </Fragment>)}
        {entry.feeAtomic !== undefined && <><dt>Transaction network fee</dt><dd>{fmt.money(entry.feeAtomic)}</dd></>}
        {entry.blockHeight !== undefined && <><dt>Block</dt><dd>{entry.blockHeight}</dd></>}
      </dl>
      <p className="staking-op-message">Found in the blockchain. Amounts show the change at this staking address, including any fee paid from it. Restaked coins are not counted as a new deposit.</p>
      {delta === undefined && <p className="staking-op-message">The node did not provide all previous outputs, so the balance change cannot be calculated.</p>}
      {brand.explorerTxUrl !== null && <div className="staking-op-actions"><button type="button" className="staking-link" onClick={() => window.open(brand.explorerTxUrl + entry.txid, '_blank', 'noopener')}><ExternalIcon size={14} />Open in explorer</button></div>}
    </div>
  </li>
}

export function StakingActivity({ operations, chainActivity, addresses, info, fmt, expanded, visible, onToggle, onMore, actions }: {
  operations: readonly StakingOperationView[]; addresses: readonly StakingAddressView[]; info: StakingInfo; fmt: StakingFormat
  chainActivity?: readonly StakingChainActivity[]
  expanded: ReadonlySet<string>; visible: number; onToggle: (id: string) => void; onMore: () => void; actions: OperationActions
}) {
  const sorted = mergeStakingActivity(operations, chainActivity)
  const incomplete = addresses.some((a) => a.historyIncomplete || a.stale)
  if (sorted.length === 0 && !incomplete) return null
  const shown = sorted.slice(0, visible)
  const owner = (op: StakingOperationView) => addresses.find((a) => a.address === op.address)?.algo
  return <section className="staking-activity" aria-labelledby="staking-activity-title">
    <h2 id="staking-activity-title" className="staking-section-title">Activity</h2>
    {incomplete && <p className="staking-muted" role="status">Blockchain history is incomplete. More transactions may appear after refreshing.</p>}
    <ul className="staking-ops">
      {shown.map((op) => {
        if (isChainActivity(op)) return <ChainActivityRow key={op.id} entry={op} addresses={addresses} fmt={fmt} open={expanded.has(op.id)} onToggle={onToggle} />
        const open = expanded.has(op.id), detailsId = `staking-op-details-${op.id}`
        const algo = owner(op)
        const Icon = ICON[op.recoveryOf !== undefined ? 'recovery' : op.tokenId !== undefined ? 'token' : op.kind]
        const status = operationStatus(op, operations)
        const paused = isActive(op) && op.autoRetry === false && !recoveryUnderway(op, operations)
        return <li key={op.id} className="staking-op" data-tone={status.tone}>
          <button type="button" className="staking-op-toggle" aria-expanded={open} aria-controls={detailsId} data-op-toggle={op.id} onClick={() => onToggle(op.id)}>
            <span className="staking-op-icon" aria-hidden="true"><Icon size={16} /></span>
            <span className="staking-op-main">
              <span className="staking-op-title">{operationTitle(op)}</span>
              <span className="staking-op-sub">{algo === undefined ? '' : `${KEY_SHORT[algo]}, `}{dateTime(op.createdAt)}</span>
            </span>
            <span className="staking-op-amount">{op.tokenId !== undefined ? amountText(op, fmt) : <Amount fmt={fmt} atomic={op.amountAtomic} />}</span>
            <StatusPill status={status} />
            <span className="staking-op-chevron" aria-hidden="true"><ChevDownIcon size={16} /></span>
          </button>
          <div id={detailsId} className="staking-op-details" hidden={!open}>
            <dl className="staking-facts">
              {algo !== undefined && <><dt>Owner key</dt><dd>{keyName(algo)}</dd></>}
              <dt>Transaction</dt><dd className="staking-code">{op.txid === undefined ? 'Not signed yet' : <CopyValue text={op.txid} display={shortHash(op.txid)} />}</dd>
              <dt>Network fee</dt><dd>{fmt.money(op.feeAtomic)}</dd>
              {op.eligibleAt !== undefined && op.eligibleAt * 1000 > Date.now() && <><dt>Earliest confirmation</dt><dd>{dateTime(op.eligibleAt * 1000)}</dd></>}
            </dl>
            {op.message !== undefined && <p className="staking-op-message">{op.message}</p>}
            {paused && <p className="staking-op-message">{PAUSED_NOTE}</p>}
            {actions.feedback(`operation:${op.id}`)}
            <OperationButtons op={op} all={operations} info={info} target={`operation:${op.id}`} actions={actions} />
          </div>
        </li>
      })}
    </ul>
    <div className="staking-ops-foot">
      <p className="staking-muted" role="status">Showing {shown.length} of {sorted.length} {incomplete ? 'loaded operations' : 'operations'}</p>
      {sorted.length > shown.length && <Button variant="ghost" size="sm" onClick={onMore}>Show more</Button>}
    </div>
  </section>
}
