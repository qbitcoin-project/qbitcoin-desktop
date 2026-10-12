import { useId, useRef, useState, type ReactNode } from 'react'
import type { HistoryItem } from '../../shared/protocol'
import { saveTxLabel } from '../lib/walletData'
import { LabelInput, PencilIcon } from '../ui'
import { TxTypeBadge } from './TxTypeBadge'

// The editable top line of an activity row: the user's transaction label when set,
// otherwise the direction ("Received"/"Sent"), with a pencil to edit it inline. The
// `sub` (txid, counterparty…) renders beneath it, and is hidden while editing — the
// input takes the whole cell, mirroring the coin-control label editor.
//
// The label is local-only (sealed in main, never on-chain). An edit updates the
// shared history cache optimistically and persists through main, reverting (via a
// cache invalidation) if the write fails. onClick/onKeyDown are stopped from
// bubbling so editing inside a clickable row doesn't also trigger the row.
export function TxLabelLine({ tx, sub }: { tx: HistoryItem; sub: ReactNode }) {
  const [editing, setEditing] = useState(false)
  const editButton = useRef<HTMLButtonElement>(null)
  const hintId = useId()
  const fallback = tx.direction === 'in' ? 'Received' : 'Sent'

  function save(value: string): void {
    setEditing(false)
    saveTxLabel(tx.txid, value)
  }

  if (editing) {
    return (
      <div>
        <LabelInput
          compact
          defaultValue={tx.label ?? ''}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onCommit={save}
          onCancel={() => { setEditing(false); requestAnimationFrame(() => editButton.current?.focus()) }}
          placeholder="Add transaction note"
          aria-label="Transaction note"
          aria-describedby={hintId}
        />
        <div id={hintId} className="field-hint">Local note · Enter to save · Esc to cancel</div>
      </div>
    )
  }
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tx.label ?? fallback}</span>
        <TxTypeBadge txType={tx.txType} />
        <button
          type="button"
          ref={editButton}
          className="coin-pencil"
          onClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
          onKeyDown={(e) => e.stopPropagation()}
          title="Edit transaction note"
          aria-label="Edit transaction note"
          style={{ flex: 'none', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', color: 'var(--ink-500)' }}
        >
          <PencilIcon size={13} />
        </button>
      </div>
      {sub}
    </>
  )
}
