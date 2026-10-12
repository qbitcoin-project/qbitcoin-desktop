/* global document */
import './bridge-mock'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { WalletShell } from '../../../src/renderer/screens/WalletShell'
import { brand } from '../../../src/renderer/brand'
import '../../../src/renderer/styles/app.css'

// Exercise both conversion directions on the neutral profile. These fixtures
// never enter the production build and never contact a chain or hold keys.
brand.upgrade = { sourceCoinLabel: { mainnet: 'BTC', testnet: 'tBTC' }, sourceExplorerTxUrl: null }
createRoot(document.getElementById('root')).render(createElement(WalletShell))
