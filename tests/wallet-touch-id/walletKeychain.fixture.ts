import { app } from 'electron'
import type { WalletKeychain } from '../../src/main/touchId/wallet'
import type { Availability } from '../../src/shared/touchIdProbe'

const data = process.env.WALLET_E2E_ROOT
if (!data) throw new Error('An isolated wallet test directory is required.')
app.setPath('appData', data)
const items = new Map<string, Buffer>()
let nextResult: 'denied' | 'cancelled' | 'lockout' | undefined
let availability: Availability = 'available'
let enrollment = '26:' + 'a'.repeat(64)
app.on('test-wallet-deny' as never, () => { nextResult = 'denied' })
app.on('test-wallet-cancel' as never, () => { nextResult = 'cancelled' })
app.on('test-wallet-final-attempt' as never, () => { nextResult = 'lockout' })
app.on('test-wallet-lockout' as never, () => { availability = 'lockout' })
app.on('test-wallet-available' as never, () => { availability = 'available' })
app.on('test-wallet-unavailable' as never, () => { availability = 'unavailable' })
app.on('test-wallet-new-enrollment' as never, () => { enrollment = '26:' + 'b'.repeat(64) })
export function openWalletKeychain(): WalletKeychain {
  return {
    availability: () => ({ availability, enrollment: availability === 'available' ? enrollment : undefined }),
    cancel() {},
    async run(action, id, key) {
      if (action === 'create' && key) items.set(id, Buffer.from(key))
      if (action === 'cleanup') { items.get(id)?.fill(0); items.delete(id) }
      if (action !== 'read' && action !== 'verify') return { kind: 'ok', enrollment }
      if (nextResult) {
        const kind = nextResult
        nextResult = undefined
        if (kind === 'lockout') availability = 'lockout'
        return { kind }
      }
      const saved = items.get(id)
      if (!saved) return { kind: 'missing' }
      return action === 'verify' ? { kind: 'ok' } : { kind: 'ok', key: Buffer.from(saved), enrollment }
    },
  }
}
