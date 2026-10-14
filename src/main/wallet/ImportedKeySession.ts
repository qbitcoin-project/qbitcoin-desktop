import type { ImportedKey } from './keyWallet'
import type { StoredKey } from './keyStore'

/** One wallet session owns one materialized key. A disposed session can never
 * reopen it, including through work that was awaiting storage or WASM. */
export class ImportedKeySession {
  private disposed = false
  private key: ImportedKey | null = null
  private pending: Promise<ImportedKey> | null = null

  constructor(
    private readonly load: () => Promise<StoredKey | null>,
    private readonly materialize: (stored: StoredKey) => Promise<ImportedKey>,
  ) {}

  get(): Promise<ImportedKey> {
    if (this.disposed) return Promise.reject(new Error('The key wallet session has ended.'))
    if (this.key !== null) return Promise.resolve(this.key)
    if (this.pending !== null) return this.pending
    const pending = this.open()
    this.pending = pending
    // Clear failed loads too, so a live session can retry a transient read error.
    void pending.then(() => { this.pending = null }, () => { this.pending = null })
    return pending
  }

  private async open(): Promise<ImportedKey> {
    const stored = await this.load()
    if (this.disposed) throw new Error('The key wallet session has ended.')
    if (stored === null) throw new Error('The key for this wallet is missing or could not be opened.')
    const key = await this.materialize(stored)
    if (this.disposed) {
      key.privateKey.fill(0)
      throw new Error('The key wallet session has ended.')
    }
    this.key = key
    return key
  }

  dispose(): void {
    this.disposed = true
    this.key?.privateKey.fill(0)
    this.key = null
    this.pending = null
  }
}
