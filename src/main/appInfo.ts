// Display identity for the MAIN process (menus, dialogs): the brand's values
// from ./brand/product, with the test build's own name when one is compiled in.
//
// Deliberately NOT wired to app.getName()/package.json `productName`:
// Electron derives the default userData path from app.name, and existing
// installs must keep that path byte-stable (installed wallets would
// "disappear" otherwise). These constants are presentation only.

import { HOMEPAGE, PRODUCT_NAME as BRAND_PRODUCT_NAME } from './brand/product'
import { TEST_BUILD } from './testBuild'

/** Human-readable product name for menu items and dialogs. */
export const PRODUCT_NAME = TEST_BUILD?.productName ?? BRAND_PRODUCT_NAME

export { HOMEPAGE }
