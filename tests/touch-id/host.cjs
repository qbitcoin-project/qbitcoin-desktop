/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports -- Test-only Electron bootstrap. */
const { app, shell } = require('electron')
const { writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const Module = require('node:module')

let hold = false
let reply
const digest = '74'.repeat(32)
const native = {
  availability: () => 'available',
  cancel() {}, // Deliberately deliver a successful native reply after cancellation.
  async run(action) {
    if (action === 'create') return { kind: 'ok', code: 0, digest }
    if (action === 'silent') return { kind: 'interactionRequired', code: -25308 }
    if (action === 'read' && hold) {
      hold = false
      await new Promise(resolve => { reply = resolve })
    }
    return { kind: 'ok', code: 0 }
  },
}
const load = Module._load
Module._load = function (id, ...args) {
  if (id === join(process.resourcesPath, 'touch-id-probe.node')) return native
  return load.call(this, id, ...args)
}
app.on('probe-test-hold', () => { hold = true })
app.on('probe-test-reply', () => { reply() })
app.setPath('appData', process.env.PROBE_TEST_ROOT)
shell.showItemInFolder = file => writeFileSync(join(process.env.PROBE_TEST_ROOT, 'revealed.txt'), file)
require(resolve('dist/touch-id-app/main/index.js'))
