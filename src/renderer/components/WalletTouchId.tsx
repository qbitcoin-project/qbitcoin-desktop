import { useEffect, useState } from 'react'
import type { TouchIdStatus } from '../../shared/walletTouchId'
import { Button, Logo, Modal, PasswordField, Screen, Subtitle, Title } from '../ui'
import { useOperation } from '../lib/useOperation'

const change = 'wallet-touch-id-changed'
export function refreshTouchId(): void { window.dispatchEvent(new Event(change)) }

export function useTouchIdStatus(): TouchIdStatus | null {
  const [state, setState] = useState<TouchIdStatus | null>(null)
  useEffect(() => {
    let revision = 0
    const refresh = () => {
      const requested = ++revision
      void window.walletTouchId?.status().then(next => {
        if (requested === revision) setState(next)
      }).catch(() => { if (requested === revision) setState(null) })
    }
    refresh()
    window.addEventListener(change, refresh)
    window.addEventListener('focus', refresh)
    return () => { revision++; window.removeEventListener(change, refresh); window.removeEventListener('focus', refresh) }
  }, [])
  return state
}

export async function hasTouchIdEntry(): Promise<boolean> {
  try { return (await window.walletTouchId?.status())?.entryReady ?? false }
  catch { return false }
}

export function TouchIdEntry({ onContinue }: { onContinue: () => void }) {
  const operation = useOperation()
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState('')
  async function finish(enable: boolean): Promise<void> {
    if (!operation.start()) return
    try {
      if (enable) await window.walletTouchId!.enableAtEntry()
      else await window.walletTouchId!.later()
      if (operation.current()) onContinue()
    } catch {
      if (operation.current()) {
        if (enable) setFailed(true)
        setError(enable ? 'Touch ID setup did not finish. You can try again in Settings → Security.' : 'Could not save your choice. Try again.')
      }
    } finally { operation.finish() }
  }
  return (
    <Screen center>
      <div style={{ maxWidth: 360, width: '100%', textAlign: 'center', display: 'grid', justifyItems: 'center', gap: 16 }}>
        <Logo size={46} />
        <Title>Set up Touch ID</Title>
        <Subtitle>Any fingerprint enrolled in your Mac account can unlock this wallet. You can also set this up later in Settings.</Subtitle>
        {error && <p role="alert">{error}</p>}
        {!failed && <Button fullWidth size="cta" disabled={operation.busy} onClick={() => void finish(true)}>
          {operation.busy ? 'Please wait…' : 'Enable Touch ID'}
        </Button>}
        <Button fullWidth variant="secondary" disabled={operation.busy} onClick={() => void finish(false)}>
          {failed ? 'Continue to wallet' : 'Later'}
        </Button>
      </div>
    </Screen>
  )
}

export function TouchIdSettings() {
  const state = useTouchIdStatus()
  const [dialog, setDialog] = useState<'enable' | 'repair' | 'disable' | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const operation = useOperation()
  const pending = operation.pending
  useEffect(() => () => { if (pending.current) void window.walletTouchId?.cancel().catch(() => {}) }, [pending])
  useEffect(() => {
    if (dialog === 'disable') return () => { void window.walletTouchId?.cancel().catch(() => {}) }
  }, [dialog])
  const api = window.walletTouchId
  if (!api || !state || (!state.enabled && state.availability !== 'available')) return null
  let hint: string | undefined
  if (state.availability === 'lockout') hint = 'Touch ID is temporarily locked. Lock your Mac, then unlock it with your Mac account password.'
  else if (state.availability === 'notEnrolled') hint = 'Add a fingerprint in System Settings → Touch ID & Password, then return here.'
  else if (state.availability === 'unavailable') hint = 'Touch ID is unavailable on this Mac. Use your wallet password for now.'
  else if (state.needsSetup) hint = 'Set up Touch ID again to unlock this wallet with your current fingerprints.'
  const canSetUp = state.availability === 'available' && (!state.enabled || state.needsSetup)
  async function act(action: 'enable' | 'repair' | 'disable') {
    if (!api || !operation.start()) return
    setError('')
    try {
      const submitted = password
      setPassword('')
      if (action !== 'disable') await api.enable(submitted)
      else {
        const result = await api.disable(dialog === 'disable' ? submitted : undefined)
        if (!operation.current()) return
        if (result === 'password-required') { setDialog('disable'); return }
        if (result === 'denied') { setDialog(null); setError('Touch ID did not verify.'); return }
      }
      if (operation.current()) setDialog(null)
    } catch (err) {
      if (operation.current()) setError(err instanceof Error ? err.message.replace(/^Error invoking remote method .*?: (?:Error: )?/, '') : 'Could not update Touch ID.')
    } finally { operation.finish(); refreshTouchId() }
  }
  function close(): void {
    if (!operation.pending.current) { setPassword(''); setError(''); setDialog(null) }
  }
  return <>
    <div style={{ padding: '12px 18px' }}>
      {hint && <p role="status" style={{ margin: '0 0 12px' }}>{hint}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {canSetUp && <Button variant="secondary" size="sm" disabled={operation.busy} onClick={() => {
          setError(''); setDialog(state.needsSetup ? 'repair' : 'enable')
        }}>{state.needsSetup ? 'Set up Touch ID again' : 'Set up Touch ID'}</Button>}
        {state.enabled && <Button variant="secondary" size="sm" disabled={operation.busy} onClick={() => void act('disable')}>Turn off Touch ID</Button>}
      </div>
      {!dialog && error && <p role="alert">{error}</p>}
    </div>
    <Modal open={dialog !== null} title={dialog === 'disable' ? 'Turn off Touch ID' : dialog === 'repair' ? 'Set up Touch ID again' : 'Unlock with Touch ID'} onClose={close} width={420}
      footer={<>
        <Button variant="secondary" disabled={operation.busy} onClick={close}>Cancel</Button>
        <Button disabled={operation.busy || !password} onClick={() => { if (dialog) void act(dialog) }}>
          {operation.busy ? 'Please wait…' : dialog === 'disable' ? 'Turn off Touch ID' : 'Enable Touch ID'}
        </Button>
      </>}>
      <p>{dialog === 'disable' ? 'Touch ID is unavailable. Enter your wallet password to turn it off.' :
        'Any fingerprint currently enrolled in your Mac account can unlock this wallet. Confirm your wallet password to enable Touch ID.'}</p>
      <PasswordField autoFocus autoComplete="current-password" label="Wallet password" value={password} disabled={operation.busy}
        onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && password && dialog) void act(dialog) }} />
      {error && <p role="alert">{error}</p>}
    </Modal>
  </>
}
