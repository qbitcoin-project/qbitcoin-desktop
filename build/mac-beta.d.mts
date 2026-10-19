// Shared by the build CLI, Vite configuration and regression tests.
import type { ReleaseNotes } from '../src/shared/changelog'
export interface BetaProfile {
  config: Record<string, unknown>
  identity: { productName: string; dataDirName: string }
  version: string
  notes: ReleaseNotes
  output: string
}
export declare function loadBetaProfile(root: string): BetaProfile
export declare function assertMacDistributionEnv(env: Record<string, string | undefined>, platform: string): void
