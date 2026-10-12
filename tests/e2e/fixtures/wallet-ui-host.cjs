/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports -- Test-only Electron bootstrap. */
const { app, BrowserWindow, session } = require('electron')
app.setPath('userData', process.argv[3])
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('devtools:') }))
  const window = new BrowserWindow({ width: 1200, height: 900, webPreferences: { sandbox: true } })
  window.loadFile(process.argv[2], { search: process.argv[4] ?? '' })
})
app.on('window-all-closed', () => app.quit())
