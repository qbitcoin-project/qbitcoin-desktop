/* global window, URLSearchParams */
const query = new URLSearchParams(window.location.search)
const address = 'classical-test-address'
const coin = { outpoint: 'aa:0', address, valueAtomic: '100000000', confirmations: 10, algo: 'ecdsa', frozen: false }
const token = { id: 'token-test', name: 'Test Token', symbol: 'TOK', decimals: 2, amountAtomic: '500' }
const maturesAt = Math.floor(Date.now() / 1000) + 3600
const maturingCoins = query.has('maturity') ? [
  { ...coin, outpoint: 'dd:0', valueAtomic: '200000000', maturesAt, label: 'Maturing stake' },
  { ...coin, outpoint: 'ee:0', valueAtomic: '0', tokenId: token.id, tokenAmountAtomic: '700', maturesAt },
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
const methods = {
  getNode: () => ({ network: 'mainnet', selected: 'public', publicNodes: [], customNodes: [], tor: false, hasAuth: false }),
  nodeStatus: () => ({ url: '', reachable: false }),
  getSnapshot: () => null,
  listWallets: () => wallets,
  getSummary: () => ({ balanceAtomic: '100000000', addressCount: 1 }),
  getHistory: () => ({ items: query.has('notes') ? [{ ...transaction }] : [], hasMore: false }),
  getTxDetail: () => ({ txid: transaction.txid, confirmations: 10, sizeBytes: 200, totalInAtomic: '100001000', totalOutAtomic: '100000000', feeAtomic: '1000', inputs: [], outputs: [] }),
  setTxLabel: (_txid, label) => { transaction.label = label || undefined },
  setCoinLabel: () => {},
  listContacts: () => [],
  listTokens: () => [token],
  listCoins: () => [coin, { ...coin, outpoint: 'bb:0', valueAtomic: '900000000', frozen: true },
    { ...coin, outpoint: 'cc:0', valueAtomic: '0', tokenId: token.id, tokenAmountAtomic: token.amountAtomic }, ...maturingCoins],
  getReceiveAddress: (algo = 'ecdsa') => algo === 'falcon512' ? 'falcon-test-address' : address,
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
