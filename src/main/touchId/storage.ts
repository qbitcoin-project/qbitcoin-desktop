import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

type Binding = { phase: 'creating'; id: string; repairDigest?: string } | { phase: 'removing'; id: string } |
  { phase: 'active'; id: string; digest: string; enrollment?: string; needsSetup?: true }
export interface Settings { version: 1; deferred: boolean; binding: Binding | null }
export interface StateStore { read(): Settings; write(state: Settings): void }
export const freshSettings = (): Settings => ({ version: 1, deferred: false, binding: null })

const isDigest = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

function validBinding(value: unknown): boolean {
  if (value === null) return true
  if (!value || typeof value !== 'object') return false
  const b = value as Record<string, unknown>
  if (typeof b.id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(b.id)) return false
  if (b.phase === 'removing') return true
  if (b.phase === 'creating') return b.repairDigest === undefined || isDigest(b.repairDigest)
  return b.phase === 'active' && isDigest(b.digest) && (b.needsSetup === undefined || b.needsSetup === true) &&
    (b.enrollment === undefined || (typeof b.enrollment === 'string' && /^\d+:[0-9a-f]{64}$/.test(b.enrollment)))
}

export class ProbeFile implements StateStore {
  constructor(private readonly path: string) {}
  read(): Settings {
    let raw: string
    try { raw = readFileSync(this.path, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return freshSettings()
      throw error
    }
    const value = JSON.parse(raw)
    if (value?.version !== 1 || typeof value.deferred !== 'boolean' || !validBinding(value.binding)) {
      throw new Error('The Touch ID test settings could not be validated.')
    }
    return value
  }
  write(state: Settings): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    writeFileSync(this.path + '.tmp', JSON.stringify(state), { mode: 0o600 })
    renameSync(this.path + '.tmp', this.path)
  }
}
