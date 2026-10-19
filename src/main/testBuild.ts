import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface TestBuildIdentity {
  productName: string
  dataDirName: string
}

// Replaced at compile time; an environment variable cannot switch an installed
// stable app to test storage or enable updates in a test app.
declare const __TEST_BUILD__: TestBuildIdentity | null
export const TEST_BUILD = typeof __TEST_BUILD__ === 'undefined' ? null : __TEST_BUILD__

interface StorageApp {
  getPath(name: 'appData'): string
  setPath(name: 'userData' | 'sessionData', path: string): void
}

/** Must run before app readiness, sessions and wallet services are initialized. */
export function configureTestStorage(app: StorageApp, identity = TEST_BUILD): void {
  if (!identity) return
  if (!/^[a-z0-9][a-z0-9-]*-test$/.test(identity.dataDirName)) throw new Error('Invalid test storage name')
  const root = join(app.getPath('appData'), identity.dataDirName)
  mkdirSync(root, { recursive: true })
  app.setPath('userData', root)
  app.setPath('sessionData', root)
  try {
    // Exclusive create preserves the user's choice across restarts and upgrades.
    writeFileSync(join(root, 'network.json'), '{"network":"testnet"}\n', { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}
