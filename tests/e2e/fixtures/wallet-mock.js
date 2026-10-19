/* global window, URLSearchParams */
const query = new URLSearchParams(window.location.search)
const address = 'classical-test-address'
const coin = { outpoint: 'aa:0', address, valueAtomic: '100000000', confirmations: 10, algo: 'ecdsa', frozen: false }
const token = { id: 'token-test', name: 'Test Token', symbol: 'TOK', decimals: 2, amountAtomic: '500' }
const maturesAt = Math.floor(Date.now() / 1000) + 3600
const maturingCoins = query.has('maturity') ? [
  { ...coin, outpoint: 'dd:0', valueAtomic: '200000000', maturesAt, label: 'Maturing stake' },
  { ...coin, outpoint: 'ee:0', valueAtomic: '0', tokenId: token.id, tokenAmountAtomic: '700', maturesAt },
  { ...coin, outpoint: 'ff:0', valueAtomic: '400000000', maturityUnknown: true },
] : []
const wallets = [{ id: 'main', label: 'Main Wallet', kind: query.has('key') ? 'key' : 'seed', active: true, canSign: true, removable: false, address }]
if (query.has('accounts')) wallets.push({ id: 'imported', label: 'Imported key', kind: 'key', active: false, canSign: true, removable: true, address: 'single-key-test-address' })
const calls = []
let submissions = 0
let unresolved = query.get('submission') === 'existing'
const transaction = { txid: 'ab'.repeat(32), direction: 'in', amountAtomic: '100000000', feeAtomic: '1000', confirmed: true, blockTime: 1700000000 }
window.walletUiTest = { calls, depositAvailable: true, creditState: query.get('credit') ?? 'pending' }
const conversion = { txid: 'aa'.repeat(32), lockValueSat: '1000000', destScripthashHex: '29'.repeat(32), confirmed: true, confirmations: 9 }
const conversionCredit = { state: 'received', txid: 'cc'.repeat(32), amountAtomic: '250000000', address: 'native-conversion-destination', blockHeight: 1234, blockTime: 1700000000 }
let stakingDraft = null
const stakingOperations = query.has('staking-many') ? Array.from({ length: 20 }, (_, index) => ({
  id: `history-${index + 1}`, kind: 'funding', address: 'delegation-ecdsa-test-address',
  state: index === 0 ? 'pending' : 'confirmed', createdAt: 1700000000000 + index,
  amountAtomic: String((index + 1) * 100000), feeAtomic: '1000', destination: 'delegation-ecdsa-test-address',
  txid: (index + 1).toString(16).padStart(64, '0'),
})) : []
const stakingAddresses = ['ecdsa', 'falcon512'].map((algo) => ({ address: `delegation-${algo}-test-address`, algo, serviceLabel: 'Test service',
  delegatePubkeyhash: `service-${algo}-hash`, ownerPubkeyhash: `owner-${algo}-hash`, legacy: query.has('staking-legacy'), canFund: !query.has('staking-disabled') && !query.has('staking-legacy'),
  balanceAtomic: '10090000', confirmedAtomic: '10090000', pendingAtomic: '0', matureAtomic: query.has('staking-locked') ? '0' : '10000000', availableAtomic: query.has('staking-locked') || query.has('staking-reserved') ? '0' : '10000000', maturingAtomic: query.has('staking-locked') ? '10090000' : '90000', unknownAtomic: '0',
  tokens: query.has('staking-tokens') ? [{ id: token.id, amountAtomic: '123' }] : [],
  eligibleAt: maturesAt, lastStakeAt: 1700000000, lastRewardAtomic: '90000', slashed: false, stale: query.has('staking-stale') }))
// staking-single leaves only the ECDSA key funded; staking-empty leaves both keys unused.
for (const entry of stakingAddresses) if (query.has('staking-empty') || (query.has('staking-single') && entry.algo === 'falcon512')) {
  Object.assign(entry, { balanceAtomic: '0', confirmedAtomic: '0', matureAtomic: '0', availableAtomic: '0', maturingAtomic: '0', eligibleAt: undefined, lastStakeAt: undefined, lastRewardAtomic: undefined })
}
// staking-failed seeds an unstake that conflicted before the page opened.
if (query.has('staking-failed')) stakingOperations.push({ id: 'failed-unstake', kind: 'withdrawal', address: 'delegation-ecdsa-test-address', state: 'conflict',
  createdAt: 1700000000000, amountAtomic: '3000000', feeAtomic: '1000', destination: 'ordinary-return-ecdsa', txid: 'fa'.repeat(32),
  message: 'The inputs were spent by another transaction. Refresh and review a new operation.' })
window.walletUiTest.stakingLoadError = query.has('staking-load-error')
// Like the main process: address views change only when a refresh reads the node,
// and before the first read the list has no addresses (staking-slow-refresh holds it).
let stakingRead = !query.has('staking-slow-refresh')
const stakingInbox = []
const stakingChainActivity = []
if (query.has('staking-chain')) {
  const addr = stakingAddresses[0].address
  stakingOperations.push({ id: 'journal-deposit', kind: 'funding', address: addr, state: 'confirmed', txid: 'bc'.repeat(32),
    createdAt: 1700000002000, amountAtomic: '200000', feeAtomic: '3', destination: addr })
  for (const [index, kind, amount] of [[1, 'deposit', '100000'], [2, 'deposit', '200000'], [3, 'transaction', undefined],
    [4, 'transaction', '0'], [5, 'slashing', '-500'], [6, 'withdrawal', '-100003'], [7, 'stake', '900'], [8, 'deposit', '1000000']]) {
    stakingChainActivity.push({ source: 'chain', id: `chain-${index}`, address: index === 8 ? stakingAddresses[1].address : addr,
      txid: index === 2 ? 'bc'.repeat(32) : index.toString(16).padStart(64, '0'), kind, balanceChangeAtomic: amount,
      tokenChanges: index === 4 ? [{ id: token.id, amountAtomic: '-40' }] : [], feeAtomic: index === 7 ? undefined : '3', blockHeight: 100 + index,
      createdAt: index === 3 ? undefined : 1700000000000 + index * 1000 })
  }
}
window.walletUiTest.stakingChainActivity = stakingChainActivity
window.walletUiTest.stakingAddresses = stakingAddresses
const stakingSnapshot = () => stakingRead ? { addresses: stakingAddresses, operations: stakingOperations, chainActivity: stakingChainActivity, refreshedAt: Date.now() } : { addresses: [], operations: stakingOperations }
const methods = {
  getNode: () => ({ network: 'mainnet', selected: 'public', publicNodes: [], customNodes: [], tor: false, hasAuth: false }),
  nodeStatus: () => ({ url: '', reachable: false }),
  getSnapshot: () => null,
  listWallets: () => wallets,
  getSummary: () => ({ balanceAtomic: '100000000', addressCount: 1, ...(query.has('staking') ? { delegatedAtomic: '10090000', ordinaryAtomic: '89910000' } : {}) }),
  getHistory: () => ({ items: query.has('notes') ? [{ ...transaction }] : [], hasMore: false }),
  getTxDetail: () => ({ txid: transaction.txid, confirmations: 10, sizeBytes: 200, totalInAtomic: '100001000', totalOutAtomic: '100000000', feeAtomic: '1000', inputs: [],
    outputs: query.has('staking-index-error') ? [
      { address, amountAtomic: '90000000', own: true, pq: false },
      { address: 'unresolved-delegation-address', amountAtomic: '10000000', own: false, pq: false, ownershipUnknown: true },
    ] : [],
    ...(query.has('staking-index-error') ? { ownershipIncomplete: true } : {}) }),
  setTxLabel: (_txid, label) => { transaction.label = label || undefined },
  setCoinLabel: () => {},
  listContacts: () => [],
  listTokens: () => [token],
  listCoins: () => [coin, { ...coin, outpoint: 'bb:0', valueAtomic: '900000000', frozen: true },
    { ...coin, outpoint: 'cc:0', valueAtomic: '0', tokenId: token.id, tokenAmountAtomic: token.amountAtomic }, ...maturingCoins],
  getReceiveAddress: (algo = 'ecdsa') => algo === 'falcon512' ? 'falcon-test-address' : address,
  stakingInfo: () => ({ enabled: query.has('staking'), network: query.has('staking-mainnet') ? 'mainnet' : 'testnet', fundingEnabled: query.has('staking') && !query.has('staking-disabled'),
    minimumAtomic: '100000', minimumVerified: !query.has('staking-unverified'), commission: query.get('staking-commission') ?? undefined, algorithms: ['ecdsa', 'falcon512'], serviceLabel: 'Test service',
    notice: query.has('staking-disabled') ? 'Funding is disabled until service settings have been verified.' : undefined }),
  stakingList: () => { if (window.walletUiTest.stakingLoadError) throw new Error('Temporary staking read failure'); return stakingSnapshot() },
  stakingRefresh: async () => {
    if (window.walletUiTest.stakingLoadError) throw new Error('Temporary staking refresh failure')
    if (!stakingRead) await new Promise((resolve) => { window.walletUiTest.releaseRefresh = resolve })
    stakingRead = true
    for (const item of stakingInbox.splice(0)) {
      const entry = stakingAddresses.find((a) => a.address === item.address)
      const add = (key) => { entry[key] = (BigInt(entry[key]) + item.amount).toString() }
      add('balanceAtomic')
      if (item.confirmed) { add('confirmedAtomic'); add('matureAtomic'); add('availableAtomic') } else add('pendingAtomic')
    }
    return stakingSnapshot()
  },
  stakingBuildFunding: (request) => {
    if (request.algo !== 'ecdsa' && request.algo !== 'falcon512') throw new Error('Invalid owner')
    if (!request.max && BigInt(request.amountAtomic) + 1000n > 100000000n) throw new Error('Not enough balance to cover this amount plus the network fee.')
    const entry = stakingAddresses.find((a) => a.algo === request.algo)
    stakingDraft = { draftId: `funding-${stakingOperations.length}`, kind: 'funding', address: entry.address, destination: entry.address, algo: request.algo,
      amountAtomic: request.max ? '99999000' : request.amountAtomic, feeAtomic: '1000', changeAtomic: request.max ? '0' : (100000000n - BigInt(request.amountAtomic) - 1000n).toString(),
      sourceLabel: request.sourceAddress ?? 'Ordinary coins in this wallet', inputAlgorithms: ['ecdsa'], inputCount: 1, sizeUpperBound: 300,
      remainingParts: 0, remainingAtomic: '0', estimatedTotalFeeAtomic: '1000' }
    return stakingDraft
  },
  stakingBuildWithdrawal: async (request) => {
    if (query.has('staking-withdrawal-delayed')) await new Promise((resolve) => { window.walletUiTest.releaseWithdrawal = resolve })
    const selected = request.address
    if (query.has('staking-withdrawal-error')) throw new Error('Refresh the balance before preparing a return.')
    const entry = stakingAddresses.find((a) => a.address === selected)
    const amount = request.tokenId ? 0n : request.max ? 9999000n : BigInt(request.amountAtomic)
    if (amount + 1000n > BigInt(entry.matureAtomic)) throw new Error('Not enough balance to cover this amount plus the network fee.')
    const change = 10000000n - amount - 1000n
    stakingDraft = { draftId: `withdrawal-${stakingOperations.length}`, kind: 'withdrawal', address: selected, destination: `ordinary-return-${entry.algo}`,
      ...(request.tokenId ? { tokenId: request.tokenId, tokenAmountAtomic: '123', remainingTokenAmountAtomic: '0' } : {}),
      algo: entry.algo, amountAtomic: amount.toString(), feeAtomic: '1000', changeAtomic: change.toString(), stakingRemainingAtomic: (BigInt(entry.balanceAtomic) - amount - 1000n).toString(), sourceLabel: selected, inputAlgorithms: [entry.algo], inputCount: 1, sizeUpperBound: 400,
      remainingParts: query.has('staking-parts') ? 2 : 0, remainingAtomic: query.has('staking-parts') ? '20000000' : '0', estimatedTotalFeeAtomic: '3000' }
    return stakingDraft
  },
  stakingConfirm: (id) => {
    if (query.has('staking-confirm-error')) throw new Error('The preview expired. Review the transaction again.')
    if (!stakingDraft || stakingDraft.draftId !== id) throw new Error('Stale preview')
    const state = query.has('staking-rejected') ? 'rejected' : query.has('staking-conflict') && stakingDraft.kind === 'withdrawal' ? 'conflict' : query.has('staking-confirmed') ? 'confirmed' : 'pending'
    if (stakingDraft.recoveryOf) stakingOperations.find((op) => op.id === stakingDraft.recoveryOf).autoRetry = false
    stakingOperations.push({ ...stakingDraft, id, state, txid: 'ad'.repeat(32), createdAt: Date.now(),
      message: state === 'conflict' ? 'The inputs were spent by another transaction. Refresh and review a new operation.'
        : state === 'rejected' ? 'The saved transaction exceeds the 2 MiB sending limit. It was not sent. Review a smaller part.' : undefined })
    if (stakingDraft.kind === 'funding' && !stakingDraft.recoveryOf && (state === 'pending' || state === 'confirmed')) {
      stakingInbox.push({ address: stakingDraft.address, amount: BigInt(stakingDraft.amountAtomic), confirmed: state === 'confirmed' })
    }
    stakingDraft = null
    return { operationId: id, txid: 'ad'.repeat(32), state }
  },
  stakingSetAutoRetry: (id, enabled) => { stakingOperations.find((op) => op.id === id).autoRetry = enabled },
  stakingBuildRecovery: (id) => {
    const original = stakingOperations.find((op) => op.id === id)
    stakingDraft = { ...original, draftId: `recovery-${stakingOperations.length}`, recoveryOf: id, kind: 'withdrawal',
      algo: original.algo ?? 'ecdsa', sourceLabel: original.address, inputAlgorithms: original.inputAlgorithms ?? ['ecdsa'],
      inputCount: 1, sizeUpperBound: 300, remainingParts: 0, remainingAtomic: '0', estimatedTotalFeeAtomic: '2000',
      destination: 'ordinary-recovery-address', amountAtomic: '99998000', feeAtomic: '2000', changeAtomic: '0' }
    return stakingDraft
  },
  stakingRetry: (id) => ({ operationId: id, txid: 'ad'.repeat(32), state: 'pending' }),
  upgradeInfo: () => ({ enabled: true, minConvertValueSat: '10000' }),
  upgradeStatus: () => ({
    stagingAddress: 'staging-test-address', stagingIndex: 0,
    confirmedBalanceSat: query.has('pending') ? '0' : '100000000',
    pendingBalanceSat: query.has('pending') && window.walletUiTest.depositAvailable ? '100000000' : '0',
    episodes: query.has('credits') ? [{ ...conversion, credit: window.walletUiTest.creditState === 'received' ? conversionCredit : { state: window.walletUiTest.creditState } }] : [],
  }),
  upgradePlan: (request) => ({ sendValueSat: request.mode === 'all' ? '99999000' : request.amountSat, feeSat: '1000', changeValueSat: '0', feeRate: 1, foldedChange: false }),
  upgradeConvert: () => { throw new Error('Nothing to convert: no BTC available on the staging address.') },
  downgradeInfo: () => ({ enabled: true }),
  downgradeStatus: () => [],
  downgradePlan: (amountAtomic) => ({ amountAtomic, feeAtomic: '1000', estimatedBtcSat: '10000', level: 1 }),
  buildSend: (recipient, amountAtomic, outpoints) => {
    if (unresolved) throw Object.assign(new Error('Resolve the previous submission before building another transaction.'), { name: 'SendUncertainError' })
    const future = outpoints?.includes('dd:0')
    if (BigInt(amountAtomic) + 1000n > (future ? 200000000n : 100000000n)) throw new Error('Not enough balance to cover this amount plus the network fee.')
    return { recipient, amountAtomic, feeAtomic: '1000', totalAtomic: (BigInt(amountAtomic) + 1000n).toString(), changeAtomic: '0', signature: 'ECDSA', ...(future ? { maturesAt } : {}) }
  },
  confirmSend: () => {
    if (submissions++ === 0 && ['rejected', 'unknown'].includes(query.get('submission'))) {
      unresolved = query.get('submission') === 'unknown'
      throw Object.assign(new Error(unresolved ? 'The submission status is unknown.' : 'The node rejected this transaction.'), { name: unresolved ? 'SendUncertainError' : 'SendNeedsReviewError' })
    }
    unresolved = false
    return { txid: 'ab'.repeat(32) }
  },
  buildTokenSend: (tokenId, recipient, tokenAmountAtomic) => ({ tokenId, recipient, tokenAmountAtomic, feeAtomic: '1000', signature: 'ECDSA' }),
  maxSendable: () => ({ amountAtomic: '99999000', feeAtomic: '1000' }),
  inspectKey: () => ({ candidates: ['ecdsa'], addresses: { ecdsa: address }, delegatePubkeyhash: 'synthetic-delegate-public-hash' }),
  sweepScan: () => ({ address, balanceAtomic: '300000000', availableAtomic: '100000000', maturingAtomic: '200000000', nextMaturesAt: maturesAt, delegatePubkeyhash: 'synthetic-delegate-public-hash' }),
  sweepCancel: () => {},
  sweepBuild: (recipient, amountAtomic, sendMax) => methods.buildSend(recipient, sendMax ? '99999000' : amountAtomic),
  sweepConfirm: () => methods.confirmSend(),
}
export const wallet = Object.fromEntries(Object.entries(methods).map(([method, fn]) => [method, async (...args) => {
  calls.push({ method, args })
  return fn(...args)
}]))
wallet.onStatusChanged = () => () => {}
