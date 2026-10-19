import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UPDATE_INSTALL_CHANNEL } from '../../src/shared/protocol'

const mocks = vi.hoisted(() => ({
  app: { isPackaged: true, getVersion: () => '1.0.0' },
  ipcOn: vi.fn(),
  dialog: { showMessageBox: vi.fn().mockResolvedValue({}), showErrorBox: vi.fn() },
  updater: {
    autoDownload: false, autoInstallOnAppQuit: false,
    on: vi.fn(), off: vi.fn(), quitAndInstall: vi.fn(), checkForUpdates: vi.fn().mockResolvedValue(null),
  },
}))
vi.mock('electron', () => ({
  app: mocks.app, ipcMain: { on: mocks.ipcOn }, dialog: mocks.dialog,
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('electron-updater', () => ({ autoUpdater: mocks.updater }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.app.isPackaged = true
  mocks.updater.autoDownload = false
  mocks.updater.autoInstallOnAppQuit = false
})
afterEach(() => vi.unstubAllGlobals())

describe('updater build isolation', () => {
  it('does not check, download, or register an install handler in a packaged test build', async () => {
    vi.stubGlobal('__TEST_BUILD__', { productName: 'Fixture Wallet Test', dataDirName: 'fixture-wallet-test' })
    const { initAutoUpdater, checkForUpdatesInteractive } = await import('../../src/main/updater')
    initAutoUpdater()
    await checkForUpdatesInteractive()
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
    expect(mocks.updater.on).not.toHaveBeenCalled()
    expect(mocks.updater.autoDownload).toBe(false)
    expect(mocks.updater.autoInstallOnAppQuit).toBe(false)
    expect(mocks.ipcOn).not.toHaveBeenCalled()
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
    expect(mocks.dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ message: 'Updates are disabled in this test build.' }))
  })

  it('keeps update checks and install handling for packaged stable builds', async () => {
    vi.stubGlobal('__TEST_BUILD__', null)
    const { initAutoUpdater } = await import('../../src/main/updater')
    initAutoUpdater()
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(mocks.updater.autoDownload).toBe(true)
    expect(mocks.updater.autoInstallOnAppQuit).toBe(true)
    const registration = mocks.ipcOn.mock.calls.find(([name]) => name === UPDATE_INSTALL_CHANNEL)
    expect(registration).toBeDefined()
    registration![1]()
    expect(mocks.updater.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('does not access the update feed or install handler in development', async () => {
    vi.stubGlobal('__TEST_BUILD__', null)
    mocks.app.isPackaged = false
    const { initAutoUpdater, checkForUpdatesInteractive } = await import('../../src/main/updater')
    initAutoUpdater()
    await checkForUpdatesInteractive()
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
    expect(mocks.ipcOn).not.toHaveBeenCalled()
  })
})
