import { useEffect, useState, type ReactNode } from 'react'
import type { AddressAlgo, TokenBalance } from '../../shared/protocol'
import { brand } from '../brand'
import { WalletSwitcher } from '../components/WalletSwitcher'
import { wallet } from '../lib/wallet'
import { assetLabelFor } from '../lib/brandLabels'
import { hydrateFromSnapshot, loadWallets, refreshAll, useActiveWallet, useBuildNetwork, useSummary } from '../lib/walletData'
import { Alert, ActivityIcon, BoltIcon, CoinsIcon, InfoIcon, LockIcon, ReceiveIcon, RefreshIcon, SendIcon, SettingsIcon, Sidebar, StakingIcon, WalletIcon, type NavItem } from '../ui'
import { Activity } from './Activity'
import { Coins } from './Coins'
import { Convert } from './Convert'
import { Receive } from './Receive'
import { Send } from './Send'
import { Settings } from './Settings'
import { WalletHome } from './WalletHome'
import { Staking } from './Staking'

// The unlocked app shell: a persistent sidebar + a content area that swaps panes.
// Replaces the earlier full-screen-with-back-button model. `preselected` carries
// coins chosen on the Coins pane into the Send pane.
type Nav = 'wallet' | 'send' | 'receive' | 'convert' | 'staking' | 'activity' | 'coins' | 'settings'

const NAV: NavItem[] = [
  { id: 'wallet', label: 'Wallet', icon: <WalletIcon /> },
  { id: 'send', label: 'Send', icon: <SendIcon /> },
  { id: 'receive', label: 'Receive', icon: <ReceiveIcon /> },
  { id: 'activity', label: 'Activity', icon: <ActivityIcon /> },
  { id: 'coins', label: 'Coins', icon: <CoinsIcon /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
]

// The Convert entry appears only when the brand ships an upgrade flow AND main
// confirms it for the active wallet (seed + consensus params) — see below.
const CONVERT_NAV: NavItem = { id: 'convert', label: 'Convert', icon: <BoltIcon /> }

// Header copy per pane. Two subtitles name coins whose tickers are
// per-network (tCOIN, tBTC), so this is a function of the build network
// instead of a constant; mainnet stands in until main reports the network.
function pageMeta(network: 'mainnet' | 'testnet' | null): Record<Nav, { title: string; subtitle: string }> {
  const asset = assetLabelFor(network)
  const source = brand.upgrade?.sourceCoinLabel[network ?? 'mainnet'] ?? 'BTC'
  return {
    wallet: { title: 'Wallet', subtitle: `Your ${brand.assetName} balance and recent activity` },
    send: { title: 'Send', subtitle: `Send ${asset} to any address` },
    receive: { title: 'Receive', subtitle: 'Share your address to get paid' },
    convert: { title: 'Convert', subtitle: `Turn ${source} into ${asset}` },
    staking: { title: 'Staking', subtitle: 'Delegate coins and manage their return' },
    activity: { title: 'Activity', subtitle: 'Every transaction on this wallet' },
    coins: { title: 'Coins', subtitle: 'Manage your unspent outputs (UTXOs)' },
    settings: { title: 'Settings', subtitle: 'Manage your wallet and security' },
  }
}

export function WalletShell({ collapsed = false }: { collapsed?: boolean }) {
  const [nav, setNav] = useState<Nav>('wallet')
  const [receiveAlgo, setReceiveAlgo] = useState<AddressAlgo>('ecdsa')
  const [preselected, setPreselected] = useState<readonly string[]>([])
  const buildNet = useBuildNetwork()
  // Which asset the Send pane composes. null = native coin (the sidebar/hero Send,
  // and coin-control); a token when opened from the Tokens panel.
  const [sendToken, setSendToken] = useState<TokenBalance | null>(null)
  const { data: summary } = useSummary()
  const [stakingFunding, setStakingFunding] = useState(false)
  const [stakingEnabled, setStakingEnabled] = useState(false)
  const [stakingRefresh, setStakingRefresh] = useState(0)
  const [stakingHelp, setStakingHelp] = useState(0)

  // The shell mounts on unlock: paint the last-known snapshot instantly while the
  // live reads refresh in the background.
  useEffect(() => {
    void hydrateFromSnapshot()
    void loadWallets()
  }, [])

  // Convert is double-gated: the brand must ship an upgrade flow (static) and
  // main must confirm it for the active wallet (seed wallets only).
  const [convertEnabled, setConvertEnabled] = useState(false)
  const activeWalletId = useActiveWallet()?.id
  useEffect(() => {
    let alive = true
    setStakingEnabled(false); setStakingFunding(false)
    void wallet.stakingInfo().then((info) => { if (alive) { setStakingEnabled(info.enabled); setStakingFunding(info.enabled && info.fundingEnabled) } }).catch(() => {})
    return () => { alive = false }
  }, [activeWalletId])
  useEffect(() => {
    if (brand.upgrade === null) return
    let alive = true
    wallet
      .upgradeInfo()
      .then((info) => {
        if (alive) setConvertEnabled(info.enabled)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // Re-probe when the active wallet changes: the flow is per wallet (a
    // watch or key wallet has none), and a stale gate left Convert reachable
    // after a switch.
  }, [activeWalletId])

  useEffect(() => {
    setPreselected([])
    setSendToken(null)
  }, [activeWalletId])

  const navItems = [...NAV.slice(0, 3), ...(stakingEnabled ? [{ id: 'staking', label: 'Staking', icon: <StakingIcon /> }] : []),
    ...(convertEnabled ? [CONVERT_NAV] : []), ...NAV.slice(3)]
  useEffect(() => {
    if (!convertEnabled && nav === 'convert') setNav('wallet')
    if (!stakingEnabled && nav === 'staking') setNav('wallet')
  }, [convertEnabled, stakingEnabled, nav])

  function go(to: Nav): void {
    if (to === 'receive') setReceiveAlgo('ecdsa')
    // A plain navigation to Send (sidebar or hero) always means a native coin send.
    if (to === 'send') {
      setPreselected([])
      setSendToken(null)
    }
    setNav(to)
  }

  let pane: ReactNode
  switch (nav) {
    case 'send':
      pane = <Send onUnstake={stakingEnabled ? () => go('staking') : undefined} preselected={preselected} token={sendToken} onDone={() => go('wallet')} />
      break
    case 'receive':
      pane = <Receive key={receiveAlgo} initialAlgo={receiveAlgo} />
      break
    case 'staking':
      pane = <Staking refreshKey={stakingRefresh} helpKey={stakingHelp} />
      break
    case 'convert':
      pane = <Convert />
      break
    case 'activity':
      pane = <Activity />
      break
    case 'coins':
      pane = (
        <Coins
          onSendSelected={(outpoints) => {
            setPreselected(outpoints)
            setSendToken(null)
            setNav('send')
          }}
        />
      )
      break
    case 'settings':
      pane = <Settings />
      break
    default:
      pane = (
        <WalletHome
          onSend={() => go('send')}
          onReceive={() => go('receive')}
          onStake={stakingFunding ? () => go('staking') : undefined}
          onReceiveFalcon={() => { setReceiveAlgo('falcon512'); setNav('receive') }}
          onSeeAll={() => setNav('activity')}
          onSendToken={(t) => {
            setPreselected([])
            setSendToken(t)
            setNav('send')
          }}
        />
      )
  }

  const footer = (
    <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <button type="button" className="nav-item" data-collapsed={collapsed ? 'true' : undefined} onClick={() => void wallet.lock()} aria-label={collapsed ? 'Lock wallet' : undefined} title={collapsed ? 'Lock wallet' : undefined}>
        <span style={{ display: 'flex', width: 20, flex: 'none', justifyContent: 'center' }}>
          <LockIcon size={18} />
        </span>
        {!collapsed && 'Lock wallet'}
      </button>
    </div>
  )

  const meta = pageMeta(buildNet)[nav]

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <Sidebar items={navItems} active={nav} onNavigate={(id) => go(id as Nav)} footer={footer} collapsed={collapsed} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
        <header className="content-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="content-title">{meta.title}</h1>
            <div className="content-subtitle">{meta.subtitle}</div>
          </div>
          <WalletSwitcher />
          {nav === 'staking' && <button type="button" className="content-refresh" onClick={() => setStakingHelp((n) => n + 1)}>
            <InfoIcon size={16} />
            How it works
          </button>}
          <button type="button" className="content-refresh" onClick={() => { refreshAll(); if (nav === 'staking') setStakingRefresh((n) => n + 1) }} title="Refresh">
            <RefreshIcon size={16} />
            Refresh
          </button>
        </header>
        {summary?.readWarning && <Alert variant="warning">{summary.readWarning}</Alert>}
        <div key={activeWalletId ?? 'none'} style={{ flex: 1, minHeight: 0 }}>
          {pane}
        </div>
      </div>
    </div>
  )
}
