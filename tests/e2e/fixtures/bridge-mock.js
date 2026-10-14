/* global window, URLSearchParams */
// The optional sweep case only accepts synthetic fixture data, with no main process API.
const sweep = new URLSearchParams(window.location.search).has('sweep')
window.privacy = {
  getCaptureStatus: async () => ({ ok: true, value: sweep ? 'best-effort' : 'error' }),
  begin: async () => ({ ok: true, value: { sessionId: 'fixture-session', deadline: Date.now() + 120000 } }),
  end: async () => ({ ok: true }),
  cleared: async () => ({ ok: true }),
  onRevoked: () => () => {},
}
window.updater = { onEvent: () => () => {} }
