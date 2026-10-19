import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { StakingAlgo, StakingInfo, StakingOperationView, StakingPreview, StakingResult, StakingSnapshot } from '../../shared/staking'
import { AttentionStrip, StakingActivity, type OperationActions } from '../components/staking/StakingActivity'
import { StakingDialog, type AmountForm, type DelegateForm, type DialogMode, type DialogStep } from '../components/staking/StakingDialog'
import { StakingHelpDialog, StakingKeys, StakingSummary, SummaryPlaceholder } from '../components/staking/StakingOverview'
import { OPERATION_FEEDBACK, type StakingFormat } from '../components/staking/shared'
import { formatNative, formatToken, tokenLabels, shortHash } from '../lib/format'
import { mergeStakingActivity } from '../lib/stakingView'
import { wallet } from '../lib/wallet'
import { refreshAll, useAssetLabel, useSummary, useTokens } from '../lib/walletData'
import { Alert, Screen } from '../ui'
import './Staking.css'

const errorText = (error: unknown): string => error instanceof Error ? error.message : 'Could not complete the operation.'
const emptyForm: AmountForm = { amount: '', max: false }
const OPERATION_PAGE_SIZE = 5

export function Staking({ refreshKey = 0, helpKey = 0 }: { refreshKey?: number; helpKey?: number }) {
  const asset = useAssetLabel()
  const { data: tokenList } = useTokens()
  const { data: summary } = useSummary()
  const fmt = useMemo<StakingFormat>(() => ({
    asset,
    number: (atomic) => formatNative(atomic.toString()),
    money: (atomic) => `${formatNative(atomic.toString())} ${asset}`,
    token: (id, atomic) => {
      const token = tokenList?.find((item) => item.id === id)
      return token === undefined ? `${atomic} atomic token units (${shortHash(id)})` : `${formatToken(atomic, token.decimals)} ${tokenLabels(token).ticker}`
    },
  }), [asset, tokenList])
  const [info, setInfo] = useState<StakingInfo | null>(null)
  const [data, setData] = useState<StakingSnapshot | null>(null)
  const [loadErrors, setLoadErrors] = useState<Record<string, string | undefined>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ target: string; text: string } | null>(null)
  const [dialog, setDialog] = useState<DialogMode | null>(null)
  const [step, setStep] = useState<DialogStep>('form')
  const [preview, setPreview] = useState<StakingPreview | null>(null)
  const [result, setResult] = useState<StakingResult | null>(null)
  // Unsent input stays while this page is open: one delegation form and one
  // unstake form per staking address, including after Back or Close.
  const [delegateForm, setDelegateForm] = useState<DelegateForm>({ algo: 'ecdsa', ...emptyForm })
  const [unstakeForms, setUnstakeForms] = useState<Record<string, AmountForm>>({})
  const [lastUnstake, setLastUnstake] = useState<string | null>(null)
  const [rowResult, setRowResult] = useState<{ target: string; result: StakingResult } | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [visible, setVisible] = useState(OPERATION_PAGE_SIZE)
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const handledHelpKey = useRef(helpKey)
  const alive = useRef(true)
  const action = useRef(false)
  // The open dialog as of the last render, for checks after an await.
  const openDialog = useRef<DialogMode | null>(null)
  openDialog.current = dialog

  useEffect(() => {
    alive.current = true
    void wallet.stakingInfo().then((next) => {
      if (!alive.current) return
      setInfo(next); setLoadErrors((errors) => ({ ...errors, info: undefined }))
      setDelegateForm((form) => next.algorithms.includes(form.algo) ? form : { ...form, algo: next.algorithms[0] ?? 'ecdsa' })
    }).catch((e) => { if (alive.current) setLoadErrors((errors) => ({ ...errors, info: errorText(e) })) })
    // Polling the view never submits an operation. The main-process manager
    // alone reconciles already approved transactions in the background.
    const read = (): void => {
      void wallet.stakingList().then((next) => { if (alive.current) { setData(next); setLoadErrors((errors) => ({ ...errors, list: undefined })) } })
        .catch((e) => { if (alive.current) setLoadErrors((errors) => ({ ...errors, list: errorText(e) })) })
    }
    read()
    const timer = setInterval(() => { if (!document.hidden) read() }, 10_000)
    return () => { alive.current = false; clearInterval(timer) }
  }, [])

  useEffect(() => {
    let current = true
    void wallet.stakingInfo().then((next) => { if (current) { setInfo(next); setLoadErrors((errors) => ({ ...errors, info: undefined })) } })
      .catch((e) => { if (current) setLoadErrors((errors) => ({ ...errors, info: errorText(e) })) })
    void wallet.stakingRefresh().then((next) => { if (current) { setData(next); setLoadErrors((errors) => ({ ...errors, refresh: undefined, list: undefined })) } })
      .catch((e) => { if (current) setLoadErrors((errors) => ({ ...errors, refresh: errorText(e) })) })
    return () => { current = false }
  }, [refreshKey])

  // Only a new header click opens help. The shell retains its counter across
  // page and wallet changes, so its value on mount is already handled.
  useEffect(() => {
    if (helpKey === handledHelpKey.current) return
    handledHelpKey.current = helpKey
    setHelpOpen(true)
  }, [helpKey])

  // Focus a row once its dialog has closed (the dialog restores focus first) or
  // once Show more has rendered it; keep it in view without jumping.
  useEffect(() => {
    if (focusRequest === null || dialog !== null) return
    const toggle = document.querySelector<HTMLElement>(`[data-op-toggle="${CSS.escape(focusRequest.id)}"]`)
    toggle?.focus({ preventScroll: true })
    toggle?.scrollIntoView({ block: 'nearest' })
    setFocusRequest(null)
  }, [focusRequest, dialog])

  const addresses = data?.addresses ?? []
  const operations = data?.operations ?? []
  const feedback = (target: string): ReactNode => {
    if (error?.target === target) return <div className="staking-feedback"><Alert variant="error">{error.text}</Alert></div>
    if (rowResult?.target === target) {
      const state = operations.find((op) => op.id === rowResult.result.operationId)?.state ?? rowResult.result.state
      return <div className="staking-feedback"><Alert variant={OPERATION_FEEDBACK[state].variant}>{OPERATION_FEEDBACK[state].text}</Alert></div>
    }
    return null
  }

  async function perform(target: string, work: () => Promise<void>): Promise<boolean> {
    if (action.current) return false
    action.current = true
    setBusy(true); setError(null); setRowResult(null)
    let ok = false
    try { await work(); ok = true } catch (e) { if (alive.current) setError({ target, text: errorText(e) }) }
    finally { action.current = false; if (alive.current) setBusy(false) }
    return ok
  }
  /** Re-reads the staking addresses from the node; listing alone returns the last read. */
  async function refreshBalances(): Promise<void> {
    try {
      const next = await wallet.stakingRefresh()
      if (alive.current) { setData(next); setLoadErrors((errors) => ({ ...errors, refresh: undefined, list: undefined })) }
    } catch (e) { if (alive.current) setLoadErrors((errors) => ({ ...errors, refresh: errorText(e) })) }
  }
  async function reload(): Promise<void> {
    try {
      const next = await wallet.stakingList()
      if (alive.current) { setData(next); setLoadErrors((errors) => ({ ...errors, list: undefined })) }
    } catch (e) { if (alive.current) setLoadErrors((errors) => ({ ...errors, list: errorText(e) })) }
  }

  function open(mode: DialogMode, nextStep: DialogStep = 'form', nextPreview: StakingPreview | null = null): void {
    setError(null); setRowResult(null); setResult(null)
    setPreview(nextPreview); setStep(nextStep); setDialog(mode)
  }
  function close(): void {
    if (action.current) return
    setDialog(null); setPreview(null); setResult(null); setStep('form'); setError(null)
  }
  const eligible = addresses.filter((a) => !a.stale && BigInt(a.availableAtomic ?? a.matureAtomic) > 0n)
  function openDelegate(algo?: StakingAlgo, amountAtomic?: string): void {
    if (algo !== undefined || amountAtomic !== undefined) setDelegateForm((form) => ({
      algo: algo ?? form.algo,
      ...(amountAtomic !== undefined ? { amount: formatNative(amountAtomic), max: false } : { amount: form.amount, max: algo === undefined ? form.max : false }),
    }))
    open({ kind: 'delegate' })
  }
  function openUnstake(address?: string, amountAtomic?: string): void {
    const target = address ?? (eligible.some((a) => a.address === lastUnstake) ? lastUnstake : eligible[0]?.address)
    if (target === undefined || target === null) return
    if (amountAtomic !== undefined) setUnstakeForms((forms) => (forms[target]?.amount ?? '') === '' ? { ...forms, [target]: { amount: formatNative(amountAtomic), max: false } } : forms)
    setLastUnstake(target)
    open({ kind: 'unstake', address: target, choose: address === undefined })
  }
  function chooseUnstake(address: string): void {
    if (action.current || dialog?.kind !== 'unstake') return
    setError(null); setLastUnstake(address); setDialog({ ...dialog, address })
  }

  async function maximum(): Promise<boolean> {
    let filled = false
    if (dialog?.kind === 'delegate') {
      const algo = delegateForm.algo
      await perform('dialog', async () => {
        const next = await wallet.stakingBuildFunding({ algo, amountAtomic: '0', max: true })
        if (alive.current) { setDelegateForm((form) => ({ ...form, amount: formatNative(next.amountAtomic), max: true })); filled = true }
      })
    } else if (dialog?.kind === 'unstake') {
      const address = dialog.address
      await perform('dialog', async () => {
        const next = await wallet.stakingBuildWithdrawal({ address, amountAtomic: '0', max: true })
        if (alive.current) { setUnstakeForms((forms) => ({ ...forms, [address]: { amount: formatNative(next.amountAtomic), max: true } })); filled = true }
      })
    }
    return filled
  }
  function review(atomic: bigint, max: boolean): void {
    if (dialog?.kind === 'delegate') {
      const algo = delegateForm.algo
      void perform('dialog', async () => {
        const next = await wallet.stakingBuildFunding({ algo, amountAtomic: max ? '0' : atomic.toString(), max })
        if (alive.current) { setPreview(next); setStep('review') }
      })
    } else if (dialog?.kind === 'unstake') {
      const address = dialog.address
      void perform('dialog', async () => {
        const next = await wallet.stakingBuildWithdrawal({ address, amountAtomic: atomic.toString(), max })
        // Never show a review for a key the dialog no longer targets.
        const current = openDialog.current
        if (alive.current && current?.kind === 'unstake' && current.address === address) { setPreview(next); setStep('review') }
      })
    }
  }
  function confirm(): void {
    if (preview === null) return
    const draft = preview
    void perform('dialog', async () => {
      const next = await wallet.stakingConfirm(draft.draftId)
      if (!alive.current) return
      refreshAll()
      await reload()
      if (!alive.current) return
      if (dialog?.kind === 'unstake') setUnstakeForms((forms) => { const rest = { ...forms }; delete rest[draft.address]; return rest })
      if (dialog?.kind === 'delegate') setDelegateForm((form) => ({ ...form, ...emptyForm }))
      setResult(next); setStep('result')
      // The new transfer changes the balances; show it without waiting for the background read.
      void refreshBalances()
    })
  }
  function done(): void {
    const id = result?.operationId
    close()
    if (id === undefined) return
    setExpanded((set) => new Set(set).add(id))
    setFocusRequest({ id })
  }

  const actions: OperationActions = {
    busy,
    feedback,
    onRetry: (op, target) => void perform(target, async () => {
      const next = await wallet.stakingRetry(op.id)
      await reload()
      if (alive.current) { setRowResult({ target, result: next }); refreshAll() }
    }),
    onAutoRetry: (op, enabled, target) => void perform(target, async () => {
      await wallet.stakingSetAutoRetry(op.id, enabled)
      const next = await wallet.stakingList()
      if (alive.current) setData(next)
    }),
    onRecovery: (op, target) => void perform(target, async () => {
      const next = await wallet.stakingBuildRecovery(op.id)
      if (alive.current) open({ kind: 'recovery', opId: op.id }, 'review', next)
    }),
    onNewAttempt: (op: StakingOperationView) => {
      if (op.kind === 'withdrawal') { openUnstake(op.address, op.amountAtomic); return }
      const algo = addresses.find((a) => a.address === op.address)?.algo
      openDelegate(algo === 'ecdsa' || algo === 'falcon512' ? algo : undefined, op.amountAtomic)
    },
  }
  const onTokens = (address: string, tokenId: string): void => void perform(`address:${address}`, async () => {
    const next = await wallet.stakingBuildWithdrawal({ address, amountAtomic: '0', tokenId })
    if (alive.current) open({ kind: 'tokens', address }, 'review', next)
  })
  const sorted = mergeStakingActivity(operations, data?.chainActivity)
  const toggleOperation = (id: string): void => setExpanded((set) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const showMore = (): void => {
    const first = sorted[visible]
    setVisible((count) => count + OPERATION_PAGE_SIZE)
    if (first !== undefined) setFocusRequest({ id: first.id })
  }

  return <Screen><div className="staking-page">
    {Object.entries(loadErrors).filter(([, message]) => message !== undefined).map(([source, message]) => <Alert key={source} variant="error">{message}</Alert>)}
    {info === null ? <p>Loading staking…</p> : !info.enabled ? <p>Staking requires an ECDSA or Falcon owner key.</p> : <>
      {info.notice !== undefined && <Alert variant="banner">{info.notice}</Alert>}
      {data?.error !== undefined && !addresses.some((a) => a.stale) && <Alert variant="warning">{data.error}</Alert>}
      <AttentionStrip operations={operations} info={info} fmt={fmt} actions={actions} />
      {data === null || (data.addresses.length === 0 && data.refreshedAt === undefined) ? <>
        <SummaryPlaceholder />
        {data !== null && <StakingActivity operations={operations} chainActivity={data.chainActivity} addresses={addresses} info={info} fmt={fmt} expanded={expanded} visible={visible} actions={actions}
          onToggle={toggleOperation} onMore={showMore} />}
      </> : <>
        <StakingSummary info={info} addresses={addresses} hasOperations={sorted.length > 0} refreshedAt={data.refreshedAt} fmt={fmt} busy={busy}
          onUnstake={() => openUnstake()} onDelegate={() => openDelegate()} onTokens={onTokens} feedback={feedback} />
        <StakingKeys info={info} addresses={addresses} fmt={fmt} busy={busy} onDelegate={(algo) => openDelegate(algo)} onTokens={onTokens} feedback={feedback} />
        <StakingActivity operations={operations} chainActivity={data.chainActivity} addresses={addresses} info={info} fmt={fmt} expanded={expanded} visible={visible} actions={actions}
          onToggle={toggleOperation} onMore={showMore} />
      </>}
      {helpOpen && <StakingHelpDialog info={info} fmt={fmt} onClose={() => setHelpOpen(false)} />}
      {dialog !== null && <StakingDialog mode={dialog} step={step} busy={busy} info={info} addresses={addresses} operations={operations}
        preview={preview} result={result} error={error?.target === 'dialog' ? error.text : null} fmt={fmt} ordinaryAtomic={summary?.ordinaryAtomic}
        delegateForm={delegateForm} onDelegateForm={setDelegateForm}
        unstakeForm={dialog.kind === 'unstake' ? unstakeForms[dialog.address] ?? emptyForm : emptyForm}
        onUnstakeForm={(form) => { if (dialog.kind === 'unstake') setUnstakeForms((forms) => ({ ...forms, [dialog.address]: form })) }}
        onChooseAddress={chooseUnstake} onMax={maximum} onReview={review}
        onBack={() => { setPreview(null); setError(null); setStep('form') }}
        onConfirm={confirm} onDone={done} onClose={close} />}
    </>}
  </div></Screen>
}
