/* global window */
// No protected actions are available in this renderer-only test window.
window.privacy = {
  getCaptureStatus: async () => ({ ok: true, value: 'error' }),
  cleared: async () => ({ ok: true }),
  onRevoked: () => () => {},
}
window.updater = { onEvent: () => () => {} }
