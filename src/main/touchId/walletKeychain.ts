import { app } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { WalletKeychain } from './wallet'

export function openWalletKeychain(): WalletKeychain | undefined {
  if (process.platform === 'darwin' && app.isPackaged) {
    return createRequire(__filename)(join(process.resourcesPath, 'touch-id-wallet.node'))
  }
}
