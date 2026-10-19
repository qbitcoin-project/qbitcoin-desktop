import {
  fail,
  ok,
  type Contact,
  type FeeBands,
  type AddressAlgo,
  type HistoryPage,
  type KeyInspection,
  type MaxSendable,
  type NodeKind,
  type NodeSettings,
  type NodeStatus,
  type ReceiveAddressEntry,
  type SendPreview,
  type SweepScan,
  type TokenBalance,
  type SendResult,
  type TokenSendPreview,
  type TxDetail,
  type WalletSnapshot,
  type UpgradeConvertRequest,
  type UpgradeConvertResult,
  type DowngradeEpisodeIpcView,
  type DowngradeInfoView,
  type DowngradePlanView,
  type UpgradeInfo,
  type UpgradePlanView,
  type UpgradeReturnResult,
  type UpgradeStatusView,
  type UtxoView,
  type VaultRequest,
  type VaultStatus,
  type WalletInfo,
  type WalletBackup,
  type WalletPublicData,
  type WalletResponse,
  type WalletSummary,
  type WatchInput,
} from '../../shared/protocol'
import type { StakingFundingRequest, StakingWithdrawalRequest, StakingInfo, StakingPreview, StakingResult, StakingSnapshot } from '../../shared/staking'

export interface StakingOps {
  info(): Promise<StakingInfo>
  list(): Promise<StakingSnapshot>
  refresh(): Promise<StakingSnapshot>
  buildFunding(request: StakingFundingRequest): Promise<StakingPreview>
  buildWithdrawal(request: StakingWithdrawalRequest): Promise<StakingPreview>
  confirm(id: string): Promise<StakingResult>
  retry(id: string): Promise<StakingResult>
  buildRecovery(id: string): Promise<StakingPreview>
  setAutoRetry(id: string, enabled: boolean): Promise<void>
}

// The minimal surface the orchestrator needs from the Vault (the real Vault
// satisfies it). Keeping it an interface keeps the orchestrator pure — no
// Electron, no crypto — and unit-testable with a fake.
export interface VaultLike {
  getStatus(): VaultStatus | Promise<VaultStatus>
  create(mnemonic: string, password: string): void | Promise<void>
  unlock(password: string): void | Promise<void>
  lock(): void
  destroy(): void | Promise<void>
  changePassword(oldPassword: string, newPassword: string): void | Promise<void>
  noteActivity(): void
}

// Stateless mnemonic helpers, injected so the orchestrator (and its tests) need
// no real cryptography. In main these come from @qbtc/crypto.
export interface MnemonicTools {
  generateMnemonic(): string
  validateMnemonic(phrase: string): boolean
}

// Receive-address operations, implemented by the main-process AddressService.
export interface AddressOps {
  getReceiveAddress(algo?: AddressAlgo): Promise<string>
  getNewReceiveAddress(algo?: AddressAlgo): Promise<string>
  listReceiveAddresses(algo?: AddressAlgo): Promise<readonly ReceiveAddressEntry[]>
}

// Chain read operations, implemented by the main-process ChainService.
export interface ChainOps {
  getSummary(): Promise<WalletSummary>
  getHistory(pages?: number): Promise<HistoryPage>
  estimateFee(): Promise<FeeBands>
  listTokens(): Promise<TokenBalance[]>
  /** Set (or clear, when empty) a local label for a transaction. */
  setTxLabel(txid: string, label: string): Promise<void>
  /** Full detail for one transaction (confirmations, size, totals, inputs/outputs). */
  getTxDetail(txid: string): Promise<TxDetail>
  /** Raw serialized transaction, hex — for the advanced view. */
  getTxRaw(txid: string): Promise<string>
  /** The last persisted read-model snapshot (or null), for instant render on unlock. */
  getSnapshot(): Promise<WalletSnapshot | null>
}

// Send operations, implemented by the main-process SendService.
export interface SendOps {
  buildSend(recipient: string, amountAtomic: bigint, outpoints?: readonly string[], sendMax?: boolean): Promise<SendPreview>
  maxSendable(outpoints?: readonly string[]): Promise<MaxSendable>
  buildTokenSend(tokenId: string, recipient: string, tokenAmount: bigint): Promise<TokenSendPreview>
  confirmSend(): Promise<SendResult>
}

// Coin-control operations, implemented by the main-process CoinService.
export interface CoinOps {
  list(): Promise<UtxoView[]>
  setLabel(outpoint: string, label: string): Promise<void>
  setFrozen(outpoint: string, frozen: boolean): Promise<void>
}

// Address-book operations, implemented by the main-process ContactService.
export interface ContactOps {
  list(): Promise<readonly Contact[]>
  add(name: string, address: string): Promise<void>
  remove(address: string): Promise<void>
}

// Wallet-management operations (registry + active session), implemented in main. Each
// mutating call returns the updated wallet list, so the renderer needn't re-fetch.
export interface WalletOps {
  list(): readonly WalletInfo[] | Promise<readonly WalletInfo[]>
  add(label: string, input: WatchInput): Promise<readonly WalletInfo[]>
  addSeed(label: string, mnemonic: string, passphrase?: string): Promise<readonly WalletInfo[]>
  /** Preview a pasted key: candidate algorithms + address each would watch. */
  inspectKey(wif: string): Promise<KeyInspection>
  addKey(label: string, wif: string, algo?: AddressAlgo): Promise<readonly WalletInfo[]>
  restore(mnemonic: string, password: string): Promise<VaultStatus>
  switch(id: string): readonly WalletInfo[] | Promise<readonly WalletInfo[]>
  rename(id: string, label: string): readonly WalletInfo[] | Promise<readonly WalletInfo[]>
  remove(id: string): Promise<readonly WalletInfo[]>
  revealBackup(walletId: string, password: string, check: () => void): Promise<WalletBackup>
  exportPublicData(walletId: string): Promise<WalletPublicData>
}

// Ephemeral "send from a private key" (sweep), implemented in main. The key is
// held only between scan and confirm/cancel — never stored. Independent of the
// active wallet.
export interface SweepOps {
  scan(wif: string, sessionId: string, algo?: AddressAlgo): Promise<SweepScan>
  build(recipient: string, amountAtomic: bigint | undefined, sendMax: boolean): Promise<SendPreview>
  confirm(): Promise<SendResult>
  cancel(sessionId: string): void
}

// Node-selection operations (Network card), implemented in main. select/setOwn/
// clearOwn rebuild the active session and return the updated settings; status is a
// live probe of the active endpoint.
export interface NodeOps {
  get(): NodeSettings | Promise<NodeSettings>
  select(kind: NodeKind, url?: string): Promise<NodeSettings>
  setOwn(url: string, user?: string, password?: string): Promise<NodeSettings>
  clearOwn(): Promise<NodeSettings>
  /** Add (or rename) a user-provided public esplora node; probed before saving. */
  addCustom(url: string, name?: string): Promise<NodeSettings>
  removeCustom(url: string): Promise<NodeSettings>
  setTor(enabled: boolean): NodeSettings | Promise<NodeSettings>
  status(): Promise<NodeStatus>
  /** Persist the network profile and relaunch (no-op if already active). */
  setNetwork(network: 'mainnet' | 'testnet'): Promise<void>
}

// BTC→native upgrade operations. Implemented in main; on brands without an
// upgrade path every method except `info` rejects.
export interface UpgradeOps {
  info(): Promise<UpgradeInfo>
  status(): Promise<UpgradeStatusView>
  plan(req: UpgradeConvertRequest): Promise<UpgradePlanView>
  convert(req: UpgradeConvertRequest, destAddress: string): Promise<UpgradeConvertResult>
  returnBtc(destBtcAddress: string): Promise<UpgradeReturnResult>
}

// Native→BTC downgrade operations. Implemented in main; on brands without a
// downgrade path every method except `info` rejects.
export interface DowngradeOps {
  info(): Promise<DowngradeInfoView>
  status(): Promise<readonly DowngradeEpisodeIpcView[]>
  plan(amountAtomic: string): Promise<DowngradePlanView>
  convert(amountAtomic: string, btcAddress: string): Promise<{ txid: string }>
  reclaim(freezeTxid: string): Promise<{ txid: string }>
}

export interface OrchestratorDeps {
  readonly vault: VaultLike
  readonly mnemonic: MnemonicTools
  readonly addresses: AddressOps
  readonly chain: ChainOps
  readonly send: SendOps
  readonly coins: CoinOps
  readonly contacts: ContactOps
  readonly wallets: WalletOps
  readonly sweep: SweepOps
  readonly node: NodeOps
  readonly upgrade: UpgradeOps
  readonly downgrade: DowngradeOps
  readonly staking?: StakingOps
}

// Handles every wallet request from the renderer. Vault-lifecycle requests are
// routed to the single, main-process-owned Vault; mnemonic helpers, address
// derivation, chain reads, sending and coin control run in main so the renderer
// never imports crypto or touches the network. The orchestrator owns no key
// material and no state of its own — the Vault is the source of truth (including
// autolock). Errors come back as a WalletResponse envelope; the seed and master
// key never appear in one.
export class VaultOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async handle(request: VaultRequest, checkSensitive?: () => void): Promise<WalletResponse<unknown>> {
    try {
      switch (request.type) {
        case 'vault.getStatus':
          return ok(await this.deps.vault.getStatus())
        case 'vault.create':
          await this.deps.vault.create(request.mnemonic, request.password)
          return ok(await this.deps.vault.getStatus())
        case 'vault.unlock':
          await this.deps.vault.unlock(request.password)
          return ok(await this.deps.vault.getStatus())
        case 'vault.lock':
          this.deps.vault.lock()
          return ok(await this.deps.vault.getStatus())
        case 'vault.destroy':
          await this.deps.vault.destroy()
          return ok(await this.deps.vault.getStatus())
        case 'wallets.revealBackup':
          if (!checkSensitive) throw new Error('Backup permission is required.')
          checkSensitive()
          return ok(await this.deps.wallets.revealBackup(request.walletId, request.password, checkSensitive))
        case 'vault.changePassword':
          await this.deps.vault.changePassword(request.oldPassword, request.newPassword)
          return ok(undefined)
        case 'vault.noteActivity':
          // Real user interaction reported by the renderer — reset the idle timer.
          // Background reads (polling) do NOT come through here, by design.
          this.deps.vault.noteActivity()
          return ok(undefined)
        case 'vault.generateMnemonic':
          return ok(this.deps.mnemonic.generateMnemonic())
        case 'vault.validateMnemonic':
          return ok(this.deps.mnemonic.validateMnemonic(request.phrase))
        case 'wallet.getReceiveAddress':
          return ok(await this.deps.addresses.getReceiveAddress(request.algo))
        case 'wallet.getNewReceiveAddress':
          return ok(await this.deps.addresses.getNewReceiveAddress(request.algo))
        case 'wallet.listReceiveAddresses':
          return ok(await this.deps.addresses.listReceiveAddresses(request.algo))
        case 'chain.getSummary':
          return ok(await this.deps.chain.getSummary())
        case 'chain.getHistory':
          return ok(await this.deps.chain.getHistory(request.pages))
        case 'chain.setTxLabel':
          await this.deps.chain.setTxLabel(request.txid, request.label)
          return ok(undefined)
        case 'chain.getTxDetail':
          return ok(await this.deps.chain.getTxDetail(request.txid))
        case 'chain.getTxRaw':
          return ok(await this.deps.chain.getTxRaw(request.txid))
        case 'chain.getSnapshot':
          return ok(await this.deps.chain.getSnapshot())
        case 'chain.estimateFee':
          return ok(await this.deps.chain.estimateFee())
        case 'chain.listTokens':
          return ok(await this.deps.chain.listTokens())
        case 'wallet.buildSend':
          return ok(await this.deps.send.buildSend(request.recipient, BigInt(request.amountAtomic), request.outpoints, request.sendMax))
        case 'wallet.maxSendable':
          return ok(await this.deps.send.maxSendable(request.outpoints))
        case 'wallet.buildTokenSend':
          return ok(await this.deps.send.buildTokenSend(request.tokenId, request.recipient, BigInt(request.tokenAmountAtomic)))
        case 'wallet.confirmSend':
          return ok(await this.deps.send.confirmSend())
        case 'coins.list':
          return ok(await this.deps.coins.list())
        case 'coins.setLabel':
          await this.deps.coins.setLabel(request.outpoint, request.label)
          return ok(undefined)
        case 'coins.setFrozen':
          await this.deps.coins.setFrozen(request.outpoint, request.frozen)
          return ok(undefined)
        case 'contacts.list':
          return ok(await this.deps.contacts.list())
        case 'contacts.add':
          await this.deps.contacts.add(request.name, request.address)
          return ok(await this.deps.contacts.list())
        case 'contacts.remove':
          await this.deps.contacts.remove(request.address)
          return ok(await this.deps.contacts.list())
        case 'wallets.list':
          return ok(await this.deps.wallets.list())
        case 'wallets.add':
          return ok(await this.deps.wallets.add(request.label, request.input))
        case 'wallets.addSeed':
          return ok(await this.deps.wallets.addSeed(request.label, request.mnemonic, request.passphrase))
        case 'wallets.inspectKey':
          return ok(await this.deps.wallets.inspectKey(request.wif))
        case 'wallets.addKey':
          return ok(await this.deps.wallets.addKey(request.label, request.wif, request.algo))
        case 'sweep.scan':
          return ok(await this.deps.sweep.scan(request.wif, request.sessionId, request.algo))
        case 'sweep.build':
          return ok(await this.deps.sweep.build(request.recipient, request.amountAtomic !== undefined ? BigInt(request.amountAtomic) : undefined, request.sendMax))
        case 'sweep.confirm':
          return ok(await this.deps.sweep.confirm())
        case 'sweep.cancel':
          this.deps.sweep.cancel(request.sessionId)
          return ok(undefined)
        case 'wallets.restore':
          return ok(await this.deps.wallets.restore(request.mnemonic, request.password))
        case 'wallets.switch':
          return ok(await this.deps.wallets.switch(request.id))
        case 'wallets.rename':
          return ok(await this.deps.wallets.rename(request.id, request.label))
        case 'wallets.remove':
          return ok(await this.deps.wallets.remove(request.id))
        case 'wallets.exportPublicData':
          return ok(await this.deps.wallets.exportPublicData(request.walletId))
        case 'node.get':
          return ok(await this.deps.node.get())
        case 'node.select':
          return ok(await this.deps.node.select(request.kind, request.url))
        case 'node.setOwn':
          return ok(await this.deps.node.setOwn(request.url, request.user, request.password))
        case 'node.clearOwn':
          return ok(await this.deps.node.clearOwn())
        case 'node.setTor':
          return ok(await this.deps.node.setTor(request.enabled))
        case 'node.status':
          return ok(await this.deps.node.status())
        case 'node.addCustom':
          return ok(await this.deps.node.addCustom(request.url, request.name))
        case 'node.removeCustom':
          return ok(await this.deps.node.removeCustom(request.url))
        case 'network.set':
          return ok(await this.deps.node.setNetwork(request.network))
        case 'upgrade.info':
          return ok(await this.deps.upgrade.info())
        case 'upgrade.status':
          return ok(await this.deps.upgrade.status())
        case 'upgrade.plan':
          return ok(await this.deps.upgrade.plan(request.req))
        case 'upgrade.convert':
          return ok(await this.deps.upgrade.convert(request.req, request.destAddress))
        case 'upgrade.return':
          return ok(await this.deps.upgrade.returnBtc(request.destBtcAddress))
        case 'downgrade.info':
          return ok(await this.deps.downgrade.info())
        case 'downgrade.status':
          return ok(await this.deps.downgrade.status())
        case 'downgrade.plan':
          return ok(await this.deps.downgrade.plan(request.amountAtomic))
        case 'downgrade.convert':
          return ok(await this.deps.downgrade.convert(request.amountAtomic, request.btcAddress))
        case 'downgrade.reclaim':
          return ok(await this.deps.downgrade.reclaim(request.freezeTxid))
        case 'staking.info':
        case 'staking.list':
        case 'staking.refresh':
        case 'staking.buildFunding':
        case 'staking.buildWithdrawal':
        case 'staking.confirm':
        case 'staking.buildRecovery':
        case 'staking.setAutoRetry':
        case 'staking.retry': {
          if (await this.deps.vault.getStatus() !== 'unlocked') throw new Error('Unlock the wallet to use staking.')
          const staking = this.deps.staking
          if (staking === undefined) throw new Error('Staking is not available.')
          if (request.type === 'staking.info') return ok(await staking.info())
          if (request.type === 'staking.list') return ok(await staking.list())
          if (request.type === 'staking.refresh') return ok(await staking.refresh())
          if (request.type === 'staking.buildFunding') {
            const r = request.request
            if (r === null || typeof r !== 'object' || !['ecdsa', 'falcon512'].includes(r.algo) || typeof r.amountAtomic !== 'string' ||
              (r.max !== undefined && typeof r.max !== 'boolean') || (r.sourceAddress !== undefined && typeof r.sourceAddress !== 'string')) throw new Error('Invalid staking request.')
            return ok(await staking.buildFunding(r))
          }
          if (request.type === 'staking.buildWithdrawal') {
            const r = request.request
            if (r === null || typeof r !== 'object' || typeof r.address !== 'string' || r.address.length > 160 ||
              (r.tokenId !== undefined && (typeof r.tokenId !== 'string' || !/^[0-9a-f]{64}$/.test(r.tokenId))) ||
              typeof r.amountAtomic !== 'string' || (r.max !== undefined && typeof r.max !== 'boolean')) throw new Error('Invalid unstake request.')
            return ok(await staking.buildWithdrawal(r))
          }
          const id = request.type === 'staking.confirm' ? request.draftId : request.operationId
          if (typeof id !== 'string' || id.length > 100) throw new Error('Invalid staking operation.')
          if (request.type === 'staking.buildRecovery') return ok(await staking.buildRecovery(id))
          if (request.type === 'staking.setAutoRetry') {
            if (typeof request.enabled !== 'boolean') throw new Error('Invalid retry setting.')
            await staking.setAutoRetry(id, request.enabled)
            return ok(undefined)
          }
          return ok(await (request.type === 'staking.confirm' ? staking.confirm(id) : staking.retry(id)))
        }
        default:
          return fail(new Error(`Unknown request: ${String((request as { type: unknown }).type)}`))
      }
    } catch (err) {
      return fail(err)
    }
  }
}
