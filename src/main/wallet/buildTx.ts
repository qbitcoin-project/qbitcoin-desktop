import { encodeTokenTransfer, fromHex, toHex, type TxOutput } from '@qbtc/crypto'
import { decodeAddress } from '../brand/crypto'
import type { Algo } from './discovery'
import { feeForBytes, transactionSizeUpperBound } from './txSize'

// Pure, key-free transaction assembly with a change-avoiding selection (Branch and
// Bound) and dust folding.
// No private keys here; signing happens in the SendService.
//
// Txids are used verbatim (wire order); the canonical input sort is by txid-hex
// then vout, applied BEFORE signing so the sighash, the per-input signatures and
// the serialized tx all share one order.

// Re-exported so consumers of SpendableUtxo/UnsignedInput can name the type of
// their `algo` fields without reaching into discovery.ts.
export type { Algo }

/**
 * An HD change branch: classical (ECDSA) or post-quantum (Falcon-512).
 *
 * Deliberately NARROWER than {@link Algo}: change is a DERIVED address, and
 * the wallet has exactly two derivation branches (m/44' classical, m/512'
 * PQ). Schnorr has no HD branch — it exists only on imported single keys,
 * whose "change address" is their own fixed address (which decodeAddress
 * classifies as the classical branch, so advancing is a no-op there).
 */
export type ChangeBranch = 'ecdsa' | 'falcon512'

export interface SpendableUtxo {
  /** Imported delegated keys can also receive a return on their ordinary address. */
  readonly keyScript?: 'ordinary' | 'delegated'
  /** Main-process estimate for an input with a non-standard redeem script. */
  readonly inputBytes?: number
  readonly txid: string
  readonly vout: number
  readonly value: bigint
  readonly chain: 0 | 1
  readonly index: number
  readonly algo: Algo
  /** Derivation scheme id of the owning address's branch. The signer derives
   *  the key on THIS scheme's path (legacy-scheme UTXOs stay spendable after a
   *  coin_type migration). Absent on non-HD inputs (imported keys) — and then
   *  the signer falls back to the active scheme. */
  readonly scheme?: string
}

/** A token UTXO: a spendable input that also carries a token quantity. Its native
 *  `value` is 0; `tokenAmount` is the atomic token quantity it holds. */
export interface SpendableTokenUtxo extends SpendableUtxo {
  readonly tokenAmount: bigint
}

export interface UnsignedInput {
  readonly keyScript?: 'ordinary' | 'delegated'
  readonly prevTxid: string
  readonly vout: number
  readonly valueAtomic: string
  readonly account: number
  readonly chain: 0 | 1
  readonly index: number
  readonly algo: Algo
  /** See {@link SpendableUtxo.scheme} — carried through so signing derives on
   *  the input's own scheme. */
  readonly scheme?: string
}

export interface UnsignedOutput {
  readonly valueAtomic: string
  readonly scripthash: string
  /** Token TRANSFER payload (hex) for a token output: `01 || uint64LE(amount)`.
   *  Absent on native outputs. The output's `valueAtomic` is "0" when set. */
  readonly data?: string
}

export interface UnsignedTx {
  readonly inputs: readonly UnsignedInput[]
  readonly outputs: readonly UnsignedOutput[]
  /** Set for a token transfer: the 32-byte token id (hex). Its presence switches
   *  the transaction to TX_TYPE_TOKENS; absent means a native (standard) send. */
  readonly tokenHash?: string
}

export interface BuiltSend {
  readonly unsigned: UnsignedTx
  readonly amountAtomic: bigint
  /** The fee actually paid (includes any dust change folded in). */
  readonly feeAtomic: bigint
  readonly changeAtomic: bigint
  readonly totalAtomic: bigint
  /** Branch the change output lives on (undefined when there is no change). */
  readonly changeAlgo?: ChangeBranch
}

export class InsufficientFundsError extends Error {
  override readonly name = 'InsufficientFundsError'
  constructor(
    readonly neededAtomic: bigint,
    readonly availableAtomic: bigint,
  ) {
    super('Not enough balance to cover this amount plus the network fee.')
  }
}

export class InsufficientTokensError extends Error {
  override readonly name = 'InsufficientTokensError'
  constructor(
    readonly neededAtomic: bigint,
    readonly availableAtomic: bigint,
  ) {
    super('Not enough of this token to cover the amount.')
  }
}

// Wallet-side dust threshold: a change output worth at or below this is folded
// into the fee instead of created (it would cost more to spend than it holds).
// The node defines no explicit dust limit, so this is our policy — flagged as an
// open question for the node team.
export const DUST_ATOMIC = 1000n

function descendingByValue(utxos: readonly SpendableUtxo[]): SpendableUtxo[] {
  return [...utxos].sort((a, b) => (a.value < b.value ? 1 : a.value > b.value ? -1 : 0))
}

// Largest-first accumulation until `target` is covered. Guaranteed to succeed
// when the pool totals at least `target`; returns null otherwise.
function accumulate(utxos: readonly SpendableUtxo[], target: bigint): SpendableUtxo[] | null {
  const sorted = descendingByValue(utxos)
  const selected: SpendableUtxo[] = []
  let sum = 0n
  for (const utxo of sorted) {
    selected.push(utxo)
    sum += utxo.value
    if (sum >= target) return selected
  }
  return null
}

// Branch and Bound: find a subset whose sum lands in [target, target + margin],
// i.e. a (near-)exact match that needs no change output. Depth-first over the
// UTXOs sorted descending, with suffix-sum pruning and a hard try cap. Returns
// the first such subset, or null if none exists.
function branchAndBound(utxos: readonly SpendableUtxo[], target: bigint, margin: bigint): SpendableUtxo[] | null {
  const sorted = descendingByValue(utxos)
  const n = sorted.length
  const suffix = new Array<bigint>(n + 1)
  suffix[n] = 0n
  for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1]! + sorted[i]!.value

  const upper = target + margin
  const picked: SpendableUtxo[] = []
  let result: SpendableUtxo[] | null = null
  let bestSum = upper + 1n
  let tries = 0
  const MAX_TRIES = 100_000

  // Keep the tightest match (smallest overshoot) found within the window, so the
  // amount folded into the fee is minimised rather than just "first found".
  function dfs(i: number, sum: bigint): void {
    if (tries++ > MAX_TRIES) return
    if (sum > upper) return // overshoot beyond the window — prune
    if (sum >= target) {
      if (sum < bestSum) {
        bestSum = sum
        result = [...picked]
      }
      return // adding more only grows the sum — this branch is done
    }
    if (i >= n || sum + suffix[i]! < target) return // can't reach the target — prune
    picked.push(sorted[i]!)
    dfs(i + 1, sum + sorted[i]!.value)
    picked.pop()
    dfs(i + 1, sum)
  }

  dfs(0, 0n)
  return result
}

/**
 * Select inputs to cover `target` (= amount + fee). Prefers a changeless set
 * (Branch and Bound within `dust`); otherwise falls back to largest-first.
 * Returns null when the pool can't cover the target.
 */
export function selectCoins(utxos: readonly SpendableUtxo[], target: bigint, dust: bigint = DUST_ATOMIC): SpendableUtxo[] | null {
  let total = 0n
  for (const utxo of utxos) total += utxo.value
  if (total < target) return null
  return branchAndBound(utxos, target, dust) ?? accumulate(utxos, target)
}

/** Largest-first token-UTXO selection to cover `target` token units. Returns the
 *  chosen UTXOs, or null when the holdings can't cover the amount. */
export function selectByToken(utxos: readonly SpendableTokenUtxo[], target: bigint): SpendableTokenUtxo[] | null {
  let total = 0n
  for (const u of utxos) total += u.tokenAmount
  if (total < target) return null
  const sorted = [...utxos].sort((a, b) => (a.tokenAmount < b.tokenAmount ? 1 : a.tokenAmount > b.tokenAmount ? -1 : 0))
  const selected: SpendableTokenUtxo[] = []
  let sum = 0n
  for (const u of sorted) {
    selected.push(u)
    sum += u.tokenAmount
    if (sum >= target) return selected
  }
  return null
}

/** Concrete output shapes when known; a count means native outputs with the
 * largest supported hash (e.g. Max, before a recipient has been entered). */
export function feeForInputs(inputs: readonly SpendableUtxo[], rate: number, outputs: number | readonly TxOutput[] = 2, token = false): bigint {
  const shaped = typeof outputs === 'number'
    ? Array.from({ length: outputs }, () => ({ value: 0n, scripthash: new Uint8Array(32) })) : outputs
  return feeForBytes(transactionSizeUpperBound(inputs, shaped, token), rate)
}

/** Price the actual draft, retaining each selected input's custom witness size. */
export function draftSizeUpperBound(pool: readonly SpendableUtxo[], unsigned: UnsignedTx): number {
  const byOutpoint = new Map(pool.map((u) => [`${u.txid}:${u.vout}`, u]))
  const inputs = unsigned.inputs.map((i) => {
    const input = byOutpoint.get(`${i.prevTxid}:${i.vout}`)
    if (input === undefined) throw new Error('Missing input size for transaction fee.')
    return input
  })
  return transactionSizeUpperBound(inputs, unsigned.outputs.map((o) => ({ value: BigInt(o.valueAtomic),
    scripthash: fromHex(o.scripthash), ...(o.data !== undefined ? { data: fromHex(o.data) } : {}),
  })), unsigned.tokenHash !== undefined)
}

export function feeForDraft(pool: readonly SpendableUtxo[], unsigned: UnsignedTx, rate: number): bigint {
  return feeForBytes(draftSizeUpperBound(pool, unsigned), rate)
}

// The node's canonical input order: txid hex ascending, then vout.
function compareInputs(a: UnsignedInput, b: UnsignedInput): number {
  if (a.prevTxid < b.prevTxid) return -1
  if (a.prevTxid > b.prevTxid) return 1
  return a.vout - b.vout
}

// Map selected UTXOs to unsigned inputs in the node's canonical order. The sort
// must happen before signing so the sighash, signatures and serialized tx agree.
function toUnsignedInputs(selected: readonly SpendableUtxo[]): UnsignedInput[] {
  const inputs: UnsignedInput[] = selected.map((u) => ({
    prevTxid: u.txid,
    vout: u.vout,
    valueAtomic: u.value.toString(),
    account: 0,
    chain: u.chain,
    index: u.index,
    algo: u.algo,
    ...(u.scheme !== undefined ? { scheme: u.scheme } : {}),
    ...(u.keyScript !== undefined ? { keyScript: u.keyScript } : {}),
  }))
  inputs.sort(compareInputs)
  return inputs
}

export interface BuildSendParams {
  /** Candidate pool for automatic selection (ignored when `manualInputs` is set). */
  readonly utxos: readonly SpendableUtxo[]
  /** If non-empty, spend exactly these inputs (manual coin control) — no auto-select. */
  readonly manualInputs?: readonly SpendableUtxo[]
  readonly recipient: string
  readonly amountAtomic: bigint
  readonly feeAtomic: bigint
  /** Fixed change address (used only when `changeAddressFor` is absent). */
  readonly changeAddress?: string
  /** Resolve the change address for the inputs' majority branch (preferred):
   *  a PQ-majority send returns change to a Falcon address, else to a classical one. */
  readonly changeAddressFor?: (algo: ChangeBranch) => string
  /** Send-max: spend every input in the pool to one output and create no change.
   *  `amountAtomic` is ignored — the amount sent is the selected total minus the fee. */
  readonly sendMax?: boolean
  /** Override change dust policy for covenant returns that must preserve the remainder. */
  readonly dustAtomic?: bigint
}

export function buildSend(params: BuildSendParams): BuiltSend {
  const { utxos, manualInputs, recipient, amountAtomic, feeAtomic, changeAddress, changeAddressFor, sendMax = false, dustAtomic = DUST_ATOMIC } = params
  if (feeAtomic < 0n) throw new Error('Fee cannot be negative.')

  const recipientScripthash = toHex(decodeAddress(recipient).scripthash)

  // Send-max: spend the whole pool (or the manually chosen set) into a single
  // output with no change; the amount sent is the selected total minus the fee.
  if (sendMax) {
    const selected = manualInputs !== undefined && manualInputs.length > 0 ? [...manualInputs] : [...utxos]
    const selectedSum = selected.reduce((sum, u) => sum + u.value, 0n)
    const amount = selectedSum - feeAtomic
    if (amount <= 0n) throw new InsufficientFundsError(feeAtomic, selectedSum)
    return {
      unsigned: { inputs: toUnsignedInputs(selected), outputs: [{ valueAtomic: amount.toString(), scripthash: recipientScripthash }] },
      amountAtomic: amount,
      feeAtomic,
      changeAtomic: 0n,
      totalAtomic: amount + feeAtomic,
      changeAlgo: undefined,
    }
  }

  if (amountAtomic <= 0n) throw new Error('Amount must be greater than zero.')
  const target = amountAtomic + feeAtomic

  const selected = manualInputs !== undefined && manualInputs.length > 0 ? [...manualInputs] : selectCoins(utxos, target, dustAtomic)
  if (selected === null) {
    throw new InsufficientFundsError(target, utxos.reduce((sum, u) => sum + u.value, 0n))
  }
  const selectedSum = selected.reduce((sum, u) => sum + u.value, 0n)
  if (selectedSum < target) {
    throw new InsufficientFundsError(target, selectedSum)
  }

  // Dust folding: a leftover at or below the dust threshold isn't worth its own
  // output (it would cost more to spend than it holds), so it goes to the fee.
  const rawChange = selectedSum - amountAtomic - feeAtomic
  const folded = rawChange > 0n && rawChange <= dustAtomic
  const changeAtomic = folded ? 0n : rawChange
  const feePaid = folded ? feeAtomic + rawChange : feeAtomic

  const outputs: UnsignedOutput[] = [{ valueAtomic: amountAtomic.toString(), scripthash: recipientScripthash }]
  let changeAlgo: ChangeBranch | undefined
  if (changeAtomic > 0n) {
    // Change returns on the branch of the inputs' majority algorithm (Sparrow-style),
    // so a PQ-funded send keeps its change post-quantum instead of leaking to classical.
    const addr = changeAddressFor !== undefined ? changeAddressFor(majorityAlgo(selected)) : changeAddress
    if (addr === undefined) throw new Error('buildSend: no change address provided')
    const decoded = decodeAddress(addr)
    outputs.push({ valueAtomic: changeAtomic.toString(), scripthash: toHex(decoded.scripthash) })
    changeAlgo = decoded.type === 'pq' ? 'falcon512' : 'ecdsa'
  }

  const inputs = toUnsignedInputs(selected)

  return { unsigned: { inputs, outputs }, amountAtomic, feeAtomic: feePaid, changeAtomic, totalAtomic: amountAtomic + feePaid, changeAlgo }
}

// Strict majority of inputs PQ → PQ change; ties and classical-majority →
// classical (Schnorr inputs count as classical — they have no branch of their own).
function majorityAlgo(inputs: readonly SpendableUtxo[]): ChangeBranch {
  let pq = 0
  for (const u of inputs) if (u.algo === 'falcon512') pq += 1
  return pq * 2 > inputs.length ? 'falcon512' : 'ecdsa'
}

// Bound pathological selection work; never return an unchecked fee at the cap.
const FEE_ITERATIONS = 64

/**
 * Estimate the network fee for a send, sized to the ACTUAL inputs the transaction
 * will use and to whether it produces change. This is the single source of truth
 * the SendService feeds into {@link buildSend}, so the fee shown in a preview, the
 * fee of the built draft, and the fee that gets signed all agree — and the
 * automatic and manual-coin-control paths estimate identically.
 *
 * Modes:
 *  - `sendMax`: spends the given inputs to one output, no change → fee for a
 *    single-output shape.
 *  - manual (`manualInputs`): the input set is fixed; pick the change/changeless
 *    shape and price accordingly. Throws {@link InsufficientFundsError} if the
 *    set can't even fund a changeless send.
 *  - automatic: fixpoint — grow the selection until the fee it implies stops
 *    changing (fee ↑ pulls in more inputs, which raises the fee, …). Throws
 *    {@link InsufficientFundsError} when the pool can't cover amount + that fee.
 *
 * Fees round up and reserve maximum signature sizes; variable signatures and
 * dust folding can leave a small surplus over the requested rate.
 */
export function estimateSendFee(params: {
  readonly utxos: readonly SpendableUtxo[]
  readonly manualInputs?: readonly SpendableUtxo[]
  readonly amountAtomic: bigint
  readonly feeRatePerVByte: number
  readonly sendMax?: boolean
  readonly recipient?: string
  readonly changeAddressFor?: (algo: ChangeBranch) => string
  /** Extra recipient data, for covenant funding. */
  readonly recipientData?: Uint8Array
}): bigint {
  const { utxos, manualInputs, amountAtomic, feeRatePerVByte: rate, sendMax = false } = params
  const outputsFor = (inputs: readonly SpendableUtxo[], count: number): readonly TxOutput[] => {
    const changeAddress = params.changeAddressFor?.(majorityAlgo(inputs))
    return Array.from({ length: count }, (_, i) => {
      // Max is recipient-independent; keep its preview and build identical.
      const address = i === 0 ? (sendMax ? undefined : params.recipient) : changeAddress
      return { value: 0n, scripthash: address === undefined ? new Uint8Array(32) : decodeAddress(address).scripthash,
        ...(i === 0 && params.recipientData !== undefined ? { data: params.recipientData } : {}),
      }
    })
  }
  const price = (inputs: readonly SpendableUtxo[], count: number): bigint => feeForInputs(inputs, rate, outputsFor(inputs, count))

  if (sendMax) {
    const inputs = manualInputs !== undefined && manualInputs.length > 0 ? manualInputs : utxos
    return price(inputs, 1) // one output, no change
  }

  if (manualInputs !== undefined && manualInputs.length > 0) {
    return feeForFixedInputs(manualInputs, amountAtomic, price)
  }

  // Automatic selection: iterate to a stable (selection, fee) pair. The fee of
  // an intermediate selection must NOT be treated as a shortfall — the first
  // pass selects against the bare amount (fee still 0), so a selection that
  // lands exactly on the amount is expected; the loop prices it and re-selects
  // against amount + that fee, pulling in another coin. Only the pool as a
  // whole failing to cover amount + fee is insufficient funds.
  let fee = 0n
  for (let i = 0; i < FEE_ITERATIONS; i += 1) {
    const selected = selectCoins(utxos, amountAtomic + fee)
    if (selected === null) {
      throw new InsufficientFundsError(amountAtomic + fee, utxos.reduce((sum, u) => sum + u.value, 0n))
    }
    const nextFee = feeShapeForInputs(selected, amountAtomic, price)
    if (nextFee <= fee) return fee
    fee = nextFee
  }
  throw new Error('Could not settle the network fee. Select fewer coins and try again.')
}

// Fee for a KNOWN input set, choosing the change/changeless shape. A leftover
// above the dust threshold gets its own output (2-output fee); otherwise the
// send is changeless (1-output fee) and buildSend folds the tiny remainder into
// the fee. Throws when the inputs can't even cover a changeless send — for a
// FIXED set (manual coin control) that is a real shortfall.
type InputPrice = (inputs: readonly SpendableUtxo[], count: number) => bigint
function feeForFixedInputs(inputs: readonly SpendableUtxo[], amountAtomic: bigint, price: InputPrice): bigint {
  const sum = inputs.reduce((total, u) => total + u.value, 0n)
  const feeChangeless = price(inputs, 1)
  if (sum < amountAtomic + feeChangeless) {
    throw new InsufficientFundsError(amountAtomic + feeChangeless, sum)
  }
  return feeShapeForInputs(inputs, amountAtomic, price)
}

// The same change/changeless pricing without the sufficiency verdict: used by
// the automatic fixpoint, where a selection too small to pay its own fee is a
// step in the iteration, not an error.
function feeShapeForInputs(inputs: readonly SpendableUtxo[], amountAtomic: bigint, price: InputPrice): bigint {
  const sum = inputs.reduce((total, u) => total + u.value, 0n)
  const feeChangeless = price(inputs, 1)
  // A negative "change" means this selection cannot fund the send at all; price
  // it changeless so the caller grows the selection on the next pass.
  const change = sum - amountAtomic - feeChangeless
  return change > DUST_ATOMIC ? price(inputs, 2) : feeChangeless
}

/** Build, price the complete token draft, and reselect until its fee covers its
 * own input set. Adding native fee inputs can require still more inputs. */
export function buildTokenSendWithFee(params: Omit<BuildTokenSendParams, 'feeAtomic'>, rate: number): BuiltTokenSend {
  let feeAtomic = 1n
  const pool = [...params.tokenUtxos, ...params.nativeUtxos]
  for (let pass = 0; pass < FEE_ITERATIONS; pass++) {
    const built = buildTokenSend({ ...params, feeAtomic })
    const required = feeForDraft(pool, built.unsigned, rate)
    if (built.feeAtomic >= required) return built
    feeAtomic = required
  }
  throw new Error('Could not settle the network fee. Select fewer coins and try again.')
}

export interface BuildTokenSendParams {
  readonly tokenHash: string
  readonly tokenUtxos: readonly SpendableTokenUtxo[]
  readonly nativeUtxos: readonly SpendableUtxo[]
  readonly recipient: string
  readonly tokenAmount: bigint
  /** Native fee. Token UTXOs carry value 0, so the fee is paid from native inputs. */
  readonly feeAtomic: bigint
  readonly tokenChangeAddressFor: (algo: ChangeBranch) => string
  readonly nativeChangeAddressFor: (algo: ChangeBranch) => string
}

export interface BuiltTokenSend {
  readonly unsigned: UnsignedTx
  readonly tokenAmountAtomic: bigint
  readonly feeAtomic: bigint
  readonly tokenChangeAtomic: bigint
  readonly nativeChangeAtomic: bigint
  readonly tokenChangeAlgo?: ChangeBranch
  readonly nativeChangeAlgo?: ChangeBranch
}

// Assemble a token transfer. Token inputs cover the sent amount, with token change
// returned to self; native coin inputs cover the fee, with native change. The
// recipient and token-change outputs carry the TRANSFER `data` and a native value of
// 0; the fee is implicit (Σ native in − Σ native out). Token change goes to the
// majority algorithm of the token inputs, native change to that of the native inputs. Pure
// and key-free — signing happens later, and is token-agnostic.
export function buildTokenSend(params: BuildTokenSendParams): BuiltTokenSend {
  const { tokenHash, tokenUtxos, nativeUtxos, recipient, tokenAmount, feeAtomic, tokenChangeAddressFor, nativeChangeAddressFor } = params
  if (tokenAmount <= 0n) throw new Error('Token amount must be greater than zero.')
  if (feeAtomic <= 0n) throw new Error('A token transfer needs a positive native fee.')

  const recipientScripthash = toHex(decodeAddress(recipient).scripthash)

  const tokenSel = selectByToken(tokenUtxos, tokenAmount)
  if (tokenSel === null) {
    throw new InsufficientTokensError(tokenAmount, tokenUtxos.reduce((s, u) => s + u.tokenAmount, 0n))
  }
  const tokenChange = tokenSel.reduce((s, u) => s + u.tokenAmount, 0n) - tokenAmount

  const nativeSel = selectCoins(nativeUtxos, feeAtomic)
  if (nativeSel === null) {
    throw new InsufficientFundsError(feeAtomic, nativeUtxos.reduce((s, u) => s + u.value, 0n))
  }
  // Native change: a leftover at or below dust is folded into the fee, as with a native send.
  const rawNativeChange = nativeSel.reduce((s, u) => s + u.value, 0n) - feeAtomic
  const foldNative = rawNativeChange > 0n && rawNativeChange <= DUST_ATOMIC
  const nativeChange = foldNative ? 0n : rawNativeChange
  const feePaid = foldNative ? feeAtomic + rawNativeChange : feeAtomic

  const outputs: UnsignedOutput[] = [{ valueAtomic: '0', scripthash: recipientScripthash, data: toHex(encodeTokenTransfer(tokenAmount)) }]
  let tokenChangeAlgo: ChangeBranch | undefined
  if (tokenChange > 0n) {
    const decoded = decodeAddress(tokenChangeAddressFor(majorityAlgo(tokenSel)))
    outputs.push({ valueAtomic: '0', scripthash: toHex(decoded.scripthash), data: toHex(encodeTokenTransfer(tokenChange)) })
    tokenChangeAlgo = decoded.type === 'pq' ? 'falcon512' : 'ecdsa'
  }
  let nativeChangeAlgo: ChangeBranch | undefined
  if (nativeChange > 0n) {
    const decoded = decodeAddress(nativeChangeAddressFor(majorityAlgo(nativeSel)))
    outputs.push({ valueAtomic: nativeChange.toString(), scripthash: toHex(decoded.scripthash) })
    nativeChangeAlgo = decoded.type === 'pq' ? 'falcon512' : 'ecdsa'
  }

  return {
    unsigned: { inputs: toUnsignedInputs([...tokenSel, ...nativeSel]), outputs, tokenHash },
    tokenAmountAtomic: tokenAmount,
    feeAtomic: feePaid,
    tokenChangeAtomic: tokenChange,
    nativeChangeAtomic: nativeChange,
    tokenChangeAlgo,
    nativeChangeAlgo,
  }
}
