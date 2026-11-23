import type { EventEmitter } from 'node:events'
import { performance } from 'node:perf_hooks'

export const REQUEST_MS = 30_000
export const SESSION_IDLE_MS = 5 * 60_000

const powerEvents = ['lock-screen', 'unlock-screen', 'suspend', 'resume', 'user-did-resign-active', 'user-did-become-active'] as const
export function onSessionChange(monitor: Pick<EventEmitter, 'on' | 'off'>, interrupt: (reason: string) => void): () => void {
  const detach = powerEvents.map(event => {
    const listener = () => interrupt(event)
    monitor.on(event, listener)
    return () => monitor.off(event, listener)
  })
  return () => detach.forEach(remove => remove())
}

// Check again at commit: a sleeping or stalled event loop may receive a
// native reply before it gets around to dispatching its timers.
export function watchRequest(screenAvailable: () => boolean, revoke: (reason: string) => void, durationMs = REQUEST_MS) {
  const started = Date.now()
  const monotonicStart = performance.now()
  let lastCheck = started
  let live = true
  const timer = setInterval(check, 250)
  const remainingMs = () => Math.max(0, Math.ceil(durationMs - Math.max(Date.now() - started, performance.now() - monotonicStart)))
  function stop(): void { live = false; clearInterval(timer) }
  function check(): boolean {
    if (!live) return false
    const now = Date.now()
    let reason: string
    if (now < lastCheck || now - lastCheck > 3_000) reason = 'screen-monitor-interrupted'
    else if (!screenAvailable()) reason = 'screen-locked-or-unknown'
    else if (!remainingMs()) reason = 'request-timeout'
    else { lastCheck = now; return true }
    stop()
    revoke(reason)
    return false
  }
  return { check, stop, remainingMs }
}
