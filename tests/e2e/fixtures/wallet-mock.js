/* global window, URLSearchParams */
const query = new URLSearchParams(window.location.search)
const address = 'classical-test-address'
const coin = { outpoint: 'aa:0', address, valueAtomic: '100000000', confirmations: 10, algo: 'ecdsa', frozen: false }
const token = { id: 'token-test', name: 'Test Token', symbol: 'TOK', decimals: 2, amountAtomic: '500' }
const wallets = [{ id: 'main', label: 'Main Wallet', kind: 'seed', active: true, canSign: true, removable: false, address }]
const calls = []
window.walletUiTest = { calls }
const methods = {
  getNode: () => ({ network: 'mainnet', selected: 'public', publicNodes: [], customNodes: [], tor: false, hasAuth: false }),
  nodeStatus: () => ({ url: '', reachable: false }),
  getSnapshot: () => null,
  listWallets: () => wallets,
  getSummary: () => ({ balanceAtomic: '100000000', addressCount: 1 }),
  getHistory: () => ({ items: [], hasMore: false }),
  listContacts: () => [],
  listTokens: () => [token],
  listCoins: () => [coin, { ...coin, outpoint: 'bb:0', valueAtomic: '900000000', frozen: true }],
  getReceiveAddress: (algo = 'ecdsa') => algo === 'falcon512' ? 'falcon-test-address' : address,
  upgradeInfo: () => ({ enabled: true, minConvertValueSat: '10000' }),
  upgradeStatus: () => ({ stagingAddress: 'staging-test-address', stagingIndex: 0, confirmedBalanceSat: query.has('pending') ? '0' : '100000000', pendingBalanceSat: query.has('pending') ? '100000000' : '0', episodes: [] }),
  upgradePlan: (request) => ({ sendValueSat: request.mode === 'all' ? '99999000' : request.amountSat, feeSat: '1000', changeValueSat: '0', feeRate: 1, foldedChange: false }),
  downgradeInfo: () => ({ enabled: true }),
  downgradeStatus: () => [],
  downgradePlan: (amountAtomic) => ({ amountAtomic, feeAtomic: '1000', estimatedBtcSat: '10000', level: 1 }),
  buildSend: (recipient, amountAtomic) => {
    if (BigInt(amountAtomic) + 1000n > 100000000n) throw new Error('Not enough balance to cover this amount plus the network fee.')
    return { recipient, amountAtomic, feeAtomic: '1000', totalAtomic: (BigInt(amountAtomic) + 1000n).toString(), changeAtomic: '0', signature: 'ECDSA' }
  },
  buildTokenSend: (tokenId, recipient, tokenAmountAtomic) => ({ tokenId, recipient, tokenAmountAtomic, feeAtomic: '1000', signature: 'ECDSA' }),
  maxSendable: () => ({ amountAtomic: '99999000', feeAtomic: '1000' }),
}
export const wallet = Object.fromEntries(Object.entries(methods).map(([method, fn]) => [method, async (...args) => {
  calls.push({ method, args })
  return fn(...args)
}]))
wallet.onStatusChanged = () => () => {}
