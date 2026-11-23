import { app, BrowserWindow, ipcMain, powerMonitor, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { WALLET_TOUCH_ID_CHANNEL } from '../../shared/walletTouchId'
import type { WalletCore } from '../vault'
import type { WalletIpcOptions } from '../ipc/router'
import { TEST_BUILD } from '../testBuild'
import { onSessionChange } from './lifetime'
import { ProbeFile } from './storage'
import { WalletTouchId } from './wallet'
import { openWalletKeychain } from './walletKeychain'

export async function registerWalletTouchId(core: WalletCore, knownWindow: (win: BrowserWindow) => boolean, url: string): Promise<WalletIpcOptions['afterPasswordEntry']> {
  const { vault, vaultStorage } = core
  let device: WalletTouchId | undefined
  if (!TEST_BUILD || core.network === 'testnet') {
    try {
      const native = openWalletKeychain()
      if (native) {
        const controller = new WalletTouchId(new ProbeFile(join(core.dataRoot, 'touch-id-unlock.json')), native, vault, () => {
          try {
            const state = powerMonitor.getSystemIdleState(1)
            return state === 'active' || state === 'idle'
          } catch { return false }
        }, () => vaultStorage.read())
        vaultStorage.beforeReplace = () => controller.credentialsChanging()
        device = controller
        await controller.recover(await vaultStorage.read())
      }
    } catch { console.warn('Touch ID initialization needs attention. Password unlock is available.') }
  }

  if (device) {
    const controller = device
    onSessionChange(powerMonitor, () => { controller.cancel(); vault.lock() })
    vault.on(event => {
      if (event.type === 'locked' || event.type === 'destroyed') controller.cancel()
    })
    app.on('before-quit', () => controller.cancel())
    app.on('browser-window-created', (_event, win) => {
      const cancel = () => controller.cancel()
      win.on('hide', cancel)
      win.on('minimize', cancel)
      win.on('close', cancel)
      win.webContents.on('render-process-gone', cancel)
      win.webContents.on('did-start-navigation', (_e, _url, _same, mainFrame) => { if (mainFrame) cancel() })
    })
  }
  function sender(event: IpcMainInvokeEvent) {
    const frame = event.senderFrame
    const contents = event.sender
    const win = BrowserWindow.fromWebContents(contents)
    const trusted = () => !!win && !win.isDestroyed() && knownWindow(win) && !contents.isDestroyed() &&
      frame !== null && contents.mainFrame === frame && frame.url === url
    const focused = () => trusted() && win!.isFocused() && win!.isVisible() && !win!.isMinimized()
    return { frame, trusted, focused }
  }
  ipcMain.handle(WALLET_TOUCH_ID_CHANNEL, async (event, command: unknown, password?: unknown) => {
    const { frame, trusted, focused } = sender(event)
    if (!frame || !trusted()) throw new Error('Invalid Touch ID request.')
    if (command === 'status') return device?.status(frame) ?? { availability: 'unavailable', needsSetup: false, enabled: false, offer: false, entryReady: false }
    if (!device) throw new Error('Touch ID is unavailable. Use your wallet password.')
    if (command === 'cancel') return device.cancel()
    if (!focused()) throw new Error('Focus the wallet window first.')
    switch (command) {
      case 'later': return device.defer()
      case 'disable':
        if (password === undefined || (typeof password === 'string' && password.length > 0)) return device.disable(frame, focused, password)
        break
      case 'unlock': return device.unlock(focused)
      case 'enableAtEntry': return device.enableAtEntry(frame, focused)
      case 'enable':
        if (typeof password === 'string' && password.length > 0 && password.length <= 4096) return device.enable(password, focused)
    }
    throw new Error('Invalid Touch ID request.')
  })
  const controller = device
  if (controller) return event => {
    // An unlock call in an already-open session only refreshes its timer.
    if (vault.isUnlocked()) return
    const { frame, focused } = sender(event)
    if (frame && focused()) return async password => { await controller.prepareEntry(password, frame, focused) }
  }
}
