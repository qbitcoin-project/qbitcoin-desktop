// BRAND FILE: display identity for the MAIN process (menus, dialogs).
// Brands edit the values in place.
//
// Deliberately NOT wired to app.getName()/package.json `productName`:
// Electron derives the default userData path from app.name, and existing
// installs must keep that path byte-stable (installed wallets would
// "disappear" otherwise). These constants are presentation only.

import { TEST_BUILD } from './testBuild'

/** Human-readable product name for menu items and dialogs. */
export const PRODUCT_NAME = TEST_BUILD?.productName ?? 'QBitcoin Wallet'

/** Brand website for Help → Learn More; null hides the item. */
export const HOMEPAGE: string | null = null
