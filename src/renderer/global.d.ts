import type { UpdaterApi, WalletApi } from '../shared/protocol'
import type { PrivacyApi } from '../shared/privacy'
import type { BridgeApi } from '../shared/bridge'
import type { AppNavigationApi } from '../shared/appNavigation'
import type { WalletTouchIdApi } from '../shared/walletTouchId'

// The preload exposes exactly this on the renderer's window (contextBridge).
declare global {
  interface Window {
    readonly walletTouchId?: WalletTouchIdApi
    readonly wallet: BridgeApi<WalletApi>
    readonly updater: UpdaterApi
    readonly privacy: BridgeApi<PrivacyApi>
    readonly appNavigation: AppNavigationApi
  }
}

export {}
