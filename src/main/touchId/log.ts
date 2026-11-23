import { appendFileSync, renameSync, statSync } from 'node:fs'

export type ProbeLog = (event: string, fields?: Record<string, string | number | boolean>) => void

export class ProbeLogFile {
  available = false
  constructor(readonly path: string) {}

  // Only main supplies event names and fields. Never serialize IPC payloads,
  // native results, enrollment IDs, digests or exception messages.
  write: ProbeLog = (event, fields) => {
    try {
      if ((statSync(this.path, { throwIfNoEntry: false })?.size ?? 0) >= 128 * 1024) {
        renameSync(this.path, this.path + '.previous')
      }
      appendFileSync(this.path, JSON.stringify({ time: new Date().toISOString(), event, ...fields }) + '\n', { mode: 0o600 })
      this.available = true
    } catch { this.available = false }
  }
}
