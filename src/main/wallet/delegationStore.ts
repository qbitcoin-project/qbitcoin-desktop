import { encodeTokenTransfer, toHex, type Network } from '@qbtc/crypto'
import type { StakingOperationView, StakingPreview } from '../../shared/staking'
import type { BlobStore, Sealer } from './meta'
import { stakingPath, type StakingOwner } from './stakingKeys'
import type { UnsignedTx, ChangeBranch } from './buildTx'
import { MAX_BROADCAST_BYTES } from './transactionLimits'

export interface DelegationRecord {
  readonly address: string
  readonly owner: StakingOwner
  readonly ownerHashHex: string
  readonly delegateHashHex: string
  readonly profileId?: string
}
export interface DelegationOperation extends StakingOperationView {
  readonly unsigned: UnsignedTx
  readonly rawHex?: string
  readonly feeRate: number
  readonly changeAddress?: string
  readonly changeAlgo?: ChangeBranch
  readonly changeConsumed?: boolean
  readonly lastAttemptAt?: number
  readonly attempts?: number
  readonly autoAttemptBase?: number
  readonly preview: StakingPreview
}
export interface DelegationJournal {
  readonly version: 1
  readonly walletId: string
  readonly network: Network
  readonly records: readonly DelegationRecord[]
  readonly operations: readonly DelegationOperation[]
}
export interface DelegationStore {
  load(): Promise<DelegationJournal>
  save(data: DelegationJournal): Promise<void>
}

export function emptyDelegationJournal(walletId: string, network: Network): DelegationJournal {
  return { version: 1, walletId, network, records: [], operations: [] }
}

const hex = (value: unknown, lengths: readonly number[]): boolean => typeof value === 'string' && /^[0-9a-f]+$/.test(value) && lengths.includes(value.length)
const amount = (value: unknown): boolean => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const uint = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Fail closed: malformed records must never silently hide a delegation. */
export function validateDelegationJournal(value: unknown, walletId: string, network: Network): DelegationJournal {
  let section = 'journal header'
  const invalid = (reason = `Invalid ${section}`): never => {
    throw new Error(`Staking data could not be restored: ${reason}. The saved data has not been changed.`)
  }
  if (!object(value) || value.version !== 1 ||
    !Array.isArray(value.records) || !Array.isArray(value.operations)) return invalid()
  if (value.walletId !== walletId) return invalid('The journal belongs to a different wallet')
  if (value.network !== network) return invalid('The journal belongs to a different network')
  const addresses = new Set<string>()
  for (const record of value.records) {
    section = `staking address record ${addresses.size + 1}`
    if (!object(record) || typeof record.address !== 'string' || addresses.has(record.address) ||
      !hex(record.ownerHashHex, [40, 64]) || !hex(record.delegateHashHex, [40, 64]) || !object(record.owner)) return invalid()
    const owner = record.owner
    if ((owner.algo !== 'ecdsa' && owner.algo !== 'falcon512' && !(owner.kind === 'key' && owner.algo === 'schnorr')) ||
      (owner.kind !== 'key' && (owner.kind !== 'hd' || typeof owner.derivationId !== 'string')) ||
      (record.profileId !== undefined && typeof record.profileId !== 'string')) return invalid()
    if (owner.kind === 'hd') {
      try { stakingPath(owner as StakingOwner, network) }
      catch (error) { return invalid(error instanceof Error ? error.message.replace(/\.$/, '') : 'Invalid staking key reference') }
    } else if (owner.account !== undefined || owner.derivationId !== undefined) return invalid()
    addresses.add(record.address)
  }
  const ids = new Set<string>()
  for (const op of value.operations) {
    section = `operation ${ids.size + 1}`
    if (!object(op) || typeof op.id !== 'string' || ids.has(op.id) || typeof op.address !== 'string' || !addresses.has(op.address) ||
      (op.kind !== 'funding' && op.kind !== 'withdrawal') || !amount(op.amountAtomic) || !amount(op.feeAtomic) ||
      typeof op.destination !== 'string' || typeof op.createdAt !== 'number' || !Number.isFinite(op.createdAt) ||
      typeof op.feeRate !== 'number' || !Number.isFinite(op.feeRate) || op.feeRate <= 0 ||
      !['prepared', 'signed', 'pending', 'confirmed', 'conflict', 'rejected', 'abandoned'].includes(String(op.state)) ||
      !object(op.unsigned) || !Array.isArray(op.unsigned.inputs) || !Array.isArray(op.unsigned.outputs) ||
      op.unsigned.inputs.length === 0 || op.unsigned.outputs.length === 0 ||
      !object(op.preview) || op.preview.draftId !== op.id) return invalid()
    const preview = op.preview
    if (op.tokenId !== undefined) {
      if (op.kind !== 'withdrawal' || !hex(op.tokenId, [64]) || op.unsigned.tokenHash !== op.tokenId ||
        !amount(op.tokenAmountAtomic) || BigInt(op.tokenAmountAtomic as string) <= 0n || BigInt(op.tokenAmountAtomic as string) > 0xffffffffffffffffn ||
        preview.tokenId !== op.tokenId || preview.tokenAmountAtomic !== op.tokenAmountAtomic ||
        (op.unsigned.outputs[0] as Record<string, unknown>).data !== toHex(encodeTokenTransfer(BigInt(op.tokenAmountAtomic as string)))) return invalid()
    } else if (op.unsigned.tokenHash !== undefined || preview.tokenId !== undefined || op.tokenAmountAtomic !== undefined) return invalid()
    section = `preview for operation ${ids.size + 1}`
    if (preview.kind !== op.kind || preview.address !== op.address || preview.destination !== op.destination ||
      preview.amountAtomic !== op.amountAtomic || preview.feeAtomic !== op.feeAtomic || preview.eligibleAt !== op.eligibleAt ||
      !['ecdsa', 'falcon512', 'schnorr'].includes(String(preview.algo)) || typeof preview.sourceLabel !== 'string' ||
      (preview.stakingRemainingAtomic !== undefined && !amount(preview.stakingRemainingAtomic)) ||
      (preview.remainingTokenAmountAtomic !== undefined && !amount(preview.remainingTokenAmountAtomic)) ||
      !amount(preview.changeAtomic) || !amount(preview.remainingAtomic) || !amount(preview.estimatedTotalFeeAtomic) ||
      !uint(preview.inputCount) || preview.inputCount !== op.unsigned.inputs.length || !uint(preview.sizeUpperBound) ||
      !uint(preview.remainingParts) || !Array.isArray(preview.inputAlgorithms) ||
      !preview.inputAlgorithms.every((a) => a === 'ecdsa' || a === 'falcon512' || a === 'schnorr') ||
      (op.eligibleAt !== undefined && !uint(op.eligibleAt)) ||
      (op.lastAttemptAt !== undefined && !uint(op.lastAttemptAt)) || (op.attempts !== undefined && !uint(op.attempts)) ||
      (op.autoAttemptBase !== undefined && (!uint(op.autoAttemptBase) || Number(op.autoAttemptBase) > Number(op.attempts ?? 0))) ||
      (op.changeConsumed !== undefined && typeof op.changeConsumed !== 'boolean') ||
      (op.autoRetry !== undefined && typeof op.autoRetry !== 'boolean') ||
      (op.settled !== undefined && typeof op.settled !== 'boolean') ||
      (op.settled === true && op.state !== 'confirmed') || preview.recoveryOf !== op.recoveryOf ||
      (op.message !== undefined && typeof op.message !== 'string')) return invalid()
    const outpoints = new Set<string>()
    section = `inputs for operation ${ids.size + 1}`
    for (const input of op.unsigned.inputs) {
      if (!object(input) || !hex(input.prevTxid, [64]) || !uint(input.vout) || Number(input.vout) > 0xffffffff ||
        !amount(input.valueAtomic) || !uint(input.account) ||
        (input.chain !== 0 && input.chain !== 1) || !uint(input.index) ||
        (input.scheme !== undefined && typeof input.scheme !== 'string') ||
        (input.keyScript !== undefined && input.keyScript !== 'ordinary' && input.keyScript !== 'delegated') ||
        !['ecdsa', 'falcon512', 'schnorr'].includes(String(input.algo))) return invalid()
      const key = `${String(input.prevTxid)}:${String(input.vout)}`
      if (outpoints.has(key)) return invalid()
      outpoints.add(key)
    }
    section = `outputs for operation ${ids.size + 1}`
    for (const output of op.unsigned.outputs) {
      if (!object(output) || !amount(output.valueAtomic) || !hex(output.scripthash, [40, 64]) ||
        (output.data !== undefined && !hex(output.data, op.tokenId === undefined ? [42, 66] : [18]))) return invalid()
    }
    const inputs = op.unsigned.inputs as { valueAtomic: string }[]
    const outputs = op.unsigned.outputs as { valueAtomic: string }[]
    section = `amounts or fee for operation ${ids.size + 1}`
    if (inputs.reduce((sum, i) => sum + BigInt(i.valueAtomic), 0n) - outputs.reduce((sum, o) => sum + BigInt(o.valueAtomic), 0n) !== BigInt(op.feeAtomic as string) ||
      outputs[0]!.valueAtomic !== op.amountAtomic) return invalid()
    section = `signed transaction or change metadata for operation ${ids.size + 1}`
    if (op.rawHex !== undefined && (typeof op.rawHex !== 'string' || op.rawHex.length > MAX_BROADCAST_BYTES * 2 ||
      op.rawHex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(op.rawHex))) return invalid()
    if (op.txid !== undefined && !hex(op.txid, [64])) return invalid()
    if (['signed', 'pending', 'confirmed', 'conflict', 'rejected'].includes(String(op.state)) &&
      (op.rawHex === undefined || op.txid === undefined)) return invalid()
    if (op.changeAlgo !== undefined && !['ecdsa', 'falcon512'].includes(String(op.changeAlgo))) return invalid()
    if (op.changeAddress !== undefined && typeof op.changeAddress !== 'string') return invalid()
    ids.add(op.id)
  }
  for (const op of value.operations as Record<string, unknown>[]) {
    if (op.recoveryOf === undefined) continue
    const original = (value.operations as Record<string, unknown>[]).find((item) => item.id === op.recoveryOf)
    if (typeof op.recoveryOf !== 'string' || original === undefined || original.id === op.id || original.recoveryOf !== undefined ||
      original.address !== op.address || op.kind !== 'withdrawal' || op.tokenId !== undefined || original.tokenId !== undefined ||
      (op.preview as Record<string, unknown>).recoveryOf !== op.recoveryOf) return invalid('Invalid recovery reference')
    const inputsOf = (item: Record<string, unknown>): string[] => ((item.unsigned as Record<string, unknown>).inputs as Record<string, unknown>[])
      .map((input) => `${String(input.prevTxid)}:${String(input.vout)}:${String(input.valueAtomic)}`).sort()
    if (JSON.stringify(inputsOf(op)) !== JSON.stringify(inputsOf(original))) return invalid('Recovery must spend exactly the original inputs')
  }
  return value as unknown as DelegationJournal
}

export class DelegationMetaStore implements DelegationStore {
  private writes: Promise<void> = Promise.resolve()
  constructor(private readonly storage: BlobStore, private readonly sealer: Sealer, private readonly walletId: string, private readonly network: Network) {}

  async load(): Promise<DelegationJournal> {
    await this.writes
    const blob = await this.storage.read()
    if (blob === null) return emptyDelegationJournal(this.walletId, this.network)
    return validateDelegationJournal(JSON.parse(await this.sealer.openData(blob)), this.walletId, this.network)
  }

  save(data: DelegationJournal): Promise<void> {
    validateDelegationJournal(data, this.walletId, this.network)
    const serialized = JSON.stringify(data)
    const run = this.writes.then(async () => this.storage.write(await this.sealer.sealData(serialized)))
    this.writes = run.catch(() => {})
    return run
  }
}
