import type { Availability } from './touchIdProbe'

export const WALLET_TOUCH_ID_CHANNEL = 'wallet:touch-id'
export type TouchIdStatus = { enabled: boolean; availability: Availability; needsSetup: boolean; offer: boolean; entryReady: boolean }
export type TouchIdUnlockResult = 'unlocked' | 'cancelled' | 'password-required'
export type TouchIdDisableResult = 'disabled' | 'cancelled' | 'denied' | 'password-required'
export interface WalletTouchIdApi {
  status(): Promise<TouchIdStatus>
  later(): Promise<void>
  enable(password: string): Promise<void>
  enableAtEntry(): Promise<void>
  disable(password?: string): Promise<TouchIdDisableResult>
  unlock(): Promise<TouchIdUnlockResult>
  cancel(): Promise<void>
}
