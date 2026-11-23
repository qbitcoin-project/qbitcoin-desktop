import { app, BrowserWindow, dialog, ipcMain, powerMonitor, session, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PROBE_COMMAND, PROBE_STATE, type Command } from '../../shared/touchIdProbe'
import { ProbeController, type NativeProbe } from './controller'
import { ProbeFile } from './storage'
import { onSessionChange, REQUEST_MS, SESSION_IDLE_MS } from './lifetime'
import { ProbeLogFile } from './log'

declare const __TEST_BUILD__: { dataDirName: string }
const root = join(app.getPath('appData'), __TEST_BUILD__.dataDirName, 'touch-id-prototype')
mkdirSync(root, { recursive: true })
app.setPath('userData', root)
app.setPath('sessionData', root)
const html = join(__dirname, '../renderer/index.html')
const url = pathToFileURL(html).href
const methods = new Set(['status', 'later', 'enroll', 'reset', 'unlock', 'lock', 'cancel', 'password', 'back', 'silent', 'prepare', 'showLog'])

function valid(value: unknown): value is Command | 'showLog' {
  if (typeof value === 'string') return methods.has(value)
  if (!value || typeof value !== 'object') return false
  const { action, draftId } = value as Record<string, unknown>
  return (action === 'approve' || action === 'replaceDuringApproval') && Number.isSafeInteger(draftId)
}

async function start(): Promise<void> {
  const log = new ProbeLogFile(join(root, 'touch-id-test.log'))
  log.write('start', { format: 1, version: app.getVersion(), macOS: process.getSystemVersion(), arch: process.arch,
    electron: process.versions.electron, requestMs: REQUEST_MS, sessionMs: SESSION_IDLE_MS })
  const native: NativeProbe = createRequire(__filename)(join(process.resourcesPath, 'touch-id-probe.node'))
  const win = new BrowserWindow({
    title: 'Touch ID prototype', width: 870, height: 780, minWidth: 560, minHeight: 530, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
  })
  const contents = win.webContents
  const controller = new ProbeController(native, new ProbeFile(join(root, 'binding.json')), state => {
    if (!contents.isDestroyed() && contents.getURL() === url) contents.send(PROBE_STATE, state)
  }, () => {
    try {
      const screen = powerMonitor.getSystemIdleState(1)
      if (screen === 'active' || screen === 'idle') return true
      log.write('screen-check', { state: screen })
    } catch { log.write('screen-check', { state: 'unavailable' }) }
    return false
  }, log.write)
  const lock = (reason: string) => controller.interrupt(true, reason)
  let idle: ReturnType<typeof setTimeout> | undefined
  const activity = () => { clearTimeout(idle); idle = setTimeout(() => lock('session-idle'), SESSION_IDLE_MS) }
  const currentWindow = () => !win.isDestroyed() && win.isVisible() && !win.isMinimized()
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', e => e.preventDefault())
  contents.on('did-start-navigation', (_e, _url, _sameDocument, mainFrame) => { if (mainFrame && contents.getURL()) lock('navigation') })
  contents.on('render-process-gone', () => lock('renderer-gone'))
  win.on('hide', () => lock('window-hide'))
  win.on('minimize', () => lock('window-minimize'))
  win.on('close', () => lock('window-close'))
  win.on('blur', () => log.write('window-blur'))
  win.on('focus', () => log.write('window-focus'))
  const detachPower = onSessionChange(powerMonitor, lock)
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  ipcMain.handle(PROBE_COMMAND, async (event, command: unknown) => {
    const frame = event.senderFrame
    const trusted = () => !contents.isDestroyed() && event.sender === contents && frame !== null &&
      contents.mainFrame === frame && frame.url === url
    if (!trusted() || !valid(command)) throw new Error('Invalid prototype request.')
    if (command !== 'status' && command !== 'lock' && command !== 'cancel' && (!currentWindow() || !win.isFocused())) throw new Error('Focus the test window first.')
    if (command === 'showLog') {
      if (!log.available) throw new Error('The test log could not be written.')
      shell.showItemInFolder(log.path)
      return controller.state()
    }
    if (command !== 'status' && !controller.isBusy) activity()
    return controller.run(command, async () => {
      // The system sheet can relinquish focus just after delivering its result.
      for (let count = 0; count < 12 && trusted() && currentWindow() && !win.isFocused(); count++) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      return trusted() && currentWindow() && win.isFocused()
    })
  })
  win.on('closed', () => {
    clearTimeout(idle)
    ipcMain.removeHandler(PROBE_COMMAND)
    detachPower()
  })
  await controller.recover()
  await win.loadFile(html)
  win.show()
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus())
  app.on('window-all-closed', () => app.quit())
  void app.whenReady().then(start).catch(error => {
    dialog.showErrorBox('Touch ID prototype', error instanceof Error ? error.message : 'Could not start the test application.')
    app.quit()
  })
}
