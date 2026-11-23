import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Command, ProbeBridge, ProbeState } from '../../shared/touchIdProbe'
import './style.css'

declare global { interface Window { touchIdProbe: ProbeBridge } }
const bridge = window.touchIdProbe
const availability = { available: 'Available', notEnrolled: 'No fingerprints enrolled', lockout: 'Locked by macOS', unavailable: 'Unavailable' }
function Screen() {
  const [state, setState] = useState<ProbeState | null>(null)
  const [error, setError] = useState('')
  const fallback = useRef<HTMLButtonElement>(null)
  const accept = (next: ProbeState) => setState(old => old && old.revision > next.revision ? old : next)
  function run(cmd: Command | 'showLog') {
    setError('')
    void bridge.run(cmd).then(accept).catch(err => setError(err instanceof Error ? err.message : 'Request failed.'))
  }
  useEffect(() => {
    const off = bridge.subscribe(accept)
    void bridge.run('status').then(accept).catch(err => setError(String(err)))
    return off
  }, [])
  useEffect(() => { if (state?.passwordScreen) fallback.current?.focus() }, [state?.passwordScreen])
  const busy = !state || state.busy
  const active = state?.binding === 'active'
  const button = (label: string, cmd: Command, disabled = busy, primary = false) =>
    <button className={primary ? 'primary' : undefined} disabled={disabled} onClick={() => run(cmd)}>{label}</button>
  return <main>
    <header><h1>Touch ID prototype</h1><p>Test a local Keychain item and approve a sample transfer.</p></header>
    {state && <>
      <section><h2>Test key</h2>
        <dl><dt>Touch ID</dt><dd>{availability[state.availability]}</dd><dt>Keychain item</dt><dd>{state.binding}</dd></dl>
        <div className="actions">{state.binding === 'absent' ? <>
          {button(state.deferred ? 'Enable in test settings' : 'Enable Touch ID', 'enroll', busy || state.availability !== 'available', true)}
          {!state.deferred && button('Later', 'later')}
        </> : <>{button('Try reading without a prompt', 'silent', busy || !active)}{button('Remove test key', 'reset')}</>}</div>
      </section>
      <section><h2>Test session · {state.unlocked ? 'unlocked' : 'locked'}</h2>
        {state.unlocked ? button('Lock session', 'lock', false) : state.passwordScreen ? <>
          <p>Password fallback. No wallet password is collected here.</p>
          <button ref={fallback} onClick={() => run('back')}>Back to unlock</button>
        </> : <div className="actions">{button('Unlock with Touch ID', 'unlock', busy || !active || state.availability !== 'available', true)}
          {button('Use password', 'password', busy, state.availability !== 'available')}</div>}
      </section>
      <section><h2>Sample transfer</h2>{state.draft && <p><strong>{state.draft.amount} test units</strong> to {state.draft.recipient} · draft {state.draft.id}</p>}
        <div className="actions">{button(state.draft ? 'Change draft' : 'Prepare transfer', 'prepare', busy || !state.unlocked)}
          {state.draft && <>{button('Approve with Touch ID', { action: 'approve', draftId: state.draft.id }, busy, true)}
            {button('Replace draft during prompt', { action: 'replaceDuringApproval', draftId: state.draft.id })}</>}</div>
        <p>Confirmed this run: {state.approvals}</p>
      </section>
    </>}
    <footer><p role="status" aria-live="polite">{error || state?.message || 'Loading…'}</p>
      <div className="actions">{state?.busy && button('Cancel request', 'cancel', false)}
        <button onClick={() => run('showLog')}>Show test log in Finder</button></div></footer>
  </main>
}
createRoot(document.getElementById('root')!).render(<Screen />)
