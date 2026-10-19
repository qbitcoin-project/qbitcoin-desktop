/** A session-wide gate for signing/broadcast and change-address allocation. */
export class SpendCoordinator {
  private tail: Promise<void> = Promise.resolve()
  private disposed = false

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.check()
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => { release = resolve })
    try { await previous; this.check(); return await work() } finally { release() }
  }

  check(): void {
    if (this.disposed) throw new Error('The wallet session ended. Unlock and review the operation again.')
  }

  dispose(): void { this.disposed = true }
}
