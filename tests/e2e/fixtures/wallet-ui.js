/* global document, window, URLSearchParams */
import './bridge-mock'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { WalletShell } from '../../../src/renderer/screens/WalletShell'
import { SendFromKeyDialog } from '../../../src/renderer/components/SendFromKeyDialog'
import { brand } from '../../../src/renderer/brand'
import '../../../src/renderer/styles/app.css'

// Exercise both conversion directions with a mock API. These fixtures
// never enter the production build and never contact a chain or hold keys.
brand.upgrade = { sourceCoinLabel: { mainnet: 'BTC', testnet: 'tBTC' }, sourceExplorerTxUrl: null }
const query = new URLSearchParams(window.location.search)
if (query.has('credits')) {
  brand.upgrade.sourceExplorerTxUrl = { mainnet: 'https://source.example/tx/', testnet: 'https://source-test.example/tx/' }
  brand.explorerTxUrl = query.has('no-explorer') ? null : 'https://native.example/tx/'
}
createRoot(document.getElementById('root')).render(query.has('sweep') ? createElement(SendFromKeyDialog, { open: true, onClose: () => {} }) : createElement(WalletShell))
